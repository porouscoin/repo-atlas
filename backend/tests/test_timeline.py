from app.levels import level_view
from app.timeline import pick, series


def test_pick_spreads_from_first_to_newest():
    assert pick(5, 10) == [5, 4, 3, 2, 1]
    got = pick(1000, 12)
    assert got[0] == 1000 and got[-1] == 1 and len(got) == 12 and got == sorted(got, reverse=True)


def test_series_ends_on_todays_numbers():
    files = [
        {"path": "src/app.py", "lang": "Python", "loc": 100, "bytes": 3000},
        {"path": "src/util.py", "lang": "Python", "loc": 50, "bytes": 1500},
        {"path": "tests/test_app.py", "lang": "Python", "loc": 40, "bytes": 1200},
    ]
    snap = {"slug": "o/r", "files": files, "edges": [[2, 0], [0, 1]], "totals": {"loc": 190, "files": 3}}
    view = level_view(snap, "")
    frames = [
        {"sha": "a", "n": 1, "date": "2020-01-01T00:00:00Z", "message": "init", "author": "x", "sizes": {"src/app.py": 600}},
        {"sha": "b", "n": 9, "date": "2021-01-01T00:00:00Z", "message": "grow", "author": "x",
         "sizes": {"src/app.py": 3000, "src/util.py": 1500, "tests/test_app.py": 1200}},
    ]
    out = series(frames, snap, view)
    src = out["boxes"]["src/"]
    assert src["lines"] == [20, 150] and src["files"] == [1, 2]
    assert out["boxes"]["tests/"]["lines"] == [0, 40]
    assert out["frames"][-1]["lines"] == 190


def test_files_over_time_tracks_every_path_and_period():
    from app.timeline import files_over_time

    snap = {"totals": {"loc": 100, "files": 2}}
    c = lambda d, m, a: {"sha": "x" * 40, "date": d, "message": m, "author": a, "avatar": ""}
    frames = [
        {"sha": "a", "n": 1, "date": "2020-01-01", "message": "init", "author": "ann", "sizes": {"old.py": 300},
         "recent": [c("2020-01-01", "init", "ann")], "releases": [{"tag": "v1", "date": "2020-06-01"}]},
        {"sha": "b", "n": 5, "date": "2021-01-01", "message": "grow", "author": "bob", "sizes": {"a.py": 2000, "b.py": 1000},
         "recent": [c("2021-01-01", "grow", "bob"), c("2020-09-01", "fix", "bob"), c("2020-01-01", "init", "ann")]},
    ]
    out = files_over_time(frames, snap, 5)
    assert out["paths"] == ["a.py", "b.py", "old.py"]
    assert out["sizes"][0] == [0, 67] and out["sizes"][2][1] == 0 and out["sizes"][2][0] > 0
    assert [x["message"] for x in out["frames"][1]["commits"]] == ["grow", "fix"]
    assert out["frames"][1]["people"] == [{"name": "bob", "avatar": "", "commits": 2}]
    assert out["releases"][0]["tag"] == "v1" and out["langs"][0] == "Python"
