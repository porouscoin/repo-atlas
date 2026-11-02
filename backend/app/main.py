"""HTTP API for Repo Atlas."""

import asyncio
import hashlib
import json
import re

from fastapi import FastAPI, HTTPException, Request
from fastapi.middleware.cors import CORSMiddleware
from fastapi.middleware.gzip import GZipMiddleware
from fastapi.responses import StreamingResponse
from pydantic import BaseModel, Field

from . import ai, store
from .analyze import build_snapshot
from .config import models_for, settings
from .imports import Resolver
from .levels import level_view
from .github import RepoError, download_tarball, parse_repo, read_tarball, repo_info
from .providers import ProviderError, RateLimited

app = FastAPI(title="Repo Atlas")
app.add_middleware(
    CORSMiddleware,
    allow_origins=[o.strip() for o in settings.frontend_origin.split(",") if o.strip()],
    allow_origin_regex=settings.frontend_origin_regex or None,
    allow_methods=["GET", "POST"],
    allow_headers=["Content-Type"],
)
app.add_middleware(GZipMiddleware, minimum_size=2000)

SHA_RE = re.compile(r"^[0-9a-f]{40}$")


def who(request: Request) -> str:
    forwarded = request.headers.get("x-forwarded-for", "")
    ip = forwarded.split(",")[0].strip() or (request.client.host if request.client else "unknown")
    return hashlib.sha256(ip.encode()).hexdigest()[:16]


def limit(request: Request, kind: str, per_hour: int) -> None:
    if not store.allow(kind, who(request), per_hour):
        raise HTTPException(429, "Slow down a little. Try again in a few minutes.")


def check(slug: str, sha: str) -> str:
    try:
        ref = parse_repo(slug)
    except RepoError as e:
        raise HTTPException(400, str(e))
    if not SHA_RE.match(sha):
        raise HTTPException(400, "Bad commit id.")
    return ref.slug


async def _build(info: dict) -> tuple[dict, dict[str, str]]:
    data = await download_tarball(info["slug"], info["sha"])
    raw = await asyncio.to_thread(read_tarball, data)
    snapshot, texts = await asyncio.to_thread(build_snapshot, info, raw)
    store.repo_texts.set((info["slug"], info["sha"]), texts)
    return snapshot, texts


async def repo_state(slug: str, sha: str) -> tuple[dict, dict[str, str]]:
    """The snapshot and file texts for a commit, from cache when possible."""
    snapshot = await store.cache_get(f"snap:{slug}:{sha}")
    texts = store.repo_texts.get((slug, sha))
    if snapshot and texts is not None:
        return snapshot, texts
    try:
        built, texts = await _build(snapshot or {"slug": slug, "sha": sha, "description": ""})
    except RepoError as e:
        raise HTTPException(400, str(e))
    return snapshot or built, texts


# ---------------------------------------------------------------------- routes


@app.get("/api/health")
async def health():
    return {
        "ok": True,
        "ai": bool(models_for("agent")),
        "database": store.supabase_enabled(),
        "github_token": bool(settings.github_token),
    }


@app.get("/api/repo")
async def get_repo(request: Request, url: str):
    """The map of a repo at its latest commit."""
    try:
        ref = parse_repo(url)
        info = await repo_info(ref)
    except RepoError as e:
        raise HTTPException(400, str(e))
    key = f"snap:{info['slug']}:{info['sha']}"
    cached = await store.cache_get(key)
    if cached:
        return {**cached, "stars": info["stars"], "cached": True}
    limit(request, "repo", settings.repos_per_hour)
    try:
        snapshot, _ = await _build(info)
    except RepoError as e:
        raise HTTPException(400, str(e))
    await store.cache_set(key, snapshot)
    return {**snapshot, "cached": False}


class SummaryIn(BaseModel):
    slug: str
    sha: str
    path: str = Field(max_length=500)


@app.post("/api/summary")
async def post_summary(request: Request, body: SummaryIn):
    slug = check(body.slug, body.sha)
    _, texts = await repo_state(slug, body.sha)
    if body.path not in texts:
        raise HTTPException(404, "No such file in this repo.")
    limit(request, "summary", settings.summaries_per_hour)
    try:
        return {"path": body.path, "summary": await ai.summarize(slug, body.path, texts[body.path])}
    except RateLimited as e:
        raise HTTPException(429, str(e))
    except ProviderError as e:
        print(f"summary failed: {e}")
        raise HTTPException(502, "The AI couldn't summarize this file right now.")


class EvidenceIn(BaseModel):
    slug: str
    sha: str
    pairs: list[tuple[str, str]] = Field(max_length=40)


_resolvers: dict[tuple[str, str], Resolver] = {}


@app.post("/api/evidence")
async def post_evidence(body: EvidenceIn):
    """The exact source line behind each import arrow, so nothing in the diagram is taken on trust."""
    slug = check(body.slug, body.sha)
    _, texts = await repo_state(slug, body.sha)
    key = (slug, body.sha)
    resolver = _resolvers.get(key)
    if resolver is None:
        if len(_resolvers) > 8:
            _resolvers.pop(next(iter(_resolvers)))
        resolver = _resolvers[key] = Resolver(texts)
    out = []
    for src, dst in body.pairs:
        if src not in texts or dst not in texts:
            continue
        hit = resolver.evidence(src, dst)
        out.append({"from": src, "to": dst, "line": hit[0] if hit else None, "text": hit[1][:200] if hit else ""})
    return {"evidence": out}


class Turn(BaseModel):
    role: str
    content: str = Field(max_length=4000)


class AskIn(BaseModel):
    slug: str
    sha: str
    question: str = Field(min_length=2, max_length=1000)
    history: list[Turn] = Field(default_factory=list, max_length=12)


@app.post("/api/ask")
async def post_ask(request: Request, body: AskIn):
    """Streams the agent's steps as server-sent events, so the map can light up files as it reads them."""
    slug = check(body.slug, body.sha)
    limit(request, "ask", settings.asks_per_hour)
    snapshot, texts = await repo_state(slug, body.sha)

    async def events():
        async for event in ai.ask(snapshot, texts, body.question, [t.model_dump() for t in body.history]):
            yield f"data: {json.dumps(event)}\n\n"

    return StreamingResponse(events(), media_type="text/event-stream", headers={"Cache-Control": "no-cache"})


@app.get("/api/level")
async def get_level(slug: str, sha: str, path: str = ""):
    """The boxes and arrows for one folder of the diagram, plus its explanation when it's cached."""
    slug = check(slug, sha)
    snapshot, _ = await repo_state(slug, sha)
    try:
        view = level_view(snapshot, path)
    except KeyError:
        raise HTTPException(404, "No such folder in this repo.")
    view["explain"] = await store.cache_get(f"explain:{slug}:{sha}:{view['path']}")
    return view


class ExplainIn(BaseModel):
    slug: str
    sha: str
    path: str = Field(default="", max_length=500)


@app.post("/api/explain")
async def post_explain(request: Request, body: ExplainIn):
    slug = check(body.slug, body.sha)
    snapshot, texts = await repo_state(slug, body.sha)
    try:
        view = level_view(snapshot, body.path)
    except KeyError:
        raise HTTPException(404, "No such folder in this repo.")
    cached = await store.cache_get(f"explain:{slug}:{body.sha}:{view['path']}")
    if cached:
        return cached
    limit(request, "explain", settings.summaries_per_hour)
    try:
        return await ai.explain_level(snapshot, texts, view)
    except RateLimited as e:
        raise HTTPException(429, str(e))
    except ProviderError as e:
        print(f"explain failed: {e}")
        raise HTTPException(502, "The AI couldn't explain this part right now.")
