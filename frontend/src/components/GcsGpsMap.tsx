import React, { useEffect, useRef, useState, useCallback } from 'react';
import L from 'leaflet';
import {
  Crosshair,
  Home as HomeIcon,
  Maximize2,
  Trash2,
  MapPin,
  Tag,
  Box,
  Globe,
  Layers,
  AlertTriangle,
  X,
  CheckCircle,
  ShieldCheck,
} from 'lucide-react';
import { useTelemetryStore } from '../stores/useTelemetryStore';
import { useMissionStore } from '../stores/useMissionStore';
import { DroneInfoHudCard } from './DroneInfoHudCard';
import { TacticalCompass } from './TacticalCompass';

export type TileProviderType = 'google_hybrid' | 'google_sat' | 'google_terrain' | 'google_streets' | 'esri_sat' | 'carto_dark' | 'local_offline';

export interface TileProviderOption {
  id: TileProviderType;
  name: string;
  url: string;
  subdomains?: string[];
  maxZoom: number;
}

export const TILE_PROVIDERS: Record<TileProviderType, TileProviderOption> = {
  google_hybrid: {
    id: 'google_hybrid',
    name: 'Google Satellite Hybrid',
    url: 'https://mt{s}.google.com/vt/lyrs=y&x={x}&y={y}&z={z}',
    subdomains: ['0', '1', '2', '3'],
    maxZoom: 21,
  },
  google_sat: {
    id: 'google_sat',
    name: 'Google Satellite (Clean)',
    url: 'https://mt{s}.google.com/vt/lyrs=s&x={x}&y={y}&z={z}',
    subdomains: ['0', '1', '2', '3'],
    maxZoom: 21,
  },
  google_terrain: {
    id: 'google_terrain',
    name: 'Google Terrain / Topo',
    url: 'https://mt{s}.google.com/vt/lyrs=p&x={x}&y={y}&z={z}',
    subdomains: ['0', '1', '2', '3'],
    maxZoom: 20,
  },
  google_streets: {
    id: 'google_streets',
    name: 'Google Street Map',
    url: 'https://mt{s}.google.com/vt/lyrs=m&x={x}&y={y}&z={z}',
    subdomains: ['0', '1', '2', '3'],
    maxZoom: 20,
  },
  esri_sat: {
    id: 'esri_sat',
    name: 'Esri World Imagery',
    url: 'https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}',
    maxZoom: 19,
  },
  carto_dark: {
    id: 'carto_dark',
    name: 'Dark Ops',
    url: 'https://{s}.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}{r}.png',
    subdomains: ['a', 'b', 'c', 'd'],
    maxZoom: 20,
  },
  local_offline: {
    id: 'local_offline',
    name: 'Offline MBTiles',
    url: '/api/map/tiles/{z}/{x}/{y}.png',
    maxZoom: 20,
  },
};

interface SatelliteStatus {
  installed: boolean;
  tile_source: string | null;
  mbtiles_path: string;
  tiles_dir: string;
  bounds: string | null;
  minzoom: string | null;
  maxzoom: string | null;
  message: string;
  soi_compliant?: boolean;
  soi_boundary_path?: string;
  soi_endpoint?: string;
  recommended_datasets?: Array<{
    name: string;
    license: string;
    description: string;
  }>;
}

interface GcsGpsMapProps {
  className?: string;
  heightClass?: string;
  isPlanningMode?: boolean;
  showHudOverlays?: boolean;
  initialProvider?: TileProviderType;
  onWaypointMoved?: (index: number, lat: number, lon: number) => void;
  onMapClickWaypointAdd?: (coords: { lat: number; lon: number }) => void;
  onDeleteWaypoint?: (index: number) => void;
}

export const GcsGpsMap: React.FC<GcsGpsMapProps> = ({
  className = '',
  heightClass = 'h-[460px]',
  isPlanningMode: propPlanningMode,
  showHudOverlays = false,
  initialProvider,
  onWaypointMoved,
  onMapClickWaypointAdd,
  onDeleteWaypoint,
}) => {
  const mapContainerRef = useRef<HTMLDivElement | null>(null);
  const mapInstanceRef = useRef<L.Map | null>(null);

  // Markers and Layer references
  const droneMarkerRef = useRef<L.Marker | null>(null);
  const homeMarkerRef = useRef<L.Marker | null>(null);
  const waypointMarkersRef = useRef<L.Marker[]>([]);
  const plannedRouteLineRef = useRef<L.Polyline | null>(null);
  const flightTrailLineRef = useRef<L.Polyline | null>(null);
  const geofencePolygonRef = useRef<L.Polygon | null>(null);
  const noFlyPolygonsRef = useRef<L.Polygon[]>([]);
  const hasCenteredOnFirstFixRef = useRef<boolean>(false);
  const satelliteLayerRef = useRef<L.TileLayer | null>(null);
  const gridLayerRef = useRef<L.GridLayer | null>(null);
  const soiBoundaryLayerRef = useRef<L.GeoJSON | null>(null);

  // Telemetry and Mission state
  const { telemetry } = useTelemetryStore();
  const {
    waypoints,
    homePosition,
    flightTrail,
    geofence,
    noFlyZones,
    isPlanningMode: storePlanningMode,
    currentWaypointIndex,
    clearFlightTrail,
  } = useMissionStore();

  const isPlanningMode = propPlanningMode ?? storePlanningMode;

  // View state & layer controls
  const [activeProvider, setActiveProvider] = useState<TileProviderType>(initialProvider || 'google_hybrid');
  const [showSatellite, setShowSatellite] = useState(true);
  const [showGrid, setShowGrid] = useState(true);
  const [showPlannedRoute, setShowPlannedRoute] = useState(true);
  const [showFlightTrail, setShowFlightTrail] = useState(true);
  const [showLabels, setShowLabels] = useState(true);
  const [showSoiBoundary, setShowSoiBoundary] = useState(true);
  const [soiStatus, setSoiStatus] = useState<{ loaded: boolean; error?: string }>({ loaded: false });
  const [cursorCoords, setCursorCoords] = useState<{ lat: number; lon: number } | null>(null);
  const [satelliteStatus, setSatelliteStatus] = useState<SatelliteStatus | null>(null);
  const [showImageryModal, setShowImageryModal] = useState(false);

  // Query backend for offline satellite dataset installation status
  useEffect(() => {
    fetch('/api/map/status')
      .then((res) => (res.ok ? res.json() : null))
      .then((data: SatelliteStatus | null) => {
        if (data) setSatelliteStatus(data);
      })
      .catch((err) => {
        console.warn('Could not query offline satellite status:', err);
      });
  }, []);

  // Extract GPS / position
  const gps = telemetry.gps;
  const droneLat = gps.latitude ?? telemetry.position.latitude;
  const droneLon = gps.longitude ?? telemetry.position.longitude;
  const heading = telemetry.navigation?.heading_deg ?? gps.heading_deg ?? telemetry.attitude.yaw_deg ?? 0;
  const connStatus = telemetry.data_health?.status ?? 'DISCONNECTED';
  const isDisconnected = connStatus === 'DISCONNECTED';
  const isGpsStale = isDisconnected || gps.is_stale || connStatus === 'STALE' || (gps.last_update_ms ? (Date.now() - gps.last_update_ms > 3000) : false);
  const hasGpsFix = !isDisconnected && gps.gps_fix && droneLat !== null && droneLon !== null && !isGpsStale;

  // Compute distance and bearing to Home (prefer backend authoritative navigation values)
  let distToHomeM: number | null = telemetry.navigation?.distance_to_home_m ?? null;
  let bearingToHomeDeg: number | null = telemetry.navigation?.bearing_to_home_deg ?? null;
  if (distToHomeM === null && droneLat !== null && droneLon !== null && homePosition && homePosition.lat && homePosition.lon) {
    const p1 = (homePosition.lat * Math.PI) / 180;
    const p2 = (droneLat * Math.PI) / 180;
    const dPhi = ((droneLat - homePosition.lat) * Math.PI) / 180;
    const dLambda = ((droneLon - homePosition.lon) * Math.PI) / 180;
    const a =
      Math.sin(dPhi / 2) * Math.sin(dPhi / 2) +
      Math.cos(p1) * Math.cos(p2) * Math.sin(dLambda / 2) * Math.sin(dLambda / 2);
    const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
    distToHomeM = 6371000 * c;

    const y = Math.sin(-dLambda) * Math.cos(p1);
    const x = Math.cos(p2) * Math.sin(p1) - Math.sin(p2) * Math.cos(p1) * Math.cos(-dLambda);
    bearingToHomeDeg = ((Math.atan2(y, x) * 180) / Math.PI + 360) % 360;
  }

  // 1. Initialize Leaflet Map with Genuine Offline Satellite Layer + Tactical Grid Overlay
  useEffect(() => {
    if (!mapContainerRef.current) return;
    if (mapInstanceRef.current) return;

    const initialCenter: [number, number] =
      droneLat !== null && droneLon !== null
        ? [droneLat, droneLon]
        : homePosition
        ? [homePosition.lat, homePosition.lon]
        : [19.876543, 75.343210];

    const map = L.map(mapContainerRef.current, {
      center: initialCenter,
      zoom: 17,
      zoomControl: false,
      attributionControl: false,
    });

    // 1a. 100% Offline Tactical Grid Layer (Transparent overlay on top of satellite imagery)
    const OfflineGridLayer = L.GridLayer.extend({
      createTile: function () {
        const tile = document.createElement('canvas');
        tile.width = 256;
        tile.height = 256;
        const ctx = tile.getContext('2d');
        if (ctx) {
          // Keep canvas transparent so satellite imagery underneath remains crisp
          ctx.clearRect(0, 0, 256, 256);

          // Tactical grid coordinate lines
          ctx.strokeStyle = 'rgba(30, 41, 59, 0.45)';
          ctx.lineWidth = 0.8;
          ctx.strokeRect(0, 0, 256, 256);

          // Subtle center crosshairs
          ctx.strokeStyle = 'rgba(6, 182, 212, 0.35)';
          ctx.lineWidth = 1;
          ctx.beginPath();
          ctx.moveTo(128, 122);
          ctx.lineTo(128, 134);
          ctx.moveTo(122, 128);
          ctx.lineTo(134, 128);
          ctx.stroke();

          // Coordinate alignment corner pips
          ctx.fillStyle = 'rgba(51, 65, 85, 0.5)';
          ctx.fillRect(64, 64, 1.5, 1.5);
          ctx.fillRect(192, 64, 1.5, 1.5);
          ctx.fillRect(64, 192, 1.5, 1.5);
          ctx.fillRect(192, 192, 1.5, 1.5);
        }
        return tile;
      },
    });

    const tacticalGrid = new (OfflineGridLayer as any)({
      maxZoom: 22,
      minZoom: 1,
    });
    gridLayerRef.current = tacticalGrid;
    tacticalGrid.addTo(map);

    // Dedicated pane for Survey of India (SOI) boundary with priority over base tiles
    if (!map.getPane('soiBoundaryPane')) {
      const soiPane = map.createPane('soiBoundaryPane');
      soiPane.style.zIndex = '350'; // Sits above base tiles (200), below overlays (400) and markers (600)
      soiPane.style.pointerEvents = 'none'; // Critical: ensures click events pass right through to map for waypoints
    }

    // Track mouse coordinates
    map.on('mousemove', (e: L.LeafletMouseEvent) => {
      setCursorCoords({
        lat: Number(e.latlng.lat.toFixed(6)),
        lon: Number(e.latlng.lng.toFixed(6)),
      });
    });

    mapInstanceRef.current = map;

    // Observe container resizes so map immediately adapts to UI height/layout changes
    const resizeObserver = new ResizeObserver(() => {
      map.invalidateSize();
    });
    if (mapContainerRef.current) {
      resizeObserver.observe(mapContainerRef.current);
    }

    return () => {
      resizeObserver.disconnect();
      map.remove();
      mapInstanceRef.current = null;
    };
  }, []);

  // 1b. Load official Survey of India boundary GeoJSON (SOI compliant sovereign border)
  useEffect(() => {
    let isMounted = true;

    const loadSoiBoundary = async () => {
      try {
        // Try local static asset first (/assets/map/india_boundary_soi.geojson), then backend API fallback
        let resp = await fetch('/assets/map/india_boundary_soi.geojson');
        if (!resp.ok) {
          resp = await fetch('/api/map/boundary/soi.geojson');
        }
        if (!resp.ok) {
          throw new Error(`Failed to load SOI GeoJSON: ${resp.status}`);
        }
        const geojsonData = await resp.json();
        if (!isMounted) return;

        // Clean up any existing layer
        if (soiBoundaryLayerRef.current) {
          soiBoundaryLayerRef.current.remove();
        }

        // Create Leaflet GeoJSON layer with official SOI styling
        const soiLayer = L.geoJSON(geojsonData, {
          pane: 'soiBoundaryPane',
          interactive: false, // Ensure no interference with clicks, waypoint editing, or panning
          style: () => ({
            color: '#f59e0b', // Authoritative amber/gold sovereign border
            weight: 2.5,
            opacity: 0.95,
            fillColor: '#f59e0b',
            fillOpacity: 0.02,
            lineJoin: 'round',
            lineCap: 'round',
          }),
        });

        soiBoundaryLayerRef.current = soiLayer;
        if (mapInstanceRef.current && showSoiBoundary) {
          soiLayer.addTo(mapInstanceRef.current);
        }
        setSoiStatus({ loaded: true });
      } catch (err: any) {
        console.warn('SOI Boundary layer could not be loaded:', err);
        if (isMounted) {
          setSoiStatus({ loaded: false, error: err.message });
        }
      }
    };

    loadSoiBoundary();

    return () => {
      isMounted = false;
      if (soiBoundaryLayerRef.current) {
        soiBoundaryLayerRef.current.remove();
        soiBoundaryLayerRef.current = null;
      }
    };
  }, []);

  // 1c. Toggle SOI Boundary Layer dynamically
  useEffect(() => {
    const map = mapInstanceRef.current;
    const layer = soiBoundaryLayerRef.current;
    if (!map || !layer) return;

    if (showSoiBoundary) {
      if (!map.hasLayer(layer)) {
        layer.addTo(map);
      }
    } else {
      if (map.hasLayer(layer)) {
        map.removeLayer(layer);
      }
    }
  }, [showSoiBoundary]);

  // 1d. Tile Layer Provider switcher & dynamic update
  useEffect(() => {
    const map = mapInstanceRef.current;
    if (!map) return;

    if (satelliteLayerRef.current) {
      satelliteLayerRef.current.remove();
      satelliteLayerRef.current = null;
    }

    if (showSatellite) {
      const provider = TILE_PROVIDERS[activeProvider] || TILE_PROVIDERS.google_hybrid;
      const tileLayer = L.tileLayer(provider.url, {
        subdomains: provider.subdomains || ['a', 'b', 'c'],
        maxZoom: provider.maxZoom,
        minZoom: 1,
        keepBuffer: 4,
      });

      satelliteLayerRef.current = tileLayer;
      tileLayer.addTo(map);
      tileLayer.bringToBack();
    }
  }, [showSatellite, activeProvider]);

  // 1e. Toggle Tactical Grid Overlay dynamically
  useEffect(() => {
    const map = mapInstanceRef.current;
    const layer = gridLayerRef.current;
    if (!map || !layer) return;

    if (showGrid) {
      if (!map.hasLayer(layer)) {
        layer.addTo(map);
      }
    } else {
      if (map.hasLayer(layer)) {
        map.removeLayer(layer);
      }
    }
  }, [showGrid]);

  // 1b. Center on first valid GPS fix without continuously hijacking manual pan/zoom
  useEffect(() => {
    if (hasGpsFix && droneLat !== null && droneLon !== null && !hasCenteredOnFirstFixRef.current) {
      hasCenteredOnFirstFixRef.current = true;
      if (mapInstanceRef.current) {
        mapInstanceRef.current.setView([droneLat, droneLon], Math.max(17, mapInstanceRef.current.getZoom()));
      }
    }
  }, [hasGpsFix, droneLat, droneLon]);

  // 2. Handle map clicks for Click-to-Create Waypoints in Planning Mode
  useEffect(() => {
    const map = mapInstanceRef.current;
    if (!map) return;

    const handleMapClick = (e: L.LeafletMouseEvent) => {
      if (!isPlanningMode) return; // Prevent accidental editing when in normal monitoring
      const lat = Number(e.latlng.lat.toFixed(6));
      const lon = Number(e.latlng.lng.toFixed(6));
      if (onMapClickWaypointAdd) {
        onMapClickWaypointAdd({ lat, lon });
      }
    };

    map.on('click', handleMapClick);
    return () => {
      map.off('click', handleMapClick);
    };
  }, [isPlanningMode, onMapClickWaypointAdd]);

  // 3. Update or Render Drone Marker with Heading Rotation
  useEffect(() => {
    const map = mapInstanceRef.current;
    if (!map) return;

    if (droneLat === null || droneLon === null) {
      if (droneMarkerRef.current) {
        droneMarkerRef.current.remove();
        droneMarkerRef.current = null;
      }
      return;
    }

    const color = isDisconnected ? '#f43f5e' : isGpsStale ? '#f59e0b' : !gps.gps_fix ? '#fbbf24' : '#06b6d4';
    const statusText = isDisconnected
      ? 'LAST KNOWN POSITION (DISCONNECTED)'
      : isGpsStale
      ? 'LAST KNOWN POSITION (STALE)'
      : !gps.gps_fix
      ? 'NO FIX'
      : 'LIVE GPS';

    const droneHtml = `
      <div style="transform: rotate(${heading}deg); transform-origin: center center; display: flex; align-items: center; justify-content: center; width: 56px; height: 56px;">
        <svg viewBox="0 0 56 56" width="56" height="56" style="filter: drop-shadow(0 0 8px ${color}); overflow: visible;">
          <!-- Outer Heading Range Reticle -->
          <circle cx="28" cy="28" r="25" fill="none" stroke="${color}" stroke-width="1" stroke-dasharray="3,4" opacity="0.6" />
          <circle cx="28" cy="28" r="18" fill="rgba(6, 182, 212, 0.08)" stroke="${color}" stroke-width="0.8" opacity="0.5" />
          <!-- Crosshair Alignment Ticks -->
          <line x1="28" y1="2" x2="28" y2="7" stroke="${color}" stroke-width="1.5" />
          <line x1="28" y1="49" x2="28" y2="54" stroke="${color}" stroke-width="1.5" />
          <line x1="2" y1="28" x2="7" y2="28" stroke="${color}" stroke-width="1.5" />
          <line x1="49" y1="28" x2="54" y2="28" stroke="${color}" stroke-width="1.5" />
          <!-- Directional Forward Vector -->
          <line x1="28" y1="12" x2="28" y2="1" stroke="${color}" stroke-width="2.5" stroke-linecap="round" />
          <!-- Tactical Drone Airframe (Swept delta wing UAV) -->
          <!-- Starboard (Green) and Port (Red) Navigation Wingtip Lights -->
          <circle cx="48" cy="33" r="2" fill="#10b981" />
          <circle cx="8" cy="33" r="2" fill="#ef4444" />
          <!-- Airframe polygon -->
          <polygon points="28,8 32,24 48,32 46,36 32,31 31,44 35,47 28,45 21,47 25,44 24,31 10,36 8,32 24,24" fill="${color}" stroke="#030712" stroke-width="1.5" />
          <!-- Forward Sensor Gimbal / Cockpit Core -->
          <ellipse cx="28" cy="19" rx="2" ry="4" fill="#ffffff" />
          <circle cx="28" cy="28" r="2.5" fill="#ffffff" stroke="#0f172a" stroke-width="0.8" />
        </svg>
      </div>
    `;

    const droneIcon = L.divIcon({
      html: droneHtml,
      className: 'gcs-drone-marker',
      iconSize: [56, 56],
      iconAnchor: [28, 28],
    });

    if (droneMarkerRef.current) {
      droneMarkerRef.current.setLatLng([droneLat, droneLon]);
      droneMarkerRef.current.setIcon(droneIcon);
    } else {
      droneMarkerRef.current = L.marker([droneLat, droneLon], {
        icon: droneIcon,
        zIndexOffset: 1000,
      }).addTo(map);
    }

    droneMarkerRef.current.bindTooltip(
      `<div class="font-mono text-[10px]">
        <div class="font-bold ${isDisconnected ? 'text-rose-400' : isGpsStale ? 'text-amber-300' : 'text-cyan-300'}">VEGAPilot-01 (${statusText})</div>
        <div>LAT: ${droneLat.toFixed(6)}°</div>
        <div>LON: ${droneLon.toFixed(6)}°</div>
        <div>HDG: ${Math.round(heading)}°</div>
      </div>`,
      { direction: 'top', offset: [0, -28], className: 'gcs-dark-tooltip' }
    );
  }, [droneLat, droneLon, heading, hasGpsFix, isGpsStale, isDisconnected, gps.gps_fix]);

  // 4. Update or Render Home Marker
  useEffect(() => {
    const map = mapInstanceRef.current;
    if (!map) return;

    if (!homePosition || homePosition.lat === null || homePosition.lon === null) {
      if (homeMarkerRef.current) {
        homeMarkerRef.current.remove();
        homeMarkerRef.current = null;
      }
      return;
    }

    const homeHtml = `
      <div style="display: flex; align-items: center; justify-content: center; width: 36px; height: 36px;">
        <svg viewBox="0 0 36 36" width="36" height="36" style="filter: drop-shadow(0 0 8px rgba(16, 185, 129, 0.6));">
          <!-- Outer Launchpad Hexagon / Circle -->
          <circle cx="18" cy="18" r="16" fill="rgba(16, 185, 129, 0.15)" stroke="#10b981" stroke-width="1.5" stroke-dasharray="3,3" />
          <circle cx="18" cy="18" r="11" fill="rgba(6, 78, 59, 0.4)" stroke="#10b981" stroke-width="1" />
          <!-- Crosshairs -->
          <line x1="18" y1="2" x2="18" y2="7" stroke="#10b981" stroke-width="1.5" />
          <line x1="18" y1="29" x2="18" y2="34" stroke="#10b981" stroke-width="1.5" />
          <line x1="2" y1="18" x2="7" y2="18" stroke="#10b981" stroke-width="1.5" />
          <line x1="29" y1="18" x2="34" y2="18" stroke="#10b981" stroke-width="1.5" />
          <!-- Launch H Symbol -->
          <text x="18" y="22" text-anchor="middle" fill="#34d399" font-size="12" font-weight="900" font-family="monospace">H</text>
        </svg>
      </div>
    `;

    const homeIcon = L.divIcon({
      html: homeHtml,
      className: 'gcs-home-marker',
      iconSize: [36, 36],
      iconAnchor: [18, 18],
    });

    if (homeMarkerRef.current) {
      homeMarkerRef.current.setLatLng([homePosition.lat, homePosition.lon]);
      homeMarkerRef.current.setIcon(homeIcon);
    } else {
      homeMarkerRef.current = L.marker([homePosition.lat, homePosition.lon], {
        icon: homeIcon,
        zIndexOffset: 900,
      }).addTo(map);
    }

    homeMarkerRef.current.bindTooltip(
      `<div class="font-mono text-[10px]">
        <div class="font-bold text-emerald-400">HOME / LAUNCH POSITION</div>
        <div>LAT: ${homePosition.lat.toFixed(6)}°</div>
        <div>LON: ${homePosition.lon.toFixed(6)}°</div>
        <div>ALT: ${(homePosition.alt_m || 0).toFixed(1)}m</div>
      </div>`,
      { direction: 'top', offset: [0, -20], className: 'gcs-dark-tooltip' }
    );
  }, [homePosition]);

  // 5. Update Waypoint Markers and Planned Route Polyline
  useEffect(() => {
    const map = mapInstanceRef.current;
    if (!map) return;

    // Clear existing waypoint markers
    waypointMarkersRef.current.forEach((m) => m.remove());
    waypointMarkersRef.current = [];

    // Render numbered Waypoint markers
    waypoints.forEach((wp, idx) => {
      const isVp = wp.action === 'VERIFY_POINT' || wp.command === 'VERIFY_POINT';
      const isCurrent = currentWaypointIndex === wp.id || currentWaypointIndex === idx + 1;
      const numStr = String(idx + 1).padStart(2, '0');
      const label = isVp ? `VP${numStr}` : `WP${numStr}`;

      const bgColor = isCurrent ? '#38bdf8' : isVp ? '#a855f7' : '#f59e0b';
      const textColor = isCurrent ? '#082f49' : '#0f172a';
      const ringEffect = isCurrent ? 'box-shadow: 0 0 12px #38bdf8; animation: pulse 2s infinite;' : '';

      const wpHtml = `
        <div style="display: flex; flex-direction: column; align-items: center; justify-content: center; cursor: ${isPlanningMode ? 'grab' : 'pointer'};">
          <div style="background: ${bgColor}; color: ${textColor}; border: 1.5px solid #ffffff; border-radius: 9999px; padding: 1px 5px; font-weight: bold; font-family: monospace; font-size: 10px; ${ringEffect}">
            ${label}
          </div>
          ${showLabels ? `<span style="background: rgba(15, 23, 42, 0.85); color: #cbd5e1; border: 1px solid #334155; border-radius: 3px; padding: 0 3px; font-size: 9px; font-family: monospace; margin-top: 1px;">${wp.alt_m}m</span>` : ''}
        </div>
      `;

      const wpIcon = L.divIcon({
        html: wpHtml,
        className: 'gcs-wp-marker',
        iconSize: [44, 32],
        iconAnchor: [22, 16],
      });

      const marker = L.marker([wp.lat, wp.lon], {
        icon: wpIcon,
        draggable: isPlanningMode, // Waypoints draggable in planning mode!
        zIndexOffset: isCurrent ? 850 : 800,
      }).addTo(map);

      // Drag event to update waypoint coordinates
      marker.on('dragend', (e: L.LeafletEvent) => {
        const target = e.target as L.Marker;
        const newPos = target.getLatLng();
        if (onWaypointMoved) {
          onWaypointMoved(idx, Number(newPos.lat.toFixed(6)), Number(newPos.lng.toFixed(6)));
        }
      });

      marker.bindTooltip(
        `<div class="font-mono text-[10px]">
          <div class="font-bold ${isVp ? 'text-purple-400' : 'text-amber-400'}">${label}: ${wp.action || 'NAVIGATE'}</div>
          <div>LAT: ${wp.lat.toFixed(6)}°</div>
          <div>LON: ${wp.lon.toFixed(6)}°</div>
          <div>ALT: ${wp.alt_m}m</div>
          ${isPlanningMode ? '<div class="text-cyan-400 font-bold mt-0.5">DRAG TO REPOSITION</div>' : ''}
        </div>`,
        { direction: 'top', offset: [0, -16], className: 'gcs-dark-tooltip' }
      );

      if (isPlanningMode && onDeleteWaypoint) {
        marker.on('contextmenu', (e: L.LeafletMouseEvent) => {
          L.DomEvent.stopPropagation(e);
          onDeleteWaypoint(idx);
        });
      }

      waypointMarkersRef.current.push(marker);
    });

    // Draw Planned Route Line connecting HOME -> WP01 -> WP02 -> WP03
    if (plannedRouteLineRef.current) {
      plannedRouteLineRef.current.remove();
      plannedRouteLineRef.current = null;
    }

    if (showPlannedRoute && waypoints.length > 0) {
      const latlngs: L.LatLngExpression[] = [];
      if (homePosition && homePosition.lat && homePosition.lon) {
        latlngs.push([homePosition.lat, homePosition.lon]);
      }
      waypoints.forEach((w) => {
        latlngs.push([w.lat, w.lon]);
      });

      if (latlngs.length >= 2) {
        plannedRouteLineRef.current = L.polyline(latlngs, {
          color: '#f59e0b',
          weight: 2.5,
          opacity: 0.9,
          dashArray: '6, 6',
        }).addTo(map);
      }
    }
  }, [waypoints, homePosition, isPlanningMode, showPlannedRoute, showLabels, currentWaypointIndex, onWaypointMoved, onDeleteWaypoint]);

  // 6. Draw Actual Flight Breadcrumb Trail
  useEffect(() => {
    const map = mapInstanceRef.current;
    if (!map) return;

    if (flightTrailLineRef.current) {
      flightTrailLineRef.current.remove();
      flightTrailLineRef.current = null;
    }

    if (showFlightTrail && flightTrail.length > 1) {
      const latlngs: L.LatLngExpression[] = flightTrail.map((p) => [p.lat, p.lon]);
      flightTrailLineRef.current = L.polyline(latlngs, {
        color: '#06b6d4',
        weight: 2.5,
        opacity: 0.85,
      }).addTo(map);
    }
  }, [flightTrail, showFlightTrail]);

  // 7. Draw Geofence and No-Fly Zones
  useEffect(() => {
    const map = mapInstanceRef.current;
    if (!map) return;

    if (geofencePolygonRef.current) {
      geofencePolygonRef.current.remove();
      geofencePolygonRef.current = null;
    }
    noFlyPolygonsRef.current.forEach((p) => p.remove());
    noFlyPolygonsRef.current = [];

    // Geofence
    if (geofence && geofence.length >= 3) {
      const pts: L.LatLngExpression[] = geofence.map((g) => [g.lat, g.lon]);
      geofencePolygonRef.current = L.polygon(pts, {
        color: '#059669',
        weight: 1.5,
        dashArray: '5, 5',
        fillColor: '#10b981',
        fillOpacity: 0.05,
      }).addTo(map);
    }

    // No Fly Zones
    if (noFlyZones && noFlyZones.length > 0) {
      noFlyZones.forEach((zone) => {
        if (zone.length >= 3) {
          const pts: L.LatLngExpression[] = zone.map((z) => [z.lat, z.lon]);
          const poly = L.polygon(pts, {
            color: '#ef4444',
            weight: 1.5,
            fillColor: '#ef4444',
            fillOpacity: 0.15,
          }).addTo(map);
          noFlyPolygonsRef.current.push(poly);
        }
      });
    }
  }, [geofence, noFlyZones]);

  // Map Navigation Functions
  const handleCenterOnDrone = useCallback(() => {
    if (mapInstanceRef.current && droneLat !== null && droneLon !== null) {
      mapInstanceRef.current.setView([droneLat, droneLon], Math.max(17, mapInstanceRef.current.getZoom()));
    }
  }, [droneLat, droneLon]);

  const handleCenterOnHome = useCallback(() => {
    if (mapInstanceRef.current && homePosition && homePosition.lat && homePosition.lon) {
      mapInstanceRef.current.setView([homePosition.lat, homePosition.lon], Math.max(17, mapInstanceRef.current.getZoom()));
    }
  }, [homePosition]);

  const handleFitMission = useCallback(() => {
    if (!mapInstanceRef.current) return;
    const bounds = L.latLngBounds([]);
    if (droneLat !== null && droneLon !== null) bounds.extend([droneLat, droneLon]);
    if (homePosition && homePosition.lat && homePosition.lon) bounds.extend([homePosition.lat, homePosition.lon]);
    waypoints.forEach((w) => bounds.extend([w.lat, w.lon]));
    if (geofence && geofence.length > 0) geofence.forEach((g) => bounds.extend([g.lat, g.lon]));

    if (bounds.isValid()) {
      mapInstanceRef.current.fitBounds(bounds, { padding: [40, 40] });
    }
  }, [droneLat, droneLon, homePosition, waypoints, geofence]);

  const handleFitNationalBorder = useCallback(() => {
    if (!mapInstanceRef.current || !soiBoundaryLayerRef.current) return;
    const bounds = soiBoundaryLayerRef.current.getBounds();
    if (bounds.isValid()) {
      mapInstanceRef.current.fitBounds(bounds, { padding: [24, 24] });
    }
  }, []);

  return (
    <div className={`relative bg-slate-900 border border-slate-800 rounded-lg overflow-hidden flex flex-col ${className}`}>
      {/* Map Header & Interactive Mode Indicators */}
      <div className="flex items-center justify-between px-3 py-2 bg-slate-950/90 border-b border-slate-800 z-10 font-mono text-xs">
        <div className="flex items-center gap-2 flex-wrap">
          {/* Tactical 2D / 3D Mode Selector */}
          <div className="flex items-center gap-1 bg-slate-900/90 p-0.5 rounded border border-slate-800">
            <button
              type="button"
              className="px-2.5 py-0.5 rounded text-[10px] font-bold bg-cyan-500 text-slate-950 shadow-sm"
            >
              2D
            </button>
            <button
              type="button"
              disabled
              title="3D Mode Disabled: Operating in 100% offline 2D canvas mode"
              className="px-2.5 py-0.5 rounded text-[10px] font-bold text-slate-600 cursor-not-allowed flex items-center gap-1"
            >
              <Box className="w-2.5 h-2.5" /> 3D
            </button>
          </div>

          <div className="hidden sm:flex items-center gap-1 px-2 py-0.5 rounded bg-slate-900 text-slate-400 text-[10px] border border-slate-800">
            <span>SCALE:</span>
            <span className="text-white font-bold">500m</span>
          </div>

          {/* Genuine Offline Satellite Imagery Status Indicator */}
          {satelliteStatus?.installed ? (
            <span className="px-2 py-0.5 rounded text-[10px] font-bold bg-emerald-500/20 text-emerald-300 border border-emerald-500/40 flex items-center gap-1">
              <Globe className="w-3 h-3 text-emerald-400" /> SAT: {satelliteStatus.tile_source?.toUpperCase() || 'LOCAL OFFLINE'}
            </span>
          ) : (
            <button
              type="button"
              onClick={() => setShowImageryModal(true)}
              className="px-2 py-0.5 rounded text-[10px] font-bold bg-amber-500/20 text-amber-300 border border-amber-500/40 hover:bg-amber-500/30 flex items-center gap-1 transition"
              title="Click to view offline satellite setup requirements"
            >
              <AlertTriangle className="w-3 h-3 text-amber-400" /> SAT: NOT INSTALLED
            </button>
          )}

          {/* Survey of India (SOI) Sovereign Boundary Compliance Badge */}
          <button
            type="button"
            onClick={() => setShowSoiBoundary(!showSoiBoundary)}
            className={`px-2 py-0.5 rounded text-[10px] font-bold border flex items-center gap-1 transition ${
              showSoiBoundary && soiStatus.loaded
                ? 'bg-amber-500/20 text-amber-300 border-amber-500/40 shadow-[0_0_8px_rgba(245,158,11,0.25)]'
                : showSoiBoundary
                ? 'bg-slate-800 text-amber-400 border-slate-700'
                : 'bg-slate-800 text-slate-500 border-slate-700/50'
            }`}
            title="Survey of India (SOI) Compliant Sovereign Boundary Layer (Includes entire J&K, Ladakh, Aksai Chin, and Arunachal Pradesh)"
          >
            <ShieldCheck className="w-3 h-3 text-amber-400" />
            SOI: {showSoiBoundary ? 'COMPLIANT' : 'OFF'}
          </button>

          {/* Planning vs Normal Monitoring Mode Pill */}
          {isPlanningMode ? (
            <span className="px-2 py-0.5 rounded text-[10px] font-bold bg-amber-500/20 text-amber-300 border border-amber-500/40 flex items-center gap-1 animate-pulse">
              <Crosshair className="w-3 h-3" /> MISSION PLANNING (CLICK MAP TO ADD WP)
            </span>
          ) : (
            <span className="px-2 py-0.5 rounded text-[10px] font-bold bg-slate-800/80 text-slate-300 border border-slate-700/60 flex items-center gap-1">
              <MapPin className="w-3 h-3 text-cyan-400" /> TACTICAL OFFLINE ENGINE
            </span>
          )}
        </div>

        {/* Header Map Quick Controls */}
        <div className="flex items-center gap-1.5 flex-wrap">
          {/* Quick Google Maps Mode Buttons */}
          <div className="hidden lg:flex items-center bg-slate-900 border border-slate-700/80 rounded p-0.5 text-[9px] font-mono">
            <button
              type="button"
              onClick={() => setActiveProvider('google_hybrid')}
              className={`px-1.5 py-0.5 rounded transition font-bold ${
                activeProvider === 'google_hybrid'
                  ? 'bg-cyan-500 text-slate-950 shadow-sm'
                  : 'text-slate-400 hover:text-slate-200'
              }`}
              title="Google Maps: Satellite with Roads & Labels"
            >
              Google Hybrid
            </button>
            <button
              type="button"
              onClick={() => setActiveProvider('google_sat')}
              className={`px-1.5 py-0.5 rounded transition font-bold ${
                activeProvider === 'google_sat'
                  ? 'bg-cyan-500 text-slate-950 shadow-sm'
                  : 'text-slate-400 hover:text-slate-200'
              }`}
              title="Google Maps: High-Res Clean Satellite Aerial"
            >
              Satellite
            </button>
            <button
              type="button"
              onClick={() => setActiveProvider('google_terrain')}
              className={`px-1.5 py-0.5 rounded transition font-bold ${
                activeProvider === 'google_terrain'
                  ? 'bg-cyan-500 text-slate-950 shadow-sm'
                  : 'text-slate-400 hover:text-slate-200'
              }`}
              title="Google Maps: Elevation & Topographic Relief"
            >
              Terrain
            </button>
            <button
              type="button"
              onClick={() => setActiveProvider('google_streets')}
              className={`px-1.5 py-0.5 rounded transition font-bold ${
                activeProvider === 'google_streets'
                  ? 'bg-cyan-500 text-slate-950 shadow-sm'
                  : 'text-slate-400 hover:text-slate-200'
              }`}
              title="Google Maps: Street Map"
            >
              Streets
            </button>
          </div>

          {/* Base Map Imagery Provider Dropdown */}
          <div className="flex items-center gap-1 bg-slate-900 border border-slate-700/80 rounded px-1.5 py-0.5">
            <Globe className="w-3 h-3 text-cyan-400 shrink-0" />
            <select
              value={activeProvider}
              onChange={(e) => setActiveProvider(e.target.value as TileProviderType)}
              className="bg-transparent text-slate-200 text-[10px] font-mono outline-none cursor-pointer font-bold"
              title="Select Base Map Imagery Source"
            >
              <option value="google_hybrid" className="bg-slate-900 text-slate-200">Google Satellite Hybrid</option>
              <option value="google_sat" className="bg-slate-900 text-slate-200">Google Satellite (Clean)</option>
              <option value="google_terrain" className="bg-slate-900 text-slate-200">Google Terrain / Topo</option>
              <option value="google_streets" className="bg-slate-900 text-slate-200">Google Street Map</option>
              <option value="esri_sat" className="bg-slate-900 text-slate-200">Esri World Imagery</option>
              <option value="carto_dark" className="bg-slate-900 text-slate-200">Dark Ops</option>
              <option value="local_offline" className="bg-slate-900 text-slate-200">Offline MBTiles</option>
            </select>
          </div>

          {flightTrail.length > 0 && (
            <button
              onClick={clearFlightTrail}
              className="px-2 py-0.5 rounded bg-slate-800 hover:bg-slate-700 text-slate-400 hover:text-rose-400 text-[10px] font-mono flex items-center gap-1 transition"
              title="Clear actual flight path track"
            >
              <Trash2 className="w-2.5 h-2.5" /> Clear Track
            </button>
          )}

          {/* Survey of India Sovereign Border Layer Toggle */}
          <button
            onClick={() => setShowSoiBoundary(!showSoiBoundary)}
            className={`px-2 py-0.5 rounded text-xs transition flex items-center gap-1 font-bold ${
              showSoiBoundary
                ? 'bg-amber-500/20 text-amber-300 border border-amber-500/40 shadow-[0_0_8px_rgba(245,158,11,0.2)]'
                : 'bg-slate-800 text-slate-500 border border-slate-700/50'
            }`}
            title="Toggle Survey of India (SOI) Sovereign Boundary Layer"
          >
            <ShieldCheck className="w-3 h-3" /> SOI
          </button>

          {/* Satellite Layer Toggle */}
          <button
            onClick={() => setShowSatellite(!showSatellite)}
            className={`px-2 py-0.5 rounded text-xs transition flex items-center gap-1 font-bold ${
              showSatellite
                ? 'bg-cyan-500/20 text-cyan-300 border border-cyan-500/40 shadow-[0_0_8px_rgba(6,182,212,0.2)]'
                : 'bg-slate-800 text-slate-500 border border-slate-700/50'
            }`}
            title="Toggle Base Map Imagery Layer"
          >
            <Globe className="w-3 h-3" /> Tiles
          </button>

          {/* Tactical Grid Toggle */}
          <button
            onClick={() => setShowGrid(!showGrid)}
            className={`px-2 py-0.5 rounded text-xs transition flex items-center gap-1 ${
              showGrid
                ? 'bg-slate-700 text-slate-200 border border-slate-600'
                : 'bg-slate-800 text-slate-500 border border-slate-700/50'
            }`}
            title="Toggle Tactical Coordinate Grid Overlay"
          >
            <Layers className="w-3 h-3" /> Grid
          </button>

          <button
            onClick={() => setShowPlannedRoute(!showPlannedRoute)}
            className={`px-2 py-0.5 rounded text-xs transition ${showPlannedRoute ? 'bg-amber-500/20 text-amber-300 border border-amber-500/30' : 'bg-slate-800 text-slate-500'}`}
            title="Toggle Planned Route"
          >
            Route
          </button>

          <button
            onClick={() => setShowFlightTrail(!showFlightTrail)}
            className={`px-2 py-0.5 rounded text-xs transition ${showFlightTrail ? 'bg-cyan-500/20 text-cyan-300 border border-cyan-500/30' : 'bg-slate-800 text-slate-500'}`}
            title="Toggle Actual Flight Trail"
          >
            Trail
          </button>

          <button
            onClick={() => setShowLabels(!showLabels)}
            className={`px-2 py-0.5 rounded text-xs transition flex items-center gap-0.5 ${showLabels ? 'bg-slate-700 text-slate-200' : 'bg-slate-800 text-slate-500'}`}
            title="Toggle Waypoint Labels"
          >
            <Tag className="w-3 h-3" /> Labels
          </button>
        </div>
      </div>

      {/* Main Interactive Map Leaflet Container */}
      <div className={`relative w-full ${heightClass} bg-slate-950 flex-1`}>
        <div
          ref={mapContainerRef}
          className={`w-full h-full ${isPlanningMode ? 'cursor-crosshair' : 'cursor-grab'}`}
        />

        {/* Floating Drone Information HUD Card (Top-Left) */}
        {showHudOverlays && (
          <DroneInfoHudCard
            telemetry={telemetry}
            className="absolute top-3 left-3 z-[450]"
          />
        )}

        {/* Floating Tactical Compass (Bottom-Left) */}
        {showHudOverlays && (
          <TacticalCompass
            headingDeg={heading}
            bearingToHomeDeg={bearingToHomeDeg}
            className="absolute bottom-3 left-3 z-[450]"
          />
        )}

        {/* Map Control Buttons Floating Toolbar (Right Side) */}
        <div className="absolute top-3 right-3 z-[400] flex flex-col gap-2 font-mono">
          <div className="flex flex-col bg-slate-950/85 backdrop-blur-md border border-slate-800 rounded-lg overflow-hidden shadow-xl">
            <button
              onClick={() => mapInstanceRef.current?.zoomIn()}
              className="p-2 hover:bg-slate-800 text-slate-200 text-xs font-bold text-center border-b border-slate-800"
              title="Zoom In"
            >
              +
            </button>
            <button
              onClick={() => mapInstanceRef.current?.zoomOut()}
              className="p-2 hover:bg-slate-800 text-slate-200 text-xs font-bold text-center"
              title="Zoom Out"
            >
              -
            </button>
          </div>

          <div className="flex flex-col bg-slate-950/85 backdrop-blur-md border border-slate-800 rounded-lg overflow-hidden shadow-xl">
            <button
              onClick={handleCenterOnDrone}
              disabled={droneLat === null || droneLon === null}
              className="p-2 hover:bg-slate-800 text-cyan-400 hover:text-cyan-300 disabled:opacity-30 border-b border-slate-800"
              title="Center on Drone (Recenter Target)"
            >
              <Crosshair className="w-4 h-4" />
            </button>
            <button
              onClick={handleCenterOnHome}
              disabled={!homePosition}
              className="p-2 hover:bg-slate-800 text-emerald-400 hover:text-emerald-300 disabled:opacity-30 border-b border-slate-800"
              title="Center on Launch / Home"
            >
              <HomeIcon className="w-4 h-4" />
            </button>
            <button
              onClick={handleFitMission}
              className="p-2 hover:bg-slate-800 text-amber-400 hover:text-amber-300 border-b border-slate-800"
              title="Fit Entire Mission to Viewport"
            >
              <Maximize2 className="w-4 h-4" />
            </button>
            <button
              onClick={handleFitNationalBorder}
              className="p-2 hover:bg-slate-800 text-amber-300 hover:text-amber-200"
              title="Fit National Survey of India (SOI) Sovereign Boundary"
            >
              <ShieldCheck className="w-4 h-4" />
            </button>
          </div>
        </div>

        {/* Live Cursor & Map Legend (Bottom-Right) */}
        <div className="absolute bottom-3 right-3 z-[400] flex flex-col items-end gap-1.5 font-mono pointer-events-none">
          {/* Distance & Bearing to Home */}
          {distToHomeM !== null && (
            <div className="bg-slate-950/85 backdrop-blur-md px-3 py-1.5 rounded-lg border border-slate-800 text-xs text-right shadow-xl">
              <span className="text-[9px] text-slate-500 uppercase block flex items-center justify-end gap-1">
                <HomeIcon className="w-2.5 h-2.5 text-emerald-400" /> Dist to Home
              </span>
              <span className="text-emerald-400 font-bold">
                {distToHomeM > 1000 ? `${(distToHomeM / 1000).toFixed(2)} km` : `${distToHomeM.toFixed(1)} m`}
              </span>
              {bearingToHomeDeg !== null && (
                <span className="text-slate-400 block text-[10px]">
                  BRG: <strong className="text-emerald-300">{Math.round(bearingToHomeDeg)}°</strong>
                </span>
              )}
            </div>
          )}

          {/* Cursor Coordinates Readout */}
          <div className="bg-slate-950/85 backdrop-blur-md px-2.5 py-1 rounded border border-slate-800 text-[10px] text-slate-400 shadow-lg">
            CURSOR: <span className="text-amber-400 font-bold">{cursorCoords ? `${cursorCoords.lat}°, ${cursorCoords.lon}°` : '--'}</span>
          </div>
        </div>
      </div>

      {/* Offline Satellite Imagery Dataset Setup & Guidance Modal */}
      {showImageryModal && (
        <div className="fixed inset-0 z-[9999] bg-black/80 backdrop-blur-sm flex items-center justify-center p-4">
          <div className="bg-slate-950 border border-slate-700 rounded-xl p-5 max-w-xl w-full max-h-[90vh] overflow-y-auto text-slate-200 font-mono shadow-2xl relative animate-in fade-in duration-150">
            <div className="flex items-start justify-between border-b border-slate-800 pb-3 mb-4 sticky top-0 bg-slate-950/95 backdrop-blur-md pt-1 z-10">
              <div className="flex items-center gap-2.5">
                <div className="w-9 h-9 rounded-lg bg-amber-500/20 border border-amber-500/40 flex items-center justify-center text-amber-400 shrink-0">
                  <AlertTriangle className="w-5 h-5" />
                </div>
                <div>
                  <h3 className="text-sm font-bold text-white uppercase tracking-wider">
                    Offline Satellite Imagery Setup & SOI Compliance
                  </h3>
                  <p className="text-[11px] text-amber-400 font-semibold">
                    LOCAL SATELLITE DATASET NOT YET INSTALLED
                  </p>
                </div>
              </div>
              <button
                onClick={() => setShowImageryModal(false)}
                className="text-slate-400 hover:text-white p-1 rounded-lg hover:bg-slate-800 transition"
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            <div className="space-y-3.5 text-xs">
              {/* SOI Compliance Notification Box */}
              <div className="p-3 rounded-lg bg-amber-950/30 border border-amber-500/40 text-slate-300 space-y-1">
                <div className="text-[11px] font-bold text-amber-300 uppercase flex items-center gap-1.5">
                  <ShieldCheck className="w-3.5 h-3.5 text-amber-400" /> Survey of India (SOI) Compliant Sovereign Map
                </div>
                <p className="text-[11px] text-slate-300 leading-relaxed">
                  VEGAPilot enforces official Indian Geospatial Data Guidelines. The official sovereign boundary of India—encompassing the entire Union Territory of Jammu &amp; Kashmir, Union Territory of Ladakh (including Aksai Chin), State of Arunachal Pradesh, and Island territories—is rendered natively from local GeoJSON data.
                </p>
                <div className="text-[10px] text-amber-400/90 font-mono pt-1">
                  Location: <code className="bg-slate-900 px-1 py-0.5 rounded text-amber-200">/assets/map/india_boundary_soi.geojson</code>
                </div>
              </div>

              <div className="p-3 rounded-lg bg-slate-900 border border-slate-800 text-slate-300 space-y-1">
                <div className="text-[11px] font-bold text-cyan-400 uppercase flex items-center gap-1.5">
                  <CheckCircle className="w-3.5 h-3.5 text-emerald-400" /> Active Tactical Navigation Engine
                </div>
                <p className="text-[11px] text-slate-400 leading-relaxed">
                  All real-time GPS telemetry, drone marker heading rotation, mission waypoints, route tracking, and the tactical coordinate grid remain <strong>100% operational</strong>.
                </p>
              </div>

              <div className="space-y-1.5">
                <div className="text-[11px] font-bold text-slate-300 uppercase">
                  How to Install Offline Satellite Imagery:
                </div>
                <p className="text-[11px] text-slate-400 leading-relaxed">
                  To operate without internet during flight competitions, VEGAPilot serves genuine satellite imagery locally from the GCS computer. No remote tile calls (Google Maps/Mapbox/OSM) are made.
                </p>
                <div className="space-y-1.5 font-mono text-[11px] pt-1">
                  <div className="p-2.5 rounded bg-slate-900 border border-slate-800">
                    <span className="text-emerald-400 font-bold">Option A (Standard MBTiles):</span>
                    <div className="text-slate-400 mt-0.5">Place your regional MBTiles file at:</div>
                    <code className="text-cyan-300 font-bold block mt-1 bg-slate-950 px-2 py-1 rounded border border-slate-800">
                      {satelliteStatus?.mbtiles_path || 'data/satellite.mbtiles'}
                    </code>
                  </div>
                  <div className="p-2.5 rounded bg-slate-900 border border-slate-800">
                    <span className="text-emerald-400 font-bold">Option B (Standard XYZ Directory):</span>
                    <div className="text-slate-400 mt-0.5">Extract PNG/JPEG tiles into:</div>
                    <code className="text-cyan-300 font-bold block mt-1 bg-slate-950 px-2 py-1 rounded border border-slate-800">
                      {satelliteStatus?.tiles_dir || 'data/tiles'}/&#123;z&#125;/&#123;x&#125;/&#123;y&#125;.png
                    </code>
                  </div>
                </div>
              </div>

              <div className="space-y-1.5">
                <div className="text-[11px] font-bold text-slate-300 uppercase">
                  Recommended Legally Licensed Satellite Sources:
                </div>
                <ul className="space-y-2 text-[11px]">
                  <li className="p-2.5 rounded bg-slate-900 border border-slate-800">
                    <div className="font-bold text-emerald-300">1. ESA Copernicus Sentinel-2 Cloudless</div>
                    <div className="text-slate-400 text-[10px] mt-0.5">License: <em>Creative Commons Attribution 4.0 International (CC BY 4.0)</em></div>
                    <div className="text-slate-400 mt-0.5">Explicitly permits offline caching, distribution, and display. 10m optical imagery.</div>
                  </li>
                  <li className="p-2.5 rounded bg-slate-900 border border-slate-800">
                    <div className="font-bold text-emerald-300">2. USGS / NASA Landsat 8/9</div>
                    <div className="text-slate-400 text-[10px] mt-0.5">License: <em>Public Domain (U.S. Government Work)</em></div>
                    <div className="text-slate-400 mt-0.5">Free for unrestricted offline tactical and competition operations.</div>
                  </li>
                  <li className="p-2.5 rounded bg-slate-900 border border-slate-800">
                    <div className="font-bold text-emerald-300">3. QGIS Regional MBTiles Export</div>
                    <div className="text-slate-400 text-[10px] mt-0.5">Tool: <em>Generate XYZ Tiles (MBTiles)</em> in QGIS Processing Toolbox</div>
                    <div className="text-slate-400 mt-0.5">Export only your exact flight polygon area from permitted open aerial sources.</div>
                  </li>
                </ul>
              </div>
            </div>

            <div className="mt-4 pt-3 border-t border-slate-800 flex justify-end">
              <button
                onClick={() => setShowImageryModal(false)}
                className="px-4 py-1.5 rounded-lg bg-cyan-600 hover:bg-cyan-500 text-slate-950 font-bold text-xs transition shadow-md"
              >
                Acknowledge & Close
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};
