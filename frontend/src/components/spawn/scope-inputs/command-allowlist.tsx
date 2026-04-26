"use client";

import { PatternListInput } from "./pattern-list-input";

const MAX_PATTERNS = 64;
const MAX_PATTERN_LEN = 200;

/**
 * RE2-incompatible regex constructs the BE will reject. The Go side uses
 * `regexp.Compile` which is RE2 — no backreferences, no lookahead/lookbehind.
 * JavaScript's `RegExp` accepts these constructs, so without this preflight
 * a user pattern like `(?=foo)bar` would pass the FE check and fail at save.
 *
 * The check is intentionally a string-level shape filter (not a true RE2
 * parse): it catches the common drift cases (`(?=`, `(?!`, `(?<=`, `(?<!`,
 * and `\1`–`\9` backreferences) and lets exotic-but-valid RE2 patterns
 * through. False-positives are recoverable via a clearer save error; the
 * goal is to spare operators the round-trip on the typical drift case.
 */
const RE2_INCOMPATIBLE = [
  { fragment: "(?=", label: "lookahead" },
  { fragment: "(?!", label: "negative lookahead" },
  { fragment: "(?<=", label: "lookbehind" },
  { fragment: "(?<!", label: "negative lookbehind" },
];
const BACKREF_RE = /\\[1-9]/;

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
    for (const c of RE2_INCOMPATIBLE) {
      if (p.includes(c.fragment)) {
        return `RE2 (server-side) does not support ${c.label} (\`${c.fragment}…\`) — found in: ${p}`;
      }
    }
    if (BACKREF_RE.test(p)) {
      return `RE2 (server-side) does not support backreferences (\\1–\\9) — found in: ${p}`;
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
      hint="One regex per line — Go RE2 syntax (no lookahead/lookbehind, no backreferences). Examples: ^ls(\\s|$), ^git\\s+log. An empty list denies every shell call (default-deny)."
      placeholder={"^ls(\\s|$)\n^git\\s+log"}
      {...props}
    />
  );
}
