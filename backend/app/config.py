"""VEGAPilot GCS Configuration Module
Centralized, validated configuration reading from environment and supporting runtime updates.
"""
from ipaddress import IPv4Address
from pathlib import Path
from typing import Literal
from pydantic import Field, field_validator
from pydantic_settings import BaseSettings, SettingsConfigDict


class Settings(BaseSettings):
    model_config = SettingsConfigDict(
        env_file=".env",
        env_file_encoding="utf-8",
        extra="ignore"
    )

    # Network Bindings
    gcs_bind_host: str = Field(default="0.0.0.0", description="IP host interface to bind UDP and services")
    gcs_ip: str = Field(default="192.168.50.20", description="GCS laptop static IP on mission Wi-Fi")
    drone_ip: str = Field(default="192.168.50.10", description="Drone wireless telemetry IP")
    subnet_mask: str = Field(default="255.255.255.0", description="Local subnet mask")

    # Telemetry Transport
    telemetry_transport: Literal["udp", "tcp", "serial"] = Field(default="udp")
    telemetry_port: int = Field(default=14550, ge=1024, le=65535)

    # Web & WebSocket Server
    websocket_host: str = Field(default="127.0.0.1")
    websocket_port: int = Field(default=8080, ge=1024, le=65535)

    # Database
    database_url: str = Field(default="sqlite+aiosqlite:///./data/vegapilot.db")

    # Operating Mode: DEMO | SIMULATOR | HARDWARE
    operation_mode: Literal["DEMO", "SIMULATOR", "HARDWARE"] = Field(default="SIMULATOR")
    drone_id: str = Field(default="VEGAPilot-01")

    # Latency and Staleness Thresholds (milliseconds - Section 12: LIVE <1s, DEGRADED 1-3s, STALE 3-10s, DISCONNECTED >10s)
    stale_threshold_degraded_ms: int = Field(default=1000, description="Threshold for DEGRADED state")
    stale_threshold_stale_ms: int = Field(default=3000, description="Threshold for STALE state")
    disconnected_timeout_ms: int = Field(default=10000, description="Threshold for DISCONNECTED state")

    # Offline Satellite Map Imagery & Sovereign Boundary
    satellite_mbtiles_path: str = Field(default="data/satellite.mbtiles", description="Path to local MBTiles SQLite database")
    satellite_tiles_dir: str = Field(default="data/tiles", description="Path to local XYZ tile directory")
    soi_boundary_path: str = Field(default="data/assets/map/india_boundary_soi.geojson", description="Path to Survey of India sovereign boundary GeoJSON")

    @field_validator("gcs_ip", "drone_ip")
    @classmethod
    def validate_ip(cls, v: str) -> str:
        try:
            IPv4Address(v)
            return v
        except ValueError:
            raise ValueError(f"Invalid IPv4 address: {v}")

    @field_validator("gcs_bind_host")
    @classmethod
    def validate_bind_host(cls, v: str) -> str:
        if v in ("0.0.0.0", "127.0.0.1", "localhost"):
            return v
        try:
            IPv4Address(v)
            return v
        except ValueError:
            raise ValueError(f"Invalid bind host: {v}")


# Global settings singleton
settings = Settings()


def get_settings() -> Settings:
    return settings


def update_settings(**kwargs) -> Settings:
    """Safely update configuration at runtime (e.g. via Settings page)."""
    global settings
    new_data = settings.model_dump()
    new_data.update(kwargs)
    new_settings = Settings(**new_data)
    settings = new_settings
    return settings
