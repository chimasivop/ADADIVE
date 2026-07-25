"""Workspace module for ADADIVE AI v3 - Intelligent Workspace integration.

Provides authenticated workspace features:
- User context and session management
- Dashboard integration
- Workspace preferences
- Activity tracking
"""

from dataclasses import dataclass, field
from datetime import datetime
from typing import Any
from enum import Enum

from pydantic import BaseModel, Field

from ..auth import UserContext, AuthStatus


class UserRole(str, Enum):
    """User roles in the ADADIVE platform."""
    USER = "user"
    PROVIDER = "provider"
    ADMIN = "admin"
    DEVELOPER = "developer"


class WorkspaceTheme(str, Enum):
    """UI theme options."""
    LIGHT = "light"
    DARK = "dark"
    SYSTEM = "system"


class InsightPriority(str, Enum):
    """Priority levels for insights."""
    LOW = "low"
    MEDIUM = "medium"
    HIGH = "high"
    CRITICAL = "critical"


class InsightCategory(str, Enum):
    """Categories of proactive insights."""
    STORAGE = "storage"           # Storage deal related
    PROVIDER = "provider"         # Provider related
    NETWORK = "network"          # Network/platform related
    SECURITY = "security"        # Security alerts
    COST = "cost"                # Cost optimization
    OPPORTUNITY = "opportunity"  # New opportunities
    MAINTENANCE = "maintenance"  # Maintenance notifications


@dataclass
class WorkspaceSession:
    """Session information for a workspace user."""
    session_id: str
    user_context: UserContext
    role: UserRole
    created_at: datetime = field(default_factory=datetime.utcnow)
    last_activity: datetime = field(default_factory=datetime.utcnow)
    preferences: dict[str, Any] = field(default_factory=dict)
    dashboard_state: dict[str, Any] = field(default_factory=dict)
    api_calls_made: list[dict[str, Any]] = field(default_factory=list)


@dataclass
class WorkspaceInsight:
    """A proactive insight generated for a user."""
    id: str
    title: str
    description: str
    category: InsightCategory
    priority: InsightPriority
    user_id: str | None
    provider_id: int | None
    created_at: datetime = field(default_factory=datetime.utcnow)
    expires_at: datetime | None = None
    dismissed: bool = False
    action_required: bool = False
    action_type: str | None = None
    action_params: dict[str, Any] = field(default_factory=dict)
    metadata: dict[str, Any] = field(default_factory=dict)
    source_apis: list[str] = field(default_factory=list)


@dataclass
class WorkspaceAction:
    """A natural language action that requires confirmation."""
    id: str
    action_type: str
    description: str
    requires_confirmation: bool
    confirmation_message: str
    backend_endpoint: str
    method: str  # GET, POST, etc.
    parameters: dict[str, Any]
    user_context: UserContext
    status: str = "pending"  # pending, confirmed, executing, completed, failed
    result: dict[str, Any] | None = None
    error: str | None = None
    created_at: datetime = field(default_factory=datetime.utcnow)
    executed_at: datetime | None = None


class WorkspacePreferences(BaseModel):
    """User workspace preferences."""
    theme: WorkspaceTheme = WorkspaceTheme.SYSTEM
    notifications_enabled: bool = True
    insight_frequency: str = "realtime"  # realtime, hourly, daily
    auto_refresh_interval: int = 60  # seconds
    compact_view: bool = False
    show_advanced_metrics: bool = False
    language: str = "en"


class WorkspaceManager:
    """Manages workspace sessions and user context."""

    def __init__(self):
        self._sessions: dict[str, WorkspaceSession] = {}
        self._preferences: dict[str, WorkspacePreferences] = {}

    def create_session(self, user_context: UserContext) -> WorkspaceSession:
        """Create a new workspace session."""
        import uuid
        session_id = str(uuid.uuid4())
        
        # Determine user role
        role = self._determine_role(user_context)
        
        # Get or create preferences
        if user_context.user_id not in self._preferences:
            self._preferences[user_context.user_id] = WorkspacePreferences()
        
        session = WorkspaceSession(
            session_id=session_id,
            user_context=user_context,
            role=role,
            preferences=self._preferences[user_context.user_id].model_dump(),
        )
        
        self._sessions[session_id] = session
        return session

    def get_session(self, session_id: str) -> WorkspaceSession | None:
        """Get a session by ID."""
        return self._sessions.get(session_id)

    def update_session_activity(self, session_id: str) -> None:
        """Update the last activity timestamp."""
        session = self._sessions.get(session_id)
        if session:
            session.last_activity = datetime.utcnow()

    def track_api_call(self, session_id: str, api_name: str, endpoint: str, params: dict | None = None) -> None:
        """Track an API call made on behalf of the user."""
        session = self._sessions.get(session_id)
        if session:
            session.api_calls_made.append({
                "api_name": api_name,
                "endpoint": endpoint,
                "parameters": params or {},
                "timestamp": datetime.utcnow().isoformat(),
            })

    def get_user_preferences(self, user_id: str) -> WorkspacePreferences:
        """Get or create workspace preferences for a user."""
        if user_id not in self._preferences:
            self._preferences[user_id] = WorkspacePreferences()
        return self._preferences[user_id]

    def update_preferences(self, user_id: str, preferences: WorkspacePreferences) -> None:
        """Update workspace preferences."""
        self._preferences[user_id] = preferences

    def _determine_role(self, user_context: UserContext) -> UserRole:
        """Determine user role from context."""
        if user_context.auth_status != AuthStatus.AUTHENTICATED:
            return UserRole.USER
        
        # For now, check if user has provider/admin markers in metadata
        metadata = user_context.metadata or {}
        if metadata.get("is_admin"):
            return UserRole.ADMIN
        if metadata.get("is_provider"):
            return UserRole.PROVIDER
        if metadata.get("is_developer"):
            return UserRole.DEVELOPER
        
        return UserRole.USER

    def get_active_sessions_count(self) -> int:
        """Get count of active sessions."""
        return len(self._sessions)

    def cleanup_old_sessions(self, max_age_seconds: int = 3600) -> int:
        """Remove sessions older than max_age_seconds."""
        now = datetime.utcnow()
        to_remove = []
        
        for session_id, session in self._sessions.items():
            age = (now - session.last_activity).total_seconds()
            if age > max_age_seconds:
                to_remove.append(session_id)
        
        for session_id in to_remove:
            del self._sessions[session_id]
        
        return len(to_remove)


# Global workspace manager
_workspace_manager: WorkspaceManager | None = None


def get_workspace_manager() -> WorkspaceManager:
    """Get the global workspace manager."""
    global _workspace_manager
    if _workspace_manager is None:
        _workspace_manager = WorkspaceManager()
    return _workspace_manager


def reset_workspace_manager() -> None:
    """Reset the workspace manager (for testing)."""
    global _workspace_manager
    _workspace_manager = None


__all__ = [
    "UserRole",
    "WorkspaceTheme",
    "InsightPriority",
    "InsightCategory",
    "WorkspaceSession",
    "WorkspaceInsight",
    "WorkspaceAction",
    "WorkspacePreferences",
    "WorkspaceManager",
    "get_workspace_manager",
    "reset_workspace_manager",
]
