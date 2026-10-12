import React, { useEffect, useState } from 'react';
import { Plus, Download, StopCircle, Database, MapPin, Upload, FileText, Trash2 } from 'lucide-react';
import type { Mission, Waypoint } from '../types/telemetry';
import { fetchMissions, createMission, stopMission, fetchWaypoints, updateWaypoints } from '../services/apiService';
import { useMissionStore } from '../stores/useMissionStore';
import { useAlertStore } from '../stores/useAlertStore';

export const MissionsPage: React.FC = () => {
  const [missions, setMissions] = useState<Mission[]>([]);
  const [loading, setLoading] = useState(true);
  const [newMissionName, setNewMissionName] = useState('');
  const [isCreating, setIsCreating] = useState(false);
  const { activeMissionId, setActiveMissionId, waypoints, setWaypoints } = useMissionStore();
  const { addAlert } = useAlertStore();

  // Waypoint Planner Local State
  const [localWps, setLocalWps] = useState<Waypoint[]>(waypoints);
  const [newWpLat, setNewWpLat] = useState('19.877500');
  const [newWpLon, setNewWpLon] = useState('75.344000');
  const [newWpAlt, setNewWpAlt] = useState('30.0');
  const [newWpAction, setNewWpAction] = useState('CRUISE');
  const [savingWps, setSavingWps] = useState(false);

  // Selected mission for Post-Flight Review modal
  const [reviewMission, setReviewMission] = useState<Mission | null>(null);

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

  const loadRemoteWaypoints = async () => {
    try {
      const res = await fetchWaypoints();
      if (res.waypoints && res.waypoints.length > 0) {
        setWaypoints(res.waypoints);
        setLocalWps(res.waypoints);
      }
    } catch (e) {
      console.error(e);
    }
  };

  useEffect(() => {
    loadMissions();
    loadRemoteWaypoints();
  }, []);

  const handleCreate = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!newMissionName.trim()) return;
    try {
      setIsCreating(true);
      const res = await createMission(newMissionName.trim());
      setActiveMissionId(res.mission_id);
      setNewMissionName('');
      await loadMissions();
      addAlert({
        type: 'INFO',
        title: 'MISSION CREATED',
        message: `Active mission initialized: ${res.mission_id}`,
      });
    } catch (err) {
      console.error(err);
    } finally {
      setIsCreating(false);
    }
  };

  const handleStop = async (id: string) => {
    try {
      await stopMission(id);
      await loadMissions();
      addAlert({
        type: 'INFO',
        title: 'MISSION COMPLETED',
        message: `Mission ${id} marked as COMPLETED.`,
      });
    } catch (err) {
      console.error(err);
    }
  };

  const handleAddWaypoint = (e: React.FormEvent) => {
    e.preventDefault();
    const lat = parseFloat(newWpLat);
    const lon = parseFloat(newWpLon);
    const alt = parseFloat(newWpAlt);
    if (isNaN(lat) || isNaN(lon) || isNaN(alt)) return;

    const newWp: Waypoint = {
      id: localWps.length + 1,
      lat,
      lon,
      alt_m: alt,
      command: 'WAYPOINT',
      action: newWpAction,
    };
    const updated = [...localWps, newWp];
    setLocalWps(updated);
  };

  const handleRemoveWaypoint = (idx: number) => {
    const updated = localWps.filter((_, i) => i !== idx).map((w, i) => ({ ...w, id: i + 1 }));
    setLocalWps(updated);
  };

  const handleUploadWaypoints = async () => {
    try {
      setSavingWps(true);
      await updateWaypoints(localWps);
      setWaypoints(localWps);
      addAlert({
        type: 'INFO',
        title: 'MISSION PLAN UPLOADED',
        message: `Saved ${localWps.length} waypoints for active mission ${activeMissionId}.`,
      });
    } catch (e: any) {
      addAlert({
        type: 'WARNING',
        title: 'UPLOAD FAILED',
        message: e.message || 'Failed to upload waypoint plan',
      });
    } finally {
      setSavingWps(false);
    }
  };

  const handleLoadDefaultCourse = () => {
    const defaultCourse: Waypoint[] = [
      { id: 1, lat: 19.876543, lon: 75.343210, alt_m: 15.0, command: 'TAKEOFF', action: 'TAKEOFF' },
      { id: 2, lat: 19.877800, lon: 75.344500, alt_m: 30.0, command: 'WAYPOINT', action: 'CRUISE' },
      { id: 3, lat: 19.879200, lon: 75.343800, alt_m: 35.0, command: 'WAYPOINT', action: 'CRUISE' },
      { id: 4, lat: 19.878100, lon: 75.342100, alt_m: 25.0, command: 'WAYPOINT', action: 'CRUISE' },
      { id: 5, lat: 19.876543, lon: 75.343210, alt_m: 0.0, command: 'RTL', action: 'LAND' },
    ];
    setLocalWps(defaultCourse);
  };

  const formatDuration = (start: number, end: number | null) => {
    const finish = end || Date.now();
    const sec = Math.max(0, Math.floor((finish - start) / 1000));
    const mins = Math.floor(sec / 60);
    const remSec = sec % 60;
    return `${mins}m ${remSec}s`;
  };

  return (
    <div className="space-y-6">
      {/* Header and Mission Creation Bar */}
      <div className="flex flex-col md:flex-row md:items-center justify-between gap-4 bg-slate-900 border border-slate-800 p-4 rounded-lg">
        <div>
          <h2 className="text-base font-bold text-slate-100 flex items-center gap-2">
            <Database className="w-5 h-5 text-cyan-400" />
            Mission Management & Historical Records
          </h2>
          <p className="text-xs text-slate-400 mt-1">
            Authoritative local SQLite logs. Export verified mission streams to CSV or JSON.
          </p>
        </div>

        <form onSubmit={handleCreate} className="flex items-center gap-2">
          <input
            type="text"
            placeholder="New Mission Name..."
            value={newMissionName}
            onChange={(e) => setNewMissionName(e.target.value)}
            className="bg-slate-950 border border-slate-800 rounded px-3 py-1.5 text-xs text-slate-100 focus:outline-none focus:border-cyan-500 w-52 font-mono"
          />
          <button
            type="submit"
            disabled={isCreating}
            className="flex items-center gap-1.5 px-3 py-1.5 rounded bg-cyan-600 hover:bg-cyan-500 text-white text-xs font-semibold transition"
          >
            <Plus className="w-3.5 h-3.5" /> Create Mission
          </button>
        </form>
      </div>

      {/* Mission Planner & Waypoint Configuration Section (Requirement 6) */}
      <div className="bg-slate-900 border border-slate-800 rounded-lg p-4 font-mono text-xs space-y-4">
        <div className="flex flex-col sm:flex-row sm:items-center justify-between pb-3 border-b border-slate-800 gap-2">
          <div className="flex items-center gap-2">
            <MapPin className="w-4 h-4 text-cyan-400" />
            <h3 className="text-xs font-bold uppercase tracking-wider text-slate-200">
              Waypoint Mission Planner & Course Configuration
            </h3>
          </div>
          <div className="flex items-center gap-2">
            <button
              onClick={handleLoadDefaultCourse}
              className="px-2.5 py-1 rounded bg-slate-800 hover:bg-slate-700 text-slate-300 text-[11px]"
            >
              Load Competition Course
            </button>
            <button
              onClick={handleUploadWaypoints}
              disabled={savingWps}
              className="flex items-center gap-1 px-3 py-1 rounded bg-cyan-600 hover:bg-cyan-500 text-white font-bold text-[11px] transition"
            >
              <Upload className="w-3 h-3" /> Upload Plan ({localWps.length} WPs)
            </button>
          </div>
        </div>

        {/* Add Waypoint Form */}
        <form onSubmit={handleAddWaypoint} className="grid grid-cols-2 sm:grid-cols-5 gap-2 bg-slate-950/70 p-3 rounded border border-slate-800/80">
          <div>
            <label className="block text-[9px] text-slate-500 uppercase mb-1">Latitude</label>
            <input
              type="text"
              value={newWpLat}
              onChange={(e) => setNewWpLat(e.target.value)}
              className="w-full bg-slate-900 border border-slate-800 rounded p-1.5 text-slate-100 text-xs focus:outline-none focus:border-cyan-500"
            />
          </div>
          <div>
            <label className="block text-[9px] text-slate-500 uppercase mb-1">Longitude</label>
            <input
              type="text"
              value={newWpLon}
              onChange={(e) => setNewWpLon(e.target.value)}
              className="w-full bg-slate-900 border border-slate-800 rounded p-1.5 text-slate-100 text-xs focus:outline-none focus:border-cyan-500"
            />
          </div>
          <div>
            <label className="block text-[9px] text-slate-500 uppercase mb-1">Alt AGL (m)</label>
            <input
              type="text"
              value={newWpAlt}
              onChange={(e) => setNewWpAlt(e.target.value)}
              className="w-full bg-slate-900 border border-slate-800 rounded p-1.5 text-slate-100 text-xs focus:outline-none focus:border-cyan-500"
            />
          </div>
          <div>
            <label className="block text-[9px] text-slate-500 uppercase mb-1">Action Profile</label>
            <select
              value={newWpAction}
              onChange={(e) => setNewWpAction(e.target.value)}
              className="w-full bg-slate-900 border border-slate-800 rounded p-1.5 text-slate-100 text-xs focus:outline-none focus:border-cyan-500"
            >
              <option value="TAKEOFF">TAKEOFF</option>
              <option value="CRUISE">CRUISE</option>
              <option value="LOITER">LOITER</option>
              <option value="RTL">RETURN TO LAUNCH</option>
              <option value="LAND">LAND</option>
            </select>
          </div>
          <div className="flex items-end">
            <button
              type="submit"
              className="w-full py-1.5 px-2 rounded bg-slate-800 hover:bg-slate-700 text-cyan-300 font-bold text-xs flex items-center justify-center gap-1"
            >
              <Plus className="w-3.5 h-3.5" /> Add WP
            </button>
          </div>
        </form>

        {/* Current Configured Waypoints List */}
        <div className="overflow-x-auto">
          <table className="w-full text-left text-xs font-mono">
            <thead className="bg-slate-950/80 text-slate-400 border-b border-slate-800">
              <tr>
                <th className="p-2">#</th>
                <th className="p-2">Target Coordinates</th>
                <th className="p-2">Target Altitude</th>
                <th className="p-2">Action Profile</th>
                <th className="p-2 text-right">Action</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-800/60">
              {localWps.length === 0 ? (
                <tr>
                  <td colSpan={5} className="p-4 text-center text-slate-500">
                    No waypoints in plan. Add coordinates above or load the default competition course.
                  </td>
                </tr>
              ) : (
                localWps.map((wp, idx) => (
                  <tr key={wp.id} className="hover:bg-slate-800/20">
                    <td className="p-2 font-bold text-cyan-400">WP #{wp.id}</td>
                    <td className="p-2 text-slate-200">
                      {wp.lat.toFixed(6)}°, {wp.lon.toFixed(6)}°
                    </td>
                    <td className="p-2 text-emerald-400 font-bold">{wp.alt_m} m</td>
                    <td className="p-2">
                      <span className="px-1.5 py-0.5 rounded bg-slate-800 text-slate-300 text-[10px]">
                        {wp.action || 'NAVIGATE'}
                      </span>
                    </td>
                    <td className="p-2 text-right">
                      <button
                        onClick={() => handleRemoveWaypoint(idx)}
                        className="text-slate-500 hover:text-red-400 p-1"
                      >
                        <Trash2 className="w-3.5 h-3.5" />
                      </button>
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      </div>

      {/* Mission List Table (Post-Flight Historical Logs) */}
      <div className="bg-slate-900 border border-slate-800 rounded-lg overflow-hidden">
        <div className="px-4 py-3 border-b border-slate-800 flex items-center justify-between">
          <span className="text-xs font-bold uppercase tracking-wider text-slate-300">
            Recorded Flight Sessions ({missions.length})
          </span>
          <button
            onClick={loadMissions}
            className="text-xs text-slate-400 hover:text-cyan-400 font-mono"
          >
            Refresh
          </button>
        </div>

        <div className="overflow-x-auto">
          <table className="w-full text-left text-xs font-mono">
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
                            onClick={() => setReviewMission(m)}
                            className="px-2 py-1 rounded bg-slate-800 hover:bg-slate-700 text-cyan-300 text-[11px] flex items-center gap-1"
                          >
                            <FileText className="w-3.5 h-3.5" /> Review
                          </button>
                          {m.status === 'ACTIVE' && (
                            <button
                              onClick={() => handleStop(m.mission_id)}
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

      {/* Post-Flight Session Review Modal (Requirement 16) */}
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
