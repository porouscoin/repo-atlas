"""How a repo grew: the diagram's boxes measured at evenly spaced points in
its history.

Only file sizes are needed, so each point costs two small GitHub calls (the
commit, and its file tree) instead of a download. Sizes become line counts
with each box's own bytes-per-line from today's code, so the last frame
matches the diagram exactly.
"""

import asyncio

from . import github
from .analyze import keep
from .store import LRU

_frames = LRU(6)  # (slug, sha) -> frames, oldest first


def frame_count(files: int) -> int:
    return 32 if files <= 1500 else 20 if files <= 5000 else 12


def pick(total: int, k: int) -> list[int]:
    """Evenly spaced positions in the history, oldest first, counted back from the newest (1)."""
    if total <= k:
        return list(range(total, 0, -1))
    return sorted({round(total - j * (total - 1) / (k - 1)) for j in range(k)}, reverse=True)


async def fetch_frames(slug: str, sha: str, k: int) -> tuple[list[dict], int]:
    cached = _frames.get((slug, sha))
    if cached:
        return cached
    total = await github.commit_count(slug, sha)
    sem = asyncio.Semaphore(8)

    async def one(n: int) -> dict:
        async with sem:
            c = await github.commit_at(slug, sha, n)
            sizes = await github.tree_sizes(slug, c["tree"])
        c.pop("tree")
        c["n"] = total - n + 1  # 1 = first commit
        c["sizes"] = {p: s for p, s in sizes.items() if keep(p, b"")}
        return c

    frames = await asyncio.gather(*(one(n) for n in pick(total, k)))
    _frames.set((slug, sha), (frames, total))
    return frames, total


def series(frames: list[dict], snapshot: dict, view: dict) -> dict:
    """Per frame totals, and each box's lines and files at every frame."""
    files = snapshot["files"]
    head = frames[-1]["sizes"]
    head_bytes = sum(head.values()) or 1
    ratio = snapshot["totals"]["loc"] / head_bytes

    def matcher(b: dict):
        if b["kind"] == "folder":
            pre = b["target"]
            return lambda p: p.startswith(pre)
        members = {files[i]["path"] for i in b["files"]}
        return members.__contains__

    boxes = {}
    for b in view["boxes"]:
        hit = matcher(b)
        per = [[(p, s) for p, s in f["sizes"].items() if hit(p)] for f in frames]
        now = sum(s for _, s in per[-1])
        r = b["loc"] / now if now and b["loc"] else ratio
        boxes[b["id"]] = {
            "lines": [round(sum(s for _, s in ps) * r) for ps in per],
            "files": [len(ps) for ps in per],
        }

    return {
        "frames": [
            {
                "sha": f["sha"],
                "n": f["n"],
                "date": f["date"],
                "message": f["message"],
                "author": f["author"],
                "files": len(f["sizes"]),
                "lines": round(sum(f["sizes"].values()) * ratio),
            }
            for f in frames
        ],
        "boxes": boxes,
    }
