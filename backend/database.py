"""SQLite Database Configuration and Initialization for Smart Water Tank System."""

import os
import sqlite3
from datetime import datetime, timezone
from pathlib import Path
from typing import Generator
import bcrypt

DB_PATH = os.environ.get(
    "TANK_DB_PATH",
    str(Path(__file__).resolve().parent.parent / "tank_system.db")
)


def get_db_connection() -> sqlite3.Connection:
    """Create a new database connection with row factory enabled."""
    conn = sqlite3.connect(DB_PATH, timeout=10.0)
    conn.row_factory = sqlite3.Row
    conn.execute("PRAGMA foreign_keys = ON")
    conn.execute("PRAGMA journal_mode = WAL")
    return conn


def hash_password(password: str) -> str:
    """Hash password using bcrypt."""
    salt = bcrypt.gensalt(rounds=12)
    return bcrypt.hashpw(password.encode("utf-8"), salt).decode("utf-8")


def init_db() -> None:
    """Initialize SQLite tables and seed default data if not present."""
    os.makedirs(os.path.dirname(os.path.abspath(DB_PATH)), exist_ok=True)

    with get_db_connection() as conn:
        cursor = conn.cursor()

        # Users table
        cursor.execute("""
            CREATE TABLE IF NOT EXISTS users (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                username TEXT UNIQUE NOT NULL,
                password_hash TEXT NOT NULL,
                role TEXT NOT NULL DEFAULT 'user',
                full_name TEXT NOT NULL,
                created_at TEXT NOT NULL
            )
        """)

        # System settings table
        cursor.execute("""
            CREATE TABLE IF NOT EXISTS settings (
                key TEXT PRIMARY KEY,
                value TEXT NOT NULL,
                updated_at TEXT NOT NULL,
                updated_by TEXT
            )
        """)

        # Sensor readings table (FR-01, FR-06)
        cursor.execute("""
            CREATE TABLE IF NOT EXISTS sensor_readings (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                timestamp TEXT NOT NULL,
                sediment_level REAL NOT NULL,
                limit_at_time REAL NOT NULL,
                status TEXT NOT NULL,
                supply_status TEXT NOT NULL
            )
        """)

        # Alerts table (FR-04, FR-06)
        cursor.execute("""
            CREATE TABLE IF NOT EXISTS alerts (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                timestamp TEXT NOT NULL,
                sediment_level REAL NOT NULL,
                limit_at_time REAL NOT NULL,
                severity TEXT NOT NULL,
                message TEXT NOT NULL,
                acknowledged INTEGER NOT NULL DEFAULT 0,
                acknowledged_at TEXT,
                acknowledged_by TEXT
            )
        """)

        # Supply status logs table (FR-05, FR-06)
        cursor.execute("""
            CREATE TABLE IF NOT EXISTS supply_logs (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                timestamp TEXT NOT NULL,
                status TEXT NOT NULL,
                sediment_level REAL NOT NULL,
                reason TEXT NOT NULL,
                triggered_by TEXT NOT NULL
            )
        """)

        # Indexes for fast search and filtering
        cursor.execute("CREATE INDEX IF NOT EXISTS idx_readings_timestamp ON sensor_readings(timestamp DESC)")
        cursor.execute("CREATE INDEX IF NOT EXISTS idx_alerts_timestamp ON alerts(timestamp DESC)")
        cursor.execute("CREATE INDEX IF NOT EXISTS idx_supply_logs_timestamp ON supply_logs(timestamp DESC)")

        # Seed default users if table is empty
        cursor.execute("SELECT COUNT(*) FROM users")
        user_count = cursor.fetchone()[0]
        now_str = datetime.now(timezone.utc).isoformat()

        if user_count == 0:
            admin_hash = hash_password("admin123")
            operator_hash = hash_password("operator123")
            cursor.execute(
                "INSERT INTO users (username, password_hash, role, full_name, created_at) VALUES (?, ?, ?, ?, ?)",
                ("admin", admin_hash, "admin", "System Administrator", now_str)
            )
            cursor.execute(
                "INSERT INTO users (username, password_hash, role, full_name, created_at) VALUES (?, ?, ?, ?, ?)",
                ("operator", operator_hash, "operator", "Tank Field Operator", now_str)
            )

        # Seed default safe limit (70%) if not present
        cursor.execute("SELECT value FROM settings WHERE key = 'safe_sediment_limit'")
        if not cursor.fetchone():
            cursor.execute(
                "INSERT INTO settings (key, value, updated_at, updated_by) VALUES (?, ?, ?, ?)",
                ("safe_sediment_limit", "70.0", now_str, "system")
            )

        # Seed default water supply status ('ON') if not present
        cursor.execute("SELECT value FROM settings WHERE key = 'water_supply_status'")
        if not cursor.fetchone():
            cursor.execute(
                "INSERT INTO settings (key, value, updated_at, updated_by) VALUES (?, ?, ?, ?)",
                ("water_supply_status", "ON", now_str, "system")
            )

        # Seed default control mode ('AUTOMATIC')
        cursor.execute("SELECT value FROM settings WHERE key = 'control_mode'")
        if not cursor.fetchone():
            cursor.execute(
                "INSERT INTO settings (key, value, updated_at, updated_by) VALUES (?, ?, ?, ?)",
                ("control_mode", "AUTOMATIC", now_str, "system")
            )

        # If no sensor readings exist yet, seed a few initial realistic baseline readings
        cursor.execute("SELECT COUNT(*) FROM sensor_readings")
        if cursor.fetchone()[0] == 0:
            base_readings = [
                (datetime.now(timezone.utc).isoformat(), 34.2, 70.0, "NORMAL", "ON"),
                (datetime.now(timezone.utc).isoformat(), 42.0, 70.0, "NORMAL", "ON"),
                (datetime.now(timezone.utc).isoformat(), 58.5, 70.0, "WARNING", "ON"),
                (datetime.now(timezone.utc).isoformat(), 62.0, 70.0, "WARNING", "ON"),
            ]
            cursor.executemany(
                """INSERT INTO sensor_readings 
                   (timestamp, sediment_level, limit_at_time, status, supply_status)
                   VALUES (?, ?, ?, ?, ?)""",
                base_readings
            )
            cursor.execute(
                """INSERT INTO supply_logs 
                   (timestamp, status, sediment_level, reason, triggered_by)
                   VALUES (?, ?, ?, ?, ?)""",
                (now_str, "ON", 62.0, "System initial startup - normal supply active", "AUTOMATIC")
            )

        conn.commit()
