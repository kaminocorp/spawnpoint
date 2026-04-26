import { cn } from "@/lib/utils"

/**
 * Wraps inline content in the pearlescent text material — a drifting
 * iridescent gradient clipped to the text glyphs. Heading semantics come
 * from the consumer's wrapping element (e.g. `<h1><PearlText>…</PearlText></h1>`),
 * keeping accessibility heading hierarchy clean.
 *
 * The visual is painted by the `.pearl-text` utility in `globals.css`
 * (Phase 1). Browsers without `background-clip: text` fall back to the
 * gradient's lavender-white midpoint via `--pearl-fallback-color`.
 */
function PearlText({
  className,
  children,
  ...props
}: React.ComponentProps<"span">) {
  return (
    <span
      data-slot="pearl-text"
      className={cn("pearl-text", className)}
      {...props}
    >
      {children}
    </span>
  )
}

export { PearlText }
