export type ConnectionStatus =
  | "LIVE"
  | "CONNECTED"
  | "DEGRADED"
  | "STALE"
  | "DISCONNECTED"
  | "RECONNECTING"
  | "RECONNECTED"
  | "CONNECTING"
  | "DISCONNECTING";

export interface PositionData {
  latitude: number | null;
  longitude: number | null;
  altitude_m: number | null;
  relative_altitude_m: number | null;
}

export interface AttitudeData {
  roll_deg: number | null;
  pitch_deg: number | null;
  yaw_deg: number | null;
}

export interface VelocityData {
  ground_speed_mps: number | null;
  vertical_speed_mps: number | null;
}

export interface BatteryData {
  percentage: number | null;
  voltage_v: number | null;
  current_a: number | null;
}

export interface GpsData {
  fix_type: number | null;
  satellites: number | null;
}

export interface FlightData {
  armed: boolean | null;
  mode: string | null;
}

export interface DataHealth {
  status: ConnectionStatus;
  latency_ms: number | null;
  transport_latency_ms: number | null;
  processing_latency_ms: number | null;
  packet_loss_percent: number;
  received_packets: number;
  missing_packets: number;
  recovered_packets: number;
  unrecovered_packets: number;
  duplicate_packets: number;
  out_of_order_packets: number;
  invalid_packets: number;
  jitter_ms: number | null;
  last_packet_age_ms: number | null;
}

export interface NormalizedTelemetry {
  drone_id: string;
  source_sequence: number | null;
  received_sequence: number;
  source_timestamp: number | null;
  received_at: number;
  processed_at: number;
  raw_message_type: string;
  position: PositionData;
  attitude: AttitudeData;
  velocity: VelocityData;
  battery: BatteryData;
  gps: GpsData;
  flight: FlightData;
  data_health: DataHealth;
}

export interface Mission {
  id: number;
  mission_id: string;
  drone_id: string;
  name: string;
  started_at: number;
  ended_at: number | null;
  status: "ACTIVE" | "COMPLETED" | "ABORTED";
  packet_count: number;
}

export interface TelemetryPacketItem {
  id: number;
  source_sequence: number | null;
  receive_sequence: number;
  message_type: string;
  source_timestamp: number | null;
  received_at: number;
  processed_at: number;
  is_duplicate: boolean;
  is_out_of_order: boolean;
  is_recovered: boolean;
  is_valid: boolean;
  payload: Record<string, any>;
}

export interface GapEvent {
  id: number;
  expected_sequence: number;
  detected_at: number;
  recovered_at: number | null;
  status: "MISSING" | "RECOVERING" | "RECOVERED" | "UNRECOVERED";
}

export interface NetworkConfig {
  gcs_ip: string;
  gcs_bind_host: string;
  drone_ip: string;
  subnet_mask: string;
  telemetry_transport: string;
  telemetry_port: number;
  websocket_host: string;
  websocket_port: number;
  operation_mode: string;
  drone_id: string;
  stale_threshold_degraded_ms: number;
  stale_threshold_stale_ms: number;
  disconnected_timeout_ms: number;
}

export interface Waypoint {
  id: number;
  lat: number;
  lon: number;
  alt_m: number;
  command?: string;
  action?: string;
}

export type CommandStatus = 'PENDING' | 'SENT' | 'ACKNOWLEDGED' | 'FAILED';

export interface CommandLogItem {
  id: number;
  mission_id: string;
  command_name: string;
  command_id: number;
  status: CommandStatus;
  timestamp: number;
  acknowledged_at?: number | null;
  details?: string | null;
}

export interface SystemEventItem {
  id: number;
  mission_id: string;
  event_type: string;
  timestamp: number;
  payload: Record<string, any>;
  created_at: number;
}

export type ReadinessState =
  | 'READY FOR FLIGHT'
  | 'PRE-FLIGHT CHECK REQUIRED'
  | 'NOT READY'
  | 'FAILSAFE ACTIVE'
  | 'MISSION ACTIVE'
  | 'MISSION COMPLETE';

export type CheckStatus = 'PASS' | 'WARNING' | 'FAIL' | 'UNKNOWN';

export interface PreFlightCheckItem {
  id: string;
  name: string;
  category: string;
  status: CheckStatus;
  value?: string;
  message: string;
}

export interface SensorStatusItem {
  name: string;
  type: 'IMU' | 'GNSS' | 'BAROMETER';
  status: 'OK' | 'WARNING' | 'ERROR' | 'NO DATA' | 'UNKNOWN';
  details: string;
}
