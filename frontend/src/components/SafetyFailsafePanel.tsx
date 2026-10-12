import React from 'react';
import { ShieldAlert, AlertTriangle, BatteryWarning, Radio, Compass, Anchor, AlertOctagon } from 'lucide-react';
import { useTelemetryStore } from '../stores/useTelemetryStore';
import { useConnectionStore } from '../stores/useConnectionStore';
import { useDataHealthStore } from '../stores/useDataHealthStore';

export const SafetyFailsafePanel: React.FC = () => {
  const { telemetry } = useTelemetryStore();
  const { status } = useConnectionStore();
  const { health } = useDataHealthStore();

  const batPct = telemetry.battery.percentage;
  const isArmed = telemetry.flight.armed === true;
  const mode = telemetry.flight.mode || 'STANDBY';
  const roll = telemetry.attitude.roll_deg ?? 0;
  const pitch = telemetry.attitude.pitch_deg ?? 0;
  const maxTilt = Math.max(Math.abs(roll), Math.abs(pitch));
  const fix = telemetry.gps.fix_type;
  const sats = telemetry.gps.satellites ?? 0;

  // Evaluate individual failsafe conditions
  const isLowBatCrit = batPct !== null && batPct <= 15;
  const isLowBatWarn = batPct !== null && batPct > 15 && batPct <= 25;
  const isCommLoss = status === 'DISCONNECTED' || (health.last_packet_age_ms !== null && health.last_packet_age_ms > 5000);
  const isCommDegraded = status === 'STALE' || status === 'DEGRADED' || health.packet_loss_percent > 10;
  const isGnssLoss = isArmed && (fix === null || fix < 3 || sats < 5);
  const isUnstableTilt = isArmed && maxTilt > 45;
  const isRtlActive = mode === 'RTL';
  const isLandActive = mode === 'LAND';

  // Overall Safety State
  let safetyLevel: 'NORMAL' | 'WARNING' | 'FAILSAFE ACTIVE' | 'EMERGENCY' = 'NORMAL';
  let activeTrigger = 'None';
  let failsafeAction = 'Monitoring flight envelope';
  let systemState = isArmed ? 'ARMED & OPERATIONAL' : 'DISARMED & STANDBY';

  if (isLowBatCrit || isUnstableTilt) {
    safetyLevel = 'EMERGENCY';
    activeTrigger = isLowBatCrit ? 'CRITICAL BATTERY DEPLETION (≤15%)' : `UNSTABLE ATTITUDE EXCEEDED (${maxTilt.toFixed(0)}°)`;
    failsafeAction = isLowBatCrit ? 'Emergency Landing initiated by flight controller' : 'Attitude rate limiting / Level stabilization';
    systemState = 'EMERGENCY RECOVERY';
  } else if (isCommLoss || isRtlActive || isLandActive) {
    safetyLevel = 'FAILSAFE ACTIVE';
    activeTrigger = isCommLoss ? 'COMMAND & CONTROL LINK LOST' : isRtlActive ? 'RETURN TO LAUNCH TRIGGERED' : 'PRECISION LANDING TRIGGERED';
    failsafeAction = isCommLoss ? 'Autopilot autonomous failsafe execution' : isRtlActive ? 'Climbing to safe RTL altitude and returning home' : 'Descending for touchdown';
    systemState = isCommLoss ? 'AUTONOMOUS PRESERVATION' : isRtlActive ? 'RETURNING TO HOME' : 'TOUCHDOWN DESCENT';
  } else if (isLowBatWarn || isCommDegraded || isGnssLoss) {
    safetyLevel = 'WARNING';
    activeTrigger = isLowBatWarn ? 'LOW BATTERY WARNING (≤25%)' : isCommDegraded ? 'TELEMETRY LINK JITTER / DEGRADED' : 'DEGRADED GNSS SATELLITE FIX';
    failsafeAction = 'Operator advisory alert';
    systemState = 'CAUTION ADVISED';
  }

  const getLevelStyle = () => {
    switch (safetyLevel) {
      case 'EMERGENCY':
        return 'bg-red-950/40 border-red-500 text-red-300 shadow-[0_0_15px_rgba(239,68,68,0.3)] animate-pulse';
      case 'FAILSAFE ACTIVE':
        return 'bg-amber-950/40 border-amber-500 text-amber-300 shadow-[0_0_12px_rgba(245,158,11,0.2)]';
      case 'WARNING':
        return 'bg-amber-950/20 border-amber-500/50 text-amber-200';
      default:
        return 'bg-slate-950/60 border-slate-800 text-slate-300';
    }
  };

  return (
    <div className="bg-slate-900 border border-slate-800 rounded-lg p-3.5 flex flex-col justify-between">
      {/* Header */}
      <div className="flex items-center justify-between pb-2 mb-2.5 border-b border-slate-800">
        <div className="flex items-center gap-2">
          <ShieldAlert className="w-4 h-4 text-cyan-400" />
          <h3 className="text-xs font-bold uppercase tracking-wider text-slate-200">
            Safety & Failsafe Monitor
          </h3>
        </div>
        <span
          className={`text-[10px] font-mono font-extrabold px-2 py-0.5 rounded border ${
            safetyLevel === 'EMERGENCY'
              ? 'bg-red-500/20 text-red-400 border-red-500/40 animate-pulse'
              : safetyLevel === 'FAILSAFE ACTIVE'
              ? 'bg-amber-500/20 text-amber-300 border-amber-500/40'
              : safetyLevel === 'WARNING'
              ? 'bg-amber-500/10 text-amber-400 border-amber-500/30'
              : 'bg-emerald-500/10 text-emerald-400 border-emerald-500/30'
          }`}
        >
          {safetyLevel}
        </span>
      </div>

      {/* Active Failsafe Summary Box */}
      <div className={`p-2.5 rounded border font-mono text-xs mb-3 ${getLevelStyle()}`}>
        <div className="flex items-center gap-2 mb-1">
          {safetyLevel === 'EMERGENCY' ? (
            <AlertOctagon className="w-4 h-4 text-red-400 shrink-0" />
          ) : safetyLevel === 'FAILSAFE ACTIVE' ? (
            <AlertTriangle className="w-4 h-4 text-amber-400 shrink-0" />
          ) : (
            <ShieldAlert className="w-4 h-4 text-emerald-400 shrink-0" />
          )}
          <span className="font-bold text-[11px] uppercase tracking-wider">{activeTrigger}</span>
        </div>
        <div className="text-[10px] space-y-0.5 text-slate-300">
          <div>Action: <strong className="text-white">{failsafeAction}</strong></div>
          <div>State: <strong className="text-cyan-300">{systemState}</strong></div>
        </div>
      </div>

      {/* Grid of Key Monitored Conditions */}
      <div className="grid grid-cols-2 gap-2 font-mono text-[10px]">
        {/* Link Failsafe */}
        <div className="p-1.5 rounded bg-slate-950/60 border border-slate-800 flex items-center justify-between">
          <span className="text-slate-400 flex items-center gap-1">
            <Radio className="w-3 h-3 text-cyan-400" /> C2 Link Loss
          </span>
          <span className={`font-bold ${isCommLoss ? 'text-red-400' : 'text-emerald-400'}`}>
            {isCommLoss ? 'ACTIVE' : 'NOMINAL'}
          </span>
        </div>

        {/* Battery Failsafe */}
        <div className="p-1.5 rounded bg-slate-950/60 border border-slate-800 flex items-center justify-between">
          <span className="text-slate-400 flex items-center gap-1">
            <BatteryWarning className="w-3 h-3 text-amber-400" /> Battery Failsafe
          </span>
          <span className={`font-bold ${isLowBatCrit ? 'text-red-400' : isLowBatWarn ? 'text-amber-400' : 'text-emerald-400'}`}>
            {isLowBatCrit ? 'CRITICAL' : isLowBatWarn ? 'WARNING' : 'NORMAL'}
          </span>
        </div>

        {/* GNSS Failsafe */}
        <div className="p-1.5 rounded bg-slate-950/60 border border-slate-800 flex items-center justify-between">
          <span className="text-slate-400 flex items-center gap-1">
            <Compass className="w-3 h-3 text-emerald-400" /> GNSS Integrity
          </span>
          <span className={`font-bold ${isGnssLoss ? 'text-red-400' : 'text-emerald-400'}`}>
            {isGnssLoss ? 'DEGRADED' : '3D LOCK'}
          </span>
        </div>

        {/* RTH / RTL State */}
        <div className="p-1.5 rounded bg-slate-950/60 border border-slate-800 flex items-center justify-between">
          <span className="text-slate-400 flex items-center gap-1">
            <Anchor className="w-3 h-3 text-cyan-400" /> Return-to-Home
          </span>
          <span className={`font-bold ${isRtlActive ? 'text-amber-300' : 'text-slate-400'}`}>
            {isRtlActive ? 'ACTIVE' : 'STANDBY'}
          </span>
        </div>
      </div>
    </div>
  );
};
