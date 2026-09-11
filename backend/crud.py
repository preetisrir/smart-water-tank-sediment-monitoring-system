"""CRUD Operations and Core Business Logic for Smart Water Tank System."""

import csv
import io
import sqlite3
from datetime import datetime, timezone
from typing import Any, Dict, List, Optional, Tuple


def get_current_timestamp() -> str:
    return datetime.now(timezone.utc).isoformat()


# --- Safe Sediment Limit Logic (FR-03, NFR-03) ---

def get_safe_limit(conn: sqlite3.Connection) -> float:
    cursor = conn.cursor()
    cursor.execute("SELECT value FROM settings WHERE key = 'safe_sediment_limit'")
    row = cursor.fetchone()
    if row:
        try:
            return float(row["value"])
        except (ValueError, TypeError):
            return 70.0
    return 70.0


def set_safe_limit(conn: sqlite3.Connection, new_limit: float, updated_by: str) -> Dict[str, Any]:
    now_str = get_current_timestamp()
    cursor = conn.cursor()
    cursor.execute(
        """INSERT INTO settings (key, value, updated_at, updated_by)
           VALUES ('safe_sediment_limit', ?, ?, ?)
           ON CONFLICT(key) DO UPDATE SET 
               value = excluded.value, 
               updated_at = excluded.updated_at, 
               updated_by = excluded.updated_by""",
        (str(new_limit), now_str, updated_by)
    )

    # Re-evaluate latest sensor reading against the newly set limit
    latest = get_latest_reading(conn)
    if latest:
        current_sediment = latest["sediment_level"]
        supply_info = get_supply_status(conn)
        current_supply = supply_info["status"]
        control_mode = supply_info["control_mode"]

        if control_mode == "AUTOMATIC":
            if current_sediment > new_limit and current_supply == "ON":
                # Exceeded new stricter limit: generate alert and stop supply
                cursor.execute(
                    """INSERT INTO alerts 
                       (timestamp, sediment_level, limit_at_time, severity, message, acknowledged)
                       VALUES (?, ?, ?, 'CRITICAL', ?, 0)""",
                    (now_str, current_sediment, new_limit,
                     f"Safe limit lowered to {new_limit}%. Current sediment ({current_sediment}%) exceeds safe threshold.")
                )
                set_supply_status(
                    conn,
                    "OFF",
                    current_sediment,
                    f"Automatic shutoff: safe limit lowered to {new_limit}%, sediment is {current_sediment}%",
                    "AUTOMATIC"
                )
            elif current_sediment <= new_limit and current_supply == "OFF":
                # Safe under new relaxed limit: restore supply
                set_supply_status(
                    conn,
                    "ON",
                    current_sediment,
                    f"Automatic restore: safe limit raised to {new_limit}%, sediment is safe ({current_sediment}%)",
                    "AUTOMATIC"
                )

    conn.commit()
    return {
        "safe_limit": new_limit,
        "updated_at": now_str,
        "updated_by": updated_by
    }


# --- Water Supply Logic (FR-05, FR-06) ---

def get_supply_status(conn: sqlite3.Connection) -> Dict[str, Any]:
    cursor = conn.cursor()
    cursor.execute("SELECT value, updated_at FROM settings WHERE key = 'water_supply_status'")
    status_row = cursor.fetchone()
    current_status = status_row["value"] if status_row else "ON"
    updated_at = status_row["updated_at"] if status_row else get_current_timestamp()

    cursor.execute("SELECT value FROM settings WHERE key = 'control_mode'")
    mode_row = cursor.fetchone()
    control_mode = mode_row["value"] if mode_row else "AUTOMATIC"

    cursor.execute("SELECT reason, sediment_level FROM supply_logs ORDER BY id DESC LIMIT 1")
    log_row = cursor.fetchone()
    last_reason = log_row["reason"] if log_row else "Normal operating state"
    last_sediment = log_row["sediment_level"] if log_row else 0.0

    safe_limit = get_safe_limit(conn)

    return {
        "status": current_status,
        "sediment_level": last_sediment,
        "safe_limit": safe_limit,
        "control_mode": control_mode,
        "last_reason": last_reason,
        "updated_at": updated_at
    }


def set_supply_status(
    conn: sqlite3.Connection,
    status: str,
    sediment_level: float,
    reason: str,
    triggered_by: str,
    mode: Optional[str] = None
) -> None:
    now_str = get_current_timestamp()
    cursor = conn.cursor()

    cursor.execute(
        """INSERT INTO settings (key, value, updated_at, updated_by)
           VALUES ('water_supply_status', ?, ?, ?)
           ON CONFLICT(key) DO UPDATE SET 
               value = excluded.value, 
               updated_at = excluded.updated_at, 
               updated_by = excluded.updated_by""",
        (status, now_str, triggered_by)
    )

    if mode:
        cursor.execute(
            """INSERT INTO settings (key, value, updated_at, updated_by)
               VALUES ('control_mode', ?, ?, ?)
               ON CONFLICT(key) DO UPDATE SET 
                   value = excluded.value, 
                   updated_at = excluded.updated_at, 
                   updated_by = excluded.updated_by""",
            (mode, now_str, triggered_by)
        )

    cursor.execute(
        """INSERT INTO supply_logs (timestamp, status, sediment_level, reason, triggered_by)
           VALUES (?, ?, ?, ?, ?)""",
        (now_str, status, sediment_level, reason, triggered_by)
    )


# --- Sensor Readings & Automatic Control (FR-01, FR-02, FR-04, FR-05, FR-06) ---

def add_sensor_reading(
    conn: sqlite3.Connection,
    sediment_level: float,
    timestamp: Optional[str] = None
) -> Dict[str, Any]:
    """
    Ingest a new sediment sensor reading.
    Evaluates safe limit:
    - If sediment > safe_limit: triggers alert (FR-04, NFR-02) and shuts off supply (FR-05).
    - If sediment <= safe_limit: restores supply if in automatic mode.
    - Records in SQLite (FR-06, NFR-05).
    """
    if not timestamp:
        timestamp = get_current_timestamp()

    safe_limit = get_safe_limit(conn)
    cursor = conn.cursor()

    # Determine status
    if sediment_level > safe_limit:
        status = "CRITICAL"
    elif sediment_level >= safe_limit * 0.75:
        status = "WARNING"
    else:
        status = "NORMAL"

    supply_info = get_supply_status(conn)
    current_supply = supply_info["status"]
    control_mode = supply_info["control_mode"]

    alert_created = False
    alert_id = None
    supply_changed = False

    # Check safe limit threshold
    if status == "CRITICAL":
        # Generate alert (FR-04, NFR-02)
        message = (
            f"ALERT: Tank sediment level ({sediment_level:.1f}%) exceeds "
            f"safe limit ({safe_limit:.1f}%). Contamination risk detected."
        )
        cursor.execute(
            """INSERT INTO alerts 
               (timestamp, sediment_level, limit_at_time, severity, message, acknowledged)
               VALUES (?, ?, ?, 'CRITICAL', ?, 0)""",
            (timestamp, sediment_level, safe_limit, message)
        )
        alert_id = cursor.lastrowid
        alert_created = True

        # Automatic supply shutoff (FR-05)
        if control_mode == "AUTOMATIC" and current_supply != "OFF":
            set_supply_status(
                conn,
                "OFF",
                sediment_level,
                f"Automatic shutoff: sediment ({sediment_level:.1f}%) exceeded safe limit ({safe_limit:.1f}%)",
                "AUTOMATIC"
            )
            current_supply = "OFF"
            supply_changed = True

    elif status in ("NORMAL", "WARNING"):
        # If in automatic mode and water supply was turned off by high sediment, resume supply
        if control_mode == "AUTOMATIC" and current_supply == "OFF":
            # Check last shutoff reason
            last_reason = supply_info.get("last_reason", "")
            if "Automatic shutoff" in last_reason or "exceeded safe limit" in last_reason:
                set_supply_status(
                    conn,
                    "ON",
                    sediment_level,
                    f"Automatic restore: sediment level ({sediment_level:.1f}%) is safe (< {safe_limit:.1f}%)",
                    "AUTOMATIC"
                )
                current_supply = "ON"
                supply_changed = True

    # Record reading in SQLite (FR-01, FR-06)
    cursor.execute(
        """INSERT INTO sensor_readings 
           (timestamp, sediment_level, limit_at_time, status, supply_status)
           VALUES (?, ?, ?, ?, ?)""",
        (timestamp, sediment_level, safe_limit, status, current_supply)
    )
    reading_id = cursor.lastrowid
    conn.commit()

    return {
        "id": reading_id,
        "timestamp": timestamp,
        "sediment_level": sediment_level,
        "limit_at_time": safe_limit,
        "status": status,
        "supply_status": current_supply,
        "alert_created": alert_created,
        "alert_id": alert_id,
        "supply_changed": supply_changed
    }


def get_sensor_readings(
    conn: sqlite3.Connection,
    search: Optional[str] = None,
    status: Optional[str] = None,
    page: int = 1,
    size: int = 25
) -> Tuple[List[Dict[str, Any]], int]:
    cursor = conn.cursor()
    query = "SELECT * FROM sensor_readings WHERE 1=1"
    params: List[Any] = []

    if search:
        query += " AND (timestamp LIKE ? OR CAST(sediment_level AS TEXT) LIKE ? OR status LIKE ? OR supply_status LIKE ?)"
        term = f"%{search}%"
        params.extend([term, term, term, term])

    if status and status.upper() != "ALL":
        query += " AND status = ?"
        params.append(status.upper())

    # Count query
    count_query = f"SELECT COUNT(*) FROM ({query})"
    cursor.execute(count_query, params)
    total = cursor.fetchone()[0]

    # Paginated query
    query += " ORDER BY id DESC LIMIT ? OFFSET ?"
    params.extend([size, (page - 1) * size])

    cursor.execute(query, params)
    rows = [dict(row) for row in cursor.fetchall()]
    return rows, total


def get_latest_reading(conn: sqlite3.Connection) -> Optional[Dict[str, Any]]:
    cursor = conn.cursor()
    cursor.execute("SELECT * FROM sensor_readings ORDER BY id DESC LIMIT 1")
    row = cursor.fetchone()
    return dict(row) if row else None


def delete_sensor_reading(conn: sqlite3.Connection, reading_id: int) -> bool:
    cursor = conn.cursor()
    cursor.execute("DELETE FROM sensor_readings WHERE id = ?", (reading_id,))
    conn.commit()
    return cursor.rowcount > 0


def clear_sensor_readings(conn: sqlite3.Connection) -> int:
    cursor = conn.cursor()
    cursor.execute("DELETE FROM sensor_readings")
    deleted = cursor.rowcount
    conn.commit()
    return deleted


# --- Alerts Operations (FR-04, FR-06) ---

def get_alerts(
    conn: sqlite3.Connection,
    search: Optional[str] = None,
    severity: Optional[str] = None,
    page: int = 1,
    size: int = 50
) -> Tuple[List[Dict[str, Any]], int]:
    cursor = conn.cursor()
    query = "SELECT * FROM alerts WHERE 1=1"
    params: List[Any] = []

    if search:
        query += " AND (message LIKE ? OR timestamp LIKE ? OR CAST(sediment_level AS TEXT) LIKE ?)"
        term = f"%{search}%"
        params.extend([term, term, term])

    if severity and severity.upper() != "ALL":
        query += " AND severity = ?"
        params.append(severity.upper())

    count_query = f"SELECT COUNT(*) FROM ({query})"
    cursor.execute(count_query, params)
    total = cursor.fetchone()[0]

    query += " ORDER BY id DESC LIMIT ? OFFSET ?"
    params.extend([size, (page - 1) * size])

    cursor.execute(query, params)
    rows = []
    for row in cursor.fetchall():
        d = dict(row)
        d["acknowledged"] = bool(d["acknowledged"])
        rows.append(d)
    return rows, total


def get_unacknowledged_alerts_count(conn: sqlite3.Connection) -> int:
    cursor = conn.cursor()
    cursor.execute("SELECT COUNT(*) FROM alerts WHERE acknowledged = 0")
    return cursor.fetchone()[0]


def acknowledge_alert(conn: sqlite3.Connection, alert_id: int, username: str) -> bool:
    cursor = conn.cursor()
    now_str = get_current_timestamp()
    cursor.execute(
        """UPDATE alerts 
           SET acknowledged = 1, acknowledged_at = ?, acknowledged_by = ?
           WHERE id = ?""",
        (now_str, username, alert_id)
    )
    conn.commit()
    return cursor.rowcount > 0


def delete_alert(conn: sqlite3.Connection, alert_id: int) -> bool:
    cursor = conn.cursor()
    cursor.execute("DELETE FROM alerts WHERE id = ?", (alert_id,))
    conn.commit()
    return cursor.rowcount > 0


# --- Water Supply Logs (FR-05, FR-06) ---

def get_supply_logs(
    conn: sqlite3.Connection,
    search: Optional[str] = None,
    page: int = 1,
    size: int = 50
) -> Tuple[List[Dict[str, Any]], int]:
    cursor = conn.cursor()
    query = "SELECT * FROM supply_logs WHERE 1=1"
    params: List[Any] = []

    if search:
        query += " AND (reason LIKE ? OR timestamp LIKE ? OR status LIKE ? OR triggered_by LIKE ?)"
        term = f"%{search}%"
        params.extend([term, term, term, term])

    count_query = f"SELECT COUNT(*) FROM ({query})"
    cursor.execute(count_query, params)
    total = cursor.fetchone()[0]

    query += " ORDER BY id DESC LIMIT ? OFFSET ?"
    params.extend([size, (page - 1) * size])

    cursor.execute(query, params)
    rows = [dict(row) for row in cursor.fetchall()]
    return rows, total


def delete_supply_log(conn: sqlite3.Connection, log_id: int) -> bool:
    cursor = conn.cursor()
    cursor.execute("DELETE FROM supply_logs WHERE id = ?", (log_id,))
    conn.commit()
    return cursor.rowcount > 0


# --- Analytical Reports Logic ---

def get_report_summary(conn: sqlite3.Connection) -> Dict[str, Any]:
    cursor = conn.cursor()
    cursor.execute("""
        SELECT 
            COUNT(*) as total_readings,
            COALESCE(AVG(sediment_level), 0.0) as avg_sediment,
            COALESCE(MAX(sediment_level), 0.0) as max_sediment,
            COALESCE(MIN(sediment_level), 0.0) as min_sediment
        FROM sensor_readings
    """)
    stats = dict(cursor.fetchone())

    cursor.execute("SELECT COUNT(*) FROM alerts")
    total_alerts = cursor.fetchone()[0]

    cursor.execute("SELECT COUNT(*) FROM alerts WHERE acknowledged = 0")
    unacknowledged = cursor.fetchone()[0]

    cursor.execute("SELECT COUNT(*) FROM supply_logs WHERE status = 'OFF'")
    shutoff_count = cursor.fetchone()[0]

    safe_limit = get_safe_limit(conn)
    cursor.execute("SELECT COUNT(*) FROM sensor_readings WHERE sediment_level <= ?", (safe_limit,))
    compliant_readings = cursor.fetchone()[0]

    total_r = stats["total_readings"]
    compliance_rate = (compliant_readings / total_r * 100.0) if total_r > 0 else 100.0

    supply_info = get_supply_status(conn)

    return {
        "total_readings": total_r,
        "average_sediment": round(stats["avg_sediment"], 2),
        "max_sediment": round(stats["max_sediment"], 2),
        "min_sediment": round(stats["min_sediment"], 2),
        "total_alerts": total_alerts,
        "unacknowledged_alerts": unacknowledged,
        "supply_shutoff_incidents": shutoff_count,
        "compliance_rate_percent": round(compliance_rate, 2),
        "current_safe_limit": safe_limit,
        "current_supply_status": supply_info["status"]
    }


def generate_csv_report(conn: sqlite3.Connection, report_type: str) -> str:
    """Generate RFC 4180 CSV export for sensor readings, alerts, or supply logs."""
    output = io.StringIO()
    writer = csv.writer(output)
    cursor = conn.cursor()

    if report_type == "readings":
        writer.writerow(["ID", "Timestamp (UTC)", "Sediment Level (%)", "Safe Limit (%)", "Status", "Water Supply"])
        cursor.execute("SELECT id, timestamp, sediment_level, limit_at_time, status, supply_status FROM sensor_readings ORDER BY id DESC")
        for row in cursor.fetchall():
            writer.writerow([row["id"], row["timestamp"], row["sediment_level"], row["limit_at_time"], row["status"], row["supply_status"]])

    elif report_type == "alerts":
        writer.writerow(["ID", "Timestamp (UTC)", "Sediment Level (%)", "Limit at Time (%)", "Severity", "Message", "Acknowledged", "Acknowledged At", "Acknowledged By"])
        cursor.execute("SELECT id, timestamp, sediment_level, limit_at_time, severity, message, acknowledged, acknowledged_at, acknowledged_by FROM alerts ORDER BY id DESC")
        for row in cursor.fetchall():
            writer.writerow([
                row["id"], row["timestamp"], row["sediment_level"], row["limit_at_time"],
                row["severity"], row["message"], "YES" if row["acknowledged"] else "NO",
                row["acknowledged_at"] or "", row["acknowledged_by"] or ""
            ])

    elif report_type == "supply":
        writer.writerow(["ID", "Timestamp (UTC)", "Water Supply Status", "Sediment Level (%)", "Reason", "Triggered By"])
        cursor.execute("SELECT id, timestamp, status, sediment_level, reason, triggered_by FROM supply_logs ORDER BY id DESC")
        for row in cursor.fetchall():
            writer.writerow([row["id"], row["timestamp"], row["status"], row["sediment_level"], row["reason"], row["triggered_by"]])

    return output.getvalue()
