"""Base LLM provider interface for ADADIVE AI v2."""

from abc import ABC, abstractmethod
from dataclasses import dataclass, field
from typing import AsyncGenerator, Any
from enum import Enum


class MessageRole(str, Enum):
    """Message role in a conversation."""
    SYSTEM = "system"
    USER = "user"
    ASSISTANT = "assistant"
    TOOL = "tool"


@dataclass
class Message:
    """A message in a conversation."""
    role: MessageRole | str
    content: str
    name: str | None = None
    tool_call_id: str | None = None


@dataclass
class GenerationOptions:
    """Options for text generation."""
    model: str | None = None
    max_tokens: int = 4096
    temperature: float = 0.7
    top_p: float | None = None
    stop_sequences: list[str] | None = None
    frequency_penalty: float = 0.0
    presence_penalty: float = 0.0
    response_format: dict[str, Any] | None = None


@dataclass
class LLMResponse:
    """Response from an LLM provider."""
    content: str
    model: str
    usage: dict[str, int] = field(default_factory=dict)
    finish_reason: str | None = None
    raw_response: dict[str, Any] | None = None


@dataclass
class LLMStreamChunk:
    """A chunk of a streaming response."""
    content: str
    done: bool = False
    finish_reason: str | None = None
    usage: dict[str, int] | None = None


class LLMProvider(ABC):
    """Abstract base class for LLM providers."""

    def __init__(self, api_key: str | None = None, model: str | None = None):
        self.api_key = api_key
        self.model = model

    @property
    @abstractmethod
    def provider_name(self) -> str:
        """Return the provider name."""
        pass

    @property
    @abstractmethod
    def default_model(self) -> str:
        """Return the default model for this provider."""
        pass

    @abstractmethod
    async def generate(
        self,
        messages: list[Message | dict[str, Any]],
        options: GenerationOptions | None = None,
    ) -> LLMResponse:
        """
        Generate a response from the LLM.

        Args:
            messages: List of conversation messages
            options: Generation options

        Returns:
            LLMResponse with generated content
        """
        pass

    @abstractmethod
    async def stream(
        self,
        messages: list[Message | dict[str, Any]],
        options: GenerationOptions | None = None,
    ) -> AsyncGenerator[LLMStreamChunk, None]:
        """
        Generate a streaming response from the LLM.

        Args:
            messages: List of conversation messages
            options: Generation options

        Yields:
            LLMStreamChunk with partial content
        """
        pass

    @abstractmethod
    async def embed(self, texts: list[str]) -> list[list[float]]:
        """
        Generate embeddings for texts.

        Args:
            texts: List of texts to embed

        Returns:
            List of embedding vectors
        """
        pass

    def _normalize_messages(
        self, messages: list[Message | dict[str, Any]]
    ) -> list[Message]:
        """Normalize messages to Message objects."""
        normalized = []
        for msg in messages:
            if isinstance(msg, dict):
                role = msg.get("role", "user")
                normalized.append(Message(
                    role=role,
                    content=msg.get("content", ""),
                    name=msg.get("name"),
                    tool_call_id=msg.get("tool_call_id"),
                ))
            elif isinstance(msg, Message):
                normalized.append(msg)
        return normalized
