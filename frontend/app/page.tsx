"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";

import { ArrowRight, Logo } from "@/components/Icons";
import Starfield from "@/components/Starfield";

const EXAMPLES = ["pallets/flask", "expressjs/express", "gin-gonic/gin", "fastapi/fastapi", "porouscoin/break-my-agent"];

function toSlug(text: string): string | null {
  const t = text.trim().replace(/^(https?:\/\/)?(www\.)?github\.com\//, "").split(/[?#]/)[0].replace(/\/+$/, "");
  const [owner, repo] = t.split("/");
  if (!owner || !repo) return null;
  const slug = `${owner}/${repo.replace(/\.git$/, "")}`;
  return /^[A-Za-z0-9-]{1,39}\/[A-Za-z0-9._-]{1,100}$/.test(slug) ? slug : null;
}

export default function Home() {
  const router = useRouter();
  const [value, setValue] = useState("");
  const [error, setError] = useState("");

  const go = (text: string) => {
    const slug = toSlug(text);
    if (!slug) {
      setError("Paste a GitHub repo, like vercel/next.js or its github.com link.");
      return;
    }
    router.push(`/r/${slug}`);
  };

  return (
    <main className="home">
      <Starfield />
      <div className="home-inner">
        <div className="home-brand">
          <Logo size={34} />
          <span>Repo Atlas</span>
        </div>
        <h1>
          Fly through any codebase
          <br />
          like it&apos;s a galaxy.
        </h1>
        <p className="home-sub">
          Every file is a star, sized by its lines and colored by language. Folders pull into clusters and imports become threads
          between them. Ask a question and an AI guide reads the code, then lights up the answer on the map.
        </p>
        <form
          className="home-form"
          onSubmit={(e) => {
            e.preventDefault();
            go(value);
          }}
        >
          <input
            value={value}
            onChange={(e) => {
              setValue(e.target.value);
              setError("");
            }}
            placeholder="github.com/owner/repo"
            autoFocus
            spellCheck={false}
            autoCapitalize="off"
          />
          <button type="submit">
            Map it <ArrowRight size={16} />
          </button>
        </form>
        {error && <p className="home-error">{error}</p>}
        <div className="examples">
          <span>Try</span>
          {EXAMPLES.map((e) => (
            <button key={e} onClick={() => go(e)}>
              {e}
            </button>
          ))}
        </div>
        <ul className="features">
          <li>
            <strong>Galaxy</strong>
            <span>3D map of files and imports. Click a star to see what it imports and what imports it.</span>
          </li>
          <li>
            <strong>Size</strong>
            <span>Nested circles show where the code actually lives.</span>
          </li>
          <li>
            <strong>Time-lapse</strong>
            <span>Replay the last 200 commits and watch the repo grow.</span>
          </li>
          <li>
            <strong>Ask and Tour</strong>
            <span>An agent searches and reads the code, and the camera flies to what it finds.</span>
          </li>
        </ul>
      </div>
      <footer className="home-foot">
        Public repos only. Built by{" "}
        <a href="https://ziyadhisham.com" target="_blank" rel="noreferrer">
          Ziyad Hisham
        </a>
        .
      </footer>
    </main>
  );
}
