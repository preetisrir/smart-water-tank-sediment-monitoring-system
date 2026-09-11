"""Analytical Reports and CSV Export Routes."""

from fastapi import APIRouter, Query
from fastapi.responses import Response

from backend.crud import generate_csv_report, get_report_summary
from backend.database import get_db_connection
from backend.models import ReportSummaryResponse

router = APIRouter(prefix="/api/reports", tags=["Reports & Analytics"])


@router.get("/summary", response_model=ReportSummaryResponse)
def get_analytics_summary():
    """Retrieve operational analytics summary and statistics."""
    with get_db_connection() as conn:
        stats = get_report_summary(conn)
        return ReportSummaryResponse(**stats)


@router.get("/export")
def export_csv_report(
    report_type: str = Query("readings", pattern="^(readings|alerts|supply)$", description="Type of report to export")
):
    """
    Download RFC 4180 CSV export for sensor readings, alerts, or water supply history.
    """
    with get_db_connection() as conn:
        csv_data = generate_csv_report(conn, report_type)
        filename = f"smart_tank_{report_type}_report.csv"
        return Response(
            content=csv_data,
            media_type="text/csv",
            headers={
                "Content-Disposition": f'attachment; filename="{filename}"',
                "Cache-Control": "no-cache"
            }
        )
