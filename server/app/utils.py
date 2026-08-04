from __future__ import annotations

import json
import re
from datetime import UTC, datetime
from typing import Any


def now_iso() -> str:
    return datetime.now(UTC).isoformat(timespec="milliseconds").replace("+00:00", "Z")


def parse_json(value: Any, fallback: Any) -> Any:
    if not isinstance(value, str):
        return fallback
    try:
        return json.loads(value)
    except (TypeError, ValueError):
        return fallback


def compact_json(value: Any) -> str:
    return json.dumps(value, ensure_ascii=False, separators=(",", ":"))


def remove_turn_number_references(value: Any) -> Any:
    if isinstance(value, str):
        text = re.sub(r"\s*\((?:student\s+)?turns?\s+\d+(?:\s*(?:,|and)\s*\d+)*\)", "", value, flags=re.I)
        text = re.sub(r"\b(?:student\s+)?turns?\s+\d+(?:\s*(?:,|and)\s*\d+)*", "the cited question", text, flags=re.I)
        return re.sub(r"\s+([,.;:!?])", r"\1", text)
    if isinstance(value, list):
        return [remove_turn_number_references(item) for item in value]
    if isinstance(value, dict):
        return {key: remove_turn_number_references(item) for key, item in value.items()}
    return value
