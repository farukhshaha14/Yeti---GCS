import React, { useEffect, useState } from 'react';
import {
  Filter,
  ChevronLeft,
  ChevronRight,
  Download,
  Play,
  Square,
  Repeat,
  Database,
} from 'lucide-react';
import type { TelemetryPacketItem, Mission } from '../types/telemetry';
import {
  fetchTelemetryLogs,
  fetchMissions,
  startTelemetryReplay,
  stopTelemetryReplay,
  fetchTelemetryReplayStatus,
} from '../services/apiService';
import { useMissionStore } from '../stores/useMissionStore';
import { useAlertStore } from '../stores/useAlertStore';

export const TelemetryLogPage: React.FC = () => {
  const { activeMissionId } = useMissionStore();
  const { addAlert } = useAlertStore();

  const [missions, setMissions] = useState<Mission[]>([]);
  const [selectedMissionId, setSelectedMissionId] = useState<string>(activeMissionId);

  const [items, setItems] = useState<TelemetryPacketItem[]>([]);
  const [page, setPage] = useState(1);
  const [totalPages, setTotalPages] = useState(1);
  const [totalItems, setTotalItems] = useState(0);
  const [loading, setLoading] = useState(true);

  // Filters
  const [msgTypeFilter, setMsgTypeFilter] = useState('');
  const [validFilter, setValidFilter] = useState<string>('all');
  const [recoveredFilter, setRecoveredFilter] = useState<string>('all');

  // Replay State
  const [isReplaying, setIsReplaying] = useState(false);
  const [replaySpeed, setReplaySpeed] = useState<number>(1.0);
  const [replayProgress, setReplayProgress] = useState<{ current: number; total: number }>({
    current: 0,
    total: 0,
  });

  // Selected packet for JSON preview modal
  const [selectedPacket, setSelectedPacket] = useState<TelemetryPacketItem | null>(null);

  // Load available missions from SQLite
  useEffect(() => {
    fetchMissions()
      .then((data) => {
        setMissions(data);
        if (data.length > 0 && !selectedMissionId) {
          setSelectedMissionId(activeMissionId || data[0].mission_id);
        }
      })
      .catch(console.error);
  }, [activeMissionId]);

  // Synchronize when active mission changes
  useEffect(() => {
    if (activeMissionId) {
      setSelectedMissionId(activeMissionId);
    }
  }, [activeMissionId]);

  const loadPackets = async () => {
    try {
      setLoading(true);
      const filters: any = {};
      if (msgTypeFilter) filters.message_type = msgTypeFilter;
      if (validFilter === 'valid') filters.is_valid = true;
      if (validFilter === 'invalid') filters.is_valid = false;
      if (recoveredFilter === 'recovered') filters.is_recovered = true;
      if (recoveredFilter === 'normal') filters.is_recovered = false;

      const data = await fetchTelemetryLogs(selectedMissionId, page, 50, filters);
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
  }, [selectedMissionId, page, msgTypeFilter, validFilter, recoveredFilter]);

  // Check replay status periodically
  useEffect(() => {
    let interval: any;
    if (isReplaying) {
      interval = setInterval(async () => {
        try {
          const status = await fetchTelemetryReplayStatus();
          setIsReplaying(status.is_replaying);
          setReplayProgress({ current: status.current, total: status.total });
          if (!status.is_replaying) {
            clearInterval(interval);
          }
        } catch (e) {
          console.error(e);
        }
      }, 1000);
    }
    return () => clearInterval(interval);
  }, [isReplaying]);

  // Start Replay
  const handleStartReplay = async () => {
    if (!selectedMissionId) return;
    try {
      const res = await startTelemetryReplay(selectedMissionId, replaySpeed);
      setIsReplaying(true);
      setReplayProgress({ current: 0, total: res.total || 0 });
      addAlert({
        type: 'INFO',
        title: 'SESSION REPLAY STARTED',
        message: `Replaying flight session ${selectedMissionId} at ${replaySpeed}x speed into PFD.`,
      });
    } catch (err: any) {
      addAlert({
        type: 'WARNING',
        title: 'REPLAY FAILED',
        message: err.message || 'Failed to start replay',
      });
    }
  };

  // Stop Replay
  const handleStopReplay = async () => {
    try {
      await stopTelemetryReplay();
      setIsReplaying(false);
      addAlert({
        type: 'INFO',
        title: 'REPLAY STOPPED',
        message: 'Telemetry session replay terminated.',
      });
    } catch (err: any) {
      console.error(err);
    }
  };

  return (
    <div className="space-y-4">
      {/* Top Bar: Mission Selector & Export & Replay Controls */}
      <div className="bg-slate-900 border border-slate-800 p-4 rounded-lg flex flex-col md:flex-row md:items-center justify-between gap-4 text-xs font-mono">
        <div className="flex items-center gap-3">
          <Database className="w-5 h-5 text-cyan-400 shrink-0" />
          <div>
            <div className="text-[11px] text-slate-400 font-bold uppercase tracking-wider">
              Inspect Flight Session:
            </div>
            <select
              value={selectedMissionId}
              onChange={(e) => {
                setSelectedMissionId(e.target.value);
                setPage(1);
              }}
              className="bg-slate-950 border border-slate-700 rounded px-2.5 py-1 text-slate-100 font-bold text-xs focus:outline-none focus:border-cyan-500 mt-0.5"
            >
              {missions.map((m) => (
                <option key={m.mission_id} value={m.mission_id}>
                  {m.mission_id} • {m.name} ({m.packet_count.toLocaleString()} pkts)
                  {m.mission_id === activeMissionId ? ' [ACTIVE]' : ''}
                </option>
              ))}
            </select>
          </div>
        </div>

        {/* Replay Flight Controls & Exports */}
        <div className="flex items-center flex-wrap gap-2.5">
          {/* Replay session */}
          <div className="flex items-center gap-1.5 bg-slate-950/80 p-1.5 rounded border border-slate-800">
            <span className="text-[10px] text-slate-400 uppercase">Speed:</span>
            <select
              value={replaySpeed}
              onChange={(e) => setReplaySpeed(Number(e.target.value))}
              disabled={isReplaying}
              className="bg-slate-900 border border-slate-800 rounded px-1.5 py-0.5 text-slate-200 text-[11px]"
            >
              <option value={0.5}>0.5x</option>
              <option value={1.0}>1.0x</option>
              <option value={2.0}>2.0x</option>
              <option value={5.0}>5.0x</option>
              <option value={10.0}>10.0x</option>
            </select>
            {isReplaying ? (
              <button
                onClick={handleStopReplay}
                className="flex items-center gap-1 px-2.5 py-1 rounded bg-rose-600 hover:bg-rose-500 text-white font-bold text-[11px] transition"
              >
                <Square className="w-3 h-3" /> Stop Replay
              </button>
            ) : (
              <button
                onClick={handleStartReplay}
                className="flex items-center gap-1 px-2.5 py-1 rounded bg-purple-600 hover:bg-purple-500 text-white font-bold text-[11px] transition shadow"
                title="Replay stored packets from SQLite back into the Primary Flight Display (PFD)"
              >
                <Play className="w-3 h-3" /> Replay to PFD
              </button>
            )}
          </div>

          {/* Export Buttons */}
          <a
            href={`/api/missions/${selectedMissionId}/export/csv`}
            download
            className="flex items-center gap-1 px-2.5 py-1.5 rounded bg-slate-800 hover:bg-slate-700 text-slate-200 text-xs font-semibold border border-slate-700 transition"
          >
            <Download className="w-3 h-3" /> CSV
          </a>
          <a
            href={`/api/missions/${selectedMissionId}/export/json`}
            download
            className="flex items-center gap-1 px-2.5 py-1.5 rounded bg-cyan-600/80 hover:bg-cyan-600 text-white text-xs font-semibold border border-cyan-500/50 transition"
          >
            <Download className="w-3 h-3" /> JSON
          </a>
        </div>
      </div>

      {/* Replay Progress Banner */}
      {isReplaying && (
        <div className="bg-purple-950/40 border border-purple-500/40 p-3 rounded-lg flex items-center justify-between text-xs font-mono animate-pulse">
          <div className="flex items-center gap-2 text-purple-300">
            <Repeat className="w-4 h-4 animate-spin text-purple-400" />
            <span>
              REPLAY IN PROGRESS: Playing packet #{replayProgress.current} of {replayProgress.total} into cockpit PFD...
            </span>
          </div>
          <div className="text-purple-200 font-bold">
            {replayProgress.total > 0
              ? `${Math.round((replayProgress.current / replayProgress.total) * 100)}%`
              : '0%'}
          </div>
        </div>
      )}

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
                    const lat =
                      typeof p.lat === 'number'
                        ? (p.lat > 1000 ? (p.lat / 1e7).toFixed(5) : p.lat.toFixed(5))
                        : '--';
                    const lon =
                      typeof p.lon === 'number'
                        ? (p.lon > 1000 ? (p.lon / 1e7).toFixed(5) : p.lon.toFixed(5))
                        : '--';
                    const alt =
                      typeof p.relative_alt === 'number'
                        ? (p.relative_alt / 1000).toFixed(1)
                        : typeof p.alt === 'number'
                        ? p.alt.toFixed(1)
                        : '--';
                    summary = `Pos: ${lat}, ${lon} | Alt: ${alt}m`;
                  } else if (item.message_type === 'ATTITUDE') {
                    const r = typeof p.roll === 'number' ? (p.roll * (180 / Math.PI)).toFixed(1) : '--';
                    const pt = typeof p.pitch === 'number' ? (p.pitch * (180 / Math.PI)).toFixed(1) : '--';
                    const y = typeof p.yaw === 'number' ? (p.yaw * (180 / Math.PI)).toFixed(1) : '--';
                    summary = `Roll: ${r}° | Pitch: ${pt}° | Yaw: ${y}°`;
                  } else if (item.message_type === 'SYS_STATUS') {
                    const v =
                      typeof p.voltage_battery === 'number'
                        ? (p.voltage_battery > 100 ? (p.voltage_battery / 1000).toFixed(1) : p.voltage_battery.toFixed(1))
                        : '--';
                    const pct = typeof p.battery_remaining === 'number' ? `${p.battery_remaining}%` : '--';
                    summary = `Battery: ${v}V (${pct})`;
                  } else if (item.message_type === 'HEARTBEAT') {
                    const mode = p.flight_mode || (p.custom_mode !== undefined ? `Mode ${p.custom_mode}` : 'AUTO');
                    const armed = p.base_mode
                      ? p.base_mode & 128
                        ? 'ARMED'
                        : 'DISARMED'
                      : p.armed
                      ? 'ARMED'
                      : 'DISARMED';
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
                            <span className="px-1.5 py-0.5 rounded text-[10px] text-slate-400 bg-slate-800">
                              OK
                            </span>
                          )}
                        </div>
                      </td>
                      <td className="p-3 text-right">
                        <button
                          onClick={(e) => {
                            e.stopPropagation();
                            setSelectedPacket(item);
                          }}
                          className="px-2 py-0.5 rounded bg-slate-800 hover:bg-slate-700 text-cyan-400 text-[10px]"
                        >
                          Inspect JSON
                        </button>
                      </td>
                    </tr>
                  );
                })
              )}
            </tbody>
          </table>
        </div>

        {/* Pagination Controls */}
        <div className="p-3 bg-slate-950/80 border-t border-slate-800 flex items-center justify-between font-mono text-xs">
          <span className="text-slate-400">
            Page {page} of {totalPages}
          </span>
          <div className="flex items-center gap-2">
            <button
              onClick={() => setPage((p) => Math.max(1, p - 1))}
              disabled={page <= 1}
              className="p-1 rounded bg-slate-800 hover:bg-slate-700 disabled:opacity-30 disabled:hover:bg-slate-800 text-slate-200"
            >
              <ChevronLeft className="w-4 h-4" />
            </button>
            <button
              onClick={() => setPage((p) => Math.min(totalPages, p + 1))}
              disabled={page >= totalPages}
              className="p-1 rounded bg-slate-800 hover:bg-slate-700 disabled:opacity-30 disabled:hover:bg-slate-800 text-slate-200"
            >
              <ChevronRight className="w-4 h-4" />
            </button>
          </div>
        </div>
      </div>

      {/* JSON Payload Inspection Modal */}
      {selectedPacket && (
        <div className="fixed inset-0 z-50 bg-black/80 backdrop-blur-sm flex items-center justify-center p-4">
          <div className="bg-slate-900 border border-slate-800 rounded-lg max-w-xl w-full p-4 font-mono text-xs shadow-2xl space-y-3">
            <div className="flex items-center justify-between border-b border-slate-800 pb-2">
              <h4 className="font-bold text-cyan-400 flex items-center gap-2">
                <span>Packet #{selectedPacket.receive_sequence}</span>
                <span className="text-slate-400 font-normal">({selectedPacket.message_type})</span>
              </h4>
              <button
                onClick={() => setSelectedPacket(null)}
                className="text-slate-400 hover:text-slate-100"
              >
                ✕ Close
              </button>
            </div>

            <div className="grid grid-cols-2 gap-2 text-[11px] bg-slate-950 p-2.5 rounded border border-slate-800">
              <div>
                <span className="text-slate-500">Source Seq:</span> #{selectedPacket.source_sequence ?? '--'}
              </div>
              <div>
                <span className="text-slate-500">Receive Seq:</span> #{selectedPacket.receive_sequence}
              </div>
              <div>
                <span className="text-slate-500">Received At:</span>{' '}
                {new Date(selectedPacket.received_at).toLocaleTimeString()}.
                {selectedPacket.received_at % 1000}
              </div>
              <div>
                <span className="text-slate-500">Processed At:</span>{' '}
                {new Date(selectedPacket.processed_at).toLocaleTimeString()}.
                {selectedPacket.processed_at % 1000}
              </div>
            </div>

            <div>
              <span className="text-[10px] text-slate-500 uppercase block mb-1">Raw Payload JSON:</span>
              <pre className="bg-slate-950 p-3 rounded border border-slate-800 max-h-60 overflow-y-auto text-[11px] text-emerald-300">
                {JSON.stringify(selectedPacket.payload, null, 2)}
              </pre>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};
