"""Notifications module for ADADIVE AI v3 - Notification System.

Provides notification support so the AI can surface important events:
- Expiring deals
- Provider issues
- Network alerts
- Payment notifications
- System maintenance
"""

from dataclasses import dataclass, field
from datetime import datetime, timedelta
from typing import Any, Callable, Awaitable
from enum import Enum
import uuid

from pydantic import BaseModel, Field

from ..auth import UserContext, AuthStatus


class NotificationType(str, Enum):
    """Types of notifications."""
    DEAL_EXPIRING = "deal_expiring"
    DEAL_COMPLETED = "deal_completed"
    DEAL_FAILED = "deal_failed"
    PROVIDER_OFFLINE = "provider_offline"
    PROVIDER_ISSUE = "provider_issue"
    NETWORK_ALERT = "network_alert"
    PAYMENT_RECEIVED = "payment_received"
    PAYMENT_SENT = "payment_sent"
    MAINTENANCE = "maintenance"
    SECURITY = "security"
    SYSTEM = "system"


class NotificationPriority(str, Enum):
    """Priority levels for notifications."""
    LOW = "low"
    NORMAL = "normal"
    HIGH = "high"
    URGENT = "urgent"


class NotificationChannel(str, Enum):
    """Channels for notification delivery."""
    IN_APP = "in_app"
    EMAIL = "email"
    SMS = "sms"
    PUSH = "push"
    WEBHOOK = "webhook"


@dataclass
class Notification:
    """A notification to be delivered to a user."""
    id: str
    type: NotificationType
    title: str
    message: str
    priority: NotificationPriority
    channels: list[NotificationChannel]
    user_id: str | None
    created_at: datetime = field(default_factory=datetime.utcnow)
    read: bool = False
    dismissed: bool = False
    expires_at: datetime | None = None
    action_url: str | None = None
    action_label: str | None = None
    metadata: dict[str, Any] = field(default_factory=dict)
    source_api: str | None = None


@dataclass
class NotificationSubscription:
    """User subscription to notification types."""
    user_id: str
    notification_types: list[NotificationType]
    channels: list[NotificationChannel]
    enabled: bool = True
    quiet_hours_start: str | None = None  # HH:MM format
    quiet_hours_end: str | None = None


class NotificationGenerator:
    """Base class for notification generators."""

    async def check_and_generate(
        self,
        user_context: UserContext | None,
    ) -> list[Notification]:
        """Check conditions and generate notifications."""
        raise NotImplementedError


class DealExpirationNotifier(NotificationGenerator):
    """Generates notifications for expiring deals."""

    def __init__(self, warning_days: int = 7):
        self.warning_days = warning_days

    async def check_and_generate(
        self,
        user_context: UserContext | None,
    ) -> list[Notification]:
        """Check for expiring deals and generate notifications."""
        notifications = []
        
        if user_context is None or user_context.auth_status != AuthStatus.AUTHENTICATED:
            return notifications
        
        if not user_context.wallet_address:
            return notifications

        try:
            from ..integrations import get_backend_client
            backend = get_backend_client()
            deals = await backend.get_user_deals(
                wallet_address=user_context.wallet_address,
                include_history=False,
            )

            now = datetime.utcnow()
            
            for deal in deals:
                if deal.status == "active" and deal.end_epoch:
                    # Calculate days until expiration
                    days_remaining = (deal.end_epoch - int(now.timestamp())) // 86400
                    
                    if 0 < days_remaining <= self.warning_days:
                        # Determine priority based on urgency
                        if days_remaining <= 1:
                            priority = NotificationPriority.URGENT
                        elif days_remaining <= 3:
                            priority = NotificationPriority.HIGH
                        else:
                            priority = NotificationPriority.NORMAL

                        notifications.append(Notification(
                            id=str(uuid.uuid4()),
                            type=NotificationType.DEAL_EXPIRING,
                            title=f"Storage deal #{deal.id} expiring in {days_remaining} days",
                            message=(
                                f"Your storage deal with {deal.provider_name} for "
                                f"{deal.storage_gb}GB is expiring soon. "
                                f"Renew now to avoid data loss."
                            ),
                            priority=priority,
                            channels=[NotificationChannel.IN_APP, NotificationChannel.EMAIL],
                            user_id=user_context.user_id,
                            action_url=f"/deals/{deal.id}/renew",
                            action_label="Renew Deal",
                            metadata={
                                "deal_id": deal.id,
                                "provider_name": deal.provider_name,
                                "storage_gb": deal.storage_gb,
                                "days_remaining": days_remaining,
                            },
                            source_api="GET /api/deals",
                        ))

        except Exception:
            pass

        return notifications


class ProviderHealthNotifier(NotificationGenerator):
    """Generates notifications for provider issues."""

    async def check_and_generate(
        self,
        user_context: UserContext | None,
    ) -> list[Notification]:
        """Check for provider issues and generate notifications."""
        notifications = []
        
        if user_context is None or user_context.auth_status != AuthStatus.AUTHENTICATED:
            return notifications

        try:
            from ..integrations import get_backend_client
            backend = get_backend_client()
            
            # Get user's providers (simplified - would need user-provider mapping)
            providers = await backend.get_providers(active_only=False)
            
            # Check for offline providers
            for provider in providers:
                if not provider.is_active:
                    notifications.append(Notification(
                        id=str(uuid.uuid4()),
                        type=NotificationType.PROVIDER_OFFLINE,
                        title=f"Provider {provider.name} is offline",
                        message=(
                            f"The storage provider '{provider.name}' you have deals with "
                            f"is currently offline. Your data may be at risk."
                        ),
                        priority=NotificationPriority.HIGH,
                        channels=[NotificationChannel.IN_APP],
                        user_id=user_context.user_id,
                        metadata={
                            "provider_id": provider.id,
                            "provider_name": provider.name,
                        },
                        source_api="GET /api/providers",
                    ))

        except Exception:
            pass

        return notifications


class NetworkAlertNotifier(NotificationGenerator):
    """Generates network-wide alert notifications."""

    async def check_and_generate(
        self,
        user_context: UserContext | None,
    ) -> list[Notification]:
        """Check for network alerts and generate notifications."""
        notifications = []
        
        # This would typically be triggered by backend events
        # For now, return empty list
        # In production, this would subscribe to webhook events

        return notifications


class NotificationManager:
    """Manages notification generation, storage, and delivery."""

    def __init__(self):
        self._generators: list[NotificationGenerator] = [
            DealExpirationNotifier(warning_days=7),
            ProviderHealthNotifier(),
            NetworkAlertNotifier(),
        ]
        self._notifications: dict[str, list[Notification]] = {}  # user_id -> notifications
        self._subscriptions: dict[str, NotificationSubscription] = {}
        self._webhooks: list[Callable[[Notification], Awaitable[None]]] = []

    async def generate_notifications(
        self,
        user_context: UserContext | None,
    ) -> list[Notification]:
        """Generate notifications for a user."""
        all_notifications = []
        
        for generator in self._generators:
            try:
                notifications = await generator.check_and_generate(user_context)
                all_notifications.extend(notifications)
            except Exception:
                pass

        # Sort by priority
        priority_order = {
            NotificationPriority.URGENT: 0,
            NotificationPriority.HIGH: 1,
            NotificationPriority.NORMAL: 2,
            NotificationPriority.LOW: 3,
        }
        all_notifications.sort(key=lambda x: priority_order.get(x.priority, 99))

        # Store notifications
        if user_context and user_context.user_id:
            user_id = user_context.user_id
            if user_id not in self._notifications:
                self._notifications[user_id] = []
            self._notifications[user_id].extend(all_notifications)

        return all_notifications

    def get_user_notifications(
        self,
        user_id: str,
        unread_only: bool = False,
        limit: int = 50,
    ) -> list[Notification]:
        """Get notifications for a user."""
        notifications = self._notifications.get(user_id, [])
        
        if unread_only:
            notifications = [n for n in notifications if not n.read]
        
        # Sort by creation date (newest first) and limit
        return sorted(notifications, key=lambda x: x.created_at, reverse=True)[:limit]

    def mark_as_read(self, user_id: str, notification_id: str) -> bool:
        """Mark a notification as read."""
        notifications = self._notifications.get(user_id, [])
        for notification in notifications:
            if notification.id == notification_id:
                notification.read = True
                return True
        return False

    def mark_all_as_read(self, user_id: str) -> int:
        """Mark all notifications as read for a user."""
        notifications = self._notifications.get(user_id, [])
        count = 0
        for notification in notifications:
            if not notification.read:
                notification.read = True
                count += 1
        return count

    def dismiss_notification(self, user_id: str, notification_id: str) -> bool:
        """Dismiss a notification."""
        notifications = self._notifications.get(user_id, [])
        for notification in notifications:
            if notification.id == notification_id:
                notification.dismissed = True
                return True
        return False

    def get_unread_count(self, user_id: str) -> int:
        """Get count of unread notifications."""
        notifications = self._notifications.get(user_id, [])
        return sum(1 for n in notifications if not n.read and not n.dismissed)

    def subscribe(
        self,
        user_id: str,
        notification_types: list[NotificationType],
        channels: list[NotificationChannel],
    ) -> NotificationSubscription:
        """Subscribe a user to notification types."""
        subscription = NotificationSubscription(
            user_id=user_id,
            notification_types=notification_types,
            channels=channels,
        )
        self._subscriptions[user_id] = subscription
        return subscription

    def unsubscribe(self, user_id: str) -> bool:
        """Unsubscribe a user from all notifications."""
        if user_id in self._subscriptions:
            del self._subscriptions[user_id]
            return True
        return False

    def register_webhook(self, callback: Callable[[Notification], Awaitable[None]]) -> None:
        """Register a webhook callback for notification delivery."""
        self._webhooks.append(callback)

    async def deliver_notification(self, notification: Notification) -> None:
        """Deliver a notification via registered channels."""
        for webhook in self._webhooks:
            try:
                await webhook(notification)
            except Exception:
                pass

    def clear_old_notifications(self, max_age_days: int = 30) -> int:
        """Clear old notifications."""
        cutoff = datetime.utcnow() - timedelta(days=max_age_days)
        cleared = 0
        
        for user_id in list(self._notifications.keys()):
            notifications = self._notifications[user_id]
            self._notifications[user_id] = [
                n for n in notifications 
                if n.created_at > cutoff or not n.dismissed
            ]
            cleared += len(notifications) - len(self._notifications[user_id])
        
        return cleared


# Global notification manager
_notification_manager: NotificationManager | None = None


def get_notification_manager() -> NotificationManager:
    """Get the global notification manager."""
    global _notification_manager
    if _notification_manager is None:
        _notification_manager = NotificationManager()
    return _notification_manager


def reset_notification_manager() -> None:
    """Reset the notification manager (for testing)."""
    global _notification_manager
    _notification_manager = None


__all__ = [
    "NotificationType",
    "NotificationPriority",
    "NotificationChannel",
    "Notification",
    "NotificationSubscription",
    "NotificationGenerator",
    "DealExpirationNotifier",
    "ProviderHealthNotifier",
    "NetworkAlertNotifier",
    "NotificationManager",
    "get_notification_manager",
    "reset_notification_manager",
]
