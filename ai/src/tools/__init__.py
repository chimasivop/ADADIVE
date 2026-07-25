"""Tools module for ADADIVE AI v2.

Provides a secure tool framework for AI agents to call backend APIs
without direct database access. All tools are executed through
authenticated API endpoints.

Security principles:
- No direct database access
- No private key handling
- All data comes from authenticated backend API endpoints
- Tools are read-only by default
"""

from abc import ABC, abstractmethod
from dataclasses import dataclass, field
from datetime import datetime
from typing import Any, AsyncGenerator
from enum import Enum
import json

from pydantic import BaseModel, Field

from ..config import get_settings
from ..auth import UserContext, AuthStatus


class ToolCategory(str, Enum):
    """Categories of tools available to AI agents."""
    INFO = "info"           # General information queries
    USER_DATA = "user_data" # User-specific data (requires auth)
    DEALS = "deals"         # Storage deal operations
    PROVIDERS = "providers" # Storage provider info
    PLATFORM = "platform"   # Platform-wide data
    CONTRACTS = "contracts" # Smart contract info


class ToolPermission(str, Enum):
    """Permissions required to use a tool."""
    PUBLIC = "public"           # Available to all users
    AUTHENTICATED = "authenticated"  # Requires valid token
    ADMIN = "admin"             # Requires admin permissions


@dataclass
class ToolDefinition:
    """Definition of a tool available to AI agents."""
    name: str
    description: str
    category: ToolCategory
    permission: ToolPermission
    parameters: dict[str, Any]
    returns: dict[str, Any]
    is_read_only: bool = True


@dataclass
class ToolResult:
    """Result from executing a tool."""
    success: bool
    data: Any = None
    error: str | None = None
    execution_time_ms: float = 0.0
    timestamp: datetime = field(default_factory=datetime.utcnow)


class BaseTool(ABC):
    """
    Abstract base class for AI tools.
    
    All tools must:
    - Have a unique name
    - Define required parameters
    - Implement execute() method
    - Return ToolResult
    """

    def __init__(self):
        self._definition = self._build_definition()

    @property
    @abstractmethod
    def name(self) -> str:
        """Unique tool name."""
        pass

    @property
    def definition(self) -> ToolDefinition:
        """Get the tool definition for AI consumption."""
        return self._definition

    @abstractmethod
    def _build_definition(self) -> ToolDefinition:
        """Build the tool definition."""
        pass

    @abstractmethod
    async def execute(
        self,
        parameters: dict[str, Any],
        user_context: UserContext | None = None,
    ) -> ToolResult:
        """
        Execute the tool with given parameters.
        
        Args:
            parameters: Tool-specific parameters
            user_context: Current user context (for auth)
            
        Returns:
            ToolResult with execution outcome
        """
        pass

    def validate_parameters(self, parameters: dict[str, Any]) -> tuple[bool, str | None]:
        """
        Validate tool parameters.
        
        Returns:
            Tuple of (is_valid, error_message)
        """
        return True, None


class PlatformInfoTool(BaseTool):
    """Tool for retrieving platform-wide information."""

    @property
    def name(self) -> str:
        return "get_platform_info"

    def _build_definition(self) -> ToolDefinition:
        return ToolDefinition(
            name=self.name,
            description="Get general information about the ADADIVE platform including statistics, supported features, and network status.",
            category=ToolCategory.INFO,
            permission=ToolPermission.PUBLIC,
            parameters={
                "type": "object",
                "properties": {},
            },
            returns={
                "type": "object",
                "properties": {
                    "platform_name": {"type": "string"},
                    "network": {"type": "string"},
                    "features": {"type": "array", "items": {"type": "string"}},
                    "stats": {"type": "object"},
                },
            },
        )

    async def execute(
        self,
        parameters: dict[str, Any],
        user_context: UserContext | None = None,
    ) -> ToolResult:
        from ..integrations import get_backend_client

        try:
            backend = get_backend_client()
            stats = await backend.get_platform_stats()
            
            return ToolResult(
                success=True,
                data={
                    "platform_name": "ADADIVE",
                    "network": "Cardano",
                    "features": [
                        "Decentralized Storage",
                        "IPFS Integration",
                        "Smart Escrow Contracts",
                        "Provider Marketplace",
                    ],
                    "stats": {
                        "total_storage_gb": stats.total_storage_gb if stats else 0,
                        "total_deals": stats.total_deals if stats else 0,
                        "active_deals": stats.active_deals if stats else 0,
                        "provider_count": stats.provider_count if stats else 0,
                    },
                },
            )
        except Exception as e:
            return ToolResult(success=False, error=str(e))


class StorageDealsTool(BaseTool):
    """Tool for retrieving storage deal information."""

    @property
    def name(self) -> str:
        return "get_storage_deals"

    def _build_definition(self) -> ToolDefinition:
        return ToolDefinition(
            name=self.name,
            description="Get storage deals. Requires authentication to access user-specific deals. Without auth, returns only public deal statistics.",
            category=ToolCategory.DEALS,
            permission=ToolPermission.AUTHENTICATED,
            parameters={
                "type": "object",
                "properties": {
                    "include_history": {
                        "type": "boolean",
                        "description": "Include completed/failed deals",
                        "default": False,
                    },
                    "status": {
                        "type": "string",
                        "description": "Filter by status (active, pending, completed, failed)",
                    },
                },
            },
            returns={
                "type": "object",
                "properties": {
                    "deals": {"type": "array"},
                    "total": {"type": "integer"},
                },
            },
        )

    async def execute(
        self,
        parameters: dict[str, Any],
        user_context: UserContext | None = None,
    ) -> ToolResult:
        from ..integrations import get_backend_client

        # Require authentication for user-specific data
        if user_context is None or user_context.auth_status != AuthStatus.AUTHENTICATED:
            return ToolResult(
                success=False,
                error="Authentication required to access personal storage deals",
            )

        if not user_context.wallet_address:
            return ToolResult(
                success=False,
                error="Wallet address not found in authentication context",
            )

        try:
            backend = get_backend_client()
            include_history = parameters.get("include_history", False)
            status_filter = parameters.get("status")

            deals = await backend.get_user_deals(
                wallet_address=user_context.wallet_address,
                include_history=include_history,
            )

            # Filter by status if specified
            if status_filter:
                deals = [d for d in deals if d.status == status_filter]

            return ToolResult(
                success=True,
                data={
                    "deals": [
                        {
                            "id": d.id,
                            "provider": d.provider_name,
                            "storage_gb": d.storage_gb,
                            "duration_epochs": d.duration_epochs,
                            "total_cost_ada": d.total_cost_ada,
                            "status": d.status,
                            "created_at": d.created_at,
                        }
                        for d in deals
                    ],
                    "total": len(deals),
                },
            )
        except Exception as e:
            return ToolResult(success=False, error=str(e))


class ProviderInfoTool(BaseTool):
    """Tool for retrieving storage provider information."""

    @property
    def name(self) -> str:
        return "get_provider_info"

    def _build_definition(self) -> ToolDefinition:
        return ToolDefinition(
            name=self.name,
            description="Get information about storage providers on the ADADIVE platform.",
            category=ToolCategory.PROVIDERS,
            permission=ToolPermission.PUBLIC,
            parameters={
                "type": "object",
                "properties": {
                    "provider_id": {
                        "type": "integer",
                        "description": "Specific provider ID (optional)",
                    },
                    "active_only": {
                        "type": "boolean",
                        "description": "Only show active providers",
                        "default": True,
                    },
                },
            },
            returns={
                "type": "object",
                "properties": {
                    "providers": {"type": "array"},
                },
            },
        )

    async def execute(
        self,
        parameters: dict[str, Any],
        user_context: UserContext | None = None,
    ) -> ToolResult:
        from ..integrations import get_backend_client

        try:
            backend = get_backend_client()
            provider_id = parameters.get("provider_id")
            active_only = parameters.get("active_only", True)

            if provider_id:
                provider = await backend.get_provider_by_id(provider_id)
                if provider:
                    return ToolResult(
                        success=True,
                        data={
                            "providers": [{
                                "id": provider.id,
                                "name": provider.name,
                                "endpoint": provider.endpoint,
                                "total_deals": provider.total_deals,
                                "active_deals": provider.active_deals,
                                "is_active": provider.is_active,
                            }],
                        },
                    )
                return ToolResult(success=False, error="Provider not found")

            providers = await backend.get_providers(active_only=active_only)
            return ToolResult(
                success=True,
                data={
                    "providers": [
                        {
                            "id": p.id,
                            "name": p.name,
                            "active_deals": p.active_deals,
                            "is_active": p.is_active,
                        }
                        for p in providers
                    ],
                },
            )
        except Exception as e:
            return ToolResult(success=False, error=str(e))


class EscrowContractTool(BaseTool):
    """Tool for retrieving smart contract information."""

    @property
    def name(self) -> str:
        return "get_escrow_info"

    def _build_definition(self) -> ToolDefinition:
        return ToolDefinition(
            name=self.name,
            description="Get information about the ADADIVE escrow smart contract and how it works.",
            category=ToolCategory.CONTRACTS,
            permission=ToolPermission.PUBLIC,
            parameters={
                "type": "object",
                "properties": {
                    "topic": {
                        "type": "string",
                        "description": "Specific topic (mechanics, security, redeployers, addresses)",
                    },
                },
            },
            returns={
                "type": "object",
                "properties": {
                    "info": {"type": "string"},
                },
            },
        )

    async def execute(
        self,
        parameters: dict[str, Any],
        user_context: UserContext | None = None,
    ) -> ToolResult:
        from ..retrieval import get_knowledge_base

        topic = parameters.get("topic", "mechanics")
        
        # Query the knowledge base for contract info
        try:
            kb = get_knowledge_base()
            context = kb.get_relevant_context(f"escrow contract {topic}")
            
            return ToolResult(
                success=True,
                data={
                    "info": context,
                    "topic": topic,
                },
            )
        except Exception as e:
            return ToolResult(success=False, error=str(e))


class PlatformStatsTool(BaseTool):
    """Tool for retrieving platform statistics."""

    @property
    def name(self) -> str:
        return "get_platform_stats"

    def _build_definition(self) -> ToolDefinition:
        return ToolDefinition(
            name=self.name,
            description="Get real-time statistics about the ADADIVE platform including total storage, deal counts, and provider metrics.",
            category=ToolCategory.PLATFORM,
            permission=ToolPermission.PUBLIC,
            parameters={
                "type": "object",
                "properties": {},
            },
            returns={
                "type": "object",
                "properties": {
                    "total_storage_gb": {"type": "number"},
                    "total_deals": {"type": "integer"},
                    "active_deals": {"type": "integer"},
                    "provider_count": {"type": "integer"},
                },
            },
        )

    async def execute(
        self,
        parameters: dict[str, Any],
        user_context: UserContext | None = None,
    ) -> ToolResult:
        from ..integrations import get_backend_client

        try:
            backend = get_backend_client()
            stats = await backend.get_platform_stats()
            
            if stats is None:
                return ToolResult(
                    success=False,
                    error="Could not retrieve platform statistics",
                )

            return ToolResult(
                success=True,
                data={
                    "total_storage_gb": stats.total_storage_gb,
                    "total_deals": stats.total_deals,
                    "active_deals": stats.active_deals,
                    "average_cost_ada": stats.average_cost_ada,
                    "provider_count": stats.provider_count,
                },
            )
        except Exception as e:
            return ToolResult(success=False, error=str(e))


class CodeGenerationTool(BaseTool):
    """Tool for generating code examples for ADADIVE integration."""

    CODE_TEMPLATES = {
        "typescript-deal": '''import { ADADIVEClient } from '@adadive/sdk';

// Initialize client
const client = new ADADIVEClient({
  apiKey: 'YOUR_API_KEY',
  network: 'mainnet'
});

// Create a storage deal
async function createDeal() {
  const deal = await client.deals.create({
    providerId: PROVIDER_ID,
    storageGb: STORAGE_SIZE,
    durationEpochs: DURATION_EPOCHS,
    dataHash: 'YOUR_DATA_HASH'
  });
  
  console.log('Deal created:', deal.id);
  return deal;
}

// Get deal status
async function getDeal(dealId: number) {
  const deal = await client.deals.get(dealId);
  console.log('Deal status:', deal.status);
  return deal;
}''',
        "python-deal": '''from adadive import Client

# Initialize client
client = Client(api_key="YOUR_API_KEY", network="mainnet")

# Create a storage deal
def create_deal():
    deal = client.deals.create(
        provider_id=PROVIDER_ID,
        storage_gb=STORAGE_SIZE,
        duration_epochs=DURATION_EPOCHS,
        data_hash="YOUR_DATA_HASH"
    )
    print(f"Deal created: {deal.id}")
    return deal

# Get deal status
def get_deal(deal_id: int):
    deal = client.deals.get(deal_id)
    print(f"Deal status: {deal.status}")
    return deal''',
        "webhook-handler": '''// Webhook handler example (Express.js)
app.post('/webhooks/adadive', async (req, res) => {
  const event = req.body;
  
  // Verify webhook signature
  if (!verifySignature(req.headers['x-adadive-signature'], event)) {
    return res.status(401).send('Invalid signature');
  }
  
  switch (event.type) {
    case 'deal.completed':
      console.log('Deal completed:', event.data.dealId);
      // Handle deal completion
      break;
    case 'deal.expiring':
      console.log('Deal expiring:', event.data.dealId);
      // Send notification
      break;
    case 'payment.received':
      console.log('Payment received:', event.data.amount);
      // Update accounting
      break;
  }
  
  res.status(200).send('OK');
});''',
        "api-request": '''# API Request Examples

# Get Platform Stats
curl -X GET https://api.adadive.xyz/v1/stats \\
  -H "Authorization: Bearer YOUR_API_KEY"

# Create Storage Deal
curl -X POST https://api.adadive.xyz/v1/deals \\
  -H "Authorization: Bearer YOUR_API_KEY" \\
  -H "Content-Type: application/json" \\
  -d '{
    "provider_id": PROVIDER_ID,
    "storage_gb": STORAGE_SIZE,
    "duration_epochs": DURATION_EPOCHS,
    "data_hash": "YOUR_DATA_HASH"
  }'

# Get User Deals
curl -X GET "https://api.adadive.xyz/v1/deals?client_address=WALLET_ADDRESS" \\
  -H "Authorization: Bearer YOUR_API_KEY"''',
    }

    @property
    def name(self) -> str:
        return "generate_code_example"

    def _build_definition(self) -> ToolDefinition:
        return ToolDefinition(
            name=self.name,
            description="Generate code examples for integrating with ADADIVE. Supports TypeScript, Python, webhooks, and API requests.",
            category=ToolCategory.INFO,
            permission=ToolPermission.PUBLIC,
            parameters={
                "type": "object",
                "properties": {
                    "language": {
                        "type": "string",
                        "description": "Programming language (typescript, python) or use case (webhook, api-request)",
                        "enum": ["typescript", "python", "webhook", "api-request"],
                    },
                    "use_case": {
                        "type": "string",
                        "description": "Specific use case (create-deal, get-deal, list-deals, webhooks, etc.)",
                    },
                },
            },
            returns={
                "type": "object",
                "properties": {
                    "code": {"type": "string"},
                    "language": {"type": "string"},
                    "description": {"type": "string"},
                },
            },
        )

    async def execute(
        self,
        parameters: dict[str, Any],
        user_context: UserContext | None = None,
    ) -> ToolResult:
        language = parameters.get("language", "typescript")
        use_case = parameters.get("use_case", "create-deal")
        
        # Build template key
        template_key = f"{language}-{use_case}" if "-" not in use_case else use_case
        
        code = self.CODE_TEMPLATES.get(template_key)
        
        if not code:
            # Generate generic example
            code = self._generate_generic_example(language, use_case)
        
        return ToolResult(
            success=True,
            data={
                "code": code,
                "language": language,
                "use_case": use_case,
                "description": f"Code example for {use_case} in {language}",
            },
        )

    def _generate_generic_example(self, language: str, use_case: str) -> str:
        """Generate a generic example based on language."""
        if language == "typescript":
            return f'''// ADADIVE {use_case} example (TypeScript)
import {{ ADADIVEClient }} from '@adadive/sdk';

const client = new ADADIVEClient({{
  apiKey: process.env.ADADIVE_API_KEY,
}});

// {use_case.replace('-', ' ').title()}
async function {use_case.replace('-', '_')}() {{
  // Implementation for {use_case}
}}
'''
        elif language == "python":
            return f'''# ADADIVE {use_case} example (Python)
from adadive import Client

client = Client(api_key=os.environ.get("ADADIVE_API_KEY"))

# {use_case.replace('-', ' ').title()}
def {use_case.replace('-', '_')}():
    # Implementation for {use_case}
    pass
'''
        else:
            return f"# Code example for {use_case} ({language})\n# Check docs at https://docs.adadive.xyz"


class APIReferenceTool(BaseTool):
    """Tool for generating API reference documentation."""

    API_ENDPOINTS = {
        "deals": {
            "GET /api/deals": {
                "description": "List storage deals",
                "params": ["client_address", "status", "limit"],
                "source": "GET /api/deals",
            },
            "POST /api/deals": {
                "description": "Create a new storage deal",
                "body": ["provider_id", "storage_gb", "duration_epochs", "data_hash"],
                "source": "POST /api/deals",
            },
            "GET /api/deals/{id}": {
                "description": "Get a specific deal",
                "source": "GET /api/deals/{id}",
            },
        },
        "providers": {
            "GET /api/providers": {
                "description": "List storage providers",
                "params": ["active"],
                "source": "GET /api/providers",
            },
            "GET /api/providers/{id}": {
                "description": "Get provider details",
                "source": "GET /api/providers/{id}",
            },
        },
        "stats": {
            "GET /api/stats": {
                "description": "Get platform statistics",
                "source": "GET /api/stats",
            },
        },
    }

    @property
    def name(self) -> str:
        return "get_api_reference"

    def _build_definition(self) -> ToolDefinition:
        return ToolDefinition(
            name=self.name,
            description="Get API reference documentation for ADADIVE endpoints.",
            category=ToolCategory.INFO,
            permission=ToolPermission.PUBLIC,
            parameters={
                "type": "object",
                "properties": {
                    "resource": {
                        "type": "string",
                        "description": "API resource (deals, providers, stats)",
                        "enum": ["deals", "providers", "stats"],
                    },
                    "method": {
                        "type": "string",
                        "description": "HTTP method (GET, POST, etc.)",
                    },
                },
            },
            returns={
                "type": "object",
                "properties": {
                    "endpoints": {"type": "array"},
                },
            },
        )

    async def execute(
        self,
        parameters: dict[str, Any],
        user_context: UserContext | None = None,
    ) -> ToolResult:
        resource = parameters.get("resource", "deals")
        method = parameters.get("method", "GET")
        
        endpoints = self.API_ENDPOINTS.get(resource, {})
        
        if method:
            # Filter by method
            endpoints = {k: v for k, v in endpoints.items() if k.startswith(method)}
        
        return ToolResult(
            success=True,
            data={
                "resource": resource,
                "endpoints": [
                    {"path": path, **details}
                    for path, details in endpoints.items()
                ],
            },
        )


class ToolRegistry:
    """Registry for all available AI tools."""

    def __init__(self):
        self._tools: dict[str, BaseTool] = {}

    def register(self, tool: BaseTool) -> None:
        """Register a tool."""
        self._tools[tool.name] = tool

    def get(self, name: str) -> BaseTool | None:
        """Get a tool by name."""
        return self._tools.get(name)

    def list_tools(self, permission: ToolPermission | None = None) -> list[ToolDefinition]:
        """List all registered tools, optionally filtered by permission."""
        tools = []
        for tool in self._tools.values():
            if permission is None or tool.definition.permission == permission:
                tools.append(tool.definition)
        return tools

    def can_use_tool(self, tool_name: str, user_context: UserContext | None) -> bool:
        """Check if a user can use a specific tool."""
        tool = self.get(tool_name)
        if tool is None:
            return False
        
        permission = tool.definition.permission
        if permission == ToolPermission.PUBLIC:
            return True
        elif permission == ToolPermission.AUTHENTICATED:
            return user_context is not None and user_context.auth_status == AuthStatus.AUTHENTICATED
        else:
            return False


# Global tool registry
_tool_registry: ToolRegistry | None = None


def get_tool_registry() -> ToolRegistry:
    """Get the global tool registry."""
    global _tool_registry
    if _tool_registry is None:
        _tool_registry = ToolRegistry()
        # Register all built-in tools
        _tool_registry.register(PlatformInfoTool())
        _tool_registry.register(StorageDealsTool())
        _tool_registry.register(ProviderInfoTool())
        _tool_registry.register(EscrowContractTool())
        _tool_registry.register(PlatformStatsTool())
        _tool_registry.register(CodeGenerationTool())
        _tool_registry.register(APIReferenceTool())
    return _tool_registry


__all__ = [
    "ToolCategory",
    "ToolPermission",
    "ToolDefinition",
    "ToolResult",
    "BaseTool",
    "PlatformInfoTool",
    "StorageDealsTool",
    "ProviderInfoTool",
    "EscrowContractTool",
    "PlatformStatsTool",
    "CodeGenerationTool",
    "APIReferenceTool",
    "ToolRegistry",
    "get_tool_registry",
]
