type Props = {
  name: string;
  description: string;
  vendor?: string;
};

export function ComingSoonHarnessCard({ name, description, vendor }: Props) {
  return (
    <article className="flex flex-col border border-border bg-card opacity-70">
      <header className="flex items-center justify-between gap-2 border-b border-border px-3 py-2">
        <div className="flex items-center gap-2">
          <span
            className="font-display text-xs leading-none text-muted-foreground/50"
            aria-hidden
          >
            ›
          </span>
          <span className="font-display text-xs uppercase tracking-wider text-muted-foreground">
            {name}
          </span>
        </div>
        <span className="font-display text-[10px] uppercase tracking-wider text-muted-foreground/60">
          PLANNED
        </span>
      </header>

      <div className="flex-1 space-y-3 px-3 py-3">
        <p className="text-xs leading-relaxed text-muted-foreground">
          {description}
        </p>
        {vendor && (
          <dl className="font-mono text-[11px]">
            <div className="flex items-baseline gap-2">
              <dt className="w-20 shrink-0 text-[10px] uppercase tracking-wider text-muted-foreground/70">
                VENDOR
              </dt>
              <dd className="text-muted-foreground">{vendor}</dd>
            </div>
          </dl>
        )}
      </div>
    </article>
  );
}
