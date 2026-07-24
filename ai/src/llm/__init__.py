"""LLM Provider module for ADADIVE AI v2.

This module provides production-ready LLM integration with support for:
- OpenAI (GPT-4o, GPT-4o-mini)
- Anthropic (Claude 3.5 Sonnet, Claude 3 Haiku)
- Streaming responses via SSE
- Configurable providers
"""

from .base import (
    LLMProvider,
    LLMResponse,
    LLMStreamChunk,
    GenerationOptions,
)
from .openai import OpenAIProvider
from .anthropic import AnthropicProvider
from .factory import get_llm_provider, configure_provider
from .registry import LLMRegistry

__all__ = [
    "LLMProvider",
    "LLMResponse",
    "LLMStreamChunk",
    "GenerationOptions",
    "OpenAIProvider",
    "AnthropicProvider",
    "get_llm_provider",
    "configure_provider",
    "LLMRegistry",
]
