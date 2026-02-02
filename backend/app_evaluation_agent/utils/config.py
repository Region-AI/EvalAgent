import logging
from functools import lru_cache

import toml
from pydantic_settings import BaseSettings

logger = logging.getLogger(__name__)


class LLMSettings(BaseSettings):
    api_key: str
    base_url: str
    model_name: str


class DBSettings(BaseSettings):
    url: str


class RedisSettings(BaseSettings):
    host: str
    port: int


class Settings(BaseSettings):
    database: DBSettings
    redis: RedisSettings
    llm: LLMSettings
    vllm: LLMSettings


@lru_cache()
def get_settings() -> Settings:
    """Loads settings from the config file."""
    with open("config/settings.toml", "r") as f:
        data = toml.load(f)
    logger.debug(
        "Loaded settings from config/settings.toml with sections=%s", list(data.keys())
    )
    return Settings(**data)


settings = get_settings()
