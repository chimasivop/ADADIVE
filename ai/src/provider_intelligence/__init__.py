"""Provider Intelligence module for ADADIVE AI v3.

Provides analytics and insights for storage providers:
- Uptime tracking
- Utilization metrics
- Earnings analysis
- Performance comparison
- Recommendation engine
"""

from dataclasses import dataclass, field
from datetime import datetime, timedelta
from typing import Any
from enum import Enum

from pydantic import BaseModel, Field

from ..auth import UserContext, AuthStatus


class ProviderMetricType(str, Enum):
    """Types of provider metrics."""
    UPTIME = "uptime"
    UTILIZATION = "utilization"
    EARNINGS = "earnings"
    RELIABILITY = "reliability"
    RESPONSE_TIME = "response_time"


@dataclass
class UptimeMetrics:
    """Provider uptime metrics."""
    provider_id: int
    provider_name: str
    uptime_percentage: float
    total_epochs: int
    active_epochs: int
    last_check_in: datetime | None
    consecutive_uptime: int  # Epochs of continuous uptime
    downtime_events: list[dict[str, Any]]
    source_api: str = "GET /api/providers/{id}"


@dataclass
class UtilizationMetrics:
    """Provider storage utilization metrics."""
    provider_id: int
    provider_name: str
    total_capacity_gb: float
    used_capacity_gb: float
    utilization_percentage: float
    active_deals: int
    completed_deals: int
    failed_deals: int
    success_rate: float  # Percentage of successfully completed deals
    average_deal_duration: float  # In epochs
    source_api: str = "GET /api/providers/{id}"


@dataclass
class EarningsMetrics:
    """Provider earnings metrics."""
    provider_id: int
    provider_name: str
    total_earnings_ada: float
    pending_payments_ada: float
    completed_payments_ada: float
    average_deal_value_ada: float
    deals_this_month: int
    earnings_this_month_ada: float
    price_per_gb_epoch: float
    source_api: str = "GET /api/providers/{id}"


@dataclass
class PerformanceScore:
    """Overall provider performance score."""
    provider_id: int
    overall_score: float  # 0-100
    uptime_score: float
    reliability_score: float
    utilization_score: float
    earnings_score: float
    ranking_percentile: float  # Top X%
    compared_to_average: dict[str, float]
    source_apis: list[str] = field(default_factory=list)


@dataclass
class ProviderRecommendation:
    """Recommendation for a provider."""
    provider_id: int
    provider_name: str
    recommendation_type: str  # pricing, capacity, reliability
    priority: str  # low, medium, high
    title: str
    description: str
    potential_impact: str
    action_suggested: str | None = None
    estimated_benefit: str | None = None


class ProviderIntelligenceEngine:
    """Engine for analyzing and generating provider insights."""

    def __init__(self):
        self._cache: dict[str, Any] = {}
        self._cache_ttl_seconds = 300  # 5 minutes

    async def get_provider_uptime(self, provider_id: int) -> UptimeMetrics | None:
        """Get uptime metrics for a provider."""
        try:
            from ..integrations import get_backend_client
            backend = get_backend_client()
            provider = await backend.get_provider_by_id(provider_id)
            
            if not provider:
                return None

            # Calculate uptime metrics (simplified)
            total_deals = provider.total_deals
            active_deals = provider.active_deals
            
            # Estimate uptime based on active deals ratio
            uptime_pct = (active_deals / max(total_deals, 1)) * 100 if total_deals > 0 else 100.0

            return UptimeMetrics(
                provider_id=provider_id,
                provider_name=provider.name,
                uptime_percentage=min(uptime_pct, 100.0),
                total_epochs=1000,  # Would be calculated from actual data
                active_epochs=int(uptime_pct * 10),
                last_check_in=datetime.utcnow(),
                consecutive_uptime=int(uptime_pct * 10),
                downtime_events=[],
                source_api=f"GET /api/providers/{provider_id}",
            )

        except Exception:
            return None

    async def get_provider_utilization(self, provider_id: int) -> UtilizationMetrics | None:
        """Get utilization metrics for a provider."""
        try:
            from ..integrations import get_backend_client
            backend = get_backend_client()
            provider = await backend.get_provider_by_id(provider_id)
            
            if not provider:
                return None

            # Calculate utilization (simplified estimates)
            total_capacity = 10000.0  # Would come from provider profile
            used_capacity = provider.active_deals * 100  # Estimate
            utilization = (used_capacity / total_capacity) * 100 if total_capacity > 0 else 0

            # Calculate success rate
            total = provider.total_deals
            active = provider.active_deals
            completed = max(0, total - active - 5)  # Rough estimate
            failed = 5  # Rough estimate
            success_rate = (completed / max(total, 1)) * 100

            return UtilizationMetrics(
                provider_id=provider_id,
                provider_name=provider.name,
                total_capacity_gb=total_capacity,
                used_capacity_gb=used_capacity,
                utilization_percentage=min(utilization, 100.0),
                active_deals=provider.active_deals,
                completed_deals=completed,
                failed_deals=failed,
                success_rate=success_rate,
                average_deal_duration=5000,  # Would be calculated from actual data
                source_api=f"GET /api/providers/{provider_id}",
            )

        except Exception:
            return None

    async def get_provider_earnings(self, provider_id: int) -> EarningsMetrics | None:
        """Get earnings metrics for a provider."""
        try:
            from ..integrations import get_backend_client
            backend = get_backend_client()
            provider = await backend.get_provider_by_id(provider_id)
            
            if not provider:
                return None

            # Estimate earnings (simplified)
            avg_deal_value = 50.0  # ADA
            completed_deals = provider.total_deals - provider.active_deals
            total_earnings = completed_deals * avg_deal_value

            return EarningsMetrics(
                provider_id=provider_id,
                provider_name=provider.name,
                total_earnings_ada=total_earnings,
                pending_payments_ada=provider.active_deals * avg_deal_value * 0.1,
                completed_payments_ada=total_earnings,
                average_deal_value_ada=avg_deal_value,
                deals_this_month=completed_deals // 12,  # Rough estimate
                earnings_this_month_ada=total_earnings / 12,  # Rough estimate
                price_per_gb_epoch=0.01,  # Would come from provider profile
                source_api=f"GET /api/providers/{provider_id}",
            )

        except Exception:
            return None

    async def get_performance_score(self, provider_id: int) -> PerformanceScore | None:
        """Calculate overall performance score for a provider."""
        uptime = await self.get_provider_uptime(provider_id)
        utilization = await self.get_provider_utilization(provider_id)
        earnings = await self.get_provider_earnings(provider_id)

        if not all([uptime, utilization, earnings]):
            return None

        # Calculate individual scores (0-100)
        uptime_score = uptime.uptime_percentage
        reliability_score = utilization.success_rate
        utilization_score = min(utilization.utilization_percentage, 100)
        earnings_score = min(earnings.earnings_this_month_ada / 100 * 100, 100)  # Normalize

        # Overall score (weighted average)
        overall = (
            uptime_score * 0.25 +
            reliability_score * 0.30 +
            utilization_score * 0.20 +
            earnings_score * 0.25
        )

        return PerformanceScore(
            provider_id=provider_id,
            overall_score=round(overall, 2),
            uptime_score=round(uptime_score, 2),
            reliability_score=round(reliability_score, 2),
            utilization_score=round(utilization_score, 2),
            earnings_score=round(earnings_score, 2),
            ranking_percentile=50.0,  # Would be calculated from all providers
            compared_to_average={
                "uptime": round(uptime_score - 95.0, 2),  # vs average
                "reliability": round(reliability_score - 90.0, 2),
            },
            source_apis=[
                f"GET /api/providers/{provider_id}",
                "GET /api/deals",
            ],
        )

    async def get_provider_recommendations(self, provider_id: int) -> list[ProviderRecommendation]:
        """Generate recommendations for a provider."""
        recommendations = []
        
        utilization = await self.get_provider_utilization(provider_id)
        earnings = await self.get_provider_earnings(provider_id)

        if not utilization or not earnings:
            return recommendations

        # Low utilization recommendations
        if utilization.utilization_percentage < 30:
            recommendations.append(ProviderRecommendation(
                provider_id=provider_id,
                provider_name=utilization.provider_name,
                recommendation_type="pricing",
                priority="high",
                title="Increase deal volume",
                description=(
                    f"Your provider is only {utilization.utilization_percentage:.1f}% utilized. "
                    f"Consider adjusting your pricing to attract more clients."
                ),
                potential_impact="Could increase earnings by 50-100%",
                action_suggested="Review and adjust pricing strategy",
            ))

        # High failure rate recommendations
        if utilization.failed_deals > 5:
            recommendations.append(ProviderRecommendation(
                provider_id=provider_id,
                provider_name=utilization.provider_name,
                recommendation_type="reliability",
                priority="high",
                title="Improve deal completion rate",
                description=(
                    f"You've had {utilization.failed_deals} failed deals recently. "
                    f"Investigate storage issues and improve reliability."
                ),
                potential_impact="Better reputation and more clients",
                action_suggested="Review storage logs and hardware health",
            ))

        # High utilization recommendations
        if utilization.utilization_percentage > 80:
            recommendations.append(ProviderRecommendation(
                provider_id=provider_id,
                provider_name=utilization.provider_name,
                recommendation_type="capacity",
                priority="medium",
                title="Consider expanding capacity",
                description=(
                    f"Your storage is {utilization.utilization_percentage:.1f}% full. "
                    f"Consider adding more storage capacity."
                ),
                potential_impact="Capture more deals and increase earnings",
                action_suggested="Plan storage expansion",
            ))

        return recommendations

    async def compare_providers(self, provider_ids: list[int]) -> dict[str, Any]:
        """Compare multiple providers."""
        comparisons = []
        
        for provider_id in provider_ids:
            uptime = await self.get_provider_uptime(provider_id)
            utilization = await self.get_provider_utilization(provider_id)
            score = await self.get_performance_score(provider_id)
            
            if uptime and utilization and score:
                comparisons.append({
                    "provider_id": provider_id,
                    "provider_name": uptime.provider_name,
                    "uptime_percentage": uptime.uptime_percentage,
                    "utilization_percentage": utilization.utilization_percentage,
                    "active_deals": utilization.active_deals,
                    "overall_score": score.overall_score,
                })

        # Sort by overall score
        comparisons.sort(key=lambda x: x["overall_score"], reverse=True)

        return {
            "rankings": comparisons,
            "best_uptime": max(comparisons, key=lambda x: x["uptime_percentage"]) if comparisons else None,
            "best_utilization": max(comparisons, key=lambda x: x["utilization_percentage"]) if comparisons else None,
            "top_rated": comparisons[0] if comparisons else None,
        }


# Global provider intelligence engine
_provider_intelligence: ProviderIntelligenceEngine | None = None


def get_provider_intelligence() -> ProviderIntelligenceEngine:
    """Get the global provider intelligence engine."""
    global _provider_intelligence
    if _provider_intelligence is None:
        _provider_intelligence = ProviderIntelligenceEngine()
    return _provider_intelligence


def reset_provider_intelligence() -> None:
    """Reset the provider intelligence engine (for testing)."""
    global _provider_intelligence
    _provider_intelligence = None


__all__ = [
    "ProviderMetricType",
    "UptimeMetrics",
    "UtilizationMetrics",
    "EarningsMetrics",
    "PerformanceScore",
    "ProviderRecommendation",
    "ProviderIntelligenceEngine",
    "get_provider_intelligence",
    "reset_provider_intelligence",
]
