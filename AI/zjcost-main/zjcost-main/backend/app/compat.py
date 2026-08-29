from __future__ import annotations

from typing import Any


def model_to_dict(model: Any, **kwargs: Any) -> dict[str, Any]:
    """Return a Pydantic model as a dict on both v1 and v2."""
    if hasattr(model, "model_dump"):
        return model.model_dump(**kwargs)
    if hasattr(model, "dict"):
        return model.dict(**kwargs)
    return dict(model)
