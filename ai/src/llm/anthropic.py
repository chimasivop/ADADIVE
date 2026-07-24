"""Anthropic Claude LLM provider for ADADIVE AI v2."""

import json
from typing import Any, AsyncGenerator

import httpx

from .base import (
    LLMProvider,
    LLMResponse,
    LLMStreamChunk,
    GenerationOptions,
    Message,
    MessageRole,
)


class AnthropicProvider(LLMProvider):
    """Anthropic Claude 3.5/3 provider with streaming support."""

    BASE_URL = "https://api.anthropic.com/v1"
    API_VERSION = "2023-06-01"

    def __init__(
        self,
        api_key: str | None = None,
        model: str = "claude-sonnet-4-20250514",
        base_url: str | None = None,
        timeout: float = 120.0,
    ):
        super().__init__(api_key=api_key, model=model)
        self.base_url = base_url or self.BASE_URL
        self.timeout = timeout
        self._client: httpx.AsyncClient | None = None

    @property
    def provider_name(self) -> str:
        return "anthropic"

    @property
    def default_model(self) -> str:
        return "claude-sonnet-4-20250514"

    async def _get_client(self) -> httpx.AsyncClient:
        """Get or create the HTTP client."""
        if self._client is None:
            self._client = httpx.AsyncClient(
                base_url=self.base_url,
                timeout=self.timeout,
                headers={
                    "x-api-key": self.api_key or "",
                    "anthropic-version": self.API_VERSION,
                    "Content-Type": "application/json",
                },
            )
        return self._client

    async def close(self) -> None:
        """Close the HTTP client."""
        if self._client:
            await self._client.aclose()
            self._client = None

    def _build_messages_payload(
        self, messages: list[Message]
    ) -> tuple[str | None, list[dict[str, Any]]]:
        """Convert Message objects to Anthropic API format."""
        system_message = None
        anthropic_messages = []

        for msg in messages:
            role = msg.role.value if isinstance(msg.role, MessageRole) else msg.role
            if role == "system":
                system_message = msg.content
            else:
                anthropic_messages.append({
                    "role": role,
                    "content": msg.content,
                })

        return system_message, anthropic_messages

    async def generate(
        self,
        messages: list[Message | dict[str, Any]],
        options: GenerationOptions | None = None,
    ) -> LLMResponse:
        """Generate a non-streaming response from Anthropic."""
        normalized = self._normalize_messages(messages)
        options = options or GenerationOptions()
        model = options.model or self.model

        system_prompt, anthropic_messages = self._build_messages_payload(normalized)

        client = await self._get_client()
        payload: dict[str, Any] = {
            "model": model,
            "messages": anthropic_messages,
            "max_tokens": options.max_tokens,
        }

        if system_prompt:
            payload["system"] = system_prompt

        if options.temperature != 0.7:
            payload["temperature"] = options.temperature
        if options.top_p is not None:
            payload["top_p"] = options.top_p
        if options.stop_sequences:
            payload["stop_sequences"] = options.stop_sequences

        try:
            response = await client.post(
                "/messages",
                json=payload,
                headers={"anthropic-version": self.API_VERSION},
                timeout=self.timeout,
            )
            response.raise_for_status()
            data = response.json()

            content_blocks = data.get("content", [])
            response_text = ""
            for block in content_blocks:
                if block.get("type") == "text":
                    response_text = block.get("text", "")

            return LLMResponse(
                content=response_text,
                model=data.get("model", model),
                usage={
                    "input_tokens": data.get("usage", {}).get("input_tokens", 0),
                    "output_tokens": data.get("usage", {}).get("output_tokens", 0),
                },
                finish_reason=data.get("stop_reason"),
                raw_response=data,
            )
        except httpx.HTTPStatusError as e:
            raise RuntimeError(f"Anthropic API error: {e.response.status_code} - {e.response.text}")
        except Exception as e:
            raise RuntimeError(f"Anthropic API error: {str(e)}")

    async def stream(
        self,
        messages: list[Message | dict[str, Any]],
        options: GenerationOptions | None = None,
    ) -> AsyncGenerator[LLMStreamChunk, None]:
        """Generate a streaming response from Anthropic."""
        normalized = self._normalize_messages(messages)
        options = options or GenerationOptions()
        model = options.model or self.model

        system_prompt, anthropic_messages = self._build_messages_payload(normalized)

        client = await self._get_client()
        payload: dict[str, Any] = {
            "model": model,
            "messages": anthropic_messages,
            "max_tokens": options.max_tokens,
            "stream": True,
        }

        if system_prompt:
            payload["system"] = system_prompt

        if options.temperature != 0.7:
            payload["temperature"] = options.temperature
        if options.top_p is not None:
            payload["top_p"] = options.top_p
        if options.stop_sequences:
            payload["stop_sequences"] = options.stop_sequences

        try:
            async with client.stream("POST", "/messages", json=payload) as response:
                response.raise_for_status()
                async for line in response.aiter_lines():
                    if not line.strip() or line.startswith(":"):
                        continue

                    if line.startswith("data: "):
                        try:
                            data = json.loads(line[6:])
                        except json.JSONDecodeError:
                            continue

                        event_type = data.get("type")

                        if event_type == "content_block_delta":
                            delta = data.get("delta", {})
                            if delta.get("type") == "text_delta":
                                yield LLMStreamChunk(
                                    content=delta.get("text", ""),
                                    done=False,
                                )
                        elif event_type == "message_delta":
                            yield LLMStreamChunk(
                                content="",
                                done=True,
                                finish_reason=data.get("usage", {}).get("stop_reason"),
                            )
                        elif event_type == "message_stop":
                            yield LLMStreamChunk(content="", done=True)

        except httpx.HTTPStatusError as e:
            raise RuntimeError(f"Anthropic API error: {e.response.status_code} - {e.response.text}")
        except Exception as e:
            raise RuntimeError(f"Anthropic API error: {str(e)}")

    async def embed(self, texts: list[str]) -> list[list[float]]:
        """Anthropic doesn't have embeddings, use a fallback or OpenAI."""
        raise NotImplementedError(
            "Anthropic does not provide an embedding API. "
            "Configure a separate embedding provider."
        )
