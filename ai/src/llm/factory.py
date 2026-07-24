"""LLM Provider factory for ADADIVE AI v2."""

from typing import Any

from ..config import get_settings
from .base import LLMProvider, GenerationOptions
from .registry import LLMRegistry


def configure_provider(
    provider_name: str | None = None,
    api_key: str | None = None,
    model: str | None = None,
    **kwargs: Any,
) -> LLMProvider:
    """
    Configure and return an LLM provider instance.

    Args:
        provider_name: Name of the provider (openai, anthropic, etc.)
        api_key: API key for the provider
        model: Model to use
        **kwargs: Additional provider-specific options

    Returns:
        Configured LLMProvider instance

    Raises:
        ValueError: If provider is not supported
    """
    settings = get_settings()
    provider_name = provider_name or settings.llm_provider

    provider_class = LLMRegistry.get(provider_name)
    if provider_class is None:
        raise ValueError(
            f"Unknown LLM provider: {provider_name}. "
            f"Available providers: {LLMRegistry.list_providers()}"
        )

    # Get provider-specific settings
    if provider_name == "openai":
        return provider_class(
            api_key=api_key or settings.openai_api_key,
            model=model or settings.openai_model,
            **kwargs,
        )
    elif provider_name == "anthropic":
        return provider_class(
            api_key=api_key or settings.anthropic_api_key,
            model=model or settings.anthropic_model,
            **kwargs,
        )
    else:
        return provider_class(
            api_key=api_key,
            model=model,
            **kwargs,
        )


# Global provider instance
_llm_provider: LLMProvider | None = None


def get_llm_provider() -> LLMProvider:
    """
    Get the global LLM provider instance.

    Returns:
        Configured LLMProvider instance
    """
    global _llm_provider
    if _llm_provider is None:
        settings = get_settings()
        _llm_provider = configure_provider()
    return _llm_provider


def reset_llm_provider() -> None:
    """Reset the global LLM provider (useful for testing)."""
    global _llm_provider
    if _llm_provider is not None:
        import asyncio
        try:
            loop = asyncio.get_running_loop()
            loop.create_task(_llm_provider.close())
        except RuntimeError:
            pass
    _llm_provider = None
