"use client";

import { LayoutGridIcon, Rows3Icon } from "lucide-react";

import type { FleetView } from "@/lib/fleet-view-pref";
import { cn } from "@/lib/utils";

type Props = {
  value: FleetView;
  onChange: (v: FleetView) => void;
};

export function FleetViewToggle({ value, onChange }: Props) {
  return (
    <div
      role="group"
      aria-label="Fleet view"
      className="flex items-center border border-border"
    >
      <ToggleButton
        active={value === "gallery"}
        onClick={() => onChange("gallery")}
        label="GALLERY"
      >
        <LayoutGridIcon className="size-3" aria-hidden />
      </ToggleButton>
      <ToggleButton
        active={value === "list"}
        onClick={() => onChange("list")}
        label="LIST"
      >
        <Rows3Icon className="size-3" aria-hidden />
      </ToggleButton>
    </div>
  );
}

function ToggleButton({
  active,
  onClick,
  label,
  children,
}: {
  active: boolean;
  onClick: () => void;
  label: string;
  children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-pressed={active}
      className={cn(
        "flex items-center gap-1.5 px-2 py-1 font-display text-[10px] uppercase tracking-widest transition-colors",
        active
          ? "bg-muted/40 text-foreground"
          : "text-muted-foreground hover:text-foreground",
      )}
    >
      {children}
      {label}
    </button>
  );
}
