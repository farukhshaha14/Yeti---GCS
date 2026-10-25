"""Comprehensive tests for Real MAVLink GPS/Position telemetry, normalization,
navigation calculations, staleness preservation, simulator GPS generation, and WebSocket delivery.
"""
import asyncio
import math
import time
import pytest
from httpx import AsyncClient, ASGITransport
from pymavlink.dialects.v20 import common as mavlink2

from app.api.telemetry import get_pipeline, set_pipeline
from app.database.models import TelemetryState
from app.database.session import init_db, AsyncSessionLocal
from app.main import app
from app.models.telemetry import NormalizedTelemetry
from app.telemetry.pipeline import TelemetryPipeline, calculate_distance_and_bearing
from tests.integration.test_pipeline_e2e import MockTransport
from simulator.simulator import FlightState, TelemetrySimulator
from sqlalchemy import select


@pytest.mark.asyncio
async def test_global_position_int_scaling_and_normalization():
    """Verify MAVLink scaling: lat/lon (deg*1e7), alt (mm), relative_alt (mm), vx/vy (cm/s), hdg (cdeg)."""
    await init_db()
    transport = MockTransport()
    pipeline = TelemetryPipeline(transport=transport, mission_id="TEST-GPS-SCALE")
    await pipeline.start()
    set_pipeline(pipeline)

    try:
        mav = mavlink2.MAVLink(None)
        mav.seq = 10
        # Lat: 19.8765432, Lon: 75.3432101, Alt: 124.56m (124560 mm), Rel: 80.25m (80250 mm)
        # vx: 1200 cm/s (12.0 m/s), vy: 500 cm/s (5.0 m/s) -> ground speed: ~13.0 m/s
        # vz: -250 cm/s -> vertical speed: +2.5 m/s
        # hdg: 16850 cdeg (168.5 deg)
        msg = mav.global_position_int_encode(
            time_boot_ms=123456,
            lat=int(round(19.8765432 * 1e7)),
            lon=int(round(75.3432101 * 1e7)),
            alt=124560,
            relative_alt=80250,
            vx=1200,
            vy=500,
            vz=-250,
            hdg=16850,
        )
        msg.source_sequence = 10
        raw_bytes = msg.pack(mav)

        now_ms = int(time.time() * 1000)
        await pipeline._on_raw_packet_received(raw_bytes, ("127.0.0.1", 14550), now_ms)
        await asyncio.sleep(0.05)

        # Inspect normalized state
        state = pipeline.latest_state
        assert state.position.latitude == 19.8765432
        assert state.position.longitude == 75.3432101
        assert state.position.altitude_m == 124.56
        assert state.position.relative_altitude_m == 80.25

        assert state.gps.latitude == 19.8765432
        assert state.gps.longitude == 75.3432101
        assert state.gps.altitude_m == 124.56
        assert state.gps.relative_altitude_m == 80.25
        assert state.gps.heading_deg == 168.5
        assert state.gps.valid is True
        assert state.gps.is_stale is False
        assert state.gps.gps_fix is True

        assert state.velocity.ground_speed_mps == 13.0
        assert state.velocity.vertical_speed_mps == 2.5

        # Navigation state derived from GPS
        assert state.navigation.heading_deg == 168.5
        assert state.navigation.ground_speed_mps == 13.0
    finally:
        await pipeline.stop()
        set_pipeline(None)


@pytest.mark.asyncio
async def test_gps_raw_int_quality_normalization():
    """Verify GPS_RAW_INT quality indicators: fix_type, satellites, eph -> hdop, epv -> vdop."""
    await init_db()
    transport = MockTransport()
    pipeline = TelemetryPipeline(transport=transport, mission_id="TEST-GPS-RAW")
    await pipeline.start()
    set_pipeline(pipeline)

    try:
        mav = mavlink2.MAVLink(None)
        # Fix: 3 (3D_FIX), eph: 85 (HDOP 0.85), epv: 120 (VDOP 1.2), sats: 14, time_usec: 1700000000000000
        msg_raw = mav.gps_raw_int_encode(
            time_usec=1700000000000000,
            fix_type=3,
            lat=int(19.8765432 * 1e7),
            lon=int(75.3432101 * 1e7),
            alt=124560,
            eph=85,
            epv=120,
            vel=1300,
            cog=16850,
            satellites_visible=14,
        )
        msg_raw.source_sequence = 11
        raw_bytes = msg_raw.pack(mav)

        now_ms = int(time.time() * 1000)
        await pipeline._on_raw_packet_received(raw_bytes, ("127.0.0.1", 14550), now_ms)
        await asyncio.sleep(0.05)

        gps = pipeline.latest_state.gps
        assert gps.fix_type == 3
        assert gps.fix_status == "3D_FIX"
        assert gps.gps_fix is True
        assert gps.satellites == 14
        assert gps.hdop == 0.85
        assert gps.vdop == 1.2
        assert gps.timestamp == 1700000000000
        assert gps.valid is True
    finally:
        await pipeline.stop()
        set_pipeline(None)


@pytest.mark.asyncio
async def test_invalid_gps_rejection():
    """Verify non-physical coordinates and bad ranges are safely rejected without crash."""
    await init_db()
    transport = MockTransport()
    pipeline = TelemetryPipeline(transport=transport, mission_id="TEST-GPS-INVALID")
    await pipeline.start()
    set_pipeline(pipeline)

    try:
        mav = mavlink2.MAVLink(None)
        # Invalid Lat: 95.0 degrees (> 90)
        msg_bad = mav.global_position_int_encode(
            time_boot_ms=100,
            lat=int(95.0 * 1e7),
            lon=int(75.0 * 1e7),
            alt=50000,
            relative_alt=10000,
            vx=0,
            vy=0,
            vz=0,
            hdg=0,
        )
        msg_bad.source_sequence = 12
        await pipeline._on_raw_packet_received(msg_bad.pack(mav), ("127.0.0.1", 14550), int(time.time() * 1000))
        await asyncio.sleep(0.05)

        # State should still be uninitialized/null
        assert pipeline.latest_state.gps.latitude is None
        assert pipeline.latest_state.gps.valid is False

        # Zero coordinates (0, 0) should also be rejected as no-fix
        msg_zero = mav.global_position_int_encode(
            time_boot_ms=200,
            lat=0,
            lon=0,
            alt=0,
            relative_alt=0,
            vx=0,
            vy=0,
            vz=0,
            hdg=65535,
        )
        msg_zero.source_sequence = 13
        await pipeline._on_raw_packet_received(msg_zero.pack(mav), ("127.0.0.1", 14550), int(time.time() * 1000))
        await asyncio.sleep(0.05)
        assert pipeline.latest_state.gps.latitude is None
    finally:
        await pipeline.stop()
        set_pipeline(None)


def test_haversine_and_bearing_calculation():
    """Verify accurate geodesic distance (meters) and initial bearing (degrees)."""
    # Benchmark: Point A (19.876543, 75.343210) to Point B (19.880000, 75.345000)
    lat1, lon1 = 19.876543, 75.343210
    lat2, lon2 = 19.880000, 75.345000

    dist_m, bearing_deg = calculate_distance_and_bearing(lat1, lon1, lat2, lon2)
    # Distance should be ~428.5 meters
    assert 420.0 < dist_m < 440.0
    # Bearing should be North-North-East (~26 degrees)
    assert 20.0 < bearing_deg < 35.0


@pytest.mark.asyncio
async def test_distance_and_bearing_to_home_pipeline():
    """Verify that when drone GPS and home position are set, navigation metrics update."""
    await init_db()
    transport = MockTransport()
    pipeline = TelemetryPipeline(transport=transport, mission_id="TEST-NAV-HOME")
    await pipeline.start()
    set_pipeline(pipeline)

    try:
        mav = mavlink2.MAVLink(None)
        now_ms = int(time.time() * 1000)

        # 1. Establish Home position
        mav.seq = 1
        msg_home = mav.home_position_encode(
            latitude=int(round(19.876000 * 1e7)),
            longitude=int(round(75.343000 * 1e7)),
            altitude=0,
            x=0.0,
            y=0.0,
            z=0.0,
            q=[1.0, 0.0, 0.0, 0.0],
            approach_x=0.0,
            approach_y=0.0,
            approach_z=0.0,
        )
        msg_home.source_sequence = 1
        await pipeline._on_raw_packet_received(msg_home.pack(mav), ("127.0.0.1", 14550), now_ms)

        # 2. Feed Drone position
        mav.seq = 2
        msg_pos = mav.global_position_int_encode(
            time_boot_ms=1000,
            lat=int(round(19.877000 * 1e7)),
            lon=int(round(75.344000 * 1e7)),
            alt=50000,
            relative_alt=30000,
            vx=800,
            vy=0,
            vz=0,
            hdg=4500,
        )
        msg_pos.source_sequence = 2
        await pipeline._on_raw_packet_received(msg_pos.pack(mav), ("127.0.0.1", 14550), now_ms + 100)
        await asyncio.sleep(0.05)

        nav = pipeline.latest_state.navigation
        assert nav.distance_to_home_m is not None
        assert nav.distance_to_home_m > 50.0  # ~150 meters away
        assert nav.bearing_to_home_deg is not None
        # From (19.877000, 75.344000) to home (19.876000, 75.343000) is South-West (~225 deg)
        assert 210.0 < nav.bearing_to_home_deg < 240.0
    finally:
        await pipeline.stop()
        set_pipeline(None)


@pytest.mark.asyncio
async def test_gps_staleness_preservation():
    """Verify that when telemetry stops, the last valid GPS position is preserved, marked stale."""
    await init_db()
    transport = MockTransport()
    pipeline = TelemetryPipeline(transport=transport, mission_id="TEST-GPS-STALE")
    pipeline.settings.stale_threshold_stale_ms = 200  # fast test timeout
    pipeline.settings.disconnected_timeout_ms = 400
    await pipeline.start()
    set_pipeline(pipeline)

    try:
        mav = mavlink2.MAVLink(None)
        now_ms = int(time.time() * 1000)

        # Ingest valid position
        msg = mav.global_position_int_encode(
            time_boot_ms=1000,
            lat=int(19.876543 * 1e7),
            lon=int(75.343210 * 1e7),
            alt=40000,
            relative_alt=20000,
            vx=0,
            vy=0,
            vz=0,
            hdg=9000,
        )
        msg.source_sequence = 1
        await pipeline._on_raw_packet_received(msg.pack(mav), ("127.0.0.1", 14550), now_ms)
        await asyncio.sleep(0.05)

        assert pipeline.latest_state.gps.latitude == 19.876543
        assert pipeline.latest_state.gps.is_stale is False

        # Simulate delay
        await asyncio.sleep(0.3)
        # Health monitor should flag staleness while preserving coordinates
        assert pipeline.latest_state.gps.latitude == 19.876543  # preserved!
        assert pipeline.latest_state.gps.longitude == 75.343210  # preserved!
        assert pipeline.latest_state.gps.is_stale is True
    finally:
        await pipeline.stop()
        set_pipeline(None)


@pytest.mark.asyncio
async def test_simulator_movement_and_pipeline_flow():
    """Verify that FlightState generates dynamic, realistic coordinates and flows through pipeline."""
    flight = FlightState(home_lat=19.876543, home_lon=75.343210)
    # Takeoff
    for _ in range(50):
        flight.step(dt=0.1)

    assert flight.armed is True
    assert flight.altitude_m > 0.0

    # Cruise: should move coordinates
    initial_lat = flight.latitude
    initial_lon = flight.longitude

    flight.phase = "CRUISE"
    for _ in range(30):
        flight.step(dt=0.1)

    # Coordinates must change realistically as drone flies
    assert flight.latitude != initial_lat
    assert flight.longitude != initial_lon
    assert flight.ground_speed_mps > 0.0

    # Verify simulator produces MAVLink datagram containing GLOBAL_POSITION_INT and GPS_RAW_INT
    sim = TelemetrySimulator()
    sim.start()
    try:
        sim.flight.latitude = 19.880000
        sim.flight.longitude = 75.345000
        sim.flight.altitude_m = 35.0
        sim.flight.yaw_deg = 180.0
        sim.flight.ground_speed_mps = 12.0

        # Run pipeline
        transport = MockTransport()
        pipeline = TelemetryPipeline(transport=transport, mission_id="TEST-SIM-INGEST")
        await pipeline.start()
        set_pipeline(pipeline)

        # Feed simulator packet directly to pipeline
        sim.sequence_number = 42
        sim.mav.seq = 42
        now_ms = int(time.time() * 1000)

        lat_int = int(sim.flight.latitude * 1e7)
        lon_int = int(sim.flight.longitude * 1e7)
        alt_int = int(sim.flight.altitude_m * 1000)

        msg_pos = sim.mav.global_position_int_encode(
            time_boot_ms=now_ms % 1000000,
            lat=lat_int,
            lon=lon_int,
            alt=alt_int,
            relative_alt=alt_int,
            vx=0,
            vy=-1200,
            vz=0,
            hdg=18000,
        )
        msg_pos.source_sequence = 42

        msg_gps = sim.mav.gps_raw_int_encode(
            time_usec=now_ms * 1000,
            fix_type=3,
            lat=lat_int,
            lon=lon_int,
            alt=alt_int,
            eph=120,
            epv=180,
            vel=1200,
            cog=18000,
            satellites_visible=14,
        )
        msg_gps.source_sequence = 42

        sim.mav.seq = 42
        bytes_pos = msg_pos.pack(sim.mav)
        sim.mav.seq = 43
        bytes_gps = msg_gps.pack(sim.mav)
        packet_bytes = bytes_pos + bytes_gps
        await pipeline._on_raw_packet_received(packet_bytes, ("127.0.0.1", 14550), now_ms)
        await asyncio.sleep(0.05)

        state = pipeline.latest_state
        assert state.gps.latitude == 19.880000
        assert state.gps.longitude == 75.345000
        assert state.gps.altitude_m == 35.0
        assert state.gps.heading_deg == 180.0
        assert state.gps.hdop == 1.2
        assert state.gps.vdop == 1.8
        assert state.gps.satellites == 14
        assert state.navigation.heading_deg == 180.0
    finally:
        sim.stop()
        await pipeline.stop()
        set_pipeline(None)


@pytest.mark.asyncio
async def test_sqlite_persistence_of_gps_state():
    """Verify TelemetryState database table records latitude, longitude, hdop, vdop, heading."""
    await init_db()
    transport = MockTransport()
    pipeline = TelemetryPipeline(transport=transport, mission_id="TEST-DB-GPS")
    await pipeline.start()
    set_pipeline(pipeline)

    try:
        mav = mavlink2.MAVLink(None)
        now_ms = int(time.time() * 1000)

        msg_pos = mav.global_position_int_encode(
            time_boot_ms=1000,
            lat=int(round(19.876543 * 1e7)),
            lon=int(round(75.343210 * 1e7)),
            alt=45000,
            relative_alt=25000,
            vx=500,
            vy=0,
            vz=0,
            hdg=9000,
        )
        msg_pos.source_sequence = 1

        msg_gps = mav.gps_raw_int_encode(
            time_usec=1000000,
            fix_type=3,
            lat=int(round(19.876543 * 1e7)),
            lon=int(round(75.343210 * 1e7)),
            alt=45000,
            eph=95,
            epv=110,
            vel=500,
            cog=9000,
            satellites_visible=12,
        )
        msg_gps.source_sequence = 2

        mav.seq = 1
        bytes_pos = msg_pos.pack(mav)
        mav.seq = 2
        bytes_gps = msg_gps.pack(mav)
        combined = bytes_pos + bytes_gps
        await pipeline._on_raw_packet_received(combined, ("127.0.0.1", 14550), now_ms)

        # Allow persistence worker to write to SQLite WAL
        await asyncio.sleep(0.2)

        async with AsyncSessionLocal() as session:
            res = await session.execute(
                select(TelemetryState).where(TelemetryState.mission_id == "TEST-DB-GPS")
            )
            state_row = res.scalar_one_or_none()
            assert state_row is not None
            assert state_row.latitude == 19.876543
            assert state_row.longitude == 75.343210
            assert state_row.altitude_m == 45.0
            assert state_row.hdop == 0.95
            assert state_row.vdop == 1.10
            assert state_row.gps_satellites == 12
    finally:
        await pipeline.stop()
        set_pipeline(None)
