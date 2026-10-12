import React, { useEffect, useState } from 'react';
import { Filter, ChevronLeft, ChevronRight } from 'lucide-react';
import type { TelemetryPacketItem } from '../types/telemetry';
import { fetchMissionTelemetry } from '../services/apiService';
import { useMissionStore } from '../stores/useMissionStore';

export const TelemetryLogPage: React.FC = () => {
  const { activeMissionId } = useMissionStore();
  const [items, setItems] = useState<TelemetryPacketItem[]>([]);
  const [page, setPage] = useState(1);
  const [totalPages, setTotalPages] = useState(1);
  const [totalItems, setTotalItems] = useState(0);
  const [loading, setLoading] = useState(true);

  // Filters
  const [msgTypeFilter, setMsgTypeFilter] = useState('');
  const [validFilter, setValidFilter] = useState<string>('all');
  const [recoveredFilter, setRecoveredFilter] = useState<string>('all');

  // Selected packet for JSON preview modal
  const [selectedPacket, setSelectedPacket] = useState<TelemetryPacketItem | null>(null);

  const loadPackets = async () => {
    try {
      setLoading(true);
      const filters: any = {};
      if (msgTypeFilter) filters.message_type = msgTypeFilter;
      if (validFilter === 'valid') filters.is_valid = true;
      if (validFilter === 'invalid') filters.is_valid = false;
      if (recoveredFilter === 'recovered') filters.is_recovered = true;
      if (recoveredFilter === 'normal') filters.is_recovered = false;

      const data = await fetchMissionTelemetry(activeMissionId, page, 50, filters);
      setItems(data.items);
      setTotalPages(data.total_pages);
      setTotalItems(data.total_items);
    } catch (e) {
      console.error(e);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    loadPackets();
  }, [activeMissionId, page, msgTypeFilter, validFilter, recoveredFilter]);

  return (
    <div className="space-y-4">
      {/* Filters Bar */}
      <div className="bg-slate-900 border border-slate-800 p-3.5 rounded-lg flex flex-wrap items-center justify-between gap-3 text-xs font-mono">
        <div className="flex flex-wrap items-center gap-3">
          <div className="flex items-center gap-1.5 text-slate-400">
            <Filter className="w-3.5 h-3.5 text-cyan-400" />
            <span>Filters:</span>
          </div>

          <select
            value={msgTypeFilter}
            onChange={(e) => {
              setMsgTypeFilter(e.target.value);
              setPage(1);
            }}
            className="bg-slate-950 border border-slate-800 rounded px-2.5 py-1 text-slate-200 focus:outline-none"
          >
            <option value="">All Message Types</option>
            <option value="HEARTBEAT">HEARTBEAT</option>
            <option value="ATTITUDE">ATTITUDE</option>
            <option value="GLOBAL_POSITION_INT">GLOBAL_POSITION_INT</option>
            <option value="SYS_STATUS">SYS_STATUS</option>
            <option value="RECOVERED_TELEMETRY">RECOVERED_TELEMETRY</option>
          </select>

          <select
            value={validFilter}
            onChange={(e) => {
              setValidFilter(e.target.value);
              setPage(1);
            }}
            className="bg-slate-950 border border-slate-800 rounded px-2.5 py-1 text-slate-200 focus:outline-none"
          >
            <option value="all">All Validity</option>
            <option value="valid">Valid Packets Only</option>
            <option value="invalid">Corrupt / Invalid Only</option>
          </select>

          <select
            value={recoveredFilter}
            onChange={(e) => {
              setRecoveredFilter(e.target.value);
              setPage(1);
            }}
            className="bg-slate-950 border border-slate-800 rounded px-2.5 py-1 text-slate-200 focus:outline-none"
          >
            <option value="all">All Delivery States</option>
            <option value="recovered">Recovered Retransmissions</option>
            <option value="normal">Normal Deliveries</option>
          </select>
        </div>

        <div className="text-slate-400">
          Total: <span className="text-cyan-400 font-bold">{totalItems.toLocaleString()}</span> packets
        </div>
      </div>

      {/* Historical Telemetry Log Table */}
      <div className="bg-slate-900 border border-slate-800 rounded-lg overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full text-left text-xs font-mono">
            <thead className="bg-slate-950/80 text-slate-400 border-b border-slate-800">
              <tr>
                <th className="p-3">Src Seq</th>
                <th className="p-3">Recv Seq</th>
                <th className="p-3">Type</th>
                <th className="p-3">Received At</th>
                <th className="p-3">Key Telemetry Metrics</th>
                <th className="p-3">Status Flags</th>
                <th className="p-3 text-right">Payload</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-800/60">
              {loading ? (
                <tr>
                  <td colSpan={7} className="p-8 text-center text-slate-500">
                    Querying SQLite telemetry records...
                  </td>
                </tr>
              ) : items.length === 0 ? (
                <tr>
                  <td colSpan={7} className="p-8 text-center text-slate-500">
                    No telemetry packets matched the filter criteria.
                  </td>
                </tr>
              ) : (
                items.map((item) => {
                  const p = item.payload || {};
                  let summary = '--';
                  if (item.message_type === 'GLOBAL_POSITION_INT') {
                    const lat = typeof p.lat === 'number' ? (p.lat > 1000 ? (p.lat / 1e7).toFixed(5) : p.lat.toFixed(5)) : '--';
                    const lon = typeof p.lon === 'number' ? (p.lon > 1000 ? (p.lon / 1e7).toFixed(5) : p.lon.toFixed(5)) : '--';
                    const alt = typeof p.relative_alt === 'number' ? (p.relative_alt / 1000).toFixed(1) : (typeof p.alt === 'number' ? p.alt.toFixed(1) : '--');
                    summary = `Pos: ${lat}, ${lon} | Alt: ${alt}m`;
                  } else if (item.message_type === 'ATTITUDE') {
                    const r = typeof p.roll === 'number' ? (p.roll * (180 / Math.PI)).toFixed(1) : '--';
                    const pt = typeof p.pitch === 'number' ? (p.pitch * (180 / Math.PI)).toFixed(1) : '--';
                    const y = typeof p.yaw === 'number' ? (p.yaw * (180 / Math.PI)).toFixed(1) : '--';
                    summary = `Roll: ${r}° | Pitch: ${pt}° | Yaw: ${y}°`;
                  } else if (item.message_type === 'SYS_STATUS') {
                    const v = typeof p.voltage_battery === 'number' ? (p.voltage_battery > 100 ? (p.voltage_battery / 1000).toFixed(1) : p.voltage_battery.toFixed(1)) : '--';
                    const pct = typeof p.battery_remaining === 'number' ? `${p.battery_remaining}%` : '--';
                    summary = `Battery: ${v}V (${pct})`;
                  } else if (item.message_type === 'HEARTBEAT') {
                    const mode = p.flight_mode || (p.custom_mode !== undefined ? `Mode ${p.custom_mode}` : 'AUTO');
                    const armed = p.base_mode ? ((p.base_mode & 128) ? 'ARMED' : 'DISARMED') : (p.armed ? 'ARMED' : 'DISARMED');
                    summary = `${mode} | ${armed}`;
                  } else {
                    summary = `${Object.keys(p).slice(0, 3).join(', ')}`;
                  }

                  return (
                    <tr
                      key={item.id}
                      className="hover:bg-slate-800/40 transition cursor-pointer"
                      onClick={() => setSelectedPacket(item)}
                    >
                      <td className="p-3 font-bold text-slate-100">
                        #{item.source_sequence !== null ? item.source_sequence : '--'}
                      </td>
                      <td className="p-3 text-slate-400">#{item.receive_sequence}</td>
                      <td className="p-3 text-cyan-300 font-bold">{item.message_type}</td>
                      <td className="p-3 text-slate-300">
                        {new Date(item.received_at).toLocaleTimeString()}.
                        {(item.received_at % 1000).toString().padStart(3, '0')}
                      </td>
                      <td className="p-3 text-slate-300">
                        <span className="text-slate-300 font-mono text-[11px]">{summary}</span>
                      </td>
                      <td className="p-3">
                        <div className="flex items-center gap-1.5 flex-wrap">
                          {item.is_recovered && (
                            <span className="px-1.5 py-0.5 rounded text-[10px] font-bold bg-emerald-500/10 text-emerald-400 border border-emerald-500/30">
                              RECOVERED
                            </span>
                          )}
                          {item.is_duplicate && (
                            <span className="px-1.5 py-0.5 rounded text-[10px] font-bold bg-amber-500/10 text-amber-400 border border-amber-500/30">
                              DUPLICATE
                            </span>
                          )}
                          {item.is_out_of_order && (
                            <span className="px-1.5 py-0.5 rounded text-[10px] font-bold bg-orange-500/10 text-orange-400 border border-orange-500/30">
                              OUT-OF-ORDER
                            </span>
                          )}
                          {!item.is_valid && (
                            <span className="px-1.5 py-0.5 rounded text-[10px] font-bold bg-red-500/10 text-red-400 border border-red-500/30">
                              INVALID
                            </span>
                          )}
                          {item.is_valid && !item.is_recovered && !item.is_duplicate && !item.is_out_of_order && (
                            <span className="px-1.5 py-0.5 rounded text-[10px] font-bold bg-slate-800 text-slate-400">
                              VERIFIED
                            </span>
                          )}
                        </div>
                      </td>
                      <td className="p-3 text-right text-slate-500 text-[11px]">
                        Inspect JSON →
                      </td>
                    </tr>
                  );
                })
              )}
            </tbody>
          </table>
        </div>

        {/* Pagination Bar */}
        <div className="bg-slate-950 px-4 py-3 border-t border-slate-800 flex items-center justify-between text-xs font-mono">
          <span className="text-slate-400">
            Page <span className="text-slate-200 font-bold">{page}</span> of{' '}
            <span className="text-slate-200 font-bold">{totalPages}</span>
          </span>

          <div className="flex items-center gap-2">
            <button
              disabled={page <= 1}
              onClick={() => setPage((p) => Math.max(1, p - 1))}
              className="p-1.5 rounded border border-slate-800 hover:bg-slate-800 disabled:opacity-30 disabled:hover:bg-transparent text-slate-300"
            >
              <ChevronLeft className="w-4 h-4" />
            </button>
            <button
              disabled={page >= totalPages}
              onClick={() => setPage((p) => Math.min(totalPages, p + 1))}
              className="p-1.5 rounded border border-slate-800 hover:bg-slate-800 disabled:opacity-30 disabled:hover:bg-transparent text-slate-300"
            >
              <ChevronRight className="w-4 h-4" />
            </button>
          </div>
        </div>
      </div>

      {/* JSON Payload Inspection Modal */}
      {selectedPacket && (
        <div className="fixed inset-0 z-50 bg-black/70 backdrop-blur-sm flex items-center justify-center p-4">
          <div className="bg-slate-900 border border-slate-800 rounded-lg max-w-xl w-full p-4 font-mono">
            <div className="flex items-center justify-between pb-2 border-b border-slate-800 mb-3">
              <span className="text-xs font-bold text-cyan-400">
                Packet #{selectedPacket.source_sequence} ({selectedPacket.message_type})
              </span>
              <button
                onClick={() => setSelectedPacket(null)}
                className="text-xs text-slate-400 hover:text-slate-100"
              >
                ✕ Close
              </button>
            </div>
            <pre className="bg-slate-950 p-3 rounded text-[11px] text-slate-300 max-h-96 overflow-y-auto">
              {JSON.stringify(selectedPacket.payload, null, 2)}
            </pre>
          </div>
        </div>
      )}
    </div>
  );
};
