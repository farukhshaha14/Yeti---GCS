"""UDP Telemetry Transport implementation using asyncio DatagramProtocol.
Listens on GCS_BIND_HOST:TELEMETRY_PORT (0.0.0.0:14550) and handles packet I/O.
"""
import asyncio
import logging
import time
from typing import Optional, Tuple, Dict, Any
from app.transport.base import TelemetryTransport, PacketCallback

logger = logging.getLogger("vegapilot.transport.udp")


class _UdpProtocol(asyncio.DatagramProtocol):
    def __init__(self, transport_instance: "UdpTelemetryTransport") -> None:
        self.transport_instance = transport_instance

    def connection_made(self, transport: asyncio.DatagramTransport) -> None:
        self.transport_instance._asyncio_transport = transport
        self.transport_instance._socket_state = "OPEN"
        logger.info(
            f"UDP listener active on {self.transport_instance.bind_host}:{self.transport_instance.bind_port}"
        )

    def datagram_received(self, data: bytes, addr: Tuple[str, int]) -> None:
        recv_ms = int(time.time() * 1000)
        self.transport_instance._record_packet_in(data, addr, recv_ms)

    def error_received(self, exc: Exception) -> None:
        logger.warning(f"UDP transport error received: {exc}")
        self.transport_instance._error_count += 1

    def connection_lost(self, exc: Optional[Exception]) -> None:
        logger.info(f"UDP socket closed: {exc}")
        self.transport_instance._socket_state = "CLOSED"


class UdpTelemetryTransport(TelemetryTransport):
    """Asynchronous UDP transport implementation for MAVLink/GCS telemetry."""

    def __init__(
        self,
        bind_host: str = "0.0.0.0",
        bind_port: int = 14550,
        default_target_host: str = "192.168.50.10",
        default_target_port: int = 14550,
    ) -> None:
        super().__init__()
        self.bind_host = bind_host
        self.bind_port = bind_port
        self.default_target_host = default_target_host
        self.default_target_port = default_target_port

        self._asyncio_transport: Optional[asyncio.DatagramTransport] = None
        self._protocol: Optional[_UdpProtocol] = None
        self._socket_state: str = "CLOSED"

        # Diagnostics & Health counters
        self._packets_received: int = 0
        self._bytes_received: int = 0
        self._packets_sent: int = 0
        self._bytes_sent: int = 0
        self._last_received_ms: Optional[int] = None
        self._last_sender_addr: Optional[Tuple[str, int]] = None
        self._error_count: int = 0

    async def start(self) -> None:
        """Start listening on the configured UDP port."""
        if self._is_running:
            return

        loop = asyncio.get_running_loop()
        self._socket_state = "BINDING"
        try:
            transport, protocol = await loop.create_datagram_endpoint(
                lambda: _UdpProtocol(self),
                local_addr=(self.bind_host, self.bind_port),
                reuse_port=False,
            )
            self._asyncio_transport = transport
            self._protocol = protocol
            self._is_running = True
            self._socket_state = "OPEN"

            # Optimize OS UDP socket receive buffer to 1MB for telemetry bursts
            sock = transport.get_extra_info("socket")
            if sock:
                import socket
                try:
                    sock.setsockopt(socket.SOL_SOCKET, socket.SO_RCVBUF, 1024 * 1024)
                except Exception as e:
                    logger.debug(f"Could not set SO_RCVBUF: {e}")
        except Exception as e:
            self._socket_state = f"ERROR: {str(e)}"
            logger.error(f"Failed to bind UDP port {self.bind_port} on {self.bind_host}: {e}")
            raise

    async def stop(self) -> None:
        """Close the UDP listener."""
        self._is_running = False
        if self._asyncio_transport and not self._asyncio_transport.is_closing():
            self._asyncio_transport.close()
        self._socket_state = "CLOSED"
        logger.info("UDP Telemetry transport stopped.")

    async def rebind(
        self,
        bind_host: Optional[str] = None,
        bind_port: Optional[int] = None,
        default_target_host: Optional[str] = None,
        default_target_port: Optional[int] = None,
    ) -> None:
        """Dynamically rebind the UDP transport socket without stopping the whole server."""
        await self.stop()
        if bind_host is not None:
            self.bind_host = bind_host
        if bind_port is not None:
            self.bind_port = bind_port
        if default_target_host is not None:
            self.default_target_host = default_target_host
        if default_target_port is not None:
            self.default_target_port = default_target_port
        await self.start()
        logger.info(f"UDP transport successfully rebound to {self.bind_host}:{self.bind_port}")

    def _record_packet_in(self, data: bytes, addr: Tuple[str, int], recv_ms: int) -> None:
        self._packets_received += 1
        self._bytes_received += len(data)
        self._last_received_ms = recv_ms
        self._last_sender_addr = addr

        if self._packet_callback:
            # Schedule execution of callback without blocking datagram receipt
            asyncio.create_task(self._packet_callback(data, addr, recv_ms))

    async def send(self, data: bytes, target_addr: Optional[Tuple[str, int]] = None) -> bool:
        """Transmit data back to remote endpoint (defaulting to drone host:port)."""
        if not self._asyncio_transport or self._asyncio_transport.is_closing():
            logger.warning("Attempted to send over closed UDP transport.")
            return False

        addr = target_addr or (self.default_target_host, self.default_target_port)
        try:
            self._asyncio_transport.sendto(data, addr)
            self._packets_sent += 1
            self._bytes_sent += len(data)
            return True
        except Exception as e:
            logger.error(f"Failed to send UDP packet to {addr}: {e}")
            self._error_count += 1
            return False

    def get_stats(self) -> Dict[str, Any]:
        return {
            "transport_type": "UDP",
            "is_running": self._is_running,
            "socket_state": self._socket_state,
            "bind_host": self.bind_host,
            "bind_port": self.bind_port,
            "default_target": f"{self.default_target_host}:{self.default_target_port}",
            "packets_received": self._packets_received,
            "bytes_received": self._bytes_received,
            "packets_sent": self._packets_sent,
            "bytes_sent": self._bytes_sent,
            "last_received_ms": self._last_received_ms,
            "last_sender": f"{self._last_sender_addr[0]}:{self._last_sender_addr[1]}" if self._last_sender_addr else None,
            "errors": self._error_count,
        }
