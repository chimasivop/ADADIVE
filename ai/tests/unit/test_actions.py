"""Tests for actions module - Confirmation workflows."""

import pytest
from unittest.mock import AsyncMock, MagicMock, patch

from src.actions import (
    ActionType,
    ActionConfirmationLevel,
    ActionDefinition,
    ActionRegistry,
    ActionConfirmationManager,
    get_action_registry,
    reset_action_registry,
)
from src.auth import UserContext, AuthStatus


class TestActionTypes:
    """Tests for ActionType enum."""

    def test_core_actions_defined(self):
        """Test core action types are defined."""
        assert ActionType.RENEW_DEAL.value == "renew_deal"
        assert ActionType.CANCEL_DEAL.value == "cancel_deal"
        assert ActionType.CREATE_DEAL.value == "create_deal"

    def test_wallet_actions_defined(self):
        """Test wallet action types are defined."""
        assert ActionType.TRANSFER_FUNDS.value == "transfer_funds"
        assert ActionType.STAKE_FUNDS.value == "stake_funds"
        assert ActionType.WITHDRAW_FUNDS.value == "withdraw_funds"

    def test_provider_actions_defined(self):
        """Test provider action types are defined."""
        assert ActionType.REGISTER_PROVIDER.value == "register_provider"
        assert ActionType.UNREGISTER_PROVIDER.value == "unregister_provider"
        assert ActionType.UPDATE_PROVIDER_PRICING.value == "update_provider_pricing"

    def test_escrow_actions_defined(self):
        """Test escrow action types are defined."""
        assert ActionType.RELEASE_ESCROW.value == "release_escrow"
        assert ActionType.DISPUTE_ESCROW.value == "dispute_escrow"
        assert ActionType.ACCEPT_ESCROW.value == "accept_escrow"


class TestActionConfirmationLevels:
    """Tests for ActionConfirmationLevel enum."""

    def test_all_levels_defined(self):
        """Test all confirmation levels are defined."""
        assert ActionConfirmationLevel.NONE.value == "none"
        assert ActionConfirmationLevel.SIMPLE.value == "simple"
        assert ActionConfirmationLevel.STRONG.value == "strong"
        assert ActionConfirmationLevel.WALLET.value == "wallet"

    def test_critical_operations_require_wallet(self):
        """Test that transfer funds requires wallet confirmation."""
        action_def = ActionDefinition(
            action_type=ActionType.TRANSFER_FUNDS,
            name="Transfer Funds",
            description="Transfer ADA",
            confirmation_level=ActionConfirmationLevel.WALLET,
            requires_auth=True,
            requires_wallet=True,
            backend_endpoint="/api/wallet/transfer",
            method="POST",
            danger_level="critical",
        )
        assert action_def.requires_wallet is True
        assert action_def.confirmation_level == ActionConfirmationLevel.WALLET
        assert action_def.danger_level == "critical"


class TestActionRegistry:
    """Tests for ActionRegistry."""

    def setup_method(self):
        """Set up test fixtures."""
        reset_action_registry()
        self.registry = get_action_registry()
        self.user_context = UserContext(
            user_id="test_user",
            wallet_address="addr_test123",
            auth_status=AuthStatus.AUTHENTICATED,
            permissions=["read_public_info"],
        )
        self.anonymous_context = UserContext(
            user_id=None,
            wallet_address=None,
            auth_status=AuthStatus.ANONYMOUS,
            permissions=["read_public_info"],
        )

    def test_all_action_types_registered(self):
        """Test all action types are registered."""
        actions = self.registry.list_actions()
        action_types = [a.action_type for a in actions]
        
        assert ActionType.RENEW_DEAL in action_types
        assert ActionType.TRANSFER_FUNDS in action_types
        assert ActionType.REGISTER_PROVIDER in action_types
        assert ActionType.RELEASE_ESCROW in action_types

    def test_get_action_definition(self):
        """Test getting action definition by type."""
        action_def = self.registry.get(ActionType.CREATE_DEAL)
        assert action_def is not None
        assert action_def.name == "Create Storage Deal"
        assert action_def.confirmation_level == ActionConfirmationLevel.STRONG

    def test_wallet_operation_requires_wallet(self):
        """Test wallet operations require wallet."""
        action_def = self.registry.get(ActionType.TRANSFER_FUNDS)
        assert action_def.requires_wallet is True
        assert action_def.danger_level == "critical"

    def test_escrow_release_danger_level(self):
        """Test escrow release has high danger level."""
        action_def = self.registry.get(ActionType.RELEASE_ESCROW)
        assert action_def.danger_level == "high"
        assert action_def.requires_wallet is True

    def test_provider_registration(self):
        """Test provider registration action."""
        action_def = self.registry.get(ActionType.REGISTER_PROVIDER)
        assert action_def is not None
        assert action_def.requires_wallet is True
        assert action_def.backend_endpoint == "/api/providers/register"


class TestActionConfirmationManager:
    """Tests for ActionConfirmationManager."""

    def setup_method(self):
        """Set up test fixtures."""
        self.manager = ActionConfirmationManager()
        self.user_context = UserContext(
            user_id="test_user",
            wallet_address="addr_test123",
            auth_status=AuthStatus.AUTHENTICATED,
            permissions=["read_public_info"],
        )

    def test_create_pending_action(self):
        """Test creating a pending action."""
        action = self.manager.create_pending_action(
            action_type=ActionType.CREATE_DEAL,
            parameters={"provider_id": 1, "storage_gb": 100},
            user_context=self.user_context,
        )
        
        assert action is not None
        assert action.status == "pending"
        assert action.requires_confirmation is True
        assert action.action_type == "create_deal"

    def test_confirm_action(self):
        """Test confirming an action."""
        action = self.manager.create_pending_action(
            action_type=ActionType.RENEW_DEAL,
            parameters={"deal_id": 123},
            user_context=self.user_context,
        )
        
        confirmed = self.manager.confirm_action(action.id)
        assert confirmed is not None
        assert confirmed.status == "confirmed"

    def test_complete_action(self):
        """Test completing an action."""
        action = self.manager.create_pending_action(
            action_type=ActionType.CREATE_DEAL,
            parameters={"provider_id": 1},
            user_context=self.user_context,
        )
        
        self.manager.complete_action(
            action.id,
            result={"success": True, "deal_id": 456},
        )
        
        completed = self.manager.get_pending_action(action.id)
        assert completed.status == "completed"
        assert completed.result["deal_id"] == 456

    def test_complete_action_with_error(self):
        """Test completing an action with error."""
        action = self.manager.create_pending_action(
            action_type=ActionType.CANCEL_DEAL,
            parameters={"deal_id": 123},
            user_context=self.user_context,
        )
        
        self.manager.complete_action(
            action.id,
            error="Insufficient funds",
        )
        
        completed = self.manager.get_pending_action(action.id)
        assert completed.status == "failed"

    def test_wallet_operation_confirmation_message(self):
        """Test wallet operations have appropriate confirmation messages."""
        action = self.manager.create_pending_action(
            action_type=ActionType.TRANSFER_FUNDS,
            parameters={
                "to_address": "addr_other456",
                "amount": "1000",
            },
            user_context=self.user_context,
        )
        
        assert "addr_other456" in action.confirmation_message
        assert "1000" in action.confirmation_message
        assert "irreversible" in action.confirmation_message.lower() or "proceed" in action.confirmation_message.lower()
