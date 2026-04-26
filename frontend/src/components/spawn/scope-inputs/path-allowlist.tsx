"use client";

import { PatternListInput } from "./pattern-list-input";

const MAX_PATTERNS = 64;
const MAX_PATTERN_LEN = 200;

export function validatePathAllowlist(
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
  }
  return null;
}

export function PathAllowlistInput(props: {
  value: ReadonlyArray<string>;
  onChange: (next: string[]) => void;
  error?: string;
}) {
  return (
    <PatternListInput
      label="[ PATH ALLOWLIST ]"
      hint="Absolute paths or globs, one per line — e.g. /workspace/**, /etc/hosts. An empty list denies every path (default-deny)."
      placeholder={"/workspace/**\n/tmp/*"}
      {...props}
    />
  );
}
