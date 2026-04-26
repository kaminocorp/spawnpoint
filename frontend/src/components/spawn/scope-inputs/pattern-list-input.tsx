"use client";

import { useId } from "react";

/**
 * Shared chrome for the three pattern-list scope shapes (URL allowlist,
 * command allowlist, path allowlist). Multi-line textarea, one entry per
 * line; the parent owns the parsed array and the validation result.
 *
 * Per the Phase 1 default-deny decision, an empty list rejects every call —
 * the helper copy spells this out so an operator who leaves the box blank
 * isn't surprised when the agent can't reach the toolset.
 */
export function PatternListInput({
  label,
  hint,
  value,
  onChange,
  placeholder,
  error,
}: {
  label: string;
  hint: string;
  value: ReadonlyArray<string>;
  onChange: (next: string[]) => void;
  placeholder: string;
  error?: string;
}) {
  const id = useId();
  const text = value.join("\n");
  const count = value.length;

  return (
    <div className="space-y-1.5">
      <label
        htmlFor={id}
        className="flex items-center justify-between font-display text-[11px] uppercase tracking-widest text-muted-foreground/70"
      >
        <span>{label}</span>
        <span className="font-mono text-muted-foreground/50">
          {count} {count === 1 ? "pattern" : "patterns"}
        </span>
      </label>
      <textarea
        id={id}
        value={text}
        onChange={(e) =>
          onChange(
            e.target.value
              .split(/\r?\n/)
              .map((s) => s.trim())
              .filter((s) => s.length > 0),
          )
        }
        placeholder={placeholder}
        rows={3}
        aria-invalid={!!error}
        spellCheck={false}
        className="w-full rounded-sm border border-input bg-background px-2.5 py-1.5 font-mono text-[11px] leading-5 text-foreground placeholder:text-muted-foreground/40 focus:border-primary focus:outline-none focus:ring-1 focus:ring-primary aria-invalid:border-destructive aria-invalid:ring-1 aria-invalid:ring-destructive"
      />
      <p className="text-[11px] leading-5 text-muted-foreground">{hint}</p>
      {error && <p className="text-sm text-destructive">{error}</p>}
    </div>
  );
}
