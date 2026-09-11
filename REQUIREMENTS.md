# System Requirements Specification (SRS) & Requirements Document

## Smart Water Tank Sediment Monitoring and Automatic Control System

---

## 1. Project Overview & Scope

### 1.1 Purpose
The Smart Water Tank Sediment Monitoring and Automatic Control System is an automated IoT and web application designed to monitor sediment levels in a water tank in real-time, generate alerts when sediment exceeds safety thresholds, and automatically shut off the water supply to prevent sediment-contaminated water from entering pipelines. The application uses Python (FastAPI) for backend logic, SQLite for embedded persistence, and a responsive modern web dashboard for monitoring and control.

### 1.2 System Scope
- **IN-SCOPE**:
  1. Real-time monitoring and recording of water tank sediment levels (0% – 100%).
  2. Visual dashboard displaying live sediment percentage, safe limit status, and water supply state.
  3. Safe sediment level limit configuration with authorized role-based access control.
  4. Real-time alert generation and notification when the sediment level exceeds the safe limit.
  5. Automatic water supply shutoff (`OFF`) when sediment exceeds the safe limit, and restoration/override capability.
  6. Persistent storage of sensor readings, alerts, and water supply status history in SQLite.
  7. CRUD operations (View, Search, Filter, Delete, Export) across stored readings, alerts, and supply logs.
  8. Analytical reports and CSV data export for operational audits.
- **OUT-OF-SCOPE** (Explicitly excluded by SRS):
  - Automatic physical tank cleaning mechanisms.
  - Chemical composition or biological water quality analysis.
  - Native mobile application development (responsive web application used).
  - Cloud-based data storage (local SQLite database utilized).
  - Predictive AI sediment modeling.

---

## 2. Functional Requirements (FR)

| ID | Requirement | Description |
| :--- | :--- | :--- |
| **FR-01** | **Sediment Monitoring & Recording** | The system shall ingest, monitor, and record water tank sediment levels (percentage) with precise timestamps. |
| **FR-02** | **Dashboard Display** | The system shall display the current sediment level, safe threshold, alert status, and water supply status on a central dashboard. |
| **FR-03** | **Safe Sediment Limit Configuration** | The system shall allow authorized operators/administrators to configure and update the safe sediment limit (1% – 100%). |
| **FR-04** | **Alert Generation** | The system shall automatically trigger an alert whenever a sensor reading exceeds the configured safe limit. |
| **FR-05** | **Automatic Water Supply Control** | The system shall automatically shut off the water supply (`OFF`) when the sediment level exceeds the safe limit, preventing contamination. |
| **FR-06** | **Persistent SQLite Storage** | The system shall record all sensor readings, alert incidents, and water supply state transitions in an SQLite database. |

---

## 3. Non-Functional Requirements (NFR)

| ID | Category | Requirement Description | Target Metric |
| :--- | :--- | :--- | :--- |
| **NFR-01** | **Speed (Latency)** | The system shall display new sensor readings within 3 seconds of receiving them. | $\le 3$ seconds |
| **NFR-02** | **Speed (Alerts)** | The system shall generate and present an alert within 5 seconds after detecting that sediment exceeds the limit. | $\le 5$ seconds |
| **NFR-03** | **Security & Access Control** | The system shall restrict configuration of the sediment limit and manual override to authorized users with 100% access-control enforcement. | 100% RBAC enforcement |
| **NFR-04** | **Usability** | A user shall be able to view the current sediment level and water supply status within 3 clicks from any page. | $\le 3$ clicks |
| **NFR-05** | **Reliability** | The system shall successfully store at least 99% of valid sensor readings received during normal operation. | $\ge 99\%$ success rate |
| **NFR-06** | **Availability & Recovery** | The system shall resume normal operation within 30 seconds after an application restart. | $\le 30$ seconds MTTR |

---

## 4. User Roles and Permissions

1. **Guest / Public Viewer**:
   - View live dashboard metrics and status.
   - View sensor readings, alerts, and supply history.
   - Search and filter records.
   - View summary reports.
   - *Cannot* modify safe sediment limits or override supply controls.

2. **Operator** (`operator` / `operator123`):
   - All Guest capabilities.
   - Acknowledge alerts.
   - Trigger simulator readings.

3. **Authorized Administrator** (`admin` / `admin123`):
   - All Operator capabilities.
   - Configure and update the safe sediment level limit (FR-03, NFR-03).
   - Manually toggle/override water supply when required.
   - Perform CRUD deletions / maintenance on historical records.
   - Export comprehensive CSV reports.

---

## 5. Data Models & Validation Rules

- **Sediment Level**: Valid numeric range $0.0 \le \text{level} \le 100.0\%$.
- **Safe Limit**: Valid integer or float range $1.0 \le \text{limit} \le 100.0\%$.
- **Status Classification**:
  - `NORMAL`: $\text{Sediment Level} < \text{Safe Limit} \times 0.75$
  - `WARNING`: $\text{Safe Limit} \times 0.75 \le \text{Sediment Level} \le \text{Safe Limit}$
  - `CRITICAL`: $\text{Sediment Level} > \text{Safe Limit}$ (Triggers Alert & Supply Shutoff)
- **Supply Status**: Enum `['ON', 'OFF']`.
