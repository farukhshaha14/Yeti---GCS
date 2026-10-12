import React, { useEffect, useState } from 'react';
import {
  Play,
  Square,
  Zap,
  RefreshCw,
  Cpu,
} from 'lucide-react';
import {
  fetchHealth,
  fetchSimulatorStatus,
  startSimulator,
  stopSimulator,
  injectSimulatorFault,
} from '../services/apiService';
import { useAlertStore } from '../stores/useAlertStore';

export const DiagnosticsPage: React.FC = () => {
  const [healthData, setHealthData] = useState<any>(null);
  const [simStatus, setSimStatus] = useState<any>(null);
  const [loading, setLoading] = useState(true);
  const [lossRate, setLossRate] = useState<number>(0);
  const { addAlert } = useAlertStore();

  const loadData = async () => {
    try {
      const [h, s] = await Promise.all([fetchHealth(), fetchSimulatorStatus()]);
      setHealthData(h);
      setSimStatus(s);
    } catch (err) {
      console.error(err);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    loadData();
    const interval = setInterval(loadData, 2000);
    return () => clearInterval(interval);
  }, []);

  const handleStartSim = async () => {
    try {
      await startSimulator(10.0);
      addAlert({
        type: 'INFO',
        title: 'SIMULATOR STARTED',
        message: 'Telemetry simulator streaming realistic MAVLink at 10Hz.',
      });
      await loadData();
    } catch (e) {
      console.error(e);
    }
  };

  const handleStopSim = async () => {
    try {
      await stopSimulator();
      addAlert({
        type: 'INFO',
        title: 'SIMULATOR STOPPED',
        message: 'Telemetry stream halted.',
      });
      await loadData();
    } catch (e) {
      console.error(e);
    }
  };

  const handleInjectFault = async (mode: string, param?: any) => {
    try {
      const res = await injectSimulatorFault(mode, param);
      if (res.status === 'ok') {
        addAlert({
          type: mode === 'reconnect' ? 'INFO' : 'GAP',
          title: `INJECTED: ${mode.toUpperCase()}`,
          message: `Fault scenario executed: ${res.action}`,
        });
      }
      await loadData();
    } catch (e) {
      console.error(e);
    }
  };

  const handleSetLossRate = async (rate: number) => {
    setLossRate(rate);
    await handleInjectFault('loss_rate', rate);
  };

  return (
    <div className="space-y-6">
      {/* Top Banner */}
      <div className="bg-slate-900 border border-slate-800 p-4 rounded-lg flex items-center justify-between">
        <div>
          <h2 className="text-base font-bold text-slate-100 flex items-center gap-2">
            <Cpu className="w-5 h-5 text-cyan-400" />
            Network Diagnostics & Telemetry Fault Simulator
          </h2>
          <p className="text-xs text-slate-400 mt-1">
            Real-time socket inspection and automated verification testbench for packet recovery.
          </p>
        </div>
        <button
          onClick={loadData}
          className="px-3 py-1.5 rounded bg-slate-800 hover:bg-slate-700 text-slate-300 text-xs font-mono flex items-center gap-1.5"
        >
          <RefreshCw className={`w-3.5 h-3.5 ${loading ? 'animate-spin' : ''}`} /> Refresh
        </button>
      </div>

      {/* Grid: Socket Diagnostics & Managed Simulator Controls */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        {/* Left: Socket & Transport Diagnostics */}
        <div className="bg-slate-900 border border-slate-800 rounded-lg p-4 font-mono text-xs">
          <div className="flex items-center justify-between pb-2 mb-3 border-b border-slate-800">
            <span className="font-bold text-slate-200 uppercase tracking-wider">
              UDP Socket & Transport Status
            </span>
            <span
              className={`px-2 py-0.5 rounded text-[10px] font-bold ${
                healthData?.transport?.socket_state === 'OPEN'
                  ? 'bg-emerald-500/10 text-emerald-400 border border-emerald-500/30'
                  : 'bg-red-500/10 text-red-400 border border-red-500/30'
              }`}
            >
              SOCKET {healthData?.transport?.socket_state || 'UNKNOWN'}
            </span>
          </div>

          <div className="space-y-2 text-slate-300">
            <div className="flex justify-between py-1 border-b border-slate-800/40">
              <span className="text-slate-500">Transport Layer:</span>
              <span className="text-slate-100 font-bold">{healthData?.transport?.transport_type || 'UDP'}</span>
            </div>
            <div className="flex justify-between py-1 border-b border-slate-800/40">
              <span className="text-slate-500">GCS Listen Bind:</span>
              <span className="text-cyan-400">{healthData?.transport?.bind_host}:{healthData?.transport?.bind_port}</span>
            </div>
            <div className="flex justify-between py-1 border-b border-slate-800/40">
              <span className="text-slate-500">Drone Target Configured:</span>
              <span className="text-cyan-400">{healthData?.transport?.default_target}</span>
            </div>
            <div className="flex justify-between py-1 border-b border-slate-800/40">
              <span className="text-slate-500">Last Sender Remote Addr:</span>
              <span className="text-slate-200">{healthData?.transport?.last_sender || 'None'}</span>
            </div>
            <div className="flex justify-between py-1 border-b border-slate-800/40">
              <span className="text-slate-500">Total UDP Datagrams In:</span>
              <span className="text-slate-100 font-bold">{healthData?.transport?.packets_received?.toLocaleString() || 0}</span>
            </div>
            <div className="flex justify-between py-1 border-b border-slate-800/40">
              <span className="text-slate-500">Total UDP Bytes In:</span>
              <span className="text-slate-100">{healthData?.transport?.bytes_received?.toLocaleString() || 0} bytes</span>
            </div>
            <div className="flex justify-between py-1 border-b border-slate-800/40">
              <span className="text-slate-500">SQLite WAL Database:</span>
              <span className="text-emerald-400 font-bold">{healthData?.database_status || 'UNKNOWN'}</span>
            </div>
            <div className="flex justify-between py-1">
              <span className="text-slate-500">Active WebSocket Clients:</span>
              <span className="text-slate-100 font-bold">{healthData?.websocket_client_count ?? 0} connected</span>
            </div>
          </div>
        </div>

        {/* Right: Managed Simulator Testbench & Fault Injection */}
        <div className="bg-slate-900 border border-slate-800 rounded-lg p-4 font-mono text-xs">
          <div className="flex items-center justify-between pb-2 mb-3 border-b border-slate-800">
            <span className="font-bold text-slate-200 uppercase tracking-wider">
              Telemetry Simulator Testbench
            </span>
            <span
              className={`px-2 py-0.5 rounded text-[10px] font-bold ${
                simStatus?.is_active
                  ? 'bg-emerald-500/10 text-emerald-400 border border-emerald-500/30 animate-pulse'
                  : 'bg-slate-800 text-slate-400'
              }`}
            >
              {simStatus?.is_active ? 'STREAMING 10Hz' : 'STOPPED'}
            </span>
          </div>

          {/* Simulator Start/Stop Controls */}
          <div className="flex items-center gap-3 mb-4">
            <button
              onClick={handleStartSim}
              disabled={simStatus?.is_active}
              className="flex-1 py-2 px-3 rounded bg-emerald-600 hover:bg-emerald-500 disabled:opacity-40 text-white font-bold flex items-center justify-center gap-1.5 transition"
            >
              <Play className="w-3.5 h-3.5" /> Start Simulator
            </button>
            <button
              onClick={handleStopSim}
              disabled={!simStatus?.is_active}
              className="flex-1 py-2 px-3 rounded bg-red-600 hover:bg-red-500 disabled:opacity-40 text-white font-bold flex items-center justify-center gap-1.5 transition"
            >
              <Square className="w-3.5 h-3.5" /> Stop Simulator
            </button>
          </div>

          {/* Critical Acceptance Test Buttons */}
          <div className="space-y-3 pt-2 border-t border-slate-800">
            <div className="text-[11px] font-bold text-cyan-400 uppercase tracking-wider">
              Automated Fault Injection (Section 36-38 Tests)
            </div>

            {/* Critical Test 37: Gap Recovery Test */}
            <div className="p-3 bg-slate-950 rounded border border-amber-500/30 space-y-2">
              <div className="flex items-center justify-between">
                <span className="font-bold text-amber-300">CORE ACCEPTANCE TEST (Section 37)</span>
                <span className="text-[10px] text-slate-400">Drop & Retransmit</span>
              </div>
              <p className="text-[11px] text-slate-400">
                Drops packet #3 (or next frame). The backend detects gap, requests recovery from simulator, validates retransmitted packet, and records RECOVERED in SQLite.
              </p>
              <button
                onClick={() => handleInjectFault('gap')}
                disabled={!simStatus?.is_active}
                className="w-full py-1.5 px-3 rounded bg-amber-600 hover:bg-amber-500 disabled:opacity-40 text-slate-950 font-bold transition flex items-center justify-center gap-1.5"
              >
                <Zap className="w-3.5 h-3.5" /> Inject Gap & Trigger Retransmission Test
              </button>
            </div>

            {/* Other Fault Injections */}
            <div className="grid grid-cols-2 gap-2">
              <button
                onClick={() => handleInjectFault('duplicate')}
                disabled={!simStatus?.is_active}
                className="py-1.5 px-2 rounded bg-slate-800 hover:bg-slate-700 disabled:opacity-40 text-slate-200 transition"
              >
                Inject Duplicate
              </button>
              <button
                onClick={() => handleInjectFault('corrupt')}
                disabled={!simStatus?.is_active}
                className="py-1.5 px-2 rounded bg-slate-800 hover:bg-slate-700 disabled:opacity-40 text-slate-200 transition"
              >
                Inject Corrupt Bytes
              </button>
              <button
                onClick={() => handleInjectFault('disconnect')}
                disabled={!simStatus?.is_active}
                className="py-1.5 px-2 rounded bg-slate-800 hover:bg-slate-700 disabled:opacity-40 text-amber-400 transition"
              >
                Simulate Disconnect
              </button>
              <button
                onClick={() => handleInjectFault('reconnect')}
                disabled={!simStatus?.is_active}
                className="py-1.5 px-2 rounded bg-slate-800 hover:bg-slate-700 disabled:opacity-40 text-emerald-400 transition"
              >
                Simulate Reconnect
              </button>
            </div>

            {/* Packet Loss Rate Selector */}
            <div className="pt-2">
              <div className="flex justify-between text-slate-400 mb-1.5">
                <span>Random Packet Loss Rate:</span>
                <span className="text-cyan-400 font-bold">{(lossRate * 100).toFixed(0)}%</span>
              </div>
              <div className="flex gap-2">
                {[0.0, 0.01, 0.05, 0.1].map((rate) => (
                  <button
                    key={rate}
                    onClick={() => handleSetLossRate(rate)}
                    disabled={!simStatus?.is_active}
                    className={`flex-1 py-1 rounded border text-[11px] font-bold ${
                      lossRate === rate
                        ? 'bg-cyan-500/20 border-cyan-500 text-cyan-300'
                        : 'border-slate-800 bg-slate-950 text-slate-400 hover:text-slate-200'
                    }`}
                  >
                    {rate * 100}%
                  </button>
                ))}
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
};
