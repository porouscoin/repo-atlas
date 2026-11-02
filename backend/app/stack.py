"""What a repo is built with, read from its manifest files, and where it starts.

No AI here: a dependency list is a fact, so it's read, not guessed.
"""

import json
import posixpath
import re
import tomllib

# dependency name -> label shown to the visitor, in rough order of importance
KNOWN = {
    # JS frameworks and runtimes
    "next": "Next.js", "react": "React", "vue": "Vue", "svelte": "Svelte", "@sveltejs/kit": "SvelteKit",
    "@angular/core": "Angular", "nuxt": "Nuxt", "astro": "Astro", "solid-js": "Solid", "react-native": "React Native",
    "electron": "Electron", "express": "Express", "fastify": "Fastify", "@nestjs/core": "NestJS", "hono": "Hono",
    "koa": "Koa", "vite": "Vite", "webpack": "webpack", "tailwindcss": "Tailwind CSS", "three": "three.js",
    "graphql": "GraphQL", "@apollo/client": "Apollo", "socket.io": "Socket.IO", "prisma": "Prisma",
    "@prisma/client": "Prisma", "drizzle-orm": "Drizzle", "mongoose": "MongoDB", "pg": "PostgreSQL",
    "mysql2": "MySQL", "redis": "Redis", "ioredis": "Redis", "@supabase/supabase-js": "Supabase", "firebase": "Firebase",
    "zod": "Zod", "openai": "OpenAI SDK", "@anthropic-ai/sdk": "Anthropic SDK", "langchain": "LangChain",
    "@langchain/core": "LangChain", "ai": "Vercel AI SDK", "jest": "Jest", "vitest": "Vitest",
    "@playwright/test": "Playwright", "cypress": "Cypress", "typescript": "TypeScript",
    # Python
    "django": "Django", "flask": "Flask", "fastapi": "FastAPI", "starlette": "Starlette", "werkzeug": "Werkzeug",
    "jinja2": "Jinja", "click": "Click", "typer": "Typer", "pydantic": "Pydantic", "sqlalchemy": "SQLAlchemy",
    "alembic": "Alembic", "celery": "Celery", "uvicorn": "Uvicorn", "gunicorn": "Gunicorn", "httpx": "HTTPX",
    "requests": "Requests", "aiohttp": "aiohttp", "numpy": "NumPy", "pandas": "pandas", "torch": "PyTorch",
    "tensorflow": "TensorFlow", "scikit-learn": "scikit-learn", "transformers": "Transformers",
    "langgraph": "LangGraph", "anthropic": "Anthropic SDK", "streamlit": "Streamlit", "pytest": "pytest",
    "psycopg2": "PostgreSQL", "psycopg": "PostgreSQL", "pymongo": "MongoDB",
    # Go
    "github.com/gin-gonic/gin": "Gin", "github.com/labstack/echo/v4": "Echo", "github.com/gofiber/fiber/v2": "Fiber",
    "gorm.io/gorm": "GORM", "github.com/spf13/cobra": "Cobra", "google.golang.org/grpc": "gRPC",
    # Rust
    "tokio": "Tokio", "serde": "Serde", "axum": "Axum", "actix-web": "Actix Web", "clap": "Clap", "reqwest": "reqwest",
}
ORDER = {label: k for k, label in enumerate(dict.fromkeys(KNOWN.values()))}

ENTRY_NAMES = [
    "manage.py", "main.py", "app.py", "__main__.py", "cli.py", "server.py", "wsgi.py", "asgi.py",
    "main.go", "main.rs", "lib.rs", "index.ts", "index.tsx", "index.js", "main.ts", "main.tsx", "main.js",
    "server.ts", "server.js", "app.ts", "app.js", "page.tsx", "layout.tsx", "App.tsx", "App.vue", "Program.cs",
]


def _norm(name: str) -> str:
    return re.split(r"[\[<>=!~ ;]", name.strip().lower(), maxsplit=1)[0].replace("_", "-")


SIDE = re.compile(r"(^|/)(tests?|examples?|docs?|fixtures?|samples?|benchmarks?)/")


def _shallow(paths: list[str], name: str, depth: int = 2) -> list[str]:
    """Manifests near the top, ignoring ones that belong to examples or tests."""
    return [p for p in paths if posixpath.basename(p) == name and p.count("/") <= depth and not SIDE.search(p)]


def detect(texts: dict[str, str]) -> dict:
    paths = sorted(texts, key=lambda p: (p.count("/"), p))
    deps: set[str] = set()

    for p in _shallow(paths, "package.json"):
        try:
            data = json.loads(texts[p])
        except (json.JSONDecodeError, TypeError):
            continue
        for field in ("dependencies", "devDependencies", "peerDependencies"):
            deps.update((data.get(field) or {}).keys())

    for p in _shallow(paths, "pyproject.toml"):
        try:
            data = tomllib.loads(texts[p])
        except tomllib.TOMLDecodeError:
            continue
        project = data.get("project") or {}
        # Only required deps: optional extras (flask's redis/celery) aren't what it's built with.
        names = list(project.get("dependencies") or [])
        poetry = ((data.get("tool") or {}).get("poetry") or {}).get("dependencies") or {}
        names += list(poetry)
        deps.update(_norm(n) for n in names)

    for p in paths:
        base = posixpath.basename(p)
        if p.count("/") <= 2 and base.startswith("requirements") and base.endswith(".txt") and not SIDE.search(p):
            deps.update(_norm(l) for l in texts[p].splitlines() if l.strip() and not l.startswith(("#", "-")))

    for p in _shallow(paths, "go.mod"):
        deps.update(m.group(1) for m in re.finditer(r"^\s*(?:require\s+)?([\w./-]+\.[\w./-]+)\s+v[\d.]", texts[p], re.M))

    for p in _shallow(paths, "Cargo.toml"):
        try:
            data = tomllib.loads(texts[p])
        except tomllib.TOMLDecodeError:
            continue
        deps.update((data.get("dependencies") or {}).keys())

    labels = sorted({KNOWN[d] for d in deps if d in KNOWN}, key=lambda l: ORDER[l])

    tools = []
    names = {posixpath.basename(p) for p in paths}
    if "Dockerfile" in names or any(p.endswith(".dockerfile") for p in paths):
        tools.append("Docker")
    if any(p.startswith(".github/workflows/") for p in paths):
        tools.append("GitHub Actions")
    if "vercel.json" in names:
        tools.append("Vercel")
    if any(p.endswith(".tf") for p in paths):
        tools.append("Terraform")

    entries = []
    for name in ENTRY_NAMES:
        for p in paths:
            if posixpath.basename(p) == name and p.count("/") <= 3 and not SIDE.search(p):
                entries.append(p)
                break
        if len(entries) >= 3:
            break

    return {"stack": labels[:12], "tools": tools, "entries": entries}
