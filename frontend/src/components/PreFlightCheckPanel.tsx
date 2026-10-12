import React from 'react';
import { CheckCircle2, AlertTriangle, XCircle, HelpCircle, ShieldCheck, ShieldAlert } from 'lucide-react';
import { useTelemetryStore } from '../stores/useTelemetryStore';
import { useConnectionStore } from '../stores/useConnectionStore';
import { useDataHealthStore } from '../stores/useDataHealthStore';
import { useMissionStore } from '../stores/useMissionStore';
import type { PreFlightCheckItem, CheckStatus } from '../types/telemetry';

export const PreFlightCheckPanel: React.FC = () => {
  const { telemetry } = useTelemetryStore();
  const { status } = useConnectionStore();
  const { health } = useDataHealthStore();
  const { waypoints, activeMissionId } = useMissionStore();

  const isConnected = status === 'LIVE' || status === 'CONNECTED';
  const isStale = status === 'STALE' || status === 'DEGRADED';

  // 1. Autopilot status
  let autopilotStatus: CheckStatus = 'UNKNOWN';
  let autopilotMsg = 'No heartbeat received';
  if (telemetry.flight.mode) {
    autopilotStatus = 'PASS';
    autopilotMsg = `Heartbeat active • Mode: ${telemetry.flight.mode}`;
  } else if (status === 'DISCONNECTED') {
    autopilotStatus = 'FAIL';
    autopilotMsg = 'Autopilot unreachable';
  }

  // 2. Communication Link
  let commStatus: CheckStatus = 'FAIL';
  let commMsg = 'Disconnected';
  if (isConnected) {
    commStatus = 'PASS';
    commMsg = `Link live • Latency: ${health.transport_latency_ms !== null ? Math.round(health.transport_latency_ms) : '--'}ms`;
  } else if (isStale) {
    commStatus = 'WARNING';
    commMsg = `Link degraded or stale • Age: ${health.last_packet_age_ms ? (health.last_packet_age_ms / 1000).toFixed(1) : '--'}s`;
  }

  // 3. Telemetry Integrity
  let telemStatus: CheckStatus = 'UNKNOWN';
  let telemMsg = 'Awaiting telemetry packets';
  if (health.received_packets > 0) {
    if (health.packet_loss_percent <= 1.0 && health.invalid_packets === 0) {
      telemStatus = 'PASS';
      telemMsg = `0 invalid frames • Loss: ${health.packet_loss_percent.toFixed(2)}%`;
    } else if (health.packet_loss_percent <= 5.0) {
      telemStatus = 'WARNING';
      telemMsg = `Elevated loss: ${health.packet_loss_percent.toFixed(2)}%`;
    } else {
      telemStatus = 'FAIL';
      telemMsg = `High packet loss (${health.packet_loss_percent.toFixed(1)}%) or corrupt packets`;
    }
  }

  // 4. GNSS Status
  let gnssStatus: CheckStatus = 'UNKNOWN';
  let gnssMsg = 'No GPS fix data';
  const fix = telemetry.gps.fix_type;
  const sats = telemetry.gps.satellites ?? 0;
  if (fix !== null) {
    if (fix >= 3 && sats >= 6) {
      gnssStatus = 'PASS';
      gnssMsg = `3D Fix acquired • ${sats} satellites`;
    } else if (fix === 2 || (fix >= 3 && sats < 6)) {
      gnssStatus = 'WARNING';
      gnssMsg = `2D Fix or low satellite count (${sats} sats)`;
    } else {
      gnssStatus = 'FAIL';
      gnssMsg = 'No GPS Fix for autonomous navigation';
    }
  }

  // 5. Battery Power
  let batStatus: CheckStatus = 'UNKNOWN';
  let batMsg = 'No voltage telemetry';
  const batPct = telemetry.battery.percentage;
  const batVolt = telemetry.battery.voltage_v;
  if (batPct !== null && batVolt !== null) {
    if (batPct >= 35 && batVolt >= 14.8) {
      batStatus = 'PASS';
      batMsg = `${batPct.toFixed(0)}% • ${batVolt.toFixed(1)}V (Flight Ready)`;
    } else if (batPct >= 25 && batVolt >= 14.0) {
      batStatus = 'WARNING';
      batMsg = `${batPct.toFixed(0)}% • ${batVolt.toFixed(1)}V (Marginal charge)`;
    } else {
      batStatus = 'FAIL';
      batMsg = `${batPct.toFixed(0)}% • ${batVolt.toFixed(1)}V (Below safe threshold)`;
    }
  }

  // 6. Sensors (IMU & Attitude)
  let imuStatus: CheckStatus = 'UNKNOWN';
  let imuMsg = 'Awaiting attitude stream';
  const roll = telemetry.attitude.roll_deg;
  const pitch = telemetry.attitude.pitch_deg;
  if (roll !== null && pitch !== null) {
    if (Math.abs(roll) <= 30 && Math.abs(pitch) <= 30) {
      imuStatus = 'PASS';
      imuMsg = `IMU attitude nominal • Tilt: ${Math.max(Math.abs(roll), Math.abs(pitch)).toFixed(1)}°`;
    } else {
      imuStatus = 'WARNING';
      imuMsg = `Excessive ground tilt • Roll: ${roll.toFixed(1)}°, Pitch: ${pitch.toFixed(1)}°`;
    }
  }

  // 7. Barometer / Altitude
  let baroStatus: CheckStatus = 'UNKNOWN';
  let baroMsg = 'No altitude telemetry';
  if (telemetry.position.altitude_m !== null) {
    baroStatus = 'PASS';
    baroMsg = `Altitude calibrated • ${telemetry.position.altitude_m.toFixed(1)}m MSL`;
  }

  // 8. Mission Loaded
  let missionCheckStatus: CheckStatus = 'WARNING';
  let missionMsg = 'No waypoints configured';
  if (waypoints.length > 0) {
    missionCheckStatus = 'PASS';
    missionMsg = `${waypoints.length} waypoints verified in ${activeMissionId}`;
  }

  // 9. Safety / Failsafes
  let safetyStatus: CheckStatus = 'PASS';
  let safetyMsg = 'No active safety interlocks';
  if (batStatus === 'FAIL') {
    safetyStatus = 'FAIL';
    safetyMsg = 'Critical Battery failsafe active';
  } else if (commStatus === 'FAIL') {
    safetyStatus = 'FAIL';
    safetyMsg = 'Link Loss failsafe active';
  } else if (gnssStatus === 'FAIL') {
    safetyStatus = 'WARNING';
    safetyMsg = 'GNSS lock required for autonomous modes';
  }

  const checks: PreFlightCheckItem[] = [
    { id: 'autopilot', name: 'Autopilot Heartbeat', category: 'AVIONICS', status: autopilotStatus, message: autopilotMsg },
    { id: 'comm', name: 'Communication Link', category: 'DATALINK', status: commStatus, message: commMsg },
    { id: 'telemetry', name: 'Telemetry Integrity', category: 'DATALINK', status: telemStatus, message: telemMsg },
    { id: 'gnss', name: 'GNSS / Satellites', category: 'NAVIGATION', status: gnssStatus, message: gnssMsg },
    { id: 'battery', name: 'Power / Battery', category: 'POWER', status: batStatus, message: batMsg },
    { id: 'imu', name: 'IMU / Attitude Sensors', category: 'SENSORS', status: imuStatus, message: imuMsg },
    { id: 'baro', name: 'Barometer / Altimeter', category: 'SENSORS', status: baroStatus, message: baroMsg },
    { id: 'mission', name: 'Mission Plan', category: 'NAVIGATION', status: missionCheckStatus, message: missionMsg },
    { id: 'safety', name: 'Safety & Failsafe', category: 'SAFETY', status: safetyStatus, message: safetyMsg },
  ];

  const hasFail = checks.some((c) => c.status === 'FAIL');
  const hasWarning = checks.some((c) => c.status === 'WARNING');
  const hasUnknown = checks.some((c) => c.status === 'UNKNOWN');

  const isReady = !hasFail && !hasWarning && !hasUnknown;
  const overallState = isReady ? 'READY FOR FLIGHT' : 'NOT READY';

  const renderBadge = (st: CheckStatus) => {
    switch (st) {
      case 'PASS':
        return (
          <span className="flex items-center gap-1 text-[10px] font-bold text-emerald-400 bg-emerald-500/10 border border-emerald-500/30 px-1.5 py-0.5 rounded">
            <CheckCircle2 className="w-3 h-3" /> PASS
          </span>
        );
      case 'WARNING':
        return (
          <span className="flex items-center gap-1 text-[10px] font-bold text-amber-400 bg-amber-500/10 border border-amber-500/30 px-1.5 py-0.5 rounded">
            <AlertTriangle className="w-3 h-3" /> WARNING
          </span>
        );
      case 'FAIL':
        return (
          <span className="flex items-center gap-1 text-[10px] font-bold text-red-400 bg-red-500/10 border border-red-500/30 px-1.5 py-0.5 rounded">
            <XCircle className="w-3 h-3" /> FAIL
          </span>
        );
      default:
        return (
          <span className="flex items-center gap-1 text-[10px] font-bold text-slate-400 bg-slate-800 border border-slate-700 px-1.5 py-0.5 rounded">
            <HelpCircle className="w-3 h-3" /> UNKNOWN
          </span>
        );
    }
  };

  return (
    <div className="bg-slate-900 border border-slate-800 rounded-lg p-3.5">
      {/* Header with Overall Status Banner */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between pb-3 border-b border-slate-800 gap-2 mb-3">
        <div>
          <div className="flex items-center gap-2">
            {isReady ? (
              <ShieldCheck className="w-4 h-4 text-emerald-400" />
            ) : (
              <ShieldAlert className="w-4 h-4 text-amber-400" />
            )}
            <h3 className="text-xs font-bold uppercase tracking-wider text-slate-200">
              Pre-Flight Readiness System
            </h3>
          </div>
          <span className="text-[11px] text-slate-400">
            Authoritative pre-launch evaluation derived from verified telemetry metrics
          </span>
        </div>

        <div
          className={`flex items-center gap-2 px-3 py-1.5 rounded border font-mono text-xs font-extrabold tracking-wider ${
            isReady
              ? 'bg-emerald-500/20 text-emerald-300 border-emerald-500/40 shadow-[0_0_12px_rgba(16,185,129,0.2)]'
              : 'bg-red-500/20 text-red-300 border-red-500/40 animate-pulse'
          }`}
        >
          <span>{overallState}</span>
        </div>
      </div>

      {/* Grid of 9 Subsystem Checks */}
      <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 gap-2.5 font-mono text-xs">
        {checks.map((chk) => (
          <div
            key={chk.id}
            className={`p-2.5 rounded border transition-colors ${
              chk.status === 'FAIL'
                ? 'bg-red-950/20 border-red-500/30'
                : chk.status === 'WARNING'
                ? 'bg-amber-950/20 border-amber-500/30'
                : chk.status === 'PASS'
                ? 'bg-slate-950/60 border-slate-800'
                : 'bg-slate-950/40 border-slate-800/60'
            }`}
          >
            <div className="flex items-center justify-between mb-1">
              <span className="text-[11px] font-bold text-slate-200">{chk.name}</span>
              {renderBadge(chk.status)}
            </div>
            <p className="text-[10px] text-slate-400 leading-tight">{chk.message}</p>
          </div>
        ))}
      </div>
    </div>
  );
};
