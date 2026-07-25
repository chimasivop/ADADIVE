"""Agents module for ADADIVE AI v2.

Provides specialized AI agents for different use cases:
- Support Agent: General platform support and troubleshooting
- Storage Agent: Storage deals and file management
- Escrow Agent: Smart contract and payment queries
- Provider Agent: Storage provider information and selection
- Developer Agent: Technical documentation and API usage
"""

from abc import ABC, abstractmethod
from dataclasses import dataclass, field
from typing import Any, AsyncGenerator
from enum import Enum

from pydantic import BaseModel, Field

from ..llm.base import Message, LLMProvider
from ..llm.factory import get_llm_provider
from ..auth import UserContext
from ..retrieval import get_knowledge_base
from ..tools import get_tool_registry, ToolResult, ToolDefinition
from ..config import get_settings


class AgentType(str, Enum):
    """Types of AI agents available."""
    SUPPORT = "support"
    STORAGE = "storage"
    ESCROW = "escrow"
    PROVIDER = "provider"
    DEVELOPER = "developer"


@dataclass
class AgentConfig:
    """Configuration for an AI agent."""
    agent_type: AgentType
    name: str
    description: str
    system_prompt: str
    tools: list[str] = field(default_factory=list)
    max_history: int = 10
    temperature: float = 0.7


@dataclass
class AgentResponse:
    """Response from an agent."""
    message: str
    agent_type: AgentType
    sources: list[dict[str, Any]] = field(default_factory=list)
    backend_references: list[dict[str, Any]] = field(default_factory=list)
    tool_results: list[dict[str, Any]] = field(default_factory=list)
    metadata: dict[str, Any] = field(default_factory=dict)


class BaseAgent(ABC):
    """
    Abstract base class for AI agents.
    
    Each agent specializes in a specific domain and has:
    - Custom system prompt
    - Domain-specific tools
    - Specialized response handling
    - Dashboard context awareness
    """

    def __init__(self, config: AgentConfig):
        self.config = config
        self.llm_provider = get_llm_provider()

    @abstractmethod
    def _build_system_prompt(self) -> str:
        """Build the agent's system prompt."""
        pass

    @abstractmethod
    async def _process_request(
        self,
        message: str,
        user_context: UserContext,
        conversation_history: list[Message],
    ) -> AgentResponse:
        """Process a user request and generate response."""
        pass

    async def chat(
        self,
        message: str,
        user_context: UserContext,
        conversation_history: list[Message] | None = None,
        page_context: str = "unknown",
    ) -> AgentResponse:
        """Main chat interface for the agent."""
        history = conversation_history or []
        return await self._process_request(message, user_context, history)

    async def stream(
        self,
        message: str,
        user_context: UserContext,
        conversation_history: list[Message] | None = None,
        page_context: str = "unknown",
    ) -> AsyncGenerator[str, None]:
        """Streaming chat interface for the agent."""
        response = await self.chat(message, user_context, conversation_history, page_context)
        # For now, yield the full response
        yield response.message

    def get_tools_for_llm(self) -> list[dict[str, Any]]:
        """Get tools formatted for LLM function calling."""
        registry = get_tool_registry()
        tool_defs = []
        
        for tool_name in self.config.tools:
            tool = registry.get(tool_name)
            if tool:
                def_dict = {
                    "type": "function",
                    "function": {
                        "name": tool.definition.name,
                        "description": tool.definition.description,
                        "parameters": tool.definition.parameters,
                    },
                }
                tool_defs.append(def_dict)
        
        return tool_defs

    async def execute_tool(
        self,
        tool_name: str,
        parameters: dict[str, Any],
        user_context: UserContext,
    ) -> ToolResult:
        """Execute a tool with permission checking."""
        registry = get_tool_registry()
        
        # Check permissions
        if not registry.can_use_tool(tool_name, user_context):
            return ToolResult(
                success=False,
                error=f"Not authorized to use tool: {tool_name}",
            )
        
        tool = registry.get(tool_name)
        if tool is None:
            return ToolResult(
                success=False,
                error=f"Tool not found: {tool_name}",
            )
        
        return await tool.execute(parameters, user_context)


# Support Agent
SUPPORT_AGENT_PROMPT = """You are ADADIVE Support Agent, a helpful AI assistant specializing in customer support and general platform guidance.

Your expertise includes:
- Answering questions about the ADADIVE platform
- Troubleshooting common issues
- Explaining platform features and how to use them
- Guiding users through getting started
- Providing billing and account information

IMPORTANT RESTRICTIONS:
- You CANNOT sign transactions or move funds
- You CANNOT access private keys
- You CANNOT execute blockchain transactions
- You should NEVER ask for passwords or sensitive credentials

When users encounter issues:
1. Ask clarifying questions to understand the problem
2. Check if the issue is documented in your knowledge base
3. Provide step-by-step troubleshooting guidance
4. If you cannot resolve the issue, suggest contacting human support

Be patient, empathetic, and thorough in your responses.
"""


class SupportAgent(BaseAgent):
    """Agent for general platform support and customer service."""

    def __init__(self):
        super().__init__(AgentConfig(
            agent_type=AgentType.SUPPORT,
            name="ADADIVE Support Agent",
            description="General platform support and troubleshooting",
            system_prompt=SUPPORT_AGENT_PROMPT,
            tools=["get_platform_info", "get_platform_stats", "get_escrow_info"],
        ))

    def _build_system_prompt(self, page_context: str = "unknown") -> str:
        prompt = self.config.system_prompt
        if page_context != "unknown":
            prompt += f"\n\nNote: The user is currently viewing the {page_context} page. Adapt your response to be most relevant to this context."
        return prompt

    async def _process_request(
        self,
        message: str,
        user_context: UserContext,
        conversation_history: list[Message],
    ) -> AgentResponse:
        from ..llm.base import GenerationOptions

        # Get knowledge context
        kb = get_knowledge_base()
        context = kb.get_relevant_context(message)
        
        # Build messages with page context awareness
        system_prompt = self._build_system_prompt()
        if context:
            system_prompt += f"\n\nRelevant Knowledge:\n{context}"

        messages = [{"role": "system", "content": system_prompt}]
        for msg in conversation_history[-self.config.max_history:]:
            messages.append({"role": msg.role, "content": msg.content})
        messages.append({"role": "user", "content": message})

        # Generate response
        response = await self.llm_provider.generate(
            messages,
            GenerationOptions(temperature=self.config.temperature),
        )

        # Get sources
        results = kb.retrieve(message, top_k=3)
        sources = [
            {"content": r.content[:200] + "...", "source": r.metadata.get("source"), "score": r.score}
            for r in results
        ]

        return AgentResponse(
            message=response.content,
            agent_type=AgentType.SUPPORT,
            sources=sources,
        )


# Storage Agent
STORAGE_AGENT_PROMPT = """You are ADADIVE Storage Agent, an AI assistant specializing in storage deals and file management.

Your expertise includes:
- Explaining storage deal creation and management
- Helping users understand storage pricing
- Explaining deal lifecycle (active, pending, completed, failed)
- File upload and CID management
- Storage duration and renewal

IMPORTANT RESTRICTIONS:
- You CANNOT sign transactions or move funds
- You CANNOT access private keys
- You CANNOT execute blockchain transactions

When discussing user deals:
- You CAN access user's deal information through authenticated tools
- Always explain that deal data is retrieved through secure API endpoints
- Never query databases directly

Be helpful and clear about storage concepts.
"""


class StorageAgent(BaseAgent):
    """Agent for storage deal and file management queries."""

    def __init__(self):
        super().__init__(AgentConfig(
            agent_type=AgentType.STORAGE,
            name="ADADIVE Storage Agent",
            description="Storage deals and file management assistance",
            system_prompt=STORAGE_AGENT_PROMPT,
            tools=["get_storage_deals", "get_platform_stats", "get_escrow_info"],
        ))

    def _build_system_prompt(self) -> str:
        return self.config.system_prompt

    async def _process_request(
        self,
        message: str,
        user_context: UserContext,
        conversation_history: list[Message],
    ) -> AgentResponse:
        from ..llm.base import GenerationOptions

        # Get knowledge context
        kb = get_knowledge_base()
        context = kb.get_relevant_context(message)

        # Build messages
        system_prompt = self._build_system_prompt()
        if context:
            system_prompt += f"\n\nRelevant Knowledge:\n{context}"

        messages = [{"role": "system", "content": system_prompt}]
        for msg in conversation_history[-self.config.max_history:]:
            messages.append({"role": msg.role, "content": msg.content})
        messages.append({"role": "user", "content": message})

        # Generate response
        response = await self.llm_provider.generate(
            messages,
            GenerationOptions(temperature=self.config.temperature),
        )

        # Get sources
        results = kb.retrieve(message, top_k=3)
        sources = [
            {"content": r.content[:200] + "...", "source": r.metadata.get("source"), "score": r.score}
            for r in results
        ]

        return AgentResponse(
            message=response.content,
            agent_type=AgentType.STORAGE,
            sources=sources,
        )


# Escrow Agent
ESCROW_AGENT_PROMPT = """You are ADADIVE Escrow Agent, an AI assistant specializing in smart contract and payment mechanics.

Your expertise includes:
- Explaining the ADADIVE escrow smart contract design
- Payment flow and settlement mechanics
- Deal phases (Locked, Settling, Completed, Refunded)
- Oracle attestation process
- Security properties of the contract

IMPORTANT RESTRICTIONS:
- You CANNOT sign transactions or move funds
- You CANNOT access private keys
- You CANNOT execute blockchain transactions
- You CANNOT modify smart contract state

Contract Security Principles:
- Payment is held securely until conditions are met
- Neither party can unilaterally access escrowed funds
- Oracle attestation is required for settlement
- Client refund is guaranteed after deadline if provider fails

Be precise and technical when explaining contract mechanics.
"""


class EscrowAgent(BaseAgent):
    """Agent for smart contract and escrow queries."""

    def __init__(self):
        super().__init__(AgentConfig(
            agent_type=AgentType.ESCROW,
            name="ADADIVE Escrow Agent",
            description="Smart contract and payment mechanics assistance",
            system_prompt=ESCROW_AGENT_PROMPT,
            tools=["get_escrow_info", "get_platform_stats"],
        ))

    def _build_system_prompt(self) -> str:
        return self.config.system_prompt

    async def _process_request(
        self,
        message: str,
        user_context: UserContext,
        conversation_history: list[Message],
    ) -> AgentResponse:
        from ..llm.base import GenerationOptions

        # Get knowledge context
        kb = get_knowledge_base()
        context = kb.get_relevant_context(message)

        # Build messages
        system_prompt = self._build_system_prompt()
        if context:
            system_prompt += f"\n\nRelevant Knowledge:\n{context}"

        messages = [{"role": "system", "content": system_prompt}]
        for msg in conversation_history[-self.config.max_history:]:
            messages.append({"role": msg.role, "content": msg.content})
        messages.append({"role": "user", "content": message})

        # Generate response
        response = await self.llm_provider.generate(
            messages,
            GenerationOptions(temperature=self.config.temperature),
        )

        # Get sources
        results = kb.retrieve(message, top_k=3)
        sources = [
            {"content": r.content[:200] + "...", "source": r.metadata.get("source"), "score": r.score}
            for r in results
        ]

        return AgentResponse(
            message=response.content,
            agent_type=AgentType.ESCROW,
            sources=sources,
        )


# Provider Agent
PROVIDER_AGENT_PROMPT = """You are ADADIVE Provider Agent, an AI assistant specializing in storage provider information.

Your expertise includes:
- Explaining storage provider selection
- Provider metrics and performance
- Pricing models used by providers
- Provider reliability and uptime
- How to become a storage provider

When discussing providers:
- Provide factual information about available providers
- Explain how to compare provider offerings
- Help users make informed decisions about provider selection
- Clarify that provider recommendations are informational only

Be helpful but neutral when discussing specific providers.
"""


class ProviderAgent(BaseAgent):
    """Agent for storage provider queries."""

    def __init__(self):
        super().__init__(AgentConfig(
            agent_type=AgentType.PROVIDER,
            name="ADADIVE Provider Agent",
            description="Storage provider information and selection assistance",
            system_prompt=PROVIDER_AGENT_PROMPT,
            tools=["get_provider_info", "get_platform_stats"],
        ))

    def _build_system_prompt(self) -> str:
        return self.config.system_prompt

    async def _process_request(
        self,
        message: str,
        user_context: UserContext,
        conversation_history: list[Message],
    ) -> AgentResponse:
        from ..llm.base import GenerationOptions

        # Get knowledge context
        kb = get_knowledge_base()
        context = kb.get_relevant_context(message)

        # Build messages
        system_prompt = self._build_system_prompt()
        if context:
            system_prompt += f"\n\nRelevant Knowledge:\n{context}"

        messages = [{"role": "system", "content": system_prompt}]
        for msg in conversation_history[-self.config.max_history:]:
            messages.append({"role": msg.role, "content": msg.content})
        messages.append({"role": "user", "content": message})

        # Generate response
        response = await self.llm_provider.generate(
            messages,
            GenerationOptions(temperature=self.config.temperature),
        )

        # Get sources
        results = kb.retrieve(message, top_k=3)
        sources = [
            {"content": r.content[:200] + "...", "source": r.metadata.get("source"), "score": r.score}
            for r in results
        ]

        return AgentResponse(
            message=response.content,
            agent_type=AgentType.PROVIDER,
            sources=sources,
        )


# Developer Agent
DEVELOPER_AGENT_PROMPT = """You are ADADIVE Developer Agent, an AI assistant specializing in technical documentation, API usage, and code generation.

Your expertise includes:
- ADADIVE API documentation and usage
- SDK integration guides
- Smart contract integration
- Webhook and event handling
- Troubleshooting integration issues
- Code generation for common use cases

When explaining technical concepts:
- Be precise and detailed
- Include code examples where helpful
- Reference official documentation
- Explain trade-offs and best practices

Code Generation Capabilities:
- Generate TypeScript/JavaScript SDK examples
- Generate Python integration examples
- Generate API request/response examples
- Generate webhook handler examples
- Generate smart contract interaction examples

Security Guidelines:
- Never include actual API keys or secrets in examples
- Always use placeholders like YOUR_API_KEY
- Emphasize the importance of keeping credentials secure
- Explain proper authentication patterns

Be technical and thorough.
"""


class DeveloperAgent(BaseAgent):
    """Agent for technical documentation, API queries, and code generation."""

    def __init__(self):
        super().__init__(AgentConfig(
            agent_type=AgentType.DEVELOPER,
            name="ADADIVE Developer Agent",
            description="Technical documentation, API integration, and code generation assistance",
            system_prompt=DEVELOPER_AGENT_PROMPT,
            tools=["get_platform_info", "get_escrow_info", "generate_code_example"],
        ))

    def _build_system_prompt(self) -> str:
        return self.config.system_prompt

    async def _process_request(
        self,
        message: str,
        user_context: UserContext,
        conversation_history: list[Message],
    ) -> AgentResponse:
        from ..llm.base import GenerationOptions

        # Get knowledge context
        kb = get_knowledge_base()
        context = kb.get_relevant_context(message)

        # Build messages
        system_prompt = self._build_system_prompt()
        if context:
            system_prompt += f"\n\nRelevant Knowledge:\n{context}"

        messages = [{"role": "system", "content": system_prompt}]
        for msg in conversation_history[-self.config.max_history:]:
            messages.append({"role": msg.role, "content": msg.content})
        messages.append({"role": "user", "content": message})

        # Generate response
        response = await self.llm_provider.generate(
            messages,
            GenerationOptions(temperature=self.config.temperature),
        )

        # Get sources
        results = kb.retrieve(message, top_k=3)
        sources = [
            {"content": r.content[:200] + "...", "source": r.metadata.get("source"), "score": r.score}
            for r in results
        ]

        return AgentResponse(
            message=response.content,
            agent_type=AgentType.DEVELOPER,
            sources=sources,
        )


# Agent Factory
class AgentFactory:
    """Factory for creating and managing agents."""

    _agents: dict[AgentType, BaseAgent] = {}

    @classmethod
    def get_agent(cls, agent_type: AgentType) -> BaseAgent:
        """Get an agent by type."""
        if agent_type not in cls._agents:
            cls._agents[agent_type] = cls._create_agent(agent_type)
        return cls._agents[agent_type]

    @classmethod
    def _create_agent(cls, agent_type: AgentType) -> BaseAgent:
        """Create a new agent instance."""
        agents = {
            AgentType.SUPPORT: SupportAgent,
            AgentType.STORAGE: StorageAgent,
            AgentType.ESCROW: EscrowAgent,
            AgentType.PROVIDER: ProviderAgent,
            AgentType.DEVELOPER: DeveloperAgent,
        }
        agent_class = agents.get(agent_type)
        if agent_class is None:
            raise ValueError(f"Unknown agent type: {agent_type}")
        return agent_class()

    @classmethod
    def list_agents(cls) -> list[dict[str, str]]:
        """List all available agents."""
        return [
            {"type": at.value, "name": at.value.capitalize() + " Agent"}
            for at in AgentType
        ]

    @classmethod
    def reset(cls) -> None:
        """Reset all agents (useful for testing)."""
        cls._agents = {}


__all__ = [
    "AgentType",
    "AgentConfig",
    "AgentResponse",
    "BaseAgent",
    "SupportAgent",
    "StorageAgent",
    "EscrowAgent",
    "ProviderAgent",
    "DeveloperAgent",
    "AgentFactory",
]
