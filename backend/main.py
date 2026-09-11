"""Main Application Entrypoint for Smart Water Tank System."""

import os
from contextlib import asynccontextmanager
from pathlib import Path
from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import FileResponse
from fastapi.staticfiles import StaticFiles

from backend.database import init_db
from backend.routes.alert_routes import router as alert_router
from backend.routes.auth_routes import router as auth_router
from backend.routes.limit_routes import router as limit_router
from backend.routes.report_routes import router as report_router
from backend.routes.sensor_routes import router as sensor_router
from backend.routes.simulator_routes import router as simulator_router
from backend.routes.supply_routes import router as supply_router

BASE_DIR = Path(__file__).resolve().parent.parent


@asynccontextmanager
async def lifespan(app: FastAPI):
    """Application lifespan: initialize SQLite database on startup."""
    init_db()
    yield


app = FastAPI(
    title="Smart Water Tank Sediment Monitoring System",
    description="Automated IoT sediment monitoring and water supply control system with SQLite backend and REST API.",
    version="1.0.0",
    lifespan=lifespan
)

# Enable CORS for local client development
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# Register API routers
app.include_router(auth_router)
app.include_router(sensor_router)
app.include_router(limit_router)
app.include_router(alert_router)
app.include_router(supply_router)
app.include_router(report_router)
app.include_router(simulator_router)


# Frontend static files routing
@app.get("/")
async def serve_index():
    """Serve main frontend dashboard application."""
    index_path = BASE_DIR / "index.html"
    return FileResponse(index_path)


@app.get("/index.html")
async def serve_index_html():
    return FileResponse(BASE_DIR / "index.html")


@app.get("/style.css")
async def serve_style():
    return FileResponse(BASE_DIR / "style.css", media_type="text/css")


@app.get("/script.js")
async def serve_script():
    return FileResponse(BASE_DIR / "script.js", media_type="application/javascript")


@app.get("/api/health")
async def health_check():
    """System health check endpoint."""
    return {"status": "healthy", "service": "smart-tank-backend", "version": "1.0.0"}


if __name__ == "__main__":
    import uvicorn
    port = int(os.environ.get("PORT", 8000))
    uvicorn.run("backend.main:app", host="127.0.0.1", port=port, reload=True)
