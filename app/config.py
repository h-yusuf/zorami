from pydantic_settings import BaseSettings, SettingsConfigDict


class Settings(BaseSettings):
    model_config = SettingsConfigDict(env_file=".env", env_prefix="ZORA_")

    database_url: str = "postgresql+asyncpg://zora:zora_dev_only@localhost:5432/zora_bridge"
    secret_key: str = "dev-only-change-me-32-bytes-min!!"
    jwt_secret: str = "dev-only-jwt-secret-change-me-32b!!"

    omnirouter_base_url: str = "http://localhost:20128/v1"
    omnirouter_api_key: str = ""
    omnirouter_model: str = "claude-sonnet-5"
    groq_api_key: str = ""
    piper_binary_path: str = "/usr/local/bin/piper"
    piper_model_path: str = "/models/id_ID-news-medium.onnx"
    langsearch_api_key: str = ""


settings = Settings()
