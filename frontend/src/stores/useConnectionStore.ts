import { create } from 'zustand';
import type { ConnectionStatus } from '../types/telemetry';

interface ConnectionStateStore {
  status: ConnectionStatus;
  isWsConnected: boolean;
  reconnectAttempt: number;
  lastMessageTime: number | null;
  setStatus: (status: ConnectionStatus) => void;
  setWsConnected: (connected: boolean) => void;
  incrementReconnect: () => void;
  resetReconnect: () => void;
  recordMessageReceived: () => void;
}

export const useConnectionStore = create<ConnectionStateStore>((set) => ({
  status: 'DISCONNECTED',
  isWsConnected: false,
  reconnectAttempt: 0,
  lastMessageTime: null,
  setStatus: (status) => set({ status }),
  setWsConnected: (connected) => set({ isWsConnected: connected }),
  incrementReconnect: () => set((state) => ({ reconnectAttempt: state.reconnectAttempt + 1 })),
  resetReconnect: () => set({ reconnectAttempt: 0 }),
  recordMessageReceived: () => set({ lastMessageTime: Date.now() }),
}));
