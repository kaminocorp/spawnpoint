import { StatusDot, type Status } from "@/components/ui/status-dot";

const KNOWN: ReadonlySet<string> = new Set([
  "pending",
  "spawning",
  "running",
  "stopped",
  "failed",
  "destroyed",
]);

export function StatusBadge({ status }: { status: string }) {
  const safe: Status = (KNOWN.has(status) ? status : "pending") as Status;
  return <StatusDot status={safe} />;
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
