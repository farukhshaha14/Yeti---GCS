import React from 'react';

interface ArtificialHorizonProps {
  rollDeg: number | null;
  pitchDeg: number | null;
  yawDeg: number | null;
  isStale?: boolean;
}

export const ArtificialHorizon: React.FC<ArtificialHorizonProps> = ({
  rollDeg = 0,
  pitchDeg = 0,
  yawDeg = 0,
  isStale = false,
}) => {
  const roll = rollDeg ?? 0;
  const pitch = pitchDeg ?? 0;
  const yaw = yawDeg ?? 0;

  // Pixels per pitch degree
  const pitchPixelScale = 2.0;
  const pitchOffset = Math.max(-60, Math.min(60, pitch * pitchPixelScale));

  return (
    <div className="relative flex flex-col items-center bg-slate-900 border border-slate-800 rounded-lg p-3 overflow-hidden">
      <div className="w-full flex items-center justify-between mb-2">
        <span className="text-xs font-semibold uppercase tracking-wider text-slate-400">Attitude Indicator</span>
        {isStale && (
          <span className="text-[10px] bg-amber-500/10 text-amber-400 px-1.5 py-0.5 rounded border border-amber-500/30">
            LAST KNOWN
          </span>
        )}
      </div>

      {/* Round Horizon Display */}
      <div className="relative w-48 h-48 rounded-full border-2 border-slate-700 bg-slate-950 overflow-hidden shadow-inner flex items-center justify-center">
        {/* Dynamic Horizon Disk rotating by roll and translating by pitch */}
        <div
          className="absolute w-72 h-72 transition-transform duration-75 ease-out"
          style={{
            transform: `rotate(${-roll}deg) translateY(${pitchOffset}px)`,
          }}
        >
          {/* Sky (Upper Half) */}
          <div className="w-full h-1/2 bg-sky-900/80 border-b border-cyan-300" />
          {/* Ground (Lower Half) */}
          <div className="w-full h-1/2 bg-amber-950/90" />

          {/* Pitch Ladder Lines (-20, -10, 0, +10, +20) */}
          <div className="absolute inset-0 flex flex-col items-center justify-center pointer-events-none">
            {[-20, -10, 10, 20].map((deg) => (
              <div
                key={deg}
                className="absolute flex items-center gap-1 text-[9px] font-mono text-cyan-200/70"
                style={{
                  top: `calc(50% - ${deg * pitchPixelScale}px)`,
                }}
              >
                <div className="w-4 h-[1px] bg-cyan-300/60" />
                <span>{Math.abs(deg)}</span>
                <div className="w-4 h-[1px] bg-cyan-300/60" />
              </div>
            ))}
          </div>
        </div>

        {/* Fixed Aircraft Crosshair Reference Symbol */}
        <div className="absolute pointer-events-none z-10 flex items-center justify-center">
          <div className="w-8 h-[2px] bg-amber-400 shadow-[0_0_8px_rgba(251,191,36,0.8)]" />
          <div className="w-2.5 h-2.5 rounded-full border-2 border-amber-400" />
          <div className="w-8 h-[2px] bg-amber-400 shadow-[0_0_8px_rgba(251,191,36,0.8)]" />
        </div>

        {/* Outer Roll Pointer Markings */}
        <div className="absolute top-1 text-[9px] font-mono text-slate-400 z-10">▲</div>
      </div>

      {/* Numerical Attitude Readouts */}
      <div className="w-full grid grid-cols-3 gap-2 mt-3 text-center font-mono">
        <div className="bg-slate-950/60 p-1.5 rounded border border-slate-800">
          <span className="text-[10px] text-slate-400 block uppercase">Roll</span>
          <span className="text-sm font-bold text-slate-100">{roll.toFixed(1)}°</span>
        </div>
        <div className="bg-slate-950/60 p-1.5 rounded border border-slate-800">
          <span className="text-[10px] text-slate-400 block uppercase">Pitch</span>
          <span className="text-sm font-bold text-slate-100">{pitch.toFixed(1)}°</span>
        </div>
        <div className="bg-slate-950/60 p-1.5 rounded border border-slate-800">
          <span className="text-[10px] text-slate-400 block uppercase">Heading</span>
          <span className="text-sm font-bold text-cyan-400">{yaw.toFixed(0)}°</span>
        </div>
      </div>
    </div>
  );
};
