import React from 'react';
import { Target, Flag, Route, CheckCircle } from 'lucide-react';
import { useMissionStore } from '../stores/useMissionStore';
import { useTelemetryStore } from '../stores/useTelemetryStore';

export const MissionStatusWidget: React.FC = () => {
  const { activeMissionId, waypoints, currentWaypointIndex, missionState } = useMissionStore();
  const { telemetry } = useTelemetryStore();

  const isAuto = telemetry.flight.mode === 'AUTO';
  const isArmed = telemetry.flight.armed === true;

  // Derive execution status from state and flight mode
  let statusLabel = missionState;
  if (isArmed && isAuto) {
    statusLabel = 'RUNNING';
  } else if (telemetry.flight.mode === 'RTL') {
    statusLabel = 'RUNNING';
  } else if (waypoints.length > 0 && !isArmed) {
    statusLabel = 'LOADED';
  }

  const totalWaypoints = waypoints.length;
  const currentWpNum = Math.min(Math.max(1, currentWaypointIndex + 1), totalWaypoints || 1);
  const progressPercent = totalWaypoints > 0 ? Math.round((currentWpNum / totalWaypoints) * 100) : 0;

  const currentWp = waypoints[currentWaypointIndex] || waypoints[0];
  const nextWp = waypoints[currentWaypointIndex + 1] || null;

  return (
    <div className="bg-slate-900 border border-slate-800 rounded-lg p-3.5 flex flex-col justify-between">
      <div className="flex items-center justify-between pb-2 mb-2 border-b border-slate-800">
        <div className="flex items-center gap-2">
          <Route className="w-4 h-4 text-cyan-400" />
          <h3 className="text-xs font-bold uppercase tracking-wider text-slate-200">
            Mission Navigation Status
          </h3>
        </div>
        <span
          className={`text-[10px] font-mono font-bold px-2 py-0.5 rounded border ${
            statusLabel === 'RUNNING'
              ? 'bg-emerald-500/20 text-emerald-300 border-emerald-500/40 animate-pulse'
              : statusLabel === 'LOADED'
              ? 'bg-cyan-500/10 text-cyan-300 border-cyan-500/30'
              : statusLabel === 'ABORTED'
              ? 'bg-red-500/20 text-red-400 border-red-500/40'
              : 'bg-slate-800 text-slate-400 border-slate-700'
          }`}
        >
          STATUS: {statusLabel}
        </span>
      </div>

      <div className="space-y-3 font-mono">
        {/* Mission Type & ID */}
        <div className="flex items-center justify-between text-xs">
          <div>
            <span className="text-[10px] text-slate-500 block uppercase">MISSION PROFILE</span>
            <span className="font-bold text-slate-100">
              {isAuto ? 'AUTONOMOUS MISSION' : 'WAYPOINT NAVIGATION'}
            </span>
          </div>
          <div className="text-right">
            <span className="text-[10px] text-slate-500 block uppercase">ACTIVE MISSION ID</span>
            <span className="text-cyan-400 font-bold">{activeMissionId}</span>
          </div>
        </div>

        {/* Waypoint Progress Bar & Numbers */}
        <div>
          <div className="flex items-center justify-between text-xs mb-1">
            <span className="text-slate-300 font-bold flex items-center gap-1.5">
              <Target className="w-3.5 h-3.5 text-cyan-400" />
              WAYPOINT {totalWaypoints > 0 ? `${currentWpNum} / ${totalWaypoints}` : '-- / --'}
            </span>
            <span className="text-cyan-400 font-extrabold">{progressPercent}%</span>
          </div>
          <div className="w-full bg-slate-950 h-2 rounded-full overflow-hidden border border-slate-800">
            <div
              className="h-full bg-gradient-to-r from-cyan-500 to-emerald-400 transition-all duration-300"
              style={{ width: `${progressPercent}%` }}
            />
          </div>
        </div>

        {/* Current & Next Waypoint Targets */}
        <div className="grid grid-cols-2 gap-2 pt-1 border-t border-slate-800/60 text-[11px]">
          <div className="bg-slate-950/60 p-2 rounded border border-slate-800/70">
            <span className="text-[9px] text-slate-500 uppercase block flex items-center gap-1">
              <Flag className="w-3 h-3 text-cyan-400" /> Active Target
            </span>
            <span className="font-bold text-slate-200 block truncate">
              {currentWp ? `WP#${currentWp.id} (${currentWp.alt_m}m • ${currentWp.action || 'NAV'})` : 'None'}
            </span>
          </div>
          <div className="bg-slate-950/60 p-2 rounded border border-slate-800/70">
            <span className="text-[9px] text-slate-500 uppercase block flex items-center gap-1">
              <CheckCircle className="w-3 h-3 text-slate-400" /> Next Target
            </span>
            <span className="font-bold text-slate-400 block truncate">
              {nextWp ? `WP#${nextWp.id} (${nextWp.alt_m}m • ${nextWp.action || 'NAV'})` : 'Final Destination'}
            </span>
          </div>
        </div>
      </div>
    </div>
  );
};
