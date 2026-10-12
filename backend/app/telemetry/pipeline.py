"""Asynchronous Telemetry Pipeline for VEGAPilot GCS.
Coordinates:
UDP Transport -> Bounded Queue -> Parser -> Validator -> Reliability Engine ->
Persistence Worker (SQLite WAL) -> State Updater -> WebSocket Broadcaster.
"""
import asyncio
import json
import logging
import math
import time
from typing import Optional, Tuple, Dict, Any, List
from sqlalchemy import select, update, desc
from app.config import get_settings
from app.database.models import (
    TelemetryPacket,
    TelemetryState,
    TelemetryGap,
    TelemetryEvent,
    ConnectionEvent,
    CommandLog,
    current_time_ms,
)
from app.database.session import AsyncSessionLocal
from app.mavlink.parser import (
    MavlinkParser,
    extract_flight_mode,
    is_vehicle_armed,
    rad_to_deg,
)
from app.models.telemetry import (
    NormalizedTelemetry,
    PositionData,
    AttitudeData,
    VelocityData,
    BatteryData,
    GpsData,
    FlightData,
    DataHealth,
)
from app.reliability.engine import TelemetryReliabilityEngine
from app.transport.base import TelemetryTransport
from app.websocket.manager import get_ws_manager

logger = logging.getLogger("vegapilot.pipeline")


class TelemetryPipeline:
    """Core telemetry processing engine."""

    def __init__(
        self,
        transport: TelemetryTransport,
        mission_id: str = "MISSION-001",
    ) -> None:
        self.settings = get_settings()
        self.transport = transport
        self.mission_id = mission_id

        self.mav_parser = MavlinkParser()
        self.reliability = TelemetryReliabilityEngine(mission_id=mission_id)
        self.ws_manager = get_ws_manager()

        # Bounded asynchronous queues for backpressure protection
        self.packet_queue: asyncio.Queue = asyncio.Queue(maxsize=10000)
        self.persistence_queue: asyncio.Queue = asyncio.Queue(maxsize=10000)

        # In-memory normalized state (always freshest verified telemetry)
        self.latest_state = NormalizedTelemetry(
            drone_id=self.settings.drone_id,
            received_at=current_time_ms(),
            processed_at=current_time_ms(),
        )

        # Operational tasks
        self._worker_task: Optional[asyncio.Task] = None
        self._db_task: Optional[asyncio.Task] = None
        self._health_monitor_task: Optional[asyncio.Task] = None
        self._last_sender_addr: Optional[Tuple[str, int]] = None
        self._is_active: bool = False

        # Hook up recovery sender to transport
        self.reliability.set_recovery_sender(self._send_recovery_request)
        self.reliability.register_gap_callback(self._on_gap_status_change)

        # State transition trackers for event logging
        self._prev_armed: Optional[bool] = None
        self._prev_flight_mode: Optional[str] = None
        self._battery_warned_low: bool = False
        self._battery_warned_crit: bool = False
        self._prev_conn_status: str = "DISCONNECTED"

    async def start(self) -> None:
        """Initialize workers and start listening."""
        if self._is_active:
            return

        self._is_active = True
        self.transport.register_callback(self._on_raw_packet_received)
        await self.transport.start()

        self._worker_task = asyncio.create_task(self._process_packets())
        self._db_task = asyncio.create_task(self._persistence_worker())
        self._health_monitor_task = asyncio.create_task(self._health_monitor_loop())
        logger.info(f"Telemetry Pipeline started for mission {self.mission_id}.")

    async def stop(self) -> None:
        """Gracefully shut down pipeline."""
        self._is_active = False
        await self.transport.stop()

        for task in (self._worker_task, self._db_task, self._health_monitor_task):
            if task and not task.done():
                task.cancel()

        logger.info("Telemetry Pipeline stopped.")

    async def set_active_mission(self, new_mission_id: str) -> None:
        """Switch active mission ID."""
        self.mission_id = new_mission_id
        self.reliability = TelemetryReliabilityEngine(mission_id=new_mission_id)
        self.reliability.set_recovery_sender(self._send_recovery_request)
        self.reliability.register_gap_callback(self._on_gap_status_change)
        logger.info(f"Switched active mission to: {new_mission_id}")

    async def _on_raw_packet_received(
        self, data: bytes, sender_addr: Tuple[str, int], recv_ms: int
    ) -> None:
        """Callback from transport. Fast non-blocking enqueue."""
        self._last_sender_addr = sender_addr
        try:
            self.packet_queue.put_nowait((data, sender_addr, recv_ms))
        except asyncio.QueueFull:
            logger.error("Telemetry packet queue full! Dropping packet to prevent backpressure lockup.")
            self.reliability.invalid_packets_count += 1

    async def _process_packets(self) -> None:
        """Worker that processes raw packets from queue."""
        while self._is_active:
            try:
                item = await self.packet_queue.get()
                if item is None:
                    break
                data, sender_addr, recv_ms = item
                proc_ms = current_time_ms()

                # Parse packet via MAVLink / JSON
                parsed_items = self.mav_parser.parse_bytes(data)

                for raw_msg, msg_dict in parsed_items:
                    if raw_msg == "CORRUPT_BYTES" or (hasattr(raw_msg, "get_type") and raw_msg.get_type() == "BAD_DATA"):
                        self.reliability.process_incoming_packet(
                            source_seq=None,
                            source_timestamp=None,
                            received_at_ms=recv_ms,
                            is_valid=False,
                        )
                        continue

                    # Handle Application Recovery Protocol frames
                    if raw_msg == "JSON_FRAME" and isinstance(msg_dict, dict):
                        await self._handle_json_control_frame(msg_dict, recv_ms, proc_ms)
                        continue

                    if not hasattr(raw_msg, "get_type"):
                        continue

                    msg_type = raw_msg.get_type()

                    # Handle MAVLink command acknowledgment
                    if msg_type == "COMMAND_ACK" and isinstance(msg_dict, dict):
                        cmd_ack_id = msg_dict.get("command", 0)
                        cmd_ack_res = msg_dict.get("result", 0)
                        await self._handle_command_ack(cmd_ack_id, cmd_ack_res, recv_ms)

                    # Extract sequence and timestamp
                    # Check if payload contains extended monotonic source sequence
                    source_seq = getattr(raw_msg, "source_sequence", None)
                    if source_seq is None and hasattr(raw_msg, "get_seq"):
                        source_seq = raw_msg.get_seq()

                    # Check source timestamp
                    source_ts = None
                    if msg_dict:
                        if "time_unix_usec" in msg_dict and msg_dict["time_unix_usec"] > 0:
                            source_ts = int(msg_dict["time_unix_usec"] / 1000)
                        elif "time_boot_ms" in msg_dict and msg_dict["time_boot_ms"] > 0:
                            source_ts = int(msg_dict["time_boot_ms"])
                        elif "source_timestamp" in msg_dict:
                            source_ts = int(msg_dict["source_timestamp"])

                    # Check recovery marker
                    is_recovered_flag = getattr(raw_msg, "is_recovered", False)
                    if isinstance(msg_dict, dict) and msg_dict.get("is_recovered"):
                        is_recovered_flag = True

                    # Reliability sequence & gap analysis
                    recv_seq, is_dup, is_ooo, is_rec = self.reliability.process_incoming_packet(
                        source_seq=source_seq,
                        source_timestamp=source_ts,
                        received_at_ms=recv_ms,
                        is_valid=True,
                    )

                    if is_recovered_flag:
                        is_rec = True

                    # Validate telemetry values
                    is_valid = self._validate_message_fields(msg_type, msg_dict or {})

                    # Telemetry state update (skip if out of order or duplicate to avoid overwriting newer state)
                    if not is_dup and not is_ooo and is_valid:
                        self._update_normalized_state(
                            msg_type=msg_type,
                            msg_dict=msg_dict or {},
                            source_seq=source_seq,
                            recv_seq=recv_seq,
                            source_ts=source_ts,
                            recv_ms=recv_ms,
                            proc_ms=proc_ms,
                        )

                    # Enqueue for asynchronous persistence
                    try:
                        self.persistence_queue.put_nowait({
                            "mission_id": self.mission_id,
                            "drone_id": self.settings.drone_id,
                            "source_sequence": source_seq,
                            "receive_sequence": recv_seq,
                            "message_type": msg_type,
                            "source_timestamp": source_ts,
                            "received_at": recv_ms,
                            "processed_at": proc_ms,
                            "raw_message_type": msg_type,
                            "payload_json": json.dumps(msg_dict or {}),
                            "is_duplicate": is_dup,
                            "is_out_of_order": is_ooo,
                            "is_recovered": is_rec,
                            "is_valid": is_valid,
                        })
                    except asyncio.QueueFull:
                        pass

                # Broadcast live state update over WebSocket
                await self._broadcast_telemetry_tick()
                self.packet_queue.task_done()
            except asyncio.CancelledError:
                break
            except Exception as e:
                logger.error(f"Error in telemetry packet worker: {e}", exc_info=True)

    async def _handle_json_control_frame(
        self, payload: Dict[str, Any], recv_ms: int, proc_ms: int
    ) -> None:
        """Handles application-level JSON recovery and control packets."""
        msg_type = payload.get("type", "JSON")
        if msg_type == "RECOVERY_RESPONSE":
            seq = payload.get("sequence")
            inner_data = payload.get("payload", {})
            if seq is not None:
                recv_seq, is_dup, is_ooo, is_rec = self.reliability.process_incoming_packet(
                    source_seq=seq,
                    source_timestamp=payload.get("source_timestamp"),
                    received_at_ms=recv_ms,
                    is_valid=True,
                )
                logger.info(f"Processed recovery response packet #{seq}")
                if isinstance(inner_data, dict):
                    self._update_normalized_state(
                        msg_type="RECOVERED_TELEMETRY",
                        msg_dict=inner_data,
                        source_seq=seq,
                        recv_seq=recv_seq,
                        source_ts=payload.get("source_timestamp"),
                        recv_ms=recv_ms,
                        proc_ms=proc_ms,
                    )
                # Enqueue recovery packet for persistence
                self.persistence_queue.put_nowait({
                    "mission_id": self.mission_id,
                    "drone_id": self.settings.drone_id,
                    "source_sequence": seq,
                    "receive_sequence": recv_seq,
                    "message_type": "RECOVERED_TELEMETRY",
                    "source_timestamp": payload.get("source_timestamp"),
                    "received_at": recv_ms,
                    "processed_at": proc_ms,
                    "raw_message_type": "RECOVERED_TELEMETRY",
                    "payload_json": json.dumps(inner_data),
                    "is_duplicate": False,
                    "is_out_of_order": False,
                    "is_recovered": True,
                    "is_valid": True,
                })

    def _validate_message_fields(self, msg_type: str, msg_dict: Dict[str, Any]) -> bool:
        """Validates physical range constraints on telemetry fields."""
        try:
            if msg_type == "GLOBAL_POSITION_INT":
                lat = msg_dict.get("lat", 0) / 1e7
                lon = msg_dict.get("lon", 0) / 1e7
                alt = msg_dict.get("alt", 0) / 1000.0
                if not (-90.0 <= lat <= 90.0) or not (-180.0 <= lon <= 180.0):
                    return False
                if not (-500.0 <= alt <= 50000.0):
                    return False

            elif msg_type == "ATTITUDE":
                roll = rad_to_deg(msg_dict.get("roll", 0.0))
                pitch = rad_to_deg(msg_dict.get("pitch", 0.0))
                if not (-180.0 <= roll <= 180.0) or not (-90.0 <= pitch <= 90.0):
                    return False

            elif msg_type == "SYS_STATUS":
                volt = msg_dict.get("voltage_battery", 0) / 1000.0
                curr = msg_dict.get("current_battery", 0) / 100.0
                if volt < 0 or volt > 60.0 or curr < -10.0 or curr > 500.0:
                    return False

            return True
        except Exception:
            return False

    def _update_normalized_state(
        self,
        msg_type: str,
        msg_dict: Dict[str, Any],
        source_seq: Optional[int],
        recv_seq: int,
        source_ts: Optional[int],
        recv_ms: int,
        proc_ms: int,
    ) -> None:
        """Merges parsed MAVLink message into the centralized latest normalized telemetry state."""
        self.latest_state.source_sequence = source_seq
        self.latest_state.received_sequence = recv_seq
        self.latest_state.source_timestamp = source_ts
        self.latest_state.received_at = recv_ms
        self.latest_state.processed_at = proc_ms
        self.latest_state.raw_message_type = msg_type

        if msg_type == "HEARTBEAT":
            base_mode = msg_dict.get("base_mode", 0)
            custom_mode = msg_dict.get("custom_mode", 0)
            self.latest_state.flight.armed = is_vehicle_armed(base_mode)
            self.latest_state.flight.mode = extract_flight_mode(custom_mode, base_mode)

        elif msg_type == "ATTITUDE":
            self.latest_state.attitude.roll_deg = rad_to_deg(msg_dict.get("roll", 0.0))
            self.latest_state.attitude.pitch_deg = rad_to_deg(msg_dict.get("pitch", 0.0))
            self.latest_state.attitude.yaw_deg = round((rad_to_deg(msg_dict.get("yaw", 0.0)) + 360.0) % 360.0, 1)

        elif msg_type == "GLOBAL_POSITION_INT":
            self.latest_state.position.latitude = round(msg_dict.get("lat", 0) / 1e7, 7)
            self.latest_state.position.longitude = round(msg_dict.get("lon", 0) / 1e7, 7)
            self.latest_state.position.altitude_m = round(msg_dict.get("alt", 0) / 1000.0, 2)
            self.latest_state.position.relative_altitude_m = round(msg_dict.get("relative_alt", 0) / 1000.0, 2)
            vx = msg_dict.get("vx", 0) / 100.0
            vy = msg_dict.get("vy", 0) / 100.0
            vz = msg_dict.get("vz", 0) / 100.0
            self.latest_state.velocity.ground_speed_mps = round(math.sqrt(vx * vx + vy * vy), 2)
            self.latest_state.velocity.vertical_speed_mps = round(-vz, 2)

        elif msg_type == "GPS_RAW_INT":
            self.latest_state.gps.fix_type = msg_dict.get("fix_type")
            self.latest_state.gps.satellites = msg_dict.get("satellites_visible")

        elif msg_type == "SYS_STATUS":
            self.latest_state.battery.percentage = msg_dict.get("battery_remaining")
            self.latest_state.battery.voltage_v = round(msg_dict.get("voltage_battery", 0) / 1000.0, 2)
            self.latest_state.battery.current_a = round(msg_dict.get("current_battery", 0) / 100.0, 2)

        elif msg_type == "BATTERY_STATUS":
            self.latest_state.battery.percentage = msg_dict.get("battery_remaining")

        elif msg_type == "VFR_HUD":
            if self.latest_state.velocity.ground_speed_mps is None:
                self.latest_state.velocity.ground_speed_mps = round(msg_dict.get("groundspeed", 0.0), 2)
            if self.latest_state.velocity.vertical_speed_mps is None:
                self.latest_state.velocity.vertical_speed_mps = round(msg_dict.get("climb", 0.0), 2)

        elif msg_type == "RECOVERED_TELEMETRY":
            # Merged values from simulator recovery dictionary
            if "latitude" in msg_dict:
                self.latest_state.position.latitude = msg_dict["latitude"]
                self.latest_state.position.longitude = msg_dict["longitude"]
                self.latest_state.position.altitude_m = msg_dict.get("altitude_m")
            if "roll_deg" in msg_dict:
                self.latest_state.attitude.roll_deg = msg_dict["roll_deg"]
                self.latest_state.attitude.pitch_deg = msg_dict["pitch_deg"]
                self.latest_state.attitude.yaw_deg = msg_dict["yaw_deg"]
            if "battery" in msg_dict and isinstance(msg_dict["battery"], dict):
                self.latest_state.battery.percentage = msg_dict["battery"].get("percentage")

        # Update data health snapshot
        health = self.reliability.get_data_health()
        if source_ts and source_ts > 0:
            health.transport_latency_ms = max(0.0, float(recv_ms - source_ts))
        health.processing_latency_ms = max(0.0, float(proc_ms - recv_ms))
        self.latest_state.data_health = health

        # Track transitions for real event logging
        if self.latest_state.flight.armed is not None and self.latest_state.flight.armed != self._prev_armed:
            if self._prev_armed is not None:
                ev_name = "VEHICLE_ARMED" if self.latest_state.flight.armed else "VEHICLE_DISARMED"
                asyncio.create_task(self.record_event(ev_name, {"mode": self.latest_state.flight.mode}))
            self._prev_armed = self.latest_state.flight.armed

        if self.latest_state.flight.mode and self.latest_state.flight.mode != self._prev_flight_mode:
            if self._prev_flight_mode is not None:
                asyncio.create_task(self.record_event("FLIGHT_MODE_CHANGED", {"old_mode": self._prev_flight_mode, "new_mode": self.latest_state.flight.mode}))
            self._prev_flight_mode = self.latest_state.flight.mode

        bat_pct = self.latest_state.battery.percentage
        if bat_pct is not None:
            if bat_pct <= 15.0 and not self._battery_warned_crit:
                self._battery_warned_crit = True
                asyncio.create_task(self.record_event("BATTERY_CRITICAL", {"percentage": bat_pct, "voltage": self.latest_state.battery.voltage_v}))
            elif bat_pct <= 25.0 and not self._battery_warned_low:
                self._battery_warned_low = True
                asyncio.create_task(self.record_event("BATTERY_LOW", {"percentage": bat_pct, "voltage": self.latest_state.battery.voltage_v}))

    async def record_event(self, event_type: str, payload: Dict[str, Any]) -> None:
        """Persists a real system event to SQLite and broadcasts over WebSocket."""
        now_ms = current_time_ms()
        async with AsyncSessionLocal() as session:
            try:
                ev = TelemetryEvent(
                    mission_id=self.mission_id,
                    event_type=event_type,
                    timestamp=now_ms,
                    payload=json.dumps(payload),
                )
                session.add(ev)
                await session.commit()
            except Exception as e:
                logger.error(f"Error persisting telemetry event: {e}")

        await self.ws_manager.broadcast({
            "type": "SYSTEM_EVENT",
            "event_type": event_type,
            "mission_id": self.mission_id,
            "timestamp": now_ms,
            "payload": payload,
        })

    async def _handle_command_ack(self, command_id: int, result: int, recv_ms: int) -> None:
        """Handles MAVLink COMMAND_ACK frame and updates command status."""
        is_accepted = (result == 0)
        new_status = "ACKNOWLEDGED" if is_accepted else "FAILED"
        logger.info(f"[COMMAND ACK] Received ACK for command {command_id}: {new_status} (result={result})")

        async with AsyncSessionLocal() as session:
            try:
                res = await session.execute(
                    select(CommandLog)
                    .where(CommandLog.mission_id == self.mission_id, CommandLog.command_id == command_id)
                    .order_by(desc(CommandLog.timestamp))
                    .limit(1)
                )
                cmd_log = res.scalar_one_or_none()
                if cmd_log:
                    cmd_log.status = new_status
                    cmd_log.acknowledged_at = recv_ms
                    cmd_log.details = f"MAV_RESULT: {result}"
                    await session.commit()
            except Exception as e:
                logger.error(f"Error updating command log: {e}")

        await self.ws_manager.broadcast({
            "type": "COMMAND_STATUS",
            "command_id": command_id,
            "status": new_status,
            "result": result,
            "timestamp": recv_ms,
        })
        await self.record_event(
            event_type="COMMAND_ACKNOWLEDGED" if is_accepted else "COMMAND_FAILED",
            payload={"command_id": command_id, "result": result, "status": new_status},
        )

    async def send_mavlink_command(
        self, command_name: str, command_id: int, param1: float = 0.0, param2: float = 0.0
    ) -> Dict[str, Any]:
        """Dispatches an authentic MAVLink COMMAND_LONG frame over UDP."""
        now_ms = current_time_ms()
        async with AsyncSessionLocal() as session:
            cmd_log = CommandLog(
                mission_id=self.mission_id,
                command_name=command_name,
                command_id=command_id,
                status="SENT",
                timestamp=now_ms,
                details=f"param1={param1}, param2={param2}",
            )
            session.add(cmd_log)
            await session.commit()
            cmd_id_db = cmd_log.id

        cmd_msg = self.mav_parser.mav.command_long_encode(
            target_system=1,
            target_component=1,
            command=command_id,
            confirmation=0,
            param1=param1,
            param2=param2,
            param3=0.0,
            param4=0.0,
            param5=0.0,
            param6=0.0,
            param7=0.0,
        )
        packed_bytes = cmd_msg.pack(self.mav_parser.mav)

        target_addr = (
            self.settings.drone_ip,
            14555 if self.settings.drone_ip in ("127.0.0.1", "localhost") else self.settings.telemetry_port,
        )
        if self._last_sender_addr:
            target_addr = self._last_sender_addr

        logger.info(f"Sending MAVLink command {command_name} (ID: {command_id}) to {target_addr}")
        await self.transport.send(packed_bytes, target_addr)

        await self.ws_manager.broadcast({
            "type": "COMMAND_STATUS",
            "id": cmd_id_db,
            "command_name": command_name,
            "command_id": command_id,
            "status": "SENT",
            "timestamp": now_ms,
        })
        await self.record_event(
            event_type="COMMAND_SENT",
            payload={"command_name": command_name, "command_id": command_id, "params": [param1, param2]},
        )
        return {
            "id": cmd_id_db,
            "command_name": command_name,
            "command_id": command_id,
            "status": "SENT",
            "timestamp": now_ms,
        }

    async def _send_recovery_request(self, missing_sequences: List[int]) -> None:
        """Dispatches an application recovery retransmission request to the sender."""
        target_addr = self._last_sender_addr or (
            self.settings.drone_ip,
            self.settings.telemetry_port,
        )
        payload = {
            "type": "RECOVERY_REQUEST",
            "mission_id": self.mission_id,
            "missing": missing_sequences,
            "timestamp": current_time_ms(),
        }
        raw_bytes = json.dumps(payload).encode("utf-8")
        logger.info(f"Sending recovery request for sequences: {missing_sequences} to {target_addr}")
        await self.transport.send(raw_bytes, target_addr)

        # Notify UI of recovery action
        await self.ws_manager.broadcast({
            "type": "RECOVERY_ALERT",
            "status": "RECOVERING",
            "missing_sequences": missing_sequences,
            "timestamp": current_time_ms(),
        })

    async def _on_gap_status_change(self, seq: int, status: str, ts: int) -> None:
        """Callback from reliability engine on gap state transitions."""
        await self.ws_manager.broadcast({
            "type": "GAP_EVENT",
            "sequence": seq,
            "status": status,
            "timestamp": ts,
        })

        # Save gap event to SQLite asynchronously
        async with AsyncSessionLocal() as session:
            try:
                gap = TelemetryGap(
                    mission_id=self.mission_id,
                    expected_sequence=seq,
                    detected_at=ts,
                    status=status,
                    recovered_at=ts if status == "RECOVERED" else None,
                )
                session.add(gap)
                await session.commit()
            except Exception as e:
                logger.error(f"Error persisting gap event: {e}")

    async def _broadcast_telemetry_tick(self) -> None:
        """Pushes latest normalized telemetry frame over WebSocket."""
        await self.ws_manager.broadcast({
            "type": "TELEMETRY_UPDATE",
            "mission_id": self.mission_id,
            "telemetry": self.latest_state.model_dump(),
        })

    async def _health_monitor_loop(self) -> None:
        """Periodically check staleness and broadcast status even if packets stop."""
        while self._is_active:
            try:
                await asyncio.sleep(0.25)
                # Recalculate data health to catch transitions (e.g. LIVE -> DEGRADED -> STALE -> DISCONNECTED)
                health = self.reliability.get_data_health()
                self.latest_state.data_health = health

                curr_status = health.status
                if curr_status != self._prev_conn_status:
                    if curr_status in ("LIVE", "CONNECTED") and self._prev_conn_status in ("DISCONNECTED", "RECONNECTING"):
                        asyncio.create_task(self.record_event("VEHICLE_CONNECTED", {"status": curr_status}))
                    elif curr_status == "DISCONNECTED" and self._prev_conn_status != "DISCONNECTED":
                        asyncio.create_task(self.record_event("COMMUNICATION_LOST", {"status": curr_status, "age_ms": health.last_packet_age_ms}))
                    self._prev_conn_status = curr_status

                # If connection dropped or degraded, notify UI immediately
                if health.status in ("DEGRADED", "STALE", "DISCONNECTED"):
                    await self.ws_manager.broadcast({
                        "type": "HEALTH_UPDATE",
                        "mission_id": self.mission_id,
                        "data_health": health.model_dump(),
                    })
            except asyncio.CancelledError:
                break
            except Exception as e:
                logger.error(f"Error in health monitor: {e}")

    async def _persistence_worker(self) -> None:
        """Asynchronous database batch persistence worker.
        Batches database inserts to ensure zero receiver thread contention.
        """
        while self._is_active:
            batch: List[Dict[str, Any]] = []
            try:
                # Get first item (blocking wait)
                item = await self.persistence_queue.get()
                if item is None:
                    break
                batch.append(item)

                # Drain up to 100 more items immediately available in queue
                while len(batch) < 100 and not self.persistence_queue.empty():
                    batch.append(self.persistence_queue.get_nowait())

                # Batch write to SQLite
                async with AsyncSessionLocal() as session:
                    for pkt_data in batch:
                        packet = TelemetryPacket(**pkt_data)
                        session.add(packet)

                    # Also update or insert current TelemetryState
                    result = await session.execute(
                        select(TelemetryState).where(TelemetryState.mission_id == self.mission_id)
                    )
                    state_row = result.scalar_one_or_none()
                    now_ms = current_time_ms()

                    if state_row is None:
                        state_row = TelemetryState(
                            mission_id=self.mission_id,
                            drone_id=self.settings.drone_id,
                            latitude=self.latest_state.position.latitude,
                            longitude=self.latest_state.position.longitude,
                            altitude_m=self.latest_state.position.altitude_m,
                            relative_altitude_m=self.latest_state.position.relative_altitude_m,
                            roll_deg=self.latest_state.attitude.roll_deg,
                            pitch_deg=self.latest_state.attitude.pitch_deg,
                            yaw_deg=self.latest_state.attitude.yaw_deg,
                            ground_speed_mps=self.latest_state.velocity.ground_speed_mps,
                            vertical_speed_mps=self.latest_state.velocity.vertical_speed_mps,
                            battery_percentage=self.latest_state.battery.percentage,
                            battery_voltage_v=self.latest_state.battery.voltage_v,
                            battery_current_a=self.latest_state.battery.current_a,
                            gps_fix_type=self.latest_state.gps.fix_type,
                            gps_satellites=self.latest_state.gps.satellites,
                            flight_armed=self.latest_state.flight.armed,
                            flight_mode=self.latest_state.flight.mode,
                            last_source_sequence=self.latest_state.source_sequence,
                            last_receive_sequence=self.latest_state.received_sequence,
                            last_received_time=self.latest_state.received_at,
                            connection_state=self.latest_state.data_health.status,
                            updated_at=now_ms,
                        )
                        session.add(state_row)
                    else:
                        state_row.latitude = self.latest_state.position.latitude
                        state_row.longitude = self.latest_state.position.longitude
                        state_row.altitude_m = self.latest_state.position.altitude_m
                        state_row.relative_altitude_m = self.latest_state.position.relative_altitude_m
                        state_row.roll_deg = self.latest_state.attitude.roll_deg
                        state_row.pitch_deg = self.latest_state.attitude.pitch_deg
                        state_row.yaw_deg = self.latest_state.attitude.yaw_deg
                        state_row.ground_speed_mps = self.latest_state.velocity.ground_speed_mps
                        state_row.vertical_speed_mps = self.latest_state.velocity.vertical_speed_mps
                        state_row.battery_percentage = self.latest_state.battery.percentage
                        state_row.battery_voltage_v = self.latest_state.battery.voltage_v
                        state_row.battery_current_a = self.latest_state.battery.current_a
                        state_row.gps_fix_type = self.latest_state.gps.fix_type
                        state_row.gps_satellites = self.latest_state.gps.satellites
                        state_row.flight_armed = self.latest_state.flight.armed
                        state_row.flight_mode = self.latest_state.flight.mode
                        state_row.last_source_sequence = self.latest_state.source_sequence
                        state_row.last_receive_sequence = self.latest_state.received_sequence
                        state_row.last_received_time = self.latest_state.received_at
                        state_row.connection_state = self.latest_state.data_health.status
                        state_row.updated_at = now_ms

                    await session.commit()

                for _ in batch:
                    self.persistence_queue.task_done()

            except asyncio.CancelledError:
                break
            except Exception as e:
                logger.error(f"Error in persistence batch worker: {e}", exc_info=True)
                await asyncio.sleep(0.5)
