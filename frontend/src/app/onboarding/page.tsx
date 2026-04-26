"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { Code, ConnectError } from "@connectrpc/connect";
import { toast } from "sonner";
import { z } from "zod";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { TerminalContainer } from "@/components/ui/terminal-container";
import { createApiClient } from "@/lib/api/client";
import { createClient as createSupabaseClient } from "@/lib/supabase/client";

const schema = z.object({
  name: z.string().trim().min(1, "Required").max(80, "Keep it under 80 characters"),
  orgName: z
    .string()
    .trim()
    .min(1, "Required")
    .max(80, "Keep it under 80 characters"),
});

type FormValues = z.infer<typeof schema>;

type State =
  | { kind: "loading" }
  | { kind: "ready"; orgId: string; defaultOrgName: string; submitting: boolean }
  | { kind: "not-provisioned" }
  | { kind: "error"; message: string };

export default function OnboardingPage() {
  const router = useRouter();
  const [state, setState] = useState<State>({ kind: "loading" });

  const form = useForm<FormValues>({
    resolver: zodResolver(schema),
    defaultValues: { name: "", orgName: "" },
  });

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const api = createApiClient();
        const userRes = await api.users.getCurrentUser({});
        const user = userRes.user;
        if (!user) {
          if (!cancelled) {
            setState({ kind: "error", message: "No user returned." });
          }
          return;
        }
        if (user.name?.trim()) {
          router.replace("/dashboard");
          return;
        }
        const orgRes = await api.organizations.getOrganization({ id: user.orgId });
        const org = orgRes.organization;
        if (!org) {
          if (!cancelled) {
            setState({ kind: "error", message: "Workspace not found." });
          }
          return;
        }
        if (!cancelled) {
          form.reset({ name: "", orgName: org.name });
          setState({
            kind: "ready",
            orgId: org.id,
            defaultOrgName: org.name,
            submitting: false,
          });
        }
      } catch (e) {
        const err = ConnectError.from(e);
        if (cancelled) return;
        if (err.code === Code.Unauthenticated) {
          router.replace("/sign-in");
          return;
        }
        if (err.code === Code.PermissionDenied) {
          setState({ kind: "not-provisioned" });
          return;
        }
        setState({ kind: "error", message: err.message });
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [router, form]);

  async function onSubmit(values: FormValues) {
    if (state.kind !== "ready") return;
    setState({ ...state, submitting: true });
    try {
      const api = createApiClient();
      await Promise.all([
        api.users.updateCurrentUserName({ name: values.name }),
        api.organizations.updateOrganizationName({
          id: state.orgId,
          name: values.orgName,
        }),
      ]);
      toast.success(`Welcome, ${values.name}.`);
      router.replace("/dashboard");
    } catch (e) {
      const err = ConnectError.from(e);
      toast.error(err.message);
      setState({ ...state, submitting: false });
    }
  }

  async function signOut() {
    const supabase = createSupabaseClient();
    await supabase.auth.signOut();
    router.replace("/sign-in");
  }

  return (
    <main className="grid-bg relative flex min-h-screen items-center justify-center p-6">
      <div className="w-full max-w-md">
        {state.kind === "loading" && (
          <p className="text-center font-display text-xs uppercase tracking-widest text-muted-foreground">
            INITIALISING…
          </p>
        )}

        {state.kind === "not-provisioned" && (
          <TerminalContainer title="ACCOUNT NOT PROVISIONED" accent="failed">
            <p className="text-sm text-muted-foreground">
              Sign-in succeeded, but no workspace record exists for your account.
              Contact an administrator to be added.
            </p>
            <div className="mt-4 flex justify-end">
              <Button variant="outline" size="sm" onClick={signOut}>
                Sign out
              </Button>
            </div>
          </TerminalContainer>
        )}

        {state.kind === "error" && (
          <TerminalContainer title="SYSTEM FAULT" accent="failed">
            <p className="font-mono text-xs text-foreground">{state.message}</p>
            <div className="mt-4 flex justify-end">
              <Button variant="outline" size="sm" onClick={signOut}>
                Sign out
              </Button>
            </div>
          </TerminalContainer>
        )}

        {state.kind === "ready" && (
          <>
            <header className="mb-6 flex flex-col items-center gap-2">
              <div className="flex items-center gap-3">
                <span
                  className="font-display text-xl text-[hsl(var(--status-running))]"
                  aria-hidden
                >
                  ›
                </span>
                <h1 className="font-display text-2xl font-bold uppercase tracking-[0.3em] text-foreground">
                  CORELLIA
                </h1>
              </div>
              <p className="font-display text-[10px] uppercase tracking-widest text-muted-foreground">
                INITIAL CONFIGURATION
              </p>
            </header>
            <TerminalContainer title="OPERATOR PROFILE">
              <form onSubmit={form.handleSubmit(onSubmit)} className="space-y-4">
                <div className="space-y-1.5">
                  <Label htmlFor="name">CALLSIGN</Label>
                  <Input
                    id="name"
                    autoFocus
                    autoComplete="name"
                    placeholder="e.g. alice"
                    aria-invalid={!!form.formState.errors.name}
                    {...form.register("name")}
                  />
                  {form.formState.errors.name && (
                    <p className="font-mono text-[11px] text-[hsl(var(--status-failed))]">
                      ERR — {form.formState.errors.name.message}
                    </p>
                  )}
                </div>

                <div className="space-y-1.5">
                  <Label htmlFor="orgName">WORKSPACE</Label>
                  <Input
                    id="orgName"
                    autoComplete="organization"
                    aria-invalid={!!form.formState.errors.orgName}
                    {...form.register("orgName")}
                  />
                  <p className="font-display text-[10px] uppercase tracking-wider text-muted-foreground/70">
                    Editable later
                  </p>
                  {form.formState.errors.orgName && (
                    <p className="font-mono text-[11px] text-[hsl(var(--status-failed))]">
                      ERR — {form.formState.errors.orgName.message}
                    </p>
                  )}
                </div>

                <div className="flex justify-end gap-2 pt-2">
                  <Button
                    type="button"
                    variant="ghost"
                    size="sm"
                    onClick={signOut}
                    disabled={state.submitting}
                  >
                    Sign out
                  </Button>
                  <Button type="submit" size="sm" disabled={state.submitting}>
                    {state.submitting ? "› SAVING…" : "› CONTINUE"}
                  </Button>
                </div>
              </form>
            </TerminalContainer>
          </>
        )}
      </div>
    </main>
  );
}
