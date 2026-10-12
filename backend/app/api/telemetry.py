"""Telemetry and health API routes."""
import time
from typing import Dict, Any
from fastapi import APIRouter, Depends, WebSocket, WebSocketDisconnect
from sqlalchemy import text
from app.config import get_settings
from app.database.session import AsyncSessionLocal
from app.models.telemetry import NormalizedTelemetry
from app.websocket.manager import get_ws_manager

router = APIRouter(tags=["telemetry"])

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
