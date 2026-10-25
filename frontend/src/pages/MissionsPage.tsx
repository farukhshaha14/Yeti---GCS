import React, { useEffect, useRef, useState, useMemo } from 'react';
import {
  Plus,
  Download,
  StopCircle,
  Database,
  MapPin,
  FileText,
  Trash2,
  Compass,
  CheckCircle2,
  FolderOpen,
  X,
  Crosshair,
  AlertTriangle,
  Send,
  RefreshCw,
  ArrowUp,
  ArrowDown,
  ShieldCheck,
  ShieldAlert,
} from 'lucide-react';
import type { Mission, Waypoint, CompetitionTemplate, MissionValidationResult } from '../types/telemetry';
import {
  fetchMissions,
  createMission,
  stopMission,
  fetchWaypoints,
  uploadMissionFile,
  fetchCompetitionTemplates,
  loadCompetitionTemplate,
  sendCommand,
  updateMission,
  validateMission,
  uploadMissionMavlink,
  downloadMissionMavlink,
  fetchMissionDetails,
} from '../services/apiService';
import { useMissionStore } from '../stores/useMissionStore';
import { useTelemetryStore } from '../stores/useTelemetryStore';
import { useAlertStore } from '../stores/useAlertStore';
import { useConnectionStore } from '../stores/useConnectionStore';
import { GcsGpsMap } from '../components/GcsGpsMap';
import { GcsGpsStatusPanel } from '../components/GcsGpsStatusPanel';

export const MissionsPage: React.FC = () => {
  const [missions, setMissions] = useState<Mission[]>([]);
  const [loading, setLoading] = useState(true);
  const [newMissionName, setNewMissionName] = useState('');
  const [isCreating, setIsCreating] = useState(false);

  const {
    activeMissionId,
    waypoints,
    homePosition,
    isPlanningMode,
    hasUnsavedChanges,
    uploadStatus,
    uploadMessage,
    missionProgress,
    currentWaypointIndex,
    setWaypoints,
    setHomePosition,
    setGeofence,
    setNoFlyZones,
    setIsPlanningMode,
    setHasUnsavedChanges,
    setUploadStatus,
    resetMissionRuntimeState,
    setActiveMissionId,
  } = useMissionStore();

  const { telemetry } = useTelemetryStore();
  const { isWsConnected, status: connectionStatus } = useConnectionStore();
  const { addAlert } = useAlertStore();

  // Working copy of waypoints for draft editing
  const [localWps, setLocalWps] = useState<Waypoint[]>([]);
  const [initialWpsJson, setInitialWpsJson] = useState<string>('[]');

  // Manual Waypoint Input Form
  const [newWpLat, setNewWpLat] = useState('19.877500');
  const [newWpLon, setNewWpLon] = useState('75.344000');
  const [newWpAlt, setNewWpAlt] = useState('30.0');
  const [newWpAction, setNewWpAction] = useState('CRUISE');

  // Operation States
  const [isSaving, setIsSaving] = useState(false);
  const [isValidating, setIsValidating] = useState(false);
  const [isUploadingMavlink, setIsUploadingMavlink] = useState(false);
  const [isDownloadingMavlink, setIsDownloadingMavlink] = useState(false);
  const [validationResult, setValidationResult] = useState<MissionValidationResult | null>(null);
  const [showValidationModal, setShowValidationModal] = useState(false);

  // Unsaved Changes Modal
  const [showUnsavedModal, setShowUnsavedModal] = useState(false);
  const [pendingModeSwitch, setPendingModeSwitch] = useState<boolean | null>(null);

  // File Upload Ref
  const fileInputRef = useRef<HTMLInputElement | null>(null);
  const [isParsingFile, setIsParsingFile] = useState(false);

  // Competition Template Modal State
  const [isTemplateModalOpen, setIsTemplateModalOpen] = useState(false);
  const [templates, setTemplates] = useState<CompetitionTemplate[]>([]);
  const [loadingTemplates, setLoadingTemplates] = useState(false);

  // Review Mission Modal State
  const [reviewMission, setReviewMission] = useState<Mission | null>(null);

  // Load Mission History & Waypoints on Mount
  const loadMissions = async () => {
    try {
      setLoading(true);
      const data = await fetchMissions();
      setMissions(data);
    } catch (e) {
      console.error(e);
    } finally {
      setLoading(false);
    }
  };

  const loadMissionData = async (mId: string) => {
    try {
      const details = await fetchMissionDetails(mId);
      if (details.waypoints) {
        setWaypoints(details.waypoints);
        setLocalWps(details.waypoints);
        setInitialWpsJson(JSON.stringify(details.waypoints));
      }
      if (details.home && details.home.latitude && details.home.longitude) {
        setHomePosition({
          lat: details.home.latitude,
          lon: details.home.longitude,
          alt_m: details.home.altitude ?? 0,
        });
      }
      if (details.upload_status) {
        setUploadStatus(details.upload_status as any);
      }
    } catch (e) {
      // Fallback to generic waypoints endpoint
      try {
        const res = await fetchWaypoints();
        if (res.waypoints && res.waypoints.length > 0) {
          setWaypoints(res.waypoints);
          setLocalWps(res.waypoints);
          setInitialWpsJson(JSON.stringify(res.waypoints));
        }
      } catch (err) {
        console.error(err);
      }
    }
  };

  useEffect(() => {
    loadMissions();
    loadMissionData(activeMissionId);
  }, [activeMissionId]);

  // Keep local working copy synced if store updates externally while not dirty
  useEffect(() => {
    if (!hasUnsavedChanges) {
      setLocalWps(waypoints);
      setInitialWpsJson(JSON.stringify(waypoints));
    }
  }, [waypoints, hasUnsavedChanges]);

  // Track unsaved changes
  const checkDirty = (updated: Waypoint[]) => {
    const isDirty = JSON.stringify(updated) !== initialWpsJson;
    setHasUnsavedChanges(isDirty);
  };

  // 1. Create Fresh Mission and Switch to Planning Mode
  const handleCreateMission = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!newMissionName.trim()) return;
    try {
      setIsCreating(true);
      const res = await createMission(newMissionName.trim());
      resetMissionRuntimeState(res.mission_id);
      setLocalWps([]);
      setInitialWpsJson('[]');
      setNewMissionName('');
      setIsPlanningMode(true);
      setValidationResult(null);

      await loadMissions();
      addAlert({
        type: 'INFO',
        title: 'MISSION INITIALIZED',
        message: `Mission ${res.mission_id} created. Mission Planning Mode activated. Click map to place waypoints.`,
      });
    } catch (err: any) {
      addAlert({
        type: 'WARNING',
        title: 'CREATION FAILED',
        message: err.message || 'Failed to create mission',
      });
    } finally {
      setIsCreating(false);
    }
  };

  // 2. Click-to-Create Waypoint on Map
  const handleMapClickAddWaypoint = ({ lat, lon }: { lat: number; lon: number }) => {
    if (!isPlanningMode) return;
    const nextSeq = localWps.length + 1;
    const defaultAlt = localWps.length > 0 ? localWps[localWps.length - 1].alt_m : 25.0;
    const newWp: Waypoint = {
      id: nextSeq,
      lat,
      lon,
      alt_m: defaultAlt,
      command: 'WAYPOINT',
      action: 'CRUISE',
    };
    const updated = [...localWps, newWp];
    setLocalWps(updated);
    setWaypoints(updated);
    checkDirty(updated);

    addAlert({
      type: 'INFO',
      title: `WAYPOINT WP${String(nextSeq).padStart(2, '0')} ADDED`,
      message: `Placed at ${lat.toFixed(6)}°, ${lon.toFixed(6)}° (Alt: ${defaultAlt}m).`,
    });
  };

  // 3. Drag Waypoint on Map
  const handleWaypointMoved = (index: number, lat: number, lon: number) => {
    if (index < 0 || index >= localWps.length) return;
    const updated = [...localWps];
    updated[index] = {
      ...updated[index],
      lat,
      lon,
    };
    setLocalWps(updated);
    setWaypoints(updated);
    checkDirty(updated);
  };

  // 4. Manual Add Waypoint Form
  const handleManualAddWaypoint = (e: React.FormEvent, isVp = false) => {
    e.preventDefault();
    const lat = parseFloat(newWpLat);
    const lon = parseFloat(newWpLon);
    const alt = parseFloat(newWpAlt);
    if (isNaN(lat) || isNaN(lon) || isNaN(alt)) return;

    const action = isVp ? 'VERIFY_POINT' : newWpAction;
    const nextSeq = localWps.length + 1;
    const newWp: Waypoint = {
      id: nextSeq,
      lat,
      lon,
      alt_m: alt,
      command: isVp ? 'VERIFY_POINT' : 'WAYPOINT',
      action,
    };
    const updated = [...localWps, newWp];
    setLocalWps(updated);
    setWaypoints(updated);
    checkDirty(updated);
  };

  // 5. Waypoint Editing: Altitude change, Action change, Delete, Reorder
  const handleAltitudeChange = (index: number, newAlt: number) => {
    const updated = [...localWps];
    updated[index] = { ...updated[index], alt_m: newAlt };
    setLocalWps(updated);
    setWaypoints(updated);
    checkDirty(updated);
  };

  const handleActionChange = (index: number, newAction: string) => {
    const updated = [...localWps];
    updated[index] = { ...updated[index], action: newAction };
    setLocalWps(updated);
    setWaypoints(updated);
    checkDirty(updated);
  };

  const handleDeleteWaypoint = (index: number) => {
    const filtered = localWps.filter((_, i) => i !== index);
    const reindexed = filtered.map((w, i) => ({ ...w, id: i + 1 }));
    setLocalWps(reindexed);
    setWaypoints(reindexed);
    checkDirty(reindexed);
  };

  const handleMoveWaypoint = (index: number, direction: 'UP' | 'DOWN') => {
    if (direction === 'UP' && index === 0) return;
    if (direction === 'DOWN' && index === localWps.length - 1) return;
    const targetIdx = direction === 'UP' ? index - 1 : index + 1;
    const updated = [...localWps];
    const temp = updated[index];
    updated[index] = updated[targetIdx];
    updated[targetIdx] = temp;
    const reindexed = updated.map((w, i) => ({ ...w, id: i + 1 }));
    setLocalWps(reindexed);
    setWaypoints(reindexed);
    checkDirty(reindexed);
  };

  // 6. Save Mission to Database
  const handleSaveMission = async () => {
    try {
      setIsSaving(true);
      await updateMission(activeMissionId, {
        waypoints: localWps,
        home: homePosition ?? undefined,
      });
      setInitialWpsJson(JSON.stringify(localWps));
      setHasUnsavedChanges(false);
      addAlert({
        type: 'INFO',
        title: 'MISSION SAVED',
        message: `Mission ${activeMissionId} updated with ${localWps.length} waypoints.`,
      });
    } catch (err: any) {
      addAlert({
        type: 'WARNING',
        title: 'SAVE FAILED',
        message: err.message || 'Failed to save mission',
      });
    } finally {
      setIsSaving(false);
    }
  };

  // 7. Validate Mission
  const handleValidateMission = async () => {
    try {
      setIsValidating(true);
      const res = await validateMission(activeMissionId, localWps, homePosition ?? undefined);
      setValidationResult(res);
      setShowValidationModal(true);
      if (res.valid) {
        addAlert({
          type: 'INFO',
          title: 'MISSION VALIDATED',
          message: `${res.waypoint_count} waypoints certified. Ready for MAVLink upload.`,
        });
      } else {
        addAlert({
          type: 'WARNING',
          title: 'VALIDATION WARNING',
          message: res.errors.join('; ') || 'Mission validation criteria failed.',
        });
      }
    } catch (err: any) {
      addAlert({
        type: 'WARNING',
        title: 'VALIDATION ERROR',
        message: err.message || 'Validation request failed',
      });
    } finally {
      setIsValidating(false);
    }
  };

  // 8. Upload Mission to Autopilot via MAVLink
  const handleUploadMavlink = async () => {
    try {
      // First save draft if changes exist
      if (hasUnsavedChanges) {
        await handleSaveMission();
      }

      setIsUploadingMavlink(true);
      setUploadStatus('UPLOADING', 'Initiating MAVLink mission sequence...');
      const res = await uploadMissionMavlink(activeMissionId);
      if (res.status === 'UPLOAD_SUCCESSFUL') {
        setUploadStatus('UPLOAD_SUCCESSFUL', res.message || 'Mission accepted by autopilot.');
        addAlert({
          type: 'INFO',
          title: 'MISSION UPLOAD SUCCESSFUL',
          message: `Vehicle confirmed MAV_MISSION_ACCEPTED (${res.waypoint_count} items).`,
        });
      } else {
        setUploadStatus('UPLOAD_FAILED', res.message || 'Autopilot did not accept mission.');
        addAlert({
          type: 'WARNING',
          title: 'UPLOAD FAILED',
          message: res.message || 'Autopilot rejected mission upload.',
        });
      }
    } catch (err: any) {
      setUploadStatus('UPLOAD_FAILED', err.message || 'MAVLink upload failed');
      addAlert({
        type: 'WARNING',
        title: 'UPLOAD ERROR',
        message: err.message || 'Failed to upload mission to vehicle',
      });
    } finally {
      setIsUploadingMavlink(false);
    }
  };

  // 9. Download Active Mission from Drone
  const handleDownloadMavlink = async () => {
    try {
      setIsDownloadingMavlink(true);
      const res = await downloadMissionMavlink(activeMissionId);
      if (res.waypoints && res.waypoints.length > 0) {
        setLocalWps(res.waypoints);
        setWaypoints(res.waypoints);
        setInitialWpsJson(JSON.stringify(res.waypoints));
        setHasUnsavedChanges(false);
        addAlert({
          type: 'INFO',
          title: 'MISSION SYNCED FROM DRONE',
          message: `Successfully retrieved ${res.waypoint_count} waypoints from vehicle.`,
        });
      } else {
        addAlert({
          type: 'INFO',
          title: 'NO WAYPOINTS ON VEHICLE',
          message: 'Autopilot reported zero waypoints loaded.',
        });
      }
    } catch (err: any) {
      addAlert({
        type: 'WARNING',
        title: 'SYNC FAILED',
        message: err.message || 'Failed to download mission from vehicle',
      });
    } finally {
      setIsDownloadingMavlink(false);
    }
  };

  // 10. Planning Mode Toggle & Unsaved Changes Guard
  const handleTogglePlanningMode = () => {
    if (isPlanningMode && hasUnsavedChanges) {
      setPendingModeSwitch(false);
      setShowUnsavedModal(true);
    } else {
      setIsPlanningMode(!isPlanningMode);
    }
  };

  const handleConfirmDiscard = () => {
    // Revert local changes
    try {
      const restored = JSON.parse(initialWpsJson);
      setLocalWps(restored);
      setWaypoints(restored);
    } catch (e) {
      setLocalWps([]);
    }
    setHasUnsavedChanges(false);
    setShowUnsavedModal(false);
    if (pendingModeSwitch !== null) {
      setIsPlanningMode(pendingModeSwitch);
      setPendingModeSwitch(null);
    }
  };

  const handleConfirmSaveAndProceed = async () => {
    await handleSaveMission();
    setShowUnsavedModal(false);
    if (pendingModeSwitch !== null) {
      setIsPlanningMode(pendingModeSwitch);
      setPendingModeSwitch(null);
    }
  };

  // 11. Clear Waypoints
  const handleClearWaypoints = () => {
    if (localWps.length === 0) return;
    if (window.confirm('Clear all waypoints from the current flight plan?')) {
      setLocalWps([]);
      setWaypoints([]);
      checkDirty([]);
    }
  };

  // 12. File Upload Handler (.waypoints, .plan, .geojson, .csv)
  const handleFileInputChange = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    try {
      setIsParsingFile(true);
      const reader = new FileReader();
      reader.onload = async (evt) => {
        try {
          const content = evt.target?.result as string;
          const res = await uploadMissionFile(file.name, content, activeMissionId);
          if (res.waypoints && res.waypoints.length > 0) {
            setLocalWps(res.waypoints);
            setWaypoints(res.waypoints);
            checkDirty(res.waypoints);
          }
          if (res.geofence) setGeofence(res.geofence);
          if (res.no_fly_zones) setNoFlyZones(res.no_fly_zones);
          addAlert({
            type: 'INFO',
            title: 'MISSION FILE PARSED',
            message: `Loaded ${res.waypoint_count} waypoints from ${file.name} onto GPS map.`,
          });
        } catch (err: any) {
          addAlert({
            type: 'WARNING',
            title: 'FILE PARSE ERROR',
            message: err.message || 'Failed to parse mission file format',
          });
        } finally {
          setIsParsingFile(false);
          if (fileInputRef.current) fileInputRef.current.value = '';
        }
      };
      reader.readAsText(file);
    } catch (err: any) {
      setIsParsingFile(false);
      addAlert({
        type: 'WARNING',
        title: 'FILE READ FAILED',
        message: err.message || 'Could not read selected file',
      });
    }
  };

  // 13. Load Competition Templates
  const handleOpenTemplateModal = async () => {
    setIsTemplateModalOpen(true);
    try {
      setLoadingTemplates(true);
      const tpls = await fetchCompetitionTemplates();
      setTemplates(tpls);
    } catch (err) {
      console.error(err);
    } finally {
      setLoadingTemplates(false);
    }
  };

  const handleSelectTemplate = async (templateId: string) => {
    try {
      const res = await loadCompetitionTemplate(templateId, activeMissionId);
      if (res.waypoints) {
        setLocalWps(res.waypoints);
        setWaypoints(res.waypoints);
        checkDirty(res.waypoints);
      }
      if (res.geofence) setGeofence(res.geofence);
      if (res.no_fly_zones) setNoFlyZones(res.no_fly_zones);
      setIsTemplateModalOpen(false);
      addAlert({
        type: 'INFO',
        title: 'COMPETITION COURSE LOADED',
        message: `Applied ${res.template_name} (${res.waypoints.length} WPs) to active mission.`,
      });
    } catch (err: any) {
      addAlert({
        type: 'WARNING',
        title: 'TEMPLATE LOAD ERROR',
        message: err.message || 'Failed to load template',
      });
    }
  };

  // Quick Action Dispatchers
  const handleQuickCommand = async (cmd: string, p1 = 0, p2 = 0) => {
    try {
      const res = await sendCommand(cmd, p1, p2);
      addAlert({
        type: 'INFO',
        title: `COMMAND ${cmd} DISPATCHED`,
        message: `MAVLink status: ${res.status}`,
      });
    } catch (err: any) {
      addAlert({
        type: 'WARNING',
        title: `ACTION ${cmd} FAILED`,
        message: err.message || 'Failed to dispatch command',
      });
    }
  };

  // Compute Total Mission Route Distance
  const totalRouteDistanceM = useMemo(() => {
    if (localWps.length < 2) return 0;
    let dist = 0;
    for (let i = 0; i < localWps.length - 1; i++) {
      const p1 = localWps[i];
      const p2 = localWps[i + 1];
      const phi1 = (p1.lat * Math.PI) / 180;
      const phi2 = (p2.lat * Math.PI) / 180;
      const dPhi = ((p2.lat - p1.lat) * Math.PI) / 180;
      const dLambda = ((p2.lon - p1.lon) * Math.PI) / 180;
      const a =
        Math.sin(dPhi / 2) * Math.sin(dPhi / 2) +
        Math.cos(phi1) * Math.cos(phi2) * Math.sin(dLambda / 2) * Math.sin(dLambda / 2);
      dist += 6371000 * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
    }
    return dist;
  }, [localWps]);

  const formatDuration = (start: number, end: number | null) => {
    const finish = end || Date.now();
    const sec = Math.max(0, Math.floor((finish - start) / 1000));
    const mins = Math.floor(sec / 60);
    const remSec = sec % 60;
    return `${mins}m ${remSec}s`;
  };

  return (
    <div className="space-y-4">
      {/* Hidden file input */}
      <input
        type="file"
        ref={fileInputRef}
        onChange={handleFileInputChange}
        accept=".waypoints,.plan,.geojson,.json,.csv"
        className="hidden"
      />

      {/* Top Header Bar: Mission Context, Status Pills & New Mission Creator */}
      <div className="bg-slate-900 border border-slate-800 rounded-lg p-3.5 flex flex-col md:flex-row md:items-center justify-between gap-3 font-mono">
        <div className="flex items-center flex-wrap gap-2.5">
          <Database className="w-5 h-5 text-cyan-400 shrink-0" />
          <div>
            <div className="flex items-center gap-2">
              <span className="text-xs text-slate-400 uppercase font-bold">MISSION:</span>
              <span className="text-sm font-bold text-slate-100">{activeMissionId}</span>
              {hasUnsavedChanges && (
                <span className="px-1.5 py-0.5 rounded text-[10px] font-bold bg-amber-500/20 text-amber-300 border border-amber-500/30">
                  UNSAVED CHANGES
                </span>
              )}
              <span className={`px-1.5 py-0.5 rounded text-[10px] font-bold border ${isWsConnected ? 'bg-emerald-500/10 text-emerald-400 border-emerald-500/30' : 'bg-rose-500/10 text-rose-400 border-rose-500/30'}`}>
                {connectionStatus}
              </span>
            </div>
            <div className="text-[10px] text-slate-400 mt-0.5">
              Authoritative local SQLite records & authentic MAVLink mission protocol engine.
            </div>
          </div>
        </div>

        {/* Create Fresh Mission Form */}
        <form onSubmit={handleCreateMission} className="flex items-center gap-2 shrink-0">
          <input
            type="text"
            placeholder="New Mission Name..."
            value={newMissionName}
            onChange={(e) => setNewMissionName(e.target.value)}
            className="bg-slate-950 border border-slate-800 rounded px-2.5 py-1 text-xs text-slate-100 focus:outline-none focus:border-cyan-500 w-44 font-mono"
          />
          <button
            type="submit"
            disabled={isCreating}
            className="flex items-center gap-1 px-3 py-1 rounded bg-cyan-600 hover:bg-cyan-500 text-white text-xs font-semibold transition shadow-md active:scale-95 disabled:opacity-50"
          >
            <Plus className="w-3.5 h-3.5" /> NEW MISSION
          </button>
        </form>
      </div>

      {/* Autonomous Mission Execution HUD Banner (Section 19) */}
      {(missionProgress?.is_active || telemetry.flight.mode === 'AUTO') && (
        <div className="bg-gradient-to-r from-cyan-950/60 via-slate-900 to-slate-950 border border-cyan-500/40 rounded-lg p-3 font-mono text-xs shadow-lg">
          <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2 pb-2 mb-2 border-b border-cyan-500/20">
            <div className="flex items-center gap-2">
              <span className="w-2.5 h-2.5 rounded-full bg-cyan-400 animate-ping" />
              <span className="font-bold text-cyan-300 uppercase tracking-wider text-xs">
                MISSION ACTIVE (AUTONOMOUS WAYPOINT FLIGHT)
              </span>
            </div>
            <div className="flex items-center gap-3 text-[11px]">
              <div>
                WAYPOINT:{' '}
                <span className="text-cyan-400 font-bold">
                  WP{String(missionProgress?.current_seq ?? currentWaypointIndex ?? 1).padStart(2, '0')} / WP{String(missionProgress?.total_seq ?? localWps.length).padStart(2, '0')}
                </span>
              </div>
              <div>
                PROGRESS:{' '}
                <span className="text-emerald-400 font-bold">
                  {Math.round(missionProgress?.progress_pct ?? 0)}%
                </span>
              </div>
            </div>
          </div>
          {/* Progress Bar */}
          <div className="w-full bg-slate-950 rounded-full h-1.5 overflow-hidden">
            <div
              className="bg-cyan-400 h-full transition-all duration-300"
              style={{ width: `${Math.min(100, Math.max(0, missionProgress?.progress_pct ?? 0))}%` }}
            />
          </div>
        </div>
      )}

      {/* Main Dual-Column Tactical Layout: GPS Map (Left) + Waypoint Editor (Right) */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
        {/* Left 2 Columns: Live GPS Tactical Map & GPS Status */}
        <div className="lg:col-span-2 space-y-3">
          {/* Interactive Leaflet GPS Map */}
          <GcsGpsMap
            heightClass="h-[480px]"
            isPlanningMode={isPlanningMode}
            onMapClickWaypointAdd={handleMapClickAddWaypoint}
            onWaypointMoved={handleWaypointMoved}
            onDeleteWaypoint={handleDeleteWaypoint}
          />

          {/* Compact GPS Status Panel */}
          <GcsGpsStatusPanel />
        </div>

        {/* Right 1 Column: Waypoint List & Mission Route Controls */}
        <div className="lg:col-span-1 bg-slate-900 border border-slate-800 rounded-lg p-3 font-mono text-xs flex flex-col justify-between">
          <div className="space-y-3">
            {/* Header with Mode Toggle & Stats */}
            <div className="flex items-center justify-between pb-2 border-b border-slate-800">
              <div>
                <h3 className="font-bold text-xs uppercase tracking-wider text-slate-200 flex items-center gap-1.5">
                  <MapPin className="w-3.5 h-3.5 text-cyan-400" /> Waypoints Plan
                </h3>
                <span className="text-[10px] text-slate-400">
                  {localWps.length} points • {(totalRouteDistanceM / 1000).toFixed(2)} km route
                </span>
              </div>

              {/* Mode Toggle Button */}
              <button
                onClick={handleTogglePlanningMode}
                className={`px-2.5 py-1 rounded text-[11px] font-bold flex items-center gap-1 transition ${
                  isPlanningMode
                    ? 'bg-amber-500/20 text-amber-300 border border-amber-500/40 hover:bg-amber-500/30'
                    : 'bg-slate-800 hover:bg-slate-700 text-slate-300'
                }`}
                title="Toggle between Monitor and Waypoint Planning Mode"
              >
                <Crosshair className="w-3 h-3" />
                {isPlanningMode ? 'Exit Planning' : 'Edit Mission'}
              </button>
            </div>

            {/* Quick Action Plan File Tools */}
            <div className="flex items-center gap-1.5 flex-wrap">
              <button
                onClick={() => fileInputRef.current?.click()}
                disabled={isParsingFile}
                className="flex items-center gap-1 px-2 py-0.5 rounded bg-slate-800 hover:bg-slate-700 text-cyan-400 text-[10px] border border-cyan-500/30 transition"
                title="Upload .waypoints, .plan, GeoJSON, CSV"
              >
                <FolderOpen className="w-2.5 h-2.5" />
                {isParsingFile ? 'Parsing...' : 'Import Plan'}
              </button>

              <button
                onClick={handleOpenTemplateModal}
                className="px-2 py-0.5 rounded bg-slate-800 hover:bg-slate-700 text-amber-300 text-[10px] border border-amber-500/30 transition"
              >
                Course Templates
              </button>

              <button
                onClick={handleClearWaypoints}
                disabled={localWps.length === 0}
                className="px-2 py-0.5 rounded bg-slate-800 hover:bg-slate-700 text-rose-400 text-[10px] transition disabled:opacity-40"
              >
                Clear
              </button>
            </div>

            {/* Waypoint List Container */}
            <div className="max-h-[360px] overflow-y-auto space-y-1.5 pr-1">
              {localWps.length === 0 ? (
                <div className="p-6 text-center text-slate-500 bg-slate-950/50 rounded border border-slate-800/60">
                  <MapPin className="w-6 h-6 mx-auto mb-1.5 text-slate-600 opacity-50" />
                  <p className="text-[11px]">No waypoints defined.</p>
                  <p className="text-[10px] text-slate-600 mt-1">
                    {isPlanningMode
                      ? 'Click directly on the GPS map to create waypoints.'
                      : 'Click "Edit Mission" above to enable click-to-place.'}
                  </p>
                </div>
              ) : (
                localWps.map((wp, idx) => {
                  const isVp = wp.action === 'VERIFY_POINT' || wp.command === 'VERIFY_POINT';
                  const isCurrent = currentWaypointIndex === wp.id || currentWaypointIndex === idx + 1;
                  const numStr = String(idx + 1).padStart(2, '0');

                  return (
                    <div
                      key={wp.id}
                      className={`p-2 rounded border transition text-[11px] ${
                        isCurrent
                          ? 'bg-cyan-950/40 border-cyan-500/60 shadow-sm'
                          : 'bg-slate-950/70 border-slate-800/80 hover:border-slate-700'
                      }`}
                    >
                      <div className="flex items-center justify-between gap-1">
                        <div className="flex items-center gap-1.5">
                          <span
                            className={`font-bold px-1.5 py-0.5 rounded text-[10px] ${
                              isVp
                                ? 'bg-purple-500/20 text-purple-300 border border-purple-500/40'
                                : 'bg-amber-500/20 text-amber-300 border border-amber-500/40'
                            }`}
                          >
                            {isVp ? `VP${numStr}` : `WP${numStr}`}
                          </span>
                          <span className="text-slate-300 font-mono text-[10px]">
                            {wp.lat.toFixed(6)}°, {wp.lon.toFixed(6)}°
                          </span>
                        </div>

                        {/* Reorder and Delete controls */}
                        <div className="flex items-center gap-1">
                          <button
                            onClick={() => handleMoveWaypoint(idx, 'UP')}
                            disabled={idx === 0}
                            className="p-0.5 hover:bg-slate-800 text-slate-400 hover:text-slate-200 disabled:opacity-20"
                            title="Move Up in sequence"
                          >
                            <ArrowUp className="w-3 h-3" />
                          </button>
                          <button
                            onClick={() => handleMoveWaypoint(idx, 'DOWN')}
                            disabled={idx === localWps.length - 1}
                            className="p-0.5 hover:bg-slate-800 text-slate-400 hover:text-slate-200 disabled:opacity-20"
                            title="Move Down in sequence"
                          >
                            <ArrowDown className="w-3 h-3" />
                          </button>
                          <button
                            onClick={() => handleDeleteWaypoint(idx)}
                            className="p-0.5 hover:bg-slate-800 text-slate-500 hover:text-rose-400"
                            title="Delete Waypoint"
                          >
                            <Trash2 className="w-3 h-3" />
                          </button>
                        </div>
                      </div>

                      {/* Altitude and Action controls */}
                      <div className="grid grid-cols-2 gap-2 mt-1.5 pt-1.5 border-t border-slate-900">
                        <div className="flex items-center gap-1">
                          <span className="text-[9px] text-slate-500 uppercase">ALT:</span>
                          <input
                            type="number"
                            min="0"
                            max="500"
                            value={wp.alt_m}
                            onChange={(e) => handleAltitudeChange(idx, parseFloat(e.target.value) || 0)}
                            className="w-16 bg-slate-900 border border-slate-800 rounded px-1.5 py-0.5 text-[10px] text-emerald-400 font-bold focus:outline-none focus:border-cyan-500"
                          />
                          <span className="text-[9px] text-slate-500">m</span>
                        </div>

                        <div className="flex items-center gap-1 justify-end">
                          <span className="text-[9px] text-slate-500 uppercase">ACT:</span>
                          <select
                            value={wp.action || 'CRUISE'}
                            onChange={(e) => handleActionChange(idx, e.target.value)}
                            className="bg-slate-900 border border-slate-800 rounded px-1 py-0.5 text-[10px] text-slate-200 focus:outline-none focus:border-cyan-500"
                          >
                            <option value="CRUISE">CRUISE</option>
                            <option value="TAKEOFF">TAKEOFF</option>
                            <option value="VERIFY_POINT">VERIFY_POINT</option>
                            <option value="LOITER">LOITER</option>
                            <option value="DESCEND">DESCEND</option>
                            <option value="RTL">RTL</option>
                            <option value="LAND">LAND</option>
                          </select>
                        </div>
                      </div>
                    </div>
                  );
                })
              )}
            </div>

            {/* Quick Coordinate Adder (Alternative to map clicks) */}
            <form onSubmit={(e) => handleManualAddWaypoint(e, false)} className="pt-2 border-t border-slate-800 grid grid-cols-2 gap-1.5">
              <div>
                <label className="text-[9px] text-slate-500 block uppercase">Lat</label>
                <input
                  type="text"
                  value={newWpLat}
                  onChange={(e) => setNewWpLat(e.target.value)}
                  className="w-full bg-slate-950 border border-slate-800 rounded p-1 text-[10px] text-slate-200 font-mono"
                />
              </div>
              <div>
                <label className="text-[9px] text-slate-500 block uppercase">Lon</label>
                <input
                  type="text"
                  value={newWpLon}
                  onChange={(e) => setNewWpLon(e.target.value)}
                  className="w-full bg-slate-950 border border-slate-800 rounded p-1 text-[10px] text-slate-200 font-mono"
                />
              </div>
              <div>
                <label className="text-[9px] text-slate-500 block uppercase">Alt (m)</label>
                <input
                  type="text"
                  value={newWpAlt}
                  onChange={(e) => setNewWpAlt(e.target.value)}
                  className="w-full bg-slate-950 border border-slate-800 rounded p-1 text-[10px] text-slate-200 font-mono"
                />
              </div>
              <div className="flex items-end gap-1">
                <select
                  value={newWpAction}
                  onChange={(e) => setNewWpAction(e.target.value)}
                  className="w-2/3 bg-slate-950 border border-slate-800 rounded p-1 text-[10px] text-slate-200 font-mono"
                >
                  <option value="CRUISE">CRUISE</option>
                  <option value="TAKEOFF">TAKEOFF</option>
                  <option value="VERIFY_POINT">VP</option>
                  <option value="LOITER">LOITER</option>
                  <option value="RTL">RTL</option>
                  <option value="LAND">LAND</option>
                </select>
                <button
                  type="submit"
                  className="w-1/3 py-1 rounded bg-slate-800 hover:bg-slate-700 text-cyan-300 font-bold text-[10px] flex items-center justify-center transition"
                  title="Add Waypoint"
                >
                  <Plus className="w-2.5 h-2.5" />
                </button>
              </div>
            </form>
          </div>

          {/* Upload Status Callout */}
          {uploadStatus && uploadStatus !== 'NOT_UPLOADED' && (
            <div className="mt-3 p-2 rounded border text-[11px] font-mono bg-slate-950/80 border-slate-800">
              <div className="flex items-center justify-between">
                <span className="text-[10px] text-slate-400 uppercase">MAVLink Upload:</span>
                <span
                  className={`font-bold ${
                    uploadStatus === 'UPLOAD_SUCCESSFUL' || uploadStatus === 'ACKNOWLEDGED'
                      ? 'text-emerald-400'
                      : uploadStatus === 'UPLOADING'
                      ? 'text-cyan-400 animate-pulse'
                      : 'text-rose-400'
                  }`}
                >
                  {uploadStatus}
                </span>
              </div>
              {uploadMessage && <div className="text-[10px] text-slate-400 mt-1">{uploadMessage}</div>}
            </div>
          )}
        </div>
      </div>

      {/* Action Controls Bar (Section 31 & Section 16 & Section 24) */}
      <div className="bg-slate-900 border border-slate-800 rounded-lg p-3 font-mono text-xs flex flex-wrap items-center justify-between gap-2.5">
        <div className="flex items-center gap-2">
          {/* Save Mission to Local Database */}
          <button
            onClick={handleSaveMission}
            disabled={isSaving}
            className="flex items-center gap-1.5 px-3 py-1.5 rounded bg-cyan-600 hover:bg-cyan-500 text-white font-bold transition shadow disabled:opacity-50"
          >
            <Database className="w-3.5 h-3.5" />
            {isSaving ? 'Saving...' : 'SAVE MISSION'}
          </button>

          {/* Validate Mission Plan */}
          <button
            onClick={handleValidateMission}
            disabled={isValidating}
            className="flex items-center gap-1.5 px-3 py-1.5 rounded bg-slate-800 hover:bg-slate-700 text-amber-300 border border-amber-500/30 font-bold transition disabled:opacity-50"
          >
            <ShieldCheck className="w-3.5 h-3.5" />
            {isValidating ? 'Checking...' : 'VALIDATE'}
          </button>

          {/* Upload Mission to Vehicle via MAVLink */}
          <button
            onClick={handleUploadMavlink}
            disabled={isUploadingMavlink || localWps.length === 0}
            className="flex items-center gap-1.5 px-3.5 py-1.5 rounded bg-emerald-600 hover:bg-emerald-500 text-white font-bold transition shadow disabled:opacity-40"
            title="Encodes and uploads mission via authentic MAVLink protocol"
          >
            <Send className="w-3.5 h-3.5" />
            {isUploadingMavlink ? 'UPLOADING...' : 'UPLOAD MISSION'}
          </button>

          {/* Download Mission from Drone */}
          <button
            onClick={handleDownloadMavlink}
            disabled={isDownloadingMavlink}
            className="flex items-center gap-1.5 px-2.5 py-1.5 rounded bg-slate-800 hover:bg-slate-700 text-slate-300 font-semibold transition disabled:opacity-40"
            title="Download active mission currently loaded in vehicle autopilot"
          >
            <RefreshCw className={`w-3.5 h-3.5 ${isDownloadingMavlink ? 'animate-spin' : ''}`} />
            SYNC FROM DRONE
          </button>
        </div>

        {/* Flight Profile Triggers */}
        <div className="flex items-center gap-1.5">
          <button
            onClick={() => handleQuickCommand('CRUISE', 15.0)}
            className="px-2 py-1 rounded bg-slate-800 hover:bg-slate-700 text-cyan-400 text-[11px] font-bold"
          >
            Cruise 15m/s
          </button>
          <button
            onClick={() => handleQuickCommand('LOITER')}
            className="px-2 py-1 rounded bg-slate-800 hover:bg-slate-700 text-amber-400 text-[11px] font-bold"
          >
            Loiter
          </button>
          <button
            onClick={() => handleQuickCommand('RTH')}
            className="px-2 py-1 rounded bg-slate-800 hover:bg-slate-700 text-emerald-400 text-[11px] font-bold"
          >
            RTL
          </button>
        </div>
      </div>

      {/* Historical Recorded Flight Sessions Table */}
      <div className="bg-slate-900 border border-slate-800 rounded-lg overflow-hidden font-mono text-xs">
        <div className="px-4 py-3 border-b border-slate-800 flex items-center justify-between">
          <span className="font-bold uppercase tracking-wider text-slate-300">
            Recorded Flight Sessions ({missions.length})
          </span>
          <button
            onClick={loadMissions}
            className="text-slate-400 hover:text-cyan-400 text-xs"
          >
            Refresh
          </button>
        </div>

        <div className="overflow-x-auto">
          <table className="w-full text-left text-xs">
            <thead className="bg-slate-950/80 text-slate-400 border-b border-slate-800">
              <tr>
                <th className="p-3">Mission ID</th>
                <th className="p-3">Name</th>
                <th className="p-3">Status</th>
                <th className="p-3">Duration</th>
                <th className="p-3">Packets Logged</th>
                <th className="p-3 text-right">Review & Export</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-800/60">
              {loading ? (
                <tr>
                  <td colSpan={6} className="p-6 text-center text-slate-500">
                    Loading mission records from SQLite...
                  </td>
                </tr>
              ) : missions.length === 0 ? (
                <tr>
                  <td colSpan={6} className="p-6 text-center text-slate-500">
                    No missions recorded yet. Create a mission to start logging telemetry.
                  </td>
                </tr>
              ) : (
                missions.map((m) => {
                  const isActive = m.mission_id === activeMissionId && m.status === 'ACTIVE';
                  return (
                    <tr
                      key={m.mission_id}
                      className={`hover:bg-slate-800/30 transition ${
                        isActive ? 'bg-cyan-950/20' : ''
                      }`}
                    >
                      <td className="p-3 font-bold text-cyan-400 flex items-center gap-1.5">
                        {isActive && <span className="w-2 h-2 rounded-full bg-cyan-400 animate-pulse" />}
                        {m.mission_id}
                      </td>
                      <td className="p-3 text-slate-200">{m.name}</td>
                      <td className="p-3">
                        {m.status === 'ACTIVE' ? (
                          <span className="px-2 py-0.5 rounded text-[10px] font-bold bg-emerald-500/10 text-emerald-400 border border-emerald-500/30">
                            ACTIVE
                          </span>
                        ) : (
                          <span className="px-2 py-0.5 rounded text-[10px] font-bold bg-slate-800 text-slate-400">
                            {m.status}
                          </span>
                        )}
                      </td>
                      <td className="p-3 text-slate-400">
                        {formatDuration(m.started_at, m.ended_at)}
                      </td>
                      <td className="p-3 text-slate-200 font-bold">
                        {m.packet_count.toLocaleString()}
                      </td>
                      <td className="p-3 text-right">
                        <div className="flex items-center justify-end gap-2">
                          <button
                            onClick={() => {
                              setActiveMissionId(m.mission_id);
                              loadMissionData(m.mission_id);
                            }}
                            className="px-2 py-1 rounded bg-slate-800 hover:bg-slate-700 text-amber-300 text-[11px]"
                            title="Load this mission onto the tactical map"
                          >
                            Load
                          </button>
                          <button
                            onClick={() => setReviewMission(m)}
                            className="px-2 py-1 rounded bg-slate-800 hover:bg-slate-700 text-cyan-300 text-[11px] flex items-center gap-1"
                          >
                            <FileText className="w-3.5 h-3.5" /> Review
                          </button>
                          {m.status === 'ACTIVE' && (
                            <button
                              onClick={async () => {
                                await stopMission(m.mission_id);
                                await loadMissions();
                              }}
                              className="px-2 py-1 rounded bg-amber-500/10 hover:bg-amber-500/20 text-amber-400 border border-amber-500/30 text-[11px] font-semibold flex items-center gap-1"
                            >
                              <StopCircle className="w-3.5 h-3.5" /> Stop
                            </button>
                          )}
                          <a
                            href={`/api/missions/${m.mission_id}/export/csv`}
                            download
                            className="px-2 py-1 rounded bg-slate-800 hover:bg-slate-700 text-slate-200 text-[11px] flex items-center gap-1"
                          >
                            <Download className="w-3.5 h-3.5" /> CSV
                          </a>
                          <a
                            href={`/api/missions/${m.mission_id}/export/json`}
                            download
                            className="px-2 py-1 rounded bg-slate-800 hover:bg-slate-700 text-slate-200 text-[11px] flex items-center gap-1"
                          >
                            <Download className="w-3.5 h-3.5" /> JSON
                          </a>
                        </div>
                      </td>
                    </tr>
                  );
                })
              )}
            </tbody>
          </table>
        </div>
      </div>

      {/* Validation Result Modal (Section 14) */}
      {showValidationModal && validationResult && (
        <div className="fixed inset-0 z-50 bg-black/80 backdrop-blur-sm flex items-center justify-center p-4">
          <div className="bg-slate-900 border border-slate-800 rounded-lg max-w-lg w-full p-5 font-mono shadow-2xl space-y-4">
            <div className="flex items-center justify-between border-b border-slate-800 pb-3">
              <div className="flex items-center gap-2">
                {validationResult.valid ? (
                  <CheckCircle2 className="w-5 h-5 text-emerald-400" />
                ) : (
                  <ShieldAlert className="w-5 h-5 text-rose-400" />
                )}
                <h4 className="font-bold text-sm text-slate-100">
                  {validationResult.status}
                </h4>
              </div>
              <button
                onClick={() => setShowValidationModal(false)}
                className="text-slate-400 hover:text-slate-100 text-xs p-1"
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            {/* Checks list */}
            <div className="space-y-2">
              {validationResult.checks.map((chk, i) => (
                <div
                  key={i}
                  className={`p-2.5 rounded border text-xs flex items-center justify-between ${
                    chk.passed
                      ? 'bg-emerald-950/20 border-emerald-500/30 text-emerald-300'
                      : 'bg-rose-950/20 border-rose-500/30 text-rose-300'
                  }`}
                >
                  <span className="font-bold">{chk.name}</span>
                  <span>{chk.message}</span>
                </div>
              ))}
            </div>

            {/* Error messages if any */}
            {validationResult.errors.length > 0 && (
              <div className="p-3 rounded bg-rose-950/30 border border-rose-500/40 text-rose-300 text-xs space-y-1">
                <div className="font-bold text-rose-400 uppercase text-[10px]">Validation Errors:</div>
                {validationResult.errors.map((err, i) => (
                  <div key={i}>• {err}</div>
                ))}
              </div>
            )}

            <div className="flex items-center justify-end gap-2 pt-2 border-t border-slate-800">
              <button
                onClick={() => setShowValidationModal(false)}
                className="px-3 py-1.5 rounded bg-slate-800 hover:bg-slate-700 text-slate-200 text-xs font-semibold"
              >
                Close
              </button>
              {validationResult.valid && (
                <button
                  onClick={() => {
                    setShowValidationModal(false);
                    handleUploadMavlink();
                  }}
                  className="px-3.5 py-1.5 rounded bg-emerald-600 hover:bg-emerald-500 text-white text-xs font-bold flex items-center gap-1.5"
                >
                  <Send className="w-3.5 h-3.5" /> Upload to Autopilot
                </button>
              )}
            </div>
          </div>
        </div>
      )}

      {/* Unsaved Changes Confirmation Modal (Section 24) */}
      {showUnsavedModal && (
        <div className="fixed inset-0 z-50 bg-black/80 backdrop-blur-sm flex items-center justify-center p-4">
          <div className="bg-slate-900 border border-slate-800 rounded-lg max-w-md w-full p-5 font-mono shadow-2xl space-y-4">
            <div className="flex items-center gap-2 text-amber-400">
              <AlertTriangle className="w-5 h-5 shrink-0" />
              <h4 className="font-bold text-sm text-slate-100">UNSAVED CHANGES</h4>
            </div>

            <p className="text-xs text-slate-300">
              You have unsaved changes in your mission waypoint plan. Leaving planning mode without saving will discard your recent edits.
            </p>

            <div className="flex items-center justify-end gap-2 pt-2 border-t border-slate-800">
              <button
                onClick={() => setShowUnsavedModal(false)}
                className="px-3 py-1.5 rounded bg-slate-800 hover:bg-slate-700 text-slate-300 text-xs"
              >
                Cancel
              </button>
              <button
                onClick={handleConfirmDiscard}
                className="px-3 py-1.5 rounded bg-rose-600/20 hover:bg-rose-600/30 text-rose-300 border border-rose-500/40 text-xs font-semibold"
              >
                Discard Changes
              </button>
              <button
                onClick={handleConfirmSaveAndProceed}
                className="px-3.5 py-1.5 rounded bg-cyan-600 hover:bg-cyan-500 text-white text-xs font-bold"
              >
                Save & Proceed
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Pre-Saved Competition Courses Modal */}
      {isTemplateModalOpen && (
        <div className="fixed inset-0 z-50 bg-black/80 backdrop-blur-sm flex items-center justify-center p-4">
          <div className="bg-slate-900 border border-slate-800 rounded-lg max-w-xl w-full p-5 font-mono shadow-2xl space-y-4">
            <div className="flex items-center justify-between border-b border-slate-800 pb-3">
              <div>
                <h4 className="font-bold text-sm text-amber-400 flex items-center gap-2">
                  <Compass className="w-4 h-4" /> Pre-Saved Competition Courses
                </h4>
                <p className="text-[11px] text-slate-400 mt-0.5">
                  Load certified course boundaries, verification points, and geofences.
                </p>
              </div>
              <button
                onClick={() => setIsTemplateModalOpen(false)}
                className="text-slate-400 hover:text-slate-100 text-xs p-1"
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            {loadingTemplates ? (
              <div className="p-8 text-center text-slate-500 text-xs">
                Querying competition templates...
              </div>
            ) : (
              <div className="space-y-3 max-h-80 overflow-y-auto">
                {templates.map((tpl) => (
                  <div
                    key={tpl.id}
                    className="p-3 rounded bg-slate-950/80 border border-slate-800/80 hover:border-cyan-500/40 transition flex items-center justify-between gap-3"
                  >
                    <div>
                      <h5 className="font-bold text-xs text-slate-100">{tpl.name}</h5>
                      <p className="text-[11px] text-slate-400 mt-0.5">{tpl.description}</p>
                      <div className="flex items-center gap-3 mt-1.5 text-[10px] text-slate-500">
                        <span className="text-cyan-400">{tpl.waypoints.length} Waypoints</span>
                        <span>•</span>
                        <span className="text-emerald-400">{tpl.geofence.length} Boundary Nodes</span>
                        {tpl.no_fly_zones.length > 0 && (
                          <>
                            <span>•</span>
                            <span className="text-rose-400">{tpl.no_fly_zones.length} No-Fly Zones</span>
                          </>
                        )}
                      </div>
                    </div>
                    <button
                      onClick={() => handleSelectTemplate(tpl.id)}
                      className="px-3 py-1.5 rounded bg-cyan-600 hover:bg-cyan-500 text-white font-bold text-xs whitespace-nowrap"
                    >
                      Load Course
                    </button>
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>
      )}

      {/* Post-Flight Session Review Modal */}
      {reviewMission && (
        <div className="fixed inset-0 z-50 bg-black/80 backdrop-blur-sm flex items-center justify-center p-4">
          <div className="bg-slate-900 border border-slate-800 rounded-lg max-w-lg w-full p-5 font-mono shadow-2xl space-y-4">
            <div className="flex items-center justify-between border-b border-slate-800 pb-3">
              <div>
                <h4 className="font-bold text-sm text-cyan-400 flex items-center gap-2">
                  <FileText className="w-4 h-4" /> Post-Flight Review: {reviewMission.name}
                </h4>
                <span className="text-[10px] text-slate-500">{reviewMission.mission_id}</span>
              </div>
              <button
                onClick={() => setReviewMission(null)}
                className="text-slate-400 hover:text-slate-100 text-xs"
              >
                ✕ Close
              </button>
            </div>

            <div className="space-y-2 text-xs text-slate-300">
              <div className="flex justify-between py-1 border-b border-slate-800/50">
                <span className="text-slate-500">Drone Identifier:</span>
                <span className="text-slate-100 font-bold">{reviewMission.drone_id}</span>
              </div>
              <div className="flex justify-between py-1 border-b border-slate-800/50">
                <span className="text-slate-500">Session Status:</span>
                <span className="text-emerald-400 font-bold">{reviewMission.status}</span>
              </div>
              <div className="flex justify-between py-1 border-b border-slate-800/50">
                <span className="text-slate-500">Mission Start Time:</span>
                <span className="text-slate-200">{new Date(reviewMission.started_at).toLocaleString()}</span>
              </div>
              <div className="flex justify-between py-1 border-b border-slate-800/50">
                <span className="text-slate-500">Mission End Time:</span>
                <span className="text-slate-200">
                  {reviewMission.ended_at ? new Date(reviewMission.ended_at).toLocaleString() : 'In Progress'}
                </span>
              </div>
              <div className="flex justify-between py-1 border-b border-slate-800/50">
                <span className="text-slate-500">Flight Duration:</span>
                <span className="text-cyan-300 font-bold">{formatDuration(reviewMission.started_at, reviewMission.ended_at)}</span>
              </div>
              <div className="flex justify-between py-1 border-b border-slate-800/50">
                <span className="text-slate-500">Total Telemetry Packets:</span>
                <span className="text-slate-100 font-bold">{reviewMission.packet_count.toLocaleString()}</span>
              </div>
            </div>

            <div className="flex items-center justify-end gap-2 pt-2 border-t border-slate-800">
              <a
                href={`/api/missions/${reviewMission.mission_id}/export/csv`}
                download
                className="px-3 py-1.5 rounded bg-slate-800 hover:bg-slate-700 text-white text-xs flex items-center gap-1.5"
              >
                <Download className="w-3.5 h-3.5" /> Export Flight CSV
              </a>
              <a
                href={`/api/missions/${reviewMission.mission_id}/export/json`}
                download
                className="px-3 py-1.5 rounded bg-cyan-600 hover:bg-cyan-500 text-white text-xs font-bold flex items-center gap-1.5"
              >
                <Download className="w-3.5 h-3.5" /> Export Flight JSON
              </a>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};
