"""Authentication and Authorization Utilities for Smart Water Tank System (NFR-03)."""

import os
from datetime import datetime, timedelta, timezone
from typing import Optional
import bcrypt
import jwt
from fastapi import Depends, HTTPException, status
from fastapi.security import HTTPAuthorizationCredentials, HTTPBearer

from backend.database import get_db_connection

SECRET_KEY = os.environ.get("TANK_JWT_SECRET", "smart-tank-sediment-super-secret-key-2026")
ALGORITHM = "HS256"
ACCESS_TOKEN_EXPIRE_MINUTES = 60 * 24  # 24 hours

security = HTTPBearer(auto_error=False)


def verify_password(plain_password: str, hashed_password: str) -> bool:
    """Verify plain password against bcrypt hash."""
    try:
        return bcrypt.checkpw(plain_password.encode("utf-8"), hashed_password.encode("utf-8"))
    except Exception:
        return False


def create_access_token(data: dict, expires_delta: Optional[timedelta] = None) -> str:
    """Create signed JWT access token."""
    to_encode = data.copy()
    if expires_delta:
        expire = datetime.now(timezone.utc) + expires_delta
    else:
        expire = datetime.now(timezone.utc) + timedelta(minutes=ACCESS_TOKEN_EXPIRE_MINUTES)
    to_encode.update({"exp": expire})
    return jwt.encode(to_encode, SECRET_KEY, algorithm=ALGORITHM)


def decode_token(token: str) -> Optional[dict]:
    """Decode and validate a JWT access token."""
    try:
        payload = jwt.decode(token, SECRET_KEY, algorithms=[ALGORITHM])
        return payload
    except jwt.PyJWTError:
        return None


def get_current_user(credentials: Optional[HTTPAuthorizationCredentials] = Depends(security)) -> Optional[dict]:
    """Extract and validate current user from Bearer token if present."""
    if not credentials or not credentials.credentials:
        return None

    payload = decode_token(credentials.credentials)
    if not payload:
        return None

    username = payload.get("sub")
    if not username:
        return None

    with get_db_connection() as conn:
        cursor = conn.cursor()
        cursor.execute("SELECT id, username, role, full_name, created_at FROM users WHERE username = ?", (username,))
        row = cursor.fetchone()
        if not row:
            return None
        return dict(row)


def require_authorized_user(current_user: Optional[dict] = Depends(get_current_user)) -> dict:
    """
    Enforce NFR-03: Restrict configuration of sediment limit and manual control
    to authorized users with 100% access-control enforcement.
    """
    if not current_user:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Authentication required. Please log in as an authorized user.",
            headers={"WWW-Authenticate": "Bearer"},
        )
    return current_user


def require_admin_user(current_user: dict = Depends(require_authorized_user)) -> dict:
    """Enforce admin privileges for critical operations like record deletions."""
    if current_user.get("role") != "admin":
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="Administrator access required for this operation.",
        )
    return current_user
