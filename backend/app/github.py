"""Everything that talks to GitHub: repo info and the code as a tarball.
Public repos only."""

import io
import re
import tarfile
from dataclasses import dataclass

import httpx

from .config import settings

API = "https://api.github.com"


class RepoError(Exception):
    """A problem worth showing the visitor as is."""


@dataclass
class RepoRef:
    owner: str
    name: str

    @property
    def slug(self) -> str:
        return f"{self.owner}/{self.name}"


_SLUG = re.compile(r"^[A-Za-z0-9-]{1,39}/[A-Za-z0-9._-]{1,100}$")


def parse_repo(text: str) -> RepoRef:
    """Accepts owner/name or any github.com URL that points into a repo."""
    t = text.strip()
    t = re.sub(r"^(https?://)?(www\.)?github\.com/", "", t)
    t = t.split("?")[0].split("#")[0].strip("/")
    parts = t.split("/")
    if len(parts) < 2:
        raise RepoError("Paste a GitHub repo, like vercel/next.js or its github.com link.")
    slug = f"{parts[0]}/{parts[1].removesuffix('.git')}"
    if not _SLUG.match(slug):
        raise RepoError("That doesn't look like a GitHub repo name.")
    owner, name = slug.split("/")
    return RepoRef(owner, name)


_client: httpx.AsyncClient | None = None


def _http() -> httpx.AsyncClient:
    global _client
    if _client is None:
        headers = {"Accept": "application/vnd.github+json", "User-Agent": "repo-atlas"}
        if settings.github_token:
            headers["Authorization"] = f"Bearer {settings.github_token}"
        _client = httpx.AsyncClient(timeout=httpx.Timeout(30.0, connect=10.0), headers=headers, follow_redirects=True)
    return _client


async def _get_json(url: str, params: dict | None = None):
    resp = await _http().get(url, params=params)
    if resp.status_code == 404:
        raise RepoError("Repo not found. It has to be public.")
    if resp.status_code in (403, 429) and resp.headers.get("x-ratelimit-remaining") == "0":
        raise RepoError("GitHub's rate limit is used up for now. Try again in a little while.")
    if resp.status_code >= 400:
        raise RepoError(f"GitHub answered {resp.status_code}.")
    return resp.json()


async def repo_info(ref: RepoRef) -> dict:
    """Canonical name, default branch, head commit, stars and description."""
    meta = await _get_json(f"{API}/repos/{ref.slug}")
    if meta.get("private"):
        raise RepoError("That repo is private.")
    branch = meta["default_branch"]
    head = await _get_json(f"{API}/repos/{ref.slug}/commits/{branch}")
    return {
        "slug": meta["full_name"],
        "branch": branch,
        "sha": head["sha"],
        "description": meta.get("description") or "",
        "stars": meta.get("stargazers_count", 0),
        "language": meta.get("language") or "",
        "size_kb": meta.get("size", 0),
    }


async def download_tarball(slug: str, sha: str) -> bytes:
    limit = settings.max_tarball_mb * 1024 * 1024
    chunks, total = [], 0
    async with _http().stream("GET", f"https://codeload.github.com/{slug}/tar.gz/{sha}") as resp:
        if resp.status_code != 200:
            raise RepoError(f"Couldn't download the code (GitHub answered {resp.status_code}).")
        async for chunk in resp.aiter_bytes():
            total += len(chunk)
            if total > limit:
                raise RepoError(f"This repo is too big to map (over {settings.max_tarball_mb} MB compressed).")
            chunks.append(chunk)
    return b"".join(chunks)


def read_tarball(data: bytes) -> dict[str, bytes]:
    """path -> file bytes, with GitHub's top folder (owner-repo-sha/) stripped."""
    files: dict[str, bytes] = {}
    with tarfile.open(fileobj=io.BytesIO(data), mode="r:gz") as tar:
        for member in tar:
            if not member.isfile():
                continue
            path = member.name.split("/", 1)[1] if "/" in member.name else member.name
            if not path or member.size > 2_000_000:
                files[path] = b""  # keep the path, skip the content
                continue
            f = tar.extractfile(member)
            files[path] = f.read() if f else b""
    return files




async def commit_count(slug: str, sha: str) -> int:
    """How many commits lead up to `sha`, read from the last page link of a one-per-page listing."""
    resp = await _http().get(f"{API}/repos/{slug}/commits", params={"sha": sha, "per_page": 1})
    if resp.status_code >= 400:
        raise RepoError(f"Couldn't read the history (GitHub answered {resp.status_code}).")
    m = re.search(r'[?&]page=(\d+)>; rel="last"', resp.headers.get("link", ""))
    return int(m.group(1)) if m else len(resp.json())


async def commit_at(slug: str, sha: str, n: int) -> dict:
    """The n-th newest commit leading up to `sha` (1 is `sha` itself)."""
    batch = await _get_json(f"{API}/repos/{slug}/commits", {"sha": sha, "per_page": 1, "page": n})
    if not batch:
        raise RepoError("Couldn't read the history.")
    c = batch[0]
    return {
        "sha": c["sha"],
        "tree": c["commit"]["tree"]["sha"],
        "date": c["commit"]["author"]["date"],
        "message": c["commit"]["message"].split("\n")[0][:140],
        "author": (c.get("author") or {}).get("login") or c["commit"]["author"]["name"],
    }


async def tree_sizes(slug: str, tree: str) -> dict[str, int]:
    """path -> size in bytes for every file in a commit, without downloading the code."""
    data = await _get_json(f"{API}/repos/{slug}/git/trees/{tree}", {"recursive": 1})
    return {e["path"]: e.get("size", 0) for e in data.get("tree", []) if e.get("type") == "blob"}
