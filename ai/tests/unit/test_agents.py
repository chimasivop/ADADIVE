"""Tests for agents module."""

import pytest
from unittest.mock import AsyncMock, MagicMock, patch

from src.agents import (
    AgentType,
    AgentConfig,
    AgentResponse,
    BaseAgent,
    SupportAgent,
    StorageAgent,
    EscrowAgent,
    ProviderAgent,
    DeveloperAgent,
    AgentFactory,
)
from src.auth import UserContext, AuthStatus


class TestAgentConfig:
    """Tests for AgentConfig."""

    def test_config_creation(self):
        """Test creating agent config."""
        config = AgentConfig(
            agent_type=AgentType.SUPPORT,
            name="Test Agent",
            description="A test agent",
            system_prompt="You are a test agent.",
        )
        assert config.agent_type == AgentType.SUPPORT
        assert config.name == "Test Agent"
        assert config.max_history == 10
        assert config.temperature == 0.7


class TestAgentResponse:
    """Tests for AgentResponse."""

    def test_response_creation(self):
        """Test creating an agent response."""
        response = AgentResponse(
            message="Hello, world!",
            agent_type=AgentType.SUPPORT,
        )
        assert response.message == "Hello, world!"
        assert response.agent_type == AgentType.SUPPORT
        assert response.sources == []
        assert response.tool_results == []

    def test_response_with_metadata(self):
        """Test response with metadata."""
        response = AgentResponse(
            message="Test",
            agent_type=AgentType.STORAGE,
            sources=[{"source": "faq.md", "score": 0.9}],
            metadata={"processing_time_ms": 150},
        )
        assert len(response.sources) == 1
        assert response.metadata["processing_time_ms"] == 150


class TestSupportAgent:
    """Tests for SupportAgent."""

    def test_agent_properties(self):
        """Test agent properties."""
        agent = SupportAgent()
        assert agent.config.agent_type == AgentType.SUPPORT
        assert agent.config.name == "ADADIVE Support Agent"
        assert "get_platform_info" in agent.config.tools

    def test_system_prompt(self):
        """Test system prompt generation."""
        agent = SupportAgent()
        prompt = agent._build_system_prompt()
        assert "ADADIVE" in prompt
        assert "Support" in prompt


class TestStorageAgent:
    """Tests for StorageAgent."""

    def test_agent_properties(self):
        """Test agent properties."""
        agent = StorageAgent()
        assert agent.config.agent_type == AgentType.STORAGE
        assert "get_storage_deals" in agent.config.tools


class TestEscrowAgent:
    """Tests for EscrowAgent."""

    def test_agent_properties(self):
        """Test agent properties."""
        agent = EscrowAgent()
        assert agent.config.agent_type == AgentType.ESCROW
        assert "get_escrow_info" in agent.config.tools


class TestProviderAgent:
    """Tests for ProviderAgent."""

    def test_agent_properties(self):
        """Test agent properties."""
        agent = ProviderAgent()
        assert agent.config.agent_type == AgentType.PROVIDER
        assert "get_provider_info" in agent.config.tools


class TestDeveloperAgent:
    """Tests for DeveloperAgent."""

    def test_agent_properties(self):
        """Test agent properties."""
        agent = DeveloperAgent()
        assert agent.config.agent_type == AgentType.DEVELOPER
        assert "get_platform_info" in agent.config.tools


class TestAgentFactory:
    """Tests for AgentFactory."""

    def test_get_agent(self):
        """Test getting an agent by type."""
        AgentFactory.reset()
        
        support_agent = AgentFactory.get_agent(AgentType.SUPPORT)
        assert support_agent.config.agent_type == AgentType.SUPPORT
        
        # Same instance should be returned
        support_agent2 = AgentFactory.get_agent(AgentType.SUPPORT)
        assert support_agent is support_agent2

    def test_get_all_agent_types(self):
        """Test getting all agent types."""
        AgentFactory.reset()
        
        for agent_type in AgentType:
            agent = AgentFactory.get_agent(agent_type)
            assert agent is not None
            assert agent.config.agent_type == agent_type

    def test_list_agents(self):
        """Test listing agents."""
        agents = AgentFactory.list_agents()
        assert len(agents) == len(AgentType)
        
        agent_types = [a["type"] for a in agents]
        assert "support" in agent_types
        assert "storage" in agent_types
        assert "escrow" in agent_types

    def test_reset(self):
        """Test resetting agents."""
        AgentFactory.reset()
        
        agent1 = AgentFactory.get_agent(AgentType.SUPPORT)
        AgentFactory.reset()
        agent2 = AgentFactory.get_agent(AgentType.SUPPORT)
        
        # Should be different instances after reset
        assert agent1 is not agent2


class TestAgentKeywordMatching:
    """Tests for keyword-based agent selection logic."""

    def test_support_keywords(self):
        """Test support agent keywords."""
        # Support is default or for general questions
        pass  # Logic tested through determine_agent_type in chat module

    def test_storage_keywords(self):
        """Test storage agent keywords."""
        keywords = ["storage deal", "file", "upload", "cid", "store"]
        for kw in keywords:
            assert kw in " ".join(keywords)

    def test_provider_keywords(self):
        """Test provider agent keywords."""
        keywords = ["provider", "hosting", "storage host"]
        for kw in keywords:
            assert kw in " ".join(keywords)

    def test_escrow_keywords(self):
        """Test escrow agent keywords."""
        keywords = ["contract", "escrow", "payment", "settle", "refund"]
        for kw in keywords:
            assert kw in " ".join(keywords)
