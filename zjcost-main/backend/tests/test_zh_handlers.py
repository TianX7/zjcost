from app.assistant.agents.legacy_utils import generate_boq_items_with_agent
from app.assistant.agents.legacy_utils import normalize_query_for_router
from app.assistant.agents.legacy_utils import rerank_quota_candidates_with_agent
from app.assistant.providers.base import ZhProviderError
from app.assistant.schemas.query import ZhQueryIntentOutput
from app.assistant.schemas.quota_match import ZhQuotaRankItem, ZhQuotaRerankOutput
from app.services.boq_generate_service import generate_boq_items


class _FailingProvider:
    def is_enabled(self) -> bool:
        return True

    def is_configured(self) -> bool:
        return True

    def generate_structured(self, **kwargs):
        raise ZhProviderError("mock failure")


class _QueryIntentProvider:
    def is_enabled(self) -> bool:
        return True

    def is_configured(self) -> bool:
        return True

    def generate_structured(self, **kwargs):
        return ZhQueryIntentOutput(intent="dirty", keyword=None)


class _QuotaRerankProvider:
    def is_enabled(self) -> bool:
        return True

    def is_configured(self) -> bool:
        return True

    def generate_structured(self, **kwargs):
        return ZhQuotaRerankOutput(
            candidates=[
                ZhQuotaRankItem(
                    quota_item_id=2,
                    confidence=0.95,
                    reasons=["名称和单位更匹配"],
                )
            ]
        )


def test_boq_handler_fallback_on_provider_error(monkeypatch):
    description = "3层办公楼，含基础和主体结构"
    expected = generate_boq_items(description)

    monkeypatch.setattr(
        "app.assistant.agents.boq_handler.get_zh_provider",
        lambda: _FailingProvider(),
    )
    actual = generate_boq_items_with_agent(description)

    assert [(x.code, x.name, x.quantity) for x in actual] == [
        (x.code, x.name, x.quantity) for x in expected
    ]


def test_query_handler_fallback_on_provider_error(monkeypatch):
    monkeypatch.setattr(
        "app.assistant.agents.query_handler.get_zh_provider",
        lambda: _FailingProvider(),
    )
    assert normalize_query_for_router("查一下未绑定") == "查一下未绑定"


def test_query_handler_maps_intent_to_canonical_query(monkeypatch):
    monkeypatch.setattr(
        "app.assistant.agents.query_handler.get_zh_provider",
        lambda: _QueryIntentProvider(),
    )
    assert normalize_query_for_router("哪些要重算") == "待重算"


def test_quota_rerank_handler_reorders_candidates(monkeypatch):
    monkeypatch.setattr(
        "app.assistant.agents.quota_match_handler.get_zh_provider",
        lambda: _QuotaRerankProvider(),
    )

    candidates = [
        {
            "quota_item_id": 1,
            "quota_code": "A-01",
            "quota_name": "钢筋制作",
            "unit": "t",
            "confidence": 0.66,
            "reasons": ["原始排序第一"],
        },
        {
            "quota_item_id": 2,
            "quota_code": "A-02",
            "quota_name": "钢筋制作安装",
            "unit": "t",
            "confidence": 0.64,
            "reasons": ["原始排序第二"],
        },
    ]

    reranked = rerank_quota_candidates_with_agent(
        boq_code="020104",
        boq_name="主体结构钢筋",
        boq_unit="t",
        candidates=candidates,
        top_n=2,
    )

    assert reranked[0]["quota_item_id"] == 2
    assert reranked[0]["confidence"] == 0.95
    assert len(reranked) == 2
