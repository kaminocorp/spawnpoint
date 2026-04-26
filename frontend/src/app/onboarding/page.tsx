"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import Image from "next/image";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { Code, ConnectError } from "@connectrpc/connect";
import { toast } from "sonner";
import { z } from "zod";

import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardFooter,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { PearlText } from "@/components/ui/pearl-text";
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
      toast.success(`Welcome to Corellia, ${values.name}.`);
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
    <main className="halftone-bg relative flex min-h-screen items-center justify-center p-6">
      {/* Vignette inherited from sign-in's arrival flow — onboarding is the
          continuation of "you just arrived." */}
      <div
        aria-hidden
        className="pointer-events-none absolute inset-0 -z-10"
        style={{
          backgroundImage:
            "radial-gradient(ellipse at center, transparent 40%, var(--background) 80%)",
        }}
      />
      <div className="w-full max-w-md">
        {state.kind === "loading" && (
          <p className="text-center text-sm text-muted-foreground">Loading…</p>
        )}

        {state.kind === "not-provisioned" && (
          <Card>
            <CardHeader>
              <CardTitle>Account not provisioned</CardTitle>
              <CardDescription>
                Sign-in succeeded, but no workspace record exists for your account.
                Contact an administrator to be added.
              </CardDescription>
            </CardHeader>
            <CardFooter>
              <Button variant="outline" onClick={signOut}>
                Sign out
              </Button>
            </CardFooter>
          </Card>
        )}

        {state.kind === "error" && (
          <Card>
            <CardHeader>
              <CardTitle>Something went wrong</CardTitle>
              <CardDescription>{state.message}</CardDescription>
            </CardHeader>
            <CardFooter>
              <Button variant="outline" onClick={signOut}>
                Sign out
              </Button>
            </CardFooter>
          </Card>
        )}

        {state.kind === "ready" && (
          <>
            <div className="mb-6 flex justify-center">
              <Image
                src="/logo.png"
                alt="Corellia"
                width={64}
                height={64}
                className="opacity-90"
                priority
              />
            </div>
            <Card>
              <CardHeader>
                <CardTitle className="text-xl">
                  <PearlText>Welcome to Corellia.</PearlText>
                </CardTitle>
                <CardDescription>
                  Just two things before we get started.
                </CardDescription>
              </CardHeader>
            <form onSubmit={form.handleSubmit(onSubmit)}>
              <CardContent className="space-y-4">
                <div className="space-y-1.5">
                  <Label htmlFor="name">What should we call you?</Label>
                  <Input
                    id="name"
                    autoFocus
                    autoComplete="name"
                    placeholder="e.g. Alice"
                    aria-invalid={!!form.formState.errors.name}
                    {...form.register("name")}
                  />
                  {form.formState.errors.name && (
                    <p className="text-sm text-destructive">
                      {form.formState.errors.name.message}
                    </p>
                  )}
                </div>

                <div className="space-y-1.5">
                  <Label htmlFor="orgName">What&apos;s this workspace called?</Label>
                  <Input
                    id="orgName"
                    autoComplete="organization"
                    aria-invalid={!!form.formState.errors.orgName}
                    {...form.register("orgName")}
                  />
                  <p className="text-xs text-muted-foreground">
                    We started with a default — feel free to change it.
                  </p>
                  {form.formState.errors.orgName && (
                    <p className="text-sm text-destructive">
                      {form.formState.errors.orgName.message}
                    </p>
                  )}
                </div>
              </CardContent>
              <CardFooter className="justify-end gap-2">
                <Button
                  type="button"
                  variant="ghost"
                  onClick={signOut}
                  disabled={state.submitting}
                >
                  Sign out
                </Button>
                <Button
                  type="submit"
                  variant="pearl"
                  disabled={state.submitting}
                >
                  {state.submitting ? "Saving…" : "Continue"}
                </Button>
              </CardFooter>
            </form>
            </Card>
          </>
        )}
      </div>
    </main>
  );
}
