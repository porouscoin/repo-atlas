"""Settings and the models, all read from environment variables."""

import os
from dataclasses import dataclass


def env(name: str, default: str = "") -> str:
    return os.environ.get(name, default).strip()


@dataclass(frozen=True)
class ModelSpec:
    id: str
    label: str
    provider: str  # "groq" | "gemini" | "mock"
    model: str  # the provider's model name
    base_url: str
    api_key: str
    supports_tools: bool = True


GROQ_URL = "https://api.groq.com/openai/v1"
GEMINI_URL = "https://generativelanguage.googleapis.com/v1beta/openai"


def _spec(id: str, provider: str, model: str) -> ModelSpec:
    if provider == "mock":
        return ModelSpec(id, "Mock", "mock", "mock", "", "mock")
    url, key = (GROQ_URL, env("GROQ_API_KEY")) if provider == "groq" else (GEMINI_URL, env("GEMINI_API_KEY"))
    return ModelSpec(id, model, provider, model, url, key)


def models_for(task: str) -> list[ModelSpec]:
    """The models to try for a task, best first. A busy or failing model hands
    over to the next one, so a free-tier rate limit rarely reaches the visitor.

    task: "agent" (ask and tour, needs good tool use) or "summary" (short and fast).
    """
    if env("ENABLE_MOCK_MODEL") == "1":
        return [_spec("mock", "mock", "mock")]
    if task == "agent":
        chain = [
            ("groq", env("AGENT_MODEL", "openai/gpt-oss-120b")),
            ("gemini", env("GEMINI_MODEL", "gemini-3.5-flash-lite")),
            ("groq", "qwen/qwen3.8-27b"),
        ]
    else:
        chain = [
            ("groq", env("SUMMARY_MODEL", "openai/gpt-oss-20b")),
            ("gemini", env("GEMINI_MODEL", "gemini-3.5-flash-lite")),
            ("groq", "qwen/qwen3.8-27b"),
        ]
    specs = [_spec(f"{p}:{m}", p, m) for p, m in chain]
    return [s for s in specs if s.api_key]


@dataclass(frozen=True)
class Settings:
    github_token: str = env("GITHUB_TOKEN")
    supabase_url: str = env("SUPABASE_URL")
    supabase_key: str = env("SUPABASE_SERVICE_ROLE_KEY")
    frontend_origin: str = env("FRONTEND_ORIGIN", "http://localhost:3000")
    frontend_origin_regex: str = env("FRONTEND_ORIGIN_REGEX", r"https://repo-atlas[a-z0-9-]*\.vercel\.app")
    max_files: int = int(env("MAX_FILES", "4000"))  # files drawn in the galaxy
    max_tarball_mb: int = int(env("MAX_TARBALL_MB", "60"))
    max_commits: int = int(env("MAX_COMMITS", "200"))  # commits replayed in the time-lapse
    max_steps: int = int(env("MAX_AGENT_STEPS", "6"))
    asks_per_hour: int = int(env("ASKS_PER_HOUR", "20"))
    repos_per_hour: int = int(env("REPOS_PER_HOUR", "12"))
    summaries_per_hour: int = int(env("SUMMARIES_PER_HOUR", "120"))


settings = Settings()
