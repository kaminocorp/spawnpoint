"use client";

import { PatternListInput } from "./pattern-list-input";

const MAX_PATTERNS = 64;
const MAX_PATTERN_LEN = 200;

export function validateUrlAllowlist(patterns: ReadonlyArray<string>): string | null {
  if (patterns.length > MAX_PATTERNS) {
    return `At most ${MAX_PATTERNS} patterns.`;
  }
  for (const p of patterns) {
    if (p.length === 0) return "Empty pattern.";
    if (p.length > MAX_PATTERN_LEN) {
      return `Pattern exceeds ${MAX_PATTERN_LEN} characters.`;
    }
  }
  return null;
}

export function UrlAllowlistInput(props: {
  value: ReadonlyArray<string>;
  onChange: (next: string[]) => void;
  error?: string;
}) {
  return (
    <PatternListInput
      label="[ URL ALLOWLIST ]"
      hint="One glob per line — e.g. *.acme.com, wiki.example.org/*. An empty list denies every URL (default-deny)."
      placeholder={"*.acme.com\nwiki.example.org/*"}
      {...props}
    />
  );
}
