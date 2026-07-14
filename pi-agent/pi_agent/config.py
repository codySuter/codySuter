"""Environment-driven configuration."""

import os
from dataclasses import dataclass, field

from dotenv import load_dotenv


@dataclass
class Settings:
    telegram_token: str
    allowed_user_ids: set = field(default_factory=set)
    ollama_host: str = "http://127.0.0.1:11434"
    model: str = "qwen3:4b"
    max_tool_rounds: int = 6
    search_max_results: int = 5
    page_char_limit: int = 6000
    history_turns: int = 6


def load_settings() -> Settings:
    load_dotenv()

    token = os.environ.get("TELEGRAM_BOT_TOKEN", "").strip()
    if not token:
        raise SystemExit(
            "TELEGRAM_BOT_TOKEN is not set. Copy .env.example to .env and "
            "fill in the token you got from @BotFather."
        )

    raw_ids = os.environ.get("ALLOWED_USER_IDS", "")
    allowed = {int(part) for part in raw_ids.replace(";", ",").split(",") if part.strip()}

    return Settings(
        telegram_token=token,
        allowed_user_ids=allowed,
        ollama_host=os.environ.get("OLLAMA_HOST", Settings.ollama_host),
        model=os.environ.get("OLLAMA_MODEL", Settings.model),
        max_tool_rounds=int(os.environ.get("MAX_TOOL_ROUNDS", Settings.max_tool_rounds)),
        search_max_results=int(os.environ.get("SEARCH_MAX_RESULTS", Settings.search_max_results)),
        page_char_limit=int(os.environ.get("PAGE_CHAR_LIMIT", Settings.page_char_limit)),
        history_turns=int(os.environ.get("HISTORY_TURNS", Settings.history_turns)),
    )
