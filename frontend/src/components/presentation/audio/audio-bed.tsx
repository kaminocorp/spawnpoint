"use client";

/**
 * Phase 5 audio scaffold.
 *
 * Two layers per the polish plan:
 *   - ambient bed: low-frequency drone playing across the whole deck
 *   - per-slide cues: short stings on slide-1 landing, slide-6 mic-drop,
 *     slide-7 swell
 *
 * **No audio assets ship with this scaffold.** The plan owners (ops)
 * decide the voice + bed in Phase 5; this component is the slot they
 * drop files into when they do.
 *
 * Wiring contract: `<AudioBed bedSrc=... />` mounted by `<Deck>` and
 * `<SlideCue src=... />` instances dropped per-slide. A missing `src`
 * is a no-op — the component silently renders nothing rather than
 * erroring, so the deck plays correctly even before audio lands.
 */
export function AudioBed({
  bedSrc,
  enabled = true,
}: {
  bedSrc?: string;
  enabled?: boolean;
}) {
  if (!bedSrc || !enabled) return null;
  return (
    <audio
      src={bedSrc}
      autoPlay
      loop
      ref={(el: HTMLAudioElement | null) => {
        // Browsers gate autoplay; conservative volume so first-frame
        // play-through doesn't rip if the gate releases mid-deck.
        if (el) el.volume = 0.18;
      }}
      preload="auto"
    />
  );
}

export function SlideCue({ src, key }: { src?: string; key?: string | number }) {
  if (!src) return null;
  return (
    <audio
      key={key}
      src={src}
      autoPlay
      ref={(el: HTMLAudioElement | null) => {
        if (el) el.volume = 0.65;
      }}
      preload="auto"
    />
  );
}
