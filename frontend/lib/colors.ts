// Language colors, tuned to glow on a dark background and stay apart from each other.
export const LANG_COLORS: Record<string, string> = {
  TypeScript: "#38c8ff",
  JavaScript: "#ffd84d",
  Python: "#7c8cff",
  Go: "#22d3c5",
  Rust: "#ff7a45",
  Java: "#f5a524",
  Kotlin: "#b57bff",
  Scala: "#ff4f5e",
  C: "#9fb3c8",
  "C++": "#ff5c9a",
  "C#": "#5ee87d",
  Ruby: "#ff3d5a",
  PHP: "#9aa5ff",
  Swift: "#ff8c42",
  Dart: "#3fe0ff",
  Lua: "#6f7dff",
  Elixir: "#b083ff",
  Zig: "#f7a41d",
  Vue: "#42d392",
  Svelte: "#ff5a1f",
  CSS: "#d26bff",
  HTML: "#ff6f3c",
  Shell: "#a6e65a",
  SQL: "#e8b03d",
  Markdown: "#8792a8",
  Config: "#5f6a80",
  Other: "#4a5263",
};

export function langColor(lang: string): string {
  return LANG_COLORS[lang] || LANG_COLORS.Other;
}

export const IMPORTS_COLOR = "#5ad1ff"; // files the selected file imports
export const IMPORTERS_COLOR = "#ff9d5c"; // files that import the selected file
