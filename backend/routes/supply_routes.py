"""Water Supply Control and History Routes (FR-05, FR-06)."""

from typing import Optional
from fastapi import APIRouter, Depends, HTTPException, Query, status

from backend.auth import require_authorized_user
from backend.crud import (
    delete_supply_log,
    get_latest_reading,
    get_supply_logs,
    get_supply_status,
    set_supply_status,
)
from backend.database import get_db_connection
from backend.models import (
    SupplyLogListResponse,
    SupplyLogResponse,
    SupplyStatusResponse,
    SupplyToggleRequest,
)

router = APIRouter(prefix="/api/supply", tags=["Water Supply Control"])


@router.get("/status", response_model=SupplyStatusResponse)
def read_supply_status():
    """Retrieve current automatic water supply control status (FR-02, FR-05)."""
    with get_db_connection() as conn:
        info = get_supply_status(conn)
        return SupplyStatusResponse(**info)


@router.post("/override", response_model=SupplyStatusResponse)
def override_supply_status(
    payload: SupplyToggleRequest,
    current_user: dict = Depends(require_authorized_user)
):
    """
    Manually override water supply status (ON / OFF).
    Enforces NFR-03: Requires authorized user credentials.
    """
    with get_db_connection() as conn:
        latest = get_latest_reading(conn)
        current_sediment = latest["sediment_level"] if latest else 0.0

        reason = payload.reason or f"Manual override by {current_user['username']}"
        set_supply_status(
            conn,
            status=payload.status,
            sediment_level=current_sediment,
            reason=reason,
            triggered_by=current_user["username"],
            mode="MANUAL" if payload.status == "ON" and current_sediment > 70 else "AUTOMATIC"
        )
        conn.commit()
        info = get_supply_status(conn)
        return SupplyStatusResponse(**info)


@router.get("/logs", response_model=SupplyLogListResponse)
def list_supply_logs(
    search: Optional[str] = Query(None, description="Search supply logs"),
    page: int = Query(1, ge=1),
    size: int = Query(50, ge=1, le=200)
):
    """Retrieve stored water supply control events and status history (FR-06)."""
    with get_db_connection() as conn:
        items, total = get_supply_logs(conn, search, page, size)
        return SupplyLogListResponse(
            items=[SupplyLogResponse(**row) for row in items],
            total=total
        )


@router.delete("/logs/{log_id}")
def remove_supply_log(
    log_id: int,
    current_user: dict = Depends(require_authorized_user)
):
    """Delete a supply log entry (CRUD maintenance)."""
    with get_db_connection() as conn:
        success = delete_supply_log(conn, log_id)
        if not success:
            raise HTTPException(status_code=404, detail="Supply log entry not found.")
        return {"message": f"Supply log #{log_id} deleted successfully."}
