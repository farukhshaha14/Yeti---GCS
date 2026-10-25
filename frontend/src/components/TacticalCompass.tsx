import React from 'react';
import { Compass as CompassIcon } from 'lucide-react';

interface TacticalCompassProps {
  headingDeg: number | null;
  bearingToHomeDeg?: number | null;
  className?: string;
  size?: number;
}

export const TacticalCompass: React.FC<TacticalCompassProps> = ({
  headingDeg,
  bearingToHomeDeg,
  className = '',
  size = 130,
}) => {
  const heading = headingDeg ?? 0;
  const hasHeading = headingDeg !== null;

  // Convert degrees to 16-point cardinal compass string
  const getCardinalDirection = (deg: number): string => {
    const directions = [
      'N', 'NNE', 'NE', 'ENE',
      'E', 'ESE', 'SE', 'SSE',
      'S', 'SSW', 'SW', 'WSW',
      'W', 'WNW', 'NW', 'NNW',
    ];
    const index = Math.round(((deg % 360) + 360) % 360 / 22.5) % 16;
    return directions[index];
  };

  const cardinal = hasHeading ? getCardinalDirection(heading) : '--';

  return (
    <div
      className={`relative select-none flex flex-col items-center justify-center p-2 rounded-xl bg-slate-950/85 backdrop-blur-md border border-slate-800 shadow-2xl font-mono ${className}`}
      style={{ width: size + 20, minHeight: size + 36 }}
    >
      {/* Top Header Label */}
      <div className="w-full flex items-center justify-between text-[10px] text-slate-400 mb-1 px-1">
        <span className="flex items-center gap-1 font-bold tracking-wider text-cyan-400 text-[9px]">
          <CompassIcon className="w-3 h-3" /> COMPASS
        </span>
        <span className="text-[10px] text-slate-300 font-bold">
          {hasHeading ? `${Math.round(heading)}°` : '--°'}
        </span>
      </div>

      {/* Circular Compass Dial */}
      <div
        className="relative flex items-center justify-center"
        style={{ width: size, height: size }}
      >
        <svg
          viewBox="0 0 120 120"
          width={size}
          height={size}
          className="overflow-visible"
        >
          <defs>
            <radialGradient id="compassBg" cx="50%" cy="50%" r="50%">
              <stop offset="0%" stopColor="#0f172a" stopOpacity="0.9" />
              <stop offset="85%" stopColor="#030712" stopOpacity="0.95" />
              <stop offset="100%" stopColor="#020617" stopOpacity="1" />
            </radialGradient>
            <filter id="cyanGlow" x="-20%" y="-20%" width="140%" height="140%">
              <feGaussianBlur stdDeviation="2" result="blur" />
              <feComposite in="SourceGraphic" in2="blur" operator="over" />
            </filter>
          </defs>

          {/* Dial Background Face */}
          <circle cx="60" cy="60" r="56" fill="url(#compassBg)" stroke="#1e293b" strokeWidth="1.5" />
          <circle cx="60" cy="60" r="48" fill="none" stroke="#0f172a" strokeWidth="1" strokeDasharray="2,2" />

          {/* Compass Ticks & Cardinal Numbers (Static dial, North is Top) */}
          {[0, 30, 60, 90, 120, 150, 180, 210, 240, 270, 300, 330].map((deg) => {
            const rad = ((deg - 90) * Math.PI) / 180;
            const isMajor = deg % 90 === 0;
            const isMedium = deg % 30 === 0;
            const rInner = isMajor ? 46 : isMedium ? 49 : 52;
            const rOuter = 54;
            const x1 = 60 + rInner * Math.cos(rad);
            const y1 = 60 + rInner * Math.sin(rad);
            const x2 = 60 + rOuter * Math.cos(rad);
            const y2 = 60 + rOuter * Math.sin(rad);

            return (
              <line
                key={`tick-${deg}`}
                x1={x1}
                y1={y1}
                x2={x2}
                y2={y2}
                stroke={isMajor ? '#38bdf8' : '#334155'}
                strokeWidth={isMajor ? 1.5 : 1}
              />
            );
          })}

          {/* Cardinal Letters */}
          <text x="60" y="20" textAnchor="middle" fill="#ef4444" fontSize="10" fontWeight="bold">N</text>
          <text x="104" y="63" textAnchor="middle" fill="#94a3b8" fontSize="9" fontWeight="bold">E</text>
          <text x="60" y="106" textAnchor="middle" fill="#94a3b8" fontSize="9" fontWeight="bold">S</text>
          <text x="16" y="63" textAnchor="middle" fill="#94a3b8" fontSize="9" fontWeight="bold">W</text>

          {/* Bearing to Home Arrow (if available) */}
          {bearingToHomeDeg !== undefined && bearingToHomeDeg !== null && (
            <g transform={`rotate(${bearingToHomeDeg} 60 60)`}>
              <polygon
                points="60,10 63,18 57,18"
                fill="#10b981"
                opacity="0.85"
              >
                <title>{`Bearing to Home: ${Math.round(bearingToHomeDeg)}°`}</title>
              </polygon>
            </g>
          )}

          {/* Rotating Heading Aircraft Pointer */}
          <g transform={`rotate(${heading} 60 60)`} filter="url(#cyanGlow)">
            {/* North / Heading Needle */}
            <polygon points="60,14 64,56 60,50 56,56" fill="#06b6d4" />
            {/* South Tail Needle */}
            <polygon points="60,106 63,64 60,70 57,64" fill="#334155" />
            {/* Center Aircraft Symbol */}
            <circle cx="60" cy="60" r="5" fill="#020617" stroke="#06b6d4" strokeWidth="1.5" />
            <circle cx="60" cy="60" r="2" fill="#38bdf8" />
          </g>
        </svg>

        {/* Center Digital Cardinal Badge */}
        <div className="absolute inset-0 flex items-center justify-center pointer-events-none">
          <div className="mt-8 bg-slate-900/90 px-1.5 py-0.5 rounded border border-slate-800 text-[9px] text-cyan-300 font-bold tracking-wider shadow">
            {cardinal}
          </div>
        </div>
      </div>

      {/* Bottom Summary Pill */}
      <div className="w-full text-center mt-1 text-[9px] text-slate-400">
        HDG <span className="text-white font-bold">{hasHeading ? Math.round(heading) : '--'}°</span>
        {bearingToHomeDeg !== undefined && bearingToHomeDeg !== null && (
          <span className="text-emerald-400 ml-2">
            HOME <span className="font-bold">{Math.round(bearingToHomeDeg)}°</span>
          </span>
        )}
      </div>
    </div>
  );
};
