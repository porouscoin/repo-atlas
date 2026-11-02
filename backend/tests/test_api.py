import io
import json
import tarfile

import pytest
from fastapi.testclient import TestClient

from app import github, main, store

SHA = "a" * 40


def tarball(files: dict[str, str]) -> bytes:
    buf = io.BytesIO()
    with tarfile.open(fileobj=buf, mode="w:gz") as tar:
        for path, text in files.items():
            data = text.encode()
            info = tarfile.TarInfo(f"me-repo-{SHA[:7]}/{path}")
            info.size = len(data)
            tar.addfile(info, io.BytesIO(data))
    return buf.getvalue()


REPO = {
    "README.md": "# Demo\nA demo repo.",
    "app/__init__.py": "",
    "app/main.py": "from .db import connect\n\ndef login(user):\n    return connect()\n",
    "app/db.py": "def connect():\n    return 1\n",
}


@pytest.fixture(autouse=True)
def fake_github(monkeypatch):
    monkeypatch.setenv("ENABLE_MOCK_MODEL", "1")
    store._mem.data.clear()
    store._hot.data.clear()
    store.repo_texts.data.clear()
    store._events.clear()
    calls = {"download": 0}

    async def repo_info(ref):
        return {"slug": "me/repo", "branch": "main", "sha": SHA, "description": "Demo", "stars": 3, "language": "Python", "size_kb": 1}

    async def download_tarball(slug, sha):
        calls["download"] += 1
        return tarball(REPO)

    async def commit_history(slug, sha, limit):
        return [{"sha": "abc1234", "author": "me", "date": "2026-01-01T00:00:00Z", "message": "init", "files": [{"path": "app/main.py", "status": "added", "prev": None, "add": 4, "del": 0}]}]

    monkeypatch.setattr(main, "repo_info", repo_info)
    monkeypatch.setattr(main, "download_tarball", download_tarball)
    monkeypatch.setattr(main, "commit_history", commit_history)
    return calls


client = TestClient(main.app)


def test_parse_repo():
    assert github.parse_repo("https://github.com/vercel/next.js/tree/canary/packages").slug == "vercel/next.js"
    assert github.parse_repo("pallets/flask.git").slug == "pallets/flask"
    with pytest.raises(github.RepoError):
        github.parse_repo("not a repo")


def test_repo_is_mapped_then_cached(fake_github):
    r = client.get("/api/repo", params={"url": "github.com/me/repo"})
    assert r.status_code == 200
    data = r.json()
    paths = [f["path"] for f in data["files"]]
    assert paths == ["README.md", "app/__init__.py", "app/db.py", "app/main.py"]
    assert [paths.index("app/main.py"), paths.index("app/db.py")] in data["edges"]
    assert data["cached"] is False
    again = client.get("/api/repo", params={"url": "me/repo"}).json()
    assert again["cached"] is True and fake_github["download"] == 1


def test_history_validates_and_caches():
    assert client.get("/api/history", params={"slug": "me/repo", "sha": "nope"}).status_code == 400
    r = client.get("/api/history", params={"slug": "me/repo", "sha": SHA})
    assert r.json()["commits"][0]["files"][0]["path"] == "app/main.py"


def test_summary_and_tour():
    client.get("/api/repo", params={"url": "me/repo"})
    r = client.post("/api/summary", json={"slug": "me/repo", "sha": SHA, "path": "app/db.py"})
    assert r.status_code == 200 and r.json()["summary"]
    assert client.post("/api/summary", json={"slug": "me/repo", "sha": SHA, "path": "nope.py"}).status_code == 404
    r = client.post("/api/tour", json={"slug": "me/repo", "sha": SHA})
    assert r.status_code == 200 and r.json()["stops"][0]["title"]


def test_ask_streams_tool_steps_then_answer():
    client.get("/api/repo", params={"url": "me/repo"})
    r = client.post("/api/ask", json={"slug": "me/repo", "sha": SHA, "question": "Where is login?"})
    events = [json.loads(line[6:]) for line in r.text.splitlines() if line.startswith("data: ")]
    assert events[0]["type"] == "tool" and events[0]["name"] == "search_code"
    assert "app/main.py" in events[0]["files"]
    assert events[-1]["type"] == "answer"


def test_tools():
    from app.ai import mentioned_files, run_tool

    texts = {"app/main.py": "def login():\n    pass\n", "app/db.py": "x = 1\n"}
    out, files = run_tool("search_code", {"query": "LOGIN|nothing"}, texts)
    assert "app/main.py:1" in out and files == ["app/main.py"]
    out, files = run_tool("read_file", {"path": "main.py"}, texts)
    assert out.startswith("app/main.py (2 lines)") and files == ["app/main.py"]
    out, _ = run_tool("list_dir", {"path": ""}, texts)
    assert "app/ (2 files)" in out
    assert mentioned_files("See `app/main.py:1` and `db.py` and the `app/` folder", texts) == ["app/main.py", "app/db.py", "app/"]


