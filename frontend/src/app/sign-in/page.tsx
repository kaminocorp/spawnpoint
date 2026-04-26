"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";

import { SwarmBackground } from "@/components/sign-in/swarm-background";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { TerminalContainer } from "@/components/ui/terminal-container";
import { createClient } from "@/lib/supabase/client";

export default function SignInPage() {
  const router = useRouter();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [err, setErr] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    setErr(null);
    setSubmitting(true);
    const supabase = createClient();
    const { error } = await supabase.auth.signInWithPassword({ email, password });
    if (error) {
      setErr(error.message);
      setSubmitting(false);
      return;
    }
    router.replace("/dashboard");
  }

  return (
    <main className="relative flex min-h-screen flex-col items-center justify-center gap-8 p-8">
      <SwarmBackground />
      {/*
       * Radial vignette — readability floor for the form. Sits between
       * the swarm canvas (-z-10) and the form's normal stacking
       * context. Worst-case scenario covered: an octahedron rotating
       * such that an edge projects through the form's centre; the
       * vignette absorbs the contrast hit. Tuning dial in Phase 7
       * (raise the 0.6 alpha if the form ever struggles).
       */}
      <div
        aria-hidden
        className="pointer-events-none fixed inset-0 -z-[5]"
        style={{
          background:
            "radial-gradient(circle at center, rgba(0,0,0,0.6) 0%, rgba(0,0,0,0) 60%)",
        }}
      />

      <header className="flex flex-col items-center gap-2">
        <div className="flex items-center gap-3">
          <span
            className="font-display text-2xl text-[hsl(var(--status-running))]"
            aria-hidden
          >
            ›
          </span>
          <h1 className="font-display text-3xl font-bold uppercase tracking-[0.3em] text-foreground">
            CORELLIA
          </h1>
        </div>
        <p className="font-display text-[10px] uppercase tracking-widest text-muted-foreground">
          CONTROL PLANE — AGENT FLEET
        </p>
      </header>

      <div className="w-full max-w-sm">
        <TerminalContainer title="AUTHENTICATE">
          <form
            onSubmit={onSubmit}
            className="space-y-4"
            aria-label="Sign in"
          >
            <div className="space-y-1.5">
              <Label htmlFor="email">EMAIL</Label>
              <Input
                id="email"
                type="email"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                disabled={submitting}
                required
              />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="password">PASSPHRASE</Label>
              <Input
                id="password"
                type="password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                disabled={submitting}
                required
              />
            </div>
            {err && (
              <p className="font-mono text-[11px] text-[hsl(var(--status-failed))]">
                ERR — {err}
              </p>
            )}
            <Button
              type="submit"
              size="lg"
              className="w-full"
              disabled={submitting}
            >
              {submitting ? "› AUTHENTICATING…" : "› AUTHENTICATE"}
            </Button>
          </form>
        </TerminalContainer>
      </div>
    </main>
  );
}
