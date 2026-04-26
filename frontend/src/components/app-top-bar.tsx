"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { LogOutIcon } from "lucide-react";

import { Avatar, AvatarFallback } from "@/components/ui/avatar";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { SidebarTrigger } from "@/components/ui/sidebar";
import { createClient as createSupabaseClient } from "@/lib/supabase/client";

type Props = {
  workspaceName: string;
  userName: string;
  email: string;
};

function initials(name: string, email: string) {
  const source = name.trim() || email.trim();
  if (!source) return "?";
  const parts = source.split(/[\s.]+/).filter(Boolean);
  const head = parts[0]?.[0] ?? "";
  const tail = parts.length > 1 ? parts[parts.length - 1][0] : "";
  return (head + tail).slice(0, 2).toUpperCase();
}

/**
 * Live-clock readout. Updates once per second; renders as 24h `HH:MM:SS`
 * for the always-on monitoring register. SSR-safe — initialises empty
 * and hydrates client-side.
 */
function useClock(): string {
  const [time, setTime] = useState("");
  useEffect(() => {
    const tick = () => {
      const d = new Date();
      const hh = String(d.getHours()).padStart(2, "0");
      const mm = String(d.getMinutes()).padStart(2, "0");
      const ss = String(d.getSeconds()).padStart(2, "0");
      setTime(`${hh}:${mm}:${ss}`);
    };
    tick();
    const id = setInterval(tick, 1000);
    return () => clearInterval(id);
  }, []);
  return time;
}

export function AppTopBar({ workspaceName, userName, email }: Props) {
  const router = useRouter();
  const clock = useClock();

  async function signOut() {
    const supabase = createSupabaseClient();
    await supabase.auth.signOut();
    router.replace("/sign-in");
  }

  return (
    <header className="flex h-12 shrink-0 items-center gap-3 border-b border-border bg-background px-3">
      <SidebarTrigger />
      <div className="flex items-center gap-2">
        <span className="font-display text-[10px] uppercase tracking-widest text-muted-foreground/60">
          [ WORKSPACE ]
        </span>
        <span className="font-display text-xs uppercase tracking-wider text-foreground">
          {workspaceName}
        </span>
      </div>
      <div className="flex-1" />
      <div className="hidden items-center gap-3 md:flex">
        <span className="font-display text-[10px] uppercase tracking-widest text-muted-foreground/60">
          [ UTC ]
        </span>
        <span className="font-mono text-xs tabular-nums text-foreground/80">
          {clock || "—"}
        </span>
      </div>
      <DropdownMenu>
        <DropdownMenuTrigger
          render={
            <Button variant="ghost" size="icon" aria-label="Account menu">
              <Avatar className="size-7 rounded-sm">
                <AvatarFallback className="rounded-sm bg-secondary font-mono text-[10px] text-foreground">
                  {initials(userName, email)}
                </AvatarFallback>
              </Avatar>
            </Button>
          }
        />
        <DropdownMenuContent align="end" className="w-56">
          <DropdownMenuLabel className="space-y-0.5">
            <div className="font-display text-xs uppercase tracking-wider text-foreground">
              {userName || email}
            </div>
            <div className="font-mono text-[10px] text-muted-foreground">
              {email}
            </div>
          </DropdownMenuLabel>
          <DropdownMenuSeparator />
          <DropdownMenuItem onClick={signOut}>
            <LogOutIcon />
            <span className="font-display text-xs uppercase tracking-wider">
              Sign out
            </span>
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>
    </header>
  );
}
