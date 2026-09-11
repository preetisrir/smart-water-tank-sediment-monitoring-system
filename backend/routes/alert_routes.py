"""Alerts Management Routes (FR-04, FR-06)."""

from typing import Optional
from fastapi import APIRouter, Depends, HTTPException, Query, status

from backend.auth import require_authorized_user
from backend.crud import (
    acknowledge_alert,
    delete_alert,
    get_alerts,
    get_unacknowledged_alerts_count,
)
from backend.database import get_db_connection
from backend.models import AlertListResponse, AlertResponse

router = APIRouter(prefix="/api/alerts", tags=["Alerts Management"])


@router.get("", response_model=AlertListResponse)
def list_alerts(
    search: Optional[str] = Query(None, description="Search by alert message, timestamp, or sediment level"),
    severity: Optional[str] = Query(None, description="Filter by severity: CRITICAL, WARNING, or ALL"),
    page: int = Query(1, ge=1),
    size: int = Query(50, ge=1, le=200)
):
    """Retrieve historical alert records with search and severity filter (FR-06)."""
    with get_db_connection() as conn:
        items, total = get_alerts(conn, search, severity, page, size)
        unacked = get_unacknowledged_alerts_count(conn)
        return AlertListResponse(
            items=[AlertResponse(**row) for row in items],
            total=total,
            unacknowledged_count=unacked
        )


@router.get("/count")
def get_alerts_count():
    """Retrieve real-time count of active unacknowledged alerts."""
    with get_db_connection() as conn:
        count = get_unacknowledged_alerts_count(conn)
        return {"unacknowledged_count": count}


@router.post("/{alert_id}/ack")
def ack_alert(
    alert_id: int,
    current_user: dict = Depends(require_authorized_user)
):
    """Mark an alert as acknowledged by the current authorized user."""
    with get_db_connection() as conn:
        success = acknowledge_alert(conn, alert_id, current_user["username"])
        if not success:
            raise HTTPException(status_code=404, detail="Alert record not found.")
        return {"message": f"Alert #{alert_id} acknowledged by {current_user['username']}."}


@router.delete("/{alert_id}")
def remove_alert(
    alert_id: int,
    current_user: dict = Depends(require_authorized_user)
):
    """Delete an alert record (CRUD maintenance)."""
    with get_db_connection() as conn:
        success = delete_alert(conn, alert_id)
        if not success:
            raise HTTPException(status_code=404, detail="Alert record not found.")
        return {"message": f"Alert #{alert_id} deleted successfully."}
