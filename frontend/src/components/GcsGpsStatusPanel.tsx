import React from 'react';
import { Satellite, Compass, AlertTriangle, CheckCircle, ShieldAlert } from 'lucide-react';
import { useTelemetryStore } from '../stores/useTelemetryStore';

interface GcsGpsStatusPanelProps {
  className?: string;
  compact?: boolean;
}

export const GcsGpsStatusPanel: React.FC<GcsGpsStatusPanelProps> = ({ className = '', compact = false }) => {
  const { telemetry } = useTelemetryStore();
  const gps = telemetry.gps;
  const pos = telemetry.position;
  const att = telemetry.attitude;

  // Derive values preferring GPS telemetry, falling back to position/attitude if available
  const lat = gps.latitude ?? pos.latitude;
  const lon = gps.longitude ?? pos.longitude;
  const alt = gps.altitude_m ?? pos.altitude_m;
  const relAlt = gps.relative_altitude_m ?? pos.relative_altitude_m;
  const heading = telemetry.navigation?.heading_deg ?? gps.heading_deg ?? att.yaw_deg;
  const sats = gps.satellites;
  const hdop = gps.hdop;
  const vdop = gps.vdop;
  const connStatus = telemetry.data_health?.status ?? 'DISCONNECTED';
  const isDisconnected = connStatus === 'DISCONNECTED';
  const isStale = isDisconnected || gps.is_stale || connStatus === 'STALE' || (gps.last_update_ms ? (Date.now() - gps.last_update_ms > 3000) : false);
  const hasFix = !isDisconnected && gps.gps_fix && lat !== null && lon !== null && !isStale;

  const fixLabel = !hasFix
    ? (isDisconnected ? 'LINK DISCONNECTED' : isStale ? 'GPS DATA STALE' : 'NO GPS FIX')
    : (gps.fix_status && gps.fix_status !== 'NO_FIX' ? gps.fix_status : (gps.fix_type === 3 ? '3D FIX' : 'FIXED'));

  const lastUpdateStr = gps.last_update_ms
    ? `${Math.max(0, Math.round((Date.now() - gps.last_update_ms) / 1000))}s ago`
    : (gps.timestamp ? new Date(gps.timestamp).toLocaleTimeString() : '--');

  if (compact) {
    return (
      <div className={`flex items-center gap-3 px-3 py-1.5 bg-slate-950/85 backdrop-blur border border-slate-800 rounded font-mono text-[11px] ${className}`}>
        <div className="flex items-center gap-1.5">
          {hasFix ? (
            <CheckCircle className="w-3.5 h-3.5 text-emerald-400" />
          ) : isStale ? (
            <AlertTriangle className="w-3.5 h-3.5 text-amber-400 animate-pulse" />
          ) : (
            <ShieldAlert className="w-3.5 h-3.5 text-rose-400" />
          )}
          <span className={`font-bold ${hasFix ? 'text-emerald-400' : isStale ? 'text-amber-400' : 'text-rose-400'}`}>
            {fixLabel}
          </span>
        </div>
        <div className="text-slate-400">
          LAT: <span className="text-slate-200">{lat !== null ? lat.toFixed(6) : '--'}</span>
        </div>
        <div className="text-slate-400">
          LON: <span className="text-slate-200">{lon !== null ? lon.toFixed(6) : '--'}</span>
        </div>
        <div className="text-slate-400">
          ALT: <span className="text-slate-200">{alt !== null ? `${alt.toFixed(1)}m` : '--'}</span>
        </div>
        <div className="text-slate-400">
          SAT: <span className="text-cyan-400">{sats !== null ? sats : '--'}</span>
        </div>
        {hdop !== null && hdop !== undefined && (
          <div className="text-slate-400">
            HDOP: <span className="text-slate-200">{hdop.toFixed(1)}</span>
          </div>
        )}
        <div className="text-slate-400">
          HDG: <span className="text-slate-200">{heading !== null ? `${Math.round(heading)}°` : '--'}</span>
        </div>
      </div>
    );
  }

  return (
    <div className={`bg-slate-900 border border-slate-800 rounded-lg p-3 font-mono text-xs ${className}`}>
      {/* Header */}
      <div className="flex items-center justify-between pb-2 mb-2.5 border-b border-slate-800">
        <div className="flex items-center gap-2">
          <Satellite className="w-4 h-4 text-cyan-400" />
          <span className="font-bold uppercase tracking-wider text-slate-200 text-[11px]">
            GNSS / GPS Receiver State
          </span>
        </div>
        <div className="flex items-center gap-1.5">
          {hasFix ? (
            <span className="px-2 py-0.5 rounded text-[10px] font-bold bg-emerald-500/10 text-emerald-400 border border-emerald-500/30 flex items-center gap-1">
              <span className="w-1.5 h-1.5 rounded-full bg-emerald-400 animate-pulse" />
              {fixLabel}
            </span>
          ) : isStale ? (
            <span className="px-2 py-0.5 rounded text-[10px] font-bold bg-amber-500/10 text-amber-400 border border-amber-500/30 flex items-center gap-1">
              <AlertTriangle className="w-3 h-3 text-amber-400" />
              {isDisconnected ? 'LINK DISCONNECTED' : 'GPS DATA STALE'}
            </span>
          ) : (
            <span className="px-2 py-0.5 rounded text-[10px] font-bold bg-rose-500/10 text-rose-400 border border-rose-500/30 flex items-center gap-1">
              <ShieldAlert className="w-3 h-3 text-rose-400" />
              NO GPS FIX
            </span>
          )}
        </div>
      </div>

      {/* Grid of Key GPS Metrics */}
      <div className="grid grid-cols-2 sm:grid-cols-4 md:grid-cols-7 gap-2 text-center">
        <div className="bg-slate-950/70 p-2 rounded border border-slate-800/80">
          <span className="text-[9px] text-slate-500 uppercase block tracking-wider">LATITUDE</span>
          <span className="text-slate-100 font-bold text-xs mt-0.5 block">
            {lat !== null ? `${lat.toFixed(6)}°` : '--'}
          </span>
        </div>

        <div className="bg-slate-950/70 p-2 rounded border border-slate-800/80">
          <span className="text-[9px] text-slate-500 uppercase block tracking-wider">LONGITUDE</span>
          <span className="text-slate-100 font-bold text-xs mt-0.5 block">
            {lon !== null ? `${lon.toFixed(6)}°` : '--'}
          </span>
        </div>

        <div className="bg-slate-950/70 p-2 rounded border border-slate-800/80">
          <span className="text-[9px] text-slate-500 uppercase block tracking-wider">ALTITUDE</span>
          <span className="text-emerald-400 font-bold text-xs mt-0.5 block">
            {alt !== null ? `${alt.toFixed(1)} m` : '--'}
          </span>
          {relAlt !== null && relAlt !== undefined && (
            <span className="text-[9px] text-slate-400 block mt-0.5">
              Rel: {relAlt.toFixed(1)}m
            </span>
          )}
        </div>

        <div className="bg-slate-950/70 p-2 rounded border border-slate-800/80">
          <span className="text-[9px] text-slate-500 uppercase block tracking-wider flex items-center justify-center gap-1">
            <Compass className="w-2.5 h-2.5 text-cyan-400" /> HEADING
          </span>
          <span className="text-cyan-300 font-bold text-xs mt-0.5 block">
            {heading !== null ? `${Math.round(heading)}°` : '--'}
          </span>
        </div>

        <div className="bg-slate-950/70 p-2 rounded border border-slate-800/80">
          <span className="text-[9px] text-slate-500 uppercase block tracking-wider flex items-center justify-center gap-1">
            <Satellite className="w-2.5 h-2.5 text-amber-400" /> SATELLITES
          </span>
          <span className="text-amber-300 font-bold text-xs mt-0.5 block">
            {sats !== null ? sats : '--'}
          </span>
        </div>

        <div className="bg-slate-950/70 p-2 rounded border border-slate-800/80">
          <span className="text-[9px] text-slate-500 uppercase block tracking-wider">HDOP / VDOP</span>
          <span className="text-slate-200 font-bold text-xs mt-0.5 block">
            {hdop !== null && hdop !== undefined ? hdop.toFixed(1) : '--'} / {vdop !== null && vdop !== undefined ? vdop.toFixed(1) : '--'}
          </span>
        </div>

        <div className="bg-slate-950/70 p-2 rounded border border-slate-800/80">
          <span className="text-[9px] text-slate-500 uppercase block tracking-wider">LAST UPDATE</span>
          <span className={`text-xs mt-0.5 block font-bold ${isStale ? 'text-amber-400' : 'text-slate-400'}`}>
            {lastUpdateStr}
          </span>
        </div>
      </div>
    </div>
  );
};
