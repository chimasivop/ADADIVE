"""ADADIVE AI Service v2 - Main FastAPI Application."""

from contextlib import asynccontextmanager
from datetime import datetime
from typing import AsyncGenerator

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
import uvicorn

from .config import get_settings
from .chat import get_conversation_manager
from .retrieval import get_knowledge_base
from .integrations import get_backend_client
from .agents import AgentFactory


@asynccontextmanager
async def lifespan(app: FastAPI) -> AsyncGenerator[None, None]:
    """Application lifespan handler for startup and shutdown."""
    # Startup
    settings = get_settings()
    print(f"Starting ADADIVE AI Service v2...")
    
    # Initialize knowledge base
    knowledge_base = get_knowledge_base()
    try:
        knowledge_base.initialize()
        doc_count = len(knowledge_base.vector_store.documents) if knowledge_base.vector_store else 0
        print(f"Knowledge base initialized with {doc_count} documents")
    except Exception as e:
        print(f"Warning: Could not initialize knowledge base: {e}")
    
    # Initialize agents
    print(f"Agents available: {[a.value for a in AgentFactory.list_agents()]}")
    
    # Test backend API connection (optional)
    backend_client = get_backend_client()
    try:
        healthy = await backend_client.health_check()
        print(f"Backend API health check: {'OK' if healthy else 'UNAVAILABLE'}")
    except Exception as e:
        print(f"Warning: Backend API unavailable: {e}")
    
    # Start conversation cleanup task
    cleanup_task = None
    if settings.conversation_max_age_seconds < 86400:  # Less than 24 hours
        async def cleanup_loop():
            import asyncio
            while True:
                await asyncio.sleep(settings.conversation_max_age_seconds)
                conv_manager = get_conversation_manager()
                removed = conv_manager.cleanup_old()
                if removed > 0:
                    print(f"Cleaned up {removed} old conversations")
        
        import asyncio
        cleanup_task = asyncio.create_task(cleanup_loop())
    
    yield
    
    # Shutdown
    if cleanup_task:
        cleanup_task.cancel()
    
    await backend_client.close()
    print("ADADIVE AI Service shutdown complete")


def create_app() -> FastAPI:
    """Create and configure the FastAPI application."""
    settings = get_settings()
    
    app = FastAPI(
        title="ADADIVE AI Service",
        description="AI-powered multi-agent chat service for ADADIVE decentralized storage platform v2",
        version="2.0.0",
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
        "version": "2.0.0",
        "status": "operational",
        "docs": "/docs",
        "features": [
            "Multi-agent support",
            "Streaming responses",
            "RAG-powered knowledge base",
            "Secure tool framework",
            "Conversation memory",
        ],
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
        "agents": "ok",
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
