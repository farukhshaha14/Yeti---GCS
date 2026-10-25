import React, { useEffect, useRef, useState } from 'react';
import { MapPin, Eye, EyeOff, Home, Trash2, Globe, Disc, Maximize2 } from 'lucide-react';
import { useTelemetryStore } from '../stores/useTelemetryStore';
import { useMissionStore } from '../stores/useMissionStore';
import { GcsGpsMap } from './GcsGpsMap';

interface OfflineMapPanelProps {
  onCoordinatePicked?: (coords: { lat: number; lon: number }) => void;
  onExpandTacticalGps?: () => void;
}

export const OfflineMapPanel: React.FC<OfflineMapPanelProps> = ({
  onCoordinatePicked,
  onExpandTacticalGps,
}) => {
  const [mapEnabled, setMapEnabled] = useState(true);
  const [viewMode, setViewMode] = useState<'gps' | 'radar'>('gps');
  const { telemetry } = useTelemetryStore();
  const {
    waypoints,
    homePosition,
    flightTrail,
    geofence,
    noFlyZones,
    clearFlightTrail,
  } = useMissionStore();

  const canvasRef = useRef<HTMLCanvasElement | null>(null);

  const displayLat = telemetry.gps.latitude ?? telemetry.position.latitude;
  const displayLon = telemetry.gps.longitude ?? telemetry.position.longitude;
  const lat = displayLat ?? (homePosition?.lat ?? 19.876543);
  const lon = displayLon ?? (homePosition?.lon ?? 75.343210);
  const heading = telemetry.navigation?.heading_deg ?? telemetry.gps.heading_deg ?? telemetry.attitude.yaw_deg ?? 0;

  // Compute distance and bearing to Home (prefer backend authoritative navigation state)
  let distToHomeM: number | null = telemetry.navigation?.distance_to_home_m ?? null;
  let bearingToHomeDeg: number | null = telemetry.navigation?.bearing_to_home_deg ?? null;
  if (distToHomeM === null && displayLat !== null && displayLon !== null && homePosition) {
    const curLat = displayLat;
    const curLon = displayLon;
    const phi1 = (homePosition.lat * Math.PI) / 180;
    const phi2 = (curLat * Math.PI) / 180;
    const dPhi = ((curLat - homePosition.lat) * Math.PI) / 180;
    const dLambda = ((curLon - homePosition.lon) * Math.PI) / 180;
    const a =
      Math.sin(dPhi / 2) * Math.sin(dPhi / 2) +
      Math.cos(phi1) * Math.cos(phi2) * Math.sin(dLambda / 2) * Math.sin(dLambda / 2);
    const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
    distToHomeM = 6371000 * c;

    const y = Math.sin(-dLambda) * Math.cos(phi1);
    const x = Math.cos(phi2) * Math.sin(phi1) - Math.sin(phi2) * Math.cos(phi1) * Math.cos(-dLambda);
    bearingToHomeDeg = ((Math.atan2(y, x) * 180) / Math.PI + 360) % 360;
  }

  // Draw tactical local coordinate grid on canvas (100% offline)
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

    const centerX = width / 2;
    const centerY = height / 2;

    // Draw Radar / Grid Circles
    ctx.strokeStyle = '#1e293b';
    ctx.lineWidth = 1;
    for (let r = 35; r < Math.min(centerX, centerY); r += 35) {
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

    // 1. Draw Competition Geofence Boundaries (if defined)
    if (geofence && geofence.length >= 3) {
      ctx.strokeStyle = '#059669';
      ctx.lineWidth = 1.5;
      ctx.fillStyle = 'rgba(16, 185, 129, 0.05)';
      ctx.setLineDash([4, 4]);
      ctx.beginPath();
      geofence.forEach((pt, idx) => {
        const dx = (pt.lon - lon) * scale;
        const dy = -(pt.lat - lat) * scale;
        const x = centerX + dx;
        const y = centerY + dy;
        if (idx === 0) ctx.moveTo(x, y);
        else ctx.lineTo(x, y);
      });
      ctx.closePath();
      ctx.stroke();
      ctx.fill();
      ctx.setLineDash([]);
    }

    // 2. Draw No-Fly Zones
    if (noFlyZones && noFlyZones.length > 0) {
      noFlyZones.forEach((zone) => {
        if (zone.length >= 3) {
          ctx.strokeStyle = '#ef4444';
          ctx.fillStyle = 'rgba(239, 68, 68, 0.15)';
          ctx.lineWidth = 1.5;
          ctx.beginPath();
          zone.forEach((pt, idx) => {
            const dx = (pt.lon - lon) * scale;
            const dy = -(pt.lat - lat) * scale;
            const x = centerX + dx;
            const y = centerY + dy;
            if (idx === 0) ctx.moveTo(x, y);
            else ctx.lineTo(x, y);
          });
          ctx.closePath();
          ctx.stroke();
          ctx.fill();
        }
      });
    }

    // 3. Draw Planned Mission Route & Waypoints / Verification Points
    if (waypoints.length > 0) {
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
      ctx.setLineDash([]);

      // Draw Waypoint Points & Labels
      wpCoords.forEach((pt) => {
        const isVp = pt.wp.action === 'VERIFY_POINT' || pt.wp.command === 'VERIFY_POINT';
        ctx.fillStyle = isVp ? '#a855f7' : '#f59e0b';
        ctx.beginPath();
        ctx.arc(pt.x, pt.y, isVp ? 5 : 4, 0, 2 * Math.PI);
        ctx.fill();

        ctx.fillStyle = isVp ? '#c084fc' : '#fbbf24';
        ctx.font = 'bold 9px monospace';
        const label = isVp ? `VP${pt.wp.id}` : `WP${pt.wp.id}`;
        ctx.fillText(`${label} (${pt.wp.alt_m}m)`, pt.x + 6, pt.y - 4);
      });
    }

    // 4. Draw Home Launch Position Marker
    if (homePosition) {
      const hDx = (homePosition.lon - lon) * scale;
      const hDy = -(homePosition.lat - lat) * scale;
      const homeX = centerX + hDx;
      const homeY = centerY + hDy;

      ctx.strokeStyle = '#10b981';
      ctx.lineWidth = 1.5;
      ctx.beginPath();
      ctx.arc(homeX, homeY, 9, 0, 2 * Math.PI);
      ctx.stroke();

      ctx.fillStyle = '#10b981';
      ctx.font = 'bold 10px monospace';
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.fillText('H', homeX, homeY);
      ctx.textAlign = 'start';
      ctx.textBaseline = 'alphabetic';
    }

    // 5. Draw Actual Flight Breadcrumb Trail
    if (flightTrail && flightTrail.length > 1) {
      ctx.strokeStyle = '#06b6d4';
      ctx.lineWidth = 2;
      ctx.beginPath();
      flightTrail.forEach((pt, idx) => {
        const dx = (pt.lon - lon) * scale;
        const dy = -(pt.lat - lat) * scale;
        const x = centerX + dx;
        const y = centerY + dy;
        if (idx === 0) ctx.moveTo(x, y);
        else ctx.lineTo(x, y);
      });
      ctx.stroke();
    }

    // 6. Draw Current Drone Position & Heading in Center
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
  }, [mapEnabled, waypoints, homePosition, flightTrail, geofence, noFlyZones, lat, lon, heading]);

  // Click on canvas to pick coordinates
  const handleCanvasClick = (e: React.MouseEvent<HTMLCanvasElement>) => {
    if (!canvasRef.current || !onCoordinatePicked) return;
    const rect = canvasRef.current.getBoundingClientRect();
    const x = e.clientX - rect.left;
    const y = e.clientY - rect.top;

    const width = canvasRef.current.width;
    const height = canvasRef.current.height;
    const centerX = width / 2;
    const centerY = height / 2;
    const scale = 200000;

    const dx = x - centerX;
    const dy = y - centerY;
    const pickedLon = lon + dx / scale;
    const pickedLat = lat - dy / scale;

    onCoordinatePicked({
      lat: Number(pickedLat.toFixed(6)),
      lon: Number(pickedLon.toFixed(6)),
    });
  };

  return (
    <div className="bg-slate-900 border border-slate-800 rounded-lg p-3">
      {/* Header and Controls */}
      <div className="flex items-center justify-between pb-2 mb-2 border-b border-slate-800">
        <div className="flex items-center gap-1.5">
          <MapPin className="w-4 h-4 text-cyan-400" />
          <h3 className="text-xs font-bold uppercase tracking-wider text-slate-200">
            {viewMode === 'gps' ? 'Live GPS Map' : 'Offline Tactical Radar'}
          </h3>
        </div>
        <div className="flex items-center gap-2">
          {/* Toggle between GPS Map and Canvas Radar */}
          <div className="flex items-center bg-slate-950 rounded p-0.5 border border-slate-800 text-[10px] font-mono">
            <button
              onClick={() => setViewMode('gps')}
              className={`px-1.5 py-0.5 rounded flex items-center gap-1 transition ${
                viewMode === 'gps' ? 'bg-cyan-600 text-white font-bold' : 'text-slate-400 hover:text-slate-200'
              }`}
              title="Interactive GPS Map"
            >
              <Globe className="w-3 h-3" /> GPS
            </button>
            <button
              onClick={() => setViewMode('radar')}
              className={`px-1.5 py-0.5 rounded flex items-center gap-1 transition ${
                viewMode === 'radar' ? 'bg-cyan-600 text-white font-bold' : 'text-slate-400 hover:text-slate-200'
              }`}
              title="100% Offline Tactical Radar Grid"
            >
              <Disc className="w-3 h-3" /> Radar
            </button>
          </div>

          {flightTrail.length > 0 && (
            <button
              onClick={clearFlightTrail}
              className="px-2 py-0.5 rounded bg-slate-800 hover:bg-slate-700 text-slate-400 hover:text-rose-400 text-[10px] font-mono flex items-center gap-1"
              title="Clear flight breadcrumb track"
            >
              <Trash2 className="w-2.5 h-2.5" /> Clear
            </button>
          )}
          {onExpandTacticalGps && (
            <button
              onClick={onExpandTacticalGps}
              className="px-2 py-0.5 rounded bg-cyan-950/80 hover:bg-cyan-900 border border-cyan-500/40 text-cyan-300 text-[10px] font-mono font-bold flex items-center gap-1 transition"
              title="Open Dedicated Fullscreen Tactical GPS Screen"
            >
              <Maximize2 className="w-2.5 h-2.5" /> Fullscreen Map
            </button>
          )}

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
        viewMode === 'gps' ? (
          <GcsGpsMap
            heightClass="h-56"
            isPlanningMode={false}
            onMapClickWaypointAdd={onCoordinatePicked}
          />
        ) : (
          <div className="relative w-full h-56 bg-slate-950 rounded border border-slate-800/80 overflow-hidden flex items-center justify-center">
          <canvas
            ref={canvasRef}
            width={400}
            height={220}
            onClick={handleCanvasClick}
            className="w-full h-full object-cover cursor-crosshair"
            title="Click canvas to pick coordinates for Waypoints or Verification Points"
          />

          {/* Map Legend Overlay */}
          <div className="absolute top-2 right-2 bg-slate-950/85 backdrop-blur px-2 py-1 rounded border border-slate-800 text-[9px] font-mono space-y-0.5">
            <div className="flex items-center gap-1.5 text-cyan-400">
              <span className="w-2 h-0.5 bg-cyan-400" /> Flight Track
            </div>
            {waypoints.length > 0 && (
              <div className="flex items-center gap-1.5 text-amber-400">
                <span className="w-2 h-0.5 border-t border-amber-400 border-dashed" /> Mission ({waypoints.length} WPs)
              </div>
            )}
            {geofence && geofence.length > 0 && (
              <div className="flex items-center gap-1.5 text-emerald-400">
                <span className="w-2 h-0.5 border-t border-emerald-400 border-dashed" /> Geofence
              </div>
            )}
            {noFlyZones && noFlyZones.length > 0 && (
              <div className="flex items-center gap-1.5 text-red-400">
                <span className="w-2 h-2 rounded bg-red-500/30 border border-red-500" /> No-Fly Zone
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
              Lat: <span className="text-cyan-400 font-bold">{displayLat !== null ? displayLat.toFixed(6) : '--'}°</span>
            </div>
            <div>
              Lon: <span className="text-cyan-400 font-bold">{displayLon !== null ? displayLon.toFixed(6) : '--'}°</span>
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
        )
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
          <span className="text-slate-200">{displayLat !== null ? displayLat.toFixed(6) : '--'}</span>
        </div>
        <div>
          <span className="text-[9px] text-slate-500 block uppercase">LONGITUDE</span>
          <span className="text-slate-200">{displayLon !== null ? displayLon.toFixed(6) : '--'}</span>
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
