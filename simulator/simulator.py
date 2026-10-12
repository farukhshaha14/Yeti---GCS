"""VEGAPilot Telemetry Simulator.
Generates realistic physics and flight profiles (takeoff, climb, cruise, descent, landing),
packs real MAVLink v2 binary frames, listens for recovery requests, and simulates network anomalies.
"""
import asyncio
import json
import logging
import math
import random
import socket
import sys
import time
from typing import Dict, Optional, List, Tuple
from pymavlink.dialects.v20 import common as mavlink2

logging.basicConfig(level=logging.INFO, format="%(asctime)s [%(levelname)s] %(name)s: %(message)s")
logger = logging.getLogger("vegapilot.simulator")


class FlightState:
    """Simulates realistic quadrotor physics and trajectory."""

    def __init__(self, home_lat: float = 19.876543, home_lon: float = 75.343210) -> None:
        self.home_lat = home_lat
        self.home_lon = home_lon
        self.latitude = home_lat
        self.longitude = home_lon
        self.altitude_m = 0.0
        self.relative_altitude_m = 0.0
        self.roll_deg = 0.0
        self.pitch_deg = 0.0
        self.yaw_deg = 0.0
        self.ground_speed_mps = 0.0
        self.vertical_speed_mps = 0.0
        self.battery_pct = 100.0
        self.battery_voltage_v = 16.8  # 4S LiPo fully charged
        self.battery_current_a = 0.0
        self.armed = False
        self.flight_mode = "STABILIZE"
        self.phase = "PREFLIGHT"  # PREFLIGHT, TAKEOFF, CLIMB, CRUISE, DESCENT, LANDING, GROUND
        self.phase_time = 0.0
        self.heading_rad = 0.0

    def step(self, dt: float = 0.1) -> None:
        self.phase_time += dt

        # State machine for flight profile
        if self.phase == "PREFLIGHT":
            self.battery_current_a = 0.5
            if self.phase_time > 3.0:
                self.armed = True
                self.flight_mode = "AUTO"
                self.phase = "TAKEOFF"
                self.phase_time = 0.0

        elif self.phase == "TAKEOFF":
            self.battery_current_a = 18.0
            self.vertical_speed_mps = 2.5
            self.altitude_m += self.vertical_speed_mps * dt
            self.relative_altitude_m = self.altitude_m
            self.pitch_deg = -3.0
            if self.relative_altitude_m >= 15.0:
                self.phase = "CLIMB"
                self.phase_time = 0.0

        elif self.phase == "CLIMB":
            self.battery_current_a = 15.0
            self.vertical_speed_mps = 1.8
            self.ground_speed_mps = 4.0
            self.altitude_m += self.vertical_speed_mps * dt
            self.relative_altitude_m = self.altitude_m
            self.yaw_deg = (self.yaw_deg + 2.0 * dt) % 360.0
            if self.relative_altitude_m >= 35.0:
                self.phase = "CRUISE"
                self.phase_time = 0.0

        elif self.phase == "CRUISE":
            self.vertical_speed_mps = 0.1 * math.sin(self.phase_time)
            self.ground_speed_mps = 8.5 + 1.2 * math.sin(self.phase_time * 0.5)
            self.altitude_m += self.vertical_speed_mps * dt
            self.relative_altitude_m = self.altitude_m

            # Figure-8 / circle trajectory
            self.yaw_deg = (self.yaw_deg + 4.0 * dt) % 360.0
            self.roll_deg = 8.0 * math.sin(self.phase_time * 0.8)
            self.pitch_deg = -2.0 + 1.5 * math.cos(self.phase_time * 0.5)
            self.battery_current_a = 12.5 + 2.0 * math.sin(self.phase_time)

            # Move lat/lon
            rad = math.radians(self.yaw_deg)
            # 1 deg lat ~ 111,000m
            self.latitude += (self.ground_speed_mps * math.cos(rad) * dt) / 111000.0
            self.longitude += (self.ground_speed_mps * math.sin(rad) * dt) / (111000.0 * math.cos(math.radians(self.latitude)))

            if self.phase_time > 40.0:
                self.phase = "DESCENT"
                self.phase_time = 0.0

        elif self.phase == "DESCENT":
            self.battery_current_a = 10.0
            self.vertical_speed_mps = -2.0
            self.ground_speed_mps = 3.0
            self.altitude_m = max(2.0, self.altitude_m + self.vertical_speed_mps * dt)
            self.relative_altitude_m = self.altitude_m
            self.roll_deg = 2.0 * math.sin(self.phase_time)
            if self.relative_altitude_m <= 2.5:
                self.phase = "LANDING"
                self.phase_time = 0.0

        elif self.phase == "LANDING":
            self.battery_current_a = 8.0
            self.vertical_speed_mps = -0.5
            self.ground_speed_mps = 0.5
            self.altitude_m = max(0.0, self.altitude_m + self.vertical_speed_mps * dt)
            self.relative_altitude_m = self.altitude_m
            if self.relative_altitude_m <= 0.05:
                self.altitude_m = 0.0
                self.relative_altitude_m = 0.0
                self.armed = False
                self.flight_mode = "STABILIZE"
                self.phase = "GROUND"
                self.phase_time = 0.0

        # Battery drain simulation
        drain_pct = (self.battery_current_a * (dt / 3600.0) / 4.5) * 100.0  # 4.5Ah battery
        self.battery_pct = max(5.0, self.battery_pct - drain_pct)
        # Voltage curve 16.8V down to 13.6V
        self.battery_voltage_v = 13.6 + (self.battery_pct / 100.0) * 3.2


class TelemetrySimulator:
    """Transmits realistic MAVLink streams over UDP and handles retransmission requests."""

    def __init__(
        self,
        target_host: str = "127.0.0.1",
        target_port: int = 14550,
        listen_port: int = 14555,
        drone_id: str = "VEGAPilot-01",
    ) -> None:
        self.target_host = target_host
        self.target_port = target_port
        self.listen_port = listen_port
        self.drone_id = drone_id

        self.mav = mavlink2.MAVLink(None)
        self.flight = FlightState()
        self.sequence_number: int = 0
        self.is_running: bool = False

        # Fault Injection Flags
        self.packet_loss_rate: float = 0.0  # 0.0 to 1.0
        self.injected_gap_sequence: Optional[int] = None
        self.injected_duplicate_sequence: Optional[int] = None
        self.injected_out_of_order_sequence: Optional[int] = None
        self.is_disconnected: bool = False
        self.corrupt_next_packet: bool = False
        self.injected_latency_ms: float = 0.0

        # Packet Cache for Retransmission: seq -> packet_bytes
        self.packet_cache: Dict[int, bytes] = {}
        self.packet_metadata_cache: Dict[int, Dict] = {}

        # Sockets
        self.sock: Optional[socket.socket] = None
        self.recv_sock: Optional[socket.socket] = None

    def start(self) -> None:
        self.is_running = True
        self.sock = socket.socket(socket.AF_INET, socket.SOCK_DGRAM)
        self.recv_sock = socket.socket(socket.AF_INET, socket.SOCK_DGRAM)
        try:
            self.recv_sock.bind(("0.0.0.0", self.listen_port))
            self.recv_sock.setblocking(False)
            logger.info(f"Simulator recovery listener active on port {self.listen_port}")
        except Exception as e:
            logger.warning(f"Could not bind recovery listen port {self.listen_port}: {e}")

    def stop(self) -> None:
        self.is_running = False
        if self.sock:
            self.sock.close()
        if self.recv_sock:
            self.recv_sock.close()
        logger.info("Simulator stopped.")

    def inject_gap(self, sequence_to_drop: int) -> None:
        """Configures simulator to drop a specific sequence number."""
        self.injected_gap_sequence = sequence_to_drop
        logger.info(f"[FAULT INJECTION] Configured to DROP sequence #{sequence_to_drop}")

    def inject_duplicate(self, sequence_to_duplicate: int) -> None:
        self.injected_duplicate_sequence = sequence_to_duplicate

    def inject_out_of_order(self, sequence_to_delay: int) -> None:
        self.injected_out_of_order_sequence = sequence_to_delay

    def set_loss_rate(self, rate: float) -> None:
        self.packet_loss_rate = max(0.0, min(1.0, rate))
        logger.info(f"[FAULT INJECTION] Packet loss rate set to {self.packet_loss_rate * 100}%")

    def set_disconnected(self, disconnected: bool) -> None:
        self.is_disconnected = disconnected
        logger.info(f"[FAULT INJECTION] Telemetry connection state: {'DISCONNECTED' if disconnected else 'RECONNECTED'}")

    def check_incoming_recovery_requests(self) -> None:
        """Polls for RECOVERY_REQUEST messages and MAVLink COMMAND_LONG frames from GCS."""
        if not self.recv_sock:
            return
        try:
            while True:
                data, addr = self.recv_sock.recvfrom(4096)
                if not data:
                    break

                # 1. Check for JSON Recovery Request frame
                if data.strip().startswith(b"{") and data.strip().endswith(b"}"):
                    try:
                        msg = json.loads(data.decode("utf-8"))
                        if msg.get("type") == "RECOVERY_REQUEST":
                            missing = msg.get("missing", [])
                            logger.info(f"[RECOVERY REQUEST RECEIVED] From GCS {addr} for sequences: {missing}")
                            for seq in missing:
                                self._retransmit_packet(seq, addr)
                    except Exception as e:
                        logger.debug(f"Error handling recovery request: {e}")
                    continue

                # 2. Check for binary MAVLink frames (e.g. COMMAND_LONG from GCS)
                try:
                    parsed_msgs = self.mav.parse_buffer(data)
                    if parsed_msgs:
                        for p_msg in parsed_msgs:
                            if hasattr(p_msg, "get_type") and p_msg.get_type() == "COMMAND_LONG":
                                cmd = getattr(p_msg, "command", 0)
                                p1 = getattr(p_msg, "param1", 0.0)
                                logger.info(f"[SIMULATOR] Received MAVLink COMMAND_LONG: {cmd} (param1={p1}) from {addr}")

                                if cmd == mavlink2.MAV_CMD_COMPONENT_ARM_DISARM:
                                    if int(p1) == 1:
                                        self.flight.armed = True
                                        self.flight.flight_mode = "AUTO"
                                        self.flight.phase = "TAKEOFF"
                                        logger.info("[SIMULATOR] Vehicle ARMED via MAVLink command")
                                    else:
                                        self.flight.armed = False
                                        self.flight.flight_mode = "STABILIZE"
                                        self.flight.phase = "GROUND"
                                        logger.info("[SIMULATOR] Vehicle DISARMED via MAVLink command")

                                elif cmd == mavlink2.MAV_CMD_NAV_RETURN_TO_LAUNCH:
                                    self.flight.flight_mode = "RTL"
                                    self.flight.phase = "DESCENT"
                                    logger.info("[SIMULATOR] Flight mode set to RTL via MAVLink command")

                                elif cmd == mavlink2.MAV_CMD_NAV_LAND:
                                    self.flight.flight_mode = "LAND"
                                    self.flight.phase = "LANDING"
                                    logger.info("[SIMULATOR] Flight mode set to LAND via MAVLink command")

                                elif cmd == mavlink2.MAV_CMD_MISSION_START:
                                    self.flight.armed = True
                                    self.flight.flight_mode = "AUTO"
                                    self.flight.phase = "CLIMB"
                                    logger.info("[SIMULATOR] Mission START initiated via MAVLink command")

                                # Transmit genuine MAVLink COMMAND_ACK frame back to GCS
                                ack_msg = self.mav.command_ack_encode(
                                    command=cmd,
                                    result=mavlink2.MAV_RESULT_ACCEPTED,
                                )
                                self.sock.sendto(ack_msg.pack(self.mav), (self.target_host, self.target_port))
                                logger.info(f"[SIMULATOR] Transmitted MAVLink COMMAND_ACK for command {cmd} to {self.target_host}:{self.target_port}")
                except Exception as e:
                    logger.debug(f"Error parsing incoming MAVLink frame in simulator: {e}")
        except (BlockingIOError, socket.error):
            pass

    def _retransmit_packet(self, seq: int, target_addr: Tuple[str, int]) -> None:
        """Retransmits cached packet or recovery response."""
        now_ms = int(time.time() * 1000)
        if seq in self.packet_cache:
            raw_pkt = self.packet_cache[seq]
            # Send cached MAVLink packet
            self.sock.sendto(raw_pkt, (self.target_host, self.target_port))
            logger.info(f"[RETRANSMISSION] Retransmitted cached MAVLink packet #{seq} to {self.target_host}:{self.target_port}")
        else:
            # Fallback to recovery response JSON frame
            meta = self.packet_metadata_cache.get(seq, {
                "latitude": self.flight.latitude,
                "longitude": self.flight.longitude,
                "altitude_m": self.flight.altitude_m,
                "roll_deg": self.flight.roll_deg,
                "pitch_deg": self.flight.pitch_deg,
                "yaw_deg": self.flight.yaw_deg,
                "battery": {"percentage": self.flight.battery_pct},
            })
            resp = {
                "type": "RECOVERY_RESPONSE",
                "sequence": seq,
                "source_timestamp": now_ms,
                "payload": meta,
            }
            raw = json.dumps(resp).encode("utf-8")
            self.sock.sendto(raw, (self.target_host, self.target_port))
            logger.info(f"[RETRANSMISSION] Sent application recovery response for sequence #{seq}")

    def generate_and_send_frame(self, dt: float = 0.1) -> Optional[int]:
        """Steps physics, generates MAVLink packets, and transmits according to fault injection settings."""
        self.check_incoming_recovery_requests()

        if self.is_disconnected:
            return None

        self.flight.step(dt)
        self.sequence_number += 1
        seq = self.sequence_number
        self.mav.seq = (seq % 256)
        now_ms = int(time.time() * 1000)

        # Build MAVLink Messages
        # 1. ATTITUDE
        roll_rad = math.radians(self.flight.roll_deg)
        pitch_rad = math.radians(self.flight.pitch_deg)
        yaw_rad = math.radians(self.flight.yaw_deg)
        msg_att = self.mav.attitude_encode(
            time_boot_ms=now_ms % 100000000,
            roll=roll_rad,
            pitch=pitch_rad,
            yaw=yaw_rad,
            rollspeed=0.0,
            pitchspeed=0.0,
            yawspeed=0.0,
        )
        msg_att.source_sequence = seq

        # 2. GLOBAL_POSITION_INT
        lat_int = int(self.flight.latitude * 1e7)
        lon_int = int(self.flight.longitude * 1e7)
        alt_int = int(self.flight.altitude_m * 1000.0)
        rel_alt_int = int(self.flight.relative_altitude_m * 1000.0)
        vx = int(self.flight.ground_speed_mps * math.cos(yaw_rad) * 100.0)
        vy = int(self.flight.ground_speed_mps * math.sin(yaw_rad) * 100.0)
        vz = int(-self.flight.vertical_speed_mps * 100.0)
        msg_pos = self.mav.global_position_int_encode(
            time_boot_ms=now_ms % 100000000,
            lat=lat_int,
            lon=lon_int,
            alt=alt_int,
            relative_alt=rel_alt_int,
            vx=vx,
            vy=vy,
            vz=vz,
            hdg=int(self.flight.yaw_deg * 100.0),
        )
        msg_pos.source_sequence = seq

        # 3. HEARTBEAT
        base_mode = mavlink2.MAV_MODE_FLAG_CUSTOM_MODE_ENABLED
        if self.flight.armed:
            base_mode |= mavlink2.MAV_MODE_FLAG_SAFETY_ARMED
        custom_mode = 3 if self.flight.flight_mode == "AUTO" else 0
        msg_hb = self.mav.heartbeat_encode(
            type=mavlink2.MAV_TYPE_QUADROTOR,
            autopilot=mavlink2.MAV_AUTOPILOT_GENERIC,
            base_mode=base_mode,
            custom_mode=custom_mode,
            system_status=mavlink2.MAV_STATE_ACTIVE if self.flight.armed else mavlink2.MAV_STATE_STANDBY,
        )
        msg_hb.source_sequence = seq

        # 4. SYS_STATUS
        msg_sys = self.mav.sys_status_encode(
            onboard_control_sensors_present=0,
            onboard_control_sensors_enabled=0,
            onboard_control_sensors_health=0,
            load=250,
            voltage_battery=int(self.flight.battery_voltage_v * 1000.0),
            current_battery=int(self.flight.battery_current_a * 100.0),
            battery_remaining=int(self.flight.battery_pct),
            drop_rate_comm=0,
            errors_comm=0,
            errors_count1=0,
            errors_count2=0,
            errors_count3=0,
            errors_count4=0,
        )
        msg_sys.source_sequence = seq

        # Pack into combined datagram
        packed_bytes = (
            msg_hb.pack(self.mav)
            + msg_att.pack(self.mav)
            + msg_pos.pack(self.mav)
            + msg_sys.pack(self.mav)
        )

        # Cache for retransmission
        self.packet_cache[seq] = packed_bytes
        self.packet_metadata_cache[seq] = {
            "latitude": self.flight.latitude,
            "longitude": self.flight.longitude,
            "altitude_m": self.flight.altitude_m,
            "roll_deg": self.flight.roll_deg,
            "pitch_deg": self.flight.pitch_deg,
            "yaw_deg": self.flight.yaw_deg,
            "battery": {"percentage": self.flight.battery_pct},
        }
        # Keep cache bounded to 1000 items
        if len(self.packet_cache) > 1000:
            oldest = min(self.packet_cache.keys())
            del self.packet_cache[oldest]
            if oldest in self.packet_metadata_cache:
                del self.packet_metadata_cache[oldest]

        # Check Fault Injections

        # A. Specific Gap Drop
        if self.injected_gap_sequence is not None and seq == self.injected_gap_sequence:
            logger.warning(f"[FAULT INJECTION] Dropping packet #{seq} to create gap!")
            self.injected_gap_sequence = None
            return seq

        # B. Random Packet Loss
        if self.packet_loss_rate > 0.0 and random.random() < self.packet_loss_rate:
            logger.warning(f"[FAULT INJECTION] Randomly dropped packet #{seq} (loss rate: {self.packet_loss_rate})")
            return seq

        # C. Corrupted Bytes
        if self.corrupt_next_packet:
            self.corrupt_next_packet = False
            corrupted = bytearray(packed_bytes)
            corrupted[3] ^= 0xFF
            corrupted[7] ^= 0xAA
            self.sock.sendto(bytes(corrupted), (self.target_host, self.target_port))
            logger.warning(f"[FAULT INJECTION] Sent corrupted packet #{seq}")
            return seq

        # D. Duplicate Packet
        if self.injected_duplicate_sequence is not None and seq == self.injected_duplicate_sequence:
            self.injected_duplicate_sequence = None
            self.sock.sendto(packed_bytes, (self.target_host, self.target_port))
            # Send duplicate copy
            self.sock.sendto(packed_bytes, (self.target_host, self.target_port))
            logger.warning(f"[FAULT INJECTION] Sent duplicate copies of packet #{seq}")
            return seq

        # Normal Send
        self.sock.sendto(packed_bytes, (self.target_host, self.target_port))
        return seq


async def run_simulator_loop(
    sim: TelemetrySimulator,
    duration_sec: Optional[float] = None,
    rate_hz: float = 10.0,
) -> None:
    dt = 1.0 / rate_hz
    start_time = time.time()
    sim.start()
    try:
        while sim.is_running:
            sim.generate_and_send_frame(dt)
            await asyncio.sleep(dt)
            if duration_sec and (time.time() - start_time) >= duration_sec:
                break
    finally:
        sim.stop()


if __name__ == "__main__":
    host = sys.argv[1] if len(sys.argv) > 1 else "127.0.0.1"
    port = int(sys.argv[2]) if len(sys.argv) > 2 else 14550
    simulator = TelemetrySimulator(target_host=host, target_port=port)
    logger.info(f"Starting VEGAPilot Telemetry Simulator streaming to {host}:{port} at 10Hz...")
    try:
        asyncio.run(run_simulator_loop(simulator))
    except KeyboardInterrupt:
        logger.info("Simulator terminated by user.")
