"""Abstract base class for Telemetry Transports.
Enables pluggable physical wireless hardware layers (UDP, TCP, Serial, BLE)
without touching the reliability layer, parser, database, or UI.
"""
from abc import ABC, abstractmethod
from typing import Callable, Awaitable, Optional, Tuple, Dict, Any


# Callback type: (raw_bytes, sender_addr, received_at_ms)
PacketCallback = Callable[[bytes, Tuple[str, int], int], Awaitable[None]]


class TelemetryTransport(ABC):
    """Abstract interface for all GCS telemetry transport implementations."""

    def __init__(self) -> None:
        self._packet_callback: Optional[PacketCallback] = None
        self._is_running: bool = False

    def register_callback(self, callback: PacketCallback) -> None:
        """Register the async callback invoked whenever a telemetry packet arrives."""
        self._packet_callback = callback

    @abstractmethod
    async def start(self) -> None:
        """Initialize socket / connection and begin listening for incoming packets."""
        pass

    @abstractmethod
    async def stop(self) -> None:
        """Safely close socket / connection and free underlying resources."""
        pass

    @abstractmethod
    async def send(self, data: bytes, target_addr: Optional[Tuple[str, int]] = None) -> bool:
        """Send data (e.g. retransmission requests, heartbeat) back to the sender."""
        pass

    @property
    def is_running(self) -> bool:
        return self._is_running

    @abstractmethod
    def get_stats(self) -> Dict[str, Any]:
        """Return operational diagnostic statistics for the transport."""
        pass
