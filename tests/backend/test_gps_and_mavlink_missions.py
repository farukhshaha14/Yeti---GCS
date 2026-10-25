import pytest
from httpx import AsyncClient, ASGITransport
from app.main import app
from app.database.session import init_db
from app.api.telemetry import get_pipeline, set_pipeline
from app.telemetry.pipeline import TelemetryPipeline
from tests.integration.test_pipeline_e2e import MockTransport
from pymavlink.dialects.v20 import common as mavlink2

@pytest.mark.asyncio
async def test_gps_normalization_and_validation():
    await init_db()
    transport = MockTransport()
    pipeline = TelemetryPipeline(transport=transport, mission_id="TEST-GPS-01")
    await pipeline.start()
    set_pipeline(pipeline)

    try:
        # Feed authentic MAVLink GLOBAL_POSITION_INT frame
        mav = mavlink2.MAVLink(None)
        # Lat: 19.876543, Lon: 75.343210, Alt: 42.5m, Hdg: 184.2 deg (18420 cdeg)
        msg_pos = mav.global_position_int_encode(
            time_boot_ms=1000,
            lat=int(19.876543 * 1e7),
            lon=int(75.343210 * 1e7),
            alt=int(42.5 * 1000),
            relative_alt=int(25.0 * 1000),
            vx=100,
            vy=200,
            vz=-50,
            hdg=18420,
        )
        msg_pos.source_sequence = 1
        raw_bytes = msg_pos.pack(mav)

        # Ingest into pipeline
        await pipeline._on_raw_packet_received(raw_bytes, ("127.0.0.1", 14555), 1700000000000)
        # Allow worker task to process
        import asyncio
        await asyncio.sleep(0.1)

        # Check latest normalized GPS state
        gps = pipeline.latest_state.gps
        assert gps.latitude == 19.876543
        assert gps.longitude == 75.343210
        assert gps.altitude_m == 42.5
        assert gps.heading_deg == 184.2
        assert gps.valid is True
        assert gps.is_stale is False
        assert gps.gps_fix is True
    finally:
        await pipeline.stop()
        set_pipeline(None)

@pytest.mark.asyncio
async def test_mission_validation_endpoint():
    await init_db()
    transport = ASGITransport(app=app)
    async with AsyncClient(transport=transport, base_url="http://test") as client:
        # Create a test mission
        res_m = await client.post("/api/missions", json={"name": "Validation Test"})
        assert res_m.status_code == 200
        mis_id = res_m.json()["mission_id"]

        # Validate with empty waypoints -> should be NOT READY
        res_val1 = await client.post(f"/api/missions/{mis_id}/validate", json={"waypoints": []})
        assert res_val1.status_code == 200
        data1 = res_val1.json()
        assert data1["valid"] is False
        assert data1["status"] == "MISSION NOT READY"
        assert len(data1["errors"]) > 0

        # Validate with valid waypoints
        valid_wps = [
            {"id": 1, "lat": 19.8765, "lon": 75.3432, "alt_m": 25.0, "action": "TAKEOFF"},
            {"id": 2, "lat": 19.8780, "lon": 75.3450, "alt_m": 30.0, "action": "WAYPOINT"},
        ]
        res_val2 = await client.post(f"/api/missions/{mis_id}/validate", json={"waypoints": valid_wps})
        assert res_val2.status_code == 200
        data2 = res_val2.json()
        assert data2["waypoint_count"] == 2
        assert any(c["name"] == "Coordinate Boundaries" and c["passed"] for c in data2["checks"])

@pytest.mark.asyncio
async def test_update_mission_and_retrieve_details():
    await init_db()
    transport = ASGITransport(app=app)
    async with AsyncClient(transport=transport, base_url="http://test") as client:
        # Create mission
        res_m = await client.post("/api/missions", json={"name": "Save Test"})
        mis_id = res_m.json()["mission_id"]

        # Update mission with waypoints and home position
        wps = [
            {"id": 1, "lat": 19.876543, "lon": 75.343210, "alt_m": 20.0, "action": "WAYPOINT"},
            {"id": 2, "lat": 19.877800, "lon": 75.344500, "alt_m": 35.0, "action": "WAYPOINT"},
        ]
        res_upd = await client.put(
            f"/api/missions/{mis_id}",
            json={
                "name": "Updated Flight Plan",
                "waypoints": wps,
                "home": {"lat": 19.876000, "lon": 75.343000, "alt_m": 0.0},
            }
        )
        assert res_upd.status_code == 200

        # Retrieve mission details
        res_get = await client.get(f"/api/missions/{mis_id}")
        assert res_get.status_code == 200
        details = res_get.json()
        assert details["name"] == "Updated Flight Plan"
        assert len(details["waypoints"]) == 2
        assert details["home"]["latitude"] == 19.876000
        assert details["upload_status"] == "NOT_UPLOADED"
