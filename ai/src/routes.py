"""API routes for ADADIVE AI v2 service."""

import asyncio
from datetime import datetime
from typing import Any

from fastapi import APIRouter, HTTPException, Request, Response
from fastapi.responses import StreamingResponse

from .chat import (
    ChatRequest,
    ChatResponse,
    Message,
    DashboardPage,
    get_conversation_manager,
    generate_response,
    generate_streaming_response,
    determine_agent_type,
)
from .auth import get_user_context, AuthStatus
from .config import get_settings
from .agents import AgentType, AgentFactory
from .tools import get_tool_registry


router = APIRouter(prefix="/ai", tags=["AI"])


@router.post("/chat", response_model=ChatResponse)
async def chat(request: ChatRequest) -> ChatResponse:
    """
    Chat endpoint for AI interactions.
    
    Accepts user messages and returns AI-powered responses.
    Supports both anonymous and authenticated users.
    Dashboard context is automatically inferred from page_context parameter.
    """
    settings = get_settings()
    
    # Validate message length
    if len(request.message) > settings.max_message_length:
        raise HTTPException(
            status_code=400,
            detail=f"Message too long. Maximum length is {settings.max_message_length} characters.",
        )
    
    # Get user context
    user_context = get_user_context(
        token=request.token,
        anonymous_id=request.anonymous_id,
    )
    
    # Determine agent type with page context awareness
    if request.agent_type:
        try:
            agent_type = AgentType(request.agent_type)
        except ValueError:
            agent_type = determine_agent_type(request.message, user_context, request.page_context)
    else:
        agent_type = determine_agent_type(request.message, user_context, request.page_context)
    
    # Get conversation manager
    conv_manager = get_conversation_manager()
    
    # Get or create conversation
    conv = conv_manager.get_or_create(
        conversation_id=request.conversation_id,
        user_context=user_context,
        agent_type=agent_type,
    )
    
    # Determine if RAG is enabled
    enable_rag = request.enable_rag if request.enable_rag is not None else settings.enable_rag
    
    # Add user message to history
    conv_manager.add_message(conv.conversation_id, "user", request.message)
    
    # Generate response with dashboard context awareness
    response_text, sources, backend_refs = await generate_response(
        user_message=request.message,
        user_context=user_context,
        agent_type=agent_type,
        enable_rag=enable_rag,
        conversation_history=conv.memory.messages,
        page_context=request.page_context,
    )
    
    # Add assistant response to history
    conv_manager.add_message(conv.conversation_id, "assistant", response_text)
    
    # Build user context info for response
    user_context_info = None
    if user_context.auth_status == AuthStatus.AUTHENTICATED:
        user_context_info = {
            "user_id": user_context.user_id,
            "wallet_address": user_context.wallet_address,
        }
    elif user_context.auth_status == AuthStatus.ANONYMOUS:
        user_context_info = {
            "session_id": user_context.user_id,
        }
    
    return ChatResponse(
        message=response_text,
        conversation_id=conv.conversation_id,
        agent_type=agent_type.value,
        sources=sources,
        backend_references=backend_refs,
        page_context=request.page_context.value,
        user_context=user_context_info,
        timestamp=datetime.utcnow().isoformat(),
    )


@router.post("/chat/stream")
async def chat_stream(request: ChatRequest):
    """
    Streaming chat endpoint for AI interactions.
    
    Returns Server-Sent Events (SSE) for real-time response streaming.
    Dashboard context is automatically inferred from page_context parameter.
    """
    settings = get_settings()
    
    if len(request.message) > settings.max_message_length:
        raise HTTPException(
            status_code=400,
            detail=f"Message too long. Maximum length is {settings.max_message_length} characters.",
        )
    
    user_context = get_user_context(
        token=request.token,
        anonymous_id=request.anonymous_id,
    )
    
    # Determine agent type with page context awareness
    if request.agent_type:
        try:
            agent_type = AgentType(request.agent_type)
        except ValueError:
            agent_type = determine_agent_type(request.message, user_context, request.page_context)
    else:
        agent_type = determine_agent_type(request.message, user_context, request.page_context)
    
    conv_manager = get_conversation_manager()
    conv = conv_manager.get_or_create(
        conversation_id=request.conversation_id,
        user_context=user_context,
        agent_type=agent_type,
    )
    
    enable_rag = request.enable_rag if request.enable_rag is not None else settings.enable_rag
    
    async def event_generator():
        """Generate SSE events for streaming response."""
        conv_manager.add_message(conv.conversation_id, "user", request.message)
        
        streaming_chat = None
        try:
            from .streaming import StreamingChat
            streaming_chat = StreamingChat()
            
            async for event in generate_streaming_response(
                user_message=request.message,
                user_context=user_context,
                agent_type=agent_type,
                enable_rag=enable_rag,
                conversation_history=conv.memory.messages,
                page_context=request.page_context,
            ):
                yield streaming_chat.event_to_bytes(event)
        except Exception as e:
            error_event = f"event: error\ndata: {{\"error\": \"{str(e)}\"}}\n\n"
            yield error_event.encode("utf-8")
        
        # Add final response to history
        # Note: Full response is built client-side from tokens
    
    return StreamingResponse(
        event_generator(),
        media_type="text/event-stream",
        headers={
            "X-Conversation-ID": conv.conversation_id,
            "X-Agent-Type": agent_type.value,
            "X-Page-Context": request.page_context.value,
        },
    )


@router.get("/chat/history/{conversation_id}")
async def get_chat_history(conversation_id: str) -> dict[str, Any]:
    """Get the message history for a conversation."""
    conv_manager = get_conversation_manager()
    memory = conv_manager._memory_store.get(conversation_id)
    
    if memory is None:
        raise HTTPException(
            status_code=404,
            detail="Conversation not found",
        )
    
    return {
        "conversation_id": memory.conversation_id,
        "messages": [
            {"role": m.role, "content": m.content, "timestamp": m.timestamp.isoformat()}
            for m in memory.messages
        ],
        "created_at": memory.created_at.isoformat(),
        "last_updated": memory.last_updated.isoformat(),
    }


@router.delete("/chat/history/{conversation_id}")
async def delete_chat_history(conversation_id: str) -> dict[str, str]:
    """Delete a conversation history."""
    conv_manager = get_conversation_manager()
    
    if conv_manager._memory_store.delete(conversation_id):
        return {"status": "deleted", "conversation_id": conversation_id}
    
    raise HTTPException(
        status_code=404,
        detail="Conversation not found",
    )


@router.get("/sources")
async def get_sources(query: str, top_k: int = 5) -> dict[str, Any]:
    """Get relevant knowledge sources for a query."""
    from .retrieval import get_knowledge_base
    
    knowledge_base = get_knowledge_base()
    results = knowledge_base.retrieve(query, top_k=top_k)
    
    return {
        "query": query,
        "results": [
            {
                "content": r.content[:500] + "..." if len(r.content) > 500 else r.content,
                "source": r.metadata.get("source", "unknown"),
                "category": r.metadata.get("category", "unknown"),
                "score": round(r.score, 3),
            }
            for r in results
        ],
    }


@router.get("/agents")
async def list_agents() -> dict[str, Any]:
    """List all available AI agents."""
    return {
        "agents": AgentFactory.list_agents(),
    }


@router.get("/tools")
async def list_tools() -> dict[str, Any]:
    """List all available tools."""
    registry = get_tool_registry()
    
    return {
        "tools": registry.list_tools(),
    }


@router.get("/config")
async def get_config() -> dict[str, Any]:
    """Get public configuration for the AI service."""
    settings = get_settings()
    
    return {
        "version": "3.0.0",
        "llm_provider": settings.llm_provider,
        "openai_model": settings.openai_model if settings.llm_provider == "openai" else None,
        "anthropic_model": settings.anthropic_model if settings.llm_provider == "anthropic" else None,
        "features": {
            "rag_enabled": settings.enable_rag,
            "user_context_enabled": settings.enable_user_context,
            "auth_enabled": settings.auth_enabled,
            "streaming_enabled": settings.enable_streaming,
        },
        "agents": [a.value for a in AgentType],
    }


@router.post("/auth/validate")
async def validate_token(token: str) -> dict[str, Any]:
    """Validate a JWT token and return user info."""
    from .auth import verify_token
    
    payload = verify_token(token)
    
    if payload:
        return {
            "valid": True,
            "user_id": payload.sub,
            "wallet_address": payload.wallet_address,
            "permissions": payload.permissions,
        }
    
    return {
        "valid": False,
        "status": "invalid",
    }


@router.get("/memory/stats")
async def get_memory_stats() -> dict[str, Any]:
    """Get conversation memory statistics."""
    conv_manager = get_conversation_manager()
    return conv_manager._memory_store.get_stats()


# Re-export for convenience
__all__ = ["router"]
