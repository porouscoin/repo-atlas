"use client";

import { useEffect, useRef } from "react";

/** A slow, drifting starfield for the landing page, drawn on a 2D canvas. */
export default function Starfield() {
  const ref = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    const canvas = ref.current!;
    const ctx = canvas.getContext("2d")!;
    const colors = ["#38c8ff", "#ffd84d", "#7c8cff", "#22d3c5", "#ff7a45", "#ff5c9a", "#ffffff", "#ffffff", "#ffffff"];
    let w = 0;
    let h = 0;
    let raf = 0;
    const stars = Array.from({ length: 260 }, () => ({
      x: Math.random(),
      y: Math.random(),
      z: Math.random(),
      c: colors[Math.floor(Math.random() * colors.length)],
      p: Math.random() * Math.PI * 2,
    }));
    const resize = () => {
      const dpr = Math.min(window.devicePixelRatio, 2);
      w = canvas.clientWidth;
      h = canvas.clientHeight;
      canvas.width = w * dpr;
      canvas.height = h * dpr;
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    };
    resize();
    window.addEventListener("resize", resize);
    const reduce = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    const draw = (t: number) => {
      ctx.clearRect(0, 0, w, h);
      for (const s of stars) {
        const speed = reduce ? 0 : 0.000006 * (0.3 + s.z);
        s.x = (s.x + speed * 16) % 1;
        const r = 0.4 + s.z * 1.8;
        const tw = 0.55 + 0.45 * Math.sin(t * 0.0012 + s.p);
        const x = s.x * w;
        const y = s.y * h;
        const g = ctx.createRadialGradient(x, y, 0, x, y, r * 4);
        g.addColorStop(0, s.c);
        g.addColorStop(1, "transparent");
        ctx.globalAlpha = (0.25 + s.z * 0.6) * tw;
        ctx.fillStyle = g;
        ctx.beginPath();
        ctx.arc(x, y, r * 4, 0, Math.PI * 2);
        ctx.fill();
      }
      ctx.globalAlpha = 1;
      raf = requestAnimationFrame(draw);
    };
    raf = requestAnimationFrame(draw);
    return () => {
      cancelAnimationFrame(raf);
      window.removeEventListener("resize", resize);
    };
  }, []);

  return <canvas ref={ref} className="starfield" aria-hidden />;
}
