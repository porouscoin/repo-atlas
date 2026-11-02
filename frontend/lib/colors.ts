// Language colors: muted, earthy tones that sit well on graphite and on paper,
// kept apart from each other and from the ochre accent. Only one or two blues.
export const LANG_COLORS: Record<string, string> = {
  Python: "#6f9c7e",
  TypeScript: "#7891a8",
  JavaScript: "#c9ab4e",
  Go: "#5b9b94",
  Rust: "#c26d48",
  Java: "#b08452",
  Kotlin: "#957aab",
  Scala: "#b65a60",
  C: "#8e9397",
  "C++": "#a7678a",
  "C#": "#7a9c5c",
  Ruby: "#ad5056",
  PHP: "#8784ab",
  Swift: "#c87f4c",
  Dart: "#5d93a0",
  Lua: "#7277a6",
  Elixir: "#8e70a6",
  Zig: "#c39a45",
  Vue: "#62a07e",
  Svelte: "#c4663f",
  CSS: "#a0709f",
  HTML: "#c3714f",
  Shell: "#8e9c58",
  SQL: "#b59a5f",
  Markdown: "#8a8478",
  Config: "#a39d90",
  Other: "#6f6a60",
};

export function langColor(lang: string): string {
  return LANG_COLORS[lang] || LANG_COLORS.Other;
}
