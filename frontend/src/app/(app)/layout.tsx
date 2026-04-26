"use client";

import { useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { Code, ConnectError } from "@connectrpc/connect";

import { AppSidebar } from "@/components/app-sidebar";
import { AppTopBar } from "@/components/app-top-bar";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardDescription,
  CardFooter,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { SidebarInset, SidebarProvider } from "@/components/ui/sidebar";
import { Skeleton } from "@/components/ui/skeleton";
import type { Organization } from "@/gen/corellia/v1/organizations_pb";
import type { User } from "@/gen/corellia/v1/users_pb";
import { createApiClient } from "@/lib/api/client";
import { UserProvider } from "@/lib/api/user-context";
import { createClient as createSupabaseClient } from "@/lib/supabase/client";

type State =
  | { kind: "loading" }
  | { kind: "ready"; user: User; org: Organization }
  | { kind: "not-provisioned" }
  | { kind: "error"; message: string };

export default function AppLayout({ children }: { children: React.ReactNode }) {
  const router = useRouter();
  const [state, setState] = useState<State>({ kind: "loading" });

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
        if (!user.name?.trim()) {
          router.replace("/onboarding");
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
          setState({ kind: "ready", user, org });
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
  }, [router]);

  async function signOut() {
    const supabase = createSupabaseClient();
    await supabase.auth.signOut();
    router.replace("/sign-in");
  }

  if (state.kind === "loading") {
    return (
      <div className="halftone-bg flex min-h-screen w-full">
        <div className="hidden w-64 border-r p-4 md:block">
          <Skeleton className="mb-6 h-7 w-32" />
          <div className="space-y-2">
            <Skeleton className="h-8 w-full" />
            <Skeleton className="h-8 w-full" />
            <Skeleton className="h-8 w-full" />
            <Skeleton className="h-8 w-full" />
          </div>
        </div>
        <div className="flex-1 p-6">
          <Skeleton className="h-8 w-48" />
        </div>
      </div>
    );
  }

  if (state.kind === "not-provisioned") {
    return (
      <main className="halftone-bg flex min-h-screen items-center justify-center p-6">
        <Card className="w-full max-w-md">
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
      </main>
    );
  }

  if (state.kind === "error") {
    return (
      <main className="halftone-bg flex min-h-screen items-center justify-center p-6">
        <Card className="w-full max-w-md">
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
      </main>
    );
  }

  return <ReadyChrome user={state.user} org={state.org}>{children}</ReadyChrome>;
}

function ReadyChrome({
  user,
  org,
  children,
}: {
  user: User;
  org: Organization;
  children: React.ReactNode;
}) {
  const value = useMemo(() => ({ user, org }), [user, org]);
  return (
    <UserProvider value={value}>
      <SidebarProvider>
        <AppSidebar />
        <SidebarInset>
          <AppTopBar
            workspaceName={org.name}
            userName={user.name ?? ""}
            email={user.email}
          />
          <div className="halftone-bg flex-1 p-6">{children}</div>
        </SidebarInset>
      </SidebarProvider>
    </UserProvider>
  );
}
