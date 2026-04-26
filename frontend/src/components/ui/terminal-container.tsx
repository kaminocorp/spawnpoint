import { cn } from "@/lib/utils"

type TerminalAccent =
  | "catalog"
  | "adapter"
  | "deploy"
  | "secrets"
  | "running"
  | "pending"
  | "failed"

type TerminalContainerProps = React.ComponentProps<"section"> & {
  title: string
  /** Right-side hint text in the title bar (e.g. counts, timestamps). */
  meta?: React.ReactNode
  /** Section accent — paints the title-bar bottom rule + chevron. */
  accent?: TerminalAccent
  /** Override the default `[ TITLE ]` framing if you need a longer label. */
  brackets?: boolean
}

/**
 * The signature panel of the design system: a hairline-bordered surface
 * with a `[ TITLE ]` bracketed header and a `›` chevron. See
 * `docs/refs/design-system.md` §16. Default state has no accent — the
 * title rule and chevron are muted gray. Pass `accent` to colour both
 * for section wayfinding (catalog cyan, deploy blue, etc.) or status
 * register (running green, pending amber, failed red).
 */

const ACCENT_BORDER: Record<TerminalAccent, string> = {
  catalog: "border-b-[hsl(var(--feature-catalog))]/60",
  adapter: "border-b-[hsl(var(--feature-adapter))]/60",
  deploy: "border-b-[hsl(var(--feature-deploy))]/60",
  secrets: "border-b-[hsl(var(--feature-secrets))]/60",
  running: "border-b-[hsl(var(--status-running))]/60",
  pending: "border-b-[hsl(var(--status-pending))]/60",
  failed: "border-b-[hsl(var(--status-failed))]/60",
}

const ACCENT_CHEVRON: Record<TerminalAccent, string> = {
  catalog: "text-[hsl(var(--feature-catalog))]",
  adapter: "text-[hsl(var(--feature-adapter))]",
  deploy: "text-[hsl(var(--feature-deploy))]",
  secrets: "text-[hsl(var(--feature-secrets))]",
  running: "text-[hsl(var(--status-running))]",
  pending: "text-[hsl(var(--status-pending))]",
  failed: "text-[hsl(var(--status-failed))]",
}

function TerminalContainer({
  title,
  meta,
  accent,
  brackets = true,
  className,
  children,
  ...props
}: TerminalContainerProps) {
  const titleRule = accent ? ACCENT_BORDER[accent] : "border-b-border"
  const chevron = accent ? ACCENT_CHEVRON[accent] : "text-muted-foreground"

  return (
    <section
      data-slot="terminal-container"
      className={cn(
        "border border-border bg-card",
        className,
      )}
      {...props}
    >
      <header
        className={cn(
          "flex items-center gap-2 border-b px-3 py-2",
          titleRule,
        )}
      >
        <span className={cn("font-display text-xs leading-none", chevron)}>
          ›
        </span>
        <span className="font-display text-[11px] uppercase tracking-wider text-muted-foreground">
          {brackets ? `[ ${title.toUpperCase()} ]` : title.toUpperCase()}
        </span>
        {meta !== undefined && (
          <span className="ml-auto font-mono text-[10px] uppercase tracking-wider text-muted-foreground/70">
            {meta}
          </span>
        )}
      </header>
      <div className="p-4">{children}</div>
    </section>
  )
}

export { TerminalContainer }
export type { TerminalAccent, TerminalContainerProps }
