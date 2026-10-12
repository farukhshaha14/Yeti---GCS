import React, { useEffect, useState } from 'react';
import { Send, Shield, Anchor, AlertOctagon, RefreshCw, CheckCircle2, XCircle, Clock } from 'lucide-react';
import { sendCommand, fetchCommandHistory } from '../services/apiService';
import { useTelemetryStore } from '../stores/useTelemetryStore';
import { useAlertStore } from '../stores/useAlertStore';
import type { CommandLogItem } from '../types/telemetry';

export const OperatorControlPanel: React.FC = () => {
  const { telemetry } = useTelemetryStore();
  const { addAlert } = useAlertStore();
  const [history, setHistory] = useState<CommandLogItem[]>([]);
  const [loadingHistory, setLoadingHistory] = useState(false);
  const [submitting, setSubmitting] = useState(false);

  // Safety Confirmation Modal state
  const [confirmDialog, setConfirmDialog] = useState<{
    isOpen: boolean;
    command: string;
    title: string;
    description: string;
    isDangerous: boolean;
  }>({
    isOpen: false,
    command: '',
    title: '',
    description: '',
    isDangerous: false,
  });

  const isArmed = telemetry.flight.armed === true;
  const isRtl = telemetry.flight.mode === 'RTL';

  const loadHistory = async () => {
    try {
      setLoadingHistory(true);
      const data = await fetchCommandHistory();
      setHistory(data);
    } catch (e) {
      console.error(e);
    } finally {
      setLoadingHistory(false);
    }
  };

  useEffect(() => {
    loadHistory();
    const interval = setInterval(loadHistory, 3000);
    return () => clearInterval(interval);
  }, []);

  const openConfirmation = (command: string) => {
    if (command === 'ARM') {
      setConfirmDialog({
        isOpen: true,
        command: 'ARM',
        title: 'CONFIRM VEHICLE ARMING',
        description: 'Motors will become LIVE. Ensure landing zone and surrounding airspace are completely clear of personnel.',
        isDangerous: true,
      });
    } else if (command === 'DISARM') {
      setConfirmDialog({
        isOpen: true,
        command: 'DISARM',
        title: 'CONFIRM VEHICLE DISARM',
        description: 'Motors will immediately spin down. Only execute when aircraft is safely stationary on the ground.',
        isDangerous: true,
      });
    } else if (command === 'RTH') {
      setConfirmDialog({
        isOpen: true,
        command: 'RTH',
        title: 'EXECUTE RETURN TO HOME (RTH)',
        description: 'The flight controller will abort autonomous trajectory, climb to configured RTL altitude, and return to launch coordinates.',
        isDangerous: false,
      });
    } else if (command === 'ABORT') {
      setConfirmDialog({
        isOpen: true,
        command: 'ABORT',
        title: 'SAFETY-CRITICAL MISSION ABORT',
        description: 'Emergency stop mission execution and command flight controller to initiate immediate precision land.',
        isDangerous: true,
      });
    }
  };

  const handleExecuteCommand = async () => {
    const cmd = confirmDialog.command;
    setConfirmDialog({ ...confirmDialog, isOpen: false });
    try {
      setSubmitting(true);
      const res = await sendCommand(cmd);
      addAlert({
        type: 'INFO',
        title: `COMMAND ${cmd} SENT`,
        message: `MAVLink command dispatched with status: ${res.status}`,
      });
      await loadHistory();
    } catch (err: any) {
      addAlert({
        type: 'WARNING',
        title: `COMMAND ${cmd} FAILED`,
        message: err.message || 'Failed to dispatch command',
      });
    } finally {
      setSubmitting(false);
    }
  };

  const getStatusBadge = (status: CommandLogItem['status']) => {
    switch (status) {
      case 'ACKNOWLEDGED':
        return (
          <span className="flex items-center gap-1 text-[9px] font-bold text-emerald-400 bg-emerald-500/10 border border-emerald-500/30 px-1.5 py-0.5 rounded">
            <CheckCircle2 className="w-2.5 h-2.5" /> ACKNOWLEDGED
          </span>
        );
      case 'SENT':
        return (
          <span className="flex items-center gap-1 text-[9px] font-bold text-sky-400 bg-sky-500/10 border border-sky-500/30 px-1.5 py-0.5 rounded animate-pulse">
            <Clock className="w-2.5 h-2.5" /> SENT
          </span>
        );
      case 'FAILED':
        return (
          <span className="flex items-center gap-1 text-[9px] font-bold text-red-400 bg-red-500/10 border border-red-500/30 px-1.5 py-0.5 rounded">
            <XCircle className="w-2.5 h-2.5" /> FAILED
          </span>
        );
      default:
        return (
          <span className="flex items-center gap-1 text-[9px] font-bold text-slate-400 bg-slate-800 px-1.5 py-0.5 rounded">
            PENDING
          </span>
        );
    }
  };

  return (
    <div className="bg-slate-900 border border-slate-800 rounded-lg p-3.5 flex flex-col justify-between">
      {/* Header */}
      <div className="flex items-center justify-between pb-2 mb-3 border-b border-slate-800">
        <div className="flex items-center gap-2">
          <Send className="w-4 h-4 text-cyan-400" />
          <h3 className="text-xs font-bold uppercase tracking-wider text-slate-200">
            Operator Controls & Command Visibility
          </h3>
        </div>
        <button
          onClick={loadHistory}
          disabled={loadingHistory}
          className="text-[11px] text-slate-400 hover:text-cyan-400 font-mono flex items-center gap-1"
        >
          <RefreshCw className={`w-3 h-3 ${loadingHistory ? 'animate-spin' : ''}`} /> Refresh
        </button>
      </div>

      {/* Safety Critical Action Buttons */}
      <div className="grid grid-cols-3 gap-2 mb-3 font-mono">
        {/* 1. ARM / DISARM */}
        {isArmed ? (
          <button
            onClick={() => openConfirmation('DISARM')}
            disabled={submitting}
            className="py-2 px-2.5 rounded bg-slate-800 hover:bg-slate-700 text-slate-200 border border-slate-700 font-bold text-xs flex items-center justify-center gap-1.5 transition active:scale-95"
          >
            <Shield className="w-3.5 h-3.5 text-slate-400" /> DISARM
          </button>
        ) : (
          <button
            onClick={() => openConfirmation('ARM')}
            disabled={submitting}
            className="py-2 px-2.5 rounded bg-red-600/90 hover:bg-red-500 text-white font-bold text-xs flex items-center justify-center gap-1.5 transition active:scale-95 shadow-[0_0_10px_rgba(239,68,68,0.3)]"
          >
            <Shield className="w-3.5 h-3.5 text-white" /> ARM DRONE
          </button>
        )}

        {/* 2. RTH / RTL */}
        <button
          onClick={() => openConfirmation('RTH')}
          disabled={submitting || isRtl}
          className={`py-2 px-2.5 rounded font-bold text-xs flex items-center justify-center gap-1.5 transition active:scale-95 border ${
            isRtl
              ? 'bg-amber-500/20 text-amber-300 border-amber-500/40 cursor-default'
              : 'bg-cyan-600/80 hover:bg-cyan-500 text-white border-cyan-500/50'
          }`}
        >
          <Anchor className="w-3.5 h-3.5" /> {isRtl ? 'RTH ACTIVE' : 'RTH / RTL'}
        </button>

        {/* 3. MISSION ABORT */}
        <button
          onClick={() => openConfirmation('ABORT')}
          disabled={submitting}
          className="py-2 px-2.5 rounded bg-red-950/80 hover:bg-red-900 text-red-200 border border-red-500/50 font-bold text-xs flex items-center justify-center gap-1.5 transition active:scale-95"
        >
          <AlertOctagon className="w-3.5 h-3.5 text-red-400" /> ABORT
        </button>
      </div>

      {/* Command Visibility Stream */}
      <div>
        <div className="text-[10px] font-mono text-slate-400 uppercase tracking-wider mb-1.5 flex items-center justify-between">
          <span>Command Transmission Log</span>
          <span>Status Visibility</span>
        </div>
        <div className="bg-slate-950/80 rounded border border-slate-800/80 max-h-32 overflow-y-auto divide-y divide-slate-800/60 font-mono text-xs">
          {history.length === 0 ? (
            <div className="p-3 text-center text-[11px] text-slate-500">
              No operator commands sent yet this session.
            </div>
          ) : (
            history.slice(0, 5).map((cmd) => (
              <div key={cmd.id} className="p-2 flex items-center justify-between gap-2">
                <div className="min-w-0">
                  <span className="font-bold text-slate-200 text-[11px] block truncate">
                    {cmd.command_name} <span className="text-slate-500 font-normal">#{cmd.command_id}</span>
                  </span>
                  <span className="text-[9px] text-slate-400 block truncate">
                    {new Date(cmd.timestamp).toLocaleTimeString()} {cmd.details ? `• ${cmd.details}` : ''}
                  </span>
                </div>
                {getStatusBadge(cmd.status)}
              </div>
            ))
          )}
        </div>
      </div>

      {/* Confirmation Modal */}
      {confirmDialog.isOpen && (
        <div className="fixed inset-0 z-50 bg-black/80 backdrop-blur-sm flex items-center justify-center p-4">
          <div className="bg-slate-900 border border-slate-800 rounded-lg max-w-md w-full p-4 font-mono shadow-2xl space-y-3">
            <div className="flex items-center gap-2 text-amber-400 border-b border-slate-800 pb-2">
              <AlertOctagon className="w-5 h-5 text-red-400" />
              <h4 className="font-bold text-sm text-slate-100">{confirmDialog.title}</h4>
            </div>
            <p className="text-xs text-slate-300 leading-relaxed">{confirmDialog.description}</p>
            <div className="flex items-center justify-end gap-2 pt-2 border-t border-slate-800">
              <button
                onClick={() => setConfirmDialog({ ...confirmDialog, isOpen: false })}
                className="px-3 py-1.5 rounded bg-slate-800 hover:bg-slate-700 text-slate-300 text-xs font-semibold"
              >
                Cancel
              </button>
              <button
                onClick={handleExecuteCommand}
                disabled={submitting}
                className={`px-4 py-1.5 rounded text-white text-xs font-bold flex items-center gap-1.5 ${
                  confirmDialog.isDangerous
                    ? 'bg-red-600 hover:bg-red-500'
                    : 'bg-cyan-600 hover:bg-cyan-500'
                }`}
              >
                Confirm & Dispatch MAVLink
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};
