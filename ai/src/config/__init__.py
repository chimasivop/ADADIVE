"""Configuration module for ADADIVE AI service."""

from pydantic_settings import BaseSettings, SettingsConfigDict
from functools import lru_cache
from pathlib import Path


class Settings(BaseSettings):
    """Application settings loaded from environment variables."""

    model_config = SettingsConfigDict(
        env_file=".env",
        env_file_encoding="utf-8",
        env_prefix="AI_",
        case_sensitive=False,
    )

    # API Configuration
    api_host: str = "0.0.0.0"
    api_port: int = 8000
    api_debug: bool = False

    # CORS Configuration
    allowed_origins: list[str] = ["https://adadive.xyz", "http://localhost:3000"]

    # AI/LLM Configuration
    llm_provider: str = "openai"  # openai, anthropic, ollama
    openai_api_key: str | None = None
    openai_model: str = "gpt-4o-mini"
    anthropic_api_key: str | None = None
    anthropic_model: str = "claude-3-haiku-20240307"

    # Ollama Configuration (for local models)
    ollama_base_url: str = "http://localhost:11434"
    ollama_model: str = "llama3.2"

    # Retrieval Configuration
    knowledge_base_path: Path = Path(__file__).parent.parent / "knowledge"
    embedding_model: str = "sentence-transformers/all-MiniLM-L6-v2"
    embedding_dimension: int = 384
    retrieval_top_k: int = 5
    retrieval_score_threshold: float = 0.5

    # Backend API Configuration (for accessing live platform data)
    backend_api_base_url: str = "http://localhost:3001"
    backend_api_timeout: int = 30

    # Authentication (for future user-specific queries)
    auth_enabled: bool = False
    jwt_secret: str | None = None
    jwt_algorithm: str = "HS256"
    jwt_expiration_minutes: int = 60

    # Security
    max_message_length: int = 4000
    rate_limit_requests: int = 30
    rate_limit_window_seconds: int = 60

    # Feature Flags
    enable_rag: bool = True
    enable_user_context: bool = False  # Enable querying user-specific deal data

    class Config:
        env_file = ".env"


@lru_cache
def get_settings() -> Settings:
    """Get cached settings instance."""
    return Settings()
