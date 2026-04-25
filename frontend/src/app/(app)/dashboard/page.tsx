"use client";

import Link from "next/link";
import { ArrowRightIcon, BoxIcon, SparklesIcon } from "lucide-react";

import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardFooter,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { useUser } from "@/lib/api/user-context";

export default function DashboardPage() {
  const { user } = useUser();
  const firstName = (user.name ?? "").trim().split(/\s+/)[0];

  return (
    <div className="space-y-6">
      <div>
        <h1 className="font-heading text-2xl font-semibold">
          {firstName ? `Welcome back, ${firstName}.` : "Welcome back."}
        </h1>
        <p className="text-sm text-muted-foreground">
          Corellia is the control plane for the agents you spawn.
        </p>
      </div>

      <div className="grid gap-4 md:grid-cols-2">
        <Card>
          <CardHeader>
            <div className="flex items-center gap-3">
              <div className="flex size-9 items-center justify-center rounded-md bg-muted text-muted-foreground">
                <SparklesIcon className="size-4" />
              </div>
              <div>
                <CardTitle>Spawn your first agent.</CardTitle>
                <CardDescription>
                  Pick a harness, paste an API key, deploy.
                </CardDescription>
              </div>
            </div>
          </CardHeader>
          <CardContent className="text-sm text-muted-foreground">
            The catalog ships first. Hermes is the only harness today; more follow.
          </CardContent>
          <CardFooter>
            <Button render={<Link href="/agents" />}>
              Browse harnesses
              <ArrowRightIcon />
            </Button>
          </CardFooter>
        </Card>

        <Card>
          <CardHeader>
            <div className="flex items-center gap-3">
              <div className="flex size-9 items-center justify-center rounded-md bg-muted text-muted-foreground">
                <BoxIcon className="size-4" />
              </div>
              <div>
                <CardTitle>Fleet at a glance.</CardTitle>
                <CardDescription>
                  Every agent you&apos;ve spawned, with status and logs.
                </CardDescription>
              </div>
            </div>
          </CardHeader>
          <CardContent className="text-sm text-muted-foreground">
            No agents yet. Once you deploy from the catalog, they&apos;ll appear
            here.
          </CardContent>
          <CardFooter>
            <Button variant="outline" render={<Link href="/fleet" />}>
              View fleet
              <ArrowRightIcon />
            </Button>
          </CardFooter>
        </Card>
      </div>
    </div>
  );
}
