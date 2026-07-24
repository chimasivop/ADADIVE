"""Integration tests for API endpoints."""

import pytest
from fastapi.testclient import TestClient
from unittest.mock import patch, MagicMock, AsyncMock

from src.main import app
from src.chat import get_conversation_manager
from src.memory import reset_memory_store


@pytest.fixture
def client():
    """Create a test client."""
    return TestClient(app)


@pytest.fixture
def reset_memory():
    """Reset memory store before each test."""
    reset_memory_store()
    yield
    reset_memory_store()


class TestRootEndpoint:
    """Tests for root endpoint."""

    def test_root(self, client):
        """Test root endpoint."""
        response = client.get("/")
        assert response.status_code == 200
        data = response.json()
        assert data["service"] == "ADADIVE AI"
        assert data["version"] == "2.0.0"
        assert "features" in data


class TestHealthEndpoint:
    """Tests for health endpoint."""

    def test_health_check(self, client):
        """Test health check endpoint."""
        with patch("src.main.get_knowledge_base") as mock_kb:
            mock_kb.return_value._initialized = True
            with patch("src.main.get_backend_client") as mock_backend:
                mock_backend.return_value.health_check = AsyncMock(return_value=True)
                response = client.get("/health")
        
        assert response.status_code == 200
        data = response.json()
        assert "status" in data
        assert "checks" in data


class TestAgentsEndpoint:
    """Tests for agents endpoint."""

    def test_list_agents(self, client):
        """Test listing agents."""
        response = client.get("/api/ai/agents")
        assert response.status_code == 200
        data = response.json()
        assert "agents" in data
        assert len(data["agents"]) == 5  # support, storage, escrow, provider, developer


class TestToolsEndpoint:
    """Tests for tools endpoint."""

    def test_list_tools(self, client):
        """Test listing tools."""
        response = client.get("/api/ai/tools")
        assert response.status_code == 200
        data = response.json()
        assert "tools" in data
        assert len(data["tools"]) > 0


class TestConfigEndpoint:
    """Tests for config endpoint."""

    def test_get_config(self, client):
        """Test getting configuration."""
        response = client.get("/api/ai/config")
        assert response.status_code == 200
        data = response.json()
        assert data["version"] == "2.0.0"
        assert "llm_provider" in data
        assert "features" in data


class TestSourcesEndpoint:
    """Tests for sources endpoint."""

    def test_get_sources(self, client):
        """Test getting knowledge sources."""
        with patch("src.routes.get_knowledge_base") as mock_kb:
            mock_kb.return_value.retrieve.return_value = [
                MagicMock(
                    content="Test content",
                    metadata={"source": "test.md", "category": "test"},
                    score=0.9,
                ),
            ]
            response = client.get("/api/ai/sources?query=test&top_k=5")
        
        assert response.status_code == 200
        data = response.json()
        assert "results" in data
        assert data["query"] == "test"


class TestChatEndpoint:
    """Tests for chat endpoint."""

    def test_chat_empty_message(self, client, reset_memory):
        """Test chat with empty message."""
        response = client.post(
            "/api/ai/chat",
            json={"message": ""},
        )
        # Should handle empty message gracefully
        # Implementation may vary

    def test_chat_basic(self, client, reset_memory):
        """Test basic chat functionality."""
        with patch("src.chat.get_llm_provider") as mock_llm:
            mock_provider = MagicMock()
            mock_provider.generate = AsyncMock(return_value=MagicMock(
                content="Hello! How can I help you?",
                model="gpt-4o-mini",
            ))
            mock_llm.return_value = mock_provider
            
            with patch("src.agents.get_llm_provider") as mock_agent_llm:
                mock_agent_llm.return_value = mock_provider
                
                response = client.post(
                    "/api/ai/chat",
                    json={"message": "Hello!"},
                )
        
        assert response.status_code == 200
        data = response.json()
        assert "message" in data
        assert "conversation_id" in data
        assert "agent_type" in data

    def test_chat_with_auth(self, client, reset_memory):
        """Test chat with authentication."""
        with patch("src.chat.get_llm_provider") as mock_llm:
            mock_provider = MagicMock()
            mock_provider.generate = AsyncMock(return_value=MagicMock(
                content="Hello authenticated user!",
                model="gpt-4o-mini",
            ))
            mock_llm.return_value = mock_provider
            
            with patch("src.agents.get_llm_provider") as mock_agent_llm:
                mock_agent_llm.return_value = mock_provider
                
                response = client.post(
                    "/api/ai/chat",
                    json={
                        "message": "Hello!",
                        "token": "fake-jwt-token",
                    },
                )
        
        assert response.status_code == 200
        data = response.json()
        assert "user_context" in data

    def test_chat_message_too_long(self, client, reset_memory):
        """Test chat with message exceeding max length."""
        long_message = "x" * 5000  # Default max is 4000
        response = client.post(
            "/api/ai/chat",
            json={"message": long_message},
        )
        assert response.status_code == 400


class TestChatHistoryEndpoint:
    """Tests for chat history endpoint."""

    def test_get_history_not_found(self, client, reset_memory):
        """Test getting non-existent history."""
        response = client.get("/api/ai/chat/history/nonexistent")
        assert response.status_code == 404

    def test_delete_history_not_found(self, client, reset_memory):
        """Test deleting non-existent history."""
        response = client.delete("/api/ai/chat/history/nonexistent")
        assert response.status_code == 404


class TestMemoryStatsEndpoint:
    """Tests for memory stats endpoint."""

    def test_get_memory_stats(self, client, reset_memory):
        """Test getting memory statistics."""
        response = client.get("/api/ai/memory/stats")
        assert response.status_code == 200
        data = response.json()
        assert "total_conversations" in data
        assert "active_conversations" in data
        assert "total_messages" in data
