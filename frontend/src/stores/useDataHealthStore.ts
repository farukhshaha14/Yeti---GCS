import { create } from 'zustand';
import type { DataHealth } from '../types/telemetry';

interface DataHealthStateStore {
  health: DataHealth;
  setHealth: (health: DataHealth) => void;
  updateHealth: (patch: Partial<DataHealth>) => void;
}

export const useDataHealthStore = create<DataHealthStateStore>((set) => ({
  health: {
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
  setHealth: (health) => set({ health }),
  updateHealth: (patch) =>
    set((state) => ({
      health: { ...state.health, ...patch },
    })),
}));
