"""MAVLink parser and normalization engine.
Converts raw telemetry byte streams into strongly typed normalized models.
Gracefully handles corrupted frames, dialects, and unsupported message types.
"""
import json
import logging
import math
import time
from typing import Optional, List, Dict, Any, Tuple
from pymavlink.dialects.v20 import common as mavlink2

logger = logging.getLogger("vegapilot.mavlink")


class MavlinkParser:
    """Robust streaming MAVLink v1/v2 parser."""

    def __init__(self) -> None:
        self.mav = mavlink2.MAVLink(None)
        # Disable signing checks for local offline MVP testbed
        self.mav.robust_parsing = True

    def parse_bytes(self, raw_bytes: bytes) -> List[Tuple[Any, Optional[Dict[str, Any]]]]:
        """Parse arbitrary incoming byte buffer.
        Returns a list of (raw_msg, dict_representation) tuples.
        """
        results = []
        try:
            # Check if this is an application JSON control/recovery frame
            if raw_bytes.strip().startswith(b"{") and raw_bytes.strip().endswith(b"}"):
                try:
                    payload = json.loads(raw_bytes.decode("utf-8"))
                    results.append(("JSON_FRAME", payload))
                    return results
                except Exception:
                    pass

            # Otherwise, parse using PyMAVLink
            messages = self.mav.parse_buffer(raw_bytes)
            if messages:
                for msg in messages:
                    if msg.get_type() == "BAD_DATA":
                        logger.warning(f"MAVLink BAD_DATA detected: {msg}")
                        results.append((msg, None))
                    else:
                        results.append((msg, msg.to_dict()))
        except Exception as e:
            logger.error(f"Error parsing incoming telemetry bytes: {e}")
            results.append(("CORRUPT_BYTES", None))

        return results


def extract_flight_mode(custom_mode: int, base_mode: int) -> str:
    """Map MAVLink base and custom modes into friendly human strings."""
    # Standard ArduPilot / PX4 mode mapping conventions
    modes_map = {
        0: "STABILIZE",
        1: "ACRO",
        2: "ALT_HOLD",
        3: "AUTO",
        4: "GUIDED",
        5: "LOITER",
        6: "RTL",
        7: "CIRCLE",
        9: "LAND",
        16: "POSHOLD",
        17: "BRAKE",
    }
    return modes_map.get(custom_mode, f"MODE_{custom_mode}")


def is_vehicle_armed(base_mode: int) -> bool:
    """Extract armed state from MAVLink base_mode bitmask."""
    return bool(base_mode & mavlink2.MAV_MODE_FLAG_SAFETY_ARMED)


def rad_to_deg(val: float) -> float:
    return round(val * (180.0 / math.pi), 2)
