import type { HarnessKey } from "./mood-palettes";

/**
 * Curated harness roster for `/spawn` — Phase 3 of agents-ui-mods.md §3.5.
 *
 * Replaces `frontend/src/lib/agents/coming-soon.ts` (deleted in this phase).
 * This is the *visual* roster source-of-truth; it defines order, vendor /
 * description copy, and which harnesses are advertised as `LOCKED` vs
 * available. The live `listAgentTemplates` RPC is the runtime source-of-
 * truth for what can actually be spawned — the spawn page joins these two
 * by `key` ↔ `template.name.toLowerCase()`.
 *
 * Six entries (operator confirmed Q11/Q13). Layout absorbs cleanly: 6 =
 * 2×3 on `md+`, 3×2 on `xl+`, both balanced grids.
 */

export type HarnessStatus = "available" | "locked";

export type HarnessEntry = {
  /** Stable identifier used as `MoodPalette` lookup + matched against `template.name.toLowerCase()`. */
  readonly key: HarnessKey;
  /** Display name in the card header — title-cased. */
  readonly name: string;
  /** Vendor / origin label (spec-sheet `VENDOR` row on locked cards). */
  readonly vendor: string;
  /** One-line summary rendered as the card body's lede. */
  readonly description: string;
  /** Determines whether the available or locked variant of `<HarnessSlide>` renders. */
  readonly status: HarnessStatus;
  /** Optional ETA hint for locked cards (decision §3.5: "ETA where known"). */
  readonly eta?: string;
};

/**
 * Order matches the §3.5 table. Hermes first (the only `available` entry
 * in v1; everything else is `locked`).
 */
export const HARNESSES: readonly HarnessEntry[] = [
  {
    key: "hermes",
    name: "Hermes Agent",
    vendor: "Nous Research",
    description:
      "Hand-written adapter wrapping the upstream image; CORELLIA_* env vars translated to harness-native names at boot.",
    status: "available",
  },
  {
    key: "openclaw",
    name: "OpenClaw",
    // Operator-anchored entry; vendor + one-liner pending. Placeholder copy
    // ships per §1.1 Q13 ("non-blocking; the card renders with placeholder
    // copy and gets backfilled").
    vendor: "TBD",
    description:
      "Operator-anchored entry. Vendor + capability summary backfilled in a follow-up.",
    status: "locked",
  },
  {
    key: "claude-agent-sdk",
    name: "Claude Agent SDK",
    vendor: "Anthropic",
    description:
      "General-purpose harness with automatic context compaction, file ops, code execution, and MCP extensibility. Anthropic-native.",
    status: "locked",
  },
  {
    key: "deepagents",
    name: "DeepAgents",
    vendor: "LangChain",
    description:
      "Opinionated context-management + long-term memory + observability harness on LangGraph. Model-agnostic — works with any tool-calling LLM.",
    status: "locked",
  },
  {
    key: "superagi",
    name: "SuperAGI",
    vendor: "SuperAGI",
    description:
      "Multi-agent orchestration framework. Dedicated memory + planning per agent; parallel specialist agents working off shared state.",
    status: "locked",
  },
  {
    key: "openfang",
    name: "OpenFang",
    vendor: "OpenFang",
    description:
      "Rust-based Agent Operating System. 7 autonomous Hands, 38 built-in tools, 40 messaging channels, 26+ LLM providers.",
    status: "locked",
  },
];
