"""Pytest configuration and fixtures."""

import pytest
import sys
from pathlib import Path

# Add the src directory to the path
sys.path.insert(0, str(Path(__file__).parent.parent))


@pytest.fixture(autouse=True)
def reset_global_state():
    """Reset global state before each test."""
    # Reset memory store
    from src.memory import reset_memory_store
    reset_memory_store()
    
    yield
    
    # Cleanup after test
    reset_memory_store()


@pytest.fixture
def mock_settings():
    """Create mock settings for testing."""
    from unittest.mock import patch, MagicMock
    
    mock_config = MagicMock()
    mock_config.llm_provider = "openai"
    mock_config.openai_api_key = None  # No API key for tests
    mock_config.anthropic_api_key = None
    mock_config.openai_model = "gpt-4o-mini"
    mock_config.anthropic_model = "claude-sonnet-4-20250514"
    mock_config.enable_rag = True
    mock_config.enable_user_context = False
    mock_config.enable_streaming = True
    mock_config.max_message_length = 4000
    mock_config.conversation_max_age_seconds = 3600
    mock_config.conversation_max_history = 20
    mock_config.default_agent = "support"
    mock_config.retrieval_top_k = 5
    mock_config.retrieval_score_threshold = 0.5
    mock_config.use_chroma_vectorstore = False
    mock_config.knowledge_base_path = Path(__file__).parent.parent / "knowledge"
    mock_config.backend_api_base_url = "http://localhost:3001"
    
    with patch("src.config.get_settings", return_value=mock_config):
        yield mock_config


@pytest.fixture
def mock_user_context():
    """Create a mock user context."""
    from src.auth import UserContext, AuthStatus
    
    return UserContext(
        user_id="test_user_123",
        wallet_address="addr_test123",
        auth_status=AuthStatus.AUTHENTICATED,
        permissions=["read_public_info", "read_own_deals"],
    )


@pytest.fixture
def mock_anonymous_user():
    """Create a mock anonymous user context."""
    from src.auth import UserContext, AuthStatus
    
    return UserContext(
        user_id="anon_session_456",
        wallet_address=None,
        auth_status=AuthStatus.ANONYMOUS,
        permissions=["read_public_info"],
    )
