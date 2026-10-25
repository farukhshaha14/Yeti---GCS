import React, { useEffect, useState } from 'react';
import {
  Sliders,
  Save,
  CheckCircle2,
  AlertCircle,
  Info,
  RefreshCw,
  Wifi,
  WifiOff,
  Server,
} from 'lucide-react';
import type { NetworkConfig } from '../types/telemetry';
import { fetchNetworkConfig, updateNetworkConfig } from '../services/apiService';
import { useAlertStore } from '../stores/useAlertStore';

const DEFAULT_FALLBACK_CONFIG: NetworkConfig = {
  gcs_ip: '192.168.50.20',
  gcs_bind_host: '0.0.0.0',
  drone_ip: '192.168.50.10',
  subnet_mask: '255.255.255.0',
  telemetry_port: 14550,
  telemetry_transport: 'UDP',
  websocket_host: '0.0.0.0',
  websocket_port: 8080,
  operation_mode: 'SIMULATOR',
  drone_id: 'VEGAPilot-01',
  stale_threshold_degraded_ms: 1000,
  stale_threshold_stale_ms: 3000,
  disconnected_timeout_ms: 10000,
  is_configured: false,
};

export const SettingsPage: React.FC = () => {
  const [config, setConfig] = useState<NetworkConfig | null>(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [success, setSuccess] = useState(false);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  const [isOfflineFallback, setIsOfflineFallback] = useState(false);
  const { addAlert } = useAlertStore();

  useEffect(() => {
    loadConfig();
  }, []);

  const loadConfig = async () => {
    setLoading(true);
    setErrorMsg(null);
    try {
      const data = await fetchNetworkConfig();
      setConfig(data);
      setIsOfflineFallback(false);
    } catch (e: any) {
      const msg = e.message || 'Failed to load network config. Backend unreachable';
      setErrorMsg(msg);
      // Do not leave config as null if we already have one
    } finally {
      setLoading(false);
    }
  };

  const handleUseOfflineDefaults = () => {
    setConfig({ ...DEFAULT_FALLBACK_CONFIG });
    setIsOfflineFallback(true);
    setErrorMsg(null);
  };

  const handleSave = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!config) return;

    try {
      setSaving(true);
      setErrorMsg(null);
      setSuccess(false);

      await updateNetworkConfig({
        gcs_ip: config.gcs_ip,
        drone_ip: config.drone_ip,
        subnet_mask: config.subnet_mask,
        telemetry_port: Number(config.telemetry_port),
        telemetry_transport: config.telemetry_transport,
        operation_mode: config.operation_mode,
        stale_threshold_degraded_ms: Number(config.stale_threshold_degraded_ms),
        stale_threshold_stale_ms: Number(config.stale_threshold_stale_ms),
        disconnected_timeout_ms: Number(config.disconnected_timeout_ms),
      });

      setSuccess(true);
      setIsOfflineFallback(false);
      addAlert({
        type: 'INFO',
        title: 'SETTINGS SAVED',
        message: 'Network and transport parameters updated successfully.',
      });
      setTimeout(() => setSuccess(false), 3000);
    } catch (err: any) {
      setErrorMsg(err.message || 'Failed to update configuration on backend');
    } finally {
      setSaving(false);
    }
  };

  // 1. Loading State (active fetch in progress)
  if (loading) {
    return (
      <div className="max-w-2xl mx-auto my-12 bg-slate-900 border border-slate-800 p-8 rounded-xl text-center font-mono space-y-4 shadow-xl">
        <div className="w-10 h-10 rounded-full bg-cyan-500/10 border border-cyan-500/30 flex items-center justify-center mx-auto text-cyan-400">
          <RefreshCw className="w-5 h-5 animate-spin text-cyan-400" />
        </div>
        <div>
          <h3 className="text-sm font-bold text-slate-200 uppercase tracking-wider">
            Loading Network Configuration...
          </h3>
          <p className="text-xs text-slate-400 mt-1">
            Querying GCS backend endpoint at <code className="text-cyan-400">/api/config/network</code>
          </p>
        </div>
        <div className="text-[11px] text-slate-500">
          Timeout set to 6 seconds • Reconnects automatically
        </div>
      </div>
    );
  }

  // 2. Error State when No Config could be loaded
  if (!config) {
    return (
      <div className="max-w-2xl mx-auto my-8 space-y-4 font-mono">
        <div className="bg-rose-950/40 border border-rose-500/40 rounded-xl p-6 text-center space-y-4 shadow-2xl backdrop-blur-md">
          <div className="w-12 h-12 rounded-full bg-rose-500/20 border border-rose-500/40 flex items-center justify-center mx-auto text-rose-400 shadow-[0_0_12px_rgba(244,63,94,0.3)]">
            <WifiOff className="w-6 h-6 text-rose-400" />
          </div>

          <div>
            <h3 className="text-sm font-black text-rose-200 uppercase tracking-wider">
              Failed to Load Network Configuration
            </h3>
            <p className="text-xs text-rose-300/90 mt-1.5 max-w-lg mx-auto leading-relaxed">
              {errorMsg || 'The backend GCS service on port 8080 is unreachable.'}
            </p>
          </div>

          <div className="p-3 rounded-lg bg-slate-950/80 border border-slate-800 text-[11px] text-slate-400 text-left space-y-1">
            <div className="font-bold text-slate-300 flex items-center gap-1.5">
              <Server className="w-3.5 h-3.5 text-cyan-400" /> Diagnostic Details:
            </div>
            <div>• Target URL: <code className="text-cyan-300">http://localhost:5173/api/config/network</code></div>
            <div>• Vite Proxy: <code className="text-slate-300">/api ➔ http://127.0.0.1:8080</code></div>
            <div>• Probable Cause: Backend Python FastAPI server is currently offline or starting up.</div>
          </div>

          <div className="pt-2 flex flex-col sm:flex-row items-center justify-center gap-3">
            <button
              type="button"
              onClick={loadConfig}
              className="w-full sm:w-auto px-4 py-2 rounded-lg bg-cyan-600 hover:bg-cyan-500 text-slate-950 font-bold text-xs flex items-center justify-center gap-2 transition shadow-md cursor-pointer"
            >
              <RefreshCw className="w-3.5 h-3.5" /> Retry Connection
            </button>
            <button
              type="button"
              onClick={handleUseOfflineDefaults}
              className="w-full sm:w-auto px-4 py-2 rounded-lg bg-slate-800 hover:bg-slate-700 text-slate-200 border border-slate-700 font-bold text-xs flex items-center justify-center gap-2 transition cursor-pointer"
            >
              <Wifi className="w-3.5 h-3.5 text-emerald-400" /> Use Offline Defaults
            </button>
          </div>
        </div>
      </div>
    );
  }

  // 3. Normal Configuration Form
  return (
    <div className="max-w-3xl mx-auto space-y-5 font-mono">
      {/* Top Banner */}
      <div className="bg-slate-900 border border-slate-800 p-4 rounded-xl flex items-center justify-between gap-4">
        <div>
          <h2 className="text-sm font-black text-slate-100 flex items-center gap-2 uppercase tracking-wider">
            <Sliders className="w-5 h-5 text-cyan-400" />
            Network &amp; Transport Configuration
          </h2>
          <p className="text-xs text-slate-400 mt-1">
            Configure offline private Wi-Fi network parameters, port bindings, and telemetry transport.
          </p>
        </div>
        <button
          type="button"
          onClick={loadConfig}
          disabled={loading}
          className="px-2.5 py-1.5 rounded-lg bg-slate-800 hover:bg-slate-700 border border-slate-700 text-slate-300 text-xs flex items-center gap-1.5 transition shrink-0"
          title="Reload network status from backend"
        >
          <RefreshCw className={`w-3.5 h-3.5 ${loading ? 'animate-spin' : ''}`} />
          Reload
        </button>
      </div>

      {/* Offline Fallback Warning Banner if applicable */}
      {isOfflineFallback && (
        <div className="p-3.5 rounded-xl border border-amber-500/40 bg-amber-950/30 flex items-start justify-between gap-3 text-xs text-amber-300 shadow-lg">
          <div className="flex items-start gap-2.5">
            <WifiOff className="w-4 h-4 text-amber-400 shrink-0 mt-0.5" />
            <div>
              <div className="font-bold text-amber-200">OFFLINE FALLBACK MODE ACTIVE</div>
              <div className="text-[11px] text-amber-300/80 mt-0.5 leading-relaxed">
                Displaying standard NIDAR MVP default network parameters. Backend is unreachable on port 8080. You can inspect or modify parameters locally.
              </div>
            </div>
          </div>
          <button
            type="button"
            onClick={loadConfig}
            className="px-2.5 py-1 rounded bg-amber-500/20 hover:bg-amber-500/30 border border-amber-500/50 text-amber-200 font-bold text-[10px] shrink-0 transition"
          >
            Re-test Backend
          </button>
        </div>
      )}

      {/* Hardware Disclaimer Alert */}
      <div className="p-3.5 rounded-xl border border-cyan-500/30 bg-cyan-950/20 flex items-start gap-3 text-xs text-cyan-300">
        <Info className="w-4 h-4 text-cyan-400 shrink-0 mt-0.5" />
        <div>
          <div className="font-bold">MVP DEVELOPMENT CONFIGURATION</div>
          <div className="text-[11px] text-cyan-200/80 mt-0.5 leading-relaxed">
            Standard offline testing parameters: GCS IP: 192.168.50.20, Drone IP: 192.168.50.10, UDP Port: 14550. Parameters dynamically rebind when updated.
          </div>
        </div>
      </div>

      {/* Settings Form */}
      <form onSubmit={handleSave} className="bg-slate-900 border border-slate-800 rounded-xl p-5 text-xs space-y-5 shadow-xl">
        {errorMsg && (
          <div className="p-3 rounded-lg bg-rose-500/10 border border-rose-500/30 text-rose-300 flex items-center justify-between gap-2">
            <div className="flex items-center gap-2">
              <AlertCircle className="w-4 h-4 shrink-0 text-rose-400" />
              <span>{errorMsg}</span>
            </div>
            <button
              type="button"
              onClick={loadConfig}
              className="text-[10px] font-bold underline hover:text-white"
            >
              Retry
            </button>
          </div>
        )}

        {success && (
          <div className="p-3 rounded-lg bg-emerald-500/10 border border-emerald-500/30 text-emerald-400 flex items-center gap-2">
            <CheckCircle2 className="w-4 h-4 shrink-0" />
            <span>Configuration updated and saved successfully!</span>
          </div>
        )}

        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          {/* GCS IP */}
          <div>
            <label className="block text-slate-400 uppercase text-[10px] mb-1 font-bold">
              GCS Laptop IP Address
            </label>
            <input
              type="text"
              value={config.gcs_ip || ''}
              onChange={(e) => setConfig({ ...config, gcs_ip: e.target.value })}
              className="w-full bg-slate-950 border border-slate-800 rounded-lg p-2 text-slate-100 focus:outline-none focus:border-cyan-500"
              required
            />
          </div>

          {/* Drone IP */}
          <div>
            <label className="block text-slate-400 uppercase text-[10px] mb-1 font-bold">
              Drone Telemetry Device IP
            </label>
            <input
              type="text"
              value={config.drone_ip || ''}
              onChange={(e) => setConfig({ ...config, drone_ip: e.target.value })}
              className="w-full bg-slate-950 border border-slate-800 rounded-lg p-2 text-slate-100 focus:outline-none focus:border-cyan-500"
              required
            />
          </div>

          {/* Subnet Mask */}
          <div>
            <label className="block text-slate-400 uppercase text-[10px] mb-1 font-bold">
              Subnet Mask
            </label>
            <input
              type="text"
              value={config.subnet_mask || ''}
              onChange={(e) => setConfig({ ...config, subnet_mask: e.target.value })}
              className="w-full bg-slate-950 border border-slate-800 rounded-lg p-2 text-slate-100 focus:outline-none focus:border-cyan-500"
              required
            />
          </div>

          {/* Telemetry Port */}
          <div>
            <label className="block text-slate-400 uppercase text-[10px] mb-1 font-bold">
              UDP Telemetry Port
            </label>
            <input
              type="number"
              value={config.telemetry_port ?? 14550}
              onChange={(e) => setConfig({ ...config, telemetry_port: Number(e.target.value) })}
              className="w-full bg-slate-950 border border-slate-800 rounded-lg p-2 text-slate-100 focus:outline-none focus:border-cyan-500"
              min="1024"
              max="65535"
              required
            />
          </div>

          {/* Transport Abstraction */}
          <div>
            <label className="block text-slate-400 uppercase text-[10px] mb-1 font-bold">
              Telemetry Transport
            </label>
            <select
              value={config.telemetry_transport || 'UDP'}
              onChange={(e) => setConfig({ ...config, telemetry_transport: e.target.value })}
              className="w-full bg-slate-950 border border-slate-800 rounded-lg p-2 text-slate-100 focus:outline-none focus:border-cyan-500"
            >
              <option value="UDP">UDP (Default / Standard MAVLink)</option>
              <option value="TCP">TCP (Reliable Stream)</option>
              <option value="SERIAL">Serial / UART Interface</option>
            </select>
          </div>

          {/* Operation Mode */}
          <div>
            <label className="block text-slate-400 uppercase text-[10px] mb-1 font-bold">
              Operating Mode
            </label>
            <select
              value={config.operation_mode || 'SIMULATOR'}
              onChange={(e) => setConfig({ ...config, operation_mode: e.target.value })}
              className="w-full bg-slate-950 border border-slate-800 rounded-lg p-2 text-slate-100 focus:outline-none focus:border-cyan-500"
            >
              <option value="SIMULATOR">SIMULATOR (Local Testing)</option>
              <option value="HARDWARE">HARDWARE (Real Flight Wireless Stream)</option>
              <option value="DEMO">DEMO (Preconfigured Mission)</option>
            </select>
          </div>
        </div>

        {/* Staleness Thresholds */}
        <div className="pt-3 border-t border-slate-800 space-y-3">
          <div className="font-bold text-slate-300 text-[11px] uppercase tracking-wider">
            Staleness &amp; Disconnect Thresholds (Milliseconds)
          </div>
          <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
            <div>
              <label className="block text-slate-400 text-[10px] mb-1 font-bold">Degraded Threshold</label>
              <input
                type="number"
                value={config.stale_threshold_degraded_ms ?? 1000}
                onChange={(e) =>
                  setConfig({ ...config, stale_threshold_degraded_ms: Number(e.target.value) })
                }
                className="w-full bg-slate-950 border border-slate-800 rounded-lg p-2 text-slate-100 focus:outline-none focus:border-cyan-500"
              />
            </div>
            <div>
              <label className="block text-slate-400 text-[10px] mb-1 font-bold">Stale Threshold</label>
              <input
                type="number"
                value={config.stale_threshold_stale_ms ?? 3000}
                onChange={(e) =>
                  setConfig({ ...config, stale_threshold_stale_ms: Number(e.target.value) })
                }
                className="w-full bg-slate-950 border border-slate-800 rounded-lg p-2 text-slate-100 focus:outline-none focus:border-cyan-500"
              />
            </div>
            <div>
              <label className="block text-slate-400 text-[10px] mb-1 font-bold">Disconnect Timeout</label>
              <input
                type="number"
                value={config.disconnected_timeout_ms ?? 10000}
                onChange={(e) =>
                  setConfig({ ...config, disconnected_timeout_ms: Number(e.target.value) })
                }
                className="w-full bg-slate-950 border border-slate-800 rounded-lg p-2 text-slate-100 focus:outline-none focus:border-cyan-500"
              />
            </div>
          </div>
        </div>

        <div className="flex justify-end pt-3 gap-3">
          <button
            type="submit"
            disabled={saving}
            className="px-5 py-2.5 rounded-lg bg-cyan-600 hover:bg-cyan-500 disabled:opacity-40 text-slate-950 font-bold flex items-center gap-1.5 transition shadow-lg cursor-pointer"
          >
            <Save className="w-4 h-4" /> {saving ? 'Saving...' : 'Save Configuration'}
          </button>
        </div>
      </form>
    </div>
  );
};

export default SettingsPage;
