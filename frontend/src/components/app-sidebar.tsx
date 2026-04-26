"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";

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
  ready: boolean;
};

const items: NavItem[] = [
  { href: "/dashboard", label: "Dashboard", ready: true },
  { href: "/spawn", label: "Spawn", ready: true },
  { href: "/fleet", label: "Fleet", ready: true },
  { href: "/settings", label: "Settings", ready: false },
];

export function AppSidebar() {
  const pathname = usePathname();

  return (
    <Sidebar collapsible="icon">
      <SidebarHeader className="h-14 border-b border-sidebar-border p-0">
        <div className="flex h-full items-center px-4">
          <span className="font-display text-base font-black uppercase tracking-[0.3em] text-foreground group-data-[collapsible=icon]:hidden">
            CORELLIA
          </span>
          <span
            aria-hidden
            className="hidden font-display text-base font-black uppercase tracking-widest text-foreground group-data-[collapsible=icon]:inline"
          >
            C
          </span>
        </div>
      </SidebarHeader>
      <SidebarContent>
        <SidebarGroup>
          <div className="px-3 pb-2 pt-3 group-data-[collapsible=icon]:hidden">
            <span className="font-display text-[10px] uppercase tracking-widest text-muted-foreground/60">
              [ MODULES ]
            </span>
          </div>
          <SidebarGroupContent>
            <SidebarMenu>
              {items.map((item) => {
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
                          <span>{item.label}</span>
                        </Link>
                      }
                    />
                    {!item.ready && (
                      <SidebarMenuBadge className="font-display text-[10px] uppercase tracking-wider text-muted-foreground/60">
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
