"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";

import { ArrowRight, Logo } from "@/components/Icons";
import ThemeToggle from "@/components/ThemeToggle";

const EXAMPLES = [
  "pallets/flask",
  "expressjs/express",
  "gin-gonic/gin",
  "fastapi/fastapi",
  "porouscoin/break-my-agent",
];

function toSlug(text: string): string | null {
  const t = text
    .trim()
    .replace(/^(https?:\/\/)?(www\.)?github\.com\//, "")
    .split(/[?#]/)[0]
    .replace(/\/+$/, "");
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
      setError(
        "Paste a GitHub repo, like vercel/next.js or its github.com link.",
      );
      return;
    }
    router.push(`/r/${slug}`);
  };

  return (
    <main className="home">
      <nav className="home-nav">
        <div className="home-brand">
          <Logo size={30} />
          <span>Repo Atlas</span>
        </div>
        <ThemeToggle />
      </nav>
      <div className="home-inner">
        <section className="hero">
          <div>
            <h1>Understand any codebase in a minute.</h1>
            <p className="home-sub">
              Paste a GitHub repo and get a clear diagram of its main parts and
              how they depend on each other, with a plain-English explanation of
              each one.
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
                aria-label="GitHub repo"
              />
              <button type="submit">
                Map it <ArrowRight size={17} />
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
          </div>
          <Sample />
        </section>
        <ul className="features">
          <li>
            <strong>See the big picture</strong>
            <span>
              The main parts of the repo as boxes, with arrows for what uses
              what.
            </span>
          </li>
          <li>
            <strong>Read it in plain English</strong>
            <span>
              AI explains what the repo does and what each part is for.
            </span>
          </li>
          <li>
            <strong>Go one level deeper</strong>
            <span>
              Open any folder to see its own parts, down to single files.
            </span>
          </li>
          <li>
            <strong>Ask about the code</strong>
            <span>
              An agent reads the code to answer and highlights the parts it
              means.
            </span>
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

// A small static example of what a map looks like.
function Sample() {
  const cards = [
    {
      x: 24,
      y: 36,
      name: "web/",
      role: "The pages people see and click through.",
      meta: "48 files · 6.2k lines",
      color: "#7891a8",
      start: true,
    },
    {
      x: 264,
      y: 36,
      name: "api/",
      role: "Handles requests, sign-in and payments.",
      meta: "31 files · 4.8k lines",
      color: "#6f9c7e",
    },
    {
      x: 144,
      y: 236,
      name: "core/",
      role: "Shared models and business rules.",
      meta: "22 files · 3.1k lines",
      color: "#6f9c7e",
    },
  ];
  return (
    <div className="sample" aria-hidden>
      <div className="sample-inner">
        <svg
          width="480"
          height="400"
          style={{ position: "absolute", inset: 0 }}
        >
          <defs>
            <marker
              id="sample-arrow"
              viewBox="0 0 10 10"
              refX="9"
              refY="5"
              markerWidth="11"
              markerHeight="11"
              markerUnits="userSpaceOnUse"
              orient="auto"
            >
              <path d="M0 1L10 5L0 9z" fill="context-stroke" />
            </marker>
          </defs>
          <g
            fill="none"
            stroke="var(--arrow)"
            strokeWidth="2"
            strokeLinejoin="round"
          >
            <path
              d="M120 156 V186 Q120 196 130 196 H206 Q216 196 216 206 V236"
              markerEnd="url(#sample-arrow)"
            />
            <path
              d="M360 156 V186 Q360 196 350 196 H274 Q264 196 264 206 V236"
              markerEnd="url(#sample-arrow)"
            />
          </g>
        </svg>
        {cards.map((c) => (
          <div
            key={c.name}
            className="card folder"
            style={{
              left: c.x,
              top: c.y,
              width: 192,
              height: 120,
              ["--card-color" as string]: c.color,
            }}
          >
            <div className="card-top">
              <span className="card-name">{c.name}</span>
              {c.start && <span className="start-tag">Start here</span>}
            </div>
            <p className="card-role">{c.role}</p>
            <div className="card-meta">
              <span>{c.meta}</span>
            </div>
          </div>
        ))}
      </div>
      <p className="sample-caption">Arrows point to the parts each one uses.</p>
    </div>
  );
}
