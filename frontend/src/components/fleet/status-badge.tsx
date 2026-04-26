import { Badge } from "@/components/ui/badge";

type Variant = "default" | "secondary" | "destructive" | "outline" | "ghost";

const STATUS_MAP: Record<
  string,
  { variant: Variant; label: string; className?: string }
> = {
  pending: { variant: "secondary", label: "Pending" },
  running: {
    variant: "secondary",
    label: "Running",
    className:
      "bg-emerald-500/15 text-emerald-700 dark:bg-emerald-500/15 dark:text-emerald-400",
  },
  stopped: {
    variant: "outline",
    label: "Stopped",
    className: "text-muted-foreground",
  },
  failed: { variant: "destructive", label: "Failed" },
  destroyed: {
    variant: "outline",
    label: "Destroyed",
    className: "text-muted-foreground/70 line-through",
  },
};

export function StatusBadge({ status }: { status: string }) {
  const entry = STATUS_MAP[status] ?? {
    variant: "outline" as const,
    label: status,
  };
  return (
    <Badge variant={entry.variant} className={entry.className}>
      {entry.label}
    </Badge>
  );
}

export const TERMINAL_STATUSES = new Set([
  "running",
  "stopped",
  "failed",
  "destroyed",
]);

export function isTerminal(status: string): boolean {
  return TERMINAL_STATUSES.has(status);
}
