from pydantic import BaseModel, Field


class ZhProviderConfig(BaseModel):
    api_key: str = ""
    api_key_set: bool = False
    base_url: str = ""
    model: str = ""


class ZhProvidersConfig(BaseModel):
    provider_a: ZhProviderConfig = Field(default_factory=ZhProviderConfig)
    provider_b: ZhProviderConfig = Field(default_factory=ZhProviderConfig)
    provider_c: ZhProviderConfig = Field(default_factory=ZhProviderConfig)
    provider_d: ZhProviderConfig = Field(default_factory=ZhProviderConfig)
    compatible: ZhProviderConfig = Field(default_factory=ZhProviderConfig)


class ZhSettingsPayload(BaseModel):
    provider: str = "disabled"
    timeout_seconds: float = 20.0
    enable_audit_logs: bool = False
    providers: ZhProvidersConfig = Field(default_factory=ZhProvidersConfig)
