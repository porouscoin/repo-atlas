export const API = (process.env.NEXT_PUBLIC_API_URL || "http://localhost:8000").replace(/\/$/, "");

export type FileNode = { path: string; lang: string; loc: number; bytes: number };

export type Snapshot = {
  slug: string;
  branch: string;
  sha: string;
  description: string;
  stars: number;
  language: string;
  files: FileNode[];
  edges: [number, number][];
  folders: string[];
  languages: { lang: string; files: number; loc: number }[];
  totals: { files: number; loc: number; edges: number };
  skipped_files: number;
  cached?: boolean;
};

export type CommitFile = { path: string; status: string; prev: string | null; add: number; del: number };
export type Commit = { sha: string; author: string; date: string; message: string; files: CommitFile[] };
export type History = { slug: string; sha: string; commits: Commit[]; limit: number };

export type TourStop = { target: string; title: string; text: string };

export type AskEvent =
  | { type: "tool"; name: string; args: Record<string, unknown>; files: string[] }
  | { type: "answer"; text: string; files: string[]; model?: string }
  | { type: "error"; message: string };

async function asJson<T>(resp: Response): Promise<T> {
  if (!resp.ok) {
    let message = `Something went wrong (${resp.status}).`;
    try {
      const body = await resp.json();
      if (typeof body.detail === "string") message = body.detail;
    } catch {}
    throw new Error(message);
  }
  return resp.json();
}

export async function fetchRepo(slug: string): Promise<Snapshot> {
  return asJson(await fetch(`${API}/api/repo?url=${encodeURIComponent(slug)}`));
}

export async function fetchHistory(slug: string, sha: string): Promise<History> {
  return asJson(await fetch(`${API}/api/history?slug=${encodeURIComponent(slug)}&sha=${sha}`));
}

export async function fetchSummary(slug: string, sha: string, path: string): Promise<string> {
  const r = await asJson<{ summary: string }>(
    await fetch(`${API}/api/summary`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ slug, sha, path }),
    }),
  );
  return r.summary;
}

export async function fetchTour(slug: string, sha: string): Promise<TourStop[]> {
  const r = await asJson<{ stops: TourStop[] }>(
    await fetch(`${API}/api/tour`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ slug, sha }),
    }),
  );
  return r.stops;
}

export async function ask(
  slug: string,
  sha: string,
  question: string,
  history: { role: string; content: string }[],
  onEvent: (e: AskEvent) => void,
): Promise<void> {
  const resp = await fetch(`${API}/api/ask`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ slug, sha, question, history }),
  });
  if (!resp.ok || !resp.body) {
    await asJson(resp);
    return;
  }
  const reader = resp.body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, { stream: true });
    let cut;
    while ((cut = buffer.indexOf("\n\n")) >= 0) {
      const chunk = buffer.slice(0, cut);
      buffer = buffer.slice(cut + 2);
      for (const line of chunk.split("\n")) {
        if (line.startsWith("data: ")) {
          try {
            onEvent(JSON.parse(line.slice(6)));
          } catch {}
        }
      }
    }
  }
}
