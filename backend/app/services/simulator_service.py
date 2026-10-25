"""Background managed simulator service for VEGAPilot GCS.
Enables starting, stopping, and injecting fault scenarios directly from the UI or tests.
"""
import asyncio
import logging
from typing import Optional, Dict, Any
from simulator.simulator import TelemetrySimulator

logger = logging.getLogger("vegapilot.service.simulator")


class ManagedSimulatorService:
    """Manages an in-process or background simulator instance for development and testing."""

    def __init__(self) -> None:
        self.simulator: Optional[TelemetrySimulator] = None
        self._task: Optional[asyncio.Task] = None
        self.is_active: bool = False
        self.rate_hz: float = 10.0

    async def start(
        self,
        target_host: str = "127.0.0.1",
        target_port: int = 14550,
        rate_hz: float = 10.0,
    ) -> bool:
        if self.is_active:
            return True

        self.rate_hz = rate_hz
        self.simulator = TelemetrySimulator(
            target_host=target_host,
            target_port=target_port,
            listen_port=14555,
        )
        self.simulator.start()
        self.is_active = True
        self._task = asyncio.create_task(self._loop())
        logger.info(f"Managed simulator active streaming to {target_host}:{target_port} at {rate_hz}Hz")
        return True

    async def stop(self) -> bool:
        if not self.is_active:
            return True

        self.is_active = False
        if self._task and not self._task.done():
            self._task.cancel()
        if self.simulator:
            self.simulator.stop()
        logger.info("Managed simulator stopped.")
        return True

    async def _loop(self) -> None:
        dt = 1.0 / self.rate_hz
        try:
            while self.is_active and self.simulator:
                self.simulator.generate_and_send_frame(dt)
                await asyncio.sleep(dt)
        except asyncio.CancelledError:
            pass
        except Exception as e:
            logger.error(f"Error in managed simulator loop: {e}")

    def inject_fault(self, mode: str, param: Optional[Any] = None) -> Dict[str, Any]:
        """Inject specific fault into running simulator."""
        if not self.simulator or not self.is_active:
            return {"status": "error", "message": "Simulator is not currently active"}

        mode = mode.lower()
        if mode == "gap":
            # Drop specific packet sequence
            seq = int(param) if param is not None else (self.simulator.sequence_number + 2)
            self.simulator.inject_gap(seq)
            return {"status": "ok", "action": "INJECT_GAP", "target_sequence": seq}

        elif mode == "duplicate":
            seq = int(param) if param is not None else (self.simulator.sequence_number + 1)
            self.simulator.inject_duplicate(seq)
            return {"status": "ok", "action": "INJECT_DUPLICATE", "target_sequence": seq}

        elif mode == "corrupt":
            self.simulator.corrupt_next_packet = True
            return {"status": "ok", "action": "INJECT_CORRUPTION"}

        elif mode == "loss_rate":
            rate = float(param) if param is not None else 0.05
            self.simulator.set_loss_rate(rate)
            return {"status": "ok", "action": "SET_LOSS_RATE", "rate": rate}

        elif mode == "out_of_order":
            seq = int(param) if param is not None else (self.simulator.sequence_number + 1)
            self.simulator.inject_out_of_order(seq)
            return {"status": "ok", "action": "INJECT_OUT_OF_ORDER", "target_sequence": seq}

        elif mode == "disconnect":
            self.simulator.set_disconnected(True)
            return {"status": "ok", "action": "DISCONNECT"}

        elif mode == "reconnect":
            self.simulator.set_disconnected(False)
            return {"status": "ok", "action": "RECONNECT"}

        return {"status": "error", "message": f"Unknown fault mode: {mode}"}

    def get_status(self) -> Dict[str, Any]:
        if not self.simulator:
            return {"is_active": False}
        return {
            "is_active": self.is_active,
            "sequence_number": self.simulator.sequence_number,
            "packet_loss_rate": self.simulator.packet_loss_rate,
            "is_disconnected": self.simulator.is_disconnected,
            "phase": self.simulator.flight.phase,
            "altitude_m": round(self.simulator.flight.altitude_m, 2),
            "battery_pct": round(self.simulator.flight.battery_pct, 1),
            "target": f"{self.simulator.target_host}:{self.simulator.target_port}",
        }


simulator_service = ManagedSimulatorService()


def get_simulator_service() -> ManagedSimulatorService:
    return simulator_service
