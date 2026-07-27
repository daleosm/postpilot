from __future__ import annotations

import logging
from contextlib import asynccontextmanager

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

from app.api.router import api_router, root_router
from app.config import get_settings
from app.db.session import get_engine, get_session_factory


@asynccontextmanager
async def lifespan(_: FastAPI):
    try:
        yield
    finally:
        # A process normally owns one configuration for its whole lifetime.
        # Clearing the cached engine after shutdown also prevents a test app
        # configured with one database URL from leaking that engine into the
        # next app instance with different settings.
        await get_engine().dispose()
        get_session_factory.cache_clear()
        get_engine.cache_clear()


def create_app() -> FastAPI:
    settings = get_settings()
    app = FastAPI(
        title="PostPilot API",
        version="1.0.0",
        description="Tenant-isolated operational API for TV post-production facilities.",
        lifespan=lifespan,
    )
    app.add_middleware(
        CORSMiddleware,
        allow_origins=settings.frontend_origins,
        allow_credentials=True,
        allow_methods=["GET", "POST", "PUT", "PATCH", "DELETE"],
        allow_headers=["Authorization", "Content-Type", "X-Request-Id"],
    )
    app.include_router(root_router)
    app.include_router(api_router)
    return app


logging.getLogger("uvicorn.access").disabled = True
app = create_app()
