from __future__ import annotations

import math
import threading
import time
from collections import deque
from collections.abc import Iterable


class SlidingWindowRateLimiter:
    """Small single-process limiter for the supported one-worker deployment."""

    def __init__(self, window_seconds: int = 60 * 60) -> None:
        self.window_seconds = window_seconds
        self._events: dict[str, deque[float]] = {}
        self._lock = threading.Lock()

    def consume(self, key: str, limit: int) -> int:
        """Return zero when accepted, otherwise seconds until the next slot."""

        return self.consume_many(((key, limit),))

    def consume_many(self, limits: Iterable[tuple[str, int]]) -> int:
        """Atomically apply several budgets to one logical request."""

        now = time.monotonic()
        cutoff = now - self.window_seconds
        requested = list(limits)
        with self._lock:
            # Remove dormant keys as their final event leaves the window. This
            # keeps long-running single-worker deployments bounded even when
            # callers naturally rotate through many user or IP identities.
            for key, events in list(self._events.items()):
                while events and events[0] <= cutoff:
                    events.popleft()
                if not events:
                    del self._events[key]

            retry_after = 0
            for key, limit in requested:
                events = self._events.get(key)
                if events is not None and len(events) >= limit:
                    retry_after = max(retry_after, max(1, math.ceil(events[0] + self.window_seconds - now)))
            if retry_after:
                return retry_after
            for key, _limit in requested:
                self._events.setdefault(key, deque()).append(now)
            return 0
