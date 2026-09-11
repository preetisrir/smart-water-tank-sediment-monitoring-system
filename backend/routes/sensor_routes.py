"""Sensor Readings API Routes (FR-01, FR-02, FR-06)."""

from typing import Optional
from fastapi import APIRouter, Depends, HTTPException, Query, status

from backend.auth import require_admin_user, require_authorized_user
from backend.crud import (
    add_sensor_reading,
    clear_sensor_readings,
    delete_sensor_reading,
    get_alerts,
    get_latest_reading,
    get_safe_limit,
    get_sensor_readings,
    get_supply_status,
    get_unacknowledged_alerts_count,
)
from backend.database import get_db_connection
from backend.models import (
    DashboardStatusResponse,
    SensorReadingCreate,
    SensorReadingListResponse,
    SensorReadingResponse,
)

router = APIRouter(prefix="/api/sensor", tags=["Sensor Monitoring"])


@router.post("/readings", response_model=SensorReadingResponse, status_code=status.HTTP_201_CREATED)
def post_sensor_reading(payload: SensorReadingCreate):
    """
    Ingest a new sediment sensor reading (FR-01, FR-06).
    Evaluates safe sediment threshold:
    - Triggers alert if reading > limit (FR-04, NFR-02).
    - Automatically stops water supply if reading > limit (FR-05).
    """
    with get_db_connection() as conn:
        result = add_sensor_reading(conn, payload.sediment_level, payload.timestamp)
        return SensorReadingResponse(
            id=result["id"],
            timestamp=result["timestamp"],
            sediment_level=result["sediment_level"],
            limit_at_time=result["limit_at_time"],
            status=result["status"],
            supply_status=result["supply_status"]
        )


@router.get("/readings", response_model=SensorReadingListResponse)
def list_sensor_readings(
    search: Optional[str] = Query(None, description="Search by timestamp, sediment, status, or supply"),
    status: Optional[str] = Query(None, description="Filter by status: NORMAL, WARNING, CRITICAL, or ALL"),
    page: int = Query(1, ge=1, description="Page number"),
    size: int = Query(25, ge=1, le=200, description="Items per page")
):
    """Retrieve historical sensor readings with search, status filtering, and pagination (FR-06)."""
    with get_db_connection() as conn:
        items, total = get_sensor_readings(conn, search, status, page, size)
        return SensorReadingListResponse(
            items=[SensorReadingResponse(**row) for row in items],
            total=total,
            page=page,
            size=size
        )


@router.get("/latest", response_model=DashboardStatusResponse)
def get_latest_status():
    """
    Retrieve real-time consolidated dashboard status (FR-02, NFR-01, NFR-04).
    Provides instant sediment %, safe threshold, supply state, and alert counts.
    """
    with get_db_connection() as conn:
        latest = get_latest_reading(conn)
        safe_limit = get_safe_limit(conn)
        supply_info = get_supply_status(conn)
        active_alerts = get_unacknowledged_alerts_count(conn)

        cursor = conn.cursor()
        cursor.execute("SELECT COUNT(*) FROM sensor_readings")
        total_readings = cursor.fetchone()[0]

        if latest:
            current_sediment = latest["sediment_level"]
            current_status = latest["status"]
            last_updated = latest["timestamp"]
        else:
            current_sediment = 0.0
            current_status = "NORMAL"
            last_updated = supply_info["updated_at"]

        return DashboardStatusResponse(
            current_sediment=current_sediment,
            safe_limit=safe_limit,
            status=current_status,
            supply_status=supply_info["status"],
            control_mode=supply_info["control_mode"],
            active_alerts_count=active_alerts,
            total_readings_count=total_readings,
            last_updated=last_updated
        )


@router.delete("/readings/{reading_id}")
def delete_reading(
    reading_id: int,
    current_user: dict = Depends(require_authorized_user)
):
    """Delete a specific sensor reading record (CRUD maintenance)."""
    with get_db_connection() as conn:
        success = delete_sensor_reading(conn, reading_id)
        if not success:
            raise HTTPException(status_code=404, detail="Sensor reading not found.")
        return {"message": f"Reading #{reading_id} deleted successfully."}


@router.delete("/readings")
def clear_all_readings(
    current_user: dict = Depends(require_admin_user)
):
    """Clear all sensor reading history (Admin only)."""
    with get_db_connection() as conn:
        count = clear_sensor_readings(conn)
        return {"message": f"Cleared {count} sensor reading records."}
