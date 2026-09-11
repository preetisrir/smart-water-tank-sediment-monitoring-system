"""Authentication Routes for Smart Water Tank System (NFR-03)."""

from fastapi import APIRouter, Depends, HTTPException, status

from backend.auth import (
    create_access_token,
    get_current_user,
    require_authorized_user,
    verify_password,
)
from backend.database import get_db_connection
from backend.models import LoginRequest, TokenResponse, UserResponse

router = APIRouter(prefix="/api/auth", tags=["Authentication"])


@router.post("/login", response_model=TokenResponse)
def login(payload: LoginRequest):
    """Log in an authorized user and issue a JWT token."""
    with get_db_connection() as conn:
        cursor = conn.cursor()
        cursor.execute(
            "SELECT id, username, password_hash, role, full_name, created_at FROM users WHERE username = ?",
            (payload.username.strip(),)
        )
        user_row = cursor.fetchone()

        if not user_row or not verify_password(payload.password, user_row["password_hash"]):
            raise HTTPException(
                status_code=status.HTTP_401_UNAUTHORIZED,
                detail="Invalid username or password. Please check your credentials.",
                headers={"WWW-Authenticate": "Bearer"},
            )

        token = create_access_token(data={"sub": user_row["username"], "role": user_row["role"]})
        user = UserResponse(
            id=user_row["id"],
            username=user_row["username"],
            role=user_row["role"],
            full_name=user_row["full_name"],
            created_at=user_row["created_at"]
        )
        return TokenResponse(access_token=token, token_type="bearer", user=user)


@router.get("/me", response_model=UserResponse)
def get_me(current_user: dict = Depends(require_authorized_user)):
    """Retrieve details of the currently authenticated user."""
    return UserResponse(
        id=current_user["id"],
        username=current_user["username"],
        role=current_user["role"],
        full_name=current_user["full_name"],
        created_at=current_user["created_at"]
    )


@router.post("/logout")
def logout():
    """Client-side token invalidation confirmation."""
    return {"message": "Logged out successfully."}
