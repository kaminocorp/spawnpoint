# Presentation: PolicyCheckpoint Scan Line Fix

## What changed

**`frontend/src/components/presentation/scenes/policy-checkpoint.tsx`**

Added `animation: checkpoint-scan-sweep ${STAGGER_MS}ms linear infinite` to the `.checkpoint-scan` CSS rule.

## Why

The `@keyframes checkpoint-scan-sweep` animation was fully defined and already listed in the `prefers-reduced-motion` suppression rule, but the `animation` property was never applied to `.checkpoint-scan`. The scan line rendered as a static gradient instead of sweeping through the checkpoint diamond.

## Result

The scan line now sweeps from top → centre → bottom continuously at 1900ms per cycle (matching `STAGGER_MS`), with the centre-dwell window (40–60%) aligned with when capsules pause at the gate (42–58% in `capsule-pass`/`capsule-deny`).
