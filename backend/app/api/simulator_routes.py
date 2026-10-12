"""Simulator management and test scenario injection routes."""
from typing import Dict, Any, Optional
from fastapi import APIRouter
from pydantic import BaseModel
from app.config import get_settings
from app.services.simulator_service import get_simulator_service

router = APIRouter(prefix="/api/simulator", tags=["simulator"])


class StartSimulatorRequest(BaseModel):
    rate_hz: Optional[float] = 10.0


class InjectFaultRequest(BaseModel):
    mode: str  # gap | duplicate | corrupt | loss_rate | disconnect | reconnect
    param: Optional[Any] = None


@router.post("/start")
async def start_simulator(req: Optional[StartSimulatorRequest] = None) -> Dict[str, Any]:
    """Start local telemetry simulator streaming to GCS UDP listener."""
    settings = get_settings()
    svc = get_simulator_service()
    rate = req.rate_hz if req else 10.0
    await svc.start(
        target_host="127.0.0.1",
        target_port=settings.telemetry_port,
        rate_hz=rate,
    )
    return {"status": "started", "target": f"127.0.0.1:{settings.telemetry_port}", "rate_hz": rate}


@router.post("/stop")
async def stop_simulator() -> Dict[str, Any]:
    """Stop running simulator."""
    svc = get_simulator_service()
    await svc.stop()
    return {"status": "stopped"}


@router.get("/status")
async def simulator_status() -> Dict[str, Any]:
    """Inspect status of managed simulator."""
    svc = get_simulator_service()
    return svc.get_status()


@router.post("/inject")
async def inject_fault(req: InjectFaultRequest) -> Dict[str, Any]:
    """Inject a packet gap, duplicate, corruption, loss rate, or disconnect."""
    svc = get_simulator_service()
    res = svc.inject_fault(req.mode, req.param)
    return res
