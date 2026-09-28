from __future__ import annotations

from datetime import datetime, timezone
from typing import Any


def parse_datetime(value: Any) -> datetime | None:
    """Parse datetime values that may already be datetime objects."""
    if isinstance(value, datetime):
        parsed = value
    elif isinstance(value, str) and value:
        try:
            parsed = datetime.fromisoformat(value.replace("Z", "+00:00"))
        except ValueError:
            return None
    else:
        return None

    if parsed.tzinfo is None:
        return parsed.replace(tzinfo=timezone.utc)
    return parsed
