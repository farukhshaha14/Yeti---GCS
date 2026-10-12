import React from 'react';
import { Battery, Navigation, Gauge, Shield, Satellite } from 'lucide-react';
import { useTelemetryStore } from '../stores/useTelemetryStore';
import { useConnectionStore } from '../stores/useConnectionStore';

export const PrimaryFlightDisplay: React.FC = () => {
  const { telemetry } = useTelemetryStore();
  const { status } = useConnectionStore();

  const isStale = status === 'STALE' || status === 'DISCONNECTED';

  const formatNum = (val: number | null | undefined, dec = 1, fallback = '--') => {
    return val !== null && val !== undefined ? val.toFixed(dec) : fallback;
  };

  const getGpsFixLabel = (fix: number | null | undefined) => {
    switch (fix) {
      case 3:
        return '3D FIX';
      case 2:
        return '2D FIX';
      case 4:
        return 'DGPS';
      case 5:
        return 'RTK FLOAT';
      case 6:
        return 'RTK FIXED';
      default:
        return fix !== null && fix !== undefined ? `FIX (${fix})` : 'NO FIX';
    }
  };

  const isArmed = telemetry.flight.armed === true;

  return (
    <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
      {/* 1. Altitude Card */}
      <div className="bg-slate-900 border border-slate-800 rounded-lg p-3.5 flex flex-col justify-between relative overflow-hidden">
        <div className="flex items-center justify-between text-slate-400">
          <span className="text-[11px] font-semibold uppercase tracking-wider flex items-center gap-1.5">
            <Gauge className="w-3.5 h-3.5 text-cyan-400" /> Altitude
          </span>
          {isStale && <span className="text-[9px] font-mono text-amber-400 bg-amber-500/10 px-1 rounded">LAST KNOWN</span>}
        </div>
        <div className="my-2">
          <div className="text-3xl font-extrabold font-mono text-slate-100 tracking-tight">
            {formatNum(telemetry.position.altitude_m, 1)} <span className="text-sm font-normal text-slate-400">m</span>
          </div>
          <div className="text-xs font-mono text-slate-400 mt-0.5">
            Rel: <span className="text-cyan-300 font-semibold">{formatNum(telemetry.position.relative_altitude_m, 1)} m</span>
          </div>
        </div>
        <div className="text-[11px] text-slate-400 flex items-center justify-between pt-1 border-t border-slate-800/60 font-mono">
          <span>Baro/GPS</span>
          <span>MSL</span>
        </div>
      </div>

      {/* 2. Speed Card */}
      <div className="bg-slate-900 border border-slate-800 rounded-lg p-3.5 flex flex-col justify-between relative overflow-hidden">
        <div className="flex items-center justify-between text-slate-400">
          <span className="text-[11px] font-semibold uppercase tracking-wider flex items-center gap-1.5">
            <Navigation className="w-3.5 h-3.5 text-cyan-400" /> Ground Speed
          </span>
          {isStale && <span className="text-[9px] font-mono text-amber-400 bg-amber-500/10 px-1 rounded">LAST KNOWN</span>}
        </div>
        <div className="my-2">
          <div className="text-3xl font-extrabold font-mono text-slate-100 tracking-tight">
            {formatNum(telemetry.velocity.ground_speed_mps, 1)}{' '}
            <span className="text-sm font-normal text-slate-400">m/s</span>
          </div>
          <div className="text-xs font-mono text-slate-400 mt-0.5">
            V-Speed:{' '}
            <span className={`${(telemetry.velocity.vertical_speed_mps ?? 0) >= 0 ? 'text-emerald-400' : 'text-amber-400'} font-semibold`}>
              {formatNum(telemetry.velocity.vertical_speed_mps, 1)} m/s
            </span>
          </div>
        </div>
        <div className="text-[11px] text-slate-400 flex items-center justify-between pt-1 border-t border-slate-800/60 font-mono">
          <span>{telemetry.velocity.ground_speed_mps ? (telemetry.velocity.ground_speed_mps * 3.6).toFixed(1) : '--'} km/h</span>
          <span>Kinematic</span>
        </div>
      </div>

      {/* 3. Battery Card */}
      <div className="bg-slate-900 border border-slate-800 rounded-lg p-3.5 flex flex-col justify-between relative overflow-hidden">
        <div className="flex items-center justify-between text-slate-400">
          <span className="text-[11px] font-semibold uppercase tracking-wider flex items-center gap-1.5">
            <Battery className="w-3.5 h-3.5 text-emerald-400" /> Power / Battery
          </span>
          <div className="flex items-center gap-1">
            {telemetry.battery.percentage === null ? (
              <span className="text-[9px] font-mono text-slate-500 bg-slate-800 px-1 rounded">NO DATA</span>
            ) : (telemetry.battery.percentage ?? 100) <= 15 ? (
              <span className="text-[9px] font-mono font-bold text-red-400 bg-red-500/20 border border-red-500/40 px-1 rounded animate-pulse">
                CRITICAL WARNING
              </span>
            ) : (telemetry.battery.percentage ?? 100) <= 25 ? (
              <span className="text-[9px] font-mono font-bold text-amber-400 bg-amber-500/20 border border-amber-500/40 px-1 rounded">
                LOW WARNING
              </span>
            ) : (
              <span className="text-[9px] font-mono font-semibold text-emerald-400 bg-emerald-500/10 border border-emerald-500/30 px-1 rounded">
                NORMAL
              </span>
            )}
            {isStale && <span className="text-[9px] font-mono text-amber-400 bg-amber-500/10 px-1 rounded">LAST KNOWN</span>}
          </div>
        </div>
        <div className="my-2">
          <div className="flex items-baseline gap-2">
            <span className={`text-3xl font-extrabold font-mono tracking-tight ${
              (telemetry.battery.percentage ?? 100) <= 15
                ? 'text-red-500 animate-pulse'
                : (telemetry.battery.percentage ?? 100) <= 25
                ? 'text-amber-400'
                : 'text-emerald-400'
            }`}>
              {formatNum(telemetry.battery.percentage, 0)}%
            </span>
            <span className="text-sm font-mono text-slate-300">
              {formatNum(telemetry.battery.voltage_v, 1)} V
            </span>
          </div>
          <div className="text-xs font-mono text-slate-400 mt-0.5">
            Draw: <span className="text-slate-200 font-semibold">{formatNum(telemetry.battery.current_a, 1)} A</span>
          </div>
        </div>
        <div className="w-full bg-slate-800 h-1.5 rounded-full overflow-hidden">
          <div
            className={`h-full transition-all duration-300 ${
              (telemetry.battery.percentage ?? 100) <= 15
                ? 'bg-red-500'
                : (telemetry.battery.percentage ?? 100) <= 25
                ? 'bg-amber-500'
                : 'bg-emerald-500'
            }`}
            style={{ width: `${Math.max(0, Math.min(100, telemetry.battery.percentage ?? 0))}%` }}
          />
        </div>
      </div>

      {/* 4. Flight State & Mode */}
      <div className="bg-slate-900 border border-slate-800 rounded-lg p-3.5 flex flex-col justify-between relative overflow-hidden">
        <div className="flex items-center justify-between text-slate-400">
          <span className="text-[11px] font-semibold uppercase tracking-wider flex items-center gap-1.5">
            <Shield className="w-3.5 h-3.5 text-cyan-400" /> Flight State
          </span>
          <div className="flex items-center gap-1.5">
            {telemetry.flight.mode === 'RTL' && (
              <span className="text-[9px] font-bold px-1.5 py-0.5 rounded bg-amber-500/20 text-amber-300 border border-amber-500/40 animate-pulse">
                RTH ACTIVE
              </span>
            )}
            {isArmed ? (
              <span className="text-[10px] font-bold px-1.5 py-0.5 rounded bg-red-500/20 text-red-400 border border-red-500/40 animate-pulse">
                ARMED
              </span>
            ) : (
              <span className="text-[10px] font-bold px-1.5 py-0.5 rounded bg-slate-800 text-slate-400">
                DISARMED
              </span>
            )}
          </div>
        </div>
        <div className="my-2">
          <div className="text-2xl font-black font-mono text-cyan-300 tracking-wide">
            {telemetry.flight.mode || 'STANDBY'}
          </div>
          <div className="text-xs font-mono text-slate-400 mt-1 flex items-center gap-2">
            <Satellite className="w-3 h-3 text-cyan-400" />
            <span>{getGpsFixLabel(telemetry.gps.fix_type)}</span>
            <span>•</span>
            <span className="text-slate-200 font-semibold">{telemetry.gps.satellites ?? 0} sats</span>
          </div>
        </div>
        <div className="text-[11px] text-slate-400 flex items-center justify-between pt-1 border-t border-slate-800/60 font-mono">
          <span>Seq #{telemetry.source_sequence ?? '--'}</span>
          <span>Recv #{telemetry.received_sequence}</span>
        </div>
      </div>
    </div>
  );
};
