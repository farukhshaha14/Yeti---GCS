import pytest
from httpx import AsyncClient, ASGITransport
from sqlalchemy import select
from app.main import app
from app.database.session import init_db, AsyncSessionLocal
from app.database.models import Mission

@pytest.mark.asyncio
async def test_create_mission_atomic_reset():
    await init_db()
    transport = ASGITransport(app=app)
    async with AsyncClient(transport=transport, base_url="http://test") as client:
        # Create first mission
        res1 = await client.post("/api/missions", json={"name": "First Mission"})
        assert res1.status_code == 200
        mis1_id = res1.json()["mission_id"]
        assert mis1_id.startswith("MIS-")
        assert res1.json()["status"] == "ACTIVE"

        # Create second mission
        res2 = await client.post("/api/missions", json={"name": "Second Mission"})
        assert res2.status_code == 200
        mis2_id = res2.json()["mission_id"]
        assert mis2_id.startswith("MIS-")
        assert mis2_id != mis1_id
        assert res2.json()["status"] == "ACTIVE"

        # Verify in DB that mis1 is now archived
        async with AsyncSessionLocal() as session:
            db_res = await session.execute(select(Mission).where(Mission.mission_id == mis1_id))
            m1 = db_res.scalar_one_or_none()
            assert m1 is not None
            assert m1.status == "ARCHIVED"

@pytest.mark.asyncio
async def test_competition_templates():
    await init_db()
    transport = ASGITransport(app=app)
    async with AsyncClient(transport=transport, base_url="http://test") as client:
        res = await client.get("/api/missions/templates")
        assert res.status_code == 200
        templates = res.json()
        assert len(templates) >= 2
        template_ids = [t["id"] for t in templates]
        assert "COURSE_ALPHA_SUAS" in template_ids
        assert "COURSE_BETA_SEARCH" in template_ids

        # Load Alpha course
        load_res = await client.post("/api/missions/templates/load", json={"template_id": "COURSE_ALPHA_SUAS"})
        assert load_res.status_code == 200
        loaded = load_res.json()
        assert loaded["template_name"] == "SUAS Standard Competition Course"
        assert len(loaded["waypoints"]) == 6
        assert len(loaded["geofence"]) >= 4

@pytest.mark.asyncio
async def test_mission_file_upload_csv():
    await init_db()
    transport = ASGITransport(app=app)
    async with AsyncClient(transport=transport, base_url="http://test") as client:
        csv_content = (
            "lat,lon,alt,hold_time,action\n"
            "19.8761,75.3421,30,0,WAYPOINT\n"
            "19.8772,75.3435,45,5,VERIFICATION_POINT\n"
            "19.8785,75.3450,40,0,WAYPOINT\n"
        )
        payload = {
            "filename": "test_mission.csv",
            "content": csv_content,
        }
        res = await client.post("/api/missions/upload", json=payload)
        assert res.status_code == 200
        data = res.json()
        assert data["waypoint_count"] == 3
        assert len(data["waypoints"]) == 3
        assert data["waypoints"][1]["action"] == "VERIFICATION_POINT"

@pytest.mark.asyncio
async def test_network_config_and_status():
    await init_db()
    transport = ASGITransport(app=app)
    async with AsyncClient(transport=transport, base_url="http://test") as client:
        status_res = await client.get("/api/network/status")
        assert status_res.status_code == 200
        status_data = status_res.json()
        assert "telemetry_port" in status_data
        assert "socket_status" in status_data

        config_res = await client.post(
            "/api/network/config",
            json={"gcs_bind_host": "0.0.0.0", "telemetry_port": 14550, "drone_ip": "192.168.50.10", "drone_port": 14550}
        )
        assert config_res.status_code == 200
        assert config_res.json()["status"] == "updated"
