import { create } from 'zustand';
import type { NormalizedTelemetry } from '../types/telemetry';

const initialTelemetry: NormalizedTelemetry = {
  drone_id: 'VEGAPilot-01',
  source_sequence: null,
  received_sequence: 0,
  source_timestamp: null,
  received_at: 0,
  processed_at: 0,
  raw_message_type: 'NONE',
  position: {
    latitude: null,
    longitude: null,
    altitude_m: null,
    relative_altitude_m: null,
  },
  attitude: {
    roll_deg: null,
    pitch_deg: null,
    yaw_deg: null,
  },
  velocity: {
    ground_speed_mps: null,
    vertical_speed_mps: null,
  },
  battery: {
    percentage: null,
    voltage_v: null,
    current_a: null,
  },
  gps: {
    fix_type: null,
    satellites: null,
  },
  flight: {
    armed: null,
    mode: null,
  },
  data_health: {
    status: 'DISCONNECTED',
    latency_ms: null,
    transport_latency_ms: null,
    processing_latency_ms: null,
    packet_loss_percent: 0,
    received_packets: 0,
    missing_packets: 0,
    recovered_packets: 0,
    unrecovered_packets: 0,
    duplicate_packets: 0,
    out_of_order_packets: 0,
    invalid_packets: 0,
    jitter_ms: null,
    last_packet_age_ms: null,
  },
};

interface TelemetryStateStore {
  telemetry: NormalizedTelemetry;
  setTelemetry: (data: NormalizedTelemetry) => void;
  updateFromTick: (data: Partial<NormalizedTelemetry>) => void;
}

export const useTelemetryStore = create<TelemetryStateStore>((set) => ({
  telemetry: initialTelemetry,
  setTelemetry: (data) => set({ telemetry: data }),
  updateFromTick: (patch) =>
    set((state) => ({
      telemetry: {
        ...state.telemetry,
        ...patch,
        position: { ...state.telemetry.position, ...(patch.position || {}) },
        attitude: { ...state.telemetry.attitude, ...(patch.attitude || {}) },
        velocity: { ...state.telemetry.velocity, ...(patch.velocity || {}) },
        battery: { ...state.telemetry.battery, ...(patch.battery || {}) },
        gps: { ...state.telemetry.gps, ...(patch.gps || {}) },
        flight: { ...state.telemetry.flight, ...(patch.flight || {}) },
        data_health: { ...state.telemetry.data_health, ...(patch.data_health || {}) },
      },
    })),
}));
