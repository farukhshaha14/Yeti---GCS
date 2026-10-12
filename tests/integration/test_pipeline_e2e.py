"""End-to-end integration tests for VEGAPilot Telemetry Pipeline & REST API."""
import asyncio
import json
import time
import pytest
from httpx import AsyncClient, ASGITransport
from pymavlink.dialects.v20 import common as mavlink2
from app.config import get_settings
from app.database.session import init_db
from app.main import app
from app.models.telemetry import NormalizedTelemetry
from app.telemetry.pipeline import TelemetryPipeline
from app.transport.base import TelemetryTransport


class MockTransport(TelemetryTransport):
    """In-memory transport for predictable integration testing."""

    def __init__(self):
        super().__init__()
        self.sent_packets = []

    async def start(self) -> None:
        self._is_running = True

    async def stop(self) -> None:
        self._is_running = False

    async def send(self, data: bytes, target_addr=None) -> bool:
        self.sent_packets.append((data, target_addr))
        return True

    def get_stats(self):
        return {"transport_type": "MOCK", "is_running": self._is_running}

    async def inject_packet(self, data: bytes) -> None:
        if self._packet_callback:
            now_ms = int(time.time() * 1000)
            await self._packet_callback(data, ("127.0.0.1", 14550), now_ms)


@pytest.mark.asyncio
async def test_full_pipeline_and_api():
    await init_db()

    transport = MockTransport()
    pipeline = TelemetryPipeline(transport=transport, mission_id="TEST-E2E-01")
    await pipeline.start()

    from app.api.telemetry import set_pipeline
    set_pipeline(pipeline)

    mav = mavlink2.MAVLink(None)

    # Encode a test ATTITUDE packet
    now_ms = int(time.time() * 1000)
    msg_att = mav.attitude_encode(
        time_boot_ms=now_ms % 10000000,
        roll=0.1,  # ~5.73 deg
        pitch=-0.05,  # ~ -2.86 deg
        yaw=3.14,  # ~ 179.9 deg
        rollspeed=0.0,
        pitchspeed=0.0,
        yawspeed=0.0,
    )
    mav.seq = 101
    raw_bytes = msg_att.pack(mav)
    await transport.inject_packet(raw_bytes)

    # Allow async worker to process packet
    await asyncio.sleep(0.15)

    # Verify latest state
    state = pipeline.latest_state
    assert state.source_sequence == 101
    assert state.attitude.roll_deg is not None
    assert abs(state.attitude.roll_deg - 5.73) < 0.2

    # Test REST API endpoints with AsyncClient
    async_transport = ASGITransport(app=app)
    async with AsyncClient(transport=async_transport, base_url="http://test") as client:
        # 1. Health check
        resp = await client.get("/api/health")
        assert resp.status_code == 200
        health_data = resp.json()
        assert health_data["status"] == "UP"
        assert health_data["database_status"] == "HEALTHY"

        # 2. Latest Telemetry
        resp_telem = await client.get("/api/telemetry/latest")
        assert resp_telem.status_code == 200
        telem_data = resp_telem.json()
        assert telem_data["source_sequence"] == 101

        # 3. Network Config
        resp_conf = await client.get("/api/config/network")
        assert resp_conf.status_code == 200
        conf = resp_conf.json()
        assert conf["telemetry_port"] == 14550

        # 4. Missions list
        resp_missions = await client.get("/api/missions")
        assert resp_missions.status_code == 200

    await pipeline.stop()
