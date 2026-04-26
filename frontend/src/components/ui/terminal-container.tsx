import { cn } from "@/lib/utils"

type TerminalAccent = "cyan" | "violet" | "blue" | "rose" | "green"

type TerminalContainerProps = React.ComponentProps<"section"> & {
  title: string
  accent?: TerminalAccent
}

/**
 * The signature monochrome panel of the design system: a brutalist
 * `border-2 border-gray-600` frame with a `[ TITLE ]` bracket header,
 * `bg-black/80 backdrop-blur-sm` body, and no border-radius. See
 * `docs/refs/design-system.md` §16.
 *
 * Optional `accent` paints the title-bar bottom border + chevron in the
 * feature wayfinding color (cyan/violet/blue/rose/green). When omitted,
 * the title bar uses the default gray-600 hairline.
 *
 * Ships unused in Phase 2; first consumer is M4's `/fleet` table and
 * `/spawn` flow per `docs/executing/frontend-redesign.md` decision 22.
 */

const accentBorderClass: Record<TerminalAccent, string> = {
  cyan: "border-b-cyan-500",
  violet: "border-b-violet-500",
  blue: "border-b-blue-500",
  rose: "border-b-rose-500",
  green: "border-b-green-500",
}

const accentChevronClass: Record<TerminalAccent, string> = {
  cyan: "text-cyan-500",
  violet: "text-violet-500",
  blue: "text-blue-500",
  rose: "text-rose-500",
  green: "text-green-500",
}

function TerminalContainer({
  title,
  accent,
  className,
  children,
  ...props
}: TerminalContainerProps) {
  const titleBarBorder = accent
    ? accentBorderClass[accent]
    : "border-b-gray-600"
  const chevronColor = accent ? accentChevronClass[accent] : "text-gray-500"

  return (
    <section
      data-slot="terminal-container"
      className={cn(
        "border-2 border-gray-600 bg-black/80 backdrop-blur-sm",
        className,
      )}
      {...props}
    >
      <header
        className={cn(
          "flex items-center gap-2 border-b-2 px-3 py-2",
          titleBarBorder,
        )}
      >
        <span className={cn("font-mono text-xs", chevronColor)}>›</span>
        <span className="font-mono text-xs uppercase tracking-wider text-gray-500">
          [ {title.toUpperCase()} ]
        </span>
      </header>
      <div className="p-4">{children}</div>
    </section>
  )
}

export { TerminalContainer }
export type { TerminalAccent, TerminalContainerProps }
