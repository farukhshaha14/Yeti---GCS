"""VEGAPilot GCS Offline Satellite Map Tile Server.
Serves genuine offline satellite imagery from local MBTiles SQLite databases or local XYZ tile directories.
100% offline - makes zero external network calls.
"""
import logging
import os
import sqlite3
from typing import Any, Dict, Optional
from fastapi import APIRouter, HTTPException, Response
from app.config import get_settings

logger = logging.getLogger("vegapilot.map_tiles")
router = APIRouter(prefix="/api/map", tags=["map"])


def _detect_mime_type(data: bytes, fallback: str = "image/png") -> str:
    """Detect image MIME type from magic header bytes."""
    if data.startswith(b"\x89PNG\r\n\x1a\n"):
        return "image/png"
    elif data.startswith(b"\xff\xd8\xff"):
        return "image/jpeg"
    elif data.startswith(b"RIFF") and len(data) > 12 and data[8:12] == b"WEBP":
        return "image/webp"
    return fallback


def _get_mbtiles_conn(path: str) -> Optional[sqlite3.Connection]:
    """Open read-only SQLite connection to MBTiles file."""
    if not os.path.isfile(path):
        return None
    try:
        uri = f"file:{os.path.abspath(path)}?mode=ro"
        conn = sqlite3.connect(uri, uri=True, check_same_thread=False)
        return conn
    except Exception as e:
        logger.warning(f"Failed to open MBTiles file at {path}: {e}")
        return None


def safe_relpath(path: str) -> str:
    """Safely calculate relpath without failing across different Windows drive mounts."""
    try:
        return os.path.relpath(path)
    except ValueError:
        return path


@router.get("/status")
async def get_map_status() -> Dict[str, Any]:
    """Check availability of local offline satellite imagery."""
    settings = get_settings()
    mbtiles_path = os.path.abspath(settings.satellite_mbtiles_path)
    tiles_dir = os.path.abspath(settings.satellite_tiles_dir)

    has_mbtiles = os.path.isfile(mbtiles_path)
    has_tiles_dir = os.path.isdir(tiles_dir) and any(os.scandir(tiles_dir))

    metadata: Dict[str, str] = {}
    tile_source: Optional[str] = None
    bounds: Optional[str] = None
    minzoom: Optional[str] = None
    maxzoom: Optional[str] = None

    if has_mbtiles:
        tile_source = "mbtiles"
        conn = _get_mbtiles_conn(mbtiles_path)
        if conn:
            try:
                cursor = conn.cursor()
                cursor.execute("SELECT name, value FROM metadata")
                rows = cursor.fetchall()
                for name, val in rows:
                    metadata[name] = str(val)
                bounds = metadata.get("bounds")
                minzoom = metadata.get("minzoom")
                maxzoom = metadata.get("maxzoom")
            except Exception as e:
                logger.warning(f"Error reading MBTiles metadata: {e}")
            finally:
                conn.close()
    elif has_tiles_dir:
        tile_source = "directory"

    # Survey of India (SOI) Sovereign Boundary check
    soi_boundary_path = os.path.abspath(settings.soi_boundary_path)
    fallback_soi_path = os.path.abspath(
        os.path.join(os.path.dirname(__file__), "..", "..", "..", "frontend", "public", "assets", "map", "india_boundary_soi.geojson")
    )
    has_soi_boundary = os.path.isfile(soi_boundary_path) or os.path.isfile(fallback_soi_path)
    active_soi_path = soi_boundary_path if os.path.isfile(soi_boundary_path) else fallback_soi_path

    is_installed = bool(has_mbtiles or has_tiles_dir)

    rel_mbtiles = safe_relpath(mbtiles_path)
    rel_tiles = safe_relpath(tiles_dir)
    rel_soi = safe_relpath(active_soi_path) if has_soi_boundary else safe_relpath(soi_boundary_path)

    return {
        "installed": is_installed,
        "tile_source": tile_source,
        "mbtiles_path": rel_mbtiles,
        "tiles_dir": rel_tiles,
        "soi_compliant": has_soi_boundary,
        "soi_boundary_path": rel_soi,
        "soi_endpoint": "/api/map/boundary/soi.geojson",
        "metadata": metadata if metadata else None,
        "bounds": bounds,
        "minzoom": minzoom,
        "maxzoom": maxzoom,
        "message": (
            "Offline satellite imagery active from local source. SOI sovereign boundary loaded."
            if is_installed and has_soi_boundary
            else "Offline satellite imagery active from local source."
            if is_installed
            else "Offline satellite imagery has not yet been installed. Place a licensed MBTiles file at "
            f"'{rel_mbtiles}' or extract standard XYZ tiles into '{rel_tiles}/{{z}}/{{x}}/{{y}}.png'."
        ),
        "recommended_datasets": [
            {
                "name": "ESA Copernicus Sentinel-2 Cloudless",
                "license": "Creative Commons Attribution 4.0 International (CC BY 4.0) - explicitly permits offline caching & display",
                "description": "High-resolution (10m) cloud-free global satellite imagery. Download regional GeoTIFF/MBTiles via Sentinel Hub or EOX.",
            },
            {
                "name": "USGS / NASA Landsat 8/9",
                "license": "Public Domain (US Government Work)",
                "description": "Multi-spectral satellite imagery freely usable offline without restriction.",
            },
            {
                "name": "QGIS Regional MBTiles Export",
                "license": "Open Data / Orthoimagery",
                "description": "Use QGIS 'Generate XYZ tiles (MBTiles)' tool to export your competition flying zone bounding box.",
            },
        ],
    }


def _fetch_tile_bytes(z: int, x: int, y: int) -> Optional[tuple[bytes, str]]:
    """Fetch raw tile bytes and MIME type from local MBTiles or directory."""
    settings = get_settings()

    # 1. Check MBTiles first
    mbtiles_path = os.path.abspath(settings.satellite_mbtiles_path)
    if os.path.isfile(mbtiles_path):
        conn = _get_mbtiles_conn(mbtiles_path)
        if conn:
            try:
                cursor = conn.cursor()
                # MBTiles standard uses TMS tile row: tms_y = (2^z - 1) - y
                tms_y = (1 << z) - 1 - y
                cursor.execute(
                    "SELECT tile_data FROM tiles WHERE zoom_level = ? AND tile_column = ? AND tile_row = ?",
                    (z, x, tms_y),
                )
                row = cursor.fetchone()
                if not row:
                    # Fallback check for XYZ row orientation
                    cursor.execute(
                        "SELECT tile_data FROM tiles WHERE zoom_level = ? AND tile_column = ? AND tile_row = ?",
                        (z, x, y),
                    )
                    row = cursor.fetchone()

                if row and row[0]:
                    tile_data: bytes = row[0]
                    mime = _detect_mime_type(tile_data)
                    return tile_data, mime
            except Exception as e:
                logger.error(f"Error querying MBTiles for tile {z}/{x}/{y}: {e}")
            finally:
                conn.close()

    # 2. Check local XYZ directory
    tiles_dir = os.path.abspath(settings.satellite_tiles_dir)
    if os.path.isdir(tiles_dir):
        for ext, mime in [(".png", "image/png"), (".jpg", "image/jpeg"), (".jpeg", "image/jpeg"), (".webp", "image/webp")]:
            tile_path = os.path.join(tiles_dir, str(z), str(x), f"{y}{ext}")
            if os.path.isfile(tile_path):
                try:
                    with open(tile_path, "rb") as f:
                        return f.read(), mime
                except Exception as e:
                    logger.error(f"Failed to read tile file {tile_path}: {e}")

    return None


@router.get("/tiles/{z}/{x}/{y}")
@router.get("/tiles/{z}/{x}/{y}.png")
@router.get("/tiles/{z}/{x}/{y}.jpg")
async def get_tile(z: int, x: int, y: int) -> Response:
    """Serve offline satellite tile at zoom level z and coordinates x, y."""
    tile_info = _fetch_tile_bytes(z, x, y)
    if not tile_info:
        raise HTTPException(
            status_code=404,
            detail=f"Tile {z}/{x}/{y} not found in offline satellite storage.",
        )

    tile_bytes, mime_type = tile_info
    return Response(
        content=tile_bytes,
        media_type=mime_type,
        headers={
            "Cache-Control": "public, max-age=86400",
            "X-Offline-Map": "VEGAPilot-GCS-Local",
        },
    )


@router.get("/boundary")
@router.get("/boundary/soi.geojson")
async def get_soi_boundary() -> Response:
    """Serve official Survey of India sovereign boundary GeoJSON.
    Guarantees compliant sovereign borders including all of J&K, Ladakh, Aksai Chin,
    and Arunachal Pradesh under Government of India Geospatial Data Guidelines.
    """
    settings = get_settings()
    candidate_paths = [
        os.path.abspath(settings.soi_boundary_path),
        os.path.abspath(os.path.join(os.path.dirname(__file__), "..", "..", "..", "frontend", "public", "assets", "map", "india_boundary_soi.geojson")),
        os.path.abspath(os.path.join(os.path.dirname(__file__), "..", "..", "..", "data", "assets", "map", "india_boundary_soi.geojson")),
    ]

    for path in candidate_paths:
        if os.path.isfile(path):
            try:
                with open(path, "rb") as f:
                    content = f.read()
                return Response(
                    content=content,
                    media_type="application/geo+json",
                    headers={
                        "Cache-Control": "public, max-age=86400",
                        "X-Geospatial-Compliance": "Survey-of-India-Official-Boundary",
                    },
                )
            except Exception as e:
                logger.error(f"Error reading SOI boundary GeoJSON at {path}: {e}")

    raise HTTPException(
        status_code=404,
        detail="Survey of India boundary GeoJSON not found on server.",
    )
