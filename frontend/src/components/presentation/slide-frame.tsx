"use client";

import { cn } from "@/lib/utils";

type SlideFrameProps = {
  index: number;
  count: number;
  title: string;
  children: React.ReactNode;
  onJump: (i: number) => void;
  onPrev: () => void;
  onNext: () => void;
};

/**
 * Persistent slide chrome — top callsign strip + bottom progress dots.
 * The chrome is non-clickable (stops click propagation) so the slide-body
 * click handler can own the advance gesture without dot-clicks colliding
 * with it.
 */
export function SlideFrame({
  index,
  count,
  title,
  children,
  onJump,
  onPrev,
  onNext,
}: SlideFrameProps) {
  return (
    <>
      <header
        className="pointer-events-auto fixed inset-x-0 top-0 z-20 flex items-center justify-between px-6 py-4"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center gap-3">
          <span className="font-display text-base font-black uppercase tracking-[0.3em] text-foreground">
            CORELLIA
          </span>
          <span className="font-display text-[10px] uppercase tracking-widest text-muted-foreground">
            · CONTROL PLANE
          </span>
        </div>
        <div className="font-mono text-[10px] uppercase tracking-widest text-muted-foreground/70">
          [ {String(index + 1).padStart(2, "0")} / {String(count).padStart(2, "0")} ] · {title}
        </div>
      </header>

      <div className="relative flex min-h-screen w-full items-center justify-center px-6 pt-20 pb-24">
        {children}
      </div>

      <footer
        className="pointer-events-auto fixed inset-x-0 bottom-0 z-20 flex items-center justify-between px-6 py-4"
        onClick={(e) => e.stopPropagation()}
      >
        <button
          type="button"
          onClick={onPrev}
          disabled={index === 0}
          className="font-display text-[10px] uppercase tracking-widest text-muted-foreground hover:text-foreground disabled:opacity-30"
          aria-label="Previous slide"
        >
          ‹ PREV
        </button>

        <ul className="flex items-center gap-2" aria-label="Slide progress">
          {Array.from({ length: count }, (_, i) => (
            <li key={i}>
              <button
                type="button"
                onClick={() => onJump(i)}
                aria-label={`Jump to slide ${i + 1}`}
                aria-current={i === index ? "true" : undefined}
                className={cn(
                  "size-2 border border-border transition-colors",
                  i === index
                    ? "bg-foreground border-foreground"
                    : i < index
                      ? "bg-muted-foreground/40"
                      : "bg-transparent",
                )}
              />
            </li>
          ))}
        </ul>

        <button
          type="button"
          onClick={onNext}
          disabled={index === count - 1}
          className="font-display text-[10px] uppercase tracking-widest text-muted-foreground hover:text-foreground disabled:opacity-30"
          aria-label="Next slide"
        >
          NEXT ›
        </button>
      </footer>

      <p
        aria-hidden
        className="pointer-events-none fixed inset-x-0 bottom-12 z-10 text-center font-mono text-[9px] uppercase tracking-widest text-muted-foreground/40"
      >
        click · space · → to advance
      </p>
    </>
  );
}
