"""Authentication module for ADADIVE AI service."""

from typing import Any
from dataclasses import dataclass
from enum import Enum

from pydantic import BaseModel, Field

from ..config import get_settings


class AuthStatus(Enum):
    """Authentication status."""
    ANONYMOUS = "anonymous"
    AUTHENTICATED = "authenticated"
    INVALID = "invalid"
    EXPIRED = "expired"


@dataclass
class UserContext:
    """Context about the authenticated user."""
    user_id: str | None
    wallet_address: str | None
    auth_status: AuthStatus
    permissions: list[str]


class ChatAuthRequest(BaseModel):
    """Request for authenticated chat endpoint."""
    token: str | None = Field(default=None, description="JWT token for authentication")
    anonymous_id: str | None = Field(
        default=None, 
        description="Anonymous session ID for unauthenticated requests"
    )


class ChatAuthResponse(BaseModel):
    """Response containing authentication context."""
    status: AuthStatus
    user_id: str | None = None
    permissions: list[str] = Field(default_factory=list)
    message: str | None = None


class TokenPayload(BaseModel):
    """JWT token payload structure."""
    sub: str  # user_id
    wallet_address: str | None = None
    permissions: list[str] = Field(default_factory=list)
    exp: int | None = None
    iat: int | None = None


def verify_token(token: str) -> TokenPayload | None:
    """
    Verify a JWT token and extract payload.
    
    In production, this should use proper JWT verification with the secret key.
    For now, this is a stub that will be implemented when auth is enabled.
    """
    settings = get_settings()
    
    if not settings.auth_enabled:
        return None
    
    # TODO: Implement proper JWT verification
    # For now, return None to indicate auth is not fully implemented
    return None


def extract_anonymous_id(anonymous_id: str | None) -> str | None:
    """
    Extract and validate anonymous session ID.
    
    Returns the session ID if valid, None otherwise.
    """
    if not anonymous_id:
        return None
    
    # Basic validation - in production, this would check session store
    if len(anonymous_id) < 16:
        return None
    
    return anonymous_id


def get_user_context(
    token: str | None = None,
    anonymous_id: str | None = None,
) -> UserContext:
    """
    Get user context from authentication credentials.
    
    Args:
        token: JWT token (for authenticated users)
        anonymous_id: Anonymous session ID
    
    Returns:
        UserContext with authentication status and user info
    """
    settings = get_settings()
    
    # Check for authenticated user
    if token:
        payload = verify_token(token)
        if payload:
            return UserContext(
                user_id=payload.sub,
                wallet_address=payload.wallet_address,
                auth_status=AuthStatus.AUTHENTICATED,
                permissions=payload.permissions,
            )
        else:
            return UserContext(
                user_id=None,
                wallet_address=None,
                auth_status=AuthStatus.INVALID,
                permissions=[],
            )
    
    # Check for anonymous session
    if anonymous_id:
        validated_id = extract_anonymous_id(anonymous_id)
        if validated_id:
            return UserContext(
                user_id=validated_id,
                wallet_address=None,
                auth_status=AuthStatus.ANONYMOUS,
                permissions=["read_public_info"],
            )
    
    # No authentication provided
    return UserContext(
        user_id=None,
        wallet_address=None,
        auth_status=AuthStatus.ANONYMOUS,
        permissions=["read_public_info"],
    )


def check_permission(user_context: UserContext, required_permission: str) -> bool:
    """
    Check if user has a required permission.
    
    Args:
        user_context: The user's authentication context
        required_permission: The permission to check for
    
    Returns:
        True if user has the permission, False otherwise
    """
    return required_permission in user_context.permissions


# Permission constants
class Permissions:
    """Permission constants for the AI service."""
    READ_PUBLIC_INFO = "read_public_info"
    READ_OWN_DEALS = "read_own_deals"
    READ_OWN_WALLET = "read_own_wallet"
    QUERY_PLATFORM_STATS = "query_platform_stats"
    # Note: WRITE permissions (signing, transactions) are intentionally NOT included
    # The AI service should never have write permissions
