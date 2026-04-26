"use client";

import { useId } from "react";

import { Input } from "@/components/ui/input";

const MAX_LEN = 200;

export function validateWorkingDirectory(value: string): string | null {
  if (value.length > MAX_LEN) {
    return `Path exceeds ${MAX_LEN} characters.`;
  }
  return null;
}

export function WorkingDirectoryInput({
  value,
  onChange,
  error,
}: {
  value: string;
  onChange: (next: string) => void;
  error?: string;
}) {
  const id = useId();
  return (
    <div className="space-y-1.5">
      <label
        htmlFor={id}
        className="font-display text-[11px] uppercase tracking-widest text-muted-foreground/70"
      >
        [ WORKING DIRECTORY ]
      </label>
      <Input
        id={id}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder="/workspace"
        aria-invalid={!!error}
        spellCheck={false}
        autoComplete="off"
      />
      <p className="text-xs text-muted-foreground">
        Pin the agent&apos;s working directory. Leave blank to allow any
        directory (default-allow).
      </p>
      {error && <p className="text-sm text-destructive">{error}</p>}
    </div>
  );
}
