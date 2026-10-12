"""Standalone CLI Runner for VEGAPilot Telemetry Simulator."""
import asyncio
import os
import sys

root_dir = os.path.abspath(os.path.join(os.path.dirname(__file__), ".."))
backend_dir = os.path.join(root_dir, "backend")

if root_dir not in sys.path:
    sys.path.insert(0, root_dir)
if backend_dir not in sys.path:
    sys.path.insert(0, backend_dir)

from simulator.simulator import TelemetrySimulator


def main():
    rate_hz = 10.0
    if len(sys.argv) > 1:
        try:
            rate_hz = float(sys.argv[1])
        except ValueError:
            pass

    print(f"Starting standalone VEGAPilot Telemetry Simulator at {rate_hz} Hz...")
    sim = TelemetrySimulator(rate_hz=rate_hz)
    try:
        asyncio.run(sim.start())
    except KeyboardInterrupt:
        print("\nSimulator stopped by user.")


if __name__ == "__main__":
    main()
