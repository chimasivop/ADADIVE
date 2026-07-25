"""ADADIVE AI Service - Main FastAPI Application."""

from contextlib import asynccontextmanager
from datetime import datetime
from typing import AsyncGenerator

from fastapi import FastAPI, HTTPException, Request, Response
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse
import uvicorn

from .config import get_settings
from .chat import (
    ChatRequest,
    ChatResponse,
    Message,
    get_conversation_manager,
)
from .auth import get_user_context, AuthStatus
from .retrieval import get_knowledge_base
from .integrations import get_backend_client


@asynccontextmanager
async def lifespan(app: FastAPI) -> AsyncGenerator[None, None]:
    """Application lifespan handler for startup and shutdown."""
    # Startup
    settings = get_settings()
    
    # Initialize knowledge base
    knowledge_base = get_knowledge_base()
    try:
        knowledge_base.initialize()
        print(f"Knowledge base initialized with {len(knowledge_base.vector_store.documents)} documents")
    except Exception as e:
        print(f"Warning: Could not initialize knowledge base: {e}")
    
    # Test backend API connection (optional)
    backend_client = get_backend_client()
    try:
        healthy = await backend_client.health_check()
        print(f"Backend API health check: {'OK' if healthy else 'UNAVAILABLE'}")
    except Exception as e:
        print(f"Warning: Backend API unavailable: {e}")
    
    yield
    
    # Shutdown
    await backend_client.close()


def create_app() -> FastAPI:
    """Create and configure the FastAPI application."""
    settings = get_settings()
    
    app = FastAPI(
        title="ADADIVE AI Service",
        description="AI-powered chat service for ADADIVE decentralized storage platform",
        version="0.1.0",
        lifespan=lifespan,
        docs_url="/docs",
        redoc_url="/redoc",
        openapi_url="/openapi.json",
    )
    
    # CORS middleware
    app.add_middleware(
        CORSMiddleware,
        allow_origins=settings.allowed_origins,
        allow_credentials=True,
        allow_methods=["*"],
        allow_headers=["*"],
    )
    
    # Include routers
    from .routes import router as api_router
    app.include_router(api_router, prefix="/api")
    
    return app


# Create the app instance
app = create_app()


@app.get("/")
async def root() -> dict:
    """Root endpoint."""
    return {
        "service": "ADADIVE AI",
        "version": "0.1.0",
        "status": "operational",
        "docs": "/docs",
    }


@app.get("/health")
async def health_check() -> dict:
    """Health check endpoint."""
    settings = get_settings()
    
    # Check components
    checks = {
        "service": "ok",
        "knowledge_base": "ok" if get_knowledge_base()._initialized else "not_initialized",
        "backend_api": "unknown",
        "llm_provider": settings.llm_provider,
    }
    
    # Check backend API
    try:
        backend_client = get_backend_client()
        checks["backend_api"] = "ok" if await backend_client.health_check() else "unavailable"
    except Exception:
        checks["backend_api"] = "error"
    
    # Determine overall status
    all_ok = all(
        v in ("ok", "unknown", "not_initialized") 
        for v in checks.values()
    )
    
    return {
        "status": "healthy" if all_ok else "degraded",
        "checks": checks,
        "timestamp": datetime.utcnow().isoformat(),
    }


def run_server() -> None:
    """Run the server."""
    settings = get_settings()
    uvicorn.run(
        "adadive_ai.main:app",
        host=settings.api_host,
        port=settings.api_port,
        reload=settings.api_debug,
        log_level="info" if not settings.api_debug else "debug",
    )


if __name__ == "__main__":
    run_server()
