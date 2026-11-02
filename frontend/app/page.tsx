"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";

import { ArrowRight, Logo } from "@/components/Icons";

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
      <div className="home-inner">
        <div className="home-brand">
          <Logo size={34} />
          <span>Repo Atlas</span>
        </div>
        <h1>Understand any codebase in a minute.</h1>
        <p className="home-sub">
          Paste a GitHub repo and get a simple diagram of its main parts and how they depend on each other, with a plain-English
          explanation of each one. Click into any part to go a level deeper, or ask a question about the code.
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
            <strong>See the big picture</strong>
            <span>The main parts of the repo as boxes, with arrows for what uses what.</span>
          </li>
          <li>
            <strong>Read it in plain English</strong>
            <span>AI explains what the repo does and what each part is for.</span>
          </li>
          <li>
            <strong>Go one level deeper</strong>
            <span>Open any folder to see its own parts, down to single files.</span>
          </li>
          <li>
            <strong>Ask about the code</strong>
            <span>An agent reads the code to answer and highlights the parts it means.</span>
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
