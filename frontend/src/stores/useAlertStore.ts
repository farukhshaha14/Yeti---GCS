import { create } from 'zustand';

export interface AlertItem {
  id: string;
  type: 'GAP' | 'RECOVERY' | 'WARNING' | 'ERROR' | 'INFO';
  title: string;
  message: string;
  timestamp: number;
}

interface AlertStateStore {
  alerts: AlertItem[];
  addAlert: (alert: Omit<AlertItem, 'id' | 'timestamp'>) => void;
  removeAlert: (id: string) => void;
  clearAlerts: () => void;
}

export const useAlertStore = create<AlertStateStore>((set) => ({
  alerts: [],
  addAlert: (alert) => {
    const item: AlertItem = {
      ...alert,
      id: Math.random().toString(36).substring(2, 9),
      timestamp: Date.now(),
    };
    set((state) => ({
      alerts: [item, ...state.alerts].slice(0, 8), // Keep latest 8 alerts
    }));
  },
  removeAlert: (id) =>
    set((state) => ({
      alerts: state.alerts.filter((a) => a.id !== id),
    })),
  clearAlerts: () => set({ alerts: [] }),
}));
