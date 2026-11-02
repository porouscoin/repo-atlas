# Repo Atlas

Paste a public GitHub repo and fly through it as a 3D galaxy.

- **Galaxy**: every file is a star, sized by its lines and colored by language. Folders pull their files into clusters, and imports are threads between stars. Click a star to see what it imports and what imports it.
- **Size**: nested circles show where the code actually lives. Click a folder to zoom in.
- **Time-lapse**: replays the last 200 commits. Files appear when they were added and flare when they change.
- **AI on the map**: hover a star for a one-line summary. Ask a question and an agent searches and reads the code while the camera follows the files it touches. Tour plans a guided walk through the repo.

## How it works

The backend (FastAPI) downloads the repo as one tarball at its latest commit, reads it in memory, and finds imports with per-language regexes (Python, JS/TS with tsconfig path aliases, Go, Rust, Java/Kotlin, C/C++, Ruby, CSS). Only imports that resolve to a file in the repo become edges. The result is cached per commit.

The frontend (Next.js) lays the graph out with a 3D force simulation: each folder gets a hidden hub node that pulls its files together, folders hang off their parent folder, and imports add a weak pull. Rendering is plain three.js: one point cloud with a custom shader for the stars, line segments for imports, and a bloom pass.

The AI uses free-tier models through an OpenAI-compatible API (Groq first, Gemini as backup). The ask agent has three tools over the downloaded code (`search_code`, `read_file`, `list_dir`) and streams each step to the browser as server-sent events, so the map lights up files while the agent is still working.

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
