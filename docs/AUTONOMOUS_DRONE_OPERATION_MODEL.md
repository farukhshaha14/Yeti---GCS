# Autonomous Drone Operation Model - VEGAPilot GCS

## Overview
The VEGAPilot drone is an autonomous aircraft. The flight controller/autopilot is solely responsible for executing the flight mission and making real-time flight-control decisions.

The Ground Control Station (GCS) is strictly a telemetry monitoring, reliability verification, mission observation, diagnostics, and historical recording system.

---

## 1. Primary Telemetry Direction

The primary data flow architecture is unidirectional for flight telemetry:

```
[ AIRCRAFT / DRONE ]
       │
       ▼ (MAVLink v2 binary frames)
[ Wireless Transport (Radio / Wi-Fi UDP) ]
       │
       ▼
[ GCS Backend Ingestion (UDP Port 14550) ]
       │
       ▼ (Telemetry Reliability & Verification Engine)
[ SQLite WAL Storage + Async Pipeline ]
       │
       ▼ (WebSocket Broadcast / REST API)
[ GCS Operator Cockpit (React UI) ]
```

The GCS continuously receives and processes telemetry without requiring the frontend to communicate directly with the drone.

---

## 2. Autonomous Flight Execution

The GCS **does not** assume that it is directly controlling the aircraft.

The autonomous flight controller independently executes:
* Autonomous Takeoff
* Climb & Transition
* Waypoint Navigation & Path Following
* Loiter & Cruise
* Return-to-Launch (RTL) / Geofence Execution
* Precision Landing
* Autopilot Flight-Mode Logic
* Hardware & Link Failsafe Behaviors

The GCS displays the authoritative state reported by the flight controller.

---

## 3. Strict Separation of Aircraft State vs. Communication State

The system maintains two completely independent concepts:

### A. Aircraft State (Authoritative: Flight Controller)
* Arm / Disarm Status (`ARMED` / `DISARMED`)
* Autopilot Flight Mode (`AUTO`, `GUIDED`, `LOITER`, `RTL`, `LAND`, `STABILIZE`)
* Active Mission & Waypoint Index
* Position (Latitude, Longitude)
* Altitude (MSL and Relative AGL)
* Ground Speed and Vertical Climb Rate
* Heading / Yaw, Pitch, Roll
* Battery Voltage, Current, and Estimated Remaining %
* GPS Fix Type and Satellite Count

### B. Communication State (Authoritative: GCS Reliability Engine)
* `CONNECTED` / `LIVE`: Packet received within acceptable nominal latency window (< 1.5s).
* `DEGRADED`: Packet arrival jitter or intermittent loss detected.
* `STALE`: No packet received within degraded threshold (e.g., 1.5s - 5.0s).
* `DISCONNECTED`: No packet received exceeding disconnect timeout (> 5.0s).
* `RECONNECTING` / `RECONNECTED`: Handshake / stream resumption in progress.

> [!IMPORTANT]
> **Never infer aircraft state solely from communication state.**  
> Example:  
> ```text
> AIRCRAFT STATE:       AUTO / ARMED / ALTITUDE 24.5 m / SPEED 12.0 m/s
> COMMUNICATION STATE:  DISCONNECTED (Data Age: 8.2 s)
> ```
> This indicates that 24.5 m and AUTO mode was the **last known verified aircraft state**, not that the aircraft has halted, disarmed, or crashed.

---

## 4. Telemetry Loss Behavior

When telemetry stream packets stop arriving:
1. **Preserve State**: Retain the last verified telemetry state in the UI and cache.
2. **Display Data Age**: Clearly render the elapsed age of the last verified packet (e.g., `8.4 s ago`).
3. **Mark Stale/Disconnected**: Visual status indicators transition from LIVE to STALE or DISCONNECTED.
4. **Log Communication Event**: Record link loss event with timestamp in SQLite database.
5. **No Synthetic Telemetry**: The GCS **must not** extrapolate, predict, or invent phantom coordinates.
6. **No Phantom Conclusions**: The GCS **must not** declare that the drone has stopped unless telemetry explicitly confirms that condition.
7. **No Silent Simulator Switching**: The GCS will never silently replace live telemetry with simulator data.

---

## 5. Bidirectional Communication & Command Boundaries

Telemetry ingestion and command dispatch are architecturally decoupled:

* **Telemetry (Continuous)**: `DRONE → GCS`
* **Recovery / Command (On-Demand)**: `GCS → DRONE`

Flight-control commands (e.g., takeoff, land, RTL) are strictly separated from telemetry observation and are not triggered implicitly.

---

## 6. Telemetry Recovery Communication

Telemetry recovery requests are dedicated protocols distinct from flight-control commands:

```text
[ GCS Reliability Engine ]
           │
           │ (Detects Sequence Gap, e.g., missing seq #104)
           ▼
[ Recovery Request Dispatched ]
           │
           ▼
[ Telemetry Sender / Retransmission Buffer ]
           │
           ▼
[ Retransmitted Telemetry Frame ]
           │
           ▼
[ GCS Engine Marks Packet #104 as RECOVERED ]
```

* Retransmission capability is optional on real hardware.
* If hardware does not support retransmission, the GCS still detects, tallies, and logs missing sequence gaps and records them as `UNRECOVERED` upon timeout.

---

## 7. Mission Authority: Execution vs. Monitoring

The GCS strictly distinguishes:
* **Mission Execution**: The autonomous flight controller is the sole authority for physical navigation and mission milestones.
* **Mission Monitoring**: The GCS database is authoritative for the historical telemetry log and packet audit observed by the ground station.

The GCS never claims a waypoint has been reached or an action performed merely because it was scheduled; confirmation requires explicit telemetry packets.

---

## 8. Communication Loss & Autonomous Safety

Loss of GCS telemetry is **not** synonymous with loss of aircraft control. In autonomous operation, the flight controller continues its programmed trajectory or executes its pre-configured failsafe.

When communication drops, the GCS displays:
```text
┌──────────────────────────────────────────────────────────────────┐
│  ⚠️  TELEMETRY LINK LOST - PRESERVING LAST KNOWN AIRCRAFT STATE  │
├──────────────────────────────────────────────────────────────────┤
│  LAST KNOWN POSITION:    19.876543° N, 75.343210° E             │
│  LAST KNOWN ALTITUDE:    24.5 m MSL (Rel: 24.5 m)                │
│  LAST KNOWN FLIGHT MODE: AUTO (ARMED)                           │
│  LAST KNOWN MISSION:     MIS-1728456200                         │
│  DATA AGE:               12.3 s                                 │
│  NOTE: Aircraft executing autonomous failsafe per autopilot config│
└──────────────────────────────────────────────────────────────────┘
```

---

## 9. Hardware Integration Checklist

Prior to physical flight operations, the integration team must verify and document:
* [ ] Autopilot behavior during telemetry link loss (Continue Mission, Loiter, or RTL).
* [ ] Wireless link loss detection timeout on flight controller.
* [ ] Flight controller failsafe configuration (RC loss, GCS loss, Low Battery).
* [ ] Return-to-Launch altitude and rally points.
* [ ] Autonomous mission continuation parameters.
* [ ] Reconnection and telemetry stream re-acquisition behavior.

---

## 10. Core Principle: Observe Reality, Never Invent It

The system enforces strict architectural boundaries between:
1. **WHAT THE DRONE LAST REPORTED** (Preserved flight controller state).
2. **WHETHER THE GCS IS CURRENTLY RECEIVING DATA** (Socket and transport link health).
3. **WHAT COMMANDS THE GCS HAS REQUESTED** (Operator or recovery requests).

These three concepts remain distinct across the backend data model, database records, and cockpit UI.
