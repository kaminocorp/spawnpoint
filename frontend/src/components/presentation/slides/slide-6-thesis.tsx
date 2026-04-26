"use client";

/**
 * Slide 6 — THESIS · "Deployment is a commodity. Governance is the product."
 *
 * The strategic mic-drop. Black screen, white text, **nothing else**.
 * Stillness is the design choice — every other slide moves; this
 * one doesn't, and the contrast lands the line.
 *
 * Two fades only: line one in (0.6s), hold (1s), line two in (0.6s),
 * both hold ~4s. No kicker, no subline. If review feels self-
 * important, the fallback is to cut this slide and ship 6.
 */
export function SlideThesis() {
  return (
    <div className="flex size-full min-h-[70vh] w-full max-w-5xl flex-col items-center justify-center gap-6">
      <p
        className="thesis-line-1 text-center font-display text-3xl font-black uppercase tracking-[0.12em] text-muted-foreground sm:text-5xl"
        style={{ animation: "thesis-fade-1 0.6s ease-out forwards" }}
      >
        Deployment is a commodity.
      </p>
      <p
        className="thesis-line-2 text-center font-display text-4xl font-black uppercase tracking-[0.12em] text-foreground sm:text-6xl"
        style={{ animation: "thesis-fade-2 0.6s ease-out 1.6s forwards" }}
      >
        Governance is the product.
      </p>

      <style>{`
        .thesis-line-1, .thesis-line-2 { opacity: 0; }
        @keyframes thesis-fade-1 {
          from { opacity: 0; transform: translateY(8px); }
          to   { opacity: 1; transform: translateY(0); }
        }
        @keyframes thesis-fade-2 {
          from { opacity: 0; transform: translateY(8px); }
          to   { opacity: 1; transform: translateY(0); }
        }
        @media (prefers-reduced-motion: reduce) {
          .thesis-line-1, .thesis-line-2 {
            opacity: 1 !important;
            transform: none !important;
            animation: none !important;
          }
        }
      `}</style>
    </div>
  );
}
