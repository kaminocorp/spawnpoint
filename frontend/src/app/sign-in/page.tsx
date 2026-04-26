"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import Image from "next/image";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { PearlText } from "@/components/ui/pearl-text";
import { createClient } from "@/lib/supabase/client";

export default function SignInPage() {
  const router = useRouter();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [err, setErr] = useState<string | null>(null);

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    setErr(null);
    const supabase = createClient();
    const { error } = await supabase.auth.signInWithPassword({ email, password });
    if (error) {
      setErr(error.message);
      return;
    }
    router.replace("/dashboard");
  }

  return (
    <main className="halftone-bg relative flex min-h-screen flex-col items-center justify-center gap-10 p-8">
      {/* Vignette: pulls focus to the centered hero. Sign-in is the only
          screen with a center vignette — dashboard onward uses bare halftone. */}
      <div
        aria-hidden
        className="pointer-events-none absolute inset-0 -z-10"
        style={{
          backgroundImage:
            "radial-gradient(ellipse at center, transparent 40%, var(--background) 80%)",
        }}
      />

      <div className="flex flex-col items-center gap-4">
        <Image
          src="/logo.png"
          alt="Corellia"
          width={160}
          height={160}
          className="opacity-90"
          priority
        />
        <h1 className="font-heading text-4xl font-bold tracking-tight">
          <PearlText>CORELLIA</PearlText>
        </h1>
      </div>

      <form
        onSubmit={onSubmit}
        className="w-full max-w-sm space-y-3"
        aria-label="Sign in"
      >
        <div className="space-y-1">
          <Label htmlFor="email">Email</Label>
          <Input
            id="email"
            type="email"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            required
          />
        </div>
        <div className="space-y-1">
          <Label htmlFor="password">Password</Label>
          <Input
            id="password"
            type="password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            required
          />
        </div>
        {err && <p className="text-sm text-red-600">{err}</p>}
        <Button type="submit" variant="pearl">
          Sign in
        </Button>
      </form>
    </main>
  );
}
