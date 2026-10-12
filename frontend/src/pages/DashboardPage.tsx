import React from 'react';
import { AlertTriangle, AlertOctagon } from 'lucide-react';
import { PrimaryFlightDisplay } from '../components/PrimaryFlightDisplay';
import { ArtificialHorizon } from '../components/ArtificialHorizon';
import { TelemetryHealthPanel } from '../components/TelemetryHealthPanel';
import { OfflineMapPanel } from '../components/OfflineMapPanel';
import { MissionStatusWidget } from '../components/MissionStatusWidget';
import { SafetyFailsafePanel } from '../components/SafetyFailsafePanel';
import { SensorHealthWidget } from '../components/SensorHealthWidget';
import { PreFlightCheckPanel } from '../components/PreFlightCheckPanel';
import { OperatorControlPanel } from '../components/OperatorControlPanel';
import { ActivityEventLog } from '../components/ActivityEventLog';
import { useTelemetryStore } from '../stores/useTelemetryStore';
import { useConnectionStore } from '../stores/useConnectionStore';
import { useDataHealthStore } from '../stores/useDataHealthStore';
import { useMissionStore } from '../stores/useMissionStore';

export const DashboardPage: React.FC = () => {
  const { telemetry } = useTelemetryStore();
  const { status } = useConnectionStore();
  const { health } = useDataHealthStore();
  const { activeMissionId } = useMissionStore();

  const isStale = status === 'STALE' || status === 'DISCONNECTED';
  const dataAgeSec = health.last_packet_age_ms !== null ? (health.last_packet_age_ms / 1000).toFixed(1) : '--';

  // Critical Fault Condition Check
  const batPct = telemetry.battery.percentage;
  const isCriticalBattery = batPct !== null && batPct <= 15;
  const isArmed = telemetry.flight.armed === true;
  const isUnstableTilt = isArmed && Math.max(Math.abs(telemetry.attitude.roll_deg ?? 0), Math.abs(telemetry.attitude.pitch_deg ?? 0)) > 45;

  return (
    <div className="space-y-4">
      {/* 1. High-Priority Safety Critical Fault Banner (Immediately visible when safety fault occurs) */}
      {(isCriticalBattery || isUnstableTilt) && (
        <div className="bg-red-950/60 border-2 border-red-500 rounded-lg p-3.5 flex flex-col md:flex-row items-start md:items-center justify-between gap-3 font-mono text-xs shadow-xl animate-pulse">
          <div className="flex items-center gap-3">
            <div className="w-9 h-9 rounded bg-red-600/30 flex items-center justify-center text-red-400 shrink-0">
              <AlertOctagon className="w-5 h-5" />
            </div>
            <div>
              <div className="flex items-center gap-2">
                <span className="font-extrabold text-red-200 tracking-wider text-sm">
                  {isCriticalBattery ? 'EMERGENCY: CRITICAL BATTERY DEPLETION (≤15%)' : 'EMERGENCY: UNSTABLE FLIGHT ATTITUDE EXCEEDED'}
                </span>
                <span className="bg-red-500/30 text-red-300 px-2 py-0.5 rounded text-[10px] font-bold">
                  AUTOPILOT FAILSAFE TRIGGERED
                </span>
              </div>
              <div className="text-[11px] text-red-300/90 mt-1">
                {isCriticalBattery
                  ? `Battery remaining: ${batPct?.toFixed(0)}% (${telemetry.battery.voltage_v?.toFixed(1)}V) • Flight controller executing forced touchdown descent`
                  : `Attitude exceeded 45° tilt envelope • Autopilot rate dampening & recovery active`}
              </div>
            </div>
          </div>
          <div className="text-right shrink-0">
            <span className="text-xs font-bold text-red-200 bg-red-900/60 px-2.5 py-1 rounded border border-red-500/50">
              SAFETY ACTION MANDATORY
            </span>
          </div>
        </div>
      )}

      {/* 2. Telemetry Loss & Autonomous Failsafe Status Banner (Section 8 / Requirement 20) */}
      {isStale && !isCriticalBattery && !isUnstableTilt && (
        <div className="bg-amber-950/40 border border-amber-500/40 rounded-lg p-3.5 flex flex-col md:flex-row items-start md:items-center justify-between gap-3 font-mono text-xs shadow-lg">
          <div className="flex items-start md:items-center gap-3">
            <div className="w-8 h-8 rounded bg-amber-500/20 flex items-center justify-center text-amber-400 shrink-0 mt-0.5 md:mt-0">
              <AlertTriangle className="w-4 h-4" />
            </div>
            <div>
              <div className="flex flex-wrap items-center gap-2">
                <span className="font-bold text-amber-300 tracking-wider">
                  {status === 'DISCONNECTED' ? 'TELEMETRY LINK LOST' : 'TELEMETRY LINK DEGRADED / STALE'}
                </span>
                <span className="bg-amber-500/20 text-amber-400 px-1.5 py-0.5 rounded text-[10px]">
                  PRESERVING LAST REPORTED STATE
                </span>
              </div>
              <div className="text-[11px] text-slate-300 mt-1 flex flex-wrap gap-x-4 gap-y-1">
                <span>Last Position: <strong className="text-white">{telemetry.position.latitude !== null ? `${telemetry.position.latitude.toFixed(5)}°` : '--'}, {telemetry.position.longitude !== null ? `${telemetry.position.longitude.toFixed(5)}°` : '--'}</strong></span>
                <span>Last Alt: <strong className="text-white">{telemetry.position.altitude_m !== null ? `${telemetry.position.altitude_m.toFixed(1)} m` : '--'} MSL</strong></span>
                <span>Last Mode: <strong className="text-cyan-400">{telemetry.flight.mode ?? 'UNKNOWN'} {telemetry.flight.armed ? '(ARMED)' : '(DISARMED)'}</strong></span>
                <span>Mission: <strong className="text-slate-200">{activeMissionId}</strong></span>
                <span>Data Age: <strong className="text-amber-400">{dataAgeSec} s</strong></span>
              </div>
            </div>
          </div>
          <div className="text-[10px] text-slate-400 md:text-right shrink-0">
            <span className="text-slate-300 font-semibold">Autopilot Authoritative</span>
            <div className="text-slate-500">Autonomous flight continuing per configured failsafe</div>
          </div>
        </div>
      )}

      {/* 3. Flight Primary Telemetry Readouts (PFD) */}
      <PrimaryFlightDisplay />

      {/* 4. Center Layout: Attitude Instrument, Tactical Map, and Telemetry Verification Panel */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
        {/* Left: Artificial Horizon Attitude */}
        <div className="lg:col-span-1">
          <ArtificialHorizon
            rollDeg={telemetry.attitude.roll_deg}
            pitchDeg={telemetry.attitude.pitch_deg}
            yawDeg={telemetry.attitude.yaw_deg}
            isStale={isStale}
          />
        </div>

        {/* Center: Tactical Offline Map */}
        <div className="lg:col-span-1">
          <OfflineMapPanel />
        </div>

        {/* Right: Telemetry Health & Verification Metrics */}
        <div className="lg:col-span-1">
          <TelemetryHealthPanel />
        </div>
      </div>

      {/* 5. Mission Status, Safety Failsafe Monitor, and Sensor Health */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
        <MissionStatusWidget />
        <SafetyFailsafePanel />
        <SensorHealthWidget />
      </div>

      {/* 6. Pre-Flight Readiness Subsystem Check */}
      <PreFlightCheckPanel />

      {/* 7. Operator Flight Controls & Activity Event Stream */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        <OperatorControlPanel />
        <ActivityEventLog />
      </div>
    </div>
  );
};
