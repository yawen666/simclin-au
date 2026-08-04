from __future__ import annotations

SYNTHETIC_STUDENT_NAMES = (
    "Alex Morgan",
    "Maya Chen",
    "Liam Nguyen",
    "Sophie Williams",
    "Noah Patel",
    "Zoe Taylor",
    "Ethan Kim",
    "Ava Singh",
    "Lucas Brown",
    "Emily Wong",
    "Jack Wilson",
    "Amelia Davis",
    "Oliver Jones",
    "Grace Li",
    "Thomas Martin",
    "Chloe Anderson",
)


def synthetic_student_name(visitor_digest: str) -> str:
    """Return a stable, non-identifying demo name for one browser visitor."""

    return SYNTHETIC_STUDENT_NAMES[int(visitor_digest[:8], 16) % len(SYNTHETIC_STUDENT_NAMES)]
