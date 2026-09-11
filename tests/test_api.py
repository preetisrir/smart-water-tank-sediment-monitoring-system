"""Comprehensive Automated Tests for Smart Water Tank System (SRS Compliance)."""

import os
import tempfile
import pytest
from fastapi.testclient import TestClient

# Use temporary database for test isolation
temp_db = tempfile.NamedTemporaryFile(suffix=".db", delete=False)
temp_db.close()
os.environ["TANK_DB_PATH"] = temp_db.name

from backend.database import init_db, get_db_connection
from backend.main import app

client = TestClient(app)


@pytest.fixture(scope="session", autouse=True)
def setup_test_db():
    """Initialize test database before running tests."""
    init_db()
    yield
    try:
        os.remove(temp_db.name)
    except Exception:
        pass


@pytest.fixture
def admin_token():
    """Login as admin and return JWT token."""
    response = client.post("/api/auth/login", json={"username": "admin", "password": "admin123"})
    assert response.status_code == 200
    return response.json()["access_token"]


@pytest.fixture
def operator_token():
    """Login as operator and return JWT token."""
    response = client.post("/api/auth/login", json={"username": "operator", "password": "operator123"})
    assert response.status_code == 200
    return response.json()["access_token"]


# =====================================================================
# 1. Health & System Tests
# =====================================================================

def test_health_check():
    response = client.get("/api/health")
    assert response.status_code == 200
    assert response.json()["status"] == "healthy"


# =====================================================================
# 2. Authentication Tests (NFR-03)
# =====================================================================

def test_login_success():
    response = client.post("/api/auth/login", json={"username": "admin", "password": "admin123"})
    assert response.status_code == 200
    data = response.json()
    assert "access_token" in data
    assert data["user"]["username"] == "admin"
    assert data["user"]["role"] == "admin"


def test_login_invalid_password():
    response = client.post("/api/auth/login", json={"username": "admin", "password": "wrongpassword"})
    assert response.status_code == 401
    assert "Invalid username or password" in response.json()["detail"]


def test_login_nonexistent_user():
    response = client.post("/api/auth/login", json={"username": "ghost_user", "password": "password"})
    assert response.status_code == 401


def test_get_current_user_me(admin_token):
    response = client.get("/api/auth/me", headers={"Authorization": f"Bearer {admin_token}"})
    assert response.status_code == 200
    assert response.json()["username"] == "admin"


def test_get_current_user_unauthorized():
    response = client.get("/api/auth/me")
    assert response.status_code == 401


# =====================================================================
# 3. Safe Sediment Limit Tests (FR-03, NFR-03)
# =====================================================================

def test_get_safe_limit_public():
    """Any user can view the configured limit."""
    response = client.get("/api/limit")
    assert response.status_code == 200
    assert "safe_limit" in response.json()


def test_update_safe_limit_unauthorized():
    """NFR-03: Setting safe limit without credentials MUST fail with 401."""
    response = client.put("/api/limit", json={"safe_limit": 65.0})
    assert response.status_code == 401


def test_update_safe_limit_authorized(admin_token):
    """FR-03: Authorized user can set safe sediment level limit."""
    response = client.put(
        "/api/limit",
        json={"safe_limit": 65.0},
        headers={"Authorization": f"Bearer {admin_token}"}
    )
    assert response.status_code == 200
    assert response.json()["safe_limit"] == 65.0
    assert response.json()["updated_by"] == "admin"


def test_update_safe_limit_validation(admin_token):
    """Validation: limit must be between 1 and 100."""
    # Under min
    response = client.put(
        "/api/limit",
        json={"safe_limit": 0.5},
        headers={"Authorization": f"Bearer {admin_token}"}
    )
    assert response.status_code == 422

    # Over max
    response = client.put(
        "/api/limit",
        json={"safe_limit": 105.0},
        headers={"Authorization": f"Bearer {admin_token}"}
    )
    assert response.status_code == 422


# =====================================================================
# 4. Sensor Reading Ingestion & Automatic Control (FR-01, FR-04, FR-05, FR-06)
# =====================================================================

def test_ingest_normal_sensor_reading():
    """Normal reading records to SQLite and maintains supply ON."""
    response = client.post("/api/sensor/readings", json={"sediment_level": 30.0})
    assert response.status_code == 201
    data = response.json()
    assert data["sediment_level"] == 30.0
    assert data["status"] == "NORMAL"
    assert data["supply_status"] == "ON"


def test_automatic_alert_and_supply_shutoff_when_exceeded():
    """
    FR-04: System shall send an alert when sediment level exceeds limit.
    FR-05: System shall automatically stop water supply when sediment exceeds limit.
    FR-06: Store sensor reading, alert, and supply status in SQLite.
    """
    # Set limit to 60.0
    client.put("/api/limit", json={"safe_limit": 60.0}, headers={"Authorization": f"Bearer {client.post('/api/auth/login', json={'username': 'admin', 'password': 'admin123'}).json()['access_token']}"})

    # Ingest reading of 78.5% (exceeds 60.0%)
    response = client.post("/api/sensor/readings", json={"sediment_level": 78.5})
    assert response.status_code == 201
    data = response.json()
    assert data["status"] == "CRITICAL"
    assert data["supply_status"] == "OFF"

    # Verify Alert was automatically created in SQLite (FR-04, NFR-02)
    alert_resp = client.get("/api/alerts")
    assert alert_resp.status_code == 200
    alerts = alert_resp.json()["items"]
    assert len(alerts) > 0
    latest_alert = alerts[0]
    assert latest_alert["severity"] == "CRITICAL"
    assert "exceeds safe limit" in latest_alert["message"]

    # Verify Water Supply is OFF (FR-05)
    supply_resp = client.get("/api/supply/status")
    assert supply_resp.status_code == 200
    assert supply_resp.json()["status"] == "OFF"

    # Verify Supply log entry in SQLite (FR-06)
    logs_resp = client.get("/api/supply/logs")
    assert logs_resp.status_code == 200
    assert logs_resp.json()["total"] > 0
    latest_log = logs_resp.json()["items"][0]
    assert latest_log["status"] == "OFF"
    assert "Automatic shutoff" in latest_log["reason"]


def test_automatic_water_supply_restore_when_sediment_normal():
    """When sediment returns below safe limit, water supply automatically resumes."""
    # Submit safe reading 35.0%
    response = client.post("/api/sensor/readings", json={"sediment_level": 35.0})
    assert response.status_code == 201
    assert response.json()["status"] == "NORMAL"
    assert response.json()["supply_status"] == "ON"

    # Verify Water Supply is ON
    supply_resp = client.get("/api/supply/status")
    assert supply_resp.json()["status"] == "ON"


# =====================================================================
# 5. Dashboard Real-Time Status Endpoint (FR-02, NFR-01, NFR-04)
# =====================================================================

def test_dashboard_latest_status():
    response = client.get("/api/sensor/latest")
    assert response.status_code == 200
    data = response.json()
    assert "current_sediment" in data
    assert "safe_limit" in data
    assert "status" in data
    assert "supply_status" in data
    assert "active_alerts_count" in data


# =====================================================================
# 6. CRUD Operations (Search, Filter, Acknowledge, Delete)
# =====================================================================

def test_sensor_readings_search_and_filter():
    response = client.get("/api/sensor/readings?status=CRITICAL")
    assert response.status_code == 200
    items = response.json()["items"]
    for item in items:
        assert item["status"] == "CRITICAL"


def test_delete_reading(admin_token):
    # Create reading to delete
    create_resp = client.post("/api/sensor/readings", json={"sediment_level": 44.0})
    reading_id = create_resp.json()["id"]

    # Delete with authorization
    del_resp = client.delete(f"/api/sensor/readings/{reading_id}", headers={"Authorization": f"Bearer {admin_token}"})
    assert del_resp.status_code == 200


def test_acknowledge_alert(operator_token):
    # Trigger alert
    client.post("/api/sensor/readings", json={"sediment_level": 92.0})
    alerts = client.get("/api/alerts").json()["items"]
    alert_id = alerts[0]["id"]

    # Acknowledge
    ack_resp = client.post(f"/api/alerts/{alert_id}/ack", headers={"Authorization": f"Bearer {operator_token}"})
    assert ack_resp.status_code == 200

    # Verify acknowledged flag
    refreshed_alerts = client.get("/api/alerts").json()["items"]
    target = next(a for a in refreshed_alerts if a["id"] == alert_id)
    assert target["acknowledged"] is True
    assert target["acknowledged_by"] == "operator"


# =====================================================================
# 7. Reports & CSV Export Tests
# =====================================================================

def test_reports_summary():
    response = client.get("/api/reports/summary")
    assert response.status_code == 200
    data = response.json()
    assert data["total_readings"] > 0
    assert "average_sediment" in data
    assert "compliance_rate_percent" in data


def test_reports_csv_export():
    for r_type in ["readings", "alerts", "supply"]:
        response = client.get(f"/api/reports/export?report_type={r_type}")
        assert response.status_code == 200
        assert response.headers["content-type"].startswith("text/csv")
        assert len(response.text) > 0


# =====================================================================
# 8. Sensor Simulator Tests
# =====================================================================

def test_simulator_inject():
    response = client.post("/api/simulator/inject", json={"sediment_level": 52.5})
    assert response.status_code == 200
    assert response.json()["sediment_level"] == 52.5
