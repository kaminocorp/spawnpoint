"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";

import { createApiClient } from "@/lib/api/client";
import { createClient } from "@/lib/supabase/client";

export default function DashboardPage() {
  const router = useRouter();
  const [email, setEmail] = useState<string | null>(null);
  const [err, setErr] = useState<string | null>(null);

  useEffect(() => {
    (async () => {
      try {
        const api = createApiClient();
        const res = await api.users.getCurrentUser({});
        setEmail(res.user?.email ?? null);
      } catch (e) {
        setErr(String(e));
      }
    })();
  }, []);

  async function signOut() {
    const supabase = createClient();
    await supabase.auth.signOut();
    router.push("/sign-in");
  }

  return (
    <main className="mx-auto max-w-xl space-y-4 p-8">
      <h1 className="text-2xl font-bold">Corellia</h1>
      {err && <p className="text-red-600">{err}</p>}
      {email && (
        <p>
          Signed in as <strong>{email}</strong>
        </p>
      )}
      <button onClick={signOut} className="text-sm underline">
        Sign out
      </button>
    </main>
  );
}
