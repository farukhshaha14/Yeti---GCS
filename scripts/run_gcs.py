"""VEGAPilot GCS Unified Launcher Script.
Starts FastAPI backend with embedded web frontend and UDP telemetry transport.
"""
import os
import sys
import uvicorn

# Ensure root workspace and backend are in python path
root_dir = os.path.abspath(os.path.join(os.path.dirname(__file__), ".."))
backend_dir = os.path.join(root_dir, "backend")

if root_dir not in sys.path:
    sys.path.insert(0, root_dir)
if backend_dir not in sys.path:
    sys.path.insert(0, backend_dir)

from app.config import get_settings


def main():
    settings = get_settings()
    print("=" * 65)
    print(" VEGAPILOT GROUND CONTROL STATION (GCS) - OFFLINE MVP")
    print("=" * 65)
    print(f" Web & API UI Server : http://{settings.websocket_host}:{settings.websocket_port}")
    print(f" UDP Telemetry Port  : {settings.telemetry_port}")
    print(f" Target Drone IP     : {settings.drone_ip}")
    print(f" SQLite Database WAL : data/vegapilot.db")
    print("=" * 65)
    print("Starting server... Press Ctrl+C to terminate.")

    uvicorn.run(
        "app.main:app",
        host=settings.websocket_host,
        port=settings.websocket_port,
        reload=False,
    )


if __name__ == "__main__":
    main()
