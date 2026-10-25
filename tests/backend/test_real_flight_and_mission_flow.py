import pytest
import asyncio
from httpx import AsyncClient, ASGITransport
from app.main import app
from app.api.telemetry import get_pipeline, set_pipeline
from app.telemetry.pipeline import TelemetryPipeline
from tests.integration.test_pipeline_e2e import MockTransport
from pymavlink.dialects.v20 import common as mavlink2

@pytest.mark.asyncio
async def test_complete_gps_and_mission_protocol_flow():
    # 1. Setup Pipeline with MockTransport to intercept authentic MAVLink packets
    transport = MockTransport()
    pipeline = TelemetryPipeline(transport=transport, mission_id="TEST-FLOW-99")
    await pipeline.start()
    set_pipeline(pipeline)

    try:
        mav = mavlink2.MAVLink(None)

        # -------------------------------------------------------------
        # TEST 1, 2, 3: GPS Telemetry Ingestion, Drone Marker & Heading
        # -------------------------------------------------------------
        # Lat: 19.876543, Lon: 75.343210, Alt: 42.5m, Hdg: 184.2 deg (18420 cdeg)
        msg_pos1 = mav.global_position_int_encode(
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
        import time
        now_ms = int(time.time() * 1000)
        await pipeline._on_raw_packet_received(msg_pos1.pack(mav), ("127.0.0.1", 14555), now_ms)
        await asyncio.sleep(0.05)

        gps = pipeline.latest_state.gps
        assert gps.latitude == 19.876543
        assert gps.longitude == 75.343210
        assert gps.altitude_m == 42.5
        assert gps.heading_deg == 184.2
        assert gps.valid is True
        assert gps.is_stale is False

        # Ingest GPS_RAW_INT (Fix 3, 14 satellites)
        mav.seq += 1
        msg_raw = mav.gps_raw_int_encode(
            time_usec=1000000,
            fix_type=3,
            lat=int(19.876543 * 1e7),
            lon=int(75.343210 * 1e7),
            alt=int(42.5 * 1000),
            eph=100,
            epv=150,
            vel=500,
            cog=18420,
            satellites_visible=14,
        )
        await pipeline._on_raw_packet_received(msg_raw.pack(mav), ("127.0.0.1", 14555), int(time.time() * 1000))
        await asyncio.sleep(0.05)

        assert pipeline.latest_state.gps.satellites == 14
        assert pipeline.latest_state.gps.fix_status == "3D_FIX"

        # Mark pipeline link as active/LIVE for mission upload validation
        pipeline.latest_state.data_health.status = "LIVE"

        # -------------------------------------------------------------
        # TEST 4-10: Mission Creation, Validation, Saving
        # -------------------------------------------------------------
        asgi_transport = ASGITransport(app=app)
        async with AsyncClient(transport=asgi_transport, base_url="http://test") as client:
            res_create = await client.post("/api/missions", json={"name": "End-to-End Flight Test"})
            assert res_create.status_code == 200
            m_id = res_create.json()["mission_id"]

            # Save 3 Waypoints (WP01, WP02, WP03) and Home
            wps = [
                {"id": 1, "lat": 19.876543, "lon": 75.343210, "alt_m": 20.0, "action": "TAKEOFF"},
                {"id": 2, "lat": 19.877001, "lon": 75.344100, "alt_m": 25.0, "action": "WAYPOINT"},
                {"id": 3, "lat": 19.878100, "lon": 75.345200, "alt_m": 30.0, "action": "WAYPOINT"},
            ]
            home_pt = {"lat": 19.876000, "lon": 75.343000, "alt_m": 0.0}

            res_save = await client.put(f"/api/missions/{m_id}", json={
                "name": "End-to-End Flight Test",
                "waypoints": wps,
                "home": home_pt
            })
            assert res_save.status_code == 200

            pipe = get_pipeline()
            if pipe:
                pipe.latest_state.data_health.status = "LIVE"

            # Validate Mission
            res_val = await client.post(f"/api/missions/{m_id}/validate", json={"waypoints": wps, "home": home_pt})
            assert res_val.status_code == 200
            val_data = res_val.json()
            assert val_data["valid"] is True, f"Validation failed: {val_data}"
            assert val_data["waypoint_count"] == 3

        # -------------------------------------------------------------
        # TEST 11, 12: MAVLink Mission Upload Protocol Handshake
        # -------------------------------------------------------------
        # Simulate autopilot mission protocol handshake in background task:
        # 1. Autopilot receives MISSION_COUNT -> replies MISSION_REQUEST_INT(0)
        # 2. Autopilot receives MISSION_ITEM_INT(0) -> replies MISSION_REQUEST_INT(1)
        # 3. Autopilot receives MISSION_ITEM_INT(1) -> replies MISSION_REQUEST_INT(2)
        # 4. Autopilot receives MISSION_ITEM_INT(2) -> replies MISSION_ACK(ACCEPTED)
        async def mock_autopilot_mission_handler():
            sent_idx = 0
            while True:
                await asyncio.sleep(0.01)
                if len(transport.sent_packets) > sent_idx:
                    pkt, _ = transport.sent_packets[sent_idx]
                    sent_idx += 1
                    try:
                        msgs = mav.parse_buffer(pkt)
                        for parsed in msgs:
                            if parsed.get_type() == "MISSION_COUNT":
                                req_msg = mav.mission_request_int_encode(
                                    target_system=1,
                                    target_component=1,
                                    seq=0,
                                    mission_type=0
                                )
                                mav.seq += 1
                                await pipeline._on_raw_packet_received(req_msg.pack(mav), ("127.0.0.1", 14555), int(time.time() * 1000))
                            elif parsed.get_type() == "MISSION_ITEM_INT":
                                if parsed.seq == 0:
                                    req_msg = mav.mission_request_int_encode(
                                        target_system=1,
                                        target_component=1,
                                        seq=1,
                                        mission_type=0
                                    )
                                    mav.seq += 1
                                    await pipeline._on_raw_packet_received(req_msg.pack(mav), ("127.0.0.1", 14555), int(time.time() * 1000))
                                elif parsed.seq == 1:
                                    req_msg = mav.mission_request_int_encode(
                                        target_system=1,
                                        target_component=1,
                                        seq=2,
                                        mission_type=0
                                    )
                                    mav.seq += 1
                                    await pipeline._on_raw_packet_received(req_msg.pack(mav), ("127.0.0.1", 14555), int(time.time() * 1000))
                                elif parsed.seq == 2:
                                    ack_msg = mav.mission_ack_encode(
                                        target_system=1,
                                        target_component=1,
                                        type=0, # MAV_MISSION_ACCEPTED
                                        mission_type=0
                                    )
                                    mav.seq += 1
                                    await pipeline._on_raw_packet_received(ack_msg.pack(mav), ("127.0.0.1", 14555), int(time.time() * 1000))
                                    return
                    except Exception as e:
                        pass

        task_mock = asyncio.create_task(mock_autopilot_mission_handler())

        # Trigger MAVLink mission upload
        upload_res = await pipeline.upload_mission_mavlink(wps, target_addr=("127.0.0.1", 14555))
        await task_mock

        assert upload_res["status"] in ("ACKNOWLEDGED", "UPLOAD_SUCCESSFUL")
        assert upload_res["waypoint_count"] == 3

        # -------------------------------------------------------------
        # TEST 13: Mission Execution Tracking (MISSION_CURRENT)
        # -------------------------------------------------------------
        mav.seq += 1
        msg_cur = mav.mission_current_encode(seq=2)
        await pipeline._on_raw_packet_received(msg_cur.pack(mav), ("127.0.0.1", 14555), 1700000000600)
        await asyncio.sleep(0.05)

        progress = pipeline.latest_state.mission_progress
        assert progress.current_seq == 2
        assert progress.is_active is True

    finally:
        await pipeline.stop()
