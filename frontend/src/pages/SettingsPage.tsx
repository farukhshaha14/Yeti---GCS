import React, { useEffect, useState } from 'react';
import { Sliders, Save, CheckCircle2, AlertCircle, Info } from 'lucide-react';
import type { NetworkConfig } from '../types/telemetry';
import { fetchNetworkConfig, updateNetworkConfig } from '../services/apiService';
import { useAlertStore } from '../stores/useAlertStore';

export const SettingsPage: React.FC = () => {
  const [config, setConfig] = useState<NetworkConfig | null>(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [success, setSuccess] = useState(false);
  const [errorMsg, setErrorMsg] = useState('');
  const { addAlert } = useAlertStore();

  useEffect(() => {
    loadConfig();
  }, []);

  const loadConfig = async () => {
    try {
      setLoading(true);
      const data = await fetchNetworkConfig();
      setConfig(data);
    } catch (e: any) {
      setErrorMsg(e.message);
    } finally {
      setLoading(false);
    }
  };

  const handleSave = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!config) return;

    try {
      setSaving(true);
      setErrorMsg('');
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
      addAlert({
        type: 'INFO',
        title: 'SETTINGS SAVED',
        message: 'Network and transport parameters updated successfully.',
      });
      setTimeout(() => setSuccess(false), 3000);
    } catch (err: any) {
      setErrorMsg(err.message || 'Failed to update configuration');
    } finally {
      setSaving(false);
    }
  };

  if (loading || !config) {
    return (
      <div className="bg-slate-900 border border-slate-800 p-8 rounded-lg text-center text-xs font-mono text-slate-400">
        Loading network configuration...
      </div>
    );
  }

  return (
    <div className="max-w-3xl mx-auto space-y-6">
      {/* Top Banner */}
      <div className="bg-slate-900 border border-slate-800 p-4 rounded-lg">
        <h2 className="text-base font-bold text-slate-100 flex items-center gap-2">
          <Sliders className="w-5 h-5 text-cyan-400" />
          Network & Transport Configuration
        </h2>
        <p className="text-xs text-slate-400 mt-1">
          Configure offline private Wi-Fi network parameters, port bindings, and telemetry transport.
        </p>
      </div>

      {/* Hardware Disclaimer Alert (Section 74) */}
      <div className="p-3.5 rounded-lg border border-amber-500/30 bg-amber-500/5 flex items-start gap-3 text-xs text-amber-300">
        <Info className="w-4 h-4 text-amber-400 shrink-0 mt-0.5" />
        <div>
          <div className="font-bold">MVP DEVELOPMENT CONFIGURATION</div>
          <div className="text-[11px] text-amber-200/80 mt-0.5">
            IP addresses (GCS: 192.168.50.20, Drone: 192.168.50.10) and port 14550 are default testing parameters. They are not final hardware specs and can be reconfigured when approved hardware is finalized.
          </div>
        </div>
      </div>

      {/* Settings Form */}
      <form onSubmit={handleSave} className="bg-slate-900 border border-slate-800 rounded-lg p-5 font-mono text-xs space-y-5">
        {errorMsg && (
          <div className="p-3 rounded bg-red-500/10 border border-red-500/30 text-red-400 flex items-center gap-2">
            <AlertCircle className="w-4 h-4 shrink-0" />
            <span>{errorMsg}</span>
          </div>
        )}

        {success && (
          <div className="p-3 rounded bg-emerald-500/10 border border-emerald-500/30 text-emerald-400 flex items-center gap-2">
            <CheckCircle2 className="w-4 h-4 shrink-0" />
            <span>Configuration updated and saved successfully!</span>
          </div>
        )}

        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          {/* GCS IP */}
          <div>
            <label className="block text-slate-400 uppercase text-[10px] mb-1">
              GCS Laptop IP Address
            </label>
            <input
              type="text"
              value={config.gcs_ip}
              onChange={(e) => setConfig({ ...config, gcs_ip: e.target.value })}
              className="w-full bg-slate-950 border border-slate-800 rounded p-2 text-slate-100 focus:outline-none focus:border-cyan-500"
              required
            />
          </div>

          {/* Drone IP */}
          <div>
            <label className="block text-slate-400 uppercase text-[10px] mb-1">
              Drone Telemetry Device IP
            </label>
            <input
              type="text"
              value={config.drone_ip}
              onChange={(e) => setConfig({ ...config, drone_ip: e.target.value })}
              className="w-full bg-slate-950 border border-slate-800 rounded p-2 text-slate-100 focus:outline-none focus:border-cyan-500"
              required
            />
          </div>

          {/* Subnet Mask */}
          <div>
            <label className="block text-slate-400 uppercase text-[10px] mb-1">
              Subnet Mask
            </label>
            <input
              type="text"
              value={config.subnet_mask}
              onChange={(e) => setConfig({ ...config, subnet_mask: e.target.value })}
              className="w-full bg-slate-950 border border-slate-800 rounded p-2 text-slate-100 focus:outline-none focus:border-cyan-500"
              required
            />
          </div>

          {/* Telemetry Port */}
          <div>
            <label className="block text-slate-400 uppercase text-[10px] mb-1">
              UDP Telemetry Port
            </label>
            <input
              type="number"
              value={config.telemetry_port}
              onChange={(e) => setConfig({ ...config, telemetry_port: Number(e.target.value) })}
              className="w-full bg-slate-950 border border-slate-800 rounded p-2 text-slate-100 focus:outline-none focus:border-cyan-500"
              min="1024"
              max="65535"
              required
            />
          </div>

          {/* Transport Abstraction */}
          <div>
            <label className="block text-slate-400 uppercase text-[10px] mb-1">
              Telemetry Transport
            </label>
            <select
              value={config.telemetry_transport}
              onChange={(e) => setConfig({ ...config, telemetry_transport: e.target.value })}
              className="w-full bg-slate-950 border border-slate-800 rounded p-2 text-slate-100 focus:outline-none focus:border-cyan-500"
            >
              <option value="udp">UDP (Default / Standard MAVLink)</option>
              <option value="tcp">TCP (Reliable Stream)</option>
              <option value="serial">Serial / UART Interface</option>
            </select>
          </div>

          {/* Operation Mode */}
          <div>
            <label className="block text-slate-400 uppercase text-[10px] mb-1">
              Operating Mode
            </label>
            <select
              value={config.operation_mode}
              onChange={(e) => setConfig({ ...config, operation_mode: e.target.value })}
              className="w-full bg-slate-950 border border-slate-800 rounded p-2 text-slate-100 focus:outline-none focus:border-cyan-500"
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
            Staleness & Disconnect Thresholds (Milliseconds)
          </div>
          <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
            <div>
              <label className="block text-slate-400 text-[10px] mb-1">Degraded Threshold</label>
              <input
                type="number"
                value={config.stale_threshold_degraded_ms}
                onChange={(e) =>
                  setConfig({ ...config, stale_threshold_degraded_ms: Number(e.target.value) })
                }
                className="w-full bg-slate-950 border border-slate-800 rounded p-2 text-slate-100 focus:outline-none"
              />
            </div>
            <div>
              <label className="block text-slate-400 text-[10px] mb-1">Stale Threshold</label>
              <input
                type="number"
                value={config.stale_threshold_stale_ms}
                onChange={(e) =>
                  setConfig({ ...config, stale_threshold_stale_ms: Number(e.target.value) })
                }
                className="w-full bg-slate-950 border border-slate-800 rounded p-2 text-slate-100 focus:outline-none"
              />
            </div>
            <div>
              <label className="block text-slate-400 text-[10px] mb-1">Disconnect Timeout</label>
              <input
                type="number"
                value={config.disconnected_timeout_ms}
                onChange={(e) =>
                  setConfig({ ...config, disconnected_timeout_ms: Number(e.target.value) })
                }
                className="w-full bg-slate-950 border border-slate-800 rounded p-2 text-slate-100 focus:outline-none"
              />
            </div>
          </div>
        </div>

        <div className="flex justify-end pt-3">
          <button
            type="submit"
            disabled={saving}
            className="px-4 py-2 rounded bg-cyan-600 hover:bg-cyan-500 disabled:opacity-40 text-white font-bold flex items-center gap-1.5 transition"
          >
            <Save className="w-4 h-4" /> Save Configuration
          </button>
        </div>
      </form>
    </div>
  );
};
