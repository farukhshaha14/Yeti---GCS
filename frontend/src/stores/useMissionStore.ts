import { create } from 'zustand';
import type { Mission, Waypoint, MissionProgressData } from '../types/telemetry';

interface MissionStateStore {
  activeMissionId: string;
  missions: Mission[];
  waypoints: Waypoint[];
  geofence: Array<{ lat: number; lon: number }>;
  noFlyZones: Array<Array<{ lat: number; lon: number }>>;
  flightTrail: Array<{ lat: number; lon: number }>;
  currentWaypointIndex: number;
  missionState: 'IDLE' | 'LOADED' | 'RUNNING' | 'COMPLETED' | 'ABORTED';
  homePosition: { lat: number; lon: number; alt_m: number } | null;
  isPlanningMode: boolean;
  hasUnsavedChanges: boolean;
  uploadStatus: 'NOT_UPLOADED' | 'UPLOADING' | 'UPLOAD_SUCCESSFUL' | 'UPLOAD_FAILED' | 'ACKNOWLEDGED';
  uploadMessage: string;
  missionProgress: MissionProgressData | null;
  setActiveMissionId: (id: string) => void;
  setMissions: (missions: Mission[]) => void;
  setWaypoints: (waypoints: Waypoint[]) => void;
  setGeofence: (geofence: Array<{ lat: number; lon: number }>) => void;
  setNoFlyZones: (noFlyZones: Array<Array<{ lat: number; lon: number }>>) => void;
  addBreadcrumb: (pt: { lat: number; lon: number }) => void;
  clearFlightTrail: () => void;
  setCurrentWaypointIndex: (idx: number) => void;
  setMissionState: (state: 'IDLE' | 'LOADED' | 'RUNNING' | 'COMPLETED' | 'ABORTED') => void;
  setHomePosition: (pos: { lat: number; lon: number; alt_m: number } | null) => void;
  setIsPlanningMode: (val: boolean) => void;
  setHasUnsavedChanges: (val: boolean) => void;
  setUploadStatus: (status: 'NOT_UPLOADED' | 'UPLOADING' | 'UPLOAD_SUCCESSFUL' | 'UPLOAD_FAILED' | 'ACKNOWLEDGED', message?: string) => void;
  setMissionProgress: (progress: MissionProgressData | null) => void;
  resetMissionRuntimeState: (newMissionId: string) => void;
}

export const useMissionStore = create<MissionStateStore>((set) => ({
  activeMissionId: 'MISSION-001',
  missions: [],
  waypoints: [],
  geofence: [],
  noFlyZones: [],
  flightTrail: [],
  currentWaypointIndex: 0,
  missionState: 'IDLE',
  homePosition: { lat: 19.876543, lon: 75.343210, alt_m: 0 },
  isPlanningMode: false,
  hasUnsavedChanges: false,
  uploadStatus: 'NOT_UPLOADED',
  uploadMessage: '',
  missionProgress: null,

  setActiveMissionId: (id) => set({ activeMissionId: id }),
  setMissions: (missions) => set({ missions }),
  setWaypoints: (waypoints) =>
    set({ waypoints, missionState: waypoints.length > 0 ? 'LOADED' : 'IDLE' }),
  setGeofence: (geofence) => set({ geofence }),
  setNoFlyZones: (noFlyZones) => set({ noFlyZones }),
  addBreadcrumb: (pt) =>
    set((state) => {
      const trail = state.flightTrail;
      const last = trail[trail.length - 1];
      if (!last || Math.abs(last.lat - pt.lat) > 0.00004 || Math.abs(last.lon - pt.lon) > 0.00004) {
        return { flightTrail: [...trail.slice(-300), pt] };
      }
      return state;
    }),
  clearFlightTrail: () => set({ flightTrail: [] }),
  setCurrentWaypointIndex: (currentWaypointIndex) => set({ currentWaypointIndex }),
  setMissionState: (missionState) => set({ missionState }),
  setHomePosition: (homePosition) => set({ homePosition }),
  setIsPlanningMode: (isPlanningMode) => set({ isPlanningMode }),
  setHasUnsavedChanges: (hasUnsavedChanges) => set({ hasUnsavedChanges }),
  setUploadStatus: (uploadStatus, uploadMessage = '') => set({ uploadStatus, uploadMessage }),
  setMissionProgress: (missionProgress) => set({ missionProgress }),

  resetMissionRuntimeState: (newMissionId: string) =>
    set({
      activeMissionId: newMissionId,
      waypoints: [],
      geofence: [],
      noFlyZones: [],
      flightTrail: [],
      currentWaypointIndex: 0,
      missionState: 'IDLE',
      isPlanningMode: false,
      hasUnsavedChanges: false,
      uploadStatus: 'NOT_UPLOADED',
      uploadMessage: '',
    }),
}));
