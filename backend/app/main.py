"""Main entry point for VEGAPilot GCS FastAPI backend."""
import logging
import os
from contextlib import asynccontextmanager
from typing import AsyncGenerator
from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from fastapi.staticfiles import StaticFiles
from sqlalchemy import select
from app.api.config_routes import router as config_router
from app.api.missions import router as missions_router
from app.api.simulator_routes import router as simulator_router
from app.api.telemetry import router as telemetry_router, set_pipeline
from app.api.commands import router as commands_router
from app.api.map_tiles import router as map_tiles_router
from app.config import get_settings
from app.database.models import Mission, current_time_ms
from app.database.session import init_db, AsyncSessionLocal
from app.services.simulator_service import get_simulator_service
from app.telemetry.pipeline import TelemetryPipeline
from app.transport.udp import UdpTelemetryTransport

logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s [%(levelname)s] %(name)s: %(message)s",
)
logger = logging.getLogger("vegapilot.main")


@asynccontextmanager
async def lifespan(app: FastAPI) -> AsyncGenerator[None, None]:
    settings = get_settings()
    logger.info("Initializing VEGAPilot GCS Backend...")

    # 1. Initialize SQLite schema & WAL mode
    await init_db()

    # 2. Ensure initial active mission exists in DB
    default_mission_id = f"MIS-{current_time_ms()}"
    async with AsyncSessionLocal() as session:
        res = await session.execute(select(Mission).where(Mission.status == "ACTIVE").limit(1))
        existing_mission = res.scalar_one_or_none()
        if not existing_mission:
            new_mission = Mission(
                mission_id=default_mission_id,
                drone_id=settings.drone_id,
                name="Default Mission",
                status="ACTIVE",
            )
            session.add(new_mission)
            await session.commit()
            active_mission_id = default_mission_id
        else:
            active_mission_id = existing_mission.mission_id

    # 3. Instantiate transport abstraction & pipeline
    transport = UdpTelemetryTransport(
        bind_host=settings.gcs_bind_host,
        bind_port=settings.telemetry_port,
        default_target_host=settings.drone_ip,
        default_target_port=settings.telemetry_port,
    )
    pipeline = TelemetryPipeline(transport=transport, mission_id=active_mission_id)
    set_pipeline(pipeline)

    # 4. Start pipeline listener
    await pipeline.start()
    logger.info(f"VEGAPilot GCS Telemetry Pipeline operational on UDP port {settings.telemetry_port}.")

    yield

    # Teardown
    logger.info("Shutting down VEGAPilot GCS...")
    await pipeline.stop()
    await get_simulator_service().stop()


app = FastAPI(
    title="VEGAPilot Ground Control Station",
    description="Offline MAVLink Telemetry Receiver, Verification & Reliability Pipeline",
    version="1.0.0",
    lifespan=lifespan,
)

# Local offline CORS
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# Include API routes
app.include_router(telemetry_router)
app.include_router(missions_router)
app.include_router(config_router)
app.include_router(simulator_router)
app.include_router(commands_router)
app.include_router(map_tiles_router)

# Mount frontend production build if present for offline all-in-one execution
frontend_dist = os.path.abspath(os.path.join(os.path.dirname(__file__), "..", "..", "frontend", "dist"))
if os.path.exists(frontend_dist):
    app.mount("/", StaticFiles(directory=frontend_dist, html=True), name="static")


if __name__ == "__main__":
    import uvicorn
    settings = get_settings()
    uvicorn.run(
        "app.main:app",
        host=settings.websocket_host,
        port=settings.websocket_port,
        reload=False,
    )
