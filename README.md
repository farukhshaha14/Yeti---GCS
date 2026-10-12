# VEGAPilot Ground Control Station (GCS) - Offline MVP

An offline Ground Control Station (GCS) telemetry receiver and reliability engineering platform built with FastAPI, SQLite WAL, React 19, Vite, and Tailwind CSS.

---

## Key Features

1. **Robust UDP Telemetry & MAVLink v2 Ingestion**:
   - Ingestion of MAVLink frames (`HEARTBEAT`, `ATTITUDE`, `GLOBAL_POSITION_INT`, `SYS_STATUS`, `VFR_HUD`) over UDP (port `14550`).
   - Pluggable transport layer (`TelemetryTransport`) supporting UDP and mock implementations.

2. **Telemetry Reliability & Verification Engine**:
   - Source vs. receive sequence tracking.
   - Gap detection, missing packet isolation, out-of-order detection, and duplicate filtering.
   - Retransmission recovery with automatic timeout handling (`RECOVERED` vs. `UNRECOVERED`).
   - Real-time network health metrics: packet loss %, latency, jitter, and staleness monitoring (`LIVE`, `DEGRADED`, `STALE`, `DISCONNECTED`).

3. **High-Performance Persistence & Session Recording**:
   - Asynchronous SQLite storage with Write-Ahead Logging (WAL) mode enabled for concurrency.
   - Mission management (active mission switching, flight log export).
   - Packet logging with full payload inspection.

4. **Modern Mission Cockpit Web UI**:
   - **Flight PFD**: Artificial horizon, airspeed, altitude, compass rose, battery, GPS fix, and telemetry health readouts.
   - **Offline Moving Map**: Real-time breadcrumb trail tracking and coordinate markers.
   - **Mission Control**: Mission switching, flight recording, and flight log downloads.
   - **Telemetry Logs**: Filterable packet-level inspection table with JSON payload modal.
   - **Network Diagnostics & Testbench**: Real-time socket health, simulator control (start/stop), and fault injection (packet loss, burst drop, reordering, duplicate burst, disconnect/reconnect).
   - **Network Settings**: Configuration for IP bindings, ports, and staleness thresholds.

---

## Directory Structure

```
├── backend/
│   ├── app/
│   │   ├── api/            # REST and WebSocket endpoints
│   │   ├── database/       # SQLite models and async session management
│   │   ├── mavlink/        # MAVLink parser & normalizer
│   │   ├── models/         # Pydantic telemetry models
│   │   ├── reliability/    # Sequence tracking, gap detection & recovery
│   │   ├── services/       # Simulator & mission services
│   │   ├── transport/      # UDP and mock socket abstractions
│   │   └── websocket/      # Broadcast connection manager
├── frontend/               # React 19 + TypeScript + Vite + Tailwind CSS UI
├── simulator/              # Realistic quadrotor flight simulator & fault injector
├── scripts/                # Unified launcher scripts
├── tests/                  # Pytest unit, reliability & E2E integration test suite
└── pytest.ini              # Pytest configuration
```

---

## Running the Application

### 1. Unified GCS Server (Backend + Built-in Web UI)

Activate the Python virtual environment and run:

```powershell
.\.venv\Scripts\python scripts/run_gcs.py
```

- Open your browser to: **`http://localhost:8000`**
- The web UI will load immediately with the live dashboard.

### 2. Built-in Telemetry Simulator

You can control the simulator directly from the **Diagnostics & Simulator** tab in the Web UI:
- Click **Start Simulator** to begin broadcasting simulated 10 Hz telemetry.
- Use the **Fault Injection** buttons to simulate packet drops, burst losses, duplicates, out-of-order frames, or disconnects to observe the reliability engine and recovery system in real time.

Alternatively, run the simulator standalone in a separate terminal:
```powershell
.\.venv\Scripts\python scripts/run_simulator.py 10.0
```

---

## Running Tests

To run the full automated verification test suite:

```powershell
.\.venv\Scripts\pytest
```

All 9 reliability and E2E integration tests will run and validate sequential delivery, gap detection, duplicates, out-of-order frames, corruption rejection, and recovery.
