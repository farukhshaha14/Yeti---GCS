"""Network and GCS configuration API routes with resilient OS fallback."""
import logging
import platform
import socket
import subprocess
from typing import Dict, Any, Optional, List
from fastapi import APIRouter, HTTPException, status
from pydantic import BaseModel, Field
from app.config import get_settings, update_settings
from app.api.telemetry import get_pipeline

logger = logging.getLogger("vegapilot.config")

router = APIRouter(tags=["config"])


class NetworkConfigUpdate(BaseModel):
    gcs_ip: Optional[str] = None
    gcs_bind_host: Optional[str] = None
    drone_ip: Optional[str] = None
    subnet_mask: Optional[str] = None
    telemetry_port: Optional[int] = Field(None, ge=1024, le=65535)
    telemetry_transport: Optional[str] = None
    operation_mode: Optional[str] = None
    stale_threshold_degraded_ms: Optional[int] = None
    stale_threshold_stale_ms: Optional[int] = None
    disconnected_timeout_ms: Optional[int] = None


def get_safe_os_network_info() -> Dict[str, Any]:
    """Inspects OS network interfaces safely with strict timeouts and exception guards.
    
    Ensures that if OS commands like nmcli, ip, or wpa_cli are missing, fail, or lack
    root permissions during local development, the call never hangs and returns clean fallback data.
    """
    info: Dict[str, Any] = {
        "os_platform": platform.system(),
        "hostname": socket.gethostname(),
        "detected_ip": None,
        "wifi_interface": None,
        "wifi_ssid": None,
        "os_tools_available": False,
        "interfaces": [],
    }

    # 1. Non-blocking local IP discovery via UDP socket trick (requires no external connection)
    try:
        s = socket.socket(socket.AF_INET, socket.SOCK_DGRAM)
        s.settimeout(0.2)
        try:
            s.connect(("10.255.255.255", 1))
            info["detected_ip"] = s.getsockname()[0]
        except Exception:
            info["detected_ip"] = "127.0.0.1"
        finally:
            s.close()
    except Exception as e:
        logger.debug(f"Socket IP discovery fallback: {e}")
        info["detected_ip"] = "127.0.0.1"

    # 2. Safe OS-level network command inspection (Linux nmcli / wpa_cli / ip)
    current_os = platform.system().lower()
    if "linux" in current_os:
        # Check nmcli with 0.5s timeout
        try:
            res = subprocess.run(
                ["nmcli", "-t", "-f", "DEVICE,TYPE,STATE,CONNECTION", "dev"],
                capture_output=True,
                text=True,
                timeout=0.5,
            )
            if res.returncode == 0 and res.stdout:
                info["os_tools_available"] = True
                for line in res.stdout.strip().split("\n"):
                    parts = line.split(":")
                    if len(parts) >= 4:
                        dev, dev_type, state, conn = parts[0], parts[1], parts[2], parts[3]
                        info["interfaces"].append({
                            "device": dev,
                            "type": dev_type,
                            "state": state,
                            "connection": conn,
                        })
                        if dev_type == "wifi" and state == "connected":
                            info["wifi_interface"] = dev
                            info["wifi_ssid"] = conn
        except (FileNotFoundError, PermissionError, subprocess.TimeoutExpired, Exception) as err:
            logger.debug(f"nmcli inspection skipped or unavailable: {err}")

        # Check wpa_cli fallback if nmcli was absent
        if not info["wifi_ssid"]:
            try:
                res = subprocess.run(
                    ["wpa_cli", "status"],
                    capture_output=True,
                    text=True,
                    timeout=0.5,
                )
                if res.returncode == 0 and res.stdout:
                    info["os_tools_available"] = True
                    for line in res.stdout.strip().split("\n"):
                        if line.startswith("ssid="):
                            info["wifi_ssid"] = line.split("=", 1)[1]
            except (FileNotFoundError, PermissionError, subprocess.TimeoutExpired, Exception):
                pass

    return info


@router.get("/api/config/network")
@router.get("/api/network/status")
@router.get("/api/network/config")
@router.get("/api/network")
async def get_network_config() -> Dict[str, Any]:
    """Returns the current network and transport configuration and live socket status.
    
    Guaranteed to return a complete, valid JSON structure even when hardware or
    OS tools are offline.
    """
    try:
        s = get_settings()
        pipeline = get_pipeline()
        transport_stats = pipeline.transport.get_stats() if pipeline else {}
        health = pipeline.reliability.get_data_health() if pipeline else None
        os_info = get_safe_os_network_info()

        return {
            "gcs_ip": getattr(s, "gcs_ip", "192.168.50.20"),
            "gcs_bind_host": getattr(s, "gcs_bind_host", "0.0.0.0"),
            "drone_ip": getattr(s, "drone_ip", "192.168.50.10"),
            "subnet_mask": getattr(s, "subnet_mask", "255.255.255.0"),
            "telemetry_transport": getattr(s, "telemetry_transport", "UDP"),
            "telemetry_port": getattr(s, "telemetry_port", 14550),
            "websocket_host": getattr(s, "websocket_host", "0.0.0.0"),
            "websocket_port": getattr(s, "websocket_port", 8080),
            "operation_mode": getattr(s, "operation_mode", "SIMULATOR"),
            "drone_id": getattr(s, "drone_id", "VEGAPilot-01"),
            "stale_threshold_degraded_ms": getattr(s, "stale_threshold_degraded_ms", 1000),
            "stale_threshold_stale_ms": getattr(s, "stale_threshold_stale_ms", 3000),
            "disconnected_timeout_ms": getattr(s, "disconnected_timeout_ms", 10000),
            "is_configured": True,
            "socket_status": transport_stats.get("socket_state", "STANDBY"),
            "packets_received": transport_stats.get("packets_received", 0),
            "bytes_received": transport_stats.get("bytes_received", 0),
            "transport_latency_ms": health.transport_latency_ms if health else None,
            "connection_state": health.status if health else "DISCONNECTED",
            "transport": transport_stats,
            "system_network": os_info,
        }
    except Exception as e:
        logger.error(f"Error reading network configuration, using fallback: {e}", exc_info=True)
        # Safe fallback response guaranteeing valid JSON and preventing client hang
        return {
            "gcs_ip": "192.168.50.20",
            "gcs_bind_host": "0.0.0.0",
            "drone_ip": "192.168.50.10",
            "subnet_mask": "255.255.255.0",
            "telemetry_transport": "UDP",
            "telemetry_port": 14550,
            "websocket_host": "0.0.0.0",
            "websocket_port": 8080,
            "operation_mode": "SIMULATOR",
            "drone_id": "VEGAPilot-01",
            "stale_threshold_degraded_ms": 1000,
            "stale_threshold_stale_ms": 3000,
            "disconnected_timeout_ms": 10000,
            "is_configured": False,
            "is_fallback": True,
            "socket_status": "STANDBY",
            "packets_received": 0,
            "bytes_received": 0,
            "transport_latency_ms": None,
            "connection_state": "DISCONNECTED",
            "transport": {},
            "system_network": {"os_platform": platform.system(), "detected_ip": "127.0.0.1"},
        }


@router.post("/api/config/network")
@router.post("/api/network/config")
async def update_network_config(req: NetworkConfigUpdate) -> Dict[str, Any]:
    """Updates network and transport configuration with dynamic socket rebinding."""
    data = req.model_dump(exclude_unset=True)
    if not data:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="No configuration fields provided for update",
        )
    try:
        updated = update_settings(**data)
        pipeline = get_pipeline()

        # Dynamically rebind socket if port or bind host changed
        rebound_stats = {}
        if pipeline and ("telemetry_port" in data or "gcs_bind_host" in data or "drone_ip" in data):
            try:
                rebound_stats = await pipeline.rebind_transport(
                    bind_host=updated.gcs_bind_host,
                    bind_port=updated.telemetry_port,
                    target_host=updated.drone_ip,
                    target_port=updated.telemetry_port,
                )
            except Exception as rebind_err:
                logger.warning(f"Socket rebind warning (continuing with saved config): {rebind_err}")

        return {
            "status": "updated",
            "config": {
                "gcs_ip": updated.gcs_ip,
                "gcs_bind_host": updated.gcs_bind_host,
                "drone_ip": updated.drone_ip,
                "subnet_mask": updated.subnet_mask,
                "telemetry_port": updated.telemetry_port,
                "telemetry_transport": updated.telemetry_transport,
                "operation_mode": updated.operation_mode,
                "stale_threshold_degraded_ms": updated.stale_threshold_degraded_ms,
                "stale_threshold_stale_ms": updated.stale_threshold_stale_ms,
                "disconnected_timeout_ms": updated.disconnected_timeout_ms,
            },
            "transport_stats": rebound_stats,
        }
    except Exception as e:
        logger.error(f"Configuration update failed: {e}", exc_info=True)
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail=f"Configuration update failed: {str(e)}",
        )
