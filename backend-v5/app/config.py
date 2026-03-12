"""Application configuration using Pydantic settings."""
from functools import lru_cache
from typing import Optional, Literal

from pydantic import field_validator, model_validator
from pydantic_settings import BaseSettings, SettingsConfigDict

EmbeddingModelKey = Literal["e5-large", "e5-base", "minilm", "openai-3-large"]
UnifiedCandidateReadMode = Literal["db_primary_json_fallback", "db_only", "json_only"]
InvestigationGraphMode = Literal["legacy", "hybrid", "v2"]


class Settings(BaseSettings):
    """Application settings loaded from environment variables."""

    model_config = SettingsConfigDict(
        env_file=".env",
        env_file_encoding="utf-8",
        case_sensitive=False,
    )

    # Application
    app_name: str = "Nepal OSINT v5"
    app_env: Literal["development", "production"] = "development"
    debug: bool = False
    api_v1_prefix: str = "/api/v1"

    # Database
    database_url: str = "postgresql+asyncpg://nepal_osint:nepal_osint_dev@localhost:5433/nepal_osint_v5"

    # Redis
    redis_url: str = "redis://localhost:6380/0"

    # CORS (supports comma-separated env: CORS_ORIGINS or ALLOWED_ORIGINS)
    allowed_origins: Optional[str] = None
    cors_origins: list[str] = [
        "http://localhost:5173",
        "http://localhost:5174",
        "http://localhost:5175",
        "http://localhost:5176",
        "http://127.0.0.1:5173",
        "http://127.0.0.1:5174",
        "http://127.0.0.1:5175",
        "http://127.0.0.1:5176",
    ]

    @field_validator("cors_origins", mode="before")
    @classmethod
    def _parse_cors_origins(cls, v):
        if v is None:
            return v
        if isinstance(v, str):
            return [s.strip() for s in v.split(",") if s.strip()]
        return v

    @model_validator(mode="after")
    def _validate_settings(self):
        # Back-compat: ALLOWED_ORIGINS overrides cors_origins when provided.
        if self.allowed_origins:
            self.cors_origins = [s.strip() for s in self.allowed_origins.split(",") if s.strip()]

        if self.app_env == "production":
            if not self.jwt_secret_key:
                raise ValueError("JWT_SECRET_KEY must be set in production")
            if self.jwt_secret_key.startswith("CHANGE_ME"):
                raise ValueError("JWT_SECRET_KEY must be changed in production")
            if len(self.jwt_secret_key) < 32:
                raise ValueError("JWT_SECRET_KEY must be at least 32 characters in production")

            # Force safe defaults
            self.debug = False

        return self

    # RSS Ingestion
    rss_poll_interval_priority: int = 300  # 5 minutes
    rss_poll_interval_all: int = 900  # 15 minutes
    rss_max_concurrent: int = 10
    rss_timeout: int = 30

    # BIPAD Portal Settings
    bipad_base_url: str = "https://bipadportal.gov.np/api/v1"
    bipad_poll_interval: int = 300  # 5 minutes
    bipad_max_concurrent: int = 5
    bipad_timeout: int = 30
    bipad_incident_days_back: int = 30  # Initial fetch window
    bipad_earthquake_days_back: int = 7
    bipad_min_earthquake_magnitude: float = 4.0
    bipad_significance_death_threshold: int = 0  # Store if deaths > 0
    bipad_significance_loss_threshold: float = 2_500_000  # Store if loss > 25 lakhs NPR

    # Paths
    sources_config_path: str = "config/sources.yaml"
    relevance_rules_path: str = "config/relevance_rules.yaml"

    # Anthropic API for LLM cluster validation
    anthropic_api_key: Optional[str] = None
    local_llm_fallback_enabled: bool = False
    local_llm_prefer_local: bool = False
    local_llm_base_url: str = "http://127.0.0.1:8010/v1"
    local_llm_api_key: str = "local"
    local_llm_model: str = "Qwen/Qwen3.5-9B"
    local_llm_max_tokens: int = 4096
    local_llm_temperature: float = 0.1

    # OpenAI API (embeddings + cheap structured judgments)
    openai_api_key: Optional[str] = None
    openai_base_url: str = "https://api.openai.com/v1"
    openai_embedding_model: str = "text-embedding-3-small"
    openai_embedding_dimensions: int = 1024
    openai_clustering_model: str = "gpt-5-mini"
    openai_embedding_enabled: bool = False
    openai_clustering_enabled: bool = False
    openai_agent_enabled: bool = False
    openai_agent_fast_model: str = "gpt-4.1-mini"
    openai_agent_deep_model: str = "gpt-4.1"
    openai_developing_stories_enabled: bool = False
    openai_story_tracker_enabled: bool = False
    openai_cache_ttl_seconds: int = 2592000  # 30 days
    openai_cluster_gray_zone_low: float = 0.68
    openai_cluster_gray_zone_high: float = 0.82
    openai_story_tracker_similarity_threshold: float = 0.78
    openai_usage_limit_enabled: bool = True
    openai_max_requests_per_hour: int = 20
    openai_max_requests_per_day: int = 120
    openai_max_embedding_texts_per_hour: int = 120
    openai_max_embedding_texts_per_day: int = 600
    openai_max_structured_calls_per_hour: int = 8
    openai_max_structured_calls_per_day: int = 36
    openai_max_agent_calls_per_hour: int = 1
    openai_max_agent_calls_per_day: int = 4
    openai_max_embedding_chars_per_text: int = 1400
    openai_max_structured_prompt_chars: int = 5000
    openai_max_agent_prompt_chars: int = 12000
    openai_max_structured_completion_tokens: int = 220
    openai_max_agent_completion_tokens: int = 700

    # ML runtime toggles (enabled for human-in-loop workflow)
    # Note: these are read from env/.env; changing them requires a process restart.
    ml_enable_priority_bandit: bool = False
    ml_enable_embedding_classifier: bool = False

    # Embeddings
    embedding_model_key: EmbeddingModelKey = "e5-large"

    # Clustering settings
    use_llm_validation: bool = False  # Enable LLM cluster validation (Claude or local fallback)
    llm_validation_threshold: int = 5  # Validate clusters larger than this size
    clustering_smart_threshold: float = 0.70  # lower = more merges (recall), higher = fewer merges (precision)

    # Twitter/X API Settings - FREE TIER OPTIMIZED
    # Budget: 100 tweets/month = ~3 tweets/day
    twitter_bearer_token: Optional[str] = None  # X API Bearer Token
    twitter_api_tier: str = "free"  # free (100/mo), basic (10k/mo), pro (1M/mo)
    twitter_poll_interval: int = 43200  # 12 hours for free tier (not hourly!)
    twitter_max_per_query: int = 10  # Max tweets per query (keep low for free tier)
    twitter_cache_ttl_hours: int = 6  # Cache query results for 6 hours (free tier)

    # Google Earth Engine Settings
    gee_service_account_json: Optional[str] = None  # Path to service account JSON or base64
    gee_project_id: Optional[str] = None  # GEE cloud project ID
    gee_tile_cache_ttl: int = 3600  # 1 hour (GEE URLs expire after ~2 hours)
    gee_analysis_cache_ttl: int = 86400  # 24 hours for analysis results
    gee_change_detection_enabled: bool = True
    gee_change_detection_interval: int = 21600  # 6 hours

    # CAMIS (Company Administration & Management Information System) API
    camis_username: Optional[str] = None
    camis_password: Optional[str] = None

    # IRD enrichment privacy salt (HMAC key for hashing phone numbers)
    ird_hash_salt: Optional[str] = None

    # Authentication / JWT Settings
    jwt_secret_key: str = "CHANGE_ME_IN_PRODUCTION_USE_STRONG_SECRET_KEY"
    jwt_algorithm: str = "HS256"
    jwt_access_token_expire_minutes: int = 30
    jwt_refresh_token_expire_days: int = 7

    # Google OAuth
    google_client_id: Optional[str] = None

    # Guest login
    guest_token_expire_hours: int = 24

    # Resend (email OTP verification)
    resend_api_key: Optional[str] = None
    resend_from_email: str = "NepalOSINT <noreply@narada.dev>"

    # Haiku relevance filter — AI verification for borderline Nepal stories
    haiku_relevance_filter_enabled: bool = True
    haiku_relevance_model: str = "claude-3-haiku-20240307"
    haiku_relevance_timeout: int = 10  # seconds

    # Scheduler — automatically starts background jobs (RSS, scraping, clustering, etc.)
    run_scheduler: bool = True

    # Consumer mode — when true, analyst API routes are not loaded (lightweight deployment)
    consumer_mode: bool = False

    # Candidate unified read controls
    unified_candidate_read_mode: UnifiedCandidateReadMode = "db_primary_json_fallback"

    # Investigation graph rollout controls
    investigation_graph_v2_mode: InvestigationGraphMode = "hybrid"
    graph_corrections_enabled: bool = True
    unified_timeline_enabled: bool = True


@lru_cache
def get_settings() -> Settings:
    """Get cached settings instance."""
    return Settings()
