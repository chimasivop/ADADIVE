"""OpenAI LLM provider for ADADIVE AI v2."""

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


class OpenAIProvider(LLMProvider):
    """OpenAI GPT-4o/GPT-4o-mini provider with streaming support."""

    BASE_URL = "https://api.openai.com/v1"

    def __init__(
        self,
        api_key: str | None = None,
        model: str = "gpt-4o-mini",
        base_url: str | None = None,
        timeout: float = 120.0,
    ):
        super().__init__(api_key=api_key, model=model)
        self.base_url = base_url or self.BASE_URL
        self.timeout = timeout
        self._client: httpx.AsyncClient | None = None

    @property
    def provider_name(self) -> str:
        return "openai"

    @property
    def default_model(self) -> str:
        return "gpt-4o-mini"

    async def _get_client(self) -> httpx.AsyncClient:
        """Get or create the HTTP client."""
        if self._client is None:
            self._client = httpx.AsyncClient(
                base_url=self.base_url,
                timeout=self.timeout,
                headers={"Authorization": f"Bearer {self.api_key}"},
            )
        return self._client

    async def close(self) -> None:
        """Close the HTTP client."""
        if self._client:
            await self._client.aclose()
            self._client = None

    def _build_messages_payload(
        self, messages: list[Message]
    ) -> list[dict[str, Any]]:
        """Convert Message objects to OpenAI API format."""
        result = []
        for msg in messages:
            msg_dict: dict[str, Any] = {
                "role": msg.role.value if isinstance(msg.role, MessageRole) else msg.role,
                "content": msg.content,
            }
            if msg.name:
                msg_dict["name"] = msg.name
            if msg.tool_call_id:
                msg_dict["tool_call_id"] = msg.tool_call_id
            result.append(msg_dict)
        return result

    async def generate(
        self,
        messages: list[Message | dict[str, Any]],
        options: GenerationOptions | None = None,
    ) -> LLMResponse:
        """Generate a non-streaming response from OpenAI."""
        normalized = self._normalize_messages(messages)
        options = options or GenerationOptions()
        model = options.model or self.model

        client = await self._get_client()
        payload: dict[str, Any] = {
            "model": model,
            "messages": self._build_messages_payload(normalized),
            "max_tokens": options.max_tokens,
            "temperature": options.temperature,
        }

        if options.top_p is not None:
            payload["top_p"] = options.top_p
        if options.stop_sequences:
            payload["stop"] = options.stop_sequences
        if options.frequency_penalty:
            payload["frequency_penalty"] = options.frequency_penalty
        if options.presence_penalty:
            payload["presence_penalty"] = options.presence_penalty

        try:
            response = await client.post(
                "/chat/completions",
                json=payload,
                timeout=self.timeout,
            )
            response.raise_for_status()
            data = response.json()

            return LLMResponse(
                content=data["choices"][0]["message"]["content"],
                model=data.get("model", model),
                usage=data.get("usage", {}),
                finish_reason=data["choices"][0].get("finish_reason"),
                raw_response=data,
            )
        except httpx.HTTPStatusError as e:
            raise RuntimeError(f"OpenAI API error: {e.response.status_code} - {e.response.text}")
        except Exception as e:
            raise RuntimeError(f"OpenAI API error: {str(e)}")

    async def stream(
        self,
        messages: list[Message | dict[str, Any]],
        options: GenerationOptions | None = None,
    ) -> AsyncGenerator[LLMStreamChunk, None]:
        """Generate a streaming response from OpenAI."""
        normalized = self._normalize_messages(messages)
        options = options or GenerationOptions()
        model = options.model or self.model

        client = await self._get_client()
        payload: dict[str, Any] = {
            "model": model,
            "messages": self._build_messages_payload(normalized),
            "max_tokens": options.max_tokens,
            "temperature": options.temperature,
            "stream": True,
        }

        if options.top_p is not None:
            payload["top_p"] = options.top_p
        if options.stop_sequences:
            payload["stop"] = options.stop_sequences
        if options.frequency_penalty:
            payload["frequency_penalty"] = options.frequency_penalty
        if options.presence_penalty:
            payload["presence_penalty"] = options.presence_penalty

        try:
            async with client.stream("POST", "/chat/completions", json=payload) as response:
                response.raise_for_status()
                async for line in response.aiter_lines():
                    if not line.strip() or line.startswith(":"):
                        continue

                    if line.startswith("data: "):
                        try:
                            data = json.loads(line[6:])
                        except json.JSONDecodeError:
                            continue

                        choices = data.get("choices", [])
                        if choices:
                            delta = choices[0].get("delta", {})
                            content = delta.get("content", "")
                            finish_reason = choices[0].get("finish_reason")

                            yield LLMStreamChunk(
                                content=content,
                                done=finish_reason is not None,
                                finish_reason=finish_reason,
                                usage=data.get("usage"),
                            )
        except httpx.HTTPStatusError as e:
            raise RuntimeError(f"OpenAI API error: {e.response.status_code} - {e.response.text}")
        except Exception as e:
            raise RuntimeError(f"OpenAI API error: {str(e)}")

    async def embed(self, texts: list[str]) -> list[list[float]]:
        """Generate embeddings using OpenAI's embedding model."""
        client = await self._get_client()

        try:
            response = await client.post(
                "/embeddings",
                json={
                    "model": "text-embedding-3-small",
                    "input": texts,
                },
                timeout=60.0,
            )
            response.raise_for_status()
            data = response.json()

            return [item["embedding"] for item in data["data"]]
        except httpx.HTTPStatusError as e:
            raise RuntimeError(f"OpenAI embedding error: {e.response.status_code}")
        except Exception as e:
            raise RuntimeError(f"OpenAI embedding error: {str(e)}")
