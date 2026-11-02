from app.analyze import build_snapshot, keep
from app.imports import Resolver, language


def edges(files: dict[str, str]) -> set[tuple[str, str]]:
    r = Resolver(files)
    return {(p, t) for p in files for t in r.imports_of(p)}


def test_python_absolute_relative_and_src_layout():
    files = {
        "src/pkg/__init__.py": "from .core import run\n",
        "src/pkg/core.py": "from . import util\nfrom .util import (\n    helper,\n    other,\n)\nimport os\n",
        "src/pkg/util.py": "",
        "src/pkg/sub/__init__.py": "",
        "src/pkg/sub/deep.py": "from ..core import run\nfrom pkg.util import helper\n",
        "tests/test_core.py": "import pkg.core\nfrom pkg import util\n",
    }
    e = edges(files)
    assert ("src/pkg/__init__.py", "src/pkg/core.py") in e
    assert ("src/pkg/core.py", "src/pkg/util.py") in e
    assert ("src/pkg/sub/deep.py", "src/pkg/core.py") in e
    assert ("src/pkg/sub/deep.py", "src/pkg/util.py") in e
    assert ("tests/test_core.py", "src/pkg/core.py") in e
    assert ("tests/test_core.py", "src/pkg/util.py") in e
    assert not any(t == "os" for _, t in e)


def test_js_ts_relative_index_and_aliases():
    files = {
        "tsconfig.json": '{\n // comment\n "compilerOptions": {"baseUrl": ".", "paths": {"@/*": ["./src/*"]},},\n}',
        "src/app/page.tsx": "import { Button } from '@/components/button'\nimport x from '../lib'\nimport './styles.css'\nimport React from 'react'",
        "src/components/button.tsx": "export const Button = 1",
        "src/lib/index.ts": "const a = require('./helper.js')\nexport * from './types'",
        "src/lib/helper.ts": "",
        "src/lib/types.ts": "",
        "src/app/styles.css": "@import './base.css';",
        "src/app/base.css": "",
    }
    e = edges(files)
    assert ("src/app/page.tsx", "src/components/button.tsx") in e
    assert ("src/app/page.tsx", "src/lib/index.ts") in e
    assert ("src/app/page.tsx", "src/app/styles.css") in e
    assert ("src/lib/index.ts", "src/lib/helper.ts") in e  # .js import of a .ts file
    assert ("src/lib/index.ts", "src/lib/types.ts") in e
    assert ("src/app/styles.css", "src/app/base.css") in e


def test_go_java_rust_c():
    files = {
        "go.mod": "module github.com/me/app\n\ngo 1.22\n",
        "main.go": 'package main\n\nimport (\n\t"fmt"\n\t"github.com/me/app/internal/db"\n)\n',
        "internal/db/db.go": "package db",
        "internal/db/db_test.go": "package db",
        "src/main/java/com/me/App.java": "import com.me.util.Strings;\nimport java.util.List;",
        "src/main/java/com/me/util/Strings.java": "",
        "src/lib.rs": "mod parser;\npub mod io;\nuse crate::io::reader::Reader;",
        "src/parser.rs": "use super::io;",
        "src/io/mod.rs": "pub mod reader;",
        "src/io/reader.rs": "",
        "lib/a.c": '#include "a.h"\n#include <stdio.h>\n#include "util/b.h"',
        "lib/a.h": "",
        "include/util/b.h": "",
    }
    e = edges(files)
    assert ("main.go", "internal/db/db.go") in e
    assert ("main.go", "internal/db/db_test.go") not in e
    assert ("src/main/java/com/me/App.java", "src/main/java/com/me/util/Strings.java") in e
    assert ("src/lib.rs", "src/parser.rs") in e
    assert ("src/lib.rs", "src/io/mod.rs") in e
    assert ("src/lib.rs", "src/io/reader.rs") in e
    assert ("src/io/mod.rs", "src/io/reader.rs") in e
    assert ("lib/a.c", "lib/a.h") in e
    assert ("lib/a.c", "include/util/b.h") in e


def test_language_and_keep():
    assert language("a/b.tsx") == "TypeScript"
    assert language("x/Dockerfile") == "Config"
    assert language("types.d.ts") == "TypeScript"
    assert not keep("node_modules/x/index.js", b"x")
    assert not keep("logo.png", b"x")
    assert not keep("package-lock.json", b"{}")
    assert not keep("data.txt", b"ab\0cd")
    assert keep("src/main.py", b"print(1)")


def test_snapshot_shape_and_cap(monkeypatch):
    from app import analyze

    raw = {f"src/m{i}.py": f"import m{i+1}\n".encode() for i in range(10)}
    raw["README.md"] = b"# hi\n\ntext\n"
    snap, texts = build_snapshot({"slug": "a/b", "sha": "0" * 40}, raw)
    assert snap["totals"]["files"] == 11
    assert snap["totals"]["edges"] == 9
    assert snap["files"][0]["path"] == "README.md" and snap["files"][0]["loc"] == 2
    monkeypatch.setattr(analyze, "settings", type("S", (), {"max_files": 5})())
    snap, _ = build_snapshot({"slug": "a/b", "sha": "0" * 40}, raw)
    assert snap["totals"]["files"] == 5 and snap["skipped_files"] == 6
    assert all(f["lang"] == "Python" for f in snap["files"])  # code is kept first
