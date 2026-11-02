"""Turn a repo's files into the snapshot the map draws: one entry per file,
the import edges between them, and a few totals."""

import posixpath
from collections import Counter

from .config import settings
from .imports import Resolver, language
from .stack import detect

SKIP_DIRS = {
    "node_modules", ".git", "vendor", "dist", "build", "out", ".next", ".nuxt", ".svelte-kit",
    "__pycache__", ".venv", "venv", "env", "target", "coverage", ".cache", ".turbo", ".idea",
    ".vscode", ".gradle", "bower_components", "Pods", ".tox", ".mypy_cache", ".pytest_cache",
    "site-packages", "third_party", "external",
}
SKIP_NAMES = {
    "package-lock.json", "yarn.lock", "pnpm-lock.yaml", "bun.lockb", "Cargo.lock", "poetry.lock",
    "Pipfile.lock", "composer.lock", "Gemfile.lock", "go.sum", "uv.lock", ".DS_Store",
}
BINARY_EXTS = {
    ".png", ".jpg", ".jpeg", ".gif", ".webp", ".ico", ".svg", ".bmp", ".tiff", ".avif",
    ".woff", ".woff2", ".ttf", ".otf", ".eot", ".mp3", ".mp4", ".wav", ".webm", ".mov",
    ".zip", ".gz", ".tar", ".7z", ".pdf", ".jar", ".class", ".so", ".dll", ".exe", ".bin",
    ".pyc", ".wasm", ".lockb", ".db", ".sqlite", ".parquet", ".npy", ".pt", ".onnx", ".glb",
}
CODE_FIRST = {"Markdown", "Config", "Other"}  # kept last when a repo has too many files


def keep(path: str, data: bytes) -> bool:
    parts = path.split("/")
    if any(p in SKIP_DIRS or p.endswith(".egg-info") for p in parts[:-1]):
        return False
    name = parts[-1]
    if name in SKIP_NAMES or name.endswith((".min.js", ".min.css", ".map")):
        return False
    dot = name.rfind(".")
    if dot > 0 and name[dot:].lower() in BINARY_EXTS:
        return False
    return b"\0" not in data[:8000]


def decode(data: bytes) -> str:
    return data.decode("utf-8", errors="replace")


def build_snapshot(info: dict, raw: dict[str, bytes]) -> tuple[dict, dict[str, str]]:
    """Returns the snapshot and the text of every kept file (for the AI)."""
    texts = {p: decode(d) for p, d in raw.items() if keep(p, d)}
    total = len(texts)
    if total > settings.max_files:
        ranked = sorted(texts, key=lambda p: (language(p) in CODE_FIRST, p.count("/"), p))
        texts = {p: texts[p] for p in ranked[: settings.max_files]}

    paths = sorted(texts)
    index = {p: i for i, p in enumerate(paths)}
    resolver = Resolver(texts)

    files, edges = [], []
    for i, p in enumerate(paths):
        text = texts[p]
        files.append(
            {
                "path": p,
                "lang": language(p),
                "loc": sum(1 for line in text.splitlines() if line.strip()),
                "bytes": len(raw[p]),
            }
        )
        for target in resolver.imports_of(p):
            edges.append([i, index[target]])

    langs: Counter = Counter()
    loc_by_lang: Counter = Counter()
    for f in files:
        langs[f["lang"]] += 1
        loc_by_lang[f["lang"]] += f["loc"]
    folders = sorted({posixpath.dirname(p) for p in paths} - {""})

    snapshot = {
        **info,
        "files": files,
        "edges": edges,
        "folders": folders,
        "languages": [
            {"lang": lang, "files": n, "loc": loc_by_lang[lang]}
            for lang, n in sorted(langs.items(), key=lambda kv: -loc_by_lang[kv[0]])
        ],
        "totals": {"files": len(files), "loc": sum(f["loc"] for f in files), "edges": len(edges)},
        "skipped_files": total - len(files),
        **detect(texts),
    }
    return snapshot, texts


def overview(snapshot: dict, limit: int = 25) -> str:
    """A compact description of the repo for the AI's prompts."""
    files = snapshot["files"]
    indeg: Counter = Counter(t for _, t in snapshot["edges"])
    hubs = [files[i]["path"] for i, _ in indeg.most_common(12)]
    biggest = [f["path"] for f in sorted(files, key=lambda f: -f["loc"])[:12]]
    top_folders: Counter = Counter(f["path"].split("/")[0] if "/" in f["path"] else "(root)" for f in files)
    langs = ", ".join(f"{l['lang']} {l['loc']} lines" for l in snapshot["languages"][:6])
    lines = [
        f"Repo: {snapshot['slug']} ({snapshot.get('description') or 'no description'})",
        f"{snapshot['totals']['files']} files, {snapshot['totals']['loc']} lines. Languages: {langs}.",
        "Top-level folders (files): " + ", ".join(f"{k} ({v})" for k, v in top_folders.most_common(limit)),
        "Most imported files: " + ", ".join(hubs),
        "Largest files: " + ", ".join(biggest),
    ]
    if snapshot.get("stack"):
        lines.append("Built with: " + ", ".join(snapshot["stack"]))
    return "\n".join(lines)
