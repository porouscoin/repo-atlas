"""Find which files import which, with plain regexes per language.

Not a compiler: the goal is a map that is right for the common cases. An
import that can't be matched to a file in the repo (a package from npm or
PyPI, the standard library) is simply skipped, so the edges only ever join
two files that both exist.
"""

import json
import posixpath
import re
from collections import defaultdict

LANGS = {
    ".py": "Python",
    ".pyi": "Python",
    ".js": "JavaScript",
    ".jsx": "JavaScript",
    ".mjs": "JavaScript",
    ".cjs": "JavaScript",
    ".ts": "TypeScript",
    ".tsx": "TypeScript",
    ".mts": "TypeScript",
    ".cts": "TypeScript",
    ".vue": "Vue",
    ".svelte": "Svelte",
    ".go": "Go",
    ".rs": "Rust",
    ".java": "Java",
    ".kt": "Kotlin",
    ".kts": "Kotlin",
    ".scala": "Scala",
    ".c": "C",
    ".h": "C",
    ".cc": "C++",
    ".cpp": "C++",
    ".cxx": "C++",
    ".hpp": "C++",
    ".hh": "C++",
    ".cs": "C#",
    ".rb": "Ruby",
    ".php": "PHP",
    ".swift": "Swift",
    ".dart": "Dart",
    ".lua": "Lua",
    ".ex": "Elixir",
    ".exs": "Elixir",
    ".zig": "Zig",
    ".sh": "Shell",
    ".bash": "Shell",
    ".sql": "SQL",
    ".css": "CSS",
    ".scss": "CSS",
    ".sass": "CSS",
    ".less": "CSS",
    ".html": "HTML",
    ".md": "Markdown",
    ".mdx": "Markdown",
    ".rst": "Markdown",
    ".json": "Config",
    ".yaml": "Config",
    ".yml": "Config",
    ".toml": "Config",
    ".ini": "Config",
    ".cfg": "Config",
}

SPECIAL_NAMES = {"Dockerfile": "Config", "Makefile": "Config", "Rakefile": "Ruby", "Gemfile": "Ruby"}

JS_LIKE = {"JavaScript", "TypeScript", "Vue", "Svelte"}
JS_EXTS = [".ts", ".tsx", ".js", ".jsx", ".mjs", ".cjs", ".mts", ".cts", ".vue", ".svelte", ".d.ts"]


def language(path: str) -> str:
    name = path.rsplit("/", 1)[-1]
    if name in SPECIAL_NAMES:
        return SPECIAL_NAMES[name]
    if name.endswith(".d.ts"):
        return "TypeScript"
    dot = name.rfind(".")
    return LANGS.get(name[dot:].lower(), "Other") if dot > 0 else "Other"


# ------------------------------------------------------------------ patterns

PY_IMPORT = re.compile(r"^[ \t]*import[ \t]+([\w., \t]+)", re.M)
PY_FROM = re.compile(r"^[ \t]*from[ \t]+(\.*[\w.]*)[ \t]+import[ \t]+(\([^)]*\)|[\w., \t*]+)", re.M)
JS_FROM = re.compile(r"""(?:import|export)\s[^'"`;]*?\sfrom\s*['"]([^'"]+)['"]""")
JS_BARE = re.compile(r"""^\s*import\s*['"]([^'"]+)['"]""", re.M)
JS_CALL = re.compile(r"""(?:require|import)\s*\(\s*['"]([^'"]+)['"]\s*\)""")
CSS_IMPORT = re.compile(r"""@(?:import|use|forward)\s+(?:url\()?['"]([^'"]+)['"]""")
GO_BLOCK = re.compile(r"^import\s*\((.*?)\)", re.M | re.S)
GO_SINGLE = re.compile(r'^import\s+(?:\w+\s+)?"([^"]+)"', re.M)
GO_PATH = re.compile(r'"([^"]+)"')
JAVA_IMPORT = re.compile(r"^\s*import\s+(?:static\s+)?([\w.]+)\s*;?", re.M)
RUST_MOD = re.compile(r"^\s*(?:pub(?:\([\w ]+\))?\s+)?mod\s+(\w+)\s*;", re.M)
RUST_USE = re.compile(r"^\s*(?:pub(?:\([\w ]+\))?\s+)?use\s+((?:crate|super|self)(?:::\w+)+)", re.M)
C_INCLUDE = re.compile(r'^\s*#\s*include\s*"([^"]+)"', re.M)
RUBY_REL = re.compile(r"""^\s*require_relative\s*\(?\s*['"]([^'"]+)['"]""", re.M)


class Resolver:
    """Built once per repo, then asked for the edges of each file."""

    def __init__(self, files: dict[str, str]):
        # files: path -> text, for every file drawn on the map
        self.files = files
        self.paths = set(files)
        self.dirs: dict[str, list[str]] = defaultdict(list)
        for p in sorted(files):
            self.dirs[posixpath.dirname(p)].append(p)
        self._py_index = self._build_py_index()
        self._suffix_index = self._build_suffix_index()
        self._ts_configs = self._read_ts_configs()
        self._go_module = self._read_go_module()

    # ------------------------------------------------------------ indexes

    def _build_py_index(self) -> dict[str, str]:
        """Dotted module name -> file. A module's name starts below the
        highest folder that is still a package (has an __init__.py), so
        src/flask/app.py is "flask.app", the way Python itself sees it."""
        index: dict[str, str] = {}
        self._py_names: dict[str, str] = {}
        for p in self.paths:
            if not p.endswith((".py", ".pyi")):
                continue
            parts = p[: p.rfind(".")].split("/")
            start = len(parts) - 1
            while start > 0 and "/".join(parts[:start] + ["__init__.py"]) in self.paths:
                start -= 1
            names = parts[start:]
            if names[-1] == "__init__":
                names = names[:-1]
            if names:
                index.setdefault(".".join(names), p)
                self._py_names[p] = ".".join(names)
            index.setdefault(".".join(x for x in parts if x != "__init__"), p)
        return index

    def _build_suffix_index(self) -> dict[str, list[str]]:
        """path suffix without extension -> files, for Java-style and C-style lookups."""
        index: dict[str, list[str]] = defaultdict(list)
        for p in self.paths:
            parts = p.split("/")
            for i in range(len(parts)):
                index["/".join(parts[i:])].append(p)
        return index

    def _read_ts_configs(self) -> list[tuple[str, str, list[tuple[str, list[str]]]]]:
        """(folder, baseUrl, [(alias pattern, targets)]) for each tsconfig/jsconfig."""
        configs = []
        for p in self.paths:
            name = p.rsplit("/", 1)[-1]
            if not (name.startswith(("tsconfig", "jsconfig")) and name.endswith(".json")):
                continue
            data = _loose_json(self.files.get(p, ""))
            options = (data or {}).get("compilerOptions") or {}
            folder = posixpath.dirname(p)
            base = posixpath.normpath(posixpath.join(folder, options.get("baseUrl") or "."))
            base = "" if base == "." else base
            aliases = [(k, v) for k, v in (options.get("paths") or {}).items() if isinstance(v, list)]
            if options.get("baseUrl") or aliases:
                configs.append((folder, base, aliases))
        configs.sort(key=lambda c: -len(c[0]))  # nearest folder first
        return configs

    def _read_go_module(self) -> tuple[str, str] | None:
        for p in sorted(self.paths, key=len):
            if p.rsplit("/", 1)[-1] == "go.mod":
                m = re.search(r"^module\s+(\S+)", self.files.get(p, ""), re.M)
                if m:
                    return m.group(1), posixpath.dirname(p)
        return None

    # ------------------------------------------------------------ helpers

    def _first(self, *candidates: str) -> str | None:
        for c in candidates:
            c = posixpath.normpath(c)
            if c in self.paths:
                return c
        return None

    def _js_file(self, base: str) -> str | None:
        base = posixpath.normpath(base)
        if base.startswith(".."):
            return None
        stem = re.sub(r"\.(m|c)?jsx?$", "", base)  # "./util.js" can mean util.ts
        candidates = [base]
        for s in {base, stem}:
            candidates += [s + e for e in JS_EXTS]
            candidates += [f"{s}/index{e}" for e in JS_EXTS]
        return self._first(*candidates)

    # ------------------------------------------------------------ languages

    def imports_of(self, path: str) -> list[str]:
        text = self.files.get(path) or ""
        lang = language(path)
        try:
            if lang == "Python":
                found = self._python(path, text)
            elif lang in JS_LIKE:
                found = self._js(path, text)
            elif lang == "CSS":
                found = [self._js_file(posixpath.join(posixpath.dirname(path), s)) for s in CSS_IMPORT.findall(text)]
            elif lang == "Go":
                found = self._go(path, text)
            elif lang in ("Java", "Kotlin", "Scala"):
                found = self._java(text)
            elif lang == "Rust":
                found = self._rust(path, text)
            elif lang in ("C", "C++"):
                found = self._c(path, text)
            elif lang == "Ruby":
                d = posixpath.dirname(path)
                found = [self._first(posixpath.join(d, s), posixpath.join(d, s + ".rb")) for s in RUBY_REL.findall(text)]
            else:
                found = []
        except Exception:
            found = []
        out, seen = [], {path}
        for f in found:
            if f and f not in seen:
                seen.add(f)
                out.append(f)
        return out

    def _python(self, path: str, text: str) -> list[str | None]:
        out: list[str | None] = []
        for m in PY_IMPORT.finditer(text):
            for name in m.group(1).split(","):
                name = name.strip().split(" ")[0]
                out.append(self._py_module(name))
        own_package = self._py_package_of(path)
        for m in PY_FROM.finditer(text):
            module, names = m.group(1), m.group(2)
            if module.startswith("."):
                dots = len(module) - len(module.lstrip("."))
                pkg = own_package.split(".") if own_package else []
                pkg = pkg[: len(pkg) - (dots - 1)] if dots > 1 else pkg
                rest = module.lstrip(".")
                module = ".".join(pkg + ([rest] if rest else []))
            hit = False
            for n in re.split(r"[,\s]+", names):
                n = n.strip("() \n")
                if n and n != "*" and n != "as":
                    sub = self._py_module(f"{module}.{n}" if module else n)
                    if sub:
                        out.append(sub)
                        hit = True
            if not hit and module:
                out.append(self._py_module(module))
        return out

    def _py_package_of(self, path: str) -> str:
        own = self._py_names.get(path, "")
        if path.endswith("__init__.py"):
            return own
        return own.rsplit(".", 1)[0] if "." in own else ""

    def _py_module(self, name: str) -> str | None:
        while name:
            if name in self._py_index:
                return self._py_index[name]
            if "." not in name:
                return None
            name = name.rsplit(".", 1)[0]
        return None

    def _js(self, path: str, text: str) -> list[str | None]:
        specs = JS_FROM.findall(text) + JS_BARE.findall(text) + JS_CALL.findall(text)
        here = posixpath.dirname(path)
        out = []
        for s in specs:
            if s.startswith("."):
                out.append(self._js_file(posixpath.join(here, s)))
                continue
            out.append(self._js_alias(path, s))
        return out

    def _js_alias(self, path: str, spec: str) -> str | None:
        for folder, base, aliases in self._ts_configs:
            if folder and not path.startswith(folder + "/"):
                continue
            for pattern, targets in aliases:
                if pattern.endswith("*"):
                    prefix = pattern[:-1]
                    if not spec.startswith(prefix):
                        continue
                    rest = spec[len(prefix) :]
                else:
                    if spec != pattern:
                        continue
                    rest = ""
                for t in targets:
                    hit = self._js_file(posixpath.join(base, t.replace("*", rest)))
                    if hit:
                        return hit
            if base:
                hit = self._js_file(posixpath.join(base, spec))
                if hit:
                    return hit
        if spec.startswith(("@/", "~/")):  # the common default when no config says otherwise
            for root in ("src", ""):
                hit = self._js_file(posixpath.join(root, spec[2:]))
                if hit:
                    return hit
        return None

    def _go(self, path: str, text: str) -> list[str | None]:
        if not self._go_module:
            return []
        module, root = self._go_module
        specs = GO_SINGLE.findall(text)
        for block in GO_BLOCK.findall(text):
            specs += GO_PATH.findall(block)
        out = []
        for s in specs:
            if s != module and not s.startswith(module + "/"):
                continue
            folder = posixpath.normpath(posixpath.join(root, s[len(module) + 1 :]))
            folder = "" if folder == "." else folder
            files = [f for f in self.dirs.get(folder, []) if f.endswith(".go") and not f.endswith("_test.go")]
            out += files[:6]  # a Go import is a whole package; link a few of its files
        return out

    def _java(self, text: str) -> list[str | None]:
        out = []
        for name in JAVA_IMPORT.findall(text):
            if name.endswith(".*"):
                continue
            key = name.replace(".", "/")
            for ext in (".java", ".kt", ".scala"):
                hits = self._suffix_index.get(key + ext)
                if hits and len(hits) == 1:
                    out.append(hits[0])
                    break
        return out

    def _rust(self, path: str, text: str) -> list[str | None]:
        here = posixpath.dirname(path)
        name = path.rsplit("/", 1)[-1]
        mod_dir = here if name in ("mod.rs", "lib.rs", "main.rs") else posixpath.join(here, name[:-3])
        out: list[str | None] = []
        for m in RUST_MOD.findall(text):
            out.append(self._first(posixpath.join(mod_dir, m + ".rs"), posixpath.join(mod_dir, m, "mod.rs")))
        crate_root = here
        while crate_root and not (
            posixpath.join(crate_root, "lib.rs") in self.paths or posixpath.join(crate_root, "main.rs") in self.paths
        ):
            crate_root = posixpath.dirname(crate_root)
        for use in RUST_USE.findall(text):
            parts = use.split("::")
            start = {"crate": crate_root, "self": mod_dir, "super": posixpath.dirname(mod_dir)}[parts[0]]
            segs = parts[1:]
            for k in range(len(segs), 0, -1):
                base = posixpath.join(start, *segs[:k])
                hit = self._first(base + ".rs", posixpath.join(base, "mod.rs"))
                if hit:
                    out.append(hit)
                    break
        return out

    def _c(self, path: str, text: str) -> list[str | None]:
        here = posixpath.dirname(path)
        out = []
        for inc in C_INCLUDE.findall(text):
            hit = self._first(posixpath.join(here, inc))
            if not hit:
                hits = self._suffix_index.get(posixpath.normpath(inc))
                hit = hits[0] if hits and len(hits) == 1 else None
            out.append(hit)
        return out


def _loose_json(text: str) -> dict | None:
    """tsconfig allows comments and trailing commas; strip them before parsing."""
    text = re.sub(r'("(?:\\.|[^"\\])*")|//[^\n]*|/\*.*?\*/', lambda m: m.group(1) or "", text, flags=re.S)
    text = re.sub(r",(\s*[}\]])", r"\1", text)
    try:
        data = json.loads(text)
        return data if isinstance(data, dict) else None
    except json.JSONDecodeError:
        return None
