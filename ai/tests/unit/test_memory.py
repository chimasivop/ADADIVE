"""Tests for memory module."""

import pytest
from datetime import datetime, timedelta

from src.memory import (
    MemoryMessage,
    ConversationMemory,
    MemoryStore,
    MemoryType,
    get_memory_store,
    reset_memory_store,
)


class TestMemoryMessage:
    """Tests for MemoryMessage."""

    def test_message_creation(self):
        """Test creating a memory message."""
        msg = MemoryMessage(role="user", content="Hello")
        assert msg.role == "user"
        assert msg.content == "Hello"
        assert msg.timestamp is not None
        assert msg.metadata == {}

    def test_message_with_metadata(self):
        """Test message with metadata."""
        msg = MemoryMessage(
            role="assistant",
            content="Hi",
            metadata={"source": "llm", "model": "gpt-4"},
        )
        assert msg.metadata["source"] == "llm"


class TestConversationMemory:
    """Tests for ConversationMemory."""

    def test_conversation_creation(self):
        """Test creating conversation memory."""
        memory = ConversationMemory(
            conversation_id="conv_123",
            user_id="user_456",
        )
        assert memory.conversation_id == "conv_123"
        assert memory.user_id == "user_456"
        assert memory.messages == []
        assert memory.created_at is not None

    def test_add_message(self):
        """Test adding a message to memory."""
        memory = ConversationMemory(conversation_id="conv_123", user_id="user_456")
        memory.add_message("user", "Hello")
        memory.add_message("assistant", "Hi there")
        
        assert len(memory.messages) == 2
        assert memory.messages[0].content == "Hello"
        assert memory.messages[1].role == "assistant"

    def test_get_recent_messages(self):
        """Test getting recent messages."""
        memory = ConversationMemory(conversation_id="conv_123", user_id="user_456")
        for i in range(15):
            memory.add_message("user", f"Message {i}")
        
        recent = memory.get_recent_messages(5)
        assert len(recent) == 5
        assert recent[-1].content == "Message 14"

    def test_get_context_for_llm(self):
        """Test getting context for LLM."""
        memory = ConversationMemory(conversation_id="conv_123", user_id="user_456")
        memory.add_message("user", "Hello")
        memory.add_message("assistant", "Hi")
        memory.add_message("user", "How are you?")
        
        context = memory.get_context_for_llm(system_prompt="You are helpful")
        assert len(context) == 4  # system + 3 messages
        assert context[0]["role"] == "system"
        assert context[0]["content"] == "You are helpful"

    def test_clear(self):
        """Test clearing memory."""
        memory = ConversationMemory(conversation_id="conv_123", user_id="user_456")
        memory.add_message("user", "Hello")
        memory.add_message("assistant", "Hi")
        
        memory.clear()
        assert len(memory.messages) == 0


class TestMemoryStore:
    """Tests for MemoryStore."""

    def setup_method(self):
        """Reset memory store before each test."""
        reset_memory_store()

    def test_create_memory(self):
        """Test creating new memory."""
        store = MemoryStore(max_age_seconds=3600)
        memory = store.create("conv_123", "user_456")
        
        assert memory.conversation_id == "conv_123"
        assert memory.user_id == "user_456"

    def test_get_memory(self):
        """Test getting memory."""
        store = MemoryStore(max_age_seconds=3600)
        store.create("conv_123", "user_456")
        
        memory = store.get("conv_123")
        assert memory is not None
        assert memory.conversation_id == "conv_123"

    def test_get_nonexistent_memory(self):
        """Test getting non-existent memory."""
        store = MemoryStore(max_age_seconds=3600)
        memory = store.get("nonexistent")
        assert memory is None

    def test_get_or_create(self):
        """Test get or create."""
        store = MemoryStore(max_age_seconds=3600)
        
        # Create new
        memory1 = store.get_or_create("conv_123", "user_456")
        assert memory1.conversation_id == "conv_123"
        
        # Get existing
        memory2 = store.get_or_create("conv_123", "user_456")
        assert memory2 is memory1  # Same object

    def test_delete_memory(self):
        """Test deleting memory."""
        store = MemoryStore(max_age_seconds=3600)
        store.create("conv_123", "user_456")
        
        assert store.delete("conv_123") is True
        assert store.get("conv_123") is None
        
        assert store.delete("nonexistent") is False

    def test_list_conversations(self):
        """Test listing conversations."""
        store = MemoryStore(max_age_seconds=3600)
        store.create("conv_1", "user_1")
        store.create("conv_2", "user_2")
        store.create("conv_3", "user_1")
        
        all_convs = store.list_conversations()
        assert len(all_convs) == 3
        
        user1_convs = store.list_conversations(user_id="user_1")
        assert len(user1_convs) == 2

    def test_cleanup_old(self):
        """Test cleaning up old conversations."""
        store = MemoryStore(max_age_seconds=1)  # 1 second for testing
        
        # Create old conversation
        memory = store.create("old_conv", "user")
        memory.last_updated = datetime.utcnow() - timedelta(seconds=10)
        
        # Create recent conversation
        store.create("recent_conv", "user")
        
        removed = store.cleanup_old()
        assert removed == 1
        assert store.get("old_conv") is None
        assert store.get("recent_conv") is not None

    def test_get_stats(self):
        """Test getting memory stats."""
        store = MemoryStore(max_age_seconds=3600)
        memory = store.create("conv_1", "user_1")
        memory.add_message("user", "Hello")
        memory.add_message("assistant", "Hi")
        
        stats = store.get_stats()
        assert stats["total_conversations"] == 1
        assert stats["total_messages"] == 2


class TestMemoryStoreGlobal:
    """Tests for global memory store."""

    def setup_method(self):
        """Reset memory store before each test."""
        reset_memory_store()

    def test_get_memory_store(self):
        """Test getting global memory store."""
        store1 = get_memory_store()
        store2 = get_memory_store()
        assert store1 is store2  # Same instance

    def test_reset_memory_store(self):
        """Test resetting global memory store."""
        store1 = get_memory_store()
        store1.create("test", "user")
        
        reset_memory_store()
        
        store2 = get_memory_store()
        assert store2.get("test") is None
        assert store1 is not store2
