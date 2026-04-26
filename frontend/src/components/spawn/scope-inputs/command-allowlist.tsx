"use client";

import { PatternListInput } from "./pattern-list-input";

const MAX_PATTERNS = 64;
const MAX_PATTERN_LEN = 200;

export function validateCommandAllowlist(
  patterns: ReadonlyArray<string>,
): string | null {
  if (patterns.length > MAX_PATTERNS) {
    return `At most ${MAX_PATTERNS} patterns.`;
  }
  for (const p of patterns) {
    if (p.length === 0) return "Empty pattern.";
    if (p.length > MAX_PATTERN_LEN) {
      return `Pattern exceeds ${MAX_PATTERN_LEN} characters.`;
    }
    try {
      new RegExp(p);
    } catch {
      return `Invalid regex: ${p}`;
    }
  }
  return null;
}

export function CommandAllowlistInput(props: {
  value: ReadonlyArray<string>;
  onChange: (next: string[]) => void;
  error?: string;
}) {
  return (
    <PatternListInput
      label="[ COMMAND ALLOWLIST ]"
      hint="One regex per line — e.g. ^ls(\\s|$), ^git\\s+log. An empty list denies every shell call (default-deny)."
      placeholder={"^ls(\\s|$)\n^git\\s+log"}
      {...props}
    />
  );
}
