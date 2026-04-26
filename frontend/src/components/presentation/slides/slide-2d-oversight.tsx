"use client";

import { useEffect, useState } from "react";

type AgentRow = {
  name: string;
  owner: string;
  tools: string;
  access: string;
  audit: string;
};

const ROWS: readonly AgentRow[] = [
  { name: "alice-hermes-01", owner: "Alice M.",  tools: "???", access: "???", audit: "never"        },
  { name: "bob-agent-02",    owner: "Bob K.",    tools: "???", access: "???", audit: "never"        },
  { name: "ops-bot-03",      owner: "IT Team",   tools: "???", access: "???", audit: "8 months ago" },
  { name: "sales-gpt-04",    owner: "???",       tools: "???", access: "???", audit: "never"        },
  { name: "data-agent-05",   owner: "Dana P.",   tools: "???", access: "???", audit: "unknown"      },
];

const COLS = ["AGENT", "OWNER", "TOOLS", "ACCESS", "LAST AUDIT"] as const;

export function SlideOversight() {
  const [revealed, setRevealed] = useState(0);

  useEffect(() => {
    const timers = ROWS.map((_, i) =>
      window.setTimeout(() => setRevealed((prev) => Math.max(prev, i + 1)), 250 + i * 200),
    );
    return () => timers.forEach(window.clearTimeout);
  }, []);

  const accentColor = "hsl(var(--feature-adapter))";

  return (
    <div className="flex size-full min-h-[70vh] w-full max-w-5xl flex-col items-center justify-between py-8">
      {/* Title */}
      <div className="flex flex-col items-center gap-3">
        <p className="font-display text-[11px] uppercase tracking-widest" style={{ color: accentColor }}>
          [ PROBLEM 4 OF 4 ]
        </p>
        <h2 className="text-center font-display text-3xl font-black uppercase tracking-[0.15em] text-foreground sm:text-5xl">
          Who has what?
          <br />
          <span className="text-muted-foreground">Nobody knows.</span>
        </h2>
      </div>

      {/* Fleet table */}
      <div className="w-full border border-border/60 bg-black/40 backdrop-blur-sm">
        {/* Header */}
        <div className="grid grid-cols-5 border-b border-border/50 bg-black/30 px-5 py-3">
          {COLS.map((col) => (
            <span key={col} className="font-display text-[15px] uppercase tracking-widest text-muted-foreground/55">
              {col}
            </span>
          ))}
        </div>

        {/* Data rows */}
        {ROWS.map((row, i) => (
          <div
            key={row.name}
            className="grid grid-cols-5 items-center border-b border-border/25 px-5 py-4 last:border-0"
            style={{ opacity: i < revealed ? 1 : 0, transition: "opacity 350ms" }}
          >
            <span className="font-mono text-[21px] text-foreground/85">{row.name}</span>
            <span className="font-mono text-[21px] text-foreground/60">{row.owner}</span>
            <span className="font-mono text-[21px] font-bold" style={{ color: `hsl(var(--feature-adapter) / 0.75)` }}>
              {row.tools}
            </span>
            <span className="font-mono text-[21px] font-bold" style={{ color: `hsl(var(--feature-adapter) / 0.75)` }}>
              {row.access}
            </span>
            <span className="font-mono text-[21px]" style={{ color: `hsl(var(--feature-adapter) / 0.65)` }}>
              {row.audit}
            </span>
          </div>
        ))}

        {/* Scale row */}
        <div
          className="border-t border-border/40 bg-black/20 px-5 py-3"
          style={{ opacity: revealed >= ROWS.length ? 1 : 0, transition: "opacity 400ms 100ms" }}
        >
          <span className="font-mono text-[21px] italic" style={{ color: `hsl(var(--feature-adapter) / 0.45)` }}>
            + 245 more agents · all unknown
          </span>
        </div>
      </div>

      {/* Footer */}
      <p className="font-mono text-sm uppercase tracking-wider text-muted-foreground">
        no central registry · no audit trail · requires deep technical knowledge
      </p>
    </div>
  );
}
