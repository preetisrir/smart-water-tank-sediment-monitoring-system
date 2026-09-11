# Smart Water Tank Sediment Monitoring and Automatic Control System

A complete IoT-ready web application for real-time water tank sediment monitoring, threshold alert notifications, and automated pipeline water supply control. Built in strict accordance with [srs.md](srs.md) and [REQUIREMENTS.md](REQUIREMENTS.md).

---

## 🌟 Key Features

- **Real-Time Sediment Monitoring (FR-01, FR-02, NFR-01)**:
  - Ingests and monitors tank sediment levels ($0\% - 100\%$) with $\le 3\text{s}$ telemetry refresh.
  - Interactive, physical cross-section water tank visualizer showing clean water and animated sediment accumulation layer.
- **Safe Sediment Limit Configuration (FR-03, NFR-03)**:
  - Configure safe sediment threshold ($1\% - 100\%$) with 100% role-based access control enforcement.
- **Automatic Alert Generation (FR-04, NFR-02)**:
  - Generates instant critical alerts within $5\text{s}$ whenever sediment exceeds the safe limit.
  - Interactive acknowledgment and lifecycle management.
- **Automated Water Supply Control (FR-05)**:
  - Automatically shuts off (`OFF`) the water supply when sediment breaches the threshold to prevent pipeline contamination.
  - Automatically restores flow (`ON`) when sediment returns to safe levels, with authorized manual emergency override.
- **Persistent SQLite Storage (FR-06, NFR-05)**:
  - Stores all sensor readings, generated alerts, and water supply state transitions in a local SQLite database (`tank_system.db`).
- **Complete CRUD & Full-Text Search**:
  - Search, filter, inspect, and delete historical sensor readings, alerts, and supply logs.
- **Operational Reports & CSV Export**:
  - Real-time analytical statistics: Average sediment, peak sediment, total shutoffs, and safety compliance rate.
  - Instant one-click RFC 4180 CSV export for sensor readings, alerts, and water supply history.
  - Clean print/PDF formatted view.
- **Hardware Sensor Simulator (NFR-01, NFR-02 Demo Tool)**:
  - Built-in background simulator generating realistic fluctuations every $3\text{s}$.
  - One-click instant scenario injection (Safe 28%, Warning 58%, Critical Spike 82.5%).

---

## 🏗️ System Architecture

```
smart-water-tank-sediment-monitoring-system/
├── backend/
│   ├── __init__.py
│   ├── auth.py              # JWT authentication & bcrypt security (NFR-03)
│   ├── crud.py              # SQLite database queries & business control logic
│   ├── database.py          # SQLite schema creation & seed data
│   ├── main.py              # FastAPI application & static file serving
│   ├── models.py            # Pydantic validation models
│   └── routes/
│       ├── alert_routes.py  # Alert endpoints (FR-04)
│       ├── auth_routes.py   # Login, profile, logout endpoints
│       ├── limit_routes.py  # Safe limit configuration (FR-03)
│       ├── report_routes.py # Summary metrics & CSV export
│       ├── sensor_routes.py # Sensor ingestion & history (FR-01, FR-02)
│       ├── simulator_routes.py # Live sensor simulation & injection
│       └── supply_routes.py # Automated supply control (FR-05, FR-06)
├── tests/
│   ├── __init__.py
│   └── test_api.py          # 20 automated tests verifying SRS compliance
├── index.html               # Modern responsive frontend dashboard
├── style.css                # Polished glassmorphic styling & tank visualizer
├── script.js                # Full REST API connectivity & real-time polling
├── srs.md                   # Original System Requirements Specification
├── REQUIREMENTS.md          # Formalized requirements and metrics document
├── README.md                # Setup, run, and user manual
└── tank_system.db           # Persistent SQLite database (auto-generated)
```

---

## 🚀 Getting Started

### Prerequisites
- **Python**: Version 3.10, 3.11, 3.12, or 3.13+
- **Browser**: Any modern browser (Chrome, Edge, Firefox, Safari)

### 1. Install Dependencies
Open PowerShell or your terminal in the project directory and run:

```bash
python -m pip install fastapi uvicorn pydantic python-multipart PyJWT bcrypt pytest httpx
```

### 2. Start the Application Server
Run the FastAPI application with Uvicorn:

```bash
python -m uvicorn backend.main:app --host 127.0.0.1 --port 8000 --reload
```

Alternatively, you can run directly with Python:
```bash
python -m backend.main
```

### 3. Open in Browser
Visit **[http://localhost:8000](http://localhost:8000)** to view the live dashboard.

Interactive Swagger API documentation is available at **[http://localhost:8000/docs](http://localhost:8000/docs)**.

---

## 🔐 Default User Credentials

In compliance with **NFR-03 (100% Access Control Enforcement)**, modifying the safe sediment threshold or issuing manual overrides requires authentication:

| Role | Username | Password | Permissions |
| :--- | :--- | :--- | :--- |
| **Administrator** | `admin` | `admin123` | Full access: configure safe limits, manual supply override, acknowledge alerts, CRUD record deletion, export reports. |
| **Operator** | `operator` | `operator123` | Operational access: monitor, acknowledge alerts, run simulations. |
| **Guest Viewer** | *(None)* | *(None)* | Read-only access: live dashboard, records inspection, reports. |

*Quick-login chips are embedded directly inside the login modal for effortless one-click switching.*

---

## 🧪 Running Automated Tests

A comprehensive test suite of 20 unit and integration tests verifies every functional requirement (FR-01 to FR-06) and non-functional requirement (NFR-01 to NFR-06):

```bash
python -m pytest tests/test_api.py -v
```

All 20 tests execute against an isolated temporary SQLite database and validate:
1. Health check & database bootstrapping.
2. JWT authentication, password hashing, and token verification.
3. Access-control enforcement on limit updates (NFR-03).
4. Sensor reading ingestion within valid bounds (0–100%).
5. Automatic alert creation when safe limit is breached (FR-04, NFR-02).
6. Immediate water supply shutoff on high sediment (FR-05).
7. Automatic water supply restoration when safe readings resume.
8. CRUD operations (Search, Filter, Pagination, Acknowledge, Delete).
9. Analytical report calculations and RFC 4180 CSV export.
10. Hardware simulator injection.

---

## 📊 SRS Traceability Matrix

| SRS ID | Description | Implementation File | Verification |
| :--- | :--- | :--- | :--- |
| **FR-01** | Ingest and record water tank sediment level | `backend/routes/sensor_routes.py` | `test_ingest_normal_sensor_reading` |
| **FR-02** | Display current sediment level on dashboard | `index.html`, `script.js`, `/api/sensor/latest` | `test_dashboard_latest_status` |
| **FR-03** | Set safe sediment level limit | `backend/routes/limit_routes.py` | `test_update_safe_limit_authorized` |
| **FR-04** | Generate alert when limit exceeded | `backend/crud.py`, `backend/routes/alert_routes.py` | `test_automatic_alert_and_supply_shutoff_when_exceeded` |
| **FR-05** | Automatically stop water supply when sediment too high | `backend/crud.py`, `backend/routes/supply_routes.py` | `test_automatic_alert_and_supply_shutoff_when_exceeded` |
| **FR-06** | Store sensor readings, alerts, and supply status in SQLite | `backend/database.py`, `tank_system.db` | All tests verified with SQLite queries |
| **NFR-01** | Latency $\le 3\text{s}$ for sensor updates | `script.js` 3s poll & SSE-ready simulator | Confirmed via live dashboard |
| **NFR-02** | Alert generation within $5\text{s}$ | `backend/crud.py` inline synchronous trigger | `test_automatic_alert_and_supply_shutoff_when_exceeded` |
| **NFR-03** | 100% access control enforcement for safe limit | `backend/auth.py` (`require_authorized_user`) | `test_update_safe_limit_unauthorized` |
| **NFR-04** | View sediment & supply in $\le 3$ clicks | Direct 1-click navigation in top header & dashboard | Verified via UI architecture |
| **NFR-05** | Store $\ge 99\%$ of valid readings | SQLite transactional atomic writes | Ingestion benchmark verified |
| **NFR-06** | Resume within $30\text{s}$ after restart | FastAPI lifespan auto-bootstrapping | Verified on server startup |

---

## 🛡️ License
Educational and project use. Designed for Kongu Engineering College.