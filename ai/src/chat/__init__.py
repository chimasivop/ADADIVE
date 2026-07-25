"""Chat module for ADADIVE AI v2.

Provides the main chat interface with support for:
- Multiple AI agents (Support, Storage, Escrow, Provider, Developer)
- Streaming responses
- Conversation memory
- Tool execution
- RAG augmentation
- Dashboard context awareness
"""

from dataclasses import dataclass, field
from datetime import datetime
from typing import Any, AsyncGenerator
from enum import Enum

from pydantic import BaseModel, Field

from ..config import get_settings
from ..auth import UserContext, AuthStatus, get_user_context
from ..retrieval import get_knowledge_base
from ..llm.base import Message, GenerationOptions
from ..llm.factory import get_llm_provider
from ..memory import ConversationMemory, get_memory_store, MemoryMessage
from ..agents import AgentType, AgentFactory, AgentResponse
from ..streaming import StreamEvent, StreamEventType, StreamingChat
from ..tools import get_tool_registry


class DashboardPage(str, Enum):
    """Available dashboard pages for context awareness."""
    UNKNOWN = "unknown"
    DASHBOARD = "dashboard"
    PROVIDERS = "providers"
    DEALS = "deals"
    ESCROW = "escrow"
    STORAGE = "storage"
    WALLET = "wallet"
    ADMIN = "admin"
    SETTINGS = "settings"


# Request/Response Models
class ChatRequest(BaseModel):
    """Request to the /chat endpoint."""
    message: str = Field(description="User's message")
    token: str | None = Field(default=None, description="JWT token for authentication")
    anonymous_id: str | None = Field(default=None, description="Anonymous session ID")
    conversation_id: str | None = Field(
        default=None,
        description="Optional conversation ID for context"
    )
    agent_type: str | None = Field(
        default=None,
        description="Agent type to use (support, storage, escrow, provider, developer)"
    )
    page_context: DashboardPage = Field(
        default=DashboardPage.UNKNOWN,
        description="Current dashboard page context"
    )
    enable_rag: bool | None = Field(
        default=None,
        description="Enable retrieval-augmented generation"
    )
    enable_streaming: bool = Field(
        default=False,
        description="Enable streaming response"
    )


class ChatResponse(BaseModel):
    """Response from the /chat endpoint."""
    message: str = Field(description="AI's response")
    conversation_id: str = Field(description="Conversation ID for follow-up")
    agent_type: str = Field(description="Agent type used")
    sources: list[dict[str, Any]] = Field(
        default_factory=list,
        description="Source documents used for RAG"
    )
    backend_references: list[dict[str, Any]] = Field(
        default_factory=list,
        description="Backend API endpoints used to generate this response"
    )
    page_context: str = Field(
        default="unknown",
        description="Dashboard page context when response was generated"
    )
    user_context: dict[str, Any] | None = Field(
        default=None,
        description="User context if authenticated"
    )
    timestamp: str = Field(description="ISO timestamp of the response")


class StreamChunk(BaseModel):
    """A chunk of a streaming response."""
    event: str = Field(description="Event type")
    data: dict[str, Any] = Field(description="Event data")


class Message(BaseModel):
    """A chat message."""
    role: str = Field(description="Role: 'user' or 'assistant'")
    content: str = Field(description="Message content")


# Conversation Management
@dataclass
class ConversationContext:
    """Context for a conversation session."""
    conversation_id: str
    user_context: UserContext
    agent_type: AgentType
    memory: ConversationMemory
    page_context: DashboardPage = DashboardPage.UNKNOWN
    created_at: datetime = field(default_factory=datetime.utcnow)
    last_updated: datetime = field(default_factory=datetime.utcnow)


class ConversationManager:
    """Manages conversation contexts using memory store."""

    def __init__(self):
        self._memory_store = get_memory_store()

    def get_or_create(
        self,
        conversation_id: str | None,
        user_context: UserContext,
        agent_type: AgentType = AgentType.SUPPORT,
    ) -> ConversationContext:
        """Get existing or create new conversation."""
        memory = self._memory_store.get_or_create(conversation_id, user_context.user_id)
        new_id = memory.conversation_id

        return ConversationContext(
            conversation_id=new_id,
            user_context=user_context,
            agent_type=agent_type,
            memory=memory,
        )

    def add_message(
        self,
        conversation_id: str,
        role: str,
        content: str,
    ) -> None:
        """Add a message to conversation history."""
        memory = self._memory_store.get(conversation_id)
        if memory:
            memory.add_message(role, content)

    def cleanup_old(self) -> int:
        """Remove old conversation contexts."""
        return self._memory_store.cleanup_old()


# Global conversation manager
_conversation_manager: ConversationManager | None = None


def get_conversation_manager() -> ConversationManager:
    """Get the global conversation manager."""
    global _conversation_manager
    if _conversation_manager is None:
        _conversation_manager = ConversationManager()
    return _conversation_manager


# Main Chat Functions
async def generate_response(
    user_message: str,
    user_context: UserContext,
    agent_type: AgentType = AgentType.SUPPORT,
    enable_rag: bool = True,
    conversation_history: list[Message] | None = None,
    page_context: DashboardPage = DashboardPage.UNKNOWN,
) -> tuple[str, list[dict[str, Any]], list[dict[str, Any]]]:
    """
    Generate an AI response using the specified agent.
    
    Args:
        user_message: The user's message
        user_context: The authenticated user context
        agent_type: Type of agent to use
        enable_rag: Whether to use RAG
        conversation_history: Previous messages in the conversation
        page_context: Current dashboard page context
    
    Returns:
        Tuple of (response_text, sources, backend_references)
    """
    settings = get_settings()

    # Get the agent
    agent = AgentFactory.get_agent(agent_type)

    # Convert history for agent
    history_messages = []
    if conversation_history:
        history_messages = [
            Message(role=msg.role, content=msg.content)
            for msg in conversation_history[-10:]
        ]

    # Generate response using agent with page context
    response = await agent.chat(
        message=user_message,
        user_context=user_context,
        conversation_history=history_messages,
        page_context=page_context,
    )

    return response.message, response.sources, response.backend_references


async def generate_streaming_response(
    user_message: str,
    user_context: UserContext,
    agent_type: AgentType = AgentType.SUPPORT,
    enable_rag: bool = True,
    conversation_history: list[Message] | None = None,
    page_context: DashboardPage = DashboardPage.UNKNOWN,
) -> AsyncGenerator[StreamEvent, None]:
    """
    Generate a streaming AI response.
    
    Args:
        user_message: The user's message
        user_context: The authenticated user context
        agent_type: Type of agent to use
        enable_rag: Whether to use RAG
        conversation_history: Previous messages in the conversation
        page_context: Current dashboard page context
    
    Yields:
        StreamEvent objects
    """
    settings = get_settings()
    streaming_chat = StreamingChat()
    llm = get_llm_provider()

    # Get knowledge context if RAG is enabled
    context = ""
    sources = []
    if enable_rag and settings.enable_rag:
        kb = get_knowledge_base()
        context = kb.get_relevant_context(user_message)
        results = kb.retrieve(user_message, top_k=3)
        sources = [
            {"content": r.content[:200] + "...", "source": r.metadata.get("source"), "score": r.score}
            for r in results
        ]

    # Build page context info for the system prompt
    page_context_info = ""
    if page_context != DashboardPage.UNKNOWN:
        page_context_info = f"\n\nCURRENT DASHBOARD PAGE: You are currently on the {page_context.value} page. Adapt your response to be most relevant to this context.\n"
        if page_context == DashboardPage.PROVIDERS:
            page_context_info += "The user is browsing storage providers. Focus on provider-related information.\n"
        elif page_context == DashboardPage.DEALS:
            page_context_info += "The user is viewing their storage deals. Focus on deal status and management.\n"
        elif page_context == DashboardPage.ESCROW:
            page_context_info += "The user is viewing escrow/contract details. Focus on payment and settlement.\n"
        elif page_context == DashboardPage.STORAGE:
            page_context_info += "The user is managing storage. Focus on storage operations and file management.\n"
        elif page_context == DashboardPage.WALLET:
            page_context_info += "The user is viewing their wallet. Be careful about sensitive information.\n"
        elif page_context == DashboardPage.ADMIN:
            page_context_info += "The user is in the admin section. Provide administrative insights.\n"

    # Build system prompt
    system_prompt = f"""You are ADADIVE AI, a helpful assistant for the ADADIVE decentralized storage platform.
{page_context_info}
IMPORTANT RESTRICTIONS:
- You CANNOT sign transactions or move funds without explicit user confirmation
- You CANNOT access private keys
- You CANNOT execute blockchain transactions directly

{context}

Be helpful, accurate, and concise. When uncertain, acknowledge limitations."""

    # Build messages
    messages = [{"role": "system", "content": system_prompt}]
    
    if conversation_history:
        for msg in conversation_history[-10:]:
            messages.append({"role": msg.role, "content": msg.content})
    
    messages.append({"role": "user", "content": user_message})

    # Send sources first
    for i, source in enumerate(sources):
        yield StreamEvent(
            event=StreamEventType.SOURCE,
            data={
                "index": i,
                "source": source.get("source"),
                "score": source.get("score"),
            },
        )

    # Stream the response
    full_response = ""
    async for chunk in llm.stream(messages, GenerationOptions(temperature=0.7)):
        if chunk.content:
            full_response += chunk.content
            yield StreamEvent(
                event=StreamEventType.TOKEN,
                data={"token": chunk.content, "done": chunk.done},
            )

        if chunk.done:
            yield StreamEvent(
                event=StreamEventType.DONE,
                data={
                    "full_response": full_response,
                    "finish_reason": chunk.finish_reason,
                    "agent_type": agent_type.value,
                },
            )


def determine_agent_type(
    message: str,
    user_context: UserContext,
    page_context: DashboardPage = DashboardPage.UNKNOWN,
) -> AgentType:
    """
    Determine which agent to use based on message content and page context.
    
    Args:
        message: User's message
        user_context: User context
        page_context: Current dashboard page context
        
    Returns:
        AgentType to use
    """
    settings = get_settings()
    message_lower = message.lower()

    # First check message keywords for explicit intent
    if any(kw in message_lower for kw in ["provider", "hosting", "storage host"]):
        return AgentType.PROVIDER
    elif any(kw in message_lower for kw in ["contract", "escrow", "payment", "settle", "refund"]):
        return AgentType.ESCROW
    elif any(kw in message_lower for kw in ["storage deal", "file", "upload", "cid", "store"]):
        return AgentType.STORAGE
    elif any(kw in message_lower for kw in ["api", "sdk", "integration", "code", "develop", "technical"]):
        return AgentType.DEVELOPER
    elif any(kw in message_lower for kw in ["deal", "my deal", "my storage", "my files"]):
        return AgentType.STORAGE
    
    # If no keyword match, use page context as a hint
    if page_context != DashboardPage.UNKNOWN:
        page_to_agent = {
            DashboardPage.PROVIDERS: AgentType.PROVIDER,
            DashboardPage.DEALS: AgentType.STORAGE,
            DashboardPage.ESCROW: AgentType.ESCROW,
            DashboardPage.STORAGE: AgentType.STORAGE,
            DashboardPage.WALLET: AgentType.SUPPORT,
            DashboardPage.ADMIN: AgentType.SUPPORT,
            DashboardPage.DASHBOARD: AgentType.SUPPORT,
            DashboardPage.SETTINGS: AgentType.SUPPORT,
        }
        return page_to_agent.get(page_context, AgentType(settings.default_agent))
    
    # Default to configured default or support
    return AgentType(settings.default_agent)


# Legacy compatibility
async def call_llm(messages: list[dict[str, str]]) -> str:
    """
    Call the LLM API to generate a response (legacy compatibility).
    """
    settings = get_settings()
    llm = get_llm_provider()
    
    if settings.llm_provider == "openai" and settings.openai_api_key:
        response = await llm.generate(messages)
        return response.content
    elif settings.llm_provider == "anthropic" and settings.anthropic_api_key:
        response = await llm.generate(messages)
        return response.content
    else:
        return _generate_fallback_response(messages)


def _generate_fallback_response(messages: list[dict[str, str]]) -> str:
    """Generate a helpful fallback response when no LLM is configured."""
    last_message = ""
    for msg in reversed(messages):
        if msg.get("role") == "user":
            last_message = msg.get("content", "")
            break
    
    return (
        "I'm ADADIVE AI v2, your assistant for the ADADIVE decentralized storage platform.\n\n"
        "Currently, I'm operating in demo mode as no LLM provider is configured. "
        "To enable full AI capabilities:\n\n"
        "1. **OpenAI**: Set `AI_OPENAI_API_KEY` in your environment\n"
        "2. **Anthropic**: Set `AI_ANTHROPIC_API_KEY` in your environment\n"
        "3. **Ollama** (local): Set `AI_OLLAMA_MODEL` in your environment\n\n"
        f"Your question was: *\"{last_message[:100]}\"*\n\n"
        "Once configured, I can help with:\n"
        "- Storage deals and providers\n"
        "- Smart contract mechanics\n"
        "- Platform support\n"
        "- Developer documentation"
    )


__all__ = [
    "ChatRequest",
    "ChatResponse",
    "StreamChunk",
    "Message",
    "ConversationContext",
    "ConversationManager",
    "get_conversation_manager",
    "generate_response",
    "generate_streaming_response",
    "determine_agent_type",
    "call_llm",
    "DashboardPage",
]
