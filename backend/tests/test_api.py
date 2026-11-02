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

    monkeypatch.setattr(main, "repo_info", repo_info)
    monkeypatch.setattr(main, "download_tarball", download_tarball)
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


def test_summary():
    client.get("/api/repo", params={"url": "me/repo"})
    r = client.post("/api/summary", json={"slug": "me/repo", "sha": SHA, "path": "app/db.py"})
    assert r.status_code == 200 and r.json()["summary"]
    assert client.post("/api/summary", json={"slug": "me/repo", "sha": SHA, "path": "nope.py"}).status_code == 404


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




def test_levels_and_explain():
    client.get("/api/repo", params={"url": "me/repo"})
    r = client.get("/api/level", params={"slug": "me/repo", "sha": SHA})
    data = r.json()
    # The root only wraps app/ and a README, so the diagram starts inside app/.
    assert data["path"] == "app/"
    assert data["explain"] is None
    inner = client.get("/api/level", params={"slug": "me/repo", "sha": SHA, "path": "app/"}).json()
    assert {b["name"] for b in inner["boxes"]} == {"__init__.py", "db.py", "main.py"}
    main_i = [b["name"] for b in inner["boxes"]].index("main.py")
    db_i = [b["name"] for b in inner["boxes"]].index("db.py")
    assert {"from": main_i, "to": db_i, "count": 1} in inner["links"]
    e = client.post("/api/explain", json={"slug": "me/repo", "sha": SHA, "path": "app/"}).json()
    assert e["summary"] and set(e["boxes"]) == {"__init__.py", "db.py", "main.py"}
    again = client.get("/api/level", params={"slug": "me/repo", "sha": SHA, "path": "app/"}).json()
    assert again["explain"]["summary"] == e["summary"]
    assert client.get("/api/level", params={"slug": "me/repo", "sha": SHA, "path": "nope/"}).status_code == 404


def test_level_skips_wrapper_folders():
    from app.levels import level_view

    snap = {
        "slug": "a/b",
        "files": [
            {"path": "src/pkg/a.py", "lang": "Python", "loc": 10},
            {"path": "src/pkg/sub/b.py", "lang": "Python", "loc": 5},
            {"path": "README.md", "lang": "Markdown", "loc": 3},
        ],
        "edges": [[0, 1]],
    }
    v = level_view(snap, "src/")
    assert v["path"] == "src/pkg/" and [b["name"] for b in v["boxes"]] == ["a.py", "sub"]
    assert v["boxes"][0]["kind"] == "file"
    assert v["links"] == [{"from": 0, "to": 1, "count": 1}]
    assert [c["name"] for c in v["crumbs"]] == ["b", "src", "pkg"]
