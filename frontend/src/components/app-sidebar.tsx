"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { Box, LayoutDashboard, Settings, Sparkles, type LucideIcon } from "lucide-react";

import {
  Sidebar,
  SidebarContent,
  SidebarGroup,
  SidebarGroupContent,
  SidebarHeader,
  SidebarMenu,
  SidebarMenuBadge,
  SidebarMenuButton,
  SidebarMenuItem,
} from "@/components/ui/sidebar";

type NavItem = {
  href: string;
  label: string;
  icon: LucideIcon;
  ready: boolean;
};

const items: NavItem[] = [
  { href: "/dashboard", label: "Dashboard", icon: LayoutDashboard, ready: true },
  { href: "/agents", label: "Agents", icon: Sparkles, ready: false },
  { href: "/fleet", label: "Fleet", icon: Box, ready: false },
  { href: "/settings", label: "Settings", icon: Settings, ready: false },
];

export function AppSidebar() {
  const pathname = usePathname();

  return (
    <Sidebar collapsible="icon">
      <SidebarHeader>
        <div className="flex items-center gap-2 px-2 py-1.5">
          <div className="size-7 rounded-md bg-primary text-primary-foreground flex items-center justify-center text-xs font-semibold">
            C
          </div>
          <span className="font-heading text-base font-medium group-data-[collapsible=icon]:hidden">
            Corellia
          </span>
        </div>
      </SidebarHeader>
      <SidebarContent>
        <SidebarGroup>
          <SidebarGroupContent>
            <SidebarMenu>
              {items.map((item) => {
                const Icon = item.icon;
                const active =
                  pathname === item.href || pathname?.startsWith(`${item.href}/`);
                return (
                  <SidebarMenuItem key={item.href}>
                    <SidebarMenuButton
                      isActive={!!active}
                      tooltip={item.label}
                      aria-disabled={!item.ready}
                      render={
                        <Link href={item.href}>
                          <Icon />
                          <span>{item.label}</span>
                        </Link>
                      }
                    />
                    {!item.ready && (
                      <SidebarMenuBadge className="text-muted-foreground">
                        Soon
                      </SidebarMenuBadge>
                    )}
                  </SidebarMenuItem>
                );
              })}
            </SidebarMenu>
          </SidebarGroupContent>
        </SidebarGroup>
      </SidebarContent>
    </Sidebar>
  );
}
