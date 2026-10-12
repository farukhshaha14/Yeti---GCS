import { create } from 'zustand';
import type { Mission, Waypoint } from '../types/telemetry';

interface MissionStateStore {
  activeMissionId: string;
  missions: Mission[];
  waypoints: Waypoint[];
  currentWaypointIndex: number;
  missionState: 'IDLE' | 'LOADED' | 'RUNNING' | 'COMPLETED' | 'ABORTED';
  homePosition: { lat: number; lon: number; alt_m: number } | null;
  setActiveMissionId: (id: string) => void;
  setMissions: (missions: Mission[]) => void;
  setWaypoints: (waypoints: Waypoint[]) => void;
  setCurrentWaypointIndex: (idx: number) => void;
  setMissionState: (state: 'IDLE' | 'LOADED' | 'RUNNING' | 'COMPLETED' | 'ABORTED') => void;
  setHomePosition: (pos: { lat: number; lon: number; alt_m: number } | null) => void;
}

export const useMissionStore = create<MissionStateStore>((set) => ({
  activeMissionId: 'MISSION-001',
  missions: [],
  waypoints: [
    { id: 1, lat: 19.876543, lon: 75.343210, alt_m: 15.0, command: 'TAKEOFF', action: 'TAKEOFF' },
    { id: 2, lat: 19.877800, lon: 75.344500, alt_m: 30.0, command: 'WAYPOINT', action: 'CRUISE' },
    { id: 3, lat: 19.879200, lon: 75.343800, alt_m: 35.0, command: 'WAYPOINT', action: 'CRUISE' },
    { id: 4, lat: 19.878100, lon: 75.342100, alt_m: 25.0, command: 'WAYPOINT', action: 'CRUISE' },
    { id: 5, lat: 19.876543, lon: 75.343210, alt_m: 0.0, command: 'RTL', action: 'LAND' },
  ],
  currentWaypointIndex: 1,
  missionState: 'LOADED',
  homePosition: { lat: 19.876543, lon: 75.343210, alt_m: 0 },
  setActiveMissionId: (id) => set({ activeMissionId: id }),
  setMissions: (missions) => set({ missions }),
  setWaypoints: (waypoints) => set({ waypoints, missionState: waypoints.length > 0 ? 'LOADED' : 'IDLE' }),
  setCurrentWaypointIndex: (currentWaypointIndex) => set({ currentWaypointIndex }),
  setMissionState: (missionState) => set({ missionState }),
  setHomePosition: (homePosition) => set({ homePosition }),
}));
