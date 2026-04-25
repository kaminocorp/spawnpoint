"use client";

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
import { Separator } from "@/components/ui/separator";
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

export function AppTopBar({ workspaceName, userName, email }: Props) {
  const router = useRouter();

  async function signOut() {
    const supabase = createSupabaseClient();
    await supabase.auth.signOut();
    router.replace("/sign-in");
  }

  return (
    <header className="flex h-14 shrink-0 items-center gap-3 border-b bg-background px-4">
      <SidebarTrigger />
      <Separator orientation="vertical" className="h-5" />
      <div className="flex-1 text-sm font-medium">{workspaceName}</div>
      <DropdownMenu>
        <DropdownMenuTrigger
          render={
            <Button variant="ghost" size="icon" className="rounded-full">
              <Avatar className="size-7">
                <AvatarFallback className="text-xs">
                  {initials(userName, email)}
                </AvatarFallback>
              </Avatar>
            </Button>
          }
        />
        <DropdownMenuContent align="end" className="w-56">
          <DropdownMenuLabel className="space-y-0.5">
            <div className="font-medium">{userName || email}</div>
            <div className="text-xs font-normal text-muted-foreground">{email}</div>
          </DropdownMenuLabel>
          <DropdownMenuSeparator />
          <DropdownMenuItem onClick={signOut}>
            <LogOutIcon />
            <span>Sign out</span>
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>
    </header>
  );
}
