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
 * Semantic-colored pulse-dot indicator for agent lifecycle states. See
 * `docs/refs/design-system.md` §35 for the canonical mapping. Pulses on
 * `spawning` and `running` (active states); flat otherwise.
 *
 * Decoupled from chrome by design (decision 8): pearl never paints
 * status. The dot's only "alive" register is the pulse animation on
 * the two active states — uncorrupted by any chrome motion underneath.
 *
 * Ships unused in Phase 2; first consumer is M4's `/fleet` table.
 */

const STATUS_COLOR: Record<Status, string> = {
  pending: "bg-gray-500",
  spawning: "bg-green-400",
  running: "bg-green-400",
  stopped: "bg-gray-500",
  failed: "bg-red-500",
  destroyed: "bg-gray-500",
}

const STATUS_PULSES: ReadonlySet<Status> = new Set(["spawning", "running"])

function StatusDot({
  status,
  showLabel = true,
  className,
  ...props
}: StatusDotProps) {
  const dotColor = STATUS_COLOR[status]
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
          "size-2 rounded-full",
          dotColor,
          pulses && "animate-pulse",
        )}
      />
      {showLabel && (
        <span className="font-mono text-xs uppercase tracking-wider text-gray-400">
          {status}
        </span>
      )}
    </span>
  )
}

export { StatusDot }
export type { Status, StatusDotProps }
