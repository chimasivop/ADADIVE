"""LLM Provider registry for ADADIVE AI v2."""

from typing import Type

from .base import LLMProvider


class LLMRegistry:
    """Registry for LLM providers."""

    _providers: dict[str, Type[LLMProvider]] = {}

    @classmethod
    def register(cls, name: str, provider_class: Type[LLMProvider]) -> None:
        """Register a new LLM provider."""
        cls._providers[name] = provider_class

    @classmethod
    def get(cls, name: str) -> Type[LLMProvider] | None:
        """Get a provider class by name."""
        return cls._providers.get(name)

    @classmethod
    def list_providers(cls) -> list[str]:
        """List all registered provider names."""
        return list(cls._providers.keys())

    @classmethod
    def is_registered(cls, name: str) -> bool:
        """Check if a provider is registered."""
        return name in cls._providers


# Register built-in providers
from .openai import OpenAIProvider
from .anthropic import AnthropicProvider

LLMRegistry.register("openai", OpenAIProvider)
LLMRegistry.register("anthropic", AnthropicProvider)
