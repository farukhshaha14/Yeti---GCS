import React, { useEffect, useState } from 'react';
import { ListFilter, Clock, RefreshCw } from 'lucide-react';
import { fetchSystemEvents } from '../services/apiService';
import type { SystemEventItem } from '../types/telemetry';

export const ActivityEventLog: React.FC = () => {
  const [events, setEvents] = useState<SystemEventItem[]>([]);
  const [loading, setLoading] = useState(false);

  const loadEvents = async () => {
    try {
      setLoading(true);
      const data = await fetchSystemEvents();
      setEvents(data);
    } catch (e) {
      console.error(e);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    loadEvents();
    const interval = setInterval(loadEvents, 3000);
    return () => clearInterval(interval);
  }, []);

  const getEventBadge = (type: string) => {
    if (type.includes('CRITICAL') || type.includes('FAIL') || type.includes('LOST') || type.includes('ABORT')) {
      return (
        <span className="text-[9px] font-bold text-red-400 bg-red-500/10 border border-red-500/30 px-1.5 py-0.5 rounded">
          {type}
        </span>
      );
    }
    if (type.includes('LOW') || type.includes('WARNING') || type.includes('GAP')) {
      return (
        <span className="text-[9px] font-bold text-amber-400 bg-amber-500/10 border border-amber-500/30 px-1.5 py-0.5 rounded">
          {type}
        </span>
      );
    }
    if (type.includes('ARMED') || type.includes('CONNECTED') || type.includes('RECOVERED')) {
      return (
        <span className="text-[9px] font-bold text-emerald-400 bg-emerald-500/10 border border-emerald-500/30 px-1.5 py-0.5 rounded">
          {type}
        </span>
      );
    }
    return (
      <span className="text-[9px] font-bold text-cyan-400 bg-cyan-500/10 border border-cyan-500/30 px-1.5 py-0.5 rounded">
        {type}
      </span>
    );
  };

  return (
    <div className="bg-slate-900 border border-slate-800 rounded-lg p-3.5 flex flex-col justify-between">
      <div className="flex items-center justify-between pb-2 mb-2.5 border-b border-slate-800">
        <div className="flex items-center gap-2">
          <ListFilter className="w-4 h-4 text-cyan-400" />
          <h3 className="text-xs font-bold uppercase tracking-wider text-slate-200">
            System Activity & Event Log
          </h3>
        </div>
        <button
          onClick={loadEvents}
          disabled={loading}
          className="text-[11px] text-slate-400 hover:text-cyan-400 font-mono flex items-center gap-1"
        >
          <RefreshCw className={`w-3 h-3 ${loading ? 'animate-spin' : ''}`} /> Refresh
        </button>
      </div>

      <div className="bg-slate-950/80 rounded border border-slate-800/80 max-h-44 overflow-y-auto divide-y divide-slate-800/60 font-mono text-xs">
        {events.length === 0 ? (
          <div className="p-4 text-center text-slate-500 text-[11px]">
            No activity events recorded yet.
          </div>
        ) : (
          events.map((ev) => (
            <div key={ev.id} className="p-2 flex items-center justify-between gap-3">
              <div className="min-w-0">
                <div className="flex items-center gap-2 mb-0.5">
                  {getEventBadge(ev.event_type)}
                  <span className="text-[10px] text-slate-500 flex items-center gap-1">
                    <Clock className="w-2.5 h-2.5" />
                    {new Date(ev.timestamp).toLocaleTimeString()}
                  </span>
                </div>
                <div className="text-[10px] text-slate-400 truncate">
                  {Object.keys(ev.payload).length > 0
                    ? JSON.stringify(ev.payload)
                    : 'System state transition'}
                </div>
              </div>
            </div>
          ))
        )}
      </div>
    </div>
  );
};
