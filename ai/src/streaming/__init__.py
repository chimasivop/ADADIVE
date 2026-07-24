"""Streaming module for ADADIVE AI v2.

Provides Server-Sent Events (SSE) streaming for real-time chat responses.
"""

import json
import asyncio
from typing import AsyncGenerator, Any
from dataclasses import dataclass
from enum import Enum

from ..llm.base import LLMProvider, LLMStreamChunk, GenerationOptions
from ..llm.factory import get_llm_provider


class StreamEventType(str, Enum):
    """Types of SSE events."""
    TOKEN = "token"
    SOURCE = "source"
    TOOL_CALL = "tool_call"
    TOOL_RESULT = "tool_result"
    AGENT_SWITCH = "agent_switch"
    ERROR = "error"
    DONE = "done"


@dataclass
class StreamEvent:
    """An SSE event."""
    event: StreamEventType
    data: dict[str, Any]

    def to_sse(self) -> str:
        """Convert to SSE format."""
        return f"event: {self.event.value}\ndata: {json.dumps(self.data)}\n\n"


class StreamingChat:
    """
    Handles streaming chat responses with SSE.
    
    Features:
    - Real-time token streaming
    - Source citation streaming
    - Tool call/result streaming
    - Agent switching events
    """

    def __init__(self, llm_provider: LLMProvider | None = None):
        self.llm_provider = llm_provider or get_llm_provider()

    async def stream_response(
        self,
        messages: list[dict[str, str]],
        options: GenerationOptions | None = None,
    ) -> AsyncGenerator[StreamEvent, None]:
        """
        Stream an LLM response as SSE events.
        
        Args:
            messages: Conversation messages
            options: Generation options
            
        Yields:
            StreamEvent objects for SSE transmission
        """
        try:
            full_response = ""
            async for chunk in self.llm_provider.stream(messages, options):
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
                            "usage": chunk.usage,
                        },
                    )

        except Exception as e:
            yield StreamEvent(
                event=StreamEventType.ERROR,
                data={"error": str(e)},
            )

    async def stream_with_sources(
        self,
        messages: list[dict[str, str]],
        sources: list[dict[str, Any]],
        options: GenerationOptions | None = None,
    ) -> AsyncGenerator[StreamEvent, None]:
        """
        Stream response with source citations.
        
        Args:
            messages: Conversation messages
            sources: Retrieved sources for context
            options: Generation options
            
        Yields:
            StreamEvent objects including source events
        """
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
        async for event in self.stream_response(messages, options):
            yield event

    def event_to_bytes(self, event: StreamEvent) -> bytes:
        """Convert a StreamEvent to bytes for SSE transmission."""
        return event.to_sse().encode("utf-8")


def create_sse_response(
    events: AsyncGenerator[StreamEvent, None],
) -> AsyncGenerator[bytes, None]:
    """
    Convert StreamEvent generator to SSE response bytes.
    
    Args:
        events: StreamEvent generator
        
    Yields:
        Bytes suitable for StreamingResponse
    """
    async def event_generator():
        streaming = StreamingChat()
        async for event in events:
            yield streaming.event_to_bytes(event)

    return event_generator()


# Convenience functions
async def stream_chat(
    messages: list[dict[str, str]],
    options: GenerationOptions | None = None,
) -> AsyncGenerator[str, None]:
    """
    Simple streaming chat that yields text chunks.
    
    Args:
        messages: Conversation messages
        options: Generation options
        
    Yields:
        Text chunks of the response
    """
    llm = get_llm_provider()
    async for chunk in llm.stream(messages, options):
        if chunk.content:
            yield chunk.content


__all__ = [
    "StreamEventType",
    "StreamEvent",
    "StreamingChat",
    "create_sse_response",
    "stream_chat",
]
