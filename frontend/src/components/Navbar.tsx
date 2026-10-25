import React from 'react';
import { Radio, AlertTriangle, RefreshCw, Power } from 'lucide-react';
import { useConnectionStore } from '../stores/useConnectionStore';
import { useDataHealthStore } from '../stores/useDataHealthStore';
import { useMissionStore } from '../stores/useMissionStore';
import { useTelemetryStore } from '../stores/useTelemetryStore';
import { wsClient } from '../services/websocketService';

interface NavbarProps {
  currentTab: string;
  onSelectTab: (tab: string) => void;
}

export const Navbar: React.FC<NavbarProps> = ({ currentTab, onSelectTab }) => {
  const { status } = useConnectionStore();
  const { health } = useDataHealthStore();
  const { activeMissionId } = useMissionStore();
  const { telemetry } = useTelemetryStore();

  const handleToggleConnection = () => {
    wsClient.toggle();
  };

  const getStatusBadge = () => {
    switch (status) {
      case 'LIVE':
      case 'CONNECTED':
        return (
          <button
            type="button"
            onClick={handleToggleConnection}
            title="Telemetry active • Click to disconnect"
            className="group relative flex items-center gap-2 px-3 py-1 rounded-full text-xs font-semibold bg-emerald-500/10 hover:bg-emerald-500/20 text-emerald-400 border border-emerald-500/30 hover:border-emerald-500/60 shadow-sm transition-all duration-200 cursor-pointer active:scale-95 focus:outline-none focus:ring-2 focus:ring-emerald-500/40"
          >
            <span className="w-2 h-2 rounded-full bg-emerald-500 animate-pulse group-hover:scale-125 transition-transform" />
            <span>LIVE TELEMETRY</span>
            <span className="hidden group-hover:inline-flex items-center gap-0.5 text-[10px] text-emerald-300 font-mono bg-emerald-950/60 px-1 py-0.5 rounded border border-emerald-500/30">
              <Power className="w-2.5 h-2.5 text-rose-400" /> DISCONNECT
            </span>
          </button>
        );

      case 'CONNECTING':
        return (
          <button
            type="button"
            disabled
            title="Establishing WebSocket connection..."
            className="flex items-center gap-2 px-3 py-1 rounded-full text-xs font-semibold bg-sky-500/10 text-sky-400 border border-sky-500/30 shadow-sm transition-all duration-200 cursor-wait"
          >
            <RefreshCw className="w-3.5 h-3.5 animate-spin text-sky-400" />
            <span>CONNECTING...</span>
          </button>
        );

      case 'DISCONNECTING':
        return (
          <button
            type="button"
            disabled
            title="Closing WebSocket connection..."
            className="flex items-center gap-2 px-3 py-1 rounded-full text-xs font-semibold bg-rose-500/10 text-rose-400 border border-rose-500/30 shadow-sm transition-all duration-200 cursor-wait"
          >
            <RefreshCw className="w-3.5 h-3.5 animate-spin text-rose-400" />
            <span>DISCONNECTING...</span>
          </button>
        );

      case 'DEGRADED':
        return (
          <button
            type="button"
            onClick={handleToggleConnection}
            title="Stream degraded • Click to disconnect"
            className="group relative flex items-center gap-2 px-3 py-1 rounded-full text-xs font-semibold bg-amber-500/10 hover:bg-amber-500/20 text-amber-400 border border-amber-500/30 hover:border-amber-500/60 shadow-sm transition-all duration-200 cursor-pointer active:scale-95 focus:outline-none focus:ring-2 focus:ring-amber-500/40"
          >
            <span className="w-2 h-2 rounded-full bg-amber-500" />
            <span>DEGRADED</span>
            <span className="hidden group-hover:inline-flex items-center gap-0.5 text-[10px] text-amber-300 font-mono bg-amber-950/60 px-1 py-0.5 rounded border border-amber-500/30">
              <Power className="w-2.5 h-2.5 text-rose-400" /> DISCONNECT
            </span>
          </button>
        );

      case 'STALE':
        return (
          <button
            type="button"
            onClick={handleToggleConnection}
            title="Data stale • Click to disconnect"
            className="group relative flex items-center gap-2 px-3 py-1 rounded-full text-xs font-semibold bg-orange-500/10 hover:bg-orange-500/20 text-orange-400 border border-orange-500/30 hover:border-orange-500/60 shadow-sm transition-all duration-200 cursor-pointer active:scale-95 focus:outline-none focus:ring-2 focus:ring-orange-500/40"
          >
            <AlertTriangle className="w-3.5 h-3.5" />
            <span>STALE DATA</span>
            <span className="hidden group-hover:inline-flex items-center gap-0.5 text-[10px] text-orange-300 font-mono bg-orange-950/60 px-1 py-0.5 rounded border border-orange-500/30">
              <Power className="w-2.5 h-2.5 text-rose-400" /> DISCONNECT
            </span>
          </button>
        );

      case 'RECONNECTING':
        return (
          <button
            type="button"
            onClick={handleToggleConnection}
            title="Reconnecting • Click to cancel and disconnect"
            className="group relative flex items-center gap-2 px-3 py-1 rounded-full text-xs font-semibold bg-sky-500/10 hover:bg-sky-500/20 text-sky-400 border border-sky-500/30 hover:border-sky-500/60 shadow-sm transition-all duration-200 cursor-pointer active:scale-95 focus:outline-none focus:ring-2 focus:ring-sky-500/40"
          >
            <Radio className="w-3.5 h-3.5 animate-pulse" />
            <span>RECONNECTING</span>
            <span className="hidden group-hover:inline-flex items-center gap-0.5 text-[10px] text-sky-300 font-mono bg-sky-950/60 px-1 py-0.5 rounded border border-sky-500/30">
              CANCEL
            </span>
          </button>
        );

      default:
        return (
          <button
            type="button"
            onClick={handleToggleConnection}
            title="Disconnected • Click to reconnect telemetry stream"
            className="group relative flex items-center gap-2 px-3 py-1 rounded-full text-xs font-semibold bg-red-500/10 hover:bg-red-500/20 text-red-400 hover:text-red-300 border border-red-500/30 hover:border-red-500/60 shadow-sm transition-all duration-200 cursor-pointer active:scale-95 focus:outline-none focus:ring-2 focus:ring-red-500/40"
          >
            <span className="w-2 h-2 rounded-full bg-red-500 group-hover:scale-125 transition-transform" />
            <span>DISCONNECTED</span>
            <span className="inline-flex items-center gap-0.5 text-[10px] text-emerald-400 font-mono bg-emerald-950/60 px-1.5 py-0.5 rounded border border-emerald-500/40 group-hover:bg-emerald-900/60 group-hover:text-emerald-300 transition-colors">
              CONNECT
            </span>
          </button>
        );
    }
  };

  const navItems = [
    { id: 'dashboard', label: 'Flight Deck & Google Map' },
    { id: 'missions', label: 'Missions' },
    { id: 'telemetry', label: 'Telemetry Logs' },
    { id: 'diagnostics', label: 'Diagnostics & Simulator' },
    { id: 'settings', label: 'Network Settings' },
  ];

  const isDisconnected = status === 'DISCONNECTED' || status === 'DISCONNECTING';
  const packetAgeSec = !isDisconnected && health.last_packet_age_ms !== null ? (health.last_packet_age_ms / 1000).toFixed(2) : '--';
  const latencyDisplay = !isDisconnected && health.transport_latency_ms !== null ? `${Math.round(health.transport_latency_ms)} ms` : '-- ms';

  return (
    <header className="border-b border-slate-800 bg-slate-950/80 backdrop-blur sticky top-0 z-50">
      <div className="max-w-[1720px] mx-auto px-4 py-2.5 flex items-center justify-between">
        {/* Brand & Drone Identity */}
        <div className="flex items-center gap-6">
          <div className="flex items-center gap-2.5">
            <img
              src="/yeti-logo.png"
              alt="YETI Logo"
              className="h-8 w-auto max-w-[70px] object-contain rounded border border-cyan-500/30 bg-slate-950/80 shadow-[0_0_12px_rgba(6,182,212,0.2)]"
            />
            <div>
              <div className="flex items-center gap-2">
                <span className="font-bold text-sm tracking-wider text-slate-100">VEGAPILOT GCS</span>
                <span className="text-[10px] px-1.5 py-0.5 rounded bg-slate-800 text-slate-400 font-mono">MVP</span>
              </div>
              <div className="text-[11px] text-slate-400 font-mono flex items-center gap-2">
                <span>{telemetry.drone_id}</span>
                <span>•</span>
                <span className="text-cyan-400">{activeMissionId}</span>
              </div>
            </div>
          </div>

          {/* Navigation Tabs */}
          <nav className="hidden md:flex items-center gap-1 ml-4">
            {navItems.map((item) => (
              <button
                key={item.id}
                onClick={() => onSelectTab(item.id)}
                className={`px-3 py-1.5 text-xs font-medium rounded-md transition-colors ${
                  currentTab === item.id
                    ? 'bg-slate-800 text-cyan-400 shadow-sm'
                    : 'text-slate-400 hover:text-slate-200 hover:bg-slate-900/60'
                }`}
              >
                {item.label}
              </button>
            ))}
          </nav>
        </div>

        {/* Real-time Health Badges & Readouts */}
        <div className="flex items-center gap-4">
          <div className="hidden sm:flex items-center gap-4 text-xs font-mono">
            <div className="flex flex-col items-end">
              <span className="text-[10px] text-slate-500 uppercase tracking-wider">Transport Latency</span>
              <span className="text-slate-200 font-semibold">{latencyDisplay}</span>
            </div>
            <div className="w-[1px] h-6 bg-slate-800" />
            <div className="flex flex-col items-end">
              <span className="text-[10px] text-slate-500 uppercase tracking-wider">Packet Age</span>
              <span className={`font-semibold ${!isDisconnected && (health.status === 'CONNECTED' || health.status === 'LIVE') ? 'text-emerald-400' : 'text-slate-500'}`}>
                {packetAgeSec} {packetAgeSec !== '--' ? 's' : ''}
              </span>
            </div>
          </div>

          {getStatusBadge()}
        </div>
      </div>

      {/* Mobile nav */}
      <div className="md:hidden flex overflow-x-auto px-4 py-1.5 border-t border-slate-800/60 bg-slate-900/40 gap-1 text-xs">
        {navItems.map((item) => (
          <button
            key={item.id}
            onClick={() => onSelectTab(item.id)}
            className={`whitespace-nowrap px-3 py-1 rounded text-xs ${
              currentTab === item.id ? 'bg-slate-800 text-cyan-400' : 'text-slate-400'
            }`}
          >
            {item.label}
          </button>
        ))}
      </div>
    </header>
  );
};
