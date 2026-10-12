import React from 'react';
import { AlertCircle, CheckCircle, Info, X } from 'lucide-react';
import { useAlertStore, type AlertItem } from '../stores/useAlertStore';

export const GapRecoveryToast: React.FC = () => {
  const { alerts, removeAlert } = useAlertStore();

  if (alerts.length === 0) return null;

  return (
    <div className="fixed bottom-4 right-4 z-50 flex flex-col gap-2 max-w-sm pointer-events-none">
      {alerts.map((alert: AlertItem) => {
        let borderClass = 'border-slate-700 bg-slate-900';
        let icon = <Info className="w-4 h-4 text-sky-400" />;

        if (alert.type === 'RECOVERY') {
          borderClass = 'border-emerald-500/50 bg-slate-950/95 text-emerald-300';
          icon = <CheckCircle className="w-4 h-4 text-emerald-400 shrink-0" />;
        } else if (alert.type === 'GAP') {
          borderClass = 'border-amber-500/50 bg-slate-950/95 text-amber-300';
          icon = <AlertCircle className="w-4 h-4 text-amber-400 shrink-0" />;
        } else if (alert.type === 'WARNING' || alert.type === 'ERROR') {
          borderClass = 'border-red-500/50 bg-slate-950/95 text-red-300';
          icon = <AlertCircle className="w-4 h-4 text-red-400 shrink-0" />;
        }

        return (
          <div
            key={alert.id}
            className={`pointer-events-auto border rounded-lg p-3 shadow-xl backdrop-blur transition-all duration-200 ${borderClass}`}
          >
            <div className="flex items-start justify-between gap-2">
              <div className="flex items-start gap-2">
                {icon}
                <div>
                  <div className="text-xs font-bold font-mono tracking-wide">{alert.title}</div>
                  <div className="text-[11px] text-slate-300 mt-0.5">{alert.message}</div>
                </div>
              </div>
              <button
                onClick={() => removeAlert(alert.id)}
                className="text-slate-500 hover:text-slate-300 p-0.5"
              >
                <X className="w-3.5 h-3.5" />
              </button>
            </div>
          </div>
        );
      })}
    </div>
  );
};
