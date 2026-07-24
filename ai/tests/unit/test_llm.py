"""Tests for LLM providers."""

import pytest
from unittest.mock import AsyncMock, MagicMock, patch

from src.llm.base import (
    Message,
    MessageRole,
    GenerationOptions,
    LLMResponse,
    LLMStreamChunk,
    LLMProvider,
)
from src.llm.openai import OpenAIProvider
from src.llm.anthropic import AnthropicProvider
from src.llm.registry import LLMRegistry


class TestMessage:
    """Tests for Message dataclass."""

    def test_message_creation(self):
        """Test creating a message."""
        msg = Message(role="user", content="Hello")
        assert msg.role == "user"
        assert msg.content == "Hello"
        assert msg.name is None
        assert msg.tool_call_id is None

    def test_message_with_optional_fields(self):
        """Test message with optional fields."""
        msg = Message(
            role=MessageRole.ASSISTANT,
            content="Hi there",
            name="test",
            tool_call_id="tool_123",
        )
        assert msg.role == MessageRole.ASSISTANT
        assert msg.name == "test"
        assert msg.tool_call_id == "tool_123"


class TestGenerationOptions:
    """Tests for GenerationOptions."""

    def test_default_options(self):
        """Test default generation options."""
        opts = GenerationOptions()
        assert opts.max_tokens == 4096
        assert opts.temperature == 0.7
        assert opts.top_p is None
        assert opts.stop_sequences is None

    def test_custom_options(self):
        """Test custom generation options."""
        opts = GenerationOptions(
            model="gpt-4",
            max_tokens=2000,
            temperature=0.5,
            top_p=0.9,
        )
        assert opts.model == "gpt-4"
        assert opts.max_tokens == 2000
        assert opts.temperature == 0.5
        assert opts.top_p == 0.9


class TestLLMResponse:
    """Tests for LLMResponse."""

    def test_response_creation(self):
        """Test creating an LLM response."""
        response = LLMResponse(
            content="Hello, world!",
            model="gpt-4o-mini",
        )
        assert response.content == "Hello, world!"
        assert response.model == "gpt-4o-mini"
        assert response.usage == {}
        assert response.finish_reason is None

    def test_response_with_metadata(self):
        """Test response with metadata."""
        response = LLMResponse(
            content="Test",
            model="claude-sonnet",
            usage={"input_tokens": 100, "output_tokens": 50},
            finish_reason="stop",
        )
        assert response.usage["input_tokens"] == 100
        assert response.finish_reason == "stop"


class TestLLMStreamChunk:
    """Tests for LLMStreamChunk."""

    def test_chunk_creation(self):
        """Test creating a stream chunk."""
        chunk = LLMStreamChunk(content="Hello")
        assert chunk.content == "Hello"
        assert chunk.done is False

    def test_final_chunk(self):
        """Test creating a final chunk."""
        chunk = LLMStreamChunk(
            content="",
            done=True,
            finish_reason="stop",
        )
        assert chunk.content == ""
        assert chunk.done is True
        assert chunk.finish_reason == "stop"


class TestLLMRegistry:
    """Tests for LLMRegistry."""

    def test_register_and_get(self):
        """Test registering and retrieving a provider."""
        class MockProvider(LLMProvider):
            @property
            def provider_name(self):
                return "mock"
            
            @property
            def default_model(self):
                return "mock-model"
            
            async def generate(self, messages, options=None):
                return LLMResponse(content="mock", model="mock-model")
            
            async def stream(self, messages, options=None):
                yield LLMStreamChunk(content="mock", done=True)
            
            async def embed(self, texts):
                return [[0.0] * 10]

        LLMRegistry.register("mock", MockProvider)
        assert "mock" in LLMRegistry.list_providers()
        assert LLMRegistry.is_registered("mock")

    def test_list_providers(self):
        """Test listing providers."""
        providers = LLMRegistry.list_providers()
        assert "openai" in providers
        assert "anthropic" in providers


class TestOpenAIProvider:
    """Tests for OpenAI provider."""

    def test_provider_properties(self):
        """Test provider properties."""
        provider = OpenAIProvider(api_key="test-key", model="gpt-4o")
        assert provider.provider_name == "openai"
        assert provider.default_model == "gpt-4o-mini"
        assert provider.model == "gpt-4o"

    def test_build_messages_payload(self):
        """Test building messages payload."""
        provider = OpenAIProvider(api_key="test")
        messages = [
            Message(role="system", content="You are helpful"),
            Message(role="user", content="Hello"),
        ]
        payload = provider._build_messages_payload(messages)
        assert len(payload) == 2
        assert payload[0]["role"] == "system"
        assert payload[1]["role"] == "user"


class TestAnthropicProvider:
    """Tests for Anthropic provider."""

    def test_provider_properties(self):
        """Test provider properties."""
        provider = AnthropicProvider(api_key="test-key", model="claude-sonnet")
        assert provider.provider_name == "anthropic"
        assert provider.default_model == "claude-sonnet-4-20250514"
        assert provider.model == "claude-sonnet"

    def test_build_messages_payload(self):
        """Test building messages payload."""
        provider = AnthropicProvider(api_key="test")
        messages = [
            Message(role="system", content="You are helpful"),
            Message(role="user", content="Hello"),
        ]
        system, anthropic_messages = provider._build_messages_payload(messages)
        assert system == "You are helpful"
        assert len(anthropic_messages) == 1
        assert anthropic_messages[0]["role"] == "user"
