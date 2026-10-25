import json
import time
from typing import Dict, Any, Optional, List
from fastapi import APIRouter, Depends, WebSocket, WebSocketDisconnect, Query, HTTPException
from pydantic import BaseModel
from sqlalchemy import text, select, desc, func
from app.config import get_settings
from app.database.models import TelemetryPacket
from app.database.session import AsyncSessionLocal
from app.models.telemetry import NormalizedTelemetry
from app.websocket.manager import get_ws_manager

router = APIRouter(tags=["telemetry"])

class ReplayStartRequest(BaseModel):
    mission_id: str
    speed: Optional[float] = 1.0

# Reference to pipeline injected by main.py
_pipeline_instance = None


def set_pipeline(pipeline) -> None:
    global _pipeline_instance
    _pipeline_instance = pipeline


def get_pipeline():
    return _pipeline_instance


@router.get("/api/health")
async def get_system_health() -> Dict[str, Any]:
    """Comprehensive system health diagnostics reporting database, socket, and telemetry integrity."""
    settings = get_settings()
    pipeline = get_pipeline()
    ws_mgr = get_ws_manager()

    # Check SQLite status
    db_status = "UNKNOWN"
    try:
        async with AsyncSessionLocal() as session:
            await session.execute(text("SELECT 1;"))
            db_status = "HEALTHY"
    except Exception as e:
        db_status = f"ERROR: {str(e)}"

    transport_stats = pipeline.transport.get_stats() if pipeline else {}
    data_health = pipeline.reliability.get_data_health().model_dump() if pipeline else {}
    last_state = pipeline.latest_state if pipeline else None

    return {
        "status": "UP",
        "timestamp_ms": int(time.time() * 1000),
        "database_status": db_status,
        "operation_mode": settings.operation_mode,
        "active_mission_id": pipeline.mission_id if pipeline else None,
        "websocket_client_count": ws_mgr.client_count,
        "transport": transport_stats,
        "data_health": data_health,
        "last_source_sequence": last_state.source_sequence if last_state else None,
        "last_receive_sequence": last_state.received_sequence if last_state else None,
        "last_received_at": last_state.received_at if last_state else None,
    }


@router.get("/api/status")
async def get_system_status() -> Dict[str, Any]:
    pipeline = get_pipeline()
    health = pipeline.reliability.get_data_health() if pipeline else None
    return {
        "status": "OK",
        "drone_id": pipeline.settings.drone_id if pipeline else "VEGAPilot-01",
        "connection_state": health.status if health else "DISCONNECTED",
        "mission_id": pipeline.mission_id if pipeline else None,
    }


@router.get("/api/telemetry/latest", response_model=NormalizedTelemetry)
async def get_latest_telemetry() -> NormalizedTelemetry:
    """Returns the latest verified normalized telemetry state."""
    pipeline = get_pipeline()
    if pipeline:
        return pipeline.latest_state
    return NormalizedTelemetry(received_at=0, processed_at=0)


@router.get("/api/telemetry/logs")
async def get_telemetry_logs(
    mission_id: Optional[str] = None,
    page: int = Query(1, ge=1),
    page_size: int = Query(50, ge=1, le=500),
    message_type: Optional[str] = None,
    is_valid: Optional[bool] = None,
    is_recovered: Optional[bool] = None,
    start_time: Optional[int] = None,
    end_time: Optional[int] = None,
) -> Dict[str, Any]:
    """Paginated SQLite telemetry logs with flexible mission, time range, and status filters."""
    pipeline = get_pipeline()
    target_mission = mission_id or (pipeline.mission_id if pipeline else None)
    offset = (page - 1) * page_size

    async with AsyncSessionLocal() as session:
        query = select(TelemetryPacket)
        if target_mission:
            query = query.where(TelemetryPacket.mission_id == target_mission)
        if message_type:
            query = query.where(TelemetryPacket.message_type == message_type)
        if is_valid is not None:
            query = query.where(TelemetryPacket.is_valid == is_valid)
        if is_recovered is not None:
            query = query.where(TelemetryPacket.is_recovered == is_recovered)
        if start_time is not None:
            query = query.where(TelemetryPacket.received_at >= start_time)
        if end_time is not None:
            query = query.where(TelemetryPacket.received_at <= end_time)

        count_q = select(func.count()).select_from(query.subquery())
        total = (await session.execute(count_q)).scalar() or 0

        paged_q = query.order_by(desc(TelemetryPacket.received_at)).offset(offset).limit(page_size)
        rows = (await session.execute(paged_q)).scalars().all()

        items = []
        for r in rows:
            items.append({
                "id": r.id,
                "mission_id": r.mission_id,
                "drone_id": r.drone_id,
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
            "mission_id": target_mission,
            "page": page,
            "page_size": page_size,
            "total_items": total,
            "total_pages": (total + page_size - 1) // page_size if total > 0 else 1,
            "items": items,
        }


@router.post("/api/telemetry/replay/start")
async def start_telemetry_replay(req: ReplayStartRequest) -> Dict[str, Any]:
    """Replays historical telemetry from SQLite back into the live dashboard and PFD."""
    pipeline = get_pipeline()
    if not pipeline:
        raise HTTPException(status_code=503, detail="Pipeline not initialized")
    return await pipeline.start_replay(mission_id=req.mission_id, speed=req.speed or 1.0)


@router.post("/api/telemetry/replay/stop")
async def stop_telemetry_replay() -> Dict[str, Any]:
    """Stops an active telemetry replay session."""
    pipeline = get_pipeline()
    if not pipeline:
        raise HTTPException(status_code=503, detail="Pipeline not initialized")
    return await pipeline.stop_replay()


@router.get("/api/telemetry/replay/status")
async def get_telemetry_replay_status() -> Dict[str, Any]:
    """Returns current replay status."""
    pipeline = get_pipeline()
    if not pipeline:
        return {"is_replaying": False}
    return pipeline.get_replay_status()


@router.websocket("/ws/telemetry")
async def websocket_telemetry_endpoint(websocket: WebSocket) -> None:
    """WebSocket endpoint for real-time telemetry updates and alerts."""
    ws_mgr = get_ws_manager()
    pipeline = get_pipeline()
    await ws_mgr.connect(websocket)

    # Immediately push current initial state upon connection
    if pipeline:
        try:
            await websocket.send_json({
                "type": "INITIAL_STATE",
                "mission_id": pipeline.mission_id,
                "telemetry": pipeline.latest_state.model_dump(),
            })
        except Exception:
            pass

    try:
        while True:
            # Keep connection alive; clients can send optional ping / control messages
            data = await websocket.receive_text()
            # If client sends ping, respond with pong
            if data == "ping":
                await websocket.send_text("pong")
    except WebSocketDisconnect:
        await ws_mgr.disconnect(websocket)
    except Exception:
        await ws_mgr.disconnect(websocket)
