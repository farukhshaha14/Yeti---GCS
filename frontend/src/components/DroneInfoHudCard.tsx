import React, { useState } from 'react';
import {
  Satellite,
  Activity,
  ArrowUp,
  Gauge,
  Clock,
  ChevronDown,
  ChevronUp,
  MapPin,
} from 'lucide-react';
import type { NormalizedTelemetry } from '../types/telemetry';

interface DroneInfoHudCardProps {
  telemetry: NormalizedTelemetry;
  className?: string;
}

export const DroneInfoHudCard: React.FC<DroneInfoHudCardProps> = ({
  telemetry,
  className = '',
}) => {
  const [isCollapsed, setIsCollapsed] = useState(false);

  const gps = telemetry.gps;
  const nav = telemetry.navigation;
  const health = telemetry.data_health;
  const connStatus = health?.status ?? 'DISCONNECTED';
  const isDisconnected = connStatus === 'DISCONNECTED';
  const isStale = isDisconnected || gps.is_stale || connStatus === 'STALE';

  // Format Status Badge
  const getStatusBadge = () => {
    if (isDisconnected) {
      return {
        label: 'DISCONNECTED',
        color: 'bg-rose-500/20 text-rose-300 border-rose-500/40',
        dot: 'bg-rose-500',
      };
    }
    if (isStale) {
      return {
        label: 'LAST KNOWN (STALE)',
        color: 'bg-amber-500/20 text-amber-300 border-amber-500/40',
        dot: 'bg-amber-500',
      };
    }
    return {
      label: 'LIVE TELEMETRY',
      color: 'bg-emerald-500/20 text-emerald-300 border-emerald-500/40',
      dot: 'bg-emerald-400 animate-pulse',
    };
  };

  const status = getStatusBadge();

  // Packet age / last contact
  const packetAgeMs = health?.last_packet_age_ms;
  const lastContactStr =
    packetAgeMs !== null && packetAgeMs !== undefined && !isDisconnected
      ? packetAgeMs < 1000
        ? `${Math.round(packetAgeMs)}ms ago`
        : `${(packetAgeMs / 1000).toFixed(1)}s ago`
      : 'NO SIGNAL';

  // Signal link assessment
  const latency = health?.transport_latency_ms;
  const loss = health?.packet_loss_percent ?? 0;
  const linkQuality = isDisconnected
    ? 'LOST'
    : loss > 10 || (latency !== null && latency > 400)
    ? 'DEGRADED'
    : 'STRONG';

  const linkQualityColor =
    linkQuality === 'STRONG'
      ? 'text-emerald-400'
      : linkQuality === 'DEGRADED'
      ? 'text-amber-400'
      : 'text-rose-400';

  const lat = gps.latitude ?? telemetry.position.latitude;
  const lon = gps.longitude ?? telemetry.position.longitude;
  const altM = gps.altitude_m ?? telemetry.position.altitude_m;
  const relAltM = gps.relative_altitude_m ?? telemetry.position.relative_altitude_m;
  const spd = nav?.ground_speed_mps ?? telemetry.velocity.ground_speed_mps;
  const vz = telemetry.velocity.vertical_speed_mps;

  return (
    <div
      className={`rounded-xl bg-slate-950/85 backdrop-blur-md border border-slate-800 shadow-2xl font-mono text-xs overflow-hidden select-none transition-all ${className}`}
      style={{ minWidth: 260, maxWidth: 300 }}
    >
      {/* Header Bar */}
      <div className="flex items-center justify-between px-3 py-2 bg-slate-900/90 border-b border-slate-800">
        <div className="flex items-center gap-2">
          <div className="w-2.5 h-2.5 rounded-full bg-cyan-400 shadow-[0_0_8px_#06b6d4]" />
          <div>
            <div className="text-[11px] font-bold text-white tracking-wider flex items-center gap-1.5">
              <span>{telemetry.drone_id || 'VEGAPilot-01'}</span>
            </div>
          </div>
        </div>

        <div className="flex items-center gap-1.5">
          <span className={`px-1.5 py-0.5 rounded text-[9px] font-bold border flex items-center gap-1 ${status.color}`}>
            <span className={`w-1.5 h-1.5 rounded-full ${status.dot}`} />
            {status.label}
          </span>
          <button
            onClick={() => setIsCollapsed(!isCollapsed)}
            className="p-1 rounded hover:bg-slate-800 text-slate-400 hover:text-white transition"
            title={isCollapsed ? 'Expand HUD' : 'Collapse HUD'}
          >
            {isCollapsed ? <ChevronDown className="w-3.5 h-3.5" /> : <ChevronUp className="w-3.5 h-3.5" />}
          </button>
        </div>
      </div>

      {/* Expanded Body */}
      {!isCollapsed && (
        <div className="p-3 space-y-2.5 text-[11px]">
          {/* Link & Latency Readout */}
          <div className="grid grid-cols-2 gap-2 pb-2 border-b border-slate-800/80">
            <div>
              <span className="text-[9px] text-slate-500 uppercase block flex items-center gap-1">
                <Clock className="w-2.5 h-2.5" /> Last Contact
              </span>
              <span className="text-slate-200 font-bold">{lastContactStr}</span>
            </div>
            <div>
              <span className="text-[9px] text-slate-500 uppercase block flex items-center gap-1">
                <Activity className="w-2.5 h-2.5" /> Link Signal
              </span>
              <span className={`font-bold ${linkQualityColor}`}>{linkQuality}</span>
              {latency !== null && latency !== undefined && !isDisconnected && (
                <span className="text-[9px] text-slate-400 ml-1">({Math.round(latency)}ms)</span>
              )}
            </div>
          </div>

          {/* Altitude & Speed Metrics */}
          <div className="grid grid-cols-2 gap-2 pb-2 border-b border-slate-800/80">
            <div>
              <span className="text-[9px] text-slate-500 uppercase block flex items-center gap-1">
                <ArrowUp className="w-2.5 h-2.5 text-cyan-400" /> Altitude MSL
              </span>
              <span className="text-white font-bold text-xs">
                {altM !== null ? `${altM.toFixed(1)} m` : 'N/A'}
              </span>
              {relAltM !== null && relAltM !== undefined && (
                <span className="text-[9px] text-slate-400 block">
                  AGL: <strong className="text-cyan-300">{relAltM.toFixed(1)}m</strong>
                </span>
              )}
            </div>

            <div>
              <span className="text-[9px] text-slate-500 uppercase block flex items-center gap-1">
                <Gauge className="w-2.5 h-2.5 text-emerald-400" /> Ground Speed
              </span>
              <span className="text-white font-bold text-xs">
                {spd !== null ? `${spd.toFixed(1)} m/s` : 'N/A'}
              </span>
              {vz !== null && vz !== undefined && (
                <span className="text-[9px] text-slate-400 block">
                  V.Spd: <strong className={vz >= 0 ? 'text-emerald-400' : 'text-rose-400'}>
                    {vz >= 0 ? `+${vz.toFixed(1)}` : vz.toFixed(1)} m/s
                  </strong>
                </span>
              )}
            </div>
          </div>

          {/* GPS Quality & Constellation */}
          <div className="grid grid-cols-2 gap-2 pb-2 border-b border-slate-800/80">
            <div>
              <span className="text-[9px] text-slate-500 uppercase block flex items-center gap-1">
                <Satellite className="w-2.5 h-2.5 text-amber-400" /> GPS Fix
              </span>
              <span className={`font-bold ${gps.gps_fix && !isDisconnected ? 'text-emerald-400' : 'text-rose-400'}`}>
                {isDisconnected ? 'DISCONNECTED' : gps.fix_status || 'NO_FIX'}
              </span>
              {gps.satellites !== null && (
                <span className="text-[9px] text-slate-400 block">
                  {gps.satellites} Sats Visible
                </span>
              )}
            </div>

            <div>
              <span className="text-[9px] text-slate-500 uppercase block">HDOP / VDOP</span>
              <span className="text-slate-200 font-bold">
                {gps.hdop !== null && gps.hdop !== undefined ? gps.hdop.toFixed(2) : 'N/A'}
                <span className="text-slate-500 mx-1">/</span>
                {gps.vdop !== null && gps.vdop !== undefined ? gps.vdop.toFixed(2) : 'N/A'}
              </span>
              <span className="text-[9px] text-slate-400 block">Accuracy Est.</span>
            </div>
          </div>

          {/* Coordinates Readout */}
          <div className="pt-0.5">
            <span className="text-[9px] text-slate-500 uppercase block flex items-center gap-1">
              <MapPin className="w-2.5 h-2.5 text-cyan-400" /> Coordinates (WGS-84)
            </span>
            <div className="text-[10px] text-slate-200 flex justify-between items-center mt-0.5">
              <span>LAT: <strong className="text-white font-mono">{lat !== null ? lat.toFixed(6) : 'N/A'}°</strong></span>
              <span>LON: <strong className="text-white font-mono">{lon !== null ? lon.toFixed(6) : 'N/A'}°</strong></span>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};
