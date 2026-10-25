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
    Mission,
    current_time_ms,
)
from pymavlink.dialects.v20 import common as mavlink2
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
    NavigationData,
    FlightData,
    DataHealth,
)
from app.reliability.engine import TelemetryReliabilityEngine
from app.transport.base import TelemetryTransport
from app.websocket.manager import get_ws_manager

logger = logging.getLogger("vegapilot.pipeline")


def calculate_distance_and_bearing(
    lat1: float, lon1: float, lat2: float, lon2: float
) -> Tuple[float, float]:
    """Calculate geodesic distance in meters (haversine) and initial bearing in degrees
    from (lat1, lon1) to (lat2, lon2).
    """
    R = 6371000.0  # Earth's radius in meters
    phi1 = math.radians(lat1)
    phi2 = math.radians(lat2)
    delta_phi = math.radians(lat2 - lat1)
    delta_lambda = math.radians(lon2 - lon1)

    a = (math.sin(delta_phi / 2.0) ** 2 +
         math.cos(phi1) * math.cos(phi2) * (math.sin(delta_lambda / 2.0) ** 2))
    c = 2.0 * math.atan2(math.sqrt(a), math.sqrt(max(0.0, 1.0 - a)))
    dist_m = round(R * c, 1)

    y = math.sin(delta_lambda) * math.cos(phi2)
    x = (math.cos(phi1) * math.sin(phi2) -
         math.sin(phi1) * math.cos(phi2) * math.cos(delta_lambda))
    theta = math.atan2(y, x)
    bearing_deg = round((math.degrees(theta) + 360.0) % 360.0, 1)

    return dist_m, bearing_deg


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
        self._last_ws_broadcast_time: float = 0.0
        self._last_cmd_timeout_check_ms: int = 0

        # Hook up recovery sender to transport
        self.reliability.set_recovery_sender(self._send_recovery_request)
        self.reliability.register_gap_callback(self._on_gap_status_change)

        # State transition trackers for event logging
        self._prev_armed: Optional[bool] = None
        self._prev_flight_mode: Optional[str] = None
        self._battery_warned_low: bool = False
        self._battery_warned_crit: bool = False
        self._prev_conn_status: str = "DISCONNECTED"

        # Telemetry Session Replay state
        self._replay_task: Optional[asyncio.Task] = None
        self._replay_state: Dict[str, Any] = {
            "is_replaying": False,
            "mission_id": None,
            "current": 0,
            "total": 0,
            "speed": 1.0,
        }

        # MAVLink Mission Protocol state
        self._pending_mission_wps: List[Dict[str, Any]] = []
        self._upload_future: Optional[asyncio.Future] = None
        self._mission_upload_state: str = "IDLE"
        self._download_future: Optional[asyncio.Future] = None
        self._downloaded_wps: List[Dict[str, Any]] = []
        self._download_total: int = 0

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

        tasks = [t for t in (self._worker_task, self._db_task, self._health_monitor_task) if t and not t.done()]
        for task in tasks:
            task.cancel()
        if tasks:
            await asyncio.gather(*tasks, return_exceptions=True)

        logger.info("Telemetry Pipeline stopped.")

    async def set_active_mission(self, new_mission_id: str) -> None:
        """Switch active mission ID and atomically reset state."""
        self.mission_id = new_mission_id
        self.reliability = TelemetryReliabilityEngine(mission_id=new_mission_id)
        self.reliability.set_recovery_sender(self._send_recovery_request)
        self.reliability.register_gap_callback(self._on_gap_status_change)

        # Reset normalized runtime state cleanly
        self.latest_state = NormalizedTelemetry(
            drone_id=self.settings.drone_id,
            received_at=0,
            processed_at=0,
        )
        self._prev_armed = None
        self._prev_flight_mode = None
        self._prev_conn_status = "DISCONNECTED"
        self._battery_warned_low = False
        self._battery_warned_crit = False

        # Drain any residual packet queue
        while not self.packet_queue.empty():
            try:
                self.packet_queue.get_nowait()
                self.packet_queue.task_done()
            except Exception:
                break

        # Broadcast MISSION_RESET over WebSocket so all clients clear their tracks
        await self.ws_manager.broadcast({
            "type": "MISSION_RESET",
            "mission_id": new_mission_id,
            "telemetry": self.latest_state.model_dump(),
        })
        logger.info(f"Switched active mission to: {new_mission_id} (State and tracks cleanly reset)")

    async def rebind_transport(
        self,
        bind_host: Optional[str] = None,
        bind_port: Optional[int] = None,
        target_host: Optional[str] = None,
        target_port: Optional[int] = None,
    ) -> Dict[str, Any]:
        """Dynamically rebinds UDP transport."""
        if hasattr(self.transport, "rebind"):
            await self.transport.rebind(
                bind_host=bind_host,
                bind_port=bind_port,
                default_target_host=target_host,
                default_target_port=target_port,
            )
            return self.transport.get_stats()
        return {}

    async def start_replay(self, mission_id: str, speed: float = 1.0) -> Dict[str, Any]:
        """Replay historical flight packets from SQLite back into the pipeline."""
        if self._replay_task and not self._replay_task.done():
            self._replay_task.cancel()

        self._replay_state = {
            "is_replaying": True,
            "mission_id": mission_id,
            "current": 0,
            "total": 0,
            "speed": max(0.1, speed),
        }
        self._replay_task = asyncio.create_task(self._replay_worker(mission_id, max(0.1, speed)))
        return self._replay_state

    async def stop_replay(self) -> Dict[str, Any]:
        """Stops an active telemetry replay."""
        if self._replay_task and not self._replay_task.done():
            self._replay_task.cancel()
        self._replay_state["is_replaying"] = False
        await self.ws_manager.broadcast({
            "type": "REPLAY_STATUS",
            "replay": self._replay_state,
        })
        return self._replay_state

    def get_replay_status(self) -> Dict[str, Any]:
        return self._replay_state

    async def _replay_worker(self, mission_id: str, speed: float) -> None:
        try:
            async with AsyncSessionLocal() as session:
                res = await session.execute(
                    select(TelemetryPacket)
                    .where(TelemetryPacket.mission_id == mission_id, TelemetryPacket.is_valid == True)
                    .order_by(TelemetryPacket.received_at.asc())
                )
                packets = res.scalars().all()

            total = len(packets)
            self._replay_state["total"] = total
            if total == 0:
                self._replay_state["is_replaying"] = False
                await self.ws_manager.broadcast({"type": "REPLAY_STATUS", "replay": self._replay_state})
                return

            delay = max(0.01, (1.0 / 15.0) / speed)
            for idx, pkt in enumerate(packets):
                self._replay_state["current"] = idx + 1
                try:
                    payload = json.loads(pkt.payload_json) if pkt.payload_json else {}
                except Exception:
                    payload = {}

                # Update normalized state
                self._update_normalized_state(
                    msg_type=pkt.message_type,
                    msg_dict=payload,
                    source_seq=pkt.source_sequence,
                    recv_seq=pkt.receive_sequence,
                    source_ts=pkt.source_timestamp,
                    recv_ms=pkt.received_at,
                    proc_ms=pkt.processed_at,
                )
                self.latest_state.data_health.status = "LIVE"

                # Broadcast tick and replay progress
                await self._broadcast_telemetry_tick()
                if (idx % 5 == 0) or (idx == total - 1):
                    await self.ws_manager.broadcast({
                        "type": "REPLAY_STATUS",
                        "replay": self._replay_state,
                    })

                await asyncio.sleep(delay)

            self._replay_state["is_replaying"] = False
            await self.ws_manager.broadcast({
                "type": "REPLAY_STATUS",
                "replay": self._replay_state,
            })
            logger.info(f"Completed replay of mission {mission_id} ({total} packets)")
        except asyncio.CancelledError:
            self._replay_state["is_replaying"] = False
        except Exception as e:
            logger.error(f"Error during replay: {e}")
            self._replay_state["is_replaying"] = False

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

                    # Handle MAVLink Mission Protocol messages
                    elif msg_type in ("MISSION_REQUEST", "MISSION_REQUEST_INT") and isinstance(msg_dict, dict):
                        req_seq = msg_dict.get("seq", 0)
                        await self._handle_mission_request(req_seq)

                    elif msg_type == "MISSION_ACK" and isinstance(msg_dict, dict):
                        ack_type = msg_dict.get("type", 0)
                        await self._handle_mission_ack(ack_type)

                    elif msg_type == "MISSION_COUNT" and isinstance(msg_dict, dict):
                        count = msg_dict.get("count", 0)
                        await self._handle_mission_count_download(count)

                    elif msg_type in ("MISSION_ITEM", "MISSION_ITEM_INT") and isinstance(msg_dict, dict):
                        await self._handle_mission_item_download(msg_dict)

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

                # Broadcast live state update over WebSocket (throttled to max 25Hz to eliminate CPU serialization lag)
                now_tick = time.monotonic()
                if now_tick - self._last_ws_broadcast_time >= 0.040:
                    self._last_ws_broadcast_time = now_tick
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
            raw_lat = msg_dict.get("lat", 0)
            raw_lon = msg_dict.get("lon", 0)
            lat = round(raw_lat / 1e7, 7)
            lon = round(raw_lon / 1e7, 7)
            alt = round(msg_dict.get("alt", 0) / 1000.0, 2)
            rel_alt = round(msg_dict.get("relative_alt", 0) / 1000.0, 2)
            hdg_cdeg = msg_dict.get("hdg", 65535)

            # Strict GPS Coordinate Range Validation (-90..90, -180..180, non-zero)
            if -90.0 <= lat <= 90.0 and -180.0 <= lon <= 180.0 and (raw_lat != 0 or raw_lon != 0):
                self.latest_state.position.latitude = lat
                self.latest_state.position.longitude = lon
                self.latest_state.position.altitude_m = alt
                self.latest_state.position.relative_altitude_m = rel_alt

                # Central authoritative GPS data model
                self.latest_state.gps.latitude = lat
                self.latest_state.gps.longitude = lon
                self.latest_state.gps.altitude_m = alt
                self.latest_state.gps.relative_altitude_m = rel_alt
                if hdg_cdeg != 65535:
                    self.latest_state.gps.heading_deg = round(hdg_cdeg / 100.0, 1)
                elif self.latest_state.attitude.yaw_deg is not None:
                    self.latest_state.gps.heading_deg = self.latest_state.attitude.yaw_deg

                self.latest_state.gps.valid = True
                self.latest_state.gps.is_stale = False
                self.latest_state.gps.last_update_ms = recv_ms
                if not self.latest_state.gps.gps_fix:
                    self.latest_state.gps.gps_fix = True
                    if self.latest_state.gps.fix_status == "NO_FIX":
                        self.latest_state.gps.fix_status = "3D_FIX"

            vx = msg_dict.get("vx", 0) / 100.0
            vy = msg_dict.get("vy", 0) / 100.0
            vz = msg_dict.get("vz", 0) / 100.0
            self.latest_state.velocity.ground_speed_mps = round(math.sqrt(vx * vx + vy * vy), 2)
            self.latest_state.velocity.vertical_speed_mps = round(-vz, 2)

        elif msg_type == "GPS_RAW_INT":
            fix_type = msg_dict.get("fix_type", 0)
            sats = msg_dict.get("satellites_visible")
            if sats == 255:
                sats = None
            eph = msg_dict.get("eph")
            epv = msg_dict.get("epv")
            hdop = round(eph / 100.0, 2) if (eph is not None and eph != 65535 and eph > 0) else None
            vdop = round(epv / 100.0, 2) if (epv is not None and epv != 65535 and epv > 0) else None
            time_usec = msg_dict.get("time_usec", 0)
            raw_lat = msg_dict.get("lat", 0)
            raw_lon = msg_dict.get("lon", 0)
            alt = round(msg_dict.get("alt", 0) / 1000.0, 2)
            cog_cdeg = msg_dict.get("cog", 65535)

            fix_map = {
                0: "NO_FIX",
                1: "NO_FIX",
                2: "2D_FIX",
                3: "3D_FIX",
                4: "DGPS",
                5: "RTK_FLOAT",
                6: "RTK_FIXED",
            }
            self.latest_state.gps.fix_type = fix_type
            self.latest_state.gps.gps_fix = bool(fix_type >= 2)
            self.latest_state.gps.fix_status = fix_map.get(fix_type, f"FIX_{fix_type}")
            self.latest_state.gps.satellites = sats
            self.latest_state.gps.hdop = hdop
            self.latest_state.gps.vdop = vdop
            if time_usec and time_usec > 0:
                self.latest_state.gps.timestamp = int(time_usec / 1000)

            lat = round(raw_lat / 1e7, 7)
            lon = round(raw_lon / 1e7, 7)
            if fix_type >= 2 and -90.0 <= lat <= 90.0 and -180.0 <= lon <= 180.0 and (raw_lat != 0 or raw_lon != 0):
                self.latest_state.gps.latitude = lat
                self.latest_state.gps.longitude = lon
                self.latest_state.gps.altitude_m = alt
                self.latest_state.gps.valid = True
                self.latest_state.gps.is_stale = False
                self.latest_state.gps.last_update_ms = recv_ms
                if cog_cdeg != 65535:
                    self.latest_state.gps.heading_deg = round(cog_cdeg / 100.0, 1)
                elif self.latest_state.attitude.yaw_deg is not None and self.latest_state.gps.heading_deg is None:
                    self.latest_state.gps.heading_deg = self.latest_state.attitude.yaw_deg

                if self.latest_state.position.latitude is None:
                    self.latest_state.position.latitude = lat
                    self.latest_state.position.longitude = lon
                    self.latest_state.position.altitude_m = alt

        elif msg_type == "HOME_POSITION":
            raw_lat = msg_dict.get("latitude", 0)
            raw_lon = msg_dict.get("longitude", 0)
            h_lat = round(raw_lat / 1e7, 7)
            h_lon = round(raw_lon / 1e7, 7)
            h_alt = round(msg_dict.get("altitude", 0) / 1000.0, 2)
            if -90.0 <= h_lat <= 90.0 and -180.0 <= h_lon <= 180.0 and (raw_lat != 0 or raw_lon != 0):
                self.latest_state.home.latitude = h_lat
                self.latest_state.home.longitude = h_lon
                self.latest_state.home.altitude_m = h_alt
                self.latest_state.home.is_set = True
                asyncio.create_task(self._persist_home_to_active_mission())

        elif msg_type == "MISSION_CURRENT":
            curr_seq = msg_dict.get("seq", 0)
            self.latest_state.mission_progress.current_waypoint = curr_seq
            self.latest_state.mission_progress.current_seq = curr_seq
            self.latest_state.mission_progress.next_waypoint = curr_seq + 1
            self.latest_state.mission_progress.completed_waypoints = max(0, curr_seq)
            total = self.latest_state.mission_progress.total_seq or self.latest_state.mission_progress.total_waypoints
            if total > 0:
                pct = min(100.0, round((curr_seq / total) * 100.0, 1))
                self.latest_state.mission_progress.progress_percent = pct
                self.latest_state.mission_progress.progress_pct = pct
            self.latest_state.mission_progress.mission_state = "ACTIVE"
            self.latest_state.mission_progress.is_active = True

        elif msg_type == "MISSION_ITEM_REACHED":
            reached_seq = msg_dict.get("seq", 0)
            self.latest_state.mission_progress.reached_seq = reached_seq
            self.latest_state.mission_progress.completed_waypoints = reached_seq + 1
            total = self.latest_state.mission_progress.total_seq or self.latest_state.mission_progress.total_waypoints
            if total > 0:
                pct = min(100.0, round(((reached_seq + 1) / total) * 100.0, 1))
                self.latest_state.mission_progress.progress_percent = pct
                self.latest_state.mission_progress.progress_pct = pct
            asyncio.create_task(self.record_event("WAYPOINT_REACHED", {"sequence": reached_seq}))

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
            hdg = msg_dict.get("heading")
            if hdg is not None and self.latest_state.gps.heading_deg is None:
                self.latest_state.gps.heading_deg = float(hdg)

        elif msg_type == "RECOVERED_TELEMETRY":
            # Merged values from simulator recovery dictionary
            if "latitude" in msg_dict and msg_dict["latitude"] is not None:
                lat = float(msg_dict["latitude"])
                lon = float(msg_dict["longitude"])
                alt = float(msg_dict.get("altitude_m", 0))
                self.latest_state.position.latitude = lat
                self.latest_state.position.longitude = lon
                self.latest_state.position.altitude_m = alt
                self.latest_state.gps.latitude = lat
                self.latest_state.gps.longitude = lon
                self.latest_state.gps.altitude_m = alt
                self.latest_state.gps.valid = True
                self.latest_state.gps.is_stale = False
                self.latest_state.gps.last_update_ms = recv_ms
                if not self.latest_state.gps.gps_fix:
                    self.latest_state.gps.gps_fix = True
                    self.latest_state.gps.fix_status = "3D_FIX"
            if "roll_deg" in msg_dict:
                self.latest_state.attitude.roll_deg = msg_dict["roll_deg"]
                self.latest_state.attitude.pitch_deg = msg_dict["pitch_deg"]
                self.latest_state.attitude.yaw_deg = msg_dict["yaw_deg"]
                if self.latest_state.gps.heading_deg is None:
                    self.latest_state.gps.heading_deg = msg_dict["yaw_deg"]
            if "battery" in msg_dict and isinstance(msg_dict["battery"], dict):
                self.latest_state.battery.percentage = msg_dict["battery"].get("percentage")

        # Establish Home position on first ARM if not already set
        if self.latest_state.flight.armed and not self.latest_state.home.is_set:
            if self.latest_state.gps.valid and self.latest_state.gps.latitude is not None:
                self.latest_state.home.latitude = self.latest_state.gps.latitude
                self.latest_state.home.longitude = self.latest_state.gps.longitude
                self.latest_state.home.altitude_m = self.latest_state.gps.altitude_m
                self.latest_state.home.is_set = True
                asyncio.create_task(self._persist_home_to_active_mission())

        # Navigation values derived from verified GPS & Home state
        hdg = self.latest_state.gps.heading_deg if self.latest_state.gps.heading_deg is not None else self.latest_state.attitude.yaw_deg
        self.latest_state.navigation.heading_deg = hdg
        self.latest_state.navigation.ground_speed_mps = self.latest_state.velocity.ground_speed_mps

        drone_lat = self.latest_state.gps.latitude or self.latest_state.position.latitude
        drone_lon = self.latest_state.gps.longitude or self.latest_state.position.longitude
        home_lat = self.latest_state.home.latitude
        home_lon = self.latest_state.home.longitude

        if (
            drone_lat is not None
            and drone_lon is not None
            and self.latest_state.home.is_set
            and home_lat is not None
            and home_lon is not None
        ):
            d_m, b_deg = calculate_distance_and_bearing(drone_lat, drone_lon, home_lat, home_lon)
            self.latest_state.navigation.distance_to_home_m = d_m
            self.latest_state.navigation.bearing_to_home_deg = b_deg
        else:
            self.latest_state.navigation.distance_to_home_m = None
            self.latest_state.navigation.bearing_to_home_deg = None

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

    async def _handle_mission_request(self, seq: int) -> None:
        """Handles MAVLink MISSION_REQUEST / MISSION_REQUEST_INT from autopilot."""
        if not self._pending_mission_wps or seq < 0 or seq >= len(self._pending_mission_wps):
            logger.warning(f"Received MISSION_REQUEST for out-of-range seq: {seq}")
            return

        wp = self._pending_mission_wps[seq]
        target_addr = self._last_sender_addr or (
            self.settings.drone_ip,
            14555 if self.settings.drone_ip in ("127.0.0.1", "localhost") else self.settings.telemetry_port,
        )

        cmd = mavlink2.MAV_CMD_NAV_WAYPOINT
        action = str(wp.get("action", wp.get("command", "WAYPOINT"))).upper()
        if "TAKEOFF" in action:
            cmd = mavlink2.MAV_CMD_NAV_TAKEOFF
        elif "LAND" in action:
            cmd = mavlink2.MAV_CMD_NAV_LAND
        elif "RTL" in action or "RTH" in action:
            cmd = mavlink2.MAV_CMD_NAV_RETURN_TO_LAUNCH
        elif "LOITER" in action or "HOLD" in action:
            cmd = mavlink2.MAV_CMD_NAV_LOITER_TIME

        item_msg = self.mav_parser.mav.mission_item_int_encode(
            target_system=1,
            target_component=1,
            seq=seq,
            frame=mavlink2.MAV_FRAME_GLOBAL_RELATIVE_ALT,
            command=cmd,
            current=1 if seq == 0 else 0,
            autocontinue=1,
            param1=float(wp.get("hold_time", 0.0)),
            param2=float(wp.get("acceptance_radius", 2.0)),
            param3=0.0,
            param4=0.0,
            x=int(float(wp.get("lat", wp.get("latitude", 0))) * 1e7),
            y=int(float(wp.get("lon", wp.get("longitude", 0))) * 1e7),
            z=float(wp.get("alt_m", wp.get("altitude", 25.0))),
            mission_type=mavlink2.MAV_MISSION_TYPE_MISSION,
        )
        await self.transport.send(item_msg.pack(self.mav_parser.mav), target_addr)
        logger.info(f"Dispatched MAVLink MISSION_ITEM_INT #{seq} to {target_addr}")
        await self.ws_manager.broadcast({
            "type": "MISSION_UPLOAD_STATUS",
            "status": "UPLOADING",
            "current_item": seq + 1,
            "total_items": len(self._pending_mission_wps),
            "progress_percent": round(((seq + 1) / len(self._pending_mission_wps)) * 100.0, 1),
        })

    async def _handle_mission_ack(self, ack_type: int) -> None:
        """Handles MAVLink MISSION_ACK from autopilot."""
        logger.info(f"Received MAVLink MISSION_ACK from vehicle: code={ack_type}")
        if self._upload_future and not self._upload_future.done():
            self._upload_future.set_result(ack_type)

    async def _handle_mission_count_download(self, count: int) -> None:
        """Handles MAVLink MISSION_COUNT received during mission download."""
        self._download_total = count
        self._downloaded_wps = []
        logger.info(f"Autopilot reports {count} waypoints onboard.")
        if count == 0:
            if self._download_future and not self._download_future.done():
                self._download_future.set_result([])
            return

        target_addr = self._last_sender_addr or (
            self.settings.drone_ip,
            14555 if self.settings.drone_ip in ("127.0.0.1", "localhost") else self.settings.telemetry_port,
        )
        req_msg = self.mav_parser.mav.mission_request_int_encode(
            target_system=1,
            target_component=1,
            seq=0,
            mission_type=mavlink2.MAV_MISSION_TYPE_MISSION,
        )
        await self.transport.send(req_msg.pack(self.mav_parser.mav), target_addr)

    async def _handle_mission_item_download(self, msg_dict: Dict[str, Any]) -> None:
        """Handles MAVLink MISSION_ITEM or MISSION_ITEM_INT during download."""
        seq = msg_dict.get("seq", 0)
        raw_x = msg_dict.get("x", 0)
        raw_y = msg_dict.get("y", 0)
        lat = raw_x / 1e7 if abs(raw_x) > 1000 else raw_x
        lon = raw_y / 1e7 if abs(raw_y) > 1000 else raw_y
        alt_m = float(msg_dict.get("z", 25.0))
        cmd = msg_dict.get("command", 16)
        action_map = {16: "WAYPOINT", 22: "TAKEOFF", 21: "LAND", 20: "RTL", 19: "LOITER"}
        action = action_map.get(cmd, "WAYPOINT")

        wp_item = {
            "id": seq + 1,
            "lat": round(lat, 7),
            "lon": round(lon, 7),
            "alt_m": round(alt_m, 1),
            "command": action,
            "action": action,
        }
        self._downloaded_wps.append(wp_item)

        target_addr = self._last_sender_addr or (
            self.settings.drone_ip,
            14555 if self.settings.drone_ip in ("127.0.0.1", "localhost") else self.settings.telemetry_port,
        )

        next_seq = seq + 1
        if next_seq < self._download_total:
            req_msg = self.mav_parser.mav.mission_request_int_encode(
                target_system=1,
                target_component=1,
                seq=next_seq,
                mission_type=mavlink2.MAV_MISSION_TYPE_MISSION,
            )
            await self.transport.send(req_msg.pack(self.mav_parser.mav), target_addr)
        else:
            ack_msg = self.mav_parser.mav.mission_ack_encode(
                target_system=1,
                target_component=1,
                type=mavlink2.MAV_MISSION_ACCEPTED,
                mission_type=mavlink2.MAV_MISSION_TYPE_MISSION,
            )
            await self.transport.send(ack_msg.pack(self.mav_parser.mav), target_addr)
            if self._download_future and not self._download_future.done():
                self._download_future.set_result(self._downloaded_wps)

    async def upload_mission_mavlink(
        self, waypoints: List[Dict[str, Any]], target_addr: Optional[Tuple[str, int]] = None
    ) -> Dict[str, Any]:
        """Dispatches an authentic MAVLink mission upload sequence to the autopilot."""
        if not waypoints:
            raise ValueError("Mission contains 0 waypoints")

        self._pending_mission_wps = waypoints
        self._upload_future = asyncio.get_event_loop().create_future()
        self._mission_upload_state = "UPLOADING"
        self.latest_state.mission_progress.total_seq = len(waypoints)

        target_addr = target_addr or self._last_sender_addr or (
            self.settings.drone_ip,
            14555 if self.settings.drone_ip in ("127.0.0.1", "localhost") else self.settings.telemetry_port,
        )
        self._last_sender_addr = target_addr

        await self.ws_manager.broadcast({
            "type": "MISSION_UPLOAD_STATUS",
            "status": "UPLOAD_STARTED",
            "message": f"Initiating MAVLink mission upload ({len(waypoints)} waypoints)...",
            "waypoint_count": len(waypoints),
        })

        # Send MISSION_COUNT
        count_msg = self.mav_parser.mav.mission_count_encode(
            target_system=1,
            target_component=1,
            count=len(waypoints),
            mission_type=mavlink2.MAV_MISSION_TYPE_MISSION,
        )
        await self.transport.send(count_msg.pack(self.mav_parser.mav), target_addr)
        logger.info(f"Dispatched MAVLink MISSION_COUNT ({len(waypoints)}) to {target_addr}")

        try:
            ack_code = await asyncio.wait_for(self._upload_future, timeout=5.0)
            if ack_code == mavlink2.MAV_MISSION_ACCEPTED:
                self._mission_upload_state = "UPLOADED"
                self.latest_state.mission_progress.mission_state = "LOADED"
                await self._persist_mission_upload_status("UPLOADED")
                await self.ws_manager.broadcast({
                    "type": "MISSION_UPLOAD_STATUS",
                    "status": "ACKNOWLEDGED",
                    "message": "Autopilot acknowledged mission upload successfully.",
                    "waypoint_count": len(waypoints),
                })
                await self.record_event("MISSION_UPLOAD_ACKNOWLEDGED", {"waypoint_count": len(waypoints)})
                return {"status": "ACKNOWLEDGED", "waypoint_count": len(waypoints), "message": "Mission uploaded and acknowledged by autopilot."}
            else:
                self._mission_upload_state = "FAILED"
                await self._persist_mission_upload_status("FAILED")
                await self.ws_manager.broadcast({
                    "type": "MISSION_UPLOAD_STATUS",
                    "status": "UPLOAD_FAILED",
                    "message": f"Autopilot rejected mission with ACK code: {ack_code}",
                })
                return {"status": "UPLOAD_FAILED", "ack_code": ack_code, "message": f"Autopilot rejected mission: {ack_code}"}
        except asyncio.TimeoutError:
            self._mission_upload_state = "FAILED"
            await self._persist_mission_upload_status("FAILED")
            await self.ws_manager.broadcast({
                "type": "MISSION_UPLOAD_STATUS",
                "status": "UPLOAD_FAILED",
                "message": "Mission upload timed out waiting for vehicle ACK.",
            })
            return {"status": "UPLOAD_FAILED", "error": "TIMEOUT", "message": "Upload timed out waiting for vehicle acknowledgement."}

    async def download_mission_mavlink(
        self, target_addr: Optional[Tuple[str, int]] = None
    ) -> List[Dict[str, Any]]:
        """Requests active mission from autopilot via MAVLink MISSION_REQUEST_LIST."""
        self._download_future = asyncio.get_event_loop().create_future()
        self._downloaded_wps = []
        self._download_total = 0

        target_addr = target_addr or self._last_sender_addr or (
            self.settings.drone_ip,
            14555 if self.settings.drone_ip in ("127.0.0.1", "localhost") else self.settings.telemetry_port,
        )
        self._last_sender_addr = target_addr

        req_list_msg = self.mav_parser.mav.mission_request_list_encode(
            target_system=1,
            target_component=1,
            mission_type=mavlink2.MAV_MISSION_TYPE_MISSION,
        )
        await self.transport.send(req_list_msg.pack(self.mav_parser.mav), target_addr)
        logger.info(f"Dispatched MAVLink MISSION_REQUEST_LIST to {target_addr}")

        try:
            wps = await asyncio.wait_for(self._download_future, timeout=5.0)
            return wps
        except asyncio.TimeoutError:
            logger.warning("Mission download timed out waiting for vehicle.")
            return []

    async def _persist_home_to_active_mission(self) -> None:
        """Stores confirmed home coordinates in SQLite for current mission."""
        if not self.latest_state.home.is_set or self.latest_state.home.latitude is None:
            return
        async with AsyncSessionLocal() as session:
            try:
                res = await session.execute(select(Mission).where(Mission.mission_id == self.mission_id))
                m = res.scalar_one_or_none()
                if m:
                    m.home_lat = self.latest_state.home.latitude
                    m.home_lon = self.latest_state.home.longitude
                    m.home_alt = self.latest_state.home.altitude_m
                    m.updated_at = current_time_ms()
                    await session.commit()
            except Exception as e:
                logger.error(f"Error persisting home position: {e}")

    async def _persist_mission_upload_status(self, status: str) -> None:
        """Stores mission upload status and timestamp in SQLite."""
        async with AsyncSessionLocal() as session:
            try:
                res = await session.execute(select(Mission).where(Mission.mission_id == self.mission_id))
                m = res.scalar_one_or_none()
                if m:
                    m.upload_status = status
                    m.updated_at = current_time_ms()
                    if status == "UPLOADED":
                        m.upload_acknowledged_at = current_time_ms()
                    await session.commit()
            except Exception as e:
                logger.error(f"Error persisting mission upload status: {e}")

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

                # GPS Staleness & Loss Evaluation (Section 25)
                now_ms = current_time_ms()
                last_gps_ms = self.latest_state.gps.last_update_ms
                if last_gps_ms:
                    gps_age_ms = now_ms - last_gps_ms
                    if gps_age_ms > self.settings.stale_threshold_stale_ms:
                        self.latest_state.gps.is_stale = True
                    if gps_age_ms > self.settings.disconnected_timeout_ms:
                        self.latest_state.gps.valid = False

                # If connection dropped or degraded, notify UI immediately
                if health.status in ("DEGRADED", "STALE", "DISCONNECTED"):
                    await self.ws_manager.broadcast({
                        "type": "HEALTH_UPDATE",
                        "mission_id": self.mission_id,
                        "data_health": health.model_dump(),
                    })

                # Check for unacknowledged command timeouts (> 5000ms pending without ACK)
                if now_ms - self._last_cmd_timeout_check_ms >= 1000:
                    self._last_cmd_timeout_check_ms = now_ms
                    try:
                        async with AsyncSessionLocal() as session:
                            timed_out_cmds = (await session.execute(
                                select(CommandLog)
                                .where(
                                    CommandLog.mission_id == self.mission_id,
                                    CommandLog.status == "SENT",
                                    CommandLog.timestamp < (now_ms - 5000),
                                )
                            )).scalars().all()

                            if timed_out_cmds:
                                for cmd in timed_out_cmds:
                                    cmd.status = "TIMEOUT"
                                    cmd.details = "No COMMAND_ACK received within 5000ms timeout"
                                    await self.ws_manager.broadcast({
                                        "type": "COMMAND_STATUS",
                                        "id": cmd.id,
                                        "command_name": cmd.command_name,
                                        "command_id": cmd.command_id,
                                        "status": "TIMEOUT",
                                        "timestamp": now_ms,
                                    })
                                await session.commit()
                    except Exception as e:
                        logger.debug(f"Error checking command timeouts: {e}")

            except asyncio.CancelledError:
                break
            except Exception as e:
                logger.error(f"Error in health monitor: {e}")

    async def _persistence_worker(self) -> None:
        """Asynchronous database batch persistence worker.
        Batches database inserts over a 100ms window (up to 60 packets) to drastically
        reduce SQLite transactions and eliminate disk thrashing.
        """
        while self._is_active:
            batch: List[Dict[str, Any]] = []
            try:
                # Get first item (blocking wait)
                item = await self.persistence_queue.get()
                if item is None:
                    break
                batch.append(item)

                # Collect incoming items over up to 100ms window to bundle transactions
                deadline = time.monotonic() + 0.10
                while len(batch) < 60:
                    remaining = deadline - time.monotonic()
                    if remaining <= 0:
                        break
                    try:
                        next_item = await asyncio.wait_for(self.persistence_queue.get(), timeout=remaining)
                        if next_item is None:
                            break
                        batch.append(next_item)
                    except (asyncio.TimeoutError, TimeoutError):
                        break

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
                            hdop=self.latest_state.gps.hdop,
                            vdop=self.latest_state.gps.vdop,
                            heading_deg=self.latest_state.navigation.heading_deg,
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
                        state_row.hdop = self.latest_state.gps.hdop
                        state_row.vdop = self.latest_state.gps.vdop
                        state_row.heading_deg = self.latest_state.navigation.heading_deg
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
