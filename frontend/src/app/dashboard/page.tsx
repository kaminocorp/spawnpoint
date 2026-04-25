"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { Code, ConnectError } from "@connectrpc/connect";

import { createApiClient } from "@/lib/api/client";
import { createClient } from "@/lib/supabase/client";

type State =
  | { kind: "loading" }
  | { kind: "ready"; email: string }
  | { kind: "not-provisioned" }
  | { kind: "error"; message: string };

export default function DashboardPage() {
  const router = useRouter();
  const [state, setState] = useState<State>({ kind: "loading" });

  useEffect(() => {
    (async () => {
      try {
        const api = createApiClient();
        const res = await api.users.getCurrentUser({});
        setState({ kind: "ready", email: res.user?.email ?? "" });
      } catch (e) {
        const err = ConnectError.from(e);
        if (err.code === Code.PermissionDenied) {
          setState({ kind: "not-provisioned" });
        } else {
          setState({ kind: "error", message: err.message });
        }
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
      {state.kind === "loading" && <p className="text-gray-500">Loading…</p>}
      {state.kind === "ready" && (
        <p>
          Signed in as <strong>{state.email}</strong>
        </p>
      )}
      {state.kind === "not-provisioned" && (
        <div className="rounded border border-amber-300 bg-amber-50 p-4 text-amber-900">
          <p className="font-semibold">Your account isn&apos;t provisioned yet.</p>
          <p className="text-sm">
            Sign-in succeeded, but no workspace record exists for your account. Contact an
            administrator to be added.
          </p>
        </div>
      )}
      {state.kind === "error" && <p className="text-red-600">{state.message}</p>}
      <button onClick={signOut} className="text-sm underline">
        Sign out
      </button>
    </main>
  );
}
