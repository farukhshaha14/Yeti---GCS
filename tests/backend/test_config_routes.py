"""Tests for network configuration and status endpoints."""
import pytest
from httpx import AsyncClient, ASGITransport
from app.main import app


@pytest.mark.asyncio
async def test_get_network_config_success():
    transport = ASGITransport(app=app)
    async with AsyncClient(transport=transport, base_url="http://test") as client:
        resp = await client.get("/api/config/network")
        assert resp.status_code == 200
        data = resp.json()
        assert "gcs_ip" in data
        assert "drone_ip" in data
        assert "telemetry_port" in data
        assert "system_network" in data
        assert "socket_status" in data


@pytest.mark.asyncio
async def test_get_network_status_alias():
    transport = ASGITransport(app=app)
    async with AsyncClient(transport=transport, base_url="http://test") as client:
        resp = await client.get("/api/network/status")
        assert resp.status_code == 200
        data = resp.json()
        assert "gcs_ip" in data
        assert "telemetry_port" in data


@pytest.mark.asyncio
async def test_update_network_config_valid():
    transport = ASGITransport(app=app)
    async with AsyncClient(transport=transport, base_url="http://test") as client:
        payload = {
            "gcs_ip": "192.168.50.25",
            "drone_ip": "192.168.50.15",
            "telemetry_port": 14552,
        }
        resp = await client.post("/api/config/network", json=payload)
        assert resp.status_code == 200
        data = resp.json()
        assert data["status"] == "updated"
        assert data["config"]["gcs_ip"] == "192.168.50.25"
        assert data["config"]["telemetry_port"] == 14552


@pytest.mark.asyncio
async def test_update_network_config_empty_payload():
    transport = ASGITransport(app=app)
    async with AsyncClient(transport=transport, base_url="http://test") as client:
        resp = await client.post("/api/config/network", json={})
        assert resp.status_code == 400
