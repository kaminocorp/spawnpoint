"use client";

import { useEffect, useState } from "react";

import { cn } from "@/lib/utils";

const TOOLS = [
  { name: "LangGraph", lane: "ORCHESTRATION" },
  { name: "Composio", lane: "TOOL PERMS" },
  { name: "Portkey", lane: "MODEL ROUTING" },
  { name: "LangSmith", lane: "OBSERVABILITY" },
  { name: "Fly / AWS", lane: "DEPLOY" },
] as const;

/**
 * Slide 2 — Problem. "Every tool picks one lane."
 *
 * Five tool labels light up sequentially (200ms stagger), held briefly,
 * then a faint vertical separator paints between each — the "fragmented"
 * register. Click-advance interrupts the animation cleanly; the slide is
 * legible at any frame.
 */
export function SlideProblem() {
  const [lit, setLit] = useState(0);

  useEffect(() => {
    let i = 0;
    const id = setInterval(() => {
      i++;
      setLit(i);
      if (i >= TOOLS.length) clearInterval(id);
    }, 250);
    return () => clearInterval(id);
  }, []);

  return (
    <div className="mx-auto flex w-full max-w-6xl flex-col items-center gap-16">
      <div className="flex flex-col items-center gap-3">
        <p className="font-display text-[11px] uppercase tracking-widest text-muted-foreground">
          [ THE FRAGMENTED LANDSCAPE ]
        </p>
        <h2 className="text-center font-display text-3xl font-black uppercase tracking-[0.15em] text-foreground sm:text-5xl">
          Every tool picks one lane.
        </h2>
      </div>

      <div className="grid w-full grid-cols-1 gap-4 sm:grid-cols-3 lg:grid-cols-5">
        {TOOLS.map((tool, i) => {
          const on = i < lit;
          return (
            <div
              key={tool.name}
              className={cn(
                "flex flex-col items-center gap-2 border px-4 py-6 transition-all duration-500",
                on
                  ? "border-foreground/40 bg-foreground/5"
                  : "border-border/40 opacity-30",
              )}
            >
              <span
                className={cn(
                  "font-mono text-base font-bold transition-colors",
                  on ? "text-foreground" : "text-muted-foreground",
                )}
              >
                {tool.name}
              </span>
              <span className="font-display text-[10px] uppercase tracking-widest text-muted-foreground">
                {tool.lane}
              </span>
            </div>
          );
        })}
      </div>

      <p className="max-w-3xl text-center font-mono text-base leading-relaxed text-foreground/90">
        None unify. None are vendor-neutral. Admins are stuck wiring five planes
        together — and still can&apos;t see what their fleet is doing.
      </p>
    </div>
  );
}
