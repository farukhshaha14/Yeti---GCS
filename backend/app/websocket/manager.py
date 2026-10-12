"""WebSocket Connection Manager for streaming telemetry and events to UI clients."""
import asyncio
import json
import logging
from typing import List, Dict, Any
from fastapi import WebSocket, WebSocketDisconnect

logger = logging.getLogger("vegapilot.websocket")


class TelemetryWebSocketManager:
    """Manages active browser connections and broadcasts JSON telemetry frames."""

    def __init__(self) -> None:
        self.active_connections: List[WebSocket] = []
        self._lock = asyncio.Lock()

    async def connect(self, websocket: WebSocket) -> None:
        await websocket.accept()
        async with self._lock:
            self.active_connections.append(websocket)
        logger.info(f"WebSocket client connected. Total clients: {len(self.active_connections)}")

    async def disconnect(self, websocket: WebSocket) -> None:
        async with self._lock:
            if websocket in self.active_connections:
                self.active_connections.remove(websocket)
        logger.info(f"WebSocket client disconnected. Total clients: {len(self.active_connections)}")

    async def broadcast(self, message: Dict[str, Any]) -> None:
        """Broadcast payload to all active clients concurrently."""
        if not self.active_connections:
            return

        payload_text = json.dumps(message)
        dead_connections = []

        async with self._lock:
            connections = list(self.active_connections)

        for connection in connections:
            try:
                await connection.send_text(payload_text)
            except Exception as e:
                logger.debug(f"Error sending to WebSocket client: {e}")
                dead_connections.append(connection)

        if dead_connections:
            async with self._lock:
                for dead in dead_connections:
                    if dead in self.active_connections:
                        self.active_connections.remove(dead)

    @property
    def client_count(self) -> int:
        return len(self.active_connections)


ws_manager = TelemetryWebSocketManager()


def get_ws_manager() -> TelemetryWebSocketManager:
    return ws_manager
