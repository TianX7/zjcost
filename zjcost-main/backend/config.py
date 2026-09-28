"""
配置文件
管理广联达API配置和环境变量
"""
import os
from dataclasses import dataclass, field
from typing import Optional

from dotenv import load_dotenv

load_dotenv()


def _env(key: str, default: str = "") -> str:
    return os.getenv(key, default).strip()


def _env_int(key: str, default: int) -> int:
    try:
        return int(os.getenv(key, str(default)))
    except (ValueError, TypeError):
        return default


def _env_bool(key: str, default: bool = False) -> bool:
    val = os.getenv(key, str(default)).strip().lower()
    return val in {"1", "true", "yes", "on"}


def _env_set(key: str, default: set) -> set:
    val = os.getenv(key, "")
    if not val.strip():
        return default
    return {v.strip() for v in val.split(",") if v.strip()}


@dataclass
class Settings:
    """应用配置类"""

    # 广联达API配置
    gladon_appkey: str = field(default_factory=lambda: _env("GLADON_APPKEY"))
    gladon_appsecret: str = field(default_factory=lambda: _env("GLADON_APPSECRET"))
    gladon_api_timeout: int = field(default_factory=lambda: _env_int("GLADON_API_TIMEOUT", 300))

    # 服务配置
    host: str = field(default_factory=lambda: _env("HOST", "0.0.0.0"))
    port: int = field(default_factory=lambda: _env_int("PORT", 8000))
    debug: bool = field(default_factory=lambda: _env_bool("DEBUG", False))

    # 文件上传配置
    max_upload_size: int = field(default_factory=lambda: _env_int("MAX_UPLOAD_SIZE", 100 * 1024 * 1024))
    allowed_extensions: set = field(default_factory=lambda: _env_set("ALLOWED_EXTENSIONS", {"dwg"}))
    upload_dir: str = field(default_factory=lambda: _env("UPLOAD_DIR", "./uploads"))

    # 异步任务配置
    task_poll_interval: int = field(default_factory=lambda: _env_int("TASK_POLL_INTERVAL", 3))
    task_max_wait: int = field(default_factory=lambda: _env_int("TASK_MAX_WAIT", 1800))


# 全局配置实例
_settings: Optional[Settings] = None


def get_settings() -> Settings:
    """获取全局配置实例"""
    global _settings

    if _settings is None:
        _settings = Settings()
        # 确保上传目录存在
        os.makedirs(_settings.upload_dir, exist_ok=True)

    return _settings


def reload_settings() -> Settings:
    """重新加载配置"""
    global _settings
    _settings = Settings()
    return _settings