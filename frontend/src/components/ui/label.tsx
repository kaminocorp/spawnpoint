"use client"

import * as React from "react"

import { cn } from "@/lib/utils"

/**
 * Mission-control label vocabulary: uppercase Space Mono, `tracking-wider`,
 * muted color. The signature `[ FIELD NAME ]` form is rendered via the
 * `bracketed` prop on field-group wrappers; bare `<Label>` is the simpler
 * label used inline with inputs.
 */
function Label({ className, ...props }: React.ComponentProps<"label">) {
  return (
    <label
      data-slot="label"
      className={cn(
        "flex items-center gap-2 select-none",
        "font-display text-xs font-medium uppercase tracking-wider text-muted-foreground",
        "group-data-[disabled=true]:pointer-events-none group-data-[disabled=true]:opacity-50",
        "peer-disabled:cursor-not-allowed peer-disabled:opacity-50",
        className
      )}
      {...props}
    />
  )
}

export { Label }
