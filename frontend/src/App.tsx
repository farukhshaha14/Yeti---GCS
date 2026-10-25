import React, { useEffect, useState } from 'react';
import { Navbar } from './components/Navbar';
import { DashboardPage } from './pages/DashboardPage';
import { MissionsPage } from './pages/MissionsPage';
import { TelemetryLogPage } from './pages/TelemetryLogPage';
import { DiagnosticsPage } from './pages/DiagnosticsPage';
import { SettingsPage } from './pages/SettingsPage';
import { GapRecoveryToast } from './components/GapRecoveryToast';
import { ErrorBoundary } from './components/ErrorBoundary';
import { wsClient } from './services/websocketService';
import { useConnectionStore } from './stores/useConnectionStore';

const getTabFromHash = (): string => {
  const hash = window.location.hash.replace('#', '').toLowerCase();
  if (hash === 'network' || hash === 'settings') return 'settings';
  if (hash === 'missions') return 'missions';
  if (hash === 'telemetry') return 'telemetry';
  if (hash === 'diagnostics') return 'diagnostics';
  return 'dashboard';
};

export const App: React.FC = () => {
  const [currentTab, setCurrentTab] = useState<string>(getTabFromHash);
  const { isWsConnected } = useConnectionStore();

  useEffect(() => {
    // Sync tab when browser URL hash changes
    const handleHashChange = () => {
      setCurrentTab(getTabFromHash());
    };
    window.addEventListener('hashchange', handleHashChange);
    return () => window.removeEventListener('hashchange', handleHashChange);
  }, []);

  const handleSelectTab = (tab: string) => {
    setCurrentTab(tab);
    window.location.hash = tab === 'settings' ? 'network' : tab;
  };

  useEffect(() => {
    // Initialize WebSocket live stream
    wsClient.connect();
    return () => {
      wsClient.disconnect();
    };
  }, []);

  const renderCurrentPage = () => {
    switch (currentTab) {
      case 'dashboard':
        return <DashboardPage onNavigateTab={handleSelectTab} />;
      case 'missions':
        return <MissionsPage />;
      case 'telemetry':
        return <TelemetryLogPage />;
      case 'diagnostics':
        return <DiagnosticsPage />;
      case 'settings':
        return <SettingsPage />;
      default:
        return <DashboardPage onNavigateTab={handleSelectTab} />;
    }
  };

  return (
    <div className="min-h-screen bg-slate-950 text-slate-100 flex flex-col font-sans selection:bg-cyan-500/30 selection:text-cyan-200">
      {/* Top Header Navigation */}
      <Navbar currentTab={currentTab} onSelectTab={handleSelectTab} />

      {/* Main Mission Workspace */}
      <main className="flex-1 max-w-[1720px] w-full mx-auto p-3 sm:p-5">
        <ErrorBoundary>
          {renderCurrentPage()}
        </ErrorBoundary>
      </main>

      {/* Live Gap & Recovery Toasts */}
      <GapRecoveryToast />

      {/* Bottom Engineering Status Strip */}
      <footer className="border-t border-slate-900 bg-slate-950/90 py-2 px-4 text-[11px] font-mono text-slate-500 flex flex-wrap items-center justify-between gap-4">
        <div className="flex items-center gap-3">
          <span>VEGAPilot GCS • NIDAR 2026-27</span>
          <span>•</span>
          <span className="text-slate-400">Offline Private Wi-Fi (192.168.50.0/24)</span>
          <span>•</span>
          <span className="text-slate-400">MAVLink UDP Port: 14550</span>
        </div>
        <div className="flex items-center gap-3">
          <span className="flex items-center gap-1.5">
            <span
              className={`w-2 h-2 rounded-full ${
                isWsConnected ? 'bg-emerald-500' : 'bg-red-500'
              }`}
            />
            WS Pipeline: {isWsConnected ? 'ONLINE' : 'OFFLINE'}
          </span>
          <span>•</span>
          <span>SQLite WAL Local Storage</span>
        </div>
      </footer>
    </div>
  );
};

export default App;
