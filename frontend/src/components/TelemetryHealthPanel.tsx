import React from 'react';
import { Activity, AlertOctagon, CheckCircle2 } from 'lucide-react';
import { useDataHealthStore } from '../stores/useDataHealthStore';
import { useConnectionStore } from '../stores/useConnectionStore';

export const TelemetryHealthPanel: React.FC = () => {
  const { health } = useDataHealthStore();
  const { status } = useConnectionStore();

  const formatAge = (ageMs: number | null) => {
    if (ageMs === null) return '--';
    if (ageMs < 1000) return `${(ageMs / 1000).toFixed(2)} s`;
    return `${(ageMs / 1000).toFixed(1)} s`;
  };

  return (
    <div className="bg-slate-900 border border-slate-800 rounded-lg p-4">
      <div className="flex items-center justify-between border-b border-slate-800 pb-2.5 mb-3">
        <div className="flex items-center gap-2">
          <Activity className="w-4 h-4 text-emerald-400" />
          <h3 className="text-xs font-bold uppercase tracking-wider text-slate-200">
            Telemetry Integrity & Verification
          </h3>
        </div>
        <div className="text-[11px] font-mono text-slate-400">
          Loss Rate:{' '}
          <span
            className={`font-bold ${
              health.packet_loss_percent > 1.0 ? 'text-red-400' : 'text-emerald-400'
            }`}
          >
            {health.packet_loss_percent.toFixed(3)}%
          </span>
        </div>
      </div>

      {/* Grid of Key Integrity Metrics */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-2.5 font-mono text-xs">
        {/* Packets Received */}
        <div className="bg-slate-950/70 p-2.5 rounded border border-slate-800/80">
          <span className="text-[10px] text-slate-400 block uppercase">Packets Received</span>
          <span className="text-base font-bold text-slate-100">
            {health.received_packets.toLocaleString()}
          </span>
        </div>

        {/* Missing / Gaps */}
        <div className="bg-slate-950/70 p-2.5 rounded border border-slate-800/80">
          <span className="text-[10px] text-slate-400 block uppercase">Gaps Observed</span>
          <span className={`text-base font-bold ${health.missing_packets > 0 ? 'text-amber-400' : 'text-slate-100'}`}>
            {health.missing_packets.toLocaleString()}
          </span>
        </div>

        {/* Recovered */}
        <div className="bg-slate-950/70 p-2.5 rounded border border-slate-800/80">
          <span className="text-[10px] text-slate-400 block uppercase flex items-center gap-1">
            <CheckCircle2 className="w-3 h-3 text-emerald-400" /> Recovered
          </span>
          <span className="text-base font-bold text-emerald-400">
            {health.recovered_packets.toLocaleString()}
          </span>
        </div>

        {/* Unrecovered */}
        <div className="bg-slate-950/70 p-2.5 rounded border border-slate-800/80">
          <span className="text-[10px] text-slate-400 block uppercase flex items-center gap-1">
            <AlertOctagon className="w-3 h-3 text-red-400" /> Unrecovered
          </span>
          <span className={`text-base font-bold ${health.unrecovered_packets > 0 ? 'text-red-400' : 'text-slate-100'}`}>
            {health.unrecovered_packets.toLocaleString()}
          </span>
        </div>

        {/* Duplicates */}
        <div className="bg-slate-950/70 p-2.5 rounded border border-slate-800/80">
          <span className="text-[10px] text-slate-400 block uppercase">Duplicates</span>
          <span className="text-sm font-semibold text-slate-300">
            {health.duplicate_packets.toLocaleString()}
          </span>
        </div>

        {/* Out of Order */}
        <div className="bg-slate-950/70 p-2.5 rounded border border-slate-800/80">
          <span className="text-[10px] text-slate-400 block uppercase">Out of Order</span>
          <span className="text-sm font-semibold text-slate-300">
            {health.out_of_order_packets.toLocaleString()}
          </span>
        </div>

        {/* Invalid */}
        <div className="bg-slate-950/70 p-2.5 rounded border border-slate-800/80">
          <span className="text-[10px] text-slate-400 block uppercase">Corrupt / Invalid</span>
          <span className={`text-sm font-semibold ${health.invalid_packets > 0 ? 'text-red-400' : 'text-slate-300'}`}>
            {health.invalid_packets.toLocaleString()}
          </span>
        </div>

        {/* Last Packet Age */}
        <div className="bg-slate-950/70 p-2.5 rounded border border-slate-800/80">
          <span className="text-[10px] text-slate-400 block uppercase">Last Packet Age</span>
          <span className={`text-sm font-semibold ${status === 'CONNECTED' ? 'text-emerald-400' : 'text-amber-400'}`}>
            {formatAge(health.last_packet_age_ms)}
          </span>
        </div>
      </div>

      {/* Latency & Jitter Footer Summary */}
      <div className="grid grid-cols-3 gap-2 mt-3 pt-2.5 border-t border-slate-800/60 font-mono text-[11px] text-slate-400">
        <div>
          <span>Avg Latency: </span>
          <span className="text-slate-200 font-bold">
            {health.latency_ms !== null ? `${Math.round(health.latency_ms)} ms` : '--'}
          </span>
        </div>
        <div>
          <span>Transport Latency: </span>
          <span className="text-slate-200 font-bold">
            {health.transport_latency_ms !== null ? `${Math.round(health.transport_latency_ms)} ms` : '--'}
          </span>
        </div>
        <div>
          <span>Jitter: </span>
          <span className="text-slate-200 font-bold">
            {health.jitter_ms !== null ? `${health.jitter_ms.toFixed(1)} ms` : '--'}
          </span>
        </div>
      </div>
    </div>
  );
};
