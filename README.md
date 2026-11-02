# Repo Atlas

Paste a public GitHub repo and get a simple diagram of its main parts, how they depend on each other, and a plain-English explanation of each one.

- **The big picture**: each folder becomes a box, and arrows show which parts import which. Weak and reverse links are hidden so the main flow reads top to bottom.
- **Plain English**: AI explains what the repo does at each level and gives every box a one-line role, plus where to start reading.
- **One level deeper**: click into any folder to see its own parts, down to single files with what they use and what uses them.
- **Facts, not guesses**: what the repo is built with, its language split and its entry points are read from manifests, not from the AI.
- **Ask**: an agent searches and reads the code to answer a question, and highlights the parts it talks about.

Dark mode is the default; the toggle in the top right switches to light.

## How it works

The backend (FastAPI) downloads the repo as one tarball at its latest commit, reads it in memory, and finds imports with per-language regexes (Python, JS/TS with tsconfig path aliases, Go, Rust, Java/Kotlin, C/C++, Ruby, CSS). Only imports that resolve to a file in the repo count. For each folder it groups files into at most 12 boxes, skipping wrapper folders like a lone `src/`, and adds up the imports between boxes. Everything is cached per commit.

The frontend (Next.js) lays each level out in layers: cycles are broken, parts that use others sit above what they use, rows are ordered to cut crossings, and arrows that skip a row bend around cards in the way.

The AI uses free-tier models through an OpenAI-compatible API (Groq first, Gemini as backup). The ask agent has three tools over the downloaded code (`search_code`, `read_file`, `list_dir`) and streams each step to the browser as server-sent events.

## Run it locally

```bash
cd backend
python -m venv .venv && .venv/bin/pip install -r requirements-dev.txt
export GITHUB_TOKEN=... GROQ_API_KEY=...   # see .env.example, or ENABLE_MOCK_MODEL=1
.venv/bin/uvicorn app.main:app --reload --port 8000
.venv/bin/pytest

cd ../frontend
npm install
npm run dev   # http://localhost:3000, talks to NEXT_PUBLIC_API_URL (default http://localhost:8000)
```
