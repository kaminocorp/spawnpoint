import { mergeProps } from "@base-ui/react/merge-props"
import { useRender } from "@base-ui/react/use-render"
import { cva, type VariantProps } from "class-variance-authority"

import { cn } from "@/lib/utils"

/**
 * Square hairline badge. Mono uppercase, no fill at rest — semantic
 * variants tint border + text only. The `success` / `warn` / `info`
 * variants map directly onto the §5.6 alert palette and the §5.4 feature
 * map; use them for inline status, capability flags, and section accent
 * stamps (e.g. `[ PLANNED ]`, `[ EXPERIMENTAL ]`).
 */
const badgeVariants = cva(
  [
    "group/badge inline-flex h-5 w-fit shrink-0 items-center justify-center gap-1",
    "rounded-sm border px-1.5 py-0",
    "font-display text-[10px] font-medium uppercase tracking-wider whitespace-nowrap",
    "transition-colors",
    "focus-visible:ring-1 focus-visible:ring-ring",
    "[&>svg]:pointer-events-none [&>svg]:size-3",
  ].join(" "),
  {
    variants: {
      variant: {
        default:
          "border-primary/40 bg-transparent text-primary",
        secondary:
          "border-border bg-transparent text-muted-foreground",
        outline:
          "border-border bg-transparent text-foreground",
        destructive:
          "border-destructive/40 bg-transparent text-destructive",
        ghost:
          "border-transparent bg-transparent text-muted-foreground",
        success:
          "border-[hsl(var(--status-running))]/40 text-[hsl(var(--status-running))]",
        warn:
          "border-[hsl(var(--status-pending))]/40 text-[hsl(var(--status-pending))]",
        info:
          "border-[hsl(var(--feature-deploy))]/40 text-[hsl(var(--feature-deploy))]",
        link: "border-transparent text-primary underline-offset-4 hover:underline",
      },
    },
    defaultVariants: {
      variant: "default",
    },
  }
)

function Badge({
  className,
  variant = "default",
  render,
  ...props
}: useRender.ComponentProps<"span"> & VariantProps<typeof badgeVariants>) {
  return useRender({
    defaultTagName: "span",
    props: mergeProps<"span">(
      {
        className: cn(badgeVariants({ variant }), className),
      },
      props
    ),
    render,
    state: {
      slot: "badge",
      variant,
    },
  })
}

export { Badge, badgeVariants }
