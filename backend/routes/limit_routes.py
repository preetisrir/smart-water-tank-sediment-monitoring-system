"""Safe Sediment Limit Configuration Routes (FR-03, NFR-03)."""

from fastapi import APIRouter, Depends, status

from backend.auth import require_authorized_user
from backend.crud import get_safe_limit, set_safe_limit
from backend.database import get_db_connection
from backend.models import SafeLimitResponse, SafeLimitUpdateRequest

router = APIRouter(prefix="/api/limit", tags=["Sediment Limit Configuration"])


@router.get("", response_model=SafeLimitResponse)
def read_safe_limit():
    """Retrieve the current configured safe sediment level limit (FR-03)."""
    with get_db_connection() as conn:
        cursor = conn.cursor()
        cursor.execute("SELECT value, updated_at, updated_by FROM settings WHERE key = 'safe_sediment_limit'")
        row = cursor.fetchone()
        if row:
            return SafeLimitResponse(
                safe_limit=float(row["value"]),
                updated_at=row["updated_at"],
                updated_by=row["updated_by"]
            )
        return SafeLimitResponse(safe_limit=70.0, updated_at="", updated_by="system")


@router.put("", response_model=SafeLimitResponse)
def update_safe_limit(
    payload: SafeLimitUpdateRequest,
    current_user: dict = Depends(require_authorized_user)
):
    """
    Configure safe sediment level limit (FR-03).
    Strictly enforced by NFR-03: Only authorized users can configure limits.
    """
    with get_db_connection() as conn:
        result = set_safe_limit(conn, payload.safe_limit, current_user["username"])
        return SafeLimitResponse(
            safe_limit=result["safe_limit"],
            updated_at=result["updated_at"],
            updated_by=result["updated_by"]
        )
