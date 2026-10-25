"""Async database engine and session management for SQLite."""
import os
from pathlib import Path
from typing import AsyncGenerator
from sqlalchemy.ext.asyncio import (
    AsyncSession,
    async_sessionmaker,
    create_async_engine,
)
from sqlalchemy import text
from sqlalchemy.pool import NullPool
from app.config import get_settings
from app.database.models import Base

settings = get_settings()

# Ensure local data directory exists
os.makedirs("data", exist_ok=True)

engine = create_async_engine(
    settings.database_url,
    echo=False,
    poolclass=NullPool,
    connect_args={"check_same_thread": False, "timeout": 15},
)

# Async session factory
AsyncSessionLocal = async_sessionmaker(
    bind=engine,
    class_=AsyncSession,
    expire_on_commit=False,
)


async def init_db() -> None:
    """Initialize database tables and enable SQLite WAL mode for concurrency."""
    async with engine.begin() as conn:
        # SQLite pragmas for high reliability and concurrency
        await conn.execute(text("PRAGMA journal_mode=WAL;"))
        await conn.execute(text("PRAGMA synchronous=NORMAL;"))
        await conn.run_sync(Base.metadata.create_all)
        try:
            await conn.execute(text("ALTER TABLE missions ADD COLUMN waypoints_json TEXT;"))
        except Exception:
            pass
        try:
            await conn.execute(text("ALTER TABLE missions ADD COLUMN geofence_json TEXT;"))
        except Exception:
            pass
        try:
            await conn.execute(text("ALTER TABLE missions ADD COLUMN home_lat REAL;"))
        except Exception:
            pass
        try:
            await conn.execute(text("ALTER TABLE missions ADD COLUMN home_lon REAL;"))
        except Exception:
            pass
        try:
            await conn.execute(text("ALTER TABLE missions ADD COLUMN home_alt REAL;"))
        except Exception:
            pass
        try:
            await conn.execute(text("ALTER TABLE missions ADD COLUMN upload_status TEXT DEFAULT 'NOT_UPLOADED';"))
        except Exception:
            pass
        try:
            await conn.execute(text("ALTER TABLE missions ADD COLUMN upload_acknowledged_at INTEGER;"))
        except Exception:
            pass
        try:
            await conn.execute(text("ALTER TABLE missions ADD COLUMN execution_status TEXT DEFAULT 'IDLE';"))
        except Exception:
            pass
        try:
            await conn.execute(text("ALTER TABLE missions ADD COLUMN updated_at INTEGER;"))
        except Exception:
            pass
        try:
            await conn.execute(text("ALTER TABLE telemetry_state ADD COLUMN hdop REAL;"))
        except Exception:
            pass
        try:
            await conn.execute(text("ALTER TABLE telemetry_state ADD COLUMN vdop REAL;"))
        except Exception:
            pass
        try:
            await conn.execute(text("ALTER TABLE telemetry_state ADD COLUMN heading_deg REAL;"))
        except Exception:
            pass


async def get_db() -> AsyncGenerator[AsyncSession, None]:
    """FastAPI dependency for obtaining async database sessions."""
    async with AsyncSessionLocal() as session:
        try:
            yield session
        finally:
            await session.close()
