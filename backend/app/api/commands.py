"""Operator command dispatch, waypoint management, and event retrieval routes."""
import json
import logging
from typing import List, Dict, Any, Optional
from fastapi import APIRouter, HTTPException, Query
from pydantic import BaseModel, Field
from sqlalchemy import select, desc
from pymavlink.dialects.v20 import common as mavlink2
from app.api.telemetry import get_pipeline
from app.database.models import CommandLog, TelemetryEvent, Mission, current_time_ms
from app.database.session import AsyncSessionLocal

logger = logging.getLogger("vegapilot.commands")
router = APIRouter(prefix="/api/commands", tags=["commands"])


class SendCommandRequest(BaseModel):
    command: str  # "ARM", "DISARM", "RTH", "ABORT", "LAND", "MISSION_START"
    param1: Optional[float] = 0.0
    param2: Optional[float] = 0.0


class WaypointItem(BaseModel):
    id: int
    lat: float
    lon: float
    alt_m: float
    command: Optional[str] = "WAYPOINT"
    action: Optional[str] = "NAVIGATE"


class WaypointPlanRequest(BaseModel):
    waypoints: List[WaypointItem]


COMMAND_MAPPING = {
    "ARM": (mavlink2.MAV_CMD_COMPONENT_ARM_DISARM, 1.0),
    "DISARM": (mavlink2.MAV_CMD_COMPONENT_ARM_DISARM, 0.0),
    "RTH": (mavlink2.MAV_CMD_NAV_RETURN_TO_LAUNCH, 0.0),
    "RTL": (mavlink2.MAV_CMD_NAV_RETURN_TO_LAUNCH, 0.0),
    "LAND": (mavlink2.MAV_CMD_NAV_LAND, 0.0),
    "ABORT": (mavlink2.MAV_CMD_NAV_LAND, 0.0),
    "MISSION_START": (mavlink2.MAV_CMD_MISSION_START, 0.0),
}


@router.post("/send")
async def send_operator_command(req: SendCommandRequest) -> Dict[str, Any]:
    """Dispatches an authentic MAVLink command to the autopilot layer."""
    pipeline = get_pipeline()
    if not pipeline:
        raise HTTPException(status_code=503, detail="Telemetry pipeline is not running")

    cmd_upper = req.command.strip().upper()
    if cmd_upper not in COMMAND_MAPPING:
        raise HTTPException(
            status_code=400,
            detail=f"Unsupported command: {req.command}. Supported: {list(COMMAND_MAPPING.keys())}",
        )

    mav_cmd_id, default_p1 = COMMAND_MAPPING[cmd_upper]
    p1 = req.param1 if req.param1 not in (None, 0.0) else default_p1
    p2 = req.param2 or 0.0

    result = await pipeline.send_mavlink_command(
        command_name=cmd_upper,
        command_id=mav_cmd_id,
        param1=p1,
        param2=p2,
    )
    return result


@router.get("/history")
async def get_command_history(
    limit: int = Query(50, ge=1, le=200),
) -> List[Dict[str, Any]]:
    """Returns historical operator commands sent from GCS and their acknowledgment statuses."""
    pipeline = get_pipeline()
    mission_id = pipeline.mission_id if pipeline else None

    async with AsyncSessionLocal() as session:
        query = select(CommandLog).order_by(desc(CommandLog.timestamp)).limit(limit)
        if mission_id:
            query = query.where(CommandLog.mission_id == mission_id)

        rows = (await session.execute(query)).scalars().all()
        return [
            {
                "id": r.id,
                "mission_id": r.mission_id,
                "command_name": r.command_name,
                "command_id": r.command_id,
                "status": r.status,
                "timestamp": r.timestamp,
                "acknowledged_at": r.acknowledged_at,
                "details": r.details,
            }
            for r in rows
        ]


@router.get("/events")
async def get_system_events(
    limit: int = Query(50, ge=1, le=200),
) -> List[Dict[str, Any]]:
    """Returns actual recorded system, flight mode, failsafe, and connection events."""
    pipeline = get_pipeline()
    mission_id = pipeline.mission_id if pipeline else None

    async with AsyncSessionLocal() as session:
        query = select(TelemetryEvent).order_by(desc(TelemetryEvent.timestamp)).limit(limit)
        if mission_id:
            query = query.where(TelemetryEvent.mission_id == mission_id)

        rows = (await session.execute(query)).scalars().all()
        return [
            {
                "id": r.id,
                "mission_id": r.mission_id,
                "event_type": r.event_type,
                "timestamp": r.timestamp,
                "payload": json.loads(r.payload) if r.payload else {},
                "created_at": r.created_at,
            }
            for r in rows
        ]


@router.get("/waypoints")
async def get_mission_waypoints() -> Dict[str, Any]:
    """Retrieves current mission waypoints."""
    pipeline = get_pipeline()
    mission_id = pipeline.mission_id if pipeline else "DEFAULT-MISSION"

    async with AsyncSessionLocal() as session:
        res = await session.execute(select(Mission).where(Mission.mission_id == mission_id))
        m = res.scalar_one_or_none()
        if not m or not m.waypoints_json:
            return {"mission_id": mission_id, "waypoints": []}

        try:
            wps = json.loads(m.waypoints_json)
        except Exception:
            wps = []
        return {"mission_id": mission_id, "waypoints": wps}


@router.post("/waypoints")
async def update_mission_waypoints(req: WaypointPlanRequest) -> Dict[str, Any]:
    """Stores waypoints for the active mission and broadcasts to the cockpit."""
    pipeline = get_pipeline()
    mission_id = pipeline.mission_id if pipeline else "DEFAULT-MISSION"

    waypoints_dicts = [w.model_dump() for w in req.waypoints]
    waypoints_json = json.dumps(waypoints_dicts)

    async with AsyncSessionLocal() as session:
        res = await session.execute(select(Mission).where(Mission.mission_id == mission_id))
        m = res.scalar_one_or_none()
        if m:
            m.waypoints_json = waypoints_json
        else:
            m = Mission(
                mission_id=mission_id,
                drone_id="VEGAPilot-01",
                name=f"Mission {mission_id}",
                status="ACTIVE",
                waypoints_json=waypoints_json,
            )
            session.add(m)
        await session.commit()

    if pipeline:
        await pipeline.ws_manager.broadcast({
            "type": "WAYPOINTS_UPDATED",
            "mission_id": mission_id,
            "waypoints": waypoints_dicts,
        })
        await pipeline.record_event(
            event_type="MISSION_UPLOADED",
            payload={"waypoint_count": len(req.waypoints)},
        )

    return {"mission_id": mission_id, "waypoint_count": len(req.waypoints), "status": "SAVED"}
