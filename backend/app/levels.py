"""Group a repo into a handful of boxes for one level of the diagram.

At any folder, each subfolder becomes a box and loose files share one box.
A folder with a single subfolder and nothing else (like src/ holding one
package) is skipped so the diagram starts where the code actually is.
Import edges are added up between boxes.
"""

from collections import Counter, defaultdict

CODE_LANGS_EXCLUDED = {"Markdown", "Config", "Other"}
MAX_BOXES = 12


def _children(paths: list[tuple[int, str]], prefix: str):
    folders: dict[str, list[int]] = defaultdict(list)
    loose: list[int] = []
    for i, p in paths:
        rest = p[len(prefix) :]
        if "/" in rest:
            folders[rest.split("/")[0]].append(i)
        else:
            loose.append(i)
    return folders, loose


def level_view(snapshot: dict, path: str) -> dict:
    files = snapshot["files"]
    prefix = path.strip("/")
    prefix = prefix + "/" if prefix else ""
    inside = [(i, f["path"]) for i, f in enumerate(files) if f["path"].startswith(prefix)]
    if not inside:
        raise KeyError(path)

    # Skip folders that only wrap one other folder.
    folders, loose = _children(inside, prefix)
    while len(folders) == 1 and all(files[i]["lang"] in CODE_LANGS_EXCLUDED for i in loose) and len(loose) <= 2:
        only = next(iter(folders))
        prefix = prefix + only + "/"
        folders, loose = _children(inside, prefix)

    def box(id_: str, name: str, kind: str, target: str, members: list[int]) -> dict:
        langs: Counter = Counter()
        for i in members:
            langs[files[i]["lang"]] += files[i]["loc"] + 1
        return {
            "id": id_,
            "name": name,
            "kind": kind,  # folder | file | group
            "target": target,
            "files": members,
            "loc": sum(files[i]["loc"] for i in members),
            "langs": [{"lang": l, "loc": n} for l, n in langs.most_common(3)],
        }

    boxes = []
    if folders:
        for name, members in folders.items():
            boxes.append(box(prefix + name + "/", name, "folder", prefix + name + "/", members))
        if loose:
            boxes.append(box("loose:" + prefix, "Files here" if prefix else "Root files", "group", "", loose))
    else:
        for i in loose:
            boxes.append(box(files[i]["path"], files[i]["path"].rsplit("/", 1)[-1], "file", files[i]["path"], [i]))

    boxes.sort(key=lambda b: (b["kind"] == "group", -b["loc"]))
    if len(boxes) > MAX_BOXES:
        keep, rest = boxes[: MAX_BOXES - 1], boxes[MAX_BOXES - 1 :]
        merged = [i for b in rest for i in b["files"]]
        keep.append(box("more:" + prefix, f"{len(rest)} smaller parts", "group", "", merged))
        keep[-1]["parts"] = [b["name"] for b in rest][:20]
        boxes = keep

    owner = {}
    for k, b in enumerate(boxes):
        for i in b["files"]:
            owner[i] = k
    links: Counter = Counter()
    used_from_outside: Counter = Counter()
    uses_outside: Counter = Counter()
    for a, t in snapshot["edges"]:
        ka, kt = owner.get(a), owner.get(t)
        if ka is not None and kt is not None and ka != kt:
            links[(ka, kt)] += 1
        elif ka is None and kt is not None:
            used_from_outside[kt] += 1
        elif ka is not None and kt is None:
            uses_outside[ka] += 1
    for k, b in enumerate(boxes):
        b["used_from_outside"] = used_from_outside[k]
        b["uses_outside"] = uses_outside[k]

    here = prefix.rstrip("/")
    crumbs = [{"name": snapshot["slug"].split("/")[1], "path": ""}]
    acc = ""
    for part in here.split("/") if here else []:
        acc = f"{acc}{part}/"
        crumbs.append({"name": part, "path": acc})
    return {
        "path": prefix,
        "crumbs": crumbs,
        "boxes": boxes,
        "links": [{"from": a, "to": t, "count": n} for (a, t), n in links.most_common()],
        "files": len(inside if not prefix else [x for x in inside if x[1].startswith(prefix)]),
    }
