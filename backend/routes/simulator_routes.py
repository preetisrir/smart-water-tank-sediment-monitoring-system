"""Hardware Sensor Simulator Routes for Demonstrating Real-Time Behavior (NFR-01, NFR-02)."""

import asyncio
import random
from typing import Optional
from fastapi import APIRouter, BackgroundTasks

from backend.crud import add_sensor_reading, get_latest_reading
from backend.database import get_db_connection
from backend.models import (
    SensorReadingResponse,
    SimulatorInjectRequest,
    SimulatorStatusResponse,
)

router = APIRouter(prefix="/api/simulator", tags=["Sensor Simulator"])

# Simulator in-memory state
_sim_state = {
    "is_running": False,
    "interval_seconds": 3.0,
    "current_sediment": 55.0,
    "last_simulated_at": None,
    "task": None
}


async def _simulation_loop():
    """Background loop generating realistic sediment sensor fluctuations."""
    while _sim_state["is_running"]:
        await asyncio.sleep(_sim_state["interval_seconds"])
        if not _sim_state["is_running"]:
            break

        # Generate realistic random-walk fluctuation
        delta = random.uniform(-2.5, 2.8)
        current = _sim_state["current_sediment"] + delta
        current = max(5.0, min(95.0, current))
        _sim_state["current_sediment"] = round(current, 1)

        try:
            with get_db_connection() as conn:
                res = add_sensor_reading(conn, _sim_state["current_sediment"])
                _sim_state["last_simulated_at"] = res["timestamp"]
        except Exception:
            pass


@router.get("/status", response_model=SimulatorStatusResponse)
def get_simulator_status():
    """Get current sensor simulation status."""
    return SimulatorStatusResponse(
        is_running=_sim_state["is_running"],
        interval_seconds=_sim_state["interval_seconds"],
        current_sediment=_sim_state["current_sediment"],
        last_simulated_at=_sim_state["last_simulated_at"]
    )


@router.post("/toggle", response_model=SimulatorStatusResponse)
async def toggle_simulator(enable: Optional[bool] = None):
    """Start or stop the background automatic sensor feed."""
    new_state = (not _sim_state["is_running"]) if enable is None else enable

    if new_state and not _sim_state["is_running"]:
        _sim_state["is_running"] = True
        _sim_state["task"] = asyncio.create_task(_simulation_loop())
    elif not new_state and _sim_state["is_running"]:
        _sim_state["is_running"] = False
        if _sim_state["task"]:
            _sim_state["task"].cancel()
            _sim_state["task"] = None

    return SimulatorStatusResponse(
        is_running=_sim_state["is_running"],
        interval_seconds=_sim_state["interval_seconds"],
        current_sediment=_sim_state["current_sediment"],
        last_simulated_at=_sim_state["last_simulated_at"]
    )


@router.post("/inject", response_model=SensorReadingResponse)
def inject_sediment_reading(payload: SimulatorInjectRequest):
    """
    Directly inject a specific sediment percentage.
    Allows instant testing of high sediment (> limit) to trigger alerts and shutoff,
    or low sediment to test automatic restoration.
    """
    _sim_state["current_sediment"] = payload.sediment_level
    with get_db_connection() as conn:
        result = add_sensor_reading(conn, payload.sediment_level)
        _sim_state["last_simulated_at"] = result["timestamp"]
        return SensorReadingResponse(
            id=result["id"],
            timestamp=result["timestamp"],
            sediment_level=result["sediment_level"],
            limit_at_time=result["limit_at_time"],
            status=result["status"],
            supply_status=result["supply_status"]
        )
