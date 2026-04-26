import { cn } from "@/lib/utils"

type Status =
  | "pending"
  | "spawning"
  | "running"
  | "stopped"
  | "failed"
  | "destroyed"

type StatusDotProps = Omit<React.ComponentProps<"span">, "children"> & {
  status: Status
  showLabel?: boolean
}

/**
 * Pulse-dot indicator for agent lifecycle state. See
 * `docs/refs/design-system.md` §35 for the canonical mapping.
 *
 * - `pending` / `spawning` → amber, telemetry pulse
 * - `running`             → terminal green, telemetry pulse
 * - `failed`              → red, no pulse (failed state is terminal)
 * - `stopped` / `destroyed` → muted gray, no pulse
 *
 * The pulse animation is the load-bearing "alive, not showy" register
 * — always-on, low frequency (2.4s), opacity-only. No motion on terminal
 * states.
 */

const STATUS_TONE: Record<
  Status,
  { dot: string; label: string }
> = {
  pending: {
    dot: "bg-[hsl(var(--status-pending))]",
    label: "text-[hsl(var(--status-pending))]",
  },
  spawning: {
    dot: "bg-[hsl(var(--status-pending))]",
    label: "text-[hsl(var(--status-pending))]",
  },
  running: {
    dot: "bg-[hsl(var(--status-running))]",
    label: "text-[hsl(var(--status-running))]",
  },
  stopped: {
    dot: "bg-[hsl(var(--status-stopped))]",
    label: "text-muted-foreground",
  },
  failed: {
    dot: "bg-[hsl(var(--status-failed))]",
    label: "text-[hsl(var(--status-failed))]",
  },
  destroyed: {
    dot: "bg-[hsl(var(--status-stopped))]",
    label: "text-muted-foreground line-through",
  },
}

const STATUS_PULSES: ReadonlySet<Status> = new Set([
  "pending",
  "spawning",
  "running",
])

function StatusDot({
  status,
  showLabel = true,
  className,
  ...props
}: StatusDotProps) {
  const tone = STATUS_TONE[status]
  const pulses = STATUS_PULSES.has(status)

  return (
    <span
      data-slot="status-dot"
      data-status={status}
      className={cn("inline-flex items-center gap-2", className)}
      {...props}
    >
      <span
        aria-hidden
        className={cn(
          "size-1.5 rounded-full",
          tone.dot,
          pulses && "animate-telemetry",
        )}
      />
      {showLabel && (
        <span
          className={cn(
            "font-display text-[10px] uppercase tracking-wider",
            tone.label,
          )}
        >
          {status}
        </span>
      )}
    </span>
  )
}

export { StatusDot }
export type { Status, StatusDotProps }
