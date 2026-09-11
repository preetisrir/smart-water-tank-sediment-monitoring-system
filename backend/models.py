"""Pydantic Models and Schemas for Data Validation and API Responses."""

from datetime import datetime
from typing import List, Optional
from pydantic import BaseModel, Field, field_validator


# --- Authentication Schemas ---

class LoginRequest(BaseModel):
    username: str = Field(..., min_length=2, max_length=50, description="Authorized username")
    password: str = Field(..., min_length=3, description="User password")


class UserResponse(BaseModel):
    id: int
    username: str
    role: str
    full_name: str
    created_at: str


class TokenResponse(BaseModel):
    access_token: str
    token_type: str = "bearer"
    user: UserResponse


# --- Sensor Readings Schemas (FR-01, FR-06) ---

class SensorReadingCreate(BaseModel):
    sediment_level: float = Field(
        ...,
        ge=0.0,
        le=100.0,
        description="Water tank sediment level percentage between 0 and 100"
    )
    timestamp: Optional[str] = Field(None, description="Optional ISO timestamp")

    @field_validator("sediment_level")
    @classmethod
    def round_sediment(cls, v: float) -> float:
        return round(v, 2)


class SensorReadingResponse(BaseModel):
    id: int
    timestamp: str
    sediment_level: float
    limit_at_time: float
    status: str
    supply_status: str


class SensorReadingListResponse(BaseModel):
    items: List[SensorReadingResponse]
    total: int
    page: int
    size: int


# --- Sediment Limit Schemas (FR-03, NFR-03) ---

class SafeLimitUpdateRequest(BaseModel):
    safe_limit: float = Field(
        ...,
        ge=1.0,
        le=100.0,
        description="Safe sediment level threshold percentage between 1 and 100"
    )

    @field_validator("safe_limit")
    @classmethod
    def validate_limit(cls, v: float) -> float:
        return round(v, 1)


class SafeLimitResponse(BaseModel):
    safe_limit: float
    updated_at: str
    updated_by: Optional[str] = None


# --- Alerts Schemas (FR-04, FR-06) ---

class AlertResponse(BaseModel):
    id: int
    timestamp: str
    sediment_level: float
    limit_at_time: float
    severity: str
    message: str
    acknowledged: bool
    acknowledged_at: Optional[str] = None
    acknowledged_by: Optional[str] = None


class AlertListResponse(BaseModel):
    items: List[AlertResponse]
    total: int
    unacknowledged_count: int


# --- Supply Schemas (FR-05, FR-06) ---

class SupplyStatusResponse(BaseModel):
    status: str  # "ON" or "OFF"
    sediment_level: float
    safe_limit: float
    control_mode: str  # "AUTOMATIC" or "MANUAL"
    last_reason: str
    updated_at: str


class SupplyToggleRequest(BaseModel):
    status: str = Field(..., pattern="^(ON|OFF)$")
    reason: Optional[str] = "Manual operator toggle"


class SupplyLogResponse(BaseModel):
    id: int
    timestamp: str
    status: str
    sediment_level: float
    reason: str
    triggered_by: str


class SupplyLogListResponse(BaseModel):
    items: List[SupplyLogResponse]
    total: int


# --- Dashboard Latest Status Schema (FR-02, NFR-01, NFR-04) ---

class DashboardStatusResponse(BaseModel):
    current_sediment: float
    safe_limit: float
    status: str  # "NORMAL", "WARNING", "CRITICAL"
    supply_status: str  # "ON", "OFF"
    control_mode: str
    active_alerts_count: int
    total_readings_count: int
    last_updated: str


# --- Reports Schema ---

class ReportSummaryResponse(BaseModel):
    total_readings: int
    average_sediment: float
    max_sediment: float
    min_sediment: float
    total_alerts: int
    unacknowledged_alerts: int
    supply_shutoff_incidents: int
    compliance_rate_percent: float
    current_safe_limit: float
    current_supply_status: str


# --- Simulator Schemas ---

class SimulatorInjectRequest(BaseModel):
    sediment_level: float = Field(..., ge=0.0, le=100.0)


class SimulatorStatusResponse(BaseModel):
    is_running: bool
    interval_seconds: float
    current_sediment: float
    last_simulated_at: Optional[str] = None
