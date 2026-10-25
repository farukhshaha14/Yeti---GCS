import React, { useState } from 'react';
import {
  AlertTriangle,
  AlertOctagon,
  Globe,
  Navigation as NavIcon,
  Home as HomeIcon,
  Compass,
  Layers,
} from 'lucide-react';
import { PrimaryFlightDisplay } from '../components/PrimaryFlightDisplay';
import { ArtificialHorizon } from '../components/ArtificialHorizon';
import { TelemetryHealthPanel } from '../components/TelemetryHealthPanel';
import { GcsGpsMap } from '../components/GcsGpsMap';
import { TacticalMissionTimeline } from '../components/TacticalMissionTimeline';
import { TacticalBottomPanels } from '../components/TacticalBottomPanels';
import { GcsGpsStatusPanel } from '../components/GcsGpsStatusPanel';
import { MissionStatusWidget } from '../components/MissionStatusWidget';
import { SafetyFailsafePanel } from '../components/SafetyFailsafePanel';
import { SensorHealthWidget } from '../components/SensorHealthWidget';
import { PreFlightCheckPanel } from '../components/PreFlightCheckPanel';
import { OperatorControlPanel } from '../components/OperatorControlPanel';
import { ActivityEventLog } from '../components/ActivityEventLog';
import { useTelemetryStore } from '../stores/useTelemetryStore';
import { useConnectionStore } from '../stores/useConnectionStore';
import { useDataHealthStore } from '../stores/useDataHealthStore';
import { useMissionStore } from '../stores/useMissionStore';

interface DashboardPageProps {
  onNavigateTab?: (tab: string) => void;
}

export const DashboardPage: React.FC<DashboardPageProps> = () => {
  const { telemetry } = useTelemetryStore();
  const { status } = useConnectionStore();
  const { health } = useDataHealthStore();
  const {
    activeMissionId,
    waypoints,
    setWaypoints,
    homePosition,
    currentWaypointIndex,
    missionProgress,
  } = useMissionStore();

  // Layout & Tactical Map view controls
  const [layoutMode, setLayoutMode] = useState<'hero' | 'cinema' | 'split'>('hero');
  const [mapSize, setMapSize] = useState<'standard' | 'tall' | 'max'>('tall');
  const [hudCardsEnabled, setHudCardsEnabled] = useState(true);

  const isDisconnected = status === 'DISCONNECTED';
  const isStale = status === 'STALE' || isDisconnected;
  const dataAgeSec = health.last_packet_age_ms !== null ? (health.last_packet_age_ms / 1000).toFixed(1) : '--';

  // Critical Fault Condition Check
  const batPct = telemetry.battery.percentage;
  const isCriticalBattery = batPct !== null && batPct <= 15;
  const isArmed = telemetry.flight.armed === true;
  const isUnstableTilt = isArmed && Math.max(Math.abs(telemetry.attitude.roll_deg ?? 0), Math.abs(telemetry.attitude.pitch_deg ?? 0)) > 45;

  // Real-time GPS & Navigation Telemetry
  const gps = telemetry.gps;
  const pos = telemetry.position;
  const nav = telemetry.navigation;
  const att = telemetry.attitude;

  const lat = gps.latitude ?? pos.latitude;
  const lon = gps.longitude ?? pos.longitude;
  const alt = gps.altitude_m ?? pos.altitude_m;
  const relAlt = gps.relative_altitude_m ?? pos.relative_altitude_m;
  const heading = nav?.heading_deg ?? gps.heading_deg ?? att.yaw_deg ?? 0;
  const hasGpsFix = !isDisconnected && gps.gps_fix && lat !== null && lon !== null && !isStale;

  // Compute distance to Home / Reference Point
  let distToHomeM = nav?.distance_to_home_m ?? null;
  if (distToHomeM === null && lat !== null && lon !== null && homePosition?.lat && homePosition?.lon) {
    const p1 = (homePosition.lat * Math.PI) / 180;
    const p2 = (lat * Math.PI) / 180;
    const dPhi = ((lat - homePosition.lat) * Math.PI) / 180;
    const dLambda = ((lon - homePosition.lon) * Math.PI) / 180;
    const a =
      Math.sin(dPhi / 2) * Math.sin(dPhi / 2) +
      Math.cos(p1) * Math.cos(p2) * Math.sin(dLambda / 2) * Math.sin(dLambda / 2);
    const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
    distToHomeM = 6371000 * c;
  }

  const distToHomeDisplay = distToHomeM !== null
    ? distToHomeM >= 1000
      ? `${(distToHomeM / 1000).toFixed(2)} km`
      : `${distToHomeM.toFixed(1)} m`
    : '--';

  // Waypoint Editing Handlers for Interactive Map
  const handleWaypointMoved = (index: number, wpLat: number, wpLon: number) => {
    const updated = [...waypoints];
    if (updated[index]) {
      updated[index] = { ...updated[index], lat: wpLat, lon: wpLon };
      setWaypoints(updated);
    }
  };

  const handleAddWaypoint = (coords: { lat: number; lon: number }) => {
    const newWpId = waypoints.length + 1;
    setWaypoints([
      ...waypoints,
      {
        id: newWpId,
        lat: coords.lat,
        lon: coords.lon,
        alt_m: 50,
        action: 'WAYPOINT',
      },
    ]);
  };

  const handleDeleteWaypoint = (index: number) => {
    const updated = waypoints
      .filter((_, idx) => idx !== index)
      .map((w, idx) => ({ ...w, id: idx + 1 }));
    setWaypoints(updated);
  };

  // Determine dynamic height based on map size setting
  const getMapHeightClass = () => {
    switch (mapSize) {
      case 'standard':
        return 'h-[480px] lg:h-[520px]';
      case 'max':
        return 'h-[720px] xl:h-[820px]';
      case 'tall':
      default:
        return 'h-[580px] lg:h-[640px] xl:h-[680px]';
    }
  };

  return (
    <div className="space-y-4">
      {/* 1. High-Priority Safety Critical Fault Banner */}
      {(isCriticalBattery || isUnstableTilt) && (
        <div className="bg-red-950/60 border-2 border-red-500 rounded-lg p-3.5 flex flex-col md:flex-row items-start md:items-center justify-between gap-3 font-mono text-xs shadow-xl animate-pulse">
          <div className="flex items-center gap-3">
            <div className="w-9 h-9 rounded bg-red-600/30 flex items-center justify-center text-red-400 shrink-0">
              <AlertOctagon className="w-5 h-5" />
            </div>
            <div>
              <div className="flex items-center gap-2">
                <span className="font-extrabold text-red-200 tracking-wider text-sm">
                  {isCriticalBattery ? 'EMERGENCY: CRITICAL BATTERY DEPLETION (≤15%)' : 'EMERGENCY: UNSTABLE FLIGHT ATTITUDE EXCEEDED'}
                </span>
                <span className="bg-red-500/30 text-red-300 px-2 py-0.5 rounded text-[10px] font-bold">
                  AUTOPILOT FAILSAFE TRIGGERED
                </span>
              </div>
              <div className="text-[11px] text-red-300/90 mt-1">
                {isCriticalBattery
                  ? `Battery remaining: ${batPct?.toFixed(0)}% (${telemetry.battery.voltage_v?.toFixed(1)}V) • Flight controller executing forced touchdown descent`
                  : `Attitude exceeded 45° tilt envelope • Autopilot rate dampening & recovery active`}
              </div>
            </div>
          </div>
          <div className="text-right shrink-0">
            <span className="text-xs font-bold text-red-200 bg-red-900/60 px-2.5 py-1 rounded border border-red-500/50">
              SAFETY ACTION MANDATORY
            </span>
          </div>
        </div>
      )}

      {/* 2. Telemetry Loss & Autonomous Failsafe Status Banner */}
      {isStale && !isCriticalBattery && !isUnstableTilt && (
        <div className="bg-amber-950/40 border border-amber-500/40 rounded-lg p-3.5 flex flex-col md:flex-row items-start md:items-center justify-between gap-3 font-mono text-xs shadow-lg">
          <div className="flex items-start md:items-center gap-3">
            <div className="w-8 h-8 rounded bg-amber-500/20 flex items-center justify-center text-amber-400 shrink-0 mt-0.5 md:mt-0">
              <AlertTriangle className="w-4 h-4" />
            </div>
            <div>
              <div className="flex flex-wrap items-center gap-2">
                <span className="font-bold text-amber-300 tracking-wider">
                  {isDisconnected ? 'TELEMETRY LINK LOST' : 'TELEMETRY LINK DEGRADED / STALE'}
                </span>
                <span className="bg-amber-500/20 text-amber-400 px-1.5 py-0.5 rounded text-[10px]">
                  PRESERVING LAST REPORTED STATE
                </span>
              </div>
              <div className="text-[11px] text-slate-300 mt-1 flex flex-wrap gap-x-4 gap-y-1">
                <span>Last Position: <strong className="text-white">{lat !== null ? `${lat.toFixed(5)}°` : '--'}, {lon !== null ? `${lon.toFixed(5)}°` : '--'}</strong></span>
                <span>Last Alt: <strong className="text-white">{alt !== null ? `${alt.toFixed(1)} m` : '--'} MSL</strong></span>
                <span>Last Mode: <strong className="text-cyan-400">{telemetry.flight.mode ?? 'UNKNOWN'} {telemetry.flight.armed ? '(ARMED)' : '(DISARMED)'}</strong></span>
                <span>Mission: <strong className="text-slate-200">{activeMissionId}</strong></span>
                <span>Data Age: <strong className="text-amber-400">{dataAgeSec} s</strong></span>
              </div>
            </div>
          </div>
          <div className="text-[10px] text-slate-400 md:text-right shrink-0">
            <span className="text-slate-300 font-semibold">Autopilot Authoritative</span>
            <div className="text-slate-500">Autonomous flight continuing per configured failsafe</div>
          </div>
        </div>
      )}

      {/* 3. Flight Primary Telemetry Readouts (PFD) */}
      <PrimaryFlightDisplay />

      {/* 4. CONSOLIDATED TACTICAL GPS CONTEXT & TELEMETRY STREAM STRIP */}
      <div className="bg-slate-950/90 border border-slate-800 rounded-xl p-3 flex flex-col md:flex-row md:items-center justify-between gap-3 font-mono shadow-lg backdrop-blur-md">
        {/* Left Title & Status */}
        <div className="flex items-center gap-3">
          <div className="w-9 h-9 rounded-lg bg-cyan-950/80 border border-cyan-500/40 flex items-center justify-center text-cyan-400 shadow-[0_0_12px_rgba(6,182,212,0.3)] shrink-0">
            <NavIcon className="w-5 h-5 text-cyan-400" />
          </div>
          <div>
            <div className="flex items-center gap-2">
              <h2 className="text-sm font-black tracking-wider text-white uppercase">
                Tactical Navigation &amp; Google Map
              </h2>
              <span className={`px-2 py-0.5 rounded text-[10px] font-bold border ${
                hasGpsFix
                  ? 'bg-emerald-500/20 text-emerald-300 border-emerald-500/40 shadow-[0_0_8px_rgba(16,185,129,0.3)]'
                  : isStale
                  ? 'bg-amber-500/20 text-amber-300 border-amber-500/40'
                  : 'bg-rose-500/20 text-rose-300 border-rose-500/40'
              }`}>
                {isDisconnected ? 'LINK DISCONNECTED' : isStale ? 'LAST KNOWN (STALE)' : gps.fix_status || '3D GPS FIX'}
              </span>
            </div>
            <div className="text-[11px] text-slate-400 flex items-center gap-2 mt-0.5">
              <span>DRONE: <strong className="text-slate-200">{telemetry.drone_id}</strong></span>
              <span>•</span>
              <span>MISSION: <strong className="text-cyan-400">{activeMissionId}</strong></span>
              <span>•</span>
              <span className="text-emerald-400 font-semibold">100% OFFLINE TACTICAL ENGINE</span>
            </div>
          </div>
        </div>

        {/* Right Live Coordinates & Reference Point HUD Strip */}
        <div className="flex items-center flex-wrap gap-2 text-xs font-mono">
          <div className="px-2.5 py-1 rounded-lg bg-slate-900 border border-slate-800 text-slate-300">
            <span className="text-[9px] text-slate-500 block uppercase">Coordinates</span>
            <span className="text-white font-bold">
              {lat !== null && lon !== null ? `${lat.toFixed(6)}°, ${lon.toFixed(6)}°` : 'NO GPS FIX'}
            </span>
          </div>

          <div className="px-2.5 py-1 rounded-lg bg-slate-900 border border-slate-800 text-slate-300">
            <span className="text-[9px] text-slate-500 block uppercase">Alt MSL / AGL</span>
            <span className="text-cyan-400 font-bold">
              {alt !== null ? `${alt.toFixed(1)}m` : '--'}
              {relAlt !== null && <span className="text-slate-400 text-[10px] ml-1">({relAlt.toFixed(1)}m)</span>}
            </span>
          </div>

          <div className="px-2.5 py-1 rounded-lg bg-slate-900 border border-slate-800 text-slate-300">
            <span className="text-[9px] text-slate-500 block uppercase">Heading</span>
            <span className="text-emerald-400 font-bold flex items-center gap-1">
              <Compass className="w-3 h-3 text-emerald-400" />
              {Math.round(heading)}°
            </span>
          </div>

          <div className="px-2.5 py-1 rounded-lg bg-slate-900 border border-slate-800 text-slate-300">
            <span className="text-[9px] text-slate-500 block uppercase flex items-center gap-1">
              <HomeIcon className="w-2.5 h-2.5 text-emerald-400" /> Dist to Home (RP)
            </span>
            <span className="text-emerald-300 font-bold">
              {distToHomeDisplay}
            </span>
          </div>
        </div>
      </div>

      {/* 5. CONSOLIDATED GOOGLE MAP TACTICAL ENGINE (Hero Centerpiece with All Layer Controls) */}
      <div className="bg-slate-950/80 border border-slate-800 rounded-xl p-3 shadow-xl backdrop-blur-sm space-y-3">
        {/* Top Control Strip for Map Architecture & Form Factor */}
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 pb-2 border-b border-slate-800/80 font-mono text-xs">
          <div className="flex items-center gap-2">
            <Globe className="w-4 h-4 text-cyan-400" />
            <span className="font-bold text-white uppercase tracking-wider text-xs">
              Google Maps Multi-Layer GCS Engine
            </span>
            <span className="px-1.5 py-0.5 rounded text-[9px] font-bold bg-cyan-500/20 text-cyan-300 border border-cyan-500/40">
              CONSOLIDATED
            </span>
          </div>

          {/* Form Factor, HUD Card Toggle, & Size Controls */}
          <div className="flex items-center flex-wrap gap-2 text-[11px]">
            {/* Floating HUD Cards Toggle */}
            <button
              type="button"
              onClick={() => setHudCardsEnabled(!hudCardsEnabled)}
              className={`px-2 py-1 rounded border text-[10px] font-bold flex items-center gap-1 transition ${
                hudCardsEnabled
                  ? 'bg-cyan-500/20 text-cyan-300 border-cyan-500/40 shadow-sm'
                  : 'bg-slate-900 text-slate-500 border-slate-800'
              }`}
              title="Toggle Floating Telemetry HUD Card and Tactical Compass directly over map"
            >
              <Layers className="w-3 h-3" />
              HUD Cards: {hudCardsEnabled ? 'ON' : 'OFF'}
            </button>

            {/* Layout Mode Selector */}
            <div className="flex items-center bg-slate-900 border border-slate-700/80 rounded p-0.5">
              <button
                type="button"
                onClick={() => setLayoutMode('hero')}
                className={`px-2 py-1 rounded transition font-bold ${
                  layoutMode === 'hero'
                    ? 'bg-cyan-500 text-slate-950 shadow-sm'
                    : 'text-slate-400 hover:text-slate-200'
                }`}
                title="Dominant 75% Tactical Map with Side Instrument Stack"
              >
                Hero Map (75/25)
              </button>
              <button
                type="button"
                onClick={() => setLayoutMode('cinema')}
                className={`px-2 py-1 rounded transition font-bold ${
                  layoutMode === 'cinema'
                    ? 'bg-cyan-500 text-slate-950 shadow-sm'
                    : 'text-slate-400 hover:text-slate-200'
                }`}
                title="100% Full-Width Cinema Map with Floating HUD Cards"
              >
                Full Cinema (100%)
              </button>
              <button
                type="button"
                onClick={() => setLayoutMode('split')}
                className={`px-2 py-1 rounded transition font-bold ${
                  layoutMode === 'split'
                    ? 'bg-cyan-500 text-slate-950 shadow-sm'
                    : 'text-slate-400 hover:text-slate-200'
                }`}
                title="3 Equal Columns Flight Deck"
              >
                3-Col Split
              </button>
            </div>

            {/* Height Size Presets */}
            <div className="flex items-center bg-slate-900 border border-slate-700/80 rounded p-0.5">
              <button
                type="button"
                onClick={() => setMapSize('standard')}
                className={`px-2 py-1 rounded transition text-[10px] font-bold ${
                  mapSize === 'standard'
                    ? 'bg-slate-700 text-white'
                    : 'text-slate-400 hover:text-slate-200'
                }`}
                title="Standard 520px Height"
              >
                520px
              </button>
              <button
                type="button"
                onClick={() => setMapSize('tall')}
                className={`px-2 py-1 rounded transition text-[10px] font-bold ${
                  mapSize === 'tall'
                    ? 'bg-slate-700 text-white'
                    : 'text-slate-400 hover:text-slate-200'
                }`}
                title="Large 640px Height (Recommended)"
              >
                640px
              </button>
              <button
                type="button"
                onClick={() => setMapSize('max')}
                className={`px-2 py-1 rounded transition text-[10px] font-bold ${
                  mapSize === 'max'
                    ? 'bg-slate-700 text-white'
                    : 'text-slate-400 hover:text-slate-200'
                }`}
                title="Maximized 800px Height"
              >
                800px
              </button>
            </div>
          </div>
        </div>

        {/* Dynamic Multi-Form Factor Layout Rendering */}
        {layoutMode === 'hero' && (
          /* Form 1: Hero Dominant Map (75% / 25%) */
          <div className="grid grid-cols-1 lg:grid-cols-12 gap-4 items-stretch">
            {/* Dominant Large Google Map (8 cols on lg, 9 cols on xl) */}
            <div className="lg:col-span-8 xl:col-span-9 flex flex-col">
              <GcsGpsMap
                heightClass={getMapHeightClass()}
                showHudOverlays={hudCardsEnabled}
                initialProvider="google_hybrid"
                onWaypointMoved={handleWaypointMoved}
                onMapClickWaypointAdd={handleAddWaypoint}
                onDeleteWaypoint={handleDeleteWaypoint}
                className="flex-1 shadow-2xl border-slate-800"
              />
            </div>

            {/* Right Instrument Stack (4 cols on lg, 3 cols on xl) */}
            <div className="lg:col-span-4 xl:col-span-3 flex flex-col gap-4">
              <ArtificialHorizon
                rollDeg={telemetry.attitude.roll_deg}
                pitchDeg={telemetry.attitude.pitch_deg}
                yawDeg={telemetry.attitude.yaw_deg}
                isStale={isStale}
              />
              <div className="flex-1 flex flex-col">
                <TelemetryHealthPanel />
              </div>
            </div>
          </div>
        )}

        {layoutMode === 'cinema' && (
          /* Form 2: Full Cinema 100% Width Google Map with Floating HUD Cards */
          <div className="space-y-4">
            <div className="w-full">
              <GcsGpsMap
                heightClass={getMapHeightClass()}
                showHudOverlays={hudCardsEnabled}
                initialProvider="google_hybrid"
                onWaypointMoved={handleWaypointMoved}
                onMapClickWaypointAdd={handleAddWaypoint}
                onDeleteWaypoint={handleDeleteWaypoint}
                className="w-full shadow-2xl border-slate-800"
              />
            </div>

            {/* Flight Instruments neatly docked below cinema map */}
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              <ArtificialHorizon
                rollDeg={telemetry.attitude.roll_deg}
                pitchDeg={telemetry.attitude.pitch_deg}
                yawDeg={telemetry.attitude.yaw_deg}
                isStale={isStale}
              />
              <TelemetryHealthPanel />
            </div>
          </div>
        )}

        {layoutMode === 'split' && (
          /* Form 3: Classic 3-Column Split (Equally Proportioned) */
          <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
            <div className="lg:col-span-1">
              <ArtificialHorizon
                rollDeg={telemetry.attitude.roll_deg}
                pitchDeg={telemetry.attitude.pitch_deg}
                yawDeg={telemetry.attitude.yaw_deg}
                isStale={isStale}
              />
            </div>

            <div className="lg:col-span-1">
              <GcsGpsMap
                heightClass="h-[460px] lg:h-[480px]"
                showHudOverlays={hudCardsEnabled}
                initialProvider="google_hybrid"
                onWaypointMoved={handleWaypointMoved}
                onMapClickWaypointAdd={handleAddWaypoint}
                onDeleteWaypoint={handleDeleteWaypoint}
                className="shadow-xl border-slate-800"
              />
            </div>

            <div className="lg:col-span-1">
              <TelemetryHealthPanel />
            </div>
          </div>
        )}
      </div>

      {/* 6. CONSOLIDATED MISSION / WAYPOINT ROUTE TIMELINE RIBBON */}
      <TacticalMissionTimeline
        waypoints={waypoints}
        currentWaypointIndex={currentWaypointIndex}
        homePosition={homePosition}
        isMissionActive={missionProgress?.is_active || telemetry.flight.mode === 'AUTO'}
      />

      {/* 7. CONSOLIDATED TACTICAL BOTTOM PANELS (Status / Autopilot Mode / Nav / Distance to RP) */}
      <TacticalBottomPanels
        telemetry={telemetry}
        waypoints={waypoints}
        currentWaypointIndex={currentWaypointIndex}
        missionProgress={missionProgress || undefined}
      />

      {/* 8. CONSOLIDATED GNSS STATE & SATELLITE CONSTELLATION STATUS */}
      <div className="pt-1">
        <GcsGpsStatusPanel />
      </div>

      {/* 9. Subsystem Readiness, Safety Failsafe Monitor, and Sensor Health */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
        <MissionStatusWidget />
        <SafetyFailsafePanel />
        <SensorHealthWidget />
      </div>

      {/* 10. Pre-Flight Readiness Subsystem Check */}
      <PreFlightCheckPanel />

      {/* 11. Operator Flight Controls & Activity Event Stream */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        <OperatorControlPanel />
        <ActivityEventLog />
      </div>
    </div>
  );
};

export default DashboardPage;
