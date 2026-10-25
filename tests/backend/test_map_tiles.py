"""Tests for offline satellite map tile server and status API."""
import os
import sqlite3
import pytest
import pytest_asyncio
from httpx import AsyncClient, ASGITransport
from app.main import app
from app.config import get_settings


@pytest.mark.asyncio
async def test_map_status_not_installed():
    """Verify status reports not installed when no dataset is present."""
    transport = ASGITransport(app=app)
    async with AsyncClient(transport=transport, base_url="http://test") as client:
        resp = await client.get("/api/map/status")
        assert resp.status_code == 200
        data = resp.json()
        assert "installed" in data
        assert "recommended_datasets" in data
        assert len(data["recommended_datasets"]) >= 2
        # Verify recommended datasets include explicitly licensed offline sources
        licenses = [d["license"] for d in data["recommended_datasets"]]
        assert any("CC BY 4.0" in lic for lic in licenses)


@pytest.mark.asyncio
async def test_tile_404_when_missing():
    """Verify HTTP 404 when tile does not exist in offline storage."""
    transport = ASGITransport(app=app)
    async with AsyncClient(transport=transport, base_url="http://test") as client:
        resp = await client.get("/api/map/tiles/15/2345/6789.png")
        assert resp.status_code == 404
        assert "not found" in resp.json()["detail"].lower()


@pytest.mark.asyncio
async def test_directory_tile_serving(tmp_path):
    """Verify local directory tile serving."""
    # Create test tile structure
    tile_dir = tmp_path / "tiles" / "10" / "500"
    tile_dir.mkdir(parents=True)
    tile_file = tile_dir / "300.png"

    # Minimal 1x1 transparent PNG bytes
    png_bytes = (
        b"\x89PNG\r\n\x1a\n\x00\x00\x00\rIHDR\x00\x00\x00\x01\x00\x00\x00\x01"
        b"\x08\x06\x00\x00\x00\x1f\x15c4\x00\x00\x00\nIDATx\x9cc\x00\x01"
        b"\x00\x00\x05\x00\x01\r\n-\xb4\x00\x00\x00\x00IEND\xaeB`\x82"
    )
    tile_file.write_bytes(png_bytes)

    settings = get_settings()
    orig_dir = settings.satellite_tiles_dir
    settings.satellite_tiles_dir = str(tmp_path / "tiles")

    try:
        transport = ASGITransport(app=app)
        async with AsyncClient(transport=transport, base_url="http://test") as client:
            resp = await client.get("/api/map/tiles/10/500/300.png")
            assert resp.status_code == 200
            assert resp.headers["content-type"] == "image/png"
            assert resp.content == png_bytes
            assert resp.headers["x-offline-map"] == "VEGAPilot-GCS-Local"
    finally:
        settings.satellite_tiles_dir = orig_dir


@pytest.mark.asyncio
async def test_mbtiles_tile_serving(tmp_path):
    """Verify local MBTiles SQLite tile retrieval and TMS Y flip."""
    mbtiles_file = tmp_path / "test_satellite.mbtiles"

    png_bytes = (
        b"\x89PNG\r\n\x1a\n\x00\x00\x00\rIHDR\x00\x00\x00\x01\x00\x00\x00\x01"
        b"\x08\x06\x00\x00\x00\x1f\x15c4\x00\x00\x00\nIDATx\x9cc\x00\x01"
        b"\x00\x00\x05\x00\x01\r\n-\xb4\x00\x00\x00\x00IEND\xaeB`\x82"
    )

    # Initialize MBTiles SQLite database
    conn = sqlite3.connect(str(mbtiles_file))
    cur = conn.cursor()
    cur.execute("CREATE TABLE metadata (name text, value text);")
    cur.execute("INSERT INTO metadata VALUES ('name', 'Test Satellite');")
    cur.execute("INSERT INTO metadata VALUES ('format', 'png');")
    cur.execute("INSERT INTO metadata VALUES ('bounds', '75.0,19.0,76.0,20.0');")
    cur.execute("CREATE TABLE tiles (zoom_level integer, tile_column integer, tile_row integer, tile_data blob);")

    # Zoom 12, X 50, Y 60.
    # In TMS, tms_y = (1 << 12) - 1 - 60 = 4095 - 60 = 4035
    tms_y = (1 << 12) - 1 - 60
    cur.execute("INSERT INTO tiles VALUES (12, 50, ?, ?)", (tms_y, png_bytes))
    conn.commit()
    conn.close()

    settings = get_settings()
    orig_mbtiles = settings.satellite_mbtiles_path
    settings.satellite_mbtiles_path = str(mbtiles_file)

    try:
        transport = ASGITransport(app=app)
        async with AsyncClient(transport=transport, base_url="http://test") as client:
            # Check status reports installed: true
            status_resp = await client.get("/api/map/status")
            assert status_resp.status_code == 200
            status_data = status_resp.json()
            assert status_data["installed"] is True
            assert status_data["tile_source"] == "mbtiles"
            assert status_data["bounds"] == "75.0,19.0,76.0,20.0"

            # Fetch tile by standard XYZ coordinates (z=12, x=50, y=60)
            tile_resp = await client.get("/api/map/tiles/12/50/60.png")
            assert tile_resp.status_code == 200
            assert tile_resp.headers["content-type"] == "image/png"
            assert tile_resp.content == png_bytes
    finally:
        settings.satellite_mbtiles_path = orig_mbtiles


@pytest.mark.asyncio
async def test_soi_boundary_serving():
    """Verify Survey of India sovereign boundary GeoJSON serving."""
    transport = ASGITransport(app=app)
    async with AsyncClient(transport=transport, base_url="http://test") as client:
        resp = await client.get("/api/map/boundary/soi.geojson")
        assert resp.status_code == 200
        assert "application/geo+json" in resp.headers["content-type"]
        assert resp.headers["x-geospatial-compliance"] == "Survey-of-India-Official-Boundary"

        data = resp.json()
        assert data["type"] == "FeatureCollection"
        assert "features" in data and len(data["features"]) > 0
        feature = data["features"][0]
        assert feature["properties"]["authority"] == "Survey of India (SOI)"
        assert feature["geometry"]["type"] == "MultiPolygon"
        # Coordinates must contain sovereign boundaries (WGS84 lon, lat)
        coords = feature["geometry"]["coordinates"]
        assert len(coords) >= 1
        mainland = coords[0][0]
        assert len(mainland) >= 50
        # Check northernmost point (Ladakh / Siachen / Karakoram > 35°N)
        assert any(pt[1] > 35.0 for pt in mainland)


@pytest.mark.asyncio
async def test_map_status_soi_compliance():
    """Verify /api/map/status reports SOI compliance."""
    transport = ASGITransport(app=app)
    async with AsyncClient(transport=transport, base_url="http://test") as client:
        resp = await client.get("/api/map/status")
        assert resp.status_code == 200
        data = resp.json()
        assert "soi_compliant" in data
        assert data["soi_compliant"] is True
        assert "soi_boundary_path" in data
        assert "soi_endpoint" in data
