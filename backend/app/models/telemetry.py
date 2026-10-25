"""Pydantic models representing normalized telemetry and data health."""
from typing import Optional, Literal
from pydantic import BaseModel, Field


class PositionData(BaseModel):
    latitude: Optional[float] = None
    longitude: Optional[float] = None
    altitude_m: Optional[float] = None
    relative_altitude_m: Optional[float] = None


class AttitudeData(BaseModel):
    roll_deg: Optional[float] = None
    pitch_deg: Optional[float] = None
    yaw_deg: Optional[float] = None


class VelocityData(BaseModel):
    ground_speed_mps: Optional[float] = None
    vertical_speed_mps: Optional[float] = None


class BatteryData(BaseModel):
    percentage: Optional[float] = None
    voltage_v: Optional[float] = None
    current_a: Optional[float] = None


class GpsData(BaseModel):
    latitude: Optional[float] = None
    longitude: Optional[float] = None
    altitude_m: Optional[float] = None
    relative_altitude_m: Optional[float] = None
    heading_deg: Optional[float] = None
    gps_fix: bool = False
    fix_status: str = "NO_FIX"  # NO_FIX, 2D_FIX, 3D_FIX, DGPS, RTK_FLOAT, RTK_FIXED
    fix_type: Optional[int] = None
    satellites: Optional[int] = None
    hdop: Optional[float] = None
    vdop: Optional[float] = None
    timestamp: Optional[int] = None
    valid: bool = False
    last_update_ms: Optional[int] = None
    is_stale: bool = True


class NavigationData(BaseModel):
    heading_deg: Optional[float] = None
    ground_speed_mps: Optional[float] = None
    distance_to_home_m: Optional[float] = None
    bearing_to_home_deg: Optional[float] = None


class HomePositionData(BaseModel):
    latitude: Optional[float] = None
    longitude: Optional[float] = None
    altitude_m: Optional[float] = None
    is_set: bool = False


class MissionProgressData(BaseModel):
    current_waypoint: Optional[int] = None
    next_waypoint: Optional[int] = None
    completed_waypoints: int = 0
    total_waypoints: int = 0
    progress_percent: float = 0.0
    mission_state: str = "IDLE"  # IDLE, LOADED, UPLOADING, ACTIVE, PAUSED, COMPLETED
    current_seq: Optional[int] = None
    total_seq: Optional[int] = None
    reached_seq: Optional[int] = None
    is_active: bool = False
    progress_pct: float = 0.0


class FlightData(BaseModel):
    armed: Optional[bool] = None
    mode: Optional[str] = None


class DataHealth(BaseModel):
    status: Literal["LIVE", "DEGRADED", "STALE", "DISCONNECTED", "RECONNECTING", "CONNECTED"] = "DISCONNECTED"
    latency_ms: Optional[float] = None
    transport_latency_ms: Optional[float] = None
    processing_latency_ms: Optional[float] = None
    packet_loss_percent: float = 0.0
    received_packets: int = 0
    missing_packets: int = 0
    recovered_packets: int = 0
    unrecovered_packets: int = 0
    duplicate_packets: int = 0
    out_of_order_packets: int = 0
    invalid_packets: int = 0
    jitter_ms: Optional[float] = None
    last_packet_age_ms: Optional[int] = None


class NormalizedTelemetry(BaseModel):
    drone_id: str = "VEGAPilot-01"
    source_sequence: Optional[int] = None
    received_sequence: int = 0
    source_timestamp: Optional[int] = None
    received_at: int
    processed_at: int
    raw_message_type: str = "UNKNOWN"

    position: PositionData = Field(default_factory=PositionData)
    attitude: AttitudeData = Field(default_factory=AttitudeData)
    velocity: VelocityData = Field(default_factory=VelocityData)
    battery: BatteryData = Field(default_factory=BatteryData)
    gps: GpsData = Field(default_factory=GpsData)
    navigation: NavigationData = Field(default_factory=NavigationData)
    flight: FlightData = Field(default_factory=FlightData)
    home: HomePositionData = Field(default_factory=HomePositionData)
    mission_progress: MissionProgressData = Field(default_factory=MissionProgressData)
    data_health: DataHealth = Field(default_factory=DataHealth)


class RecoveryRequest(BaseModel):
    mission_id: str
    missing_sequences: list[int]
    timestamp: int


class RecoveryResponse(BaseModel):
    mission_id: str
    sequence: int
    recovered: bool
    payload_raw: Optional[str] = None
