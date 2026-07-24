"""Memory module for ADADIVE AI v2.

Provides conversation memory management with:
- In-memory storage (default)
- Optional Redis support for persistence
- Message history management
- Context summarization
"""

from dataclasses import dataclass, field
from datetime import datetime
from typing import Any
from enum import Enum

from ..config import get_settings


class MemoryType(str, Enum):
    """Type of memory stored."""
    SHORT_TERM = "short_term"  # Current conversation
    LONG_TERM = "long_term"    # Persistent across sessions


@dataclass
class MemoryMessage:
    """A message stored in memory."""
    role: str
    content: str
    timestamp: datetime = field(default_factory=datetime.utcnow)
    metadata: dict[str, Any] = field(default_factory=dict)


@dataclass
class ConversationMemory:
    """Memory for a single conversation."""
    conversation_id: str
    user_id: str | None
    messages: list[MemoryMessage] = field(default_factory=list)
    created_at: datetime = field(default_factory=datetime.utcnow)
    last_updated: datetime = field(default_factory=datetime.utcnow)
    metadata: dict[str, Any] = field(default_factory=dict)

    def add_message(self, role: str, content: str, metadata: dict[str, Any] | None = None) -> None:
        """Add a message to memory."""
        self.messages.append(MemoryMessage(
            role=role,
            content=content,
            metadata=metadata or {},
        ))
        self.last_updated = datetime.utcnow()

    def get_recent_messages(self, count: int = 10) -> list[MemoryMessage]:
        """Get the most recent messages."""
        return self.messages[-count:]

    def get_context_for_llm(self, system_prompt: str | None = None, max_messages: int = 20) -> list[dict[str, str]]:
        """Get messages formatted for LLM context."""
        messages = self.get_recent_messages(max_messages)
        result = []
        
        if system_prompt:
            result.append({"role": "system", "content": system_prompt})
        
        for msg in messages:
            result.append({"role": msg.role, "content": msg.content})
        
        return result

    def clear(self) -> None:
        """Clear all messages."""
        self.messages = []
        self.last_updated = datetime.utcnow()


class MemoryStore:
    """
    In-memory store for conversation memories.
    
    Provides a simple key-value store for conversations with
    automatic cleanup of old conversations.
    """

    def __init__(self, max_age_seconds: int = 3600):
        settings = get_settings()
        self.max_age_seconds = max_age_seconds or settings.conversation_max_age_seconds
        self._conversations: dict[str, ConversationMemory] = {}

    def create(self, conversation_id: str, user_id: str | None = None) -> ConversationMemory:
        """Create a new conversation memory."""
        memory = ConversationMemory(
            conversation_id=conversation_id,
            user_id=user_id,
        )
        self._conversations[conversation_id] = memory
        return memory

    def get(self, conversation_id: str) -> ConversationMemory | None:
        """Get a conversation memory by ID."""
        return self._conversations.get(conversation_id)

    def get_or_create(self, conversation_id: str, user_id: str | None = None) -> ConversationMemory:
        """Get existing or create new conversation memory."""
        memory = self.get(conversation_id)
        if memory is None:
            memory = self.create(conversation_id, user_id)
        return memory

    def delete(self, conversation_id: str) -> bool:
        """Delete a conversation memory."""
        if conversation_id in self._conversations:
            del self._conversations[conversation_id]
            return True
        return False

    def list_conversations(self, user_id: str | None = None) -> list[str]:
        """List conversation IDs, optionally filtered by user."""
        if user_id:
            return [
                conv_id for conv_id, mem in self._conversations.items()
                if mem.user_id == user_id
            ]
        return list(self._conversations.keys())

    def cleanup_old(self) -> int:
        """Remove conversations older than max_age_seconds."""
        now = datetime.utcnow()
        to_remove = []
        
        for conv_id, memory in self._conversations.items():
            age = (now - memory.last_updated).total_seconds()
            if age > self.max_age_seconds:
                to_remove.append(conv_id)
        
        for conv_id in to_remove:
            del self._conversations[conv_id]
        
        return len(to_remove)

    def get_stats(self) -> dict[str, Any]:
        """Get statistics about the memory store."""
        now = datetime.utcnow()
        active_count = sum(
            1 for mem in self._conversations.values()
            if (now - mem.last_updated).total_seconds() <= self.max_age_seconds
        )
        
        return {
            "total_conversations": len(self._conversations),
            "active_conversations": active_count,
            "total_messages": sum(len(m.messages) for m in self._conversations.values()),
        }


# Global memory store instance
_memory_store: MemoryStore | None = None


def get_memory_store() -> MemoryStore:
    """Get the global memory store instance."""
    global _memory_store
    if _memory_store is None:
        settings = get_settings()
        _memory_store = MemoryStore(
            max_age_seconds=settings.conversation_max_age_seconds
        )
    return _memory_store


def reset_memory_store() -> None:
    """Reset the global memory store (useful for testing)."""
    global _memory_store
    _memory_store = None


__all__ = [
    "MemoryMessage",
    "ConversationMemory",
    "MemoryStore",
    "MemoryType",
    "get_memory_store",
    "reset_memory_store",
]
