"""Integrations module for ADADIVE AI service - backend API client."""

from typing import Any
from dataclasses import dataclass

import httpx

from ..config import get_settings


@dataclass
class DealInfo:
    """Information about a storage deal."""
    id: int
    provider_name: str
    client_address: str
    storage_gb: float
    duration_epochs: int
    total_cost_ada: float
    status: str
    data_hash: str
    start_epoch: int | None
    end_epoch: int | None
    tx_hash: str | None
    created_at: str


@dataclass
class ProviderInfo:
    """Information about a storage provider."""
    id: int
    name: str
    endpoint: str | None
    total_deals: int
    active_deals: int
    is_active: bool


@dataclass
class PlatformStats:
    """Platform-wide statistics."""
    total_storage_gb: float
    total_deals: int
    active_deals: int
    average_cost_ada: float
    provider_count: int


class BackendAPIClient:
    """
    Client for communicating with ADADIVE backend API.
    
    This client is used to fetch live platform data (deals, providers, stats)
    without direct database access.
    """

    def __init__(self, base_url: str | None = None, timeout: int = 30):
        settings = get_settings()
        self.base_url = base_url or settings.backend_api_base_url
        self.timeout = timeout
        self._client: httpx.AsyncClient | None = None

    async def _get_client(self) -> httpx.AsyncClient:
        """Get or create the HTTP client."""
        if self._client is None:
            self._client = httpx.AsyncClient(
                base_url=self.base_url,
                timeout=self.timeout,
            )
        return self._client

    async def close(self) -> None:
        """Close the HTTP client."""
        if self._client:
            await self._client.aclose()
            self._client = None

    async def health_check(self) -> bool:
        """Check if the backend API is available."""
        try:
            client = await self._get_client()
            response = await client.get("/api/health")
            return response.status_code == 200
        except Exception:
            return False

    async def get_user_deals(
        self,
        wallet_address: str,
        include_history: bool = False,
    ) -> list[DealInfo]:
        """
        Get storage deals for a specific wallet address.
        
        Args:
            wallet_address: The user's Cardano wallet address
            include_history: Include completed/failed deals
        
        Returns:
            List of DealInfo objects
        """
        try:
            client = await self._get_client()
            
            params = {"client_address": wallet_address}
            if include_history:
                params["include_history"] = "true"
            
            response = await client.get("/api/deals", params=params)
            response.raise_for_status()
            
            data = response.json()
            return [DealInfo(**deal) for deal in data.get("deals", [])]
        except httpx.HTTPError:
            return []

    async def get_deal_by_id(self, deal_id: int) -> DealInfo | None:
        """Get a specific deal by ID."""
        try:
            client = await self._get_client()
            response = await client.get(f"/api/deals/{deal_id}")
            response.raise_for_status()
            
            data = response.json()
            return DealInfo(**data)
        except httpx.HTTPError:
            return None

    async def get_providers(self, active_only: bool = False) -> list[ProviderInfo]:
        """
        Get storage providers.
        
        Args:
            active_only: Only return active providers
        
        Returns:
            List of ProviderInfo objects
        """
        try:
            client = await self._get_client()
            
            params = {}
            if active_only:
                params["active"] = "true"
            
            response = await client.get("/api/providers", params=params)
            response.raise_for_status()
            
            data = response.json()
            return [ProviderInfo(**provider) for provider in data.get("providers", [])]
        except httpx.HTTPError:
            return []

    async def get_provider_by_id(self, provider_id: int) -> ProviderInfo | None:
        """Get a specific provider by ID."""
        try:
            client = await self._get_client()
            response = await client.get(f"/api/providers/{provider_id}")
            response.raise_for_status()
            
            data = response.json()
            return ProviderInfo(**data)
        except httpx.HTTPError:
            return None

    async def get_platform_stats(self) -> PlatformStats | None:
        """Get platform-wide statistics."""
        try:
            client = await self._get_client()
            response = await client.get("/api/stats")
            response.raise_for_status()
            
            data = response.json()
            return PlatformStats(**data)
        except httpx.HTTPError:
            return None

    async def get_user_storage_summary(self, wallet_address: str) -> dict[str, Any]:
        """
        Get a summary of user's storage activity.
        
        Args:
            wallet_address: The user's Cardano wallet address
        
        Returns:
            Summary dictionary with deal counts, storage totals, etc.
        """
        deals = await self.get_user_deals(wallet_address, include_history=True)
        
        if not deals:
            return {
                "total_deals": 0,
                "active_deals": 0,
                "completed_deals": 0,
                "total_storage_gb": 0,
                "total_spent_ada": 0,
            }
        
        return {
            "total_deals": len(deals),
            "active_deals": sum(1 for d in deals if d.status == "active"),
            "completed_deals": sum(1 for d in deals if d.status == "completed"),
            "pending_deals": sum(1 for d in deals if d.status == "pending"),
            "failed_deals": sum(1 for d in deals if d.status == "failed"),
            "total_storage_gb": sum(d.storage_gb for d in deals),
            "total_spent_ada": sum(d.total_cost_ada for d in deals),
        }


# Global client instance
_backend_client: BackendAPIClient | None = None


def get_backend_client() -> BackendAPIClient:
    """Get or create the global backend API client."""
    global _backend_client
    if _backend_client is None:
        _backend_client = BackendAPIClient()
    return _backend_client
