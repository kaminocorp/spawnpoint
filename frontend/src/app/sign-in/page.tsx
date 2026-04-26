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

      <div className="relative w-full max-w-sm">
        {/*
         * Refraction halo — sits behind the card, picks up the swarm
         * canvas via backdrop-filter (blur + saturation amplification),
         * and fades to transparent past the card's edge via a radial
         * mask. Bright particle clusters passing behind the card region
         * smear into a colored bloom around the card's perimeter — the
         * "light fracturing" register. -z-[1] places it above the
         * swarm (-z-10) and the readability vignette (-z-[5]) so its
         * backdrop-filter has both to work with, but below the card
         * itself (z-auto in normal flow). The wrapper is position:
         * relative without z-index, so it does not establish a
         * stacking context — the halo participates in the root
         * stacking context at depth -1.
         */}
        <div
          aria-hidden
          className="pointer-events-none absolute -inset-12 -z-[1]"
          style={{
            backdropFilter: "blur(40px) saturate(200%)",
            WebkitBackdropFilter: "blur(40px) saturate(200%)",
            maskImage:
              "radial-gradient(ellipse at center, rgba(0,0,0,0.85) 30%, transparent 75%)",
            WebkitMaskImage:
              "radial-gradient(ellipse at center, rgba(0,0,0,0.85) 30%, transparent 75%)",
          }}
        />
        <TerminalContainer
          title="AUTHENTICATE"
          className="border-white/15! bg-black/40! shadow-[0_8px_32px_rgba(0,0,0,0.6),inset_0_1px_0_rgba(255,255,255,0.08)] backdrop-blur-2xl backdrop-saturate-150"
        >
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
