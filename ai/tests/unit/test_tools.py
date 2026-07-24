"""Tests for tools module."""

import pytest
from unittest.mock import AsyncMock, MagicMock, patch

from src.tools import (
    ToolCategory,
    ToolPermission,
    ToolDefinition,
    ToolResult,
    BaseTool,
    PlatformInfoTool,
    StorageDealsTool,
    ProviderInfoTool,
    EscrowContractTool,
    PlatformStatsTool,
    ToolRegistry,
    get_tool_registry,
)
from src.auth import UserContext, AuthStatus


class TestToolDefinition:
    """Tests for ToolDefinition."""

    def test_definition_creation(self):
        """Test creating a tool definition."""
        definition = ToolDefinition(
            name="test_tool",
            description="A test tool",
            category=ToolCategory.INFO,
            permission=ToolPermission.PUBLIC,
            parameters={"type": "object"},
            returns={"type": "string"},
        )
        assert definition.name == "test_tool"
        assert definition.category == ToolCategory.INFO
        assert definition.is_read_only is True


class TestToolResult:
    """Tests for ToolResult."""

    def test_successful_result(self):
        """Test creating a successful result."""
        result = ToolResult(
            success=True,
            data={"key": "value"},
        )
        assert result.success is True
        assert result.data["key"] == "value"
        assert result.error is None

    def test_failed_result(self):
        """Test creating a failed result."""
        result = ToolResult(
            success=False,
            error="Something went wrong",
        )
        assert result.success is False
        assert result.error == "Something went wrong"

    def test_result_with_timing(self):
        """Test result with timing information."""
        result = ToolResult(
            success=True,
            data="test",
            execution_time_ms=150.5,
        )
        assert result.execution_time_ms == 150.5


class TestPlatformInfoTool:
    """Tests for PlatformInfoTool."""

    def test_tool_properties(self):
        """Test tool properties."""
        tool = PlatformInfoTool()
        assert tool.name == "get_platform_info"
        assert tool.definition.category == ToolCategory.INFO
        assert tool.definition.permission == ToolPermission.PUBLIC

    @pytest.mark.asyncio
    async def test_execute_success(self):
        """Test successful tool execution."""
        tool = PlatformInfoTool()
        
        with patch("src.integrations.get_backend_client") as mock_get_client:
            mock_client = MagicMock()
            mock_client.get_platform_stats = AsyncMock(return_value=MagicMock(
                total_storage_gb=100,
                total_deals=50,
                active_deals=30,
                provider_count=5,
            ))
            mock_get_client.return_value = mock_client
            
            result = await tool.execute({}, user_context=None)
            
            assert result.success is True
            assert result.data["platform_name"] == "ADADIVE"
            assert result.data["stats"]["total_storage_gb"] == 100


class TestStorageDealsTool:
    """Tests for StorageDealsTool."""

    def test_tool_properties(self):
        """Test tool properties."""
        tool = StorageDealsTool()
        assert tool.name == "get_storage_deals"
        assert tool.definition.permission == ToolPermission.AUTHENTICATED

    @pytest.mark.asyncio
    async def test_execute_requires_auth(self):
        """Test that execution requires authentication."""
        tool = StorageDealsTool()
        
        # No user context
        result = await tool.execute({}, user_context=None)
        assert result.success is False
        assert "Authentication required" in result.error

    @pytest.mark.asyncio
    async def test_execute_with_auth(self):
        """Test execution with authentication."""
        tool = StorageDealsTool()
        
        user_context = UserContext(
            user_id="user_123",
            wallet_address="addr123",
            auth_status=AuthStatus.AUTHENTICATED,
            permissions=[],
        )
        
        with patch("src.integrations.get_backend_client") as mock_get_client:
            mock_client = MagicMock()
            mock_client.get_user_deals = AsyncMock(return_value=[
                MagicMock(
                    id=1,
                    provider_name="Provider1",
                    storage_gb=10,
                    duration_epochs=5,
                    total_cost_ada=100,
                    status="active",
                    created_at="2024-01-01",
                ),
            ])
            mock_get_client.return_value = mock_client
            
            result = await tool.execute({"include_history": False}, user_context)
            
            assert result.success is True
            assert result.data["total"] == 1


class TestProviderInfoTool:
    """Tests for ProviderInfoTool."""

    def test_tool_properties(self):
        """Test tool properties."""
        tool = ProviderInfoTool()
        assert tool.name == "get_provider_info"
        assert tool.definition.permission == ToolPermission.PUBLIC

    @pytest.mark.asyncio
    async def test_execute_success(self):
        """Test successful execution."""
        tool = ProviderInfoTool()
        
        with patch("src.integrations.get_backend_client") as mock_get_client:
            mock_client = MagicMock()
            mock_client.get_providers = AsyncMock(return_value=[
                MagicMock(
                    id=1,
                    name="Provider1",
                    endpoint="https://provider1.com",
                    active_deals=10,
                    is_active=True,
                ),
            ])
            mock_get_client.return_value = mock_client
            
            result = await tool.execute({"active_only": True})
            
            assert result.success is True
            assert len(result.data["providers"]) == 1


class TestEscrowContractTool:
    """Tests for EscrowContractTool."""

    def test_tool_properties(self):
        """Test tool properties."""
        tool = EscrowContractTool()
        assert tool.name == "get_escrow_info"
        assert tool.definition.category == ToolCategory.CONTRACTS

    @pytest.mark.asyncio
    async def test_execute_success(self):
        """Test successful execution."""
        tool = EscrowContractTool()
        
        with patch("src.retrieval.get_knowledge_base") as mock_get_kb:
            mock_kb = MagicMock()
            mock_kb.get_relevant_context.return_value = "Escrow contract info..."
            mock_get_kb.return_value = mock_kb
            
            result = await tool.execute({"topic": "mechanics"})
            
            assert result.success is True
            assert result.data["topic"] == "mechanics"


class TestToolRegistry:
    """Tests for ToolRegistry."""

    def test_register_tool(self):
        """Test registering a tool."""
        registry = ToolRegistry()
        tool = PlatformInfoTool()
        
        registry.register(tool)
        assert registry.get("get_platform_info") is tool

    def test_list_tools(self):
        """Test listing tools."""
        registry = ToolRegistry()
        registry.register(PlatformInfoTool())
        registry.register(StorageDealsTool())
        
        tools = registry.list_tools()
        assert len(tools) == 2
        
        public_tools = registry.list_tools(permission=ToolPermission.PUBLIC)
        assert len(public_tools) == 1

    def test_can_use_tool_public(self):
        """Test tool permission - public."""
        registry = ToolRegistry()
        registry.register(PlatformInfoTool())
        
        assert registry.can_use_tool("get_platform_info", None) is True

    def test_can_use_tool_authenticated(self):
        """Test tool permission - authenticated."""
        registry = ToolRegistry()
        registry.register(StorageDealsTool())
        
        # No auth
        assert registry.can_use_tool("get_storage_deals", None) is False
        
        # With auth
        user_context = UserContext(
            user_id="user_123",
            wallet_address="addr",
            auth_status=AuthStatus.AUTHENTICATED,
            permissions=[],
        )
        assert registry.can_use_tool("get_storage_deals", user_context) is True

    def test_get_tool_registry(self):
        """Test getting global tool registry."""
        registry = get_tool_registry()
        assert registry is not None
        
        # Should have built-in tools
        platform_tool = registry.get("get_platform_info")
        assert platform_tool is not None
