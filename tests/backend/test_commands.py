"""Tests for MAVLink command dispatch, acknowledgment, waypoints, and event tracking."""
import pytest
from httpx import AsyncClient, ASGITransport
from app.main import app
from app.api.telemetry import get_pipeline, set_pipeline
from app.telemetry.pipeline import TelemetryPipeline
from app.database.session import init_db
from tests.integration.test_pipeline_e2e import MockTransport
from pymavlink.dialects.v20 import common as mavlink2


@pytest.mark.asyncio
async def test_commands_and_events_api():
    await init_db()
    transport = MockTransport()
    pipeline = TelemetryPipeline(transport=transport, mission_id="TEST-CMD-01")
    await pipeline.start()
    set_pipeline(pipeline)

    try:
        async with AsyncClient(transport=ASGITransport(app=app), base_url="http://test") as ac:
            # 1. Send ARM command
            res = await ac.post("/api/commands/send", json={"command": "ARM"})
            assert res.status_code == 200
            cmd_data = res.json()
            assert cmd_data["command_name"] == "ARM"
            assert cmd_data["status"] == "SENT"

            # 2. Check command history
            res_hist = await ac.get("/api/commands/history")
            assert res_hist.status_code == 200
            hist = res_hist.json()
            assert len(hist) > 0
            assert any(c["command_name"] == "ARM" for c in hist)

            # 3. Simulate pipeline receiving COMMAND_ACK from drone/simulator
            await pipeline._handle_command_ack(
                command_id=mavlink2.MAV_CMD_COMPONENT_ARM_DISARM,
                result=mavlink2.MAV_RESULT_ACCEPTED,
                recv_ms=1700000000000,
            )

            # Verify command status updated to ACKNOWLEDGED
            res_hist_updated = await ac.get("/api/commands/history")
            updated_hist = res_hist_updated.json()
            arm_cmd = next(c for c in updated_hist if c["command_name"] == "ARM")
            assert arm_cmd["status"] == "ACKNOWLEDGED"

            # 4. Check events API
            res_events = await ac.get("/api/commands/events")
            assert res_events.status_code == 200
            events = res_events.json()
            assert len(events) > 0
            assert any(e["event_type"] in ("COMMAND_SENT", "COMMAND_ACKNOWLEDGED") for e in events)

            # 5. Waypoints management
            wps = [
                {"id": 1, "lat": 19.8765, "lon": 75.3432, "alt_m": 25.0, "command": "TAKEOFF", "action": "TAKEOFF"},
                {"id": 2, "lat": 19.8780, "lon": 75.3450, "alt_m": 35.0, "command": "WAYPOINT", "action": "NAVIGATE"},
                {"id": 3, "lat": 19.8765, "lon": 75.3432, "alt_m": 0.0, "command": "RTL", "action": "RTL"},
            ]
            res_wp_save = await ac.post("/api/commands/waypoints", json={"waypoints": wps})
            assert res_wp_save.status_code == 200
            assert res_wp_save.json()["waypoint_count"] == 3

            res_wp_get = await ac.get("/api/commands/waypoints")
            assert res_wp_get.status_code == 200
            saved_wps = res_wp_get.json()["waypoints"]
            assert len(saved_wps) == 3
            assert saved_wps[1]["lat"] == 19.8780
    finally:
        await pipeline.stop()
