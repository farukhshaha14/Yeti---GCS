"""SQLite database models for VEGAPilot GCS.
Authoritative local telemetry records, gaps, mission state, and connection audit logs.
"""
from datetime import datetime, timezone
from sqlalchemy import (
    Boolean,
    Column,
    Float,
    Index,
    Integer,
    BigInteger,
    String,
    Text,
)
from sqlalchemy.orm import declarative_base

Base = declarative_base()


def current_time_ms() -> int:
    return int(datetime.now(timezone.utc).timestamp() * 1000)


class Mission(Base):
    __tablename__ = "missions"

    id = Column(Integer, primary_key=True, autoincrement=True)
    mission_id = Column(String(64), unique=True, nullable=False, index=True)
    drone_id = Column(String(64), nullable=False, default="VEGAPilot-01")
    name = Column(String(128), nullable=False)
    started_at = Column(BigInteger, nullable=False, default=current_time_ms)
    ended_at = Column(BigInteger, nullable=True)
    status = Column(String(32), nullable=False, default="ACTIVE")  # ACTIVE, COMPLETED, ABORTED
    waypoints_json = Column(Text, nullable=True)
    created_at = Column(BigInteger, nullable=False, default=current_time_ms)


class TelemetryPacket(Base):
    __tablename__ = "telemetry_packets"

    id = Column(Integer, primary_key=True, autoincrement=True)
    mission_id = Column(String(64), nullable=False, index=True)
    drone_id = Column(String(64), nullable=False)
    source_sequence = Column(Integer, nullable=True, index=True)
    receive_sequence = Column(Integer, nullable=False)
    message_type = Column(String(64), nullable=False, index=True)
    source_timestamp = Column(BigInteger, nullable=True)
    received_at = Column(BigInteger, nullable=False, index=True)
    processed_at = Column(BigInteger, nullable=False)
    raw_message_type = Column(String(64), nullable=False)
    payload_json = Column(Text, nullable=False)
    is_duplicate = Column(Boolean, nullable=False, default=False)
    is_out_of_order = Column(Boolean, nullable=False, default=False)
    is_recovered = Column(Boolean, nullable=False, default=False)
    is_valid = Column(Boolean, nullable=False, default=True)

    __table_args__ = (
        Index("idx_mission_source_seq", "mission_id", "source_sequence"),
        Index("idx_mission_recv_at", "mission_id", "received_at"),
        Index("idx_mission_msg_type", "mission_id", "message_type"),
    )


class TelemetryState(Base):
    __tablename__ = "telemetry_state"

    id = Column(Integer, primary_key=True, autoincrement=True)
    mission_id = Column(String(64), nullable=False, unique=True, index=True)
    drone_id = Column(String(64), nullable=False)
    latitude = Column(Float, nullable=True)
    longitude = Column(Float, nullable=True)
    altitude_m = Column(Float, nullable=True)
    relative_altitude_m = Column(Float, nullable=True)
    roll_deg = Column(Float, nullable=True)
    pitch_deg = Column(Float, nullable=True)
    yaw_deg = Column(Float, nullable=True)
    ground_speed_mps = Column(Float, nullable=True)
    vertical_speed_mps = Column(Float, nullable=True)
    battery_percentage = Column(Float, nullable=True)
    battery_voltage_v = Column(Float, nullable=True)
    battery_current_a = Column(Float, nullable=True)
    gps_fix_type = Column(Integer, nullable=True)
    gps_satellites = Column(Integer, nullable=True)
    flight_armed = Column(Boolean, nullable=True)
    flight_mode = Column(String(32), nullable=True)
    last_source_sequence = Column(Integer, nullable=True)
    last_receive_sequence = Column(Integer, nullable=True)
    last_received_time = Column(BigInteger, nullable=True)
    connection_state = Column(String(32), nullable=False, default="DISCONNECTED")
    updated_at = Column(BigInteger, nullable=False, default=current_time_ms)


class TelemetryGap(Base):
    __tablename__ = "telemetry_gaps"

    id = Column(Integer, primary_key=True, autoincrement=True)
    mission_id = Column(String(64), nullable=False, index=True)
    expected_sequence = Column(Integer, nullable=False, index=True)
    detected_at = Column(BigInteger, nullable=False)
    recovered_at = Column(BigInteger, nullable=True)
    status = Column(String(32), nullable=False, default="MISSING")  # MISSING, RECOVERED, UNRECOVERED


class TelemetryEvent(Base):
    __tablename__ = "telemetry_events"

    id = Column(Integer, primary_key=True, autoincrement=True)
    mission_id = Column(String(64), nullable=False, index=True)
    event_type = Column(String(64), nullable=False)
    sequence = Column(Integer, nullable=True)
    timestamp = Column(BigInteger, nullable=False)
    payload = Column(Text, nullable=True)
    acknowledged = Column(Boolean, nullable=False, default=False)
    created_at = Column(BigInteger, nullable=False, default=current_time_ms)


class ConnectionEvent(Base):
    __tablename__ = "connection_events"

    id = Column(Integer, primary_key=True, autoincrement=True)
    mission_id = Column(String(64), nullable=False, index=True)
    event_type = Column(String(64), nullable=False)  # CONNECTED, DISCONNECTED, RECONNECTING, RECONNECTED
    timestamp = Column(BigInteger, nullable=False, default=current_time_ms)
    details = Column(Text, nullable=True)


class SystemLog(Base):
    __tablename__ = "system_logs"

    id = Column(Integer, primary_key=True, autoincrement=True)
    level = Column(String(16), nullable=False, default="INFO")
    component = Column(String(64), nullable=False)
    message = Column(Text, nullable=False)
    timestamp = Column(BigInteger, nullable=False, default=current_time_ms)


class CommandLog(Base):
    __tablename__ = "command_logs"

    id = Column(Integer, primary_key=True, autoincrement=True)
    mission_id = Column(String(64), nullable=False, index=True)
    command_name = Column(String(64), nullable=False)
    command_id = Column(Integer, nullable=False)
    status = Column(String(32), nullable=False, default="PENDING")  # PENDING, SENT, ACKNOWLEDGED, FAILED
    timestamp = Column(BigInteger, nullable=False, default=current_time_ms)
    acknowledged_at = Column(BigInteger, nullable=True)
    details = Column(Text, nullable=True)
