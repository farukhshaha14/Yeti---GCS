"""Network and GCS configuration API routes."""
from typing import Dict, Any, Optional
from fastapi import APIRouter, HTTPException
from pydantic import BaseModel, Field
from app.config import get_settings, update_settings

router = APIRouter(prefix="/api/config", tags=["config"])


class NetworkConfigUpdate(BaseModel):
    gcs_ip: Optional[str] = None
    drone_ip: Optional[str] = None
    subnet_mask: Optional[str] = None
    telemetry_port: Optional[int] = Field(None, ge=1024, le=65535)
    telemetry_transport: Optional[str] = None
    operation_mode: Optional[str] = None
    stale_threshold_degraded_ms: Optional[int] = None
    stale_threshold_stale_ms: Optional[int] = None
    disconnected_timeout_ms: Optional[int] = None


@router.get("/network")
async def get_network_config() -> Dict[str, Any]:
    """Returns the current network and transport configuration."""
    s = get_settings()
    return {
        "gcs_ip": s.gcs_ip,
        "gcs_bind_host": s.gcs_bind_host,
        "drone_ip": s.drone_ip,
        "subnet_mask": s.subnet_mask,
        "telemetry_transport": s.telemetry_transport,
        "telemetry_port": s.telemetry_port,
        "websocket_host": s.websocket_host,
        "websocket_port": s.websocket_port,
        "operation_mode": s.operation_mode,
        "drone_id": s.drone_id,
        "stale_threshold_degraded_ms": s.stale_threshold_degraded_ms,
        "stale_threshold_stale_ms": s.stale_threshold_stale_ms,
        "disconnected_timeout_ms": s.disconnected_timeout_ms,
        "is_configured": True,
    }


@router.post("/network")
async def update_network_config(req: NetworkConfigUpdate) -> Dict[str, Any]:
    """Updates network and transport configuration with strict validation."""
    data = req.model_dump(exclude_unset=True)
    try:
        updated = update_settings(**data)
        return {
            "status": "updated",
            "config": {
                "gcs_ip": updated.gcs_ip,
                "drone_ip": updated.drone_ip,
                "subnet_mask": updated.subnet_mask,
                "telemetry_port": updated.telemetry_port,
                "telemetry_transport": updated.telemetry_transport,
                "operation_mode": updated.operation_mode,
            },
        }
    except Exception as e:
        raise HTTPException(status_code=400, detail=f"Configuration update failed: {str(e)}")
