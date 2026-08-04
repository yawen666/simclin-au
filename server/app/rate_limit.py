from __future__ import annotations

import math
import threading
import time
from collections import defaultdict, deque


class SlidingWindowRateLimiter:
    """Small single-process limiter for the supported one-worker deployment."""

    def __init__(self, window_seconds: int = 60 * 60) -> None:
        self.window_seconds = window_seconds
        self._events: defaultdict[str, deque[float]] = defaultdict(deque)
        self._lock = threading.Lock()

    def consume(self, key: str, limit: int) -> int:
        """Return zero when accepted, otherwise seconds until the next slot."""

        now = time.monotonic()
        cutoff = now - self.window_seconds
        with self._lock:
            events = self._events[key]
            while events and events[0] <= cutoff:
                events.popleft()
            if len(events) >= limit:
                return max(1, math.ceil(events[0] + self.window_seconds - now))
            events.append(now)
            return 0
