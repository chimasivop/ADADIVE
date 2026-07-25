"""Tests for chat module - Dashboard context awareness."""

import pytest
from unittest.mock import AsyncMock, MagicMock, patch

from src.chat import (
    DashboardPage,
    ChatRequest,
    ChatResponse,
    determine_agent_type,
)
from src.agents import AgentType
from src.auth import UserContext, AuthStatus


class TestDashboardPage:
    """Tests for DashboardPage enum."""

    def test_all_pages_defined(self):
        """Test that all expected pages are defined."""
        expected_pages = [
            "unknown", "dashboard", "providers", "deals",
            "escrow", "storage", "wallet", "admin", "settings"
        ]
        for page in expected_pages:
            assert hasattr(DashboardPage, page.upper())
            assert DashboardPage[page.upper()].value == page


class TestDetermineAgentType:
    """Tests for determine_agent_type with page context."""

    def setup_method(self):
        """Set up test fixtures."""
        self.user_context = UserContext(
            user_id="test_user",
            wallet_address="addr_test123",
            auth_status=AuthStatus.AUTHENTICATED,
            permissions=["read_public_info"],
        )

    def test_keyword_priority_over_page_context(self):
        """Test that explicit keywords take priority over page context."""
        # "provider" keyword should route to ProviderAgent even on Deals page
        agent = determine_agent_type(
            "I want to check provider ratings",
            self.user_context,
            DashboardPage.DEALS,
        )
        assert agent == AgentType.PROVIDER

    def test_page_context_as_fallback(self):
        """Test that page context is used when no keywords match."""
        # Generic message on Providers page should route to ProviderAgent
        agent = determine_agent_type(
            "How are things going?",
            self.user_context,
            DashboardPage.PROVIDERS,
        )
        assert agent == AgentType.PROVIDER

    def test_deals_page_routes_to_storage(self):
        """Test that Deals page routes to Storage agent."""
        agent = determine_agent_type(
            "What's happening?",
            self.user_context,
            DashboardPage.DEALS,
        )
        assert agent == AgentType.STORAGE

    def test_escrow_page_routes_to_escrow(self):
        """Test that Escrow page routes to Escrow agent."""
        agent = determine_agent_type(
            "Any updates?",
            self.user_context,
            DashboardPage.ESCROW,
        )
        assert agent == AgentType.ESCROW

    def test_storage_page_routes_to_storage(self):
        """Test that Storage page routes to Storage agent."""
        agent = determine_agent_type(
            "Hello there",
            self.user_context,
            DashboardPage.STORAGE,
        )
        assert agent == AgentType.STORAGE

    def test_wallet_page_routes_to_support(self):
        """Test that Wallet page routes to Support agent."""
        agent = determine_agent_type(
            "What's new?",
            self.user_context,
            DashboardPage.WALLET,
        )
        assert agent == AgentType.SUPPORT

    def test_admin_page_routes_to_support(self):
        """Test that Admin page routes to Support agent."""
        agent = determine_agent_type(
            "Hello",
            self.user_context,
            DashboardPage.ADMIN,
        )
        assert agent == AgentType.SUPPORT

    def test_unknown_page_uses_default(self):
        """Test that unknown page uses default agent."""
        agent = determine_agent_type(
            "Hello",
            self.user_context,
            DashboardPage.UNKNOWN,
        )
        # Should use default agent (SUPPORT)
        assert agent == AgentType.SUPPORT

    def test_storage_deal_keyword(self):
        """Test storage deal keyword routes to Storage agent."""
        agent = determine_agent_type(
            "Check my storage deal",
            self.user_context,
            DashboardPage.UNKNOWN,
        )
        assert agent == AgentType.STORAGE

    def test_escrow_keyword(self):
        """Test escrow keyword routes to Escrow agent."""
        agent = determine_agent_type(
            "Release the escrow funds",
            self.user_context,
            DashboardPage.UNKNOWN,
        )
        assert agent == AgentType.ESCROW

    def test_developer_keyword(self):
        """Test developer keyword routes to Developer agent."""
        agent = determine_agent_type(
            "Show me the API documentation",
            self.user_context,
            DashboardPage.UNKNOWN,
        )
        assert agent == AgentType.DEVELOPER


class TestChatRequest:
    """Tests for ChatRequest model."""

    def test_default_page_context(self):
        """Test default page context is unknown."""
        request = ChatRequest(message="Hello")
        assert request.page_context == DashboardPage.UNKNOWN

    def test_explicit_page_context(self):
        """Test setting explicit page context."""
        request = ChatRequest(
            message="Hello",
            page_context=DashboardPage.DEALS,
        )
        assert request.page_context == DashboardPage.DEALS

    def test_page_context_in_request(self):
        """Test page context is included in request."""
        request = ChatRequest(
            message="Hello",
            page_context=DashboardPage.PROVIDERS,
            agent_type="support",
        )
        assert request.page_context == DashboardPage.PROVIDERS
        assert request.agent_type == "support"


class TestChatResponse:
    """Tests for ChatResponse model."""

    def test_default_backend_references(self):
        """Test default backend references is empty list."""
        response = ChatResponse(
            message="Hello",
            conversation_id="conv123",
            agent_type="support",
            timestamp="2024-01-01T00:00:00",
        )
        assert response.backend_references == []
        assert response.page_context == "unknown"

    def test_backend_references_included(self):
        """Test backend references are included in response."""
        references = [
            {"endpoint": "GET /api/stats", "data": {"total_deals": 100}},
            {"endpoint": "GET /api/providers", "data": {"count": 5}},
        ]
        response = ChatResponse(
            message="Here are the stats",
            conversation_id="conv123",
            agent_type="support",
            backend_references=references,
            page_context="dashboard",
            timestamp="2024-01-01T00:00:00",
        )
        assert len(response.backend_references) == 2
        assert response.page_context == "dashboard"
        assert response.backend_references[0]["endpoint"] == "GET /api/stats"

    def test_page_context_in_response(self):
        """Test page context is included in response."""
        response = ChatResponse(
            message="Hello from deals page",
            conversation_id="conv123",
            agent_type="storage",
            page_context="deals",
            timestamp="2024-01-01T00:00:00",
        )
        assert response.page_context == "deals"
        assert response.agent_type == "storage"
