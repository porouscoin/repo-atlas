"""Caching and rate limits.

Every map, history and AI summary is cached by commit, so a repo is only
downloaded and parsed once per commit. With Supabase settings the cache is a
single table (atlas_cache) shared by every server instance; without them
(local dev and tests) it lives in process memory. Rate limits are per
instance and in memory, which is enough to stop one visitor hammering it.
"""

import time
from collections import OrderedDict, defaultdict

import httpx

from .config import settings


class LRU:
    def __init__(self, size: int):
        self.size = size
        self.data: OrderedDict = OrderedDict()

    def get(self, key):
        if key not in self.data:
            return None
        self.data.move_to_end(key)
        return self.data[key]

    def set(self, key, value):
        self.data[key] = value
        self.data.move_to_end(key)
        while len(self.data) > self.size:
            self.data.popitem(last=False)


_mem = LRU(200)  # cache rows when there's no Supabase
_hot = LRU(30)  # recent rows, in front of Supabase
repo_texts = LRU(4)  # (slug, sha) -> {path: text}, for the AI tools on a warm instance


def supabase_enabled() -> bool:
    return bool(settings.supabase_url and settings.supabase_key)


_client: httpx.AsyncClient | None = None


async def _sb(method: str, path: str, prefer: str = "", **kwargs):
    global _client
    if _client is None:
        _client = httpx.AsyncClient(timeout=15)
    headers = {"apikey": settings.supabase_key, "Content-Type": "application/json"}
    if settings.supabase_key.startswith("eyJ"):  # a legacy JWT key also goes in Authorization
        headers["Authorization"] = f"Bearer {settings.supabase_key}"
    if prefer:
        headers["Prefer"] = prefer
    try:
        resp = await _client.request(method, f"{settings.supabase_url}/rest/v1/{path}", headers=headers, **kwargs)
    except httpx.HTTPError as e:
        print(f"supabase error on {path}: {e!r}")
        return None
    if resp.status_code >= 300:
        print(f"supabase {method} {path} -> {resp.status_code} {resp.text[:200]}")
        return None
    return resp.json() if resp.text else None


async def cache_get(key: str):
    hit = _hot.get(key)
    if hit is not None:
        return hit
    if not supabase_enabled():
        return _mem.get(key)
    rows = await _sb("GET", "atlas_cache", params={"key": f"eq.{key}", "select": "data"})
    if rows:
        _hot.set(key, rows[0]["data"])
        return rows[0]["data"]
    return None


async def cache_set(key: str, data) -> None:
    _hot.set(key, data)
    if not supabase_enabled():
        _mem.set(key, data)
        return
    await _sb("POST", "atlas_cache", prefer="resolution=merge-duplicates", json={"key": key, "data": data})


# ---------------------------------------------------------------- rate limits

_events: dict[str, list[float]] = defaultdict(list)


def allow(kind: str, who: str, per_hour: int) -> bool:
    """Records one event; False once `who` has done `kind` more than per_hour times in an hour."""
    now = time.time()
    key = f"{kind}:{who}"
    events = [t for t in _events[key] if t > now - 3600]
    if len(events) >= per_hour:
        _events[key] = events
        return False
    events.append(now)
    _events[key] = events
    return True
