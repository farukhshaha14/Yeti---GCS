import React, { useMemo, Fragment } from 'react';
import { CheckCircle2, ChevronRight, Home, Play, Flag } from 'lucide-react';
import type { Waypoint } from '../types/telemetry';

interface TacticalMissionTimelineProps {
  waypoints: Waypoint[];
  currentWaypointIndex: number | null;
  homePosition: { lat: number; lon: number } | null;
  isMissionActive: boolean;
  className?: string;
}

export const TacticalMissionTimeline: React.FC<TacticalMissionTimelineProps> = ({
  waypoints,
  currentWaypointIndex,
  homePosition,
  isMissionActive,
  className = '',
}) => {
  // If there are no waypoints, create a minimal standby sequence
  const displayItems = useMemo(() => {
    if (waypoints.length === 0) {
      return [
        { id: 'LAUNCH', label: 'LAUNCH', type: 'HOME', alt: homePosition ? 'HOME' : 'GCS' },
        { id: 'WP1', label: 'WP01', type: 'WP', alt: 'STANDBY' },
        { id: 'WP2', label: 'WP02', type: 'WP', alt: 'STANDBY' },
        { id: 'RTB', label: 'RTB', type: 'RTB', alt: 'HOME' },
      ];
    }

    const items: Array<{ id: string; label: string; type: string; alt: string; index?: number }> = [];

    // Home / Launch
    items.push({
      id: 'LAUNCH',
      label: 'LAUNCH',
      type: 'HOME',
      alt: '0m',
    });

    // Waypoints
    waypoints.forEach((wp, idx) => {
      items.push({
        id: `WP${idx + 1}`,
        label: `WP${String(idx + 1).padStart(2, '0')}`,
        type: 'WP',
        alt: `${wp.alt_m}m`,
        index: idx + 1,
      });
    });

    // RTB / Finish
    items.push({
      id: 'RTB',
      label: 'RTB',
      type: 'RTB',
      alt: 'HOME',
    });

    return items;
  }, [waypoints, homePosition]);

  const activeIdx = currentWaypointIndex ?? 1;

  return (
    <div className={`w-full bg-slate-950/90 backdrop-blur-md border border-slate-800 rounded-xl px-4 py-2.5 font-mono shadow-xl ${className}`}>
      {/* Title & Stats */}
      <div className="flex items-center justify-between text-[10px] text-slate-400 mb-2">
        <div className="flex items-center gap-2">
          <span className="font-bold tracking-wider uppercase text-cyan-400 flex items-center gap-1">
            <Play className="w-3 h-3 text-cyan-400 fill-cyan-400" /> MISSION ROUTE TIMELINE
          </span>
          <span className="text-slate-500">•</span>
          <span className="text-slate-300">
            {waypoints.length > 0 ? `${waypoints.length} WAYPOINTS PLANNED` : 'STANDBY ROUTE'}
          </span>
        </div>

        <div className="flex items-center gap-2">
          {isMissionActive ? (
            <span className="px-2 py-0.5 rounded text-[9px] font-bold bg-cyan-500/20 text-cyan-300 border border-cyan-500/40 animate-pulse">
              AUTONOMOUS EXECUTION
            </span>
          ) : (
            <span className="text-slate-500 text-[10px]">PRE-FLIGHT / IDLE</span>
          )}
        </div>
      </div>

      {/* Horizontal Scrollable Timeline Ribbon */}
      <div className="flex items-center overflow-x-auto pb-1 gap-1 sm:gap-2 scrollbar-thin">
        {displayItems.map((item, i) => {
          // Status computation:
          // Item 0 is LAUNCH.
          // Items 1..waypoints.length are WPs.
          // Last item is RTB.
          let isCompleted = false;
          let isCurrent = false;

          if (waypoints.length > 0) {
            if (item.type === 'HOME') {
              isCompleted = isMissionActive && activeIdx > 0;
              isCurrent = isMissionActive && activeIdx === 0;
            } else if (item.type === 'RTB') {
              isCompleted = false;
              isCurrent = isMissionActive && activeIdx > waypoints.length;
            } else if (item.index !== undefined) {
              isCompleted = isMissionActive && item.index < activeIdx;
              isCurrent = isMissionActive && item.index === activeIdx;
            }
          }

          return (
            <Fragment key={item.id}>
              {/* Timeline Node */}
              <div
                className={`flex flex-col items-center shrink-0 px-2.5 py-1.5 rounded-lg border transition-all ${
                  isCurrent
                    ? 'bg-cyan-950/80 border-cyan-400 text-cyan-200 shadow-[0_0_12px_rgba(6,182,212,0.4)] scale-105'
                    : isCompleted
                    ? 'bg-emerald-950/40 border-emerald-500/40 text-emerald-300'
                    : 'bg-slate-900/60 border-slate-800 text-slate-400'
                }`}
              >
                <div className="flex items-center gap-1.5">
                  {item.type === 'HOME' ? (
                    <Home className={`w-3 h-3 ${isCompleted ? 'text-emerald-400' : isCurrent ? 'text-cyan-400' : 'text-slate-400'}`} />
                  ) : item.type === 'RTB' ? (
                    <Flag className={`w-3 h-3 ${isCurrent ? 'text-cyan-400' : 'text-slate-400'}`} />
                  ) : isCompleted ? (
                    <CheckCircle2 className="w-3 h-3 text-emerald-400" />
                  ) : isCurrent ? (
                    <span className="w-2 h-2 rounded-full bg-cyan-400 animate-ping" />
                  ) : (
                    <span className="w-1.5 h-1.5 rounded-full bg-slate-600" />
                  )}

                  <span className={`text-xs font-bold ${isCurrent ? 'text-white' : isCompleted ? 'text-emerald-200' : 'text-slate-300'}`}>
                    {item.label}
                  </span>
                </div>

                <span className="text-[9px] text-slate-500 mt-0.5">
                  {item.alt}
                </span>
              </div>

              {/* Connecting Arrow */}
              {i < displayItems.length - 1 && (
                <div className="flex items-center shrink-0 text-slate-700">
                  <div className={`w-4 sm:w-6 h-[2px] ${isCompleted ? 'bg-emerald-500/60' : isCurrent ? 'bg-cyan-500/60' : 'bg-slate-800'}`} />
                  <ChevronRight className={`w-3.5 h-3.5 -ml-1 ${isCompleted ? 'text-emerald-400' : isCurrent ? 'text-cyan-400' : 'text-slate-700'}`} />
                </div>
              )}
            </Fragment>
          );
        })}
      </div>
    </div>
  );
};
