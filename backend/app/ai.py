"""The AI on top of the map: one-line file summaries, questions answered by a
small agent that reads the code, and a guided tour."""

import hashlib
import json
import posixpath
import re
from typing import AsyncIterator

from . import store
from .analyze import overview
from .config import models_for, settings
from .providers import ModelResult, ProviderError, RateLimited, call_any, call_model, parse_json

# ------------------------------------------------------------------ summary

SUMMARY_PROMPT = (
    "You describe source files for a code map. In one sentence of at most 22 words, say what this file "
    "does and why it matters in the project. Plain text, no markdown, don't start with 'This file'."
)


async def summarize(slug: str, path: str, text: str) -> str:
    digest = hashlib.sha1(text.encode()).hexdigest()[:16]
    key = f"sum:{slug}:{path}:{digest}"
    cached = await store.cache_get(key)
    if cached:
        return cached["text"]
    head = text[:6000]
    result = await call_any(
        models_for("summary"),
        [
            {"role": "system", "content": SUMMARY_PROMPT},
            {"role": "user", "content": f"Repo: {slug}\nFile: {path}\n\n{head}"},
        ],
        max_tokens=300,
        temperature=0.2,
    )
    summary = result.content.strip().strip('"').split("\n")[0][:240] or "No summary."
    await store.cache_set(key, {"text": summary})
    return summary


# ---------------------------------------------------------------- the agent

TOOLS = [
    {
        "type": "function",
        "function": {
            "name": "search_code",
            "description": "Search every file for text (case-insensitive). Separate alternatives with |. "
            "Returns matching lines as path:line: text.",
            "parameters": {
                "type": "object",
                "properties": {
                    "query": {"type": "string", "description": "Text to find, e.g. 'def login|class Auth'"},
                    "path_contains": {"type": "string", "description": "Only search paths containing this"},
                },
                "required": ["query"],
            },
        },
    },
    {
        "type": "function",
        "function": {
            "name": "read_file",
            "description": "Read a file with line numbers, 150 lines at a time.",
            "parameters": {
                "type": "object",
                "properties": {
                    "path": {"type": "string"},
                    "start_line": {"type": "integer", "description": "1-based, default 1"},
                },
                "required": ["path"],
            },
        },
    },
    {
        "type": "function",
        "function": {
            "name": "list_dir",
            "description": "List a folder's files and subfolders with line counts. Use '' for the root.",
            "parameters": {"type": "object", "properties": {"path": {"type": "string"}}, "required": ["path"]},
        },
    },
]

ASK_PROMPT = """You are the guide inside Repo Atlas, a 3D map of a GitHub repo. A visitor asks about the code.
Use the tools to look at the real code before answering; never guess what a file contains.

{overview}

Answer in a few short paragraphs or bullets of plain markdown, under 180 words. Always write file paths
in backticks exactly as they appear in the repo (like `src/app.py`), because the map lights up every
path you mention. Mention the 1 to 6 files that matter most. If the code doesn't answer the question,
say so."""


def run_tool(name: str, args: dict, texts: dict[str, str]) -> tuple[str, list[str]]:
    """Returns the tool's output for the model and the files it touched (for the map)."""
    if name == "search_code":
        query = str(args.get("query") or "").strip()[:200]
        if not query:
            return "Give a query.", []
        needles = [n.strip().lower() for n in query.split("|") if n.strip()]
        within = str(args.get("path_contains") or "").lower()
        hits, files = [], []
        for path in sorted(texts):
            if within and within not in path.lower():
                continue
            for n, line in enumerate(texts[path].splitlines(), 1):
                low = line.lower()
                if any(x in low for x in needles):
                    hits.append(f"{path}:{n}: {line.strip()[:160]}")
                    if path not in files:
                        files.append(path)
                    if len(hits) >= 40:
                        break
            if len(hits) >= 40:
                break
        return ("\n".join(hits) if hits else "No matches."), files[:12]
    if name == "read_file":
        path = str(args.get("path") or "").strip().lstrip("./")
        if path not in texts:
            close = [p for p in texts if p.endswith("/" + path) or p.endswith(path)]
            if len(close) == 1:
                path = close[0]
            else:
                return f"No file named {path}.", []
        lines = texts[path].splitlines()
        try:
            start = max(1, int(args.get("start_line") or 1))
        except (TypeError, ValueError):
            start = 1
        chunk = lines[start - 1 : start + 149]
        body = "\n".join(f"{start + i}: {l[:220]}" for i, l in enumerate(chunk))
        more = f"\n... {len(lines) - start - 149} more lines" if len(lines) > start + 149 else ""
        return f"{path} ({len(lines)} lines)\n{body}{more}", [path]
    if name == "list_dir":
        folder = str(args.get("path") or "").strip().strip("/").removeprefix("./")
        folder = "" if folder in (".", "(root)") else folder
        prefix = folder + "/" if folder else ""
        entries: dict[str, int] = {}
        files = []
        for p, t in texts.items():
            if not p.startswith(prefix):
                continue
            rest = p[len(prefix) :]
            if "/" in rest:
                d = rest.split("/")[0] + "/"
                entries[d] = entries.get(d, 0) + 1
            else:
                entries[rest] = -len(t.splitlines()) - 1
                files.append(p)
        if not entries:
            return f"No folder named {folder}.", []
        out = [f"{k} ({v} files)" if v >= 0 else f"{k} ({-v - 1} lines)" for k, v in sorted(entries.items())]
        return "\n".join(out[:150]), files[:12]
    return f"Unknown tool {name}.", []


def _assistant_message(result: ModelResult) -> dict:
    calls = []
    for tc in result.tool_calls:
        call = {
            "id": tc.id,
            "type": "function",
            "function": {"name": tc.name, "arguments": tc.raw_arguments or json.dumps(tc.arguments)},
        }
        if tc.extra_content:
            call["extra_content"] = tc.extra_content  # Gemini 3's thought signature
        calls.append(call)
    return {"role": "assistant", "content": result.content or None, "tool_calls": calls}


PATH_RE = re.compile(r"`([^`\s]+)`")


def mentioned_files(text: str, texts: dict[str, str]) -> list[str]:
    out = []
    for m in PATH_RE.findall(text):
        m = m.strip().lstrip("./").rstrip(".,:;")
        m = re.sub(r":\d+(-\d+)?$", "", m)  # path:12
        hit = m if m in texts else None
        if not hit:
            ends = [p for p in texts if p.endswith("/" + m)]
            hit = ends[0] if len(ends) == 1 else None
        if not hit and m.rstrip("/") and any(p.startswith(m.rstrip("/") + "/") for p in texts):
            hit = m.rstrip("/") + "/"  # a folder
        if hit and hit not in out:
            out.append(hit)
    return out


async def ask(snapshot: dict, texts: dict[str, str], question: str, history: list[dict]) -> AsyncIterator[dict]:
    """Yields events: {"type": "tool", ...} per step, then {"type": "answer", ...} or {"type": "error", ...}."""
    messages: list[dict] = [{"role": "system", "content": ASK_PROMPT.format(overview=overview(snapshot))}]
    for turn in history[-6:]:
        if turn.get("role") in ("user", "assistant") and isinstance(turn.get("content"), str):
            messages.append({"role": turn["role"], "content": turn["content"][:2000]})
    messages.append({"role": "user", "content": question[:1000]})

    specs = models_for("agent")
    if not specs:
        yield {"type": "error", "message": "No AI model is configured on the server."}
        return
    pinned = None
    touched: list[str] = []
    for step in range(settings.max_steps + 1):
        last = step == settings.max_steps
        if last:
            messages.append({"role": "user", "content": "Answer now with what you found."})
        try:
            if pinned is None:
                # Find the first model that answers, then stay on it: Gemini's thought
                # signatures don't survive a switch to another provider mid-conversation.
                for i, spec in enumerate(specs):
                    try:
                        result = await call_model(spec, messages, tools=None if last else TOOLS, max_tokens=1500)
                        pinned = spec
                        break
                    except ProviderError:
                        if i == len(specs) - 1:
                            raise
            else:
                result = await call_model(pinned, messages, tools=None if last else TOOLS, max_tokens=1500)
        except RateLimited:
            yield {"type": "error", "message": "The AI is busy right now (free tier limits). Try again in a minute."}
            return
        except ProviderError as e:
            print(f"ask failed: {e}")
            yield {"type": "error", "message": "The AI couldn't answer right now. Try again."}
            return

        if not result.tool_calls:
            text = result.content.strip()
            parsed = parse_json(text) if text.startswith("{") else {}
            if parsed.get("answer"):
                text = str(parsed["answer"])
            files = mentioned_files(text, texts) or touched[-4:]
            yield {"type": "answer", "text": text or "I couldn't find an answer.", "files": files, "model": result.model}
            return

        messages.append(_assistant_message(result))
        for tc in result.tool_calls:
            output, files = run_tool(tc.name, tc.arguments, texts)
            touched += [f for f in files if f not in touched]
            messages.append({"role": "tool", "tool_call_id": tc.id, "content": output[:6000]})
            yield {"type": "tool", "name": tc.name, "args": tc.arguments, "files": files}


# --------------------------------------------------------------------- tour

TOUR_PROMPT = """You are a tour guide for Repo Atlas, a 3D map of a GitHub repo. Plan a guided tour for a
developer seeing this repo for the first time: 5 to 7 stops, in the order that makes the codebase click
(what it is, where it starts, the core, how pieces connect, where to look next).

{overview}

Reply with JSON only: {{"stops": [{{"target": "<a file path or folder path from the repo, or empty for the whole repo>",
"title": "<2 to 5 words>", "text": "<2 short sentences, under 45 words>"}}]}}
Targets must be exact paths from the repo. Folders end with a slash."""


def tour_context(snapshot: dict, texts: dict[str, str]) -> str:
    from collections import Counter

    files = snapshot["files"]
    indeg = Counter(t for _, t in snapshot["edges"])
    picks = [files[i]["path"] for i, _ in indeg.most_common(6)]
    readme = next((p for p in sorted(texts, key=len) if posixpath.basename(p).lower().startswith("readme")), None)
    entry_names = ("main.py", "app.py", "__main__.py", "index.ts", "index.js", "main.go", "main.rs", "lib.rs",
                   "server.ts", "server.js", "page.tsx", "layout.tsx", "manage.py", "cli.py")
    entries = sorted((p for p in texts if posixpath.basename(p) in entry_names), key=lambda p: p.count("/"))[:4]
    parts = []
    if readme:
        parts.append(f"--- {readme} (start)\n{texts[readme][:2500]}")
    for p in dict.fromkeys(entries + picks):
        head = "\n".join(texts.get(p, "").splitlines()[:30])
        parts.append(f"--- {p} (first 30 lines)\n{head}")
    return "\n\n".join(parts)[:14000]


def clean_target(target: str, texts: dict[str, str]) -> str:
    t = (target or "").strip().strip("`").lstrip("./")
    if not t:
        return ""
    if t in texts:
        return t
    folder = t.rstrip("/")
    if any(p.startswith(folder + "/") for p in texts):
        return folder + "/"
    ends = [p for p in texts if p.endswith("/" + t)]
    return ends[0] if len(ends) == 1 else ""


async def tour(snapshot: dict, texts: dict[str, str]) -> list[dict]:
    key = f"tour:{snapshot['slug']}:{snapshot['sha']}"
    cached = await store.cache_get(key)
    if cached:
        return cached["stops"]
    result = await call_any(
        models_for("agent"),
        [
            {"role": "system", "content": TOUR_PROMPT.format(overview=overview(snapshot))},
            {"role": "user", "content": tour_context(snapshot, texts)},
        ],
        max_tokens=1800,
        temperature=0.4,
        json_mode=True,
    )
    raw = parse_json(result.content).get("stops") or []
    stops = []
    for s in raw[:8]:
        if not isinstance(s, dict):
            continue
        stops.append(
            {
                "target": clean_target(str(s.get("target") or ""), texts),
                "title": str(s.get("title") or "")[:60],
                "text": str(s.get("text") or "")[:400],
            }
        )
    if not stops:
        raise ProviderError("The tour came back empty.")
    await store.cache_set(key, {"stops": stops})
    return stops
