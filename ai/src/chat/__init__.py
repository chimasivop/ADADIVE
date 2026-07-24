"""Chat module for ADADIVE AI service."""

import json
from datetime import datetime
from typing import Any, AsyncGenerator
from dataclasses import dataclass, field

from pydantic import BaseModel, Field

from ..config import get_settings
from ..auth import UserContext, get_user_context, AuthStatus
from ..prompts import get_prompt_template, build_augmented_prompt
from ..retrieval import get_knowledge_base
from ..integrations import get_backend_client


class Message(BaseModel):
    """A chat message."""
    role: str = Field(description="Role: 'user' or 'assistant'")
    content: str = Field(description="Message content")


class ChatRequest(BaseModel):
    """Request to the /chat endpoint."""
    message: str = Field(description="User's message")
    token: str | None = Field(default=None, description="JWT token for authentication")
    anonymous_id: str | None = Field(default=None, description="Anonymous session ID")
    conversation_id: str | None = Field(
        default=None, 
        description="Optional conversation ID for context"
    )
    enable_rag: bool | None = Field(
        default=None, 
        description="Enable retrieval-augmented generation"
    )


class ChatResponse(BaseModel):
    """Response from the /chat endpoint."""
    message: str = Field(description="AI's response")
    conversation_id: str = Field(description="Conversation ID for follow-up")
    sources: list[dict[str, Any]] = Field(
        default_factory=list,
        description="Source documents used for RAG"
    )
    user_context: dict[str, Any] | None = Field(
        default=None,
        description="User context if authenticated"
    )
    timestamp: str = Field(description="ISO timestamp of the response")


class StreamChunk(BaseModel):
    """A chunk of a streaming response."""
    content: str = Field(description="Content of this chunk")
    done: bool = Field(description="Whether this is the final chunk")


@dataclass
class ConversationContext:
    """Context for a conversation session."""
    conversation_id: str
    user_context: UserContext
    history: list[Message] = field(default_factory=list)
    created_at: datetime = field(default_factory=datetime.utcnow)
    last_updated: datetime = field(default_factory=datetime.utcnow)


class ConversationManager:
    """Manages conversation contexts."""

    def __init__(self, max_history: int = 20):
        self.max_history = max_history
        self._conversations: dict[str, ConversationContext] = {}

    def get_or_create(
        self,
        conversation_id: str | None,
        user_context: UserContext,
    ) -> ConversationContext:
        """Get existing or create new conversation."""
        if conversation_id and conversation_id in self._conversations:
            ctx = self._conversations[conversation_id]
            ctx.last_updated = datetime.utcnow()
            return ctx
        
        import uuid
        new_id = conversation_id or str(uuid.uuid4())
        
        ctx = ConversationContext(
            conversation_id=new_id,
            user_context=user_context,
        )
        self._conversations[new_id] = ctx
        return ctx

    def add_message(self, conversation_id: str, message: Message) -> None:
        """Add a message to conversation history."""
        if conversation_id in self._conversations:
            ctx = self._conversations[conversation_id]
            ctx.history.append(message)
            
            # Trim history if needed
            if len(ctx.history) > self.max_history:
                ctx.history = ctx.history[-self.max_history :]

    def cleanup_old(self, max_age_seconds: int = 3600) -> int:
        """Remove old conversation contexts."""
        now = datetime.utcnow()
        to_remove = []
        
        for conv_id, ctx in self._conversations.items():
            age = (now - ctx.last_updated).total_seconds()
            if age > max_age_seconds:
                to_remove.append(conv_id)
        
        for conv_id in to_remove:
            del self._conversations[conv_id]
        
        return len(to_remove)


async def generate_response(
    user_message: str,
    user_context: UserContext,
    enable_rag: bool = True,
    conversation_history: list[Message] | None = None,
) -> tuple[str, list[dict[str, Any]]]:
    """
    Generate an AI response to a user message.
    
    Args:
        user_message: The user's message
        user_context: The authenticated user context
        enable_rag: Whether to use retrieval-augmented generation
        conversation_history: Previous messages in the conversation
    
    Returns:
        Tuple of (response_text, sources)
    """
    settings = get_settings()
    sources = []
    
    # Build context for prompt
    context: dict[str, Any] = {}
    
    # Add RAG context if enabled
    if enable_rag and settings.enable_rag:
        knowledge_base = get_knowledge_base()
        relevant_knowledge = knowledge_base.get_relevant_context(user_message)
        context["relevant_knowledge"] = relevant_knowledge
        
        # Get sources for citation
        results = knowledge_base.retrieve(user_message, top_k=3)
        sources = [
            {
                "content": r.content[:200] + "..." if len(r.content) > 200 else r.content,
                "source": r.metadata.get("source", "unknown"),
                "score": round(r.score, 3),
            }
            for r in results
        ]
    
    # Add user-specific data if authenticated and enabled
    if (
        user_context.auth_status == AuthStatus.AUTHENTICATED
        and user_context.wallet_address
        and settings.enable_user_context
    ):
        backend_client = get_backend_client()
        user_summary = await backend_client.get_user_storage_summary(
            user_context.wallet_address
        )
        context["user_deals_data"] = json.dumps(user_summary, indent=2)
    
    # Determine query type based on message content
    message_lower = user_message.lower()
    if "deal" in message_lower or "storage deal" in message_lower:
        query_type = "deals"
    elif "provider" in message_lower or "storage provider" in message_lower:
        query_type = "providers"
    elif "contract" in message_lower or "escrow" in message_lower or "smart contract" in message_lower:
        query_type = "contracts"
    elif user_context.auth_status == AuthStatus.AUTHENTICATED and "my" in message_lower:
        query_type = "user_deals"
    else:
        query_type = "general"
    
    # Get and build prompt
    template = get_prompt_template(query_type)
    system_prompt, user_prompt = build_augmented_prompt(template, user_message, context)
    
    # Build conversation for context
    messages = [{"role": "system", "content": system_prompt}]
    
    # Add conversation history
    if conversation_history:
        for msg in conversation_history[-10:]:  # Limit history
            messages.append({"role": msg.role, "content": msg.content})
    
    messages.append({"role": "user", "content": user_prompt})
    
    # TODO: Integrate with actual LLM API
    # For now, return a placeholder response
    response = await call_llm(messages)
    
    return response, sources


async def call_llm(messages: list[dict[str, str]]) -> str:
    """
    Call the LLM API to generate a response.
    
    This is a placeholder that will be implemented with actual LLM integration.
    """
    settings = get_settings()
    
    # Placeholder response - in production, this will call the actual LLM
    # The response depends on the LLM provider
    
    if settings.llm_provider == "openai" and settings.openai_api_key:
        return await _call_openai(messages, settings)
    elif settings.llm_provider == "anthropic" and settings.anthropic_api_key:
        return await _call_anthropic(messages, settings)
    elif settings.llm_provider == "ollama":
        return await _call_ollama(messages, settings)
    else:
        # Fallback response when no LLM is configured
        return _generate_fallback_response(messages)


async def _call_openai(messages: list[dict[str, str]], settings) -> str:
    """Call OpenAI API."""
    import httpx
    
    async with httpx.AsyncClient() as client:
        response = await client.post(
            "https://api.openai.com/v1/chat/completions",
            headers={
                "Authorization": f"Bearer {settings.openai_api_key}",
                "Content-Type": "application/json",
            },
            json={
                "model": settings.openai_model,
                "messages": messages,
                "max_tokens": 1000,
                "temperature": 0.7,
            },
            timeout=60.0,
        )
        response.raise_for_status()
        data = response.json()
        return data["choices"][0]["message"]["content"]


async def _call_anthropic(messages: list[dict[str, str]], settings) -> str:
    """Call Anthropic API."""
    import httpx
    
    # Convert messages format for Anthropic
    system_msg = ""
    anthropic_messages = []
    
    for msg in messages:
        if msg["role"] == "system":
            system_msg = msg["content"]
        else:
            anthropic_messages.append({
                "role": msg["role"],
                "content": msg["content"],
            })
    
    async with httpx.AsyncClient() as client:
        response = await client.post(
            "https://api.anthropic.com/v1/messages",
            headers={
                "x-api-key": settings.anthropic_api_key,
                "anthropic-version": "2023-06-01",
                "Content-Type": "application/json",
            },
            json={
                "model": settings.anthropic_model,
                "system": system_msg,
                "messages": anthropic_messages,
                "max_tokens": 1000,
            },
            timeout=60.0,
        )
        response.raise_for_status()
        data = response.json()
        return data["content"][0]["text"]


async def _call_ollama(messages: list[dict[str, str]], settings) -> str:
    """Call local Ollama API."""
    import httpx
    
    # Convert messages format for Ollama
    combined_content = ""
    for msg in messages:
        if msg["role"] == "system":
            combined_content += f"System: {msg['content']}\n\n"
        else:
            combined_content += f"{msg['role'].capitalize()}: {msg['content']}\n"
    
    async with httpx.AsyncClient() as client:
        response = await client.post(
            f"{settings.ollama_base_url}/api/generate",
            json={
                "model": settings.ollama_model,
                "prompt": combined_content,
                "stream": False,
            },
            timeout=120.0,
        )
        response.raise_for_status()
        data = response.json()
        return data.get("response", "I apologize, but I couldn't generate a response.")


def _generate_fallback_response(messages: list[dict[str, str]]) -> str:
    """Generate a helpful fallback response when no LLM is configured."""
    last_message = ""
    for msg in reversed(messages):
        if msg["role"] == "user":
            last_message = msg["content"]
            break
    
    return (
        "I'm ADADIVE AI, your assistant for the ADADIVE decentralized storage platform.\n\n"
        "Currently, I'm operating in demo mode as no LLM provider is configured. "
        "To enable full AI capabilities:\n\n"
        "1. **OpenAI**: Set `AI_OPENAI_API_KEY` in your environment\n"
        "2. **Anthropic**: Set `AI_ANTHROPIC_API_KEY` in your environment\n"
        "3. **Ollama** (local): Set `AI_OLLAMA_MODEL` in your environment\n\n"
        "Your question was: *\"" + last_message[:100] + "\"*\n\n"
        "Once configured, I'll be able to answer your questions about:\n"
        "- ADADIVE platform features and how it works\n"
        "- Storage deals and providers\n"
        "- Smart contract mechanics (deal escrow)\n"
        "- Pricing and duration options\n"
        "- And with authentication, your personal storage history"
    )


# Global conversation manager
_conversation_manager: ConversationManager | None = None


def get_conversation_manager() -> ConversationManager:
    """Get the global conversation manager."""
    global _conversation_manager
    if _conversation_manager is None:
        _conversation_manager = ConversationManager()
    return _conversation_manager
