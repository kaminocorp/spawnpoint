import { Button as ButtonPrimitive } from "@base-ui/react/button"
import { cva, type VariantProps } from "class-variance-authority"

import { cn } from "@/lib/utils"

/**
 * Mission-control button vocabulary. See `docs/refs/design-system.md` §13.
 *
 * Defaults: square hairline rectangle, Space Mono uppercase,
 * `tracking-wider`, no shadow. The `default` variant is the terminal-green
 * primary CTA — at rest it shows green text on a transparent ground with a
 * green hairline; hover fills the surface with a green tint. Outline is the
 * universal "secondary" — gray hairline, no fill, gray text.
 *
 * Convention: primary CTAs prefix copy with `>` (e.g. `> DEPLOY`). The
 * chevron is content, not chrome — the consumer types it. See spec §13.1.
 */
const buttonVariants = cva(
  [
    "group/button inline-flex shrink-0 items-center justify-center gap-1.5",
    "rounded-sm border whitespace-nowrap select-none outline-none transition-colors",
    "font-display font-medium uppercase tracking-wider",
    "focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background",
    "disabled:pointer-events-none disabled:opacity-40",
    "aria-invalid:border-destructive aria-invalid:ring-2 aria-invalid:ring-destructive/40",
    "[&_svg]:pointer-events-none [&_svg]:shrink-0 [&_svg:not([class*='size-'])]:size-3.5",
  ].join(" "),
  {
    variants: {
      variant: {
        default: [
          "border-primary/60 bg-transparent text-primary",
          "hover:bg-primary/15 hover:border-primary",
          "active:bg-primary/25",
        ].join(" "),
        outline: [
          "border-border bg-transparent text-foreground",
          "hover:border-foreground/40 hover:bg-foreground/5",
          "active:bg-foreground/10",
        ].join(" "),
        ghost: [
          "border-transparent bg-transparent text-muted-foreground",
          "hover:text-foreground hover:bg-foreground/5",
          "active:bg-foreground/10",
        ].join(" "),
        secondary: [
          "border-border bg-secondary text-secondary-foreground",
          "hover:bg-accent",
        ].join(" "),
        destructive: [
          "border-destructive/40 bg-transparent text-destructive",
          "hover:bg-destructive/15 hover:border-destructive",
          "active:bg-destructive/25",
        ].join(" "),
        link: [
          "border-transparent bg-transparent text-primary normal-case tracking-normal",
          "underline-offset-4 hover:underline",
        ].join(" "),
      },
      size: {
        default: "h-8 px-3 text-xs",
        xs: "h-6 px-2 text-[10px]",
        sm: "h-7 px-2.5 text-[11px]",
        lg: "h-9 px-4 text-xs",
        icon: "size-8 p-0",
        "icon-xs": "size-6 p-0",
        "icon-sm": "size-7 p-0",
        "icon-lg": "size-9 p-0",
      },
    },
    defaultVariants: {
      variant: "default",
      size: "default",
    },
  }
)

function Button({
  className,
  variant = "default",
  size = "default",
  render,
  nativeButton,
  ...props
}: ButtonPrimitive.Props & VariantProps<typeof buttonVariants>) {
  // Base UI's `useButton` defaults `nativeButton: true`, which warns when
  // the rendered element isn't a `<button>`. We commonly pass a Next.js
  // `<Link>` (renders `<a>`) or a raw `<a>` via the `render` prop, so flip
  // the default to `false` whenever `render` is set to anything that isn't
  // a literal `<button>`. Consumers can still override explicitly.
  const renderIsNativeButton =
    render !== undefined &&
    typeof render === "object" &&
    render !== null &&
    "type" in (render as React.ReactElement) &&
    (render as React.ReactElement).type === "button"
  const resolvedNativeButton =
    nativeButton ?? (render === undefined || renderIsNativeButton ? undefined : false)

  return (
    <ButtonPrimitive
      data-slot="button"
      render={render}
      nativeButton={resolvedNativeButton}
      className={cn(buttonVariants({ variant, size, className }))}
      {...props}
    />
  )
}

export { Button, buttonVariants }
