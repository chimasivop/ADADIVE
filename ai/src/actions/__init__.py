"""Actions module for ADADIVE AI v3 - Natural Language Actions with Confirmation.

Provides a framework for AI agents to execute state-changing operations
with explicit user confirmation before execution.

Security principles:
- All actions require explicit confirmation
- Actions only execute through authenticated backend API endpoints
- No direct blockchain transaction signing
- Wallet confirmation for sensitive operations
"""

from dataclasses import dataclass, field
from datetime import datetime
from typing import Any, Callable, Awaitable
from enum import Enum
import uuid

from pydantic import BaseModel, Field

from ..auth import UserContext, AuthStatus
from ..workspace import WorkspaceAction


class ActionType(str, Enum):
    """Types of actions available."""
    RENEW_DEAL = "renew_deal"
    CANCEL_DEAL = "cancel_deal"
    UPDATE_PROVIDER = "update_provider"
    CREATE_DEAL = "create_deal"
    WITHDRAW_FUNDS = "withdraw_funds"
    UPDATE_SETTINGS = "update_settings"
    DISMISS_NOTIFICATION = "dismiss_notification"
    EXPORT_DATA = "export_data"
    CONTACT_SUPPORT = "contact_support"


class ActionConfirmationLevel(str, Enum):
    """Level of confirmation required for an action."""
    NONE = "none"              # No confirmation needed
    SIMPLE = "simple"          # Simple yes/no confirmation
    STRONG = "strong"          # Explicit confirmation with details
    WALLET = "wallet"          # Requires wallet signature


@dataclass
class ActionDefinition:
    """Definition of an executable action."""
    action_type: ActionType
    name: str
    description: str
    confirmation_level: ActionConfirmationLevel
    requires_auth: bool = True
    requires_wallet: bool = False
    backend_endpoint: str | None = None
    method: str = "POST"
    danger_level: str = "low"  # low, medium, high, critical


@dataclass
class ActionParameter:
    """A parameter for an action."""
    name: str
    type: str
    description: str
    required: bool = True
    default: Any = None


class ActionRegistry:
    """Registry of all available actions."""

    def __init__(self):
        self._actions: dict[ActionType, ActionDefinition] = {}
        self._handlers: dict[ActionType, Callable[[dict, UserContext], Awaitable[dict]]] = {}
        self._register_default_actions()

    def _register_default_actions(self) -> None:
        """Register all default actions."""
        # Renew Deal
        self.register(
            ActionDefinition(
                action_type=ActionType.RENEW_DEAL,
                name="Renew Storage Deal",
                description="Renew an expiring storage deal to maintain your data storage",
                confirmation_level=ActionConfirmationLevel.STRONG,
                requires_auth=True,
                backend_endpoint="/api/deals/{deal_id}/renew",
                method="POST",
                danger_level="medium",
            ),
            self._handle_renew_deal,
        )

        # Cancel Deal
        self.register(
            ActionDefinition(
                action_type=ActionType.CANCEL_DEAL,
                name="Cancel Storage Deal",
                description="Cancel an active storage deal (data will no longer be stored)",
                confirmation_level=ActionConfirmationLevel.WALLET,
                requires_auth=True,
                requires_wallet=True,
                backend_endpoint="/api/deals/{deal_id}/cancel",
                method="POST",
                danger_level="high",
            ),
            self._handle_cancel_deal,
        )

        # Update Provider Settings
        self.register(
            ActionDefinition(
                action_type=ActionType.UPDATE_PROVIDER,
                name="Update Provider Settings",
                description="Update your storage provider configuration",
                confirmation_level=ActionConfirmationLevel.STRONG,
                requires_auth=True,
                backend_endpoint="/api/providers/{provider_id}",
                method="PATCH",
                danger_level="medium",
            ),
            self._handle_update_provider,
        )

        # Create Deal
        self.register(
            ActionDefinition(
                action_type=ActionType.CREATE_DEAL,
                name="Create Storage Deal",
                description="Create a new storage deal with a provider",
                confirmation_level=ActionConfirmationLevel.STRONG,
                requires_auth=True,
                backend_endpoint="/api/deals",
                method="POST",
                danger_level="medium",
            ),
            self._handle_create_deal,
        )

        # Update Settings
        self.register(
            ActionDefinition(
                action_type=ActionType.UPDATE_SETTINGS,
                name="Update Workspace Settings",
                description="Update your AI workspace preferences",
                confirmation_level=ActionConfirmationLevel.SIMPLE,
                requires_auth=True,
                backend_endpoint="/api/ai/workspace/settings",
                method="PUT",
                danger_level="low",
            ),
            self._handle_update_settings,
        )

        # Export Data
        self.register(
            ActionDefinition(
                action_type=ActionType.EXPORT_DATA,
                name="Export User Data",
                description="Export your storage deal history and statistics",
                confirmation_level=ActionConfirmationLevel.SIMPLE,
                requires_auth=True,
                backend_endpoint="/api/ai/workspace/export",
                method="POST",
                danger_level="low",
            ),
            self._handle_export_data,
        )

        # Contact Support
        self.register(
            ActionDefinition(
                action_type=ActionType.CONTACT_SUPPORT,
                name="Contact Support",
                description="Submit a support request to the ADADIVE team",
                confirmation_level=ActionConfirmationLevel.SIMPLE,
                requires_auth=True,
                backend_endpoint="/api/support",
                method="POST",
                danger_level="low",
            ),
            self._handle_contact_support,
        )

    def register(
        self,
        definition: ActionDefinition,
        handler: Callable[[dict, UserContext], Awaitable[dict]],
    ) -> None:
        """Register an action with its handler."""
        self._actions[definition.action_type] = definition
        self._handlers[definition.action_type] = handler

    def get(self, action_type: ActionType) -> ActionDefinition | None:
        """Get an action definition."""
        return self._actions.get(action_type)

    def list_actions(self) -> list[ActionDefinition]:
        """List all available actions."""
        return list(self._actions.values())

    async def execute(
        self,
        action_type: ActionType,
        parameters: dict[str, Any],
        user_context: UserContext,
        confirmed: bool = False,
    ) -> dict[str, Any]:
        """Execute an action after confirmation."""
        action_def = self.get(action_type)
        if not action_def:
            return {
                "success": False,
                "error": f"Unknown action type: {action_type}",
            }

        # Check authentication
        if action_def.requires_auth and user_context.auth_status != AuthStatus.AUTHENTICATED:
            return {
                "success": False,
                "error": "Authentication required for this action",
            }

        # Check wallet requirement
        if action_def.requires_wallet and not user_context.wallet_address:
            return {
                "success": False,
                "error": "Wallet connection required for this action",
            }

        # Check confirmation
        if action_def.confirmation_level != ActionConfirmationLevel.NONE and not confirmed:
            return {
                "success": False,
                "requires_confirmation": True,
                "confirmation_message": self._generate_confirmation_message(action_def, parameters),
                "action_type": action_type.value,
            }

        # Execute the action
        try:
            handler = self._handlers.get(action_type)
            if handler:
                result = await handler(parameters, user_context)
                return {
                    "success": True,
                    "result": result,
                    "action_type": action_type.value,
                }
            else:
                return {
                    "success": False,
                    "error": "No handler registered for this action",
                }
        except Exception as e:
            return {
                "success": False,
                "error": str(e),
            }

    def _generate_confirmation_message(
        self,
        action_def: ActionDefinition,
        parameters: dict[str, Any],
    ) -> str:
        """Generate a user-friendly confirmation message."""
        msg = f"⚠️ **{action_def.name}**\n\n"
        msg += f"{action_def.description}\n\n"
        msg += "**Parameters:**\n"
        for key, value in parameters.items():
            msg += f"- {key}: {value}\n"
        
        if action_def.danger_level in ("high", "critical"):
            msg += "\n⚠️ **Warning:** This action cannot be undone!"
        
        msg += "\n\nDo you want to proceed? (yes/no)"
        return msg

    # Action handlers
    async def _handle_renew_deal(self, params: dict, user_context: UserContext) -> dict:
        """Handle deal renewal."""
        from ..integrations import get_backend_client
        
        deal_id = params.get("deal_id")
        duration_epochs = params.get("duration_epochs", 10000)
        
        backend = get_backend_client()
        # In real implementation, this would call the backend API
        # For now, return a placeholder response
        return {
            "deal_id": deal_id,
            "new_duration_epochs": duration_epochs,
            "message": f"Deal #{deal_id} renewal initiated",
            "estimated_cost": "TBD",
            "source_api": "POST /api/deals/{deal_id}/renew",
        }

    async def _handle_cancel_deal(self, params: dict, user_context: UserContext) -> dict:
        """Handle deal cancellation."""
        deal_id = params.get("deal_id")
        return {
            "deal_id": deal_id,
            "message": f"Deal #{deal_id} cancellation initiated",
            "warning": "Data will no longer be stored after cancellation",
            "source_api": "POST /api/deals/{deal_id}/cancel",
        }

    async def _handle_update_provider(self, params: dict, user_context: UserContext) -> dict:
        """Handle provider update."""
        provider_id = params.get("provider_id")
        settings = params.get("settings", {})
        return {
            "provider_id": provider_id,
            "updated_settings": settings,
            "message": f"Provider #{provider_id} settings updated",
            "source_api": "PATCH /api/providers/{provider_id}",
        }

    async def _handle_create_deal(self, params: dict, user_context: UserContext) -> dict:
        """Handle deal creation."""
        return {
            "provider_id": params.get("provider_id"),
            "storage_gb": params.get("storage_gb"),
            "duration_epochs": params.get("duration_epochs"),
            "message": "Deal creation initiated",
            "source_api": "POST /api/deals",
        }

    async def _handle_update_settings(self, params: dict, user_context: UserContext) -> dict:
        """Handle settings update."""
        settings = params.get("settings", {})
        return {
            "updated_settings": settings,
            "message": "Workspace settings updated",
            "source_api": "PUT /api/ai/workspace/settings",
        }

    async def _handle_export_data(self, params: dict, user_context: UserContext) -> dict:
        """Handle data export."""
        format_type = params.get("format", "json")
        return {
            "format": format_type,
            "message": f"Data export in {format_type} format initiated",
            "download_url": f"/api/ai/workspace/export?format={format_type}",
            "source_api": "POST /api/ai/workspace/export",
        }

    async def _handle_contact_support(self, params: dict, user_context: UserContext) -> dict:
        """Handle support contact."""
        return {
            "ticket_id": str(uuid.uuid4())[:8],
            "subject": params.get("subject", "Support Request"),
            "message": "Your support request has been submitted",
            "source_api": "POST /api/support",
        }


# Global action registry
_action_registry: ActionRegistry | None = None


def get_action_registry() -> ActionRegistry:
    """Get the global action registry."""
    global _action_registry
    if _action_registry is None:
        _action_registry = ActionRegistry()
    return _action_registry


def reset_action_registry() -> None:
    """Reset the action registry (for testing)."""
    global _action_registry
    _action_registry = None


class ActionConfirmationManager:
    """Manages pending action confirmations."""

    def __init__(self):
        self._pending: dict[str, WorkspaceAction] = {}
        self._expiry_seconds = 300  # 5 minutes

    def create_pending_action(
        self,
        action_type: ActionType,
        parameters: dict[str, Any],
        user_context: UserContext,
    ) -> WorkspaceAction:
        """Create a pending action requiring confirmation."""
        action_def = get_action_registry().get(action_type)
        
        action = WorkspaceAction(
            id=str(uuid.uuid4()),
            action_type=action_type.value,
            description=action_def.description if action_def else "",
            requires_confirmation=action_def.confirmation_level != ActionConfirmationLevel.NONE if action_def else True,
            confirmation_message=self._build_confirmation_message(action_def, parameters) if action_def else "",
            backend_endpoint=action_def.backend_endpoint if action_def else "",
            method=action_def.method if action_def else "POST",
            parameters=parameters,
            user_context=user_context,
        )
        
        self._pending[action.id] = action
        return action

    def get_pending_action(self, action_id: str) -> WorkspaceAction | None:
        """Get a pending action by ID."""
        return self._pending.get(action_id)

    def confirm_action(self, action_id: str) -> WorkspaceAction | None:
        """Mark an action as confirmed."""
        action = self._pending.get(action_id)
        if action:
            action.status = "confirmed"
        return action

    def complete_action(self, action_id: str, result: dict | None = None, error: str | None = None) -> None:
        """Mark an action as completed."""
        action = self._pending.get(action_id)
        if action:
            action.status = "completed" if not error else "failed"
            action.result = result
            action.error = error
            action.executed_at = datetime.utcnow()

    def expire_old_actions(self) -> int:
        """Remove expired pending actions."""
        now = datetime.utcnow()
        expired = []
        
        for action_id, action in self._pending.items():
            if action.status == "pending":
                age = (now - action.created_at).total_seconds()
                if age > self._expiry_seconds:
                    action.status = "expired"
                    expired.append(action_id)
        
        return len(expired)

    def _build_confirmation_message(
        self,
        action_def: ActionDefinition,
        parameters: dict[str, Any],
    ) -> str:
        """Build a confirmation message for the action."""
        msg = f"Do you want to {action_def.name.lower()}?\n\n"
        
        if parameters:
            msg += "Details:\n"
            for key, value in parameters.items():
                msg += f"- {key}: {value}\n"
        
        if action_def.danger_level in ("high", "critical"):
            msg += "\n⚠️ This action is irreversible!"
        
        return msg


# Global confirmation manager
_confirmation_manager: ActionConfirmationManager | None = None


def get_confirmation_manager() -> ActionConfirmationManager:
    """Get the global confirmation manager."""
    global _confirmation_manager
    if _confirmation_manager is None:
        _confirmation_manager = ActionConfirmationManager()
    return _confirmation_manager


__all__ = [
    "ActionType",
    "ActionConfirmationLevel",
    "ActionDefinition",
    "ActionParameter",
    "ActionRegistry",
    "ActionConfirmationManager",
    "get_action_registry",
    "get_confirmation_manager",
    "reset_action_registry",
]
