"""Mission lifecycle, history inspection, and CSV/JSON export routes."""
import csv
import io
import json
from typing import List, Optional, Dict, Any
from fastapi import APIRouter, HTTPException, Query, Response, Request
from pydantic import BaseModel
from sqlalchemy import select, desc, func, update
from app.api.telemetry import get_pipeline
from app.database.models import (
    Mission,
    TelemetryPacket,
    TelemetryGap,
    ConnectionEvent,
    current_time_ms,
)
from app.database.session import AsyncSessionLocal

router = APIRouter(prefix="/api/missions", tags=["missions"])


class CreateMissionRequest(BaseModel):
    name: str
    drone_id: Optional[str] = "VEGAPilot-01"


@router.get("")
async def list_missions() -> List[Dict[str, Any]]:
    """Lists all stored missions with duration and packet count summaries."""
    async with AsyncSessionLocal() as session:
        result = await session.execute(select(Mission).order_by(desc(Mission.created_at)))
        missions = result.scalars().all()

        output = []
        for m in missions:
            # Count packets
            count_res = await session.execute(
                select(func.count(TelemetryPacket.id)).where(TelemetryPacket.mission_id == m.mission_id)
            )
            pkt_count = count_res.scalar() or 0

            output.append({
                "id": m.id,
                "mission_id": m.mission_id,
                "drone_id": m.drone_id,
                "name": m.name,
                "started_at": m.started_at,
                "ended_at": m.ended_at,
                "status": m.status,
                "packet_count": pkt_count,
            })
        return output


COMPETITION_TEMPLATES = [
    {
        "id": "COURSE_ALPHA_SUAS",
        "name": "SUAS Standard Competition Course",
        "description": "6-waypoint verification perimeter course with Takeoff, Cruise, Loiter VP, and Return-to-Launch.",
        "waypoints": [
            {"id": 1, "lat": 19.876543, "lon": 75.343210, "alt_m": 15.0, "command": "TAKEOFF", "action": "TAKEOFF"},
            {"id": 2, "lat": 19.877800, "lon": 75.344500, "alt_m": 30.0, "command": "WAYPOINT", "action": "CRUISE"},
            {"id": 3, "lat": 19.879200, "lon": 75.343800, "alt_m": 35.0, "command": "WAYPOINT", "action": "VERIFY_POINT"},
            {"id": 4, "lat": 19.878100, "lon": 75.342100, "alt_m": 25.0, "command": "WAYPOINT", "action": "CRUISE"},
            {"id": 5, "lat": 19.876900, "lon": 75.342500, "alt_m": 20.0, "command": "WAYPOINT", "action": "DESCEND"},
            {"id": 6, "lat": 19.876543, "lon": 75.343210, "alt_m": 0.0, "command": "RTL", "action": "LAND"},
        ],
        "geofence": [
            {"lat": 19.875500, "lon": 75.341000},
            {"lat": 19.880500, "lon": 75.341000},
            {"lat": 19.880500, "lon": 75.346000},
            {"lat": 19.875500, "lon": 75.346000},
        ],
        "no_fly_zones": [
            [
                {"lat": 19.878000, "lon": 75.343000},
                {"lat": 19.878500, "lon": 75.343000},
                {"lat": 19.878500, "lon": 75.343500},
                {"lat": 19.878000, "lon": 75.343500},
            ]
        ],
    },
    {
        "id": "COURSE_BETA_SEARCH",
        "name": "Search & Rescue Lawnmower Grid",
        "description": "Parallel track sweep pattern for search operations with defined operational geofence.",
        "waypoints": [
            {"id": 1, "lat": 19.876000, "lon": 75.342000, "alt_m": 20.0, "command": "TAKEOFF", "action": "TAKEOFF"},
            {"id": 2, "lat": 19.879000, "lon": 75.342000, "alt_m": 30.0, "command": "WAYPOINT", "action": "CRUISE"},
            {"id": 3, "lat": 19.879000, "lon": 75.343000, "alt_m": 30.0, "command": "WAYPOINT", "action": "CRUISE"},
            {"id": 4, "lat": 19.876000, "lon": 75.343000, "alt_m": 30.0, "command": "WAYPOINT", "action": "CRUISE"},
            {"id": 5, "lat": 19.876000, "lon": 75.344000, "alt_m": 30.0, "command": "WAYPOINT", "action": "CRUISE"},
            {"id": 6, "lat": 19.879000, "lon": 75.344000, "alt_m": 30.0, "command": "WAYPOINT", "action": "CRUISE"},
            {"id": 7, "lat": 19.876000, "lon": 75.342000, "alt_m": 0.0, "command": "RTL", "action": "LAND"},
        ],
        "geofence": [
            {"lat": 19.875000, "lon": 75.341000},
            {"lat": 19.880000, "lon": 75.341000},
            {"lat": 19.880000, "lon": 75.345000},
            {"lat": 19.875000, "lon": 75.345000},
        ],
        "no_fly_zones": [],
    },
]


def parse_mission_file_content(filename: str, content: str) -> Dict[str, Any]:
    """Parses standard mission formats (.waypoints, QGC .plan, GeoJSON, CSV)."""
    filename_lower = filename.lower()
    waypoints: List[Dict[str, Any]] = []
    geofence: List[Any] = []
    no_fly_zones: List[Any] = []

    # 1. QGC .plan (JSON)
    if filename_lower.endswith(".plan") or (content.strip().startswith("{") and "mission" in content):
        try:
            data = json.loads(content)
            mission_data = data.get("mission", {})
            items = mission_data.get("items", [])
            for idx, item in enumerate(items):
                params = item.get("params", [0, 0, 0, 0, 0, 0, 0])
                lat = params[4] if len(params) > 4 else 0.0
                lon = params[5] if len(params) > 5 else 0.0
                alt = params[6] if len(params) > 6 else 0.0
                if (lat == 0 or lon == 0) and "Coordinate" in item:
                    coords = item["Coordinate"]
                    lat, lon = coords[0], coords[1]
                    alt = coords[2] if len(coords) > 2 else 25.0

                cmd_code = item.get("command", 16)
                action_map = {16: "WAYPOINT", 22: "TAKEOFF", 20: "RTL", 21: "LAND", 17: "LOITER", 19: "LOITER"}
                action = action_map.get(cmd_code, "WAYPOINT")
                if lat != 0 and lon != 0:
                    waypoints.append({
                        "id": idx + 1,
                        "lat": float(lat),
                        "lon": float(lon),
                        "alt_m": float(alt) if alt else 25.0,
                        "command": "WAYPOINT" if cmd_code == 16 else action,
                        "action": action,
                    })

            gf = data.get("geoFence", {})
            for polygon in gf.get("polygons", []):
                poly_pts = polygon.get("polygon", [])
                geofence.append([{"lat": p[0], "lon": p[1]} for p in poly_pts if len(p) >= 2])
        except Exception:
            pass

    # 2. QGC WPL .waypoints
    elif filename_lower.endswith(".waypoints") or "QGC WPL" in content:
        lines = [line.strip() for line in content.splitlines() if line.strip()]
        wp_idx = 1
        for line in lines:
            if line.startswith("QGC WPL") or line.startswith("#"):
                continue
            parts = line.split()
            if len(parts) >= 11:
                try:
                    cmd = int(parts[3])
                    lat = float(parts[8])
                    lon = float(parts[9])
                    alt = float(parts[10])
                    action = "TAKEOFF" if cmd == 22 else "LAND" if cmd == 21 else "RTL" if cmd == 20 else "LOITER" if cmd in (17, 19) else "WAYPOINT"
                    if lat != 0 and lon != 0:
                        waypoints.append({
                            "id": wp_idx,
                            "lat": lat,
                            "lon": lon,
                            "alt_m": alt,
                            "command": "WAYPOINT" if cmd == 16 else action,
                            "action": action,
                        })
                        wp_idx += 1
                except Exception:
                    continue

    # 3. GeoJSON
    elif filename_lower.endswith(".geojson") or (content.strip().startswith("{") and "FeatureCollection" in content):
        try:
            data = json.loads(content)
            features = data.get("features", [])
            wp_idx = 1
            for f in features:
                geom = f.get("geometry", {})
                gtype = geom.get("type", "")
                coords = geom.get("coordinates", [])
                props = f.get("properties", {})

                if gtype == "Point" and len(coords) >= 2:
                    lon, lat = coords[0], coords[1]
                    alt = coords[2] if len(coords) > 2 else props.get("alt", 25.0)
                    waypoints.append({
                        "id": wp_idx,
                        "lat": float(lat),
                        "lon": float(lon),
                        "alt_m": float(alt),
                        "command": props.get("command", "WAYPOINT"),
                        "action": props.get("action", "CRUISE"),
                    })
                    wp_idx += 1
                elif gtype == "LineString":
                    for pt in coords:
                        if len(pt) >= 2:
                            waypoints.append({
                                "id": wp_idx,
                                "lat": float(pt[1]),
                                "lon": float(pt[0]),
                                "alt_m": float(pt[2]) if len(pt) > 2 else 25.0,
                                "command": "WAYPOINT",
                                "action": "CRUISE",
                            })
                            wp_idx += 1
                elif gtype == "Polygon":
                    poly_pts = [{"lat": pt[1], "lon": pt[0]} for ring in coords for pt in ring if len(pt) >= 2]
                    if props.get("no_fly_zone") or props.get("type") == "no_fly":
                        no_fly_zones.append(poly_pts)
                    else:
                        geofence.append(poly_pts)
        except Exception:
            pass

    # 4. CSV
    else:
        try:
            reader = csv.reader(io.StringIO(content))
            header = None
            wp_idx = 1
            for row in reader:
                if not row or not any(row):
                    continue
                if header is None and any(col.isalpha() for col in row):
                    header = [c.strip().lower() for c in row]
                    continue
                if header:
                    lat_i = next((i for i, c in enumerate(header) if "lat" in c), -1)
                    lon_i = next((i for i, c in enumerate(header) if "lon" in c), -1)
                    alt_i = next((i for i, c in enumerate(header) if "alt" in c), -1)
                    act_i = next((i for i, c in enumerate(header) if "action" in c or "cmd" in c), -1)
                    if lat_i != -1 and lon_i != -1:
                        lat = float(row[lat_i])
                        lon = float(row[lon_i])
                        alt = float(row[alt_i]) if alt_i != -1 and len(row) > alt_i else 25.0
                        action = row[act_i] if act_i != -1 and len(row) > act_i else "CRUISE"
                        waypoints.append({
                            "id": wp_idx,
                            "lat": lat,
                            "lon": lon,
                            "alt_m": alt,
                            "command": "WAYPOINT",
                            "action": action,
                        })
                        wp_idx += 1
                elif len(row) >= 2:
                    try:
                        lat = float(row[0])
                        lon = float(row[1])
                        alt = float(row[2]) if len(row) > 2 else 25.0
                        waypoints.append({
                            "id": wp_idx,
                            "lat": lat,
                            "lon": lon,
                            "alt_m": alt,
                            "command": "WAYPOINT",
                            "action": "CRUISE",
                        })
                        wp_idx += 1
                    except ValueError:
                        continue
        except Exception:
            pass

    return {
        "waypoints": waypoints,
        "geofence": geofence,
        "no_fly_zones": no_fly_zones,
    }


class UploadMissionRequest(BaseModel):
    filename: str
    content: str
    mission_id: Optional[str] = None


class LoadTemplateRequest(BaseModel):
    template_id: str
    mission_id: Optional[str] = None


@router.post("")
async def create_mission(req: CreateMissionRequest) -> Dict[str, Any]:
    """Creates a new mission, archives previous active missions, and activates in pipeline."""
    now_ms = current_time_ms()
    mission_id = f"MIS-{now_ms}"

    async with AsyncSessionLocal() as session:
        # Mark all previous ACTIVE missions as ARCHIVED/COMPLETED
        await session.execute(
            update(Mission)
            .where(Mission.status == "ACTIVE")
            .values(status="ARCHIVED", ended_at=now_ms)
        )
        mission = Mission(
            mission_id=mission_id,
            drone_id=req.drone_id or "VEGAPilot-01",
            name=req.name,
            started_at=now_ms,
            status="ACTIVE",
            waypoints_json="[]",
            geofence_json="[]",
        )
        session.add(mission)
        await session.commit()

    pipeline = get_pipeline()
    if pipeline and getattr(pipeline, "_is_active", False):
        await pipeline.set_active_mission(mission_id)

    return {
        "mission_id": mission_id,
        "name": req.name,
        "drone_id": req.drone_id,
        "status": "ACTIVE",
        "started_at": now_ms,
    }


@router.post("/upload")
async def upload_mission(req: UploadMissionRequest) -> Dict[str, Any]:
    """Uploads and parses a mission file (.waypoints, QGC .plan, GeoJSON, CSV)."""
    parsed = parse_mission_file_content(req.filename, req.content)
    pipeline = get_pipeline()
    target_mission_id = req.mission_id or (pipeline.mission_id if pipeline else "DEFAULT-MISSION")

    wps_json = json.dumps(parsed["waypoints"])
    gf_json = json.dumps({"geofence": parsed["geofence"], "no_fly_zones": parsed["no_fly_zones"]})

    async with AsyncSessionLocal() as session:
        res = await session.execute(select(Mission).where(Mission.mission_id == target_mission_id))
        m = res.scalar_one_or_none()
        if m:
            m.waypoints_json = wps_json
            m.geofence_json = gf_json
        else:
            m = Mission(
                mission_id=target_mission_id,
                drone_id="VEGAPilot-01",
                name=f"Mission {target_mission_id}",
                status="ACTIVE",
                waypoints_json=wps_json,
                geofence_json=gf_json,
            )
            session.add(m)
        await session.commit()

    if pipeline:
        await pipeline.ws_manager.broadcast({
            "type": "WAYPOINTS_UPDATED",
            "mission_id": target_mission_id,
            "waypoints": parsed["waypoints"],
            "geofence": parsed["geofence"],
            "no_fly_zones": parsed["no_fly_zones"],
        })
        await pipeline.record_event(
            event_type="MISSION_UPLOADED",
            payload={
                "filename": req.filename,
                "waypoint_count": len(parsed["waypoints"]),
                "has_geofence": len(parsed["geofence"]) > 0,
            },
        )

    return {
        "mission_id": target_mission_id,
        "filename": req.filename,
        "waypoints": parsed["waypoints"],
        "geofence": parsed["geofence"],
        "no_fly_zones": parsed["no_fly_zones"],
        "waypoint_count": len(parsed["waypoints"]),
        "status": "SUCCESS",
    }


@router.get("/templates")
async def get_competition_templates() -> List[Dict[str, Any]]:
    """Returns pre-saved competition boundaries and waypoint templates."""
    return COMPETITION_TEMPLATES


@router.post("/templates/load")
async def load_competition_template(req: LoadTemplateRequest) -> Dict[str, Any]:
    """Loads a pre-saved competition template into the active mission."""
    template = next((t for t in COMPETITION_TEMPLATES if t["id"] == req.template_id), None)
    if not template:
        raise HTTPException(status_code=404, detail=f"Template {req.template_id} not found")

    pipeline = get_pipeline()
    target_mission_id = req.mission_id or (pipeline.mission_id if pipeline else "DEFAULT-MISSION")

    wps_json = json.dumps(template["waypoints"])
    gf_json = json.dumps({"geofence": template["geofence"], "no_fly_zones": template["no_fly_zones"]})

    async with AsyncSessionLocal() as session:
        res = await session.execute(select(Mission).where(Mission.mission_id == target_mission_id))
        m = res.scalar_one_or_none()
        if m:
            m.waypoints_json = wps_json
            m.geofence_json = gf_json
        else:
            m = Mission(
                mission_id=target_mission_id,
                drone_id="VEGAPilot-01",
                name=template["name"],
                status="ACTIVE",
                waypoints_json=wps_json,
                geofence_json=gf_json,
            )
            session.add(m)
        await session.commit()

    if pipeline:
        await pipeline.ws_manager.broadcast({
            "type": "WAYPOINTS_UPDATED",
            "mission_id": target_mission_id,
            "waypoints": template["waypoints"],
            "geofence": template["geofence"],
            "no_fly_zones": template["no_fly_zones"],
        })
        await pipeline.record_event(
            event_type="COMPETITION_TEMPLATE_LOADED",
            payload={"template_id": template["id"], "template_name": template["name"]},
        )

    return {
        "mission_id": target_mission_id,
        "template_id": template["id"],
        "template_name": template["name"],
        "waypoints": template["waypoints"],
        "geofence": template["geofence"],
        "no_fly_zones": template["no_fly_zones"],
        "status": "LOADED",
    }


@router.post("/{mission_id}/stop")
async def stop_mission(mission_id: str) -> Dict[str, Any]:
    """Marks a mission as COMPLETED."""
    now_ms = current_time_ms()
    async with AsyncSessionLocal() as session:
        res = await session.execute(select(Mission).where(Mission.mission_id == mission_id))
        mission = res.scalar_one_or_none()
        if not mission:
            raise HTTPException(status_code=404, detail="Mission not found")
        mission.status = "COMPLETED"
        mission.ended_at = now_ms
        await session.commit()
    return {"mission_id": mission_id, "status": "COMPLETED", "ended_at": now_ms}


class UpdateMissionRequest(BaseModel):
    name: Optional[str] = None
    waypoints: Optional[List[Dict[str, Any]]] = None
    geofence: Optional[List[Dict[str, Any]]] = None
    no_fly_zones: Optional[List[List[Dict[str, Any]]]] = None
    home: Optional[Dict[str, Any]] = None
    status: Optional[str] = None


class ValidateMissionRequest(BaseModel):
    waypoints: Optional[List[Dict[str, Any]]] = None


@router.get("/{mission_id}")
async def get_mission(mission_id: str) -> Dict[str, Any]:
    async with AsyncSessionLocal() as session:
        res = await session.execute(select(Mission).where(Mission.mission_id == mission_id))
        mission = res.scalar_one_or_none()
        if not mission:
            raise HTTPException(status_code=404, detail="Mission not found")

        count_res = await session.execute(
            select(func.count(TelemetryPacket.id)).where(TelemetryPacket.mission_id == mission_id)
        )
        pkt_count = count_res.scalar() or 0

        wps = []
        gf = []
        nfz = []
        if mission.waypoints_json:
            try:
                wps = json.loads(mission.waypoints_json)
            except Exception:
                pass
        if mission.geofence_json:
            try:
                gf_data = json.loads(mission.geofence_json)
                if isinstance(gf_data, dict):
                    gf = gf_data.get("geofence", [])
                    nfz = gf_data.get("no_fly_zones", [])
                elif isinstance(gf_data, list):
                    gf = gf_data
            except Exception:
                pass

        return {
            "id": mission.id,
            "mission_id": mission.mission_id,
            "drone_id": mission.drone_id,
            "name": mission.name,
            "started_at": mission.started_at,
            "ended_at": mission.ended_at,
            "status": mission.status,
            "packet_count": pkt_count,
            "waypoints": wps,
            "geofence": gf,
            "no_fly_zones": nfz,
            "home": {
                "latitude": mission.home_lat,
                "longitude": mission.home_lon,
                "altitude": mission.home_alt,
            } if mission.home_lat is not None else None,
            "upload_status": mission.upload_status,
            "upload_acknowledged_at": mission.upload_acknowledged_at,
            "execution_status": mission.execution_status,
            "updated_at": mission.updated_at,
        }


@router.put("/{mission_id}")
async def update_mission(mission_id: str, req: UpdateMissionRequest) -> Dict[str, Any]:
    """Saves updated mission name, waypoints, geofence, and home position to SQLite."""
    now_ms = current_time_ms()
    async with AsyncSessionLocal() as session:
        res = await session.execute(select(Mission).where(Mission.mission_id == mission_id))
        m = res.scalar_one_or_none()
        if not m:
            raise HTTPException(status_code=404, detail="Mission not found")

        if req.name:
            m.name = req.name
        if req.waypoints is not None:
            m.waypoints_json = json.dumps(req.waypoints)
        if req.geofence is not None:
            gf_dict = {"geofence": req.geofence, "no_fly_zones": req.no_fly_zones or []}
            m.geofence_json = json.dumps(gf_dict)
        if req.home:
            m.home_lat = req.home.get("lat", req.home.get("latitude"))
            m.home_lon = req.home.get("lon", req.home.get("longitude"))
            m.home_alt = req.home.get("alt_m", req.home.get("altitude"))
        if req.status:
            m.status = req.status
        m.updated_at = now_ms
        await session.commit()

    pipeline = get_pipeline()
    if pipeline and req.waypoints is not None:
        await pipeline.ws_manager.broadcast({
            "type": "WAYPOINTS_UPDATED",
            "mission_id": mission_id,
            "waypoints": req.waypoints,
            "geofence": req.geofence or [],
            "no_fly_zones": req.no_fly_zones or [],
        })

    return {"mission_id": mission_id, "status": "SAVED", "updated_at": now_ms}


@router.post("/{mission_id}/validate")
async def validate_mission_plan(
    mission_id: str, req: Optional[ValidateMissionRequest] = None
) -> Dict[str, Any]:
    """Validates mission waypoints against safety, range, sequence, and vehicle connectivity criteria."""
    wps = []
    if req and req.waypoints is not None:
        wps = req.waypoints
    else:
        async with AsyncSessionLocal() as session:
            res = await session.execute(select(Mission).where(Mission.mission_id == mission_id))
            m = res.scalar_one_or_none()
            if m and m.waypoints_json:
                try:
                    wps = json.loads(m.waypoints_json)
                except Exception:
                    wps = []

    checks = []
    errors = []

    # 1. Waypoints Count Check
    if len(wps) == 0:
        checks.append({"name": "Waypoints Count", "passed": False, "message": "No waypoints configured in mission plan."})
        errors.append("Mission cannot be empty. Add at least one waypoint.")
    else:
        checks.append({"name": "Waypoints Count", "passed": True, "message": f"{len(wps)} waypoints defined in plan."})

    # 2. Coordinate Boundaries
    coords_valid = True
    bad_coords = []
    for idx, wp in enumerate(wps):
        lat = wp.get("lat", wp.get("latitude"))
        lon = wp.get("lon", wp.get("longitude"))
        if lat is None or lon is None:
            coords_valid = False
            bad_coords.append(f"WP#{idx+1} missing coordinates")
        elif not (-90.0 <= float(lat) <= 90.0 and -180.0 <= float(lon) <= 180.0):
            coords_valid = False
            bad_coords.append(f"WP#{idx+1} coordinate out of range ({lat}, {lon})")

    if coords_valid and len(wps) > 0:
        checks.append({"name": "Coordinate Boundaries", "passed": True, "message": "All GPS coordinates within valid WGS-84 ranges."})
    else:
        checks.append({"name": "Coordinate Boundaries", "passed": False, "message": "; ".join(bad_coords) or "Invalid coordinates"})
        errors.extend(bad_coords)

    # 3. Altitude Checks
    alt_valid = True
    bad_alts = []
    for idx, wp in enumerate(wps):
        alt = wp.get("alt_m", wp.get("altitude"))
        if alt is None:
            alt_valid = False
            bad_alts.append(f"WP#{idx+1} missing altitude")
        elif float(alt) < 0.0 or float(alt) > 500.0:
            alt_valid = False
            bad_alts.append(f"WP#{idx+1} altitude {alt}m exceeds safety envelope (0-500m)")

    if alt_valid and len(wps) > 0:
        checks.append({"name": "Altitude Profiles", "passed": True, "message": "Altitudes conform to standard AGL operating corridor."})
    else:
        checks.append({"name": "Altitude Profiles", "passed": False, "message": "; ".join(bad_alts) or "Invalid altitudes"})
        errors.extend(bad_alts)

    # 4. Vehicle Connectivity Check
    pipeline = get_pipeline()
    is_connected = False
    if pipeline:
        conn_state = pipeline.latest_state.data_health.status
        is_connected = conn_state not in ("DISCONNECTED", "CONNECTING", "UNKNOWN")

    if is_connected:
        checks.append({"name": "Vehicle Telemetry", "passed": True, "message": "Telemetry link operational and responsive."})
    else:
        checks.append({"name": "Vehicle Telemetry", "passed": False, "message": "Vehicle link is currently disconnected."})
        errors.append("Vehicle must be connected to dispatch mission upload.")

    is_ready = (len(errors) == 0)
    return {
        "mission_id": mission_id,
        "valid": is_ready,
        "status": "MISSION READY" if is_ready else "MISSION NOT READY",
        "checks": checks,
        "errors": errors,
        "waypoint_count": len(wps),
    }


@router.post("/{mission_id}/upload-mavlink")
async def upload_mission_to_autopilot(
    mission_id: str, req: Optional[ValidateMissionRequest] = None
) -> Dict[str, Any]:
    """Encodes mission into MAVLink frames and executes mission upload protocol with vehicle."""
    pipeline = get_pipeline()
    if not pipeline:
        raise HTTPException(status_code=503, detail="Telemetry pipeline is not running")

    wps = []
    if req and req.waypoints:
        wps = req.waypoints
    else:
        async with AsyncSessionLocal() as session:
            res = await session.execute(select(Mission).where(Mission.mission_id == mission_id))
            m = res.scalar_one_or_none()
            if not m or not m.waypoints_json:
                raise HTTPException(status_code=400, detail="No waypoints stored in mission to upload")
            wps = json.loads(m.waypoints_json)

    if not wps:
        raise HTTPException(status_code=400, detail="Cannot upload empty mission")

    for idx, wp in enumerate(wps):
        lat = wp.get("lat", wp.get("latitude"))
        lon = wp.get("lon", wp.get("longitude"))
        if lat is None or lon is None or not (-90.0 <= float(lat) <= 90.0 and -180.0 <= float(lon) <= 180.0):
            raise HTTPException(status_code=400, detail=f"Waypoint #{idx+1} has invalid coordinates")

    try:
        result = await pipeline.upload_mission_mavlink(wps)
        return result
    except Exception as e:
        logger.error(f"Error during MAVLink mission upload: {e}")
        raise HTTPException(status_code=500, detail=str(e))


@router.post("/{mission_id}/download-mavlink")
async def download_mission_from_autopilot(mission_id: str) -> Dict[str, Any]:
    """Retrieves current mission from vehicle onboard memory using MAVLink mission protocol."""
    pipeline = get_pipeline()
    if not pipeline:
        raise HTTPException(status_code=503, detail="Telemetry pipeline is not running")

    wps = await pipeline.download_mission_mavlink()
    if wps:
        wps_json = json.dumps(wps)
        async with AsyncSessionLocal() as session:
            res = await session.execute(select(Mission).where(Mission.mission_id == mission_id))
            m = res.scalar_one_or_none()
            if m:
                m.waypoints_json = wps_json
                m.updated_at = current_time_ms()
                await session.commit()
    return {"mission_id": mission_id, "waypoint_count": len(wps), "waypoints": wps}


@router.get("/{mission_id}/telemetry")
async def get_mission_telemetry(
    mission_id: str,
    page: int = Query(1, ge=1),
    page_size: int = Query(50, ge=1, le=500),
    message_type: Optional[str] = None,
    is_valid: Optional[bool] = None,
    is_recovered: Optional[bool] = None,
) -> Dict[str, Any]:
    """Paginated mission telemetry inspection with filters."""
    offset = (page - 1) * page_size

    async with AsyncSessionLocal() as session:
        query = select(TelemetryPacket).where(TelemetryPacket.mission_id == mission_id)

        if message_type:
            query = query.where(TelemetryPacket.message_type == message_type)
        if is_valid is not None:
            query = query.where(TelemetryPacket.is_valid == is_valid)
        if is_recovered is not None:
            query = query.where(TelemetryPacket.is_recovered == is_recovered)

        # Count total matching
        count_q = select(func.count()).select_from(query.subquery())
        total = (await session.execute(count_q)).scalar() or 0

        # Query page
        paged_q = query.order_by(desc(TelemetryPacket.received_at)).offset(offset).limit(page_size)
        rows = (await session.execute(paged_q)).scalars().all()

        items = []
        for r in rows:
            items.append({
                "id": r.id,
                "source_sequence": r.source_sequence,
                "receive_sequence": r.receive_sequence,
                "message_type": r.message_type,
                "source_timestamp": r.source_timestamp,
                "received_at": r.received_at,
                "processed_at": r.processed_at,
                "is_duplicate": r.is_duplicate,
                "is_out_of_order": r.is_out_of_order,
                "is_recovered": r.is_recovered,
                "is_valid": r.is_valid,
                "payload": json.loads(r.payload_json) if r.payload_json else {},
            })

        return {
            "mission_id": mission_id,
            "page": page,
            "page_size": page_size,
            "total_items": total,
            "total_pages": (total + page_size - 1) // page_size if total > 0 else 1,
            "items": items,
        }


@router.get("/{mission_id}/events")
async def get_mission_events(mission_id: str) -> Dict[str, Any]:
    """Retrieve connection and packet gap events for audit trail."""
    async with AsyncSessionLocal() as session:
        gaps_res = await session.execute(
            select(TelemetryGap).where(TelemetryGap.mission_id == mission_id).order_by(desc(TelemetryGap.detected_at))
        )
        gaps = gaps_res.scalars().all()

        conns_res = await session.execute(
            select(ConnectionEvent).where(ConnectionEvent.mission_id == mission_id).order_by(desc(ConnectionEvent.timestamp))
        )
        conns = conns_res.scalars().all()

        return {
            "mission_id": mission_id,
            "gaps": [
                {
                    "id": g.id,
                    "expected_sequence": g.expected_sequence,
                    "detected_at": g.detected_at,
                    "recovered_at": g.recovered_at,
                    "status": g.status,
                }
                for g in gaps
            ],
            "connection_events": [
                {
                    "id": c.id,
                    "event_type": c.event_type,
                    "timestamp": c.timestamp,
                    "details": c.details,
                }
                for c in conns
            ],
        }


@router.get("/{mission_id}/health")
async def get_mission_health(mission_id: str) -> Dict[str, Any]:
    """Returns reliability health summary computed from the database for the mission."""
    async with AsyncSessionLocal() as session:
        total_packets = (
            await session.execute(
                select(func.count(TelemetryPacket.id)).where(TelemetryPacket.mission_id == mission_id)
            )
        ).scalar() or 0

        duplicates = (
            await session.execute(
                select(func.count(TelemetryPacket.id)).where(
                    TelemetryPacket.mission_id == mission_id,
                    TelemetryPacket.is_duplicate == True,
                )
            )
        ).scalar() or 0

        out_of_order = (
            await session.execute(
                select(func.count(TelemetryPacket.id)).where(
                    TelemetryPacket.mission_id == mission_id,
                    TelemetryPacket.is_out_of_order == True,
                )
            )
        ).scalar() or 0

        invalid = (
            await session.execute(
                select(func.count(TelemetryPacket.id)).where(
                    TelemetryPacket.mission_id == mission_id,
                    TelemetryPacket.is_valid == False,
                )
            )
        ).scalar() or 0

        recovered = (
            await session.execute(
                select(func.count(TelemetryPacket.id)).where(
                    TelemetryPacket.mission_id == mission_id,
                    TelemetryPacket.is_recovered == True,
                )
            )
        ).scalar() or 0

        total_gaps = (
            await session.execute(
                select(func.count(TelemetryGap.id)).where(TelemetryGap.mission_id == mission_id)
            )
        ).scalar() or 0

        return {
            "mission_id": mission_id,
            "total_packets": total_packets,
            "duplicates": duplicates,
            "out_of_order": out_of_order,
            "invalid": invalid,
            "gaps_detected": total_gaps,
            "recovered_packets": recovered,
            "unrecovered_packets": max(0, total_gaps - recovered),
        }


@router.get("/{mission_id}/export/csv")
async def export_mission_csv(mission_id: str) -> Response:
    """Exports all mission telemetry packets into CSV format directly from SQLite."""
    async with AsyncSessionLocal() as session:
        res = await session.execute(
            select(TelemetryPacket)
            .where(TelemetryPacket.mission_id == mission_id)
            .order_by(TelemetryPacket.received_at)
        )
        packets = res.scalars().all()

    output = io.StringIO()
    writer = csv.writer(output)
    writer.writerow([
        "id", "source_sequence", "receive_sequence", "message_type",
        "source_timestamp", "received_at", "processed_at",
        "is_duplicate", "is_out_of_order", "is_recovered", "is_valid", "payload_json"
    ])

    for p in packets:
        writer.writerow([
            p.id, p.source_sequence, p.receive_sequence, p.message_type,
            p.source_timestamp, p.received_at, p.processed_at,
            p.is_duplicate, p.is_out_of_order, p.is_recovered, p.is_valid, p.payload_json
        ])

    csv_data = output.getvalue()
    return Response(
        content=csv_data,
        media_type="text/csv",
        headers={"Content-Disposition": f'attachment; filename="mission_{mission_id}.csv"'},
    )


@router.get("/{mission_id}/export/json")
async def export_mission_json(mission_id: str) -> Response:
    """Exports full mission telemetry records into JSON."""
    async with AsyncSessionLocal() as session:
        res = await session.execute(
            select(TelemetryPacket)
            .where(TelemetryPacket.mission_id == mission_id)
            .order_by(TelemetryPacket.received_at)
        )
        packets = res.scalars().all()

    records = [
        {
            "id": p.id,
            "source_sequence": p.source_sequence,
            "receive_sequence": p.receive_sequence,
            "message_type": p.message_type,
            "source_timestamp": p.source_timestamp,
            "received_at": p.received_at,
            "processed_at": p.processed_at,
            "is_duplicate": p.is_duplicate,
            "is_out_of_order": p.is_out_of_order,
            "is_recovered": p.is_recovered,
            "is_valid": p.is_valid,
            "payload": json.loads(p.payload_json) if p.payload_json else {},
        }
        for p in packets
    ]

    return Response(
        content=json.dumps({"mission_id": mission_id, "packets": records}, indent=2),
        media_type="application/json",
        headers={"Content-Disposition": f'attachment; filename="mission_{mission_id}.json"'},
    )
