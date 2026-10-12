import React, { useEffect, useRef, useState } from 'react';
import { MapPin, Eye, EyeOff, Home, Satellite } from 'lucide-react';
import { useTelemetryStore } from '../stores/useTelemetryStore';
import { useMissionStore } from '../stores/useMissionStore';

export const OfflineMapPanel: React.FC = () => {
  const [mapEnabled, setMapEnabled] = useState(true);
  const { telemetry } = useTelemetryStore();
  const { waypoints, homePosition } = useMissionStore();
  const [breadcrumbs, setBreadcrumbs] = useState<Array<{ lat: number; lon: number }>>([]);
  const canvasRef = useRef<HTMLCanvasElement | null>(null);

  const lat = telemetry.position.latitude;
  const lon = telemetry.position.longitude;
  const heading = telemetry.attitude.yaw_deg ?? 0;

  // Track breadcrumbs
  useEffect(() => {
    if (lat !== null && lon !== null) {
      setBreadcrumbs((prev) => {
        const last = prev[prev.length - 1];
        if (!last || Math.abs(last.lat - lat) > 0.00005 || Math.abs(last.lon - lon) > 0.00005) {
          return [...prev.slice(-100), { lat, lon }];
        }
        return prev;
      });
    }
  }, [lat, lon]);

  // Compute distance and bearing to Home
  let distToHomeM: number | null = null;
  let bearingToHomeDeg: number | null = null;
  if (lat !== null && lon !== null && homePosition) {
    const phi1 = (homePosition.lat * Math.PI) / 180;
    const phi2 = (lat * Math.PI) / 180;
    const dPhi = ((lat - homePosition.lat) * Math.PI) / 180;
    const dLambda = ((lon - homePosition.lon) * Math.PI) / 180;
    const a =
      Math.sin(dPhi / 2) * Math.sin(dPhi / 2) +
      Math.cos(phi1) * Math.cos(phi2) * Math.sin(dLambda / 2) * Math.sin(dLambda / 2);
    const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
    distToHomeM = 6371000 * c;

    const y = Math.sin(-dLambda) * Math.cos(phi1);
    const x = Math.cos(phi2) * Math.sin(phi1) - Math.sin(phi2) * Math.cos(phi1) * Math.cos(-dLambda);
    bearingToHomeDeg = ((Math.atan2(y, x) * 180) / Math.PI + 360) % 360;
  }

  // Draw tactical local coordinate grid on canvas (100% offline, guaranteed zero internet dependence)
  useEffect(() => {
    if (!mapEnabled || !canvasRef.current) return;
    const canvas = canvasRef.current;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    const width = canvas.width;
    const height = canvas.height;

    // Clear background
    ctx.fillStyle = '#0b0f19';
    ctx.fillRect(0, 0, width, height);

    // Draw Radar / Grid Circles
    ctx.strokeStyle = '#1e293b';
    ctx.lineWidth = 1;
    const centerX = width / 2;
    const centerY = height / 2;

    for (let r = 40; r < Math.min(centerX, centerY); r += 40) {
      ctx.beginPath();
      ctx.arc(centerX, centerY, r, 0, 2 * Math.PI);
      ctx.stroke();
    }

    // Grid crosshairs
    ctx.beginPath();
    ctx.moveTo(centerX, 0);
    ctx.lineTo(centerX, height);
    ctx.moveTo(0, centerY);
    ctx.lineTo(width, centerY);
    ctx.stroke();

    const scale = 200000; // coordinate delta to pixel scale

    // 1. Draw Planned Mission Route & Waypoints
    if (waypoints.length > 0 && lat !== null && lon !== null) {
      ctx.strokeStyle = '#f59e0b';
      ctx.lineWidth = 1.5;
      ctx.setLineDash([4, 4]);
      ctx.beginPath();

      const wpCoords = waypoints.map((w) => {
        const dx = (w.lon - lon) * scale;
        const dy = -(w.lat - lat) * scale;
        return { x: centerX + dx, y: centerY + dy, wp: w };
      });

      wpCoords.forEach((pt, idx) => {
        if (idx === 0) ctx.moveTo(pt.x, pt.y);
        else ctx.lineTo(pt.x, pt.y);
      });
      ctx.stroke();
      ctx.setLineDash([]); // reset line dash

      // Draw Waypoint Points & Labels
      wpCoords.forEach((pt) => {
        ctx.fillStyle = '#f59e0b';
        ctx.beginPath();
        ctx.arc(pt.x, pt.y, 4, 0, 2 * Math.PI);
        ctx.fill();

        ctx.fillStyle = '#fbbf24';
        ctx.font = '9px monospace';
        ctx.fillText(`WP${pt.wp.id}`, pt.x + 6, pt.y - 4);
      });
    }

    // 2. Draw Home Launch Position Marker
    if (homePosition && lat !== null && lon !== null) {
      const hDx = (homePosition.lon - lon) * scale;
      const hDy = -(homePosition.lat - lat) * scale;
      const homeX = centerX + hDx;
      const homeY = centerY + hDy;

      // Outer ring
      ctx.strokeStyle = '#10b981';
      ctx.lineWidth = 1.5;
      ctx.beginPath();
      ctx.arc(homeX, homeY, 9, 0, 2 * Math.PI);
      ctx.stroke();

      // Home 'H' letter
      ctx.fillStyle = '#10b981';
      ctx.font = 'bold 10px monospace';
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.fillText('H', homeX, homeY);
      ctx.textAlign = 'start';
      ctx.textBaseline = 'alphabetic';
    }

    // 3. Draw Actual Flight Breadcrumb Trail
    if (breadcrumbs.length > 1 && lat !== null && lon !== null) {
      ctx.strokeStyle = '#06b6d4';
      ctx.lineWidth = 2;
      ctx.beginPath();
      breadcrumbs.forEach((pt, idx) => {
        const dx = (pt.lon - lon) * scale;
        const dy = -(pt.lat - lat) * scale;
        const x = centerX + dx;
        const y = centerY + dy;
        if (idx === 0) ctx.moveTo(x, y);
        else ctx.lineTo(x, y);
      });
      ctx.stroke();
    }

    // 4. Draw Current Drone Position & Heading in Center
    ctx.save();
    ctx.translate(centerX, centerY);
    ctx.rotate((heading * Math.PI) / 180);

    // Drone Triangle Symbol
    ctx.fillStyle = '#38bdf8';
    ctx.beginPath();
    ctx.moveTo(0, -14);
    ctx.lineTo(10, 10);
    ctx.lineTo(0, 5);
    ctx.lineTo(-10, 10);
    ctx.closePath();
    ctx.fill();

    // Heading orientation vector
    ctx.strokeStyle = '#38bdf8';
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.moveTo(0, -14);
    ctx.lineTo(0, -32);
    ctx.stroke();

    ctx.restore();
  }, [mapEnabled, lat, lon, heading, breadcrumbs, waypoints, homePosition]);

  return (
    <div className="bg-slate-900 border border-slate-800 rounded-lg p-3 flex flex-col justify-between">
      <div className="flex items-center justify-between pb-2 mb-2 border-b border-slate-800">
        <div className="flex items-center gap-2">
          <MapPin className="w-4 h-4 text-cyan-400" />
          <h3 className="text-xs font-bold uppercase tracking-wider text-slate-200">
            Tactical Map / Navigation
          </h3>
        </div>
        <div className="flex items-center gap-2">
          <div className="flex items-center gap-1 text-[10px] font-mono px-1.5 py-0.5 rounded bg-slate-800 text-slate-300">
            <Satellite className="w-3 h-3 text-cyan-400" />
            <span>{telemetry.gps.satellites ?? 0} SATS</span>
          </div>
          <span className="text-[10px] font-mono px-1.5 py-0.5 rounded bg-slate-800 text-slate-300">
            OFFLINE GRID
          </span>
          <button
            onClick={() => setMapEnabled(!mapEnabled)}
            className="p-1 rounded hover:bg-slate-800 text-slate-400 hover:text-slate-200 text-xs flex items-center gap-1 font-mono"
            title="Toggle Map Display"
          >
            {mapEnabled ? <Eye className="w-3.5 h-3.5" /> : <EyeOff className="w-3.5 h-3.5" />}
          </button>
        </div>
      </div>

      {mapEnabled ? (
        <div className="relative w-full h-56 bg-slate-950 rounded border border-slate-800/80 overflow-hidden flex items-center justify-center">
          <canvas
            ref={canvasRef}
            width={400}
            height={220}
            className="w-full h-full object-cover"
          />

          {/* Map Legend Overlay */}
          <div className="absolute top-2 right-2 bg-slate-950/85 backdrop-blur px-2 py-1 rounded border border-slate-800 text-[9px] font-mono space-y-0.5">
            <div className="flex items-center gap-1.5 text-cyan-400">
              <span className="w-2 h-0.5 bg-cyan-400" /> Track
            </div>
            {waypoints.length > 0 && (
              <div className="flex items-center gap-1.5 text-amber-400">
                <span className="w-2 h-0.5 border-t border-amber-400 border-dashed" /> Mission ({waypoints.length} WPs)
              </div>
            )}
            {homePosition && (
              <div className="flex items-center gap-1.5 text-emerald-400">
                <span className="w-2 h-2 rounded-full border border-emerald-400 flex items-center justify-center text-[7px]">H</span> Home
              </div>
            )}
          </div>

          {/* Coordinates & Heading readout overlay */}
          <div className="absolute bottom-2 left-2 bg-slate-950/85 backdrop-blur px-2.5 py-1 rounded border border-slate-800 text-[10px] font-mono text-slate-300 space-y-0.5">
            <div>
              Lat: <span className="text-cyan-400 font-bold">{lat !== null ? lat.toFixed(6) : '--'}°</span>
            </div>
            <div>
              Lon: <span className="text-cyan-400 font-bold">{lon !== null ? lon.toFixed(6) : '--'}°</span>
            </div>
            <div>
              Hdg: <span className="text-slate-100 font-bold">{heading.toFixed(0)}°</span>
            </div>
          </div>

          {/* Distance to Home overlay */}
          {distToHomeM !== null && (
            <div className="absolute bottom-2 right-2 bg-slate-950/85 backdrop-blur px-2 py-1 rounded border border-slate-800 text-[10px] font-mono text-right">
              <span className="text-[9px] text-slate-500 uppercase block flex items-center justify-end gap-1">
                <Home className="w-2.5 h-2.5 text-emerald-400" /> Dist Home
              </span>
              <span className="text-emerald-400 font-bold">
                {distToHomeM > 1000 ? `${(distToHomeM / 1000).toFixed(2)} km` : `${distToHomeM.toFixed(1)} m`}
              </span>
            </div>
          )}
        </div>
      ) : (
        <div className="w-full h-56 bg-slate-950/40 rounded border border-slate-800/50 flex flex-col items-center justify-center text-slate-500 text-xs">
          <EyeOff className="w-6 h-6 mb-1 text-slate-600" />
          <span>Map visualization disabled</span>
          <span className="text-[10px] text-slate-600 mt-1">Telemetry continues unaffected</span>
        </div>
      )}

      {/* Lat/Lon and Home Navigation Quick Readout Bar */}
      <div className="mt-2 pt-2 border-t border-slate-800/60 grid grid-cols-3 text-center text-xs font-mono text-slate-400">
        <div>
          <span className="text-[9px] text-slate-500 block uppercase">LATITUDE</span>
          <span className="text-slate-200">{lat !== null ? lat.toFixed(6) : '--'}</span>
        </div>
        <div>
          <span className="text-[9px] text-slate-500 block uppercase">LONGITUDE</span>
          <span className="text-slate-200">{lon !== null ? lon.toFixed(6) : '--'}</span>
        </div>
        <div>
          <span className="text-[9px] text-slate-500 block uppercase">BEARING TO HOME</span>
          <span className="text-emerald-300 font-bold">
            {bearingToHomeDeg !== null ? `${bearingToHomeDeg.toFixed(0)}°` : '--'}
          </span>
        </div>
      </div>
    </div>
  );
};
