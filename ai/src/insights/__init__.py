"""Insights module for ADADIVE AI v3 - Proactive Intelligence.

Generates and manages proactive insights for users, providers, and administrators:
- Storage deal insights (expiring deals, cost optimization)
- Provider insights (performance, earnings)
- Network insights (platform health, alerts)
- Admin insights (platform metrics, user activity)
"""

from dataclasses import dataclass, field
from datetime import datetime, timedelta
from typing import Any, AsyncGenerator
import uuid

from ..workspace import (
    WorkspaceInsight,
    InsightCategory,
    InsightPriority,
    UserRole,
)
from ..auth import UserContext, AuthStatus
from ..integrations import get_backend_client, DealInfo


@dataclass
class InsightGenerator:
    """Base class for insight generators."""
    name: str

    async def generate(
        self,
        user_context: UserContext | None,
        role: UserRole,
    ) -> list[WorkspaceInsight]:
        """Generate insights for the given user context."""
        raise NotImplementedError


class ExpiringDealsInsightGenerator(InsightGenerator):
    """Generates insights about expiring storage deals."""

    def __init__(self):
        super().__init__("expiring_deals")
        self.expiration_threshold_days = 7  # Warn if expiring within 7 days

    async def generate(
        self,
        user_context: UserContext | None,
        role: UserRole,
    ) -> list[WorkspaceInsight]:
        """Check for expiring deals and generate insights."""
        insights = []
        
        if user_context is None or user_context.auth_status != AuthStatus.AUTHENTICATED:
            return insights
        
        if not user_context.wallet_address:
            return insights

        try:
            backend = get_backend_client()
            deals = await backend.get_user_deals(
                wallet_address=user_context.wallet_address,
                include_history=False,
            )

            # Find expiring deals
            now = datetime.utcnow()
            expiring = []
            
            for deal in deals:
                if deal.status == "active" and deal.end_epoch:
                    # Calculate days until expiration (rough estimate)
                    days_remaining = (deal.end_epoch - int(now.timestamp())) // 86400
                    if 0 <= days_remaining <= self.expiration_threshold_days:
                        expiring.append({
                            "deal": deal,
                            "days_remaining": days_remaining,
                        })

            if expiring:
                # Group by urgency
                urgent = [e for e in expiring if e["days_remaining"] <= 2]
                soon = [e for e in expiring if 2 < e["days_remaining"] <= 5]
                later = [e for e in expiring if e["days_remaining"] > 5]

                if urgent:
                    deal = urgent[0]["deal"]
                    insights.append(WorkspaceInsight(
                        id=str(uuid.uuid4()),
                        title=f"⚠️ Urgent: Deal #{deal.id} expiring soon!",
                        description=(
                            f"Your storage deal with {deal.provider_name} for "
                            f"{deal.storage_gb}GB is expiring in {urgent[0]['days_remaining']} days. "
                            f"Renew now to avoid data loss."
                        ),
                        category=InsightCategory.STORAGE,
                        priority=InsightPriority.CRITICAL,
                        user_id=user_context.user_id,
                        provider_id=deal.id,
                        action_required=True,
                        action_type="renew_deal",
                        action_params={"deal_id": deal.id},
                        metadata={
                            "deal_id": deal.id,
                            "provider": deal.provider_name,
                            "storage_gb": deal.storage_gb,
                            "days_remaining": urgent[0]["days_remaining"],
                            "total_expiring": len(urgent),
                        },
                        source_apis=["GET /api/deals"],
                    ))

                if soon:
                    total_storage = sum(e["deal"].storage_gb for e in soon)
                    insights.append(WorkspaceInsight(
                        id=str(uuid.uuid4()),
                        title=f"📅 {len(soon)} storage deals expiring soon",
                        description=(
                            f"You have {len(soon)} storage deals totaling {total_storage:.1f}GB "
                            f"expiring in the next 5 days. Consider renewing them to maintain your data."
                        ),
                        category=InsightCategory.STORAGE,
                        priority=InsightPriority.HIGH,
                        user_id=user_context.user_id,
                        provider_id=None,
                        action_required=False,
                        metadata={
                            "deal_count": len(soon),
                            "total_storage_gb": total_storage,
                        },
                        source_apis=["GET /api/deals"],
                    ))

        except Exception:
            pass  # Silently handle errors in insight generation

        return insights


class CostOptimizationInsightGenerator(InsightGenerator):
    """Generates cost optimization insights."""

    def __init__(self):
        super().__init__("cost_optimization")

    async def generate(
        self,
        user_context: UserContext | None,
        role: UserRole,
    ) -> list[WorkspaceInsight]:
        """Generate cost optimization insights."""
        insights = []
        
        if user_context is None or user_context.auth_status != AuthStatus.AUTHENTICATED:
            return insights

        try:
            backend = get_backend_client()
            summary = await backend.get_user_storage_summary(user_context.wallet_address)

            if summary.get("total_deals", 0) > 5:
                avg_cost = summary.get("total_spent_ada", 0) / summary.get("total_deals", 1)
                
                if avg_cost > 100:  # High average cost
                    insights.append(WorkspaceInsight(
                        id=str(uuid.uuid4()),
                        title="💰 Consider optimizing storage costs",
                        description=(
                            f"Your average deal cost is {avg_cost:.2f} ADA. "
                            f"You might save by selecting providers with lower rates or "
                            f"negotiating longer-term contracts."
                        ),
                        category=InsightCategory.COST,
                        priority=InsightPriority.MEDIUM,
                        user_id=user_context.user_id,
                        provider_id=None,
                        action_required=False,
                        metadata={
                            "avg_deal_cost": avg_cost,
                            "total_deals": summary.get("total_deals", 0),
                        },
                        source_apis=["GET /api/deals", "GET /api/stats"],
                    ))

        except Exception:
            pass

        return insights


class ProviderPerformanceInsightGenerator(InsightGenerator):
    """Generates provider performance insights for providers."""

    def __init__(self):
        super().__init__("provider_performance")

    async def generate(
        self,
        user_context: UserContext | None,
        role: UserRole,
    ) -> list[WorkspaceInsight]:
        """Generate provider performance insights."""
        insights = []
        
        if role != UserRole.PROVIDER:
            return insights

        # For providers, generate performance insights
        try:
            backend = get_backend_client()
            providers = await backend.get_providers()

            # Find this provider
            my_provider = None
            for p in providers:
                # In real implementation, would match by owner address
                if p.is_active:
                    my_provider = p
                    break

            if my_provider:
                if my_provider.active_deals == 0:
                    insights.append(WorkspaceInsight(
                        id=str(uuid.uuid4()),
                        title="📊 Your provider has no active deals",
                        description=(
                            "Consider lowering your storage rates or improving your "
                            "provider's uptime and reputation to attract more clients."
                        ),
                        category=InsightCategory.PROVIDER,
                        priority=InsightPriority.MEDIUM,
                        user_id=user_context.user_id if user_context else None,
                        provider_id=my_provider.id,
                        action_required=False,
                        metadata={
                            "provider_id": my_provider.id,
                            "provider_name": my_provider.name,
                        },
                        source_apis=["GET /api/providers"],
                    ))

        except Exception:
            pass

        return insights


class NetworkHealthInsightGenerator(InsightGenerator):
    """Generates network health insights for admins."""

    def __init__(self):
        super().__init__("network_health")

    async def generate(
        self,
        user_context: UserContext | None,
        role: UserRole,
    ) -> list[WorkspaceInsight]:
        """Generate network health insights."""
        insights = []
        
        if role != UserRole.ADMIN:
            return insights

        try:
            backend = get_backend_client()
            stats = await backend.get_platform_stats()

            if stats:
                # Check for concerning metrics
                if stats.active_deals == 0:
                    insights.append(WorkspaceInsight(
                        id=str(uuid.uuid4()),
                        title="⚠️ No active deals on platform",
                        description=(
                            "The platform currently has no active storage deals. "
                            "This may indicate an issue with the network or provider availability."
                        ),
                        category=InsightCategory.NETWORK,
                        priority=InsightPriority.HIGH,
                        user_id=None,
                        provider_id=None,
                        action_required=False,
                        metadata={
                            "active_deals": stats.active_deals,
                            "total_deals": stats.total_deals,
                        },
                        source_apis=["GET /api/stats"],
                    ))

                if stats.provider_count < 3:
                    insights.append(WorkspaceInsight(
                        id=str(uuid.uuid4()),
                        title="📉 Low provider count",
                        description=(
                            f"Only {stats.provider_count} providers are active. "
                            f"Consider recruiting more storage providers to improve network resilience."
                        ),
                        category=InsightCategory.NETWORK,
                        priority=InsightPriority.MEDIUM,
                        user_id=None,
                        provider_id=None,
                        action_required=False,
                        metadata={
                            "provider_count": stats.provider_count,
                        },
                        source_apis=["GET /api/stats"],
                    ))

        except Exception:
            pass

        return insights


class NewOpportunityInsightGenerator(InsightGenerator):
    """Generates opportunity insights."""

    def __init__(self):
        super().__init__("opportunities")

    async def generate(
        self,
        user_context: UserContext | None,
        role: UserRole,
    ) -> list[WorkspaceInsight]:
        """Generate opportunity insights."""
        insights = []
        
        if user_context is None or user_context.auth_status != AuthStatus.AUTHENTICATED:
            return insights

        try:
            backend = get_backend_client()
            providers = await backend.get_providers(active_only=True)
            stats = await backend.get_platform_stats()

            if providers and stats:
                # Suggest becoming a provider if there are few
                if stats.provider_count < 10 and role == UserRole.USER:
                    insights.append(WorkspaceInsight(
                        id=str(uuid.uuid4()),
                        title="🚀 Become a storage provider",
                        description=(
                            f"With only {stats.provider_count} providers, there's room for more! "
                            f"Start earning ADA by providing storage on the ADADIVE network."
                        ),
                        category=InsightCategory.OPPORTUNITY,
                        priority=InsightPriority.LOW,
                        user_id=user_context.user_id,
                        provider_id=None,
                        action_required=False,
                        action_type="become_provider",
                        metadata={
                            "current_provider_count": stats.provider_count,
                        },
                        source_apis=["GET /api/providers", "GET /api/stats"],
                    ))

        except Exception:
            pass

        return insights


class InsightsManager:
    """Manages insight generation and delivery."""

    def __init__(self):
        self._generators: list[InsightGenerator] = [
            ExpiringDealsInsightGenerator(),
            CostOptimizationInsightGenerator(),
            ProviderPerformanceInsightGenerator(),
            NetworkHealthInsightGenerator(),
            NewOpportunityInsightGenerator(),
        ]
        self._cached_insights: dict[str, list[WorkspaceInsight]] = {}
        self._cache_ttl_seconds = 300  # 5 minutes

    async def generate_insights(
        self,
        user_context: UserContext | None,
        role: UserRole,
        force_refresh: bool = False,
    ) -> list[WorkspaceInsight]:
        """Generate insights for a user."""
        # Create cache key
        cache_key = user_context.user_id if user_context else "anonymous"
        
        # Check cache
        if not force_refresh and cache_key in self._cached_insights:
            cached = self._cached_insights[cache_key]
            if cached and (datetime.utcnow() - cached[0].created_at).total_seconds() < self._cache_ttl_seconds:
                return cached

        # Generate insights from all generators
        all_insights = []
        for generator in self._generators:
            try:
                insights = await generator.generate(user_context, role)
                all_insights.extend(insights)
            except Exception:
                pass

        # Sort by priority
        priority_order = {
            InsightPriority.CRITICAL: 0,
            InsightPriority.HIGH: 1,
            InsightPriority.MEDIUM: 2,
            InsightPriority.LOW: 3,
        }
        all_insights.sort(key=lambda x: priority_order.get(x.priority, 99))

        # Cache results
        self._cached_insights[cache_key] = all_insights

        return all_insights

    def dismiss_insight(self, insight_id: str, user_id: str) -> bool:
        """Dismiss an insight for a user."""
        cache_key = user_id
        if cache_key in self._cached_insights:
            for insight in self._cached_insights[cache_key]:
                if insight.id == insight_id:
                    insight.dismissed = True
                    return True
        return False

    def clear_cache(self) -> None:
        """Clear the insights cache."""
        self._cached_insights.clear()


# Global insights manager
_insights_manager: InsightsManager | None = None


def get_insights_manager() -> InsightsManager:
    """Get the global insights manager."""
    global _insights_manager
    if _insights_manager is None:
        _insights_manager = InsightsManager()
    return _insights_manager


def reset_insights_manager() -> None:
    """Reset the insights manager (for testing)."""
    global _insights_manager
    _insights_manager = None


__all__ = [
    "InsightGenerator",
    "ExpiringDealsInsightGenerator",
    "CostOptimizationInsightGenerator",
    "ProviderPerformanceInsightGenerator",
    "NetworkHealthInsightGenerator",
    "NewOpportunityInsightGenerator",
    "InsightsManager",
    "get_insights_manager",
    "reset_insights_manager",
]
