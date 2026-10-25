import React from 'react';
import {
  Compass,
  Navigation,
  Shield,
  ArrowUpRight,
  Clock,
  Target,
} from 'lucide-react';
import type { NormalizedTelemetry, Waypoint, MissionProgressData } from '../types/telemetry';

interface TacticalBottomPanelsProps {
  telemetry: NormalizedTelemetry;
  waypoints: Waypoint[];
  currentWaypointIndex: number | null;
  missionProgress?: MissionProgressData;
  className?: string;
}

export const TacticalBottomPanels: React.FC<TacticalBottomPanelsProps> = ({
  telemetry,
  waypoints,
  currentWaypointIndex,
  missionProgress,
  className = '',
}) => {
  const gps = telemetry.gps;
  const nav = telemetry.navigation;
  const flight = telemetry.flight;

  // 1. Mission Status metrics
  const isAuto = flight.mode === 'AUTO';
  const isMissionActive = missionProgress?.is_active || isAuto;
  const progressPct = Math.round(
    missionProgress?.progress_pct ??
      (waypoints.length > 0 && currentWaypointIndex
        ? (currentWaypointIndex / waypoints.length) * 100
        : 0)
  );

  const missionState = isMissionActive ? 'EN ROUTE' : flight.armed ? 'LOITERING' : 'STANDBY';
  const flightPhase = !flight.armed
    ? 'GROUND'
    : (telemetry.position.altitude_m ?? 0) < 5
    ? 'TAKEOFF'
    : (nav?.ground_speed_mps ?? 0) > 3
    ? 'CRUISE'
    : 'APPROACH';

  const nextWpLabel =
    waypoints.length > 0
      ? `WP${String(currentWaypointIndex ?? 1).padStart(2, '0')}`
      : 'WP01';

  // Distance to Home / Reference Point
  const distToHomeM = nav?.distance_to_home_m ?? null;
  const distDisplay =
    distToHomeM !== null
      ? distToHomeM >= 1000
        ? `${(distToHomeM / 1000).toFixed(2)} km`
        : `${distToHomeM.toFixed(0)} m`
      : 'N/A';

  // ETA Calculation based on distance and ground speed
  const groundSpeed = nav?.ground_speed_mps ?? telemetry.velocity.ground_speed_mps ?? 0;
  let etaStr = '--:--';
  if (distToHomeM !== null && groundSpeed > 1.0) {
    const totalSeconds = Math.round(distToHomeM / groundSpeed);
    const minutes = Math.floor(totalSeconds / 60);
    const seconds = totalSeconds % 60;
    const hours = Math.floor(minutes / 60);
    const remMins = minutes % 60;
    etaStr =
      hours > 0
        ? `${String(hours).padStart(2, '0')}:${String(remMins).padStart(2, '0')}:${String(seconds).padStart(2, '0')}`
        : `${String(remMins).padStart(2, '0')}:${String(seconds).padStart(2, '0')}`;
  }

  // 2. Flight Mode indicators
  const isRcOverride = false; // Real hardware telemetry indicator
  const hasGpsNav = gps.gps_fix && gps.fix_type !== null && gps.fix_type >= 2;
  const hasAltLock = (telemetry.position.altitude_m ?? 0) > 0.5;
  const hasSpeedLock = groundSpeed > 0.5;
  const hasHeadingLock = nav?.heading_deg !== null && nav?.heading_deg !== undefined;
  const isRtl = flight.mode === 'RTL' || flight.mode === 'RETURN_TO_LAUNCH';

  return (
    <div className={`grid grid-cols-1 md:grid-cols-3 gap-3.5 font-mono select-none ${className}`}>
      {/* ───────────────────────────────────────────────────────────── */}
      {/* PANEL 1: MISSION STATUS                                       */}
      {/* ───────────────────────────────────────────────────────────── */}
      <div className="bg-slate-950/85 backdrop-blur-md border border-slate-800 rounded-xl p-3.5 flex flex-col justify-between shadow-xl">
        <div>
          {/* Header */}
          <div className="flex items-center justify-between pb-2 mb-2 border-b border-slate-800/80">
            <span className="text-[11px] font-bold text-slate-400 uppercase tracking-wider flex items-center gap-1.5">
              <Target className="w-3.5 h-3.5 text-cyan-400" /> MISSION STATUS
            </span>
            <span className="text-xs font-bold text-cyan-400">
              {progressPct}% COMPLETE
            </span>
          </div>

          {/* Progress Bar */}
          <div className="w-full bg-slate-900 rounded-full h-1.5 overflow-hidden mb-3">
            <div
              className="bg-gradient-to-r from-cyan-500 to-emerald-400 h-full transition-all duration-300"
              style={{ width: `${Math.min(100, Math.max(0, progressPct))}%` }}
            />
          </div>

          {/* Status Metric Grid */}
          <div className="grid grid-cols-2 gap-2 text-xs">
            <div>
              <span className="text-[9px] text-slate-500 uppercase block">State</span>
              <span className="font-bold text-white tracking-wide">
                {missionState}
              </span>
            </div>

            <div>
              <span className="text-[9px] text-slate-500 uppercase block">Phase</span>
              <span className="font-bold text-cyan-300 tracking-wide">
                {flightPhase}
              </span>
            </div>

            <div>
              <span className="text-[9px] text-slate-500 uppercase block">Next Waypoint</span>
              <span className="font-bold text-amber-300">
                {nextWpLabel}
              </span>
            </div>

            <div>
              <span className="text-[9px] text-slate-500 uppercase block">ETA to Target</span>
              <span className="font-bold text-white flex items-center gap-1">
                <Clock className="w-2.5 h-2.5 text-slate-400" /> {etaStr}
              </span>
            </div>
          </div>
        </div>

        {/* Distance to RP Strip */}
        <div className="mt-3 pt-2 border-t border-slate-800/60 flex items-center justify-between text-[11px]">
          <span className="text-slate-500 text-[10px] uppercase">Distance to RP</span>
          <span className="text-emerald-400 font-bold">{distDisplay}</span>
        </div>
      </div>

      {/* ───────────────────────────────────────────────────────────── */}
      {/* PANEL 2: FLIGHT MODE                                          */}
      {/* ───────────────────────────────────────────────────────────── */}
      <div className="bg-slate-950/85 backdrop-blur-md border border-slate-800 rounded-xl p-3.5 flex flex-col justify-between shadow-xl">
        <div>
          {/* Header */}
          <div className="flex items-center justify-between pb-2 mb-2 border-b border-slate-800/80">
            <span className="text-[11px] font-bold text-slate-400 uppercase tracking-wider flex items-center gap-1.5">
              <Shield className="w-3.5 h-3.5 text-purple-400" /> FLIGHT MODE
            </span>
            <div className="flex items-center gap-1.5">
              <span className={`px-1.5 py-0.5 rounded text-[9px] font-bold border ${flight.armed ? 'bg-red-500/20 text-red-300 border-red-500/40 shadow-[0_0_8px_rgba(239,68,68,0.3)]' : 'bg-slate-800 text-slate-400 border-slate-700'}`}>
                {flight.armed ? 'ARMED' : 'DISARMED'}
              </span>
            </div>
          </div>

          {/* Mode Callout & RC Status */}
          <div className="flex items-baseline justify-between mb-3">
            <div>
              <span className="text-[9px] text-slate-500 uppercase block">Control Mode</span>
              <span className="text-base font-extrabold text-white tracking-wider">
                {flight.mode || 'STANDBY'}
              </span>
            </div>

            <div className="text-right">
              <span className="text-[9px] text-slate-500 uppercase block">RC Override</span>
              <span className={`text-xs font-bold ${isRcOverride ? 'text-amber-400' : 'text-emerald-400'}`}>
                {isRcOverride ? 'ACTIVE' : 'INACTIVE'}
              </span>
            </div>
          </div>

          {/* Subsystem Indicators / Autopilot LEDs */}
          <div>
            <span className="text-[9px] text-slate-500 uppercase block mb-1.5">Subsystem Autopilot Locks</span>
            <div className="grid grid-cols-5 gap-1 text-center text-[10px] font-bold">
              {/* NAV */}
              <div className={`py-1 rounded border flex flex-col items-center gap-0.5 ${hasGpsNav ? 'bg-emerald-950/50 text-emerald-300 border-emerald-500/50 shadow-[0_0_6px_rgba(16,185,129,0.3)]' : 'bg-slate-900/60 text-slate-500 border-slate-800'}`}>
                <span className={`w-1.5 h-1.5 rounded-full ${hasGpsNav ? 'bg-emerald-400' : 'bg-slate-600'}`} />
                <span>NAV</span>
              </div>

              {/* ALT */}
              <div className={`py-1 rounded border flex flex-col items-center gap-0.5 ${hasAltLock ? 'bg-emerald-950/50 text-emerald-300 border-emerald-500/50 shadow-[0_0_6px_rgba(16,185,129,0.3)]' : 'bg-slate-900/60 text-slate-500 border-slate-800'}`}>
                <span className={`w-1.5 h-1.5 rounded-full ${hasAltLock ? 'bg-emerald-400' : 'bg-slate-600'}`} />
                <span>ALT</span>
              </div>

              {/* SPD */}
              <div className={`py-1 rounded border flex flex-col items-center gap-0.5 ${hasSpeedLock ? 'bg-emerald-950/50 text-emerald-300 border-emerald-500/50 shadow-[0_0_6px_rgba(16,185,129,0.3)]' : 'bg-slate-900/60 text-slate-500 border-slate-800'}`}>
                <span className={`w-1.5 h-1.5 rounded-full ${hasSpeedLock ? 'bg-emerald-400' : 'bg-slate-600'}`} />
                <span>SPD</span>
              </div>

              {/* HDG */}
              <div className={`py-1 rounded border flex flex-col items-center gap-0.5 ${hasHeadingLock ? 'bg-emerald-950/50 text-emerald-300 border-emerald-500/50 shadow-[0_0_6px_rgba(16,185,129,0.3)]' : 'bg-slate-900/60 text-slate-500 border-slate-800'}`}>
                <span className={`w-1.5 h-1.5 rounded-full ${hasHeadingLock ? 'bg-emerald-400' : 'bg-slate-600'}`} />
                <span>HDG</span>
              </div>

              {/* RTL */}
              <div className={`py-1 rounded border flex flex-col items-center gap-0.5 ${isRtl ? 'bg-amber-950/50 text-amber-300 border-amber-500/50 shadow-[0_0_6px_rgba(245,158,11,0.3)]' : 'bg-slate-900/60 text-slate-500 border-slate-800'}`}>
                <span className={`w-1.5 h-1.5 rounded-full ${isRtl ? 'bg-amber-400' : 'bg-slate-600'}`} />
                <span>RTL</span>
              </div>
            </div>
          </div>
        </div>

        {/* Bottom Mode Status */}
        <div className="mt-3 pt-2 border-t border-slate-800/60 flex items-center justify-between text-[11px]">
          <span className="text-slate-500 text-[10px] uppercase">GCS Override Link</span>
          <span className="text-emerald-400 font-bold">READY</span>
        </div>
      </div>

      {/* ───────────────────────────────────────────────────────────── */}
      {/* PANEL 3: NAVIGATION                                           */}
      {/* ───────────────────────────────────────────────────────────── */}
      <div className="bg-slate-950/85 backdrop-blur-md border border-slate-800 rounded-xl p-3.5 flex flex-col justify-between shadow-xl">
        <div>
          {/* Header */}
          <div className="flex items-center justify-between pb-2 mb-2 border-b border-slate-800/80">
            <span className="text-[11px] font-bold text-slate-400 uppercase tracking-wider flex items-center gap-1.5">
              <Navigation className="w-3.5 h-3.5 text-emerald-400" /> NAVIGATION
            </span>
            <span className="text-xs font-bold text-emerald-400">
              {distDisplay}
            </span>
          </div>

          {/* Main Navigation Metrics */}
          <div className="grid grid-cols-2 gap-2 text-xs mb-3">
            <div>
              <span className="text-[9px] text-slate-500 uppercase block">Bearing to Home</span>
              <span className="text-white font-bold flex items-center gap-1">
                <Compass className="w-3 h-3 text-cyan-400" />
                {nav?.bearing_to_home_deg !== null && nav?.bearing_to_home_deg !== undefined
                  ? `${Math.round(nav.bearing_to_home_deg)}°`
                  : 'N/A'}
              </span>
            </div>

            <div>
              <span className="text-[9px] text-slate-500 uppercase block">Current Heading</span>
              <span className="text-white font-bold flex items-center gap-1">
                <ArrowUpRight className="w-3 h-3 text-emerald-400" />
                {nav?.heading_deg !== null && nav?.heading_deg !== undefined
                  ? `${Math.round(nav.heading_deg)}°`
                  : 'N/A'}
              </span>
            </div>

            <div>
              <span className="text-[9px] text-slate-500 uppercase block">Ground Speed</span>
              <span className="text-white font-bold">
                {nav?.ground_speed_mps !== null && nav?.ground_speed_mps !== undefined
                  ? `${nav.ground_speed_mps.toFixed(1)} m/s`
                  : '0.0 m/s'}
              </span>
            </div>

            <div>
              <span className="text-[9px] text-slate-500 uppercase block">Vertical Speed</span>
              <span className="text-white font-bold">
                {telemetry.velocity.vertical_speed_mps !== null
                  ? `${telemetry.velocity.vertical_speed_mps >= 0 ? '+' : ''}${telemetry.velocity.vertical_speed_mps.toFixed(1)} m/s`
                  : '0.0 m/s'}
              </span>
            </div>
          </div>
        </div>

        {/* Mini Route Progress Summary */}
        <div className="mt-2 pt-2 border-t border-slate-800/60 flex items-center justify-between text-[10px]">
          <span className="text-slate-500 uppercase">Route Progress</span>
          <span className="text-slate-300 font-bold">
            {waypoints.length > 0
              ? `WP01 ──●── WP${String(waypoints.length).padStart(2, '0')} ── RTB`
              : 'DIRECT TO HOME'}
          </span>
        </div>
      </div>
    </div>
  );
};
