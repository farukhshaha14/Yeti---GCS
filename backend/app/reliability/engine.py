"""Reliability and Verification Engine for VEGAPilot GCS.
Tracks source vs receive sequences, packet gaps, duplicates, out-of-order frames,
transport/processing latency, jitter, staleness, and dispatches retransmission recovery.
"""
import asyncio
import logging
import math
import time
from typing import Set, Dict, List, Optional, Tuple, Callable, Awaitable, Any
from app.config import get_settings
from app.models.telemetry import DataHealth

logger = logging.getLogger("vegapilot.reliability")


class TelemetryReliabilityEngine:
    """Manages telemetry integrity verification, gap detection, and recovery."""

    def __init__(self, mission_id: str = "DEFAULT-MISSION") -> None:
        self.mission_id = mission_id
        self.settings = get_settings()

        # Sequence counters
        self.receive_sequence_counter: int = 0
        self.highest_source_sequence: Optional[int] = None
        self.last_received_source_sequence: Optional[int] = None
        self._seen_source_sequences: Set[int] = set()

        # Gap and recovery records
        # Map: seq -> {"detected_at": ms, "status": "MISSING"|"RECOVERING"|"RECOVERED"|"UNRECOVERED", "recovered_at": ms}
        self.gaps: Dict[int, Dict[str, Any]] = {}
        self.gap_callbacks: List[Callable[[int, str, int], Awaitable[None]]] = []
        self.recovery_request_sender: Optional[Callable[[List[int]], Awaitable[None]]] = None

        # Counters
        self.received_packets_count: int = 0
        self.duplicate_packets_count: int = 0
        self.out_of_order_packets_count: int = 0
        self.invalid_packets_count: int = 0

        # Latency & Jitter metrics
        self.last_packet_received_at: Optional[int] = None
        self.last_transport_latency_ms: Optional[float] = None
        self.latency_samples: List[float] = []
        self.max_latency_ms: float = 0.0
        self.current_jitter_ms: float = 0.0
        self._prev_latency_sample: Optional[float] = None

    def register_gap_callback(self, cb: Callable[[int, str, int], Awaitable[None]]) -> None:
        self.gap_callbacks.append(cb)

    def set_recovery_sender(self, sender: Callable[[List[int]], Awaitable[None]]) -> None:
        self.recovery_request_sender = sender

    def process_incoming_packet(
        self,
        source_seq: Optional[int],
        source_timestamp: Optional[int],
        received_at_ms: int,
        is_valid: bool = True,
    ) -> Tuple[int, bool, bool, bool]:
        """Analyzes packet arrival for reliability metrics.
        Returns: (receive_seq, is_duplicate, is_out_of_order, is_recovered)
        """
        self.receive_sequence_counter += 1
        receive_seq = self.receive_sequence_counter
        self.received_packets_count += 1
        self.last_packet_received_at = received_at_ms

        if not is_valid:
            self.invalid_packets_count += 1
            return receive_seq, False, False, False

        # Calculate Latency & Jitter if source timestamp is reasonable
        if source_timestamp and source_timestamp > 0:
            transport_latency = max(0.0, float(received_at_ms - source_timestamp))
            self.last_transport_latency_ms = transport_latency
            self.latency_samples.append(transport_latency)
            if len(self.latency_samples) > 200:
                self.latency_samples.pop(0)

            if transport_latency > self.max_latency_ms:
                self.max_latency_ms = transport_latency

            if self._prev_latency_sample is not None:
                # RFC 3550 jitter calculation formula
                diff = abs(transport_latency - self._prev_latency_sample)
                self.current_jitter_ms += (diff - self.current_jitter_ms) / 16.0
            self._prev_latency_sample = transport_latency

        is_duplicate = False
        is_out_of_order = False
        is_recovered = False

        if source_seq is None:
            return receive_seq, is_duplicate, is_out_of_order, is_recovered

        # Check if this packet was in our missing gaps list -> RECOVERED!
        if source_seq in self.gaps and self.gaps[source_seq]["status"] in ("MISSING", "RECOVERING"):
            is_recovered = True
            gap_info = self.gaps[source_seq]
            gap_info["status"] = "RECOVERED"
            gap_info["recovered_at"] = received_at_ms
            logger.info(
                f"[RECOVERY] Packet #{source_seq} RECOVERED in {received_at_ms - gap_info['detected_at']}ms!"
            )
            # Notify callbacks
            for cb in self.gap_callbacks:
                asyncio.create_task(cb(source_seq, "RECOVERED", received_at_ms))

        # Check for duplicate
        if source_seq in self._seen_source_sequences:
            is_duplicate = True
            self.duplicate_packets_count += 1
            logger.warning(f"[RELIABILITY] Duplicate packet detected: seq #{source_seq}")
            return receive_seq, is_duplicate, is_out_of_order, is_recovered

        self._seen_source_sequences.add(source_seq)

        # Check out of order or gap
        if self.highest_source_sequence is None:
            self.highest_source_sequence = source_seq
        else:
            if source_seq < self.highest_source_sequence:
                is_out_of_order = True
                self.out_of_order_packets_count += 1
                logger.warning(
                    f"[RELIABILITY] Out-of-order packet: #{source_seq} (highest seen was #{self.highest_source_sequence})"
                )
            elif source_seq > self.highest_source_sequence + 1:
                # Packet Gap Detected!
                missing_range = list(range(self.highest_source_sequence + 1, source_seq))
                logger.warning(
                    f"[GAP DETECTED] Missing sequences: {missing_range} (highest: #{self.highest_source_sequence}, incoming: #{source_seq})"
                )
                for missing_seq in missing_range:
                    if missing_seq not in self.gaps:
                        self.gaps[missing_seq] = {
                            "detected_at": received_at_ms,
                            "status": "RECOVERING",
                            "recovered_at": None,
                        }
                        for cb in self.gap_callbacks:
                            asyncio.create_task(cb(missing_seq, "RECOVERING", received_at_ms))

                # Immediately trigger recovery request if sender configured
                if self.recovery_request_sender:
                    asyncio.create_task(self.recovery_request_sender(missing_range))

                self.highest_source_sequence = source_seq
            else:
                self.highest_source_sequence = source_seq

        self.last_received_source_sequence = source_seq
        return receive_seq, is_duplicate, is_out_of_order, is_recovered

    def get_data_health(self) -> DataHealth:
        """Computes live telemetry health metrics and connection staleness state."""
        now_ms = int(time.time() * 1000)

        # Staleness & Connection State determination
        if self.last_packet_received_at is None:
            status = "DISCONNECTED"
            age_ms = None
        else:
            age_ms = max(0, now_ms - self.last_packet_received_at)
            if age_ms < self.settings.stale_threshold_degraded_ms:
                status = "LIVE"
            elif age_ms < self.settings.stale_threshold_stale_ms:
                status = "DEGRADED"
            elif age_ms < self.settings.disconnected_timeout_ms:
                status = "STALE"
            else:
                status = "DISCONNECTED"

        # Check unrecovered gap timeouts (> 3000ms marked UNRECOVERED)
        for seq, info in self.gaps.items():
            if info["status"] in ("MISSING", "RECOVERING"):
                if now_ms - info["detected_at"] > 3000:
                    info["status"] = "UNRECOVERED"
                    for cb in self.gap_callbacks:
                        asyncio.create_task(cb(seq, "UNRECOVERED", now_ms))

        # Tally gaps
        total_missing_observed = len(self.gaps)
        recovered_count = sum(1 for g in self.gaps.values() if g["status"] == "RECOVERED")
        unrecovered_count = sum(1 for g in self.gaps.values() if g["status"] in ("MISSING", "RECOVERING", "UNRECOVERED"))

        # Calculate loss percentage: unrecovered / (received + unrecovered)
        total_expected = self.received_packets_count + unrecovered_count
        loss_pct = (unrecovered_count / total_expected * 100.0) if total_expected > 0 else 0.0

        avg_latency = (
            sum(self.latency_samples) / len(self.latency_samples)
            if self.latency_samples
            else None
        )

        return DataHealth(
            status=status,
            latency_ms=round(avg_latency, 2) if avg_latency is not None else None,
            transport_latency_ms=round(self.last_transport_latency_ms, 2) if self.last_transport_latency_ms else None,
            processing_latency_ms=None,
            packet_loss_percent=round(loss_pct, 3),
            received_packets=self.received_packets_count,
            missing_packets=total_missing_observed,
            recovered_packets=recovered_count,
            unrecovered_packets=unrecovered_count,
            duplicate_packets=self.duplicate_packets_count,
            out_of_order_packets=self.out_of_order_packets_count,
            invalid_packets=self.invalid_packets_count,
            jitter_ms=round(self.current_jitter_ms, 2),
            last_packet_age_ms=age_ms,
        )
