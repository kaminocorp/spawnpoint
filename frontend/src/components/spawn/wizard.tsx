"use client";

import { useEffect, useReducer, useState } from "react";
import { useRouter } from "next/navigation";
import {
  useForm,
  useWatch,
  type UseFormRegisterReturn,
} from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { ConnectError } from "@connectrpc/connect";
import { z } from "zod";
import { EyeIcon, EyeOffIcon, KeyIcon } from "lucide-react";

import { NebulaAvatar } from "@/components/spawn/nebula-avatar";
import { HarnessCarousel } from "@/components/spawn/harness-carousel";
import { CharacterSheet, type StatRow } from "@/components/spawn/character-sheet";
import { ReadyToLaunch } from "@/components/spawn/ready-to-launch";
import {
  ToolsStep,
  toolsetMapToGrants,
  toolsetSummaryRows,
  type ToolsetStateMap,
} from "@/components/spawn/steps/tools-step";
import { listTools, setInstanceToolGrants } from "@/lib/api/tools";
import {
  DeploymentConfigForm,
  type DeploymentFormValues,
  type DeploymentLabelOverrides,
} from "@/components/fleet/deployment-config-form";
import { type PlacementState } from "@/components/fleet/placement-banner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  TerminalContainer,
  type TerminalAccent,
} from "@/components/ui/terminal-container";
import type {
  AgentTemplate,
  DeployConfig,
} from "@/gen/corellia/v1/agents_pb";
import { ModelProvider } from "@/gen/corellia/v1/agents_pb";
import { createApiClient } from "@/lib/api/client";
import { HARNESSES, type HarnessEntry } from "@/lib/spawn/harnesses";
import { type HarnessKey } from "@/lib/spawn/mood-palettes";
import {
  DEFAULT_DEPLOYMENT_VALUES,
  describeSize,
} from "@/lib/spawn/deployment-presets";

/**
 * `<Wizard>` — Phases 4 + 5 of `docs/executing/agents-ui-mods.md`.
 *
 * Six-step character-creation flow at `/spawn/[templateId]` — HARNESS →
 * IDENTITY → MODEL → TOOLS → DEPLOYMENT → REVIEW. Phase 4 delivered the
 * shell + gating logic; Phase 5 wired real fields and the `spawnAgent`
 * RPC; v1.5 Pillar B Phase 4 inserted the TOOLS step between MODEL and
 * DEPLOYMENT. The wizard's contract on the wire is identical to
 * the M4 deploy-modal — same `spawnAgent` request, same redirect to
 * `/fleet` on success. The streaming-log surface (decision 14) is a UI
 * affordance over the same single RPC; no proto change.
 *
 * State is in-memory only (decision 8 / Q3 — refresh resets). The
 * route segment carries the harness selection; everything past Step 1
 * lives here in `useReducer`. No `useSearchParams`, no localStorage —
 * the API key MUST never persist outside the in-flight RPC, and the
 * simplest way to honor that is to make the entire wizard ephemeral
 * (decision 20).
 *
 * Per decision 21, exactly one `<NebulaAvatar>` `<Canvas>` mounts on
 * this route — Step 1's confirmation panel.
 */

const STEPS = [
  "harness",
  "identity",
  "model",
  "tools",
  "deployment",
  "review",
] as const;
type StepKey = (typeof STEPS)[number];

const STEP_META: Record<
  StepKey,
  { ordinal: number; label: string; accent: TerminalAccent }
> = {
  // Accent assignments per plan §4 Phase 4: MODEL → violet, DEPLOYMENT
  // → blue, TOOLS → amber (the v1.5 Pillar B feature color).
  harness: { ordinal: 1, label: "HARNESS", accent: "catalog" },
  identity: { ordinal: 2, label: "IDENTITY", accent: "secrets" },
  model: { ordinal: 3, label: "MODEL", accent: "adapter" },
  tools: { ordinal: 4, label: "TOOLS", accent: "tools" },
  deployment: { ordinal: 5, label: "DEPLOYMENT", accent: "deploy" },
  review: { ordinal: 6, label: "REVIEW", accent: "running" },
};

type ProviderValue = "anthropic" | "openai" | "openrouter";

const PROVIDERS: ReadonlyArray<{
  value: ProviderValue;
  label: string;
  proto: ModelProvider;
}> = [
  { value: "anthropic", label: "Anthropic", proto: ModelProvider.ANTHROPIC },
  { value: "openai", label: "OpenAI", proto: ModelProvider.OPENAI },
  { value: "openrouter", label: "OpenRouter", proto: ModelProvider.OPENROUTER },
];

type WizardFields = {
  name: string;
  provider: ProviderValue;
  modelName: string;
  apiKey: string;
  /** Phase 6: full DeployConfig values collected by Step 4. Sent on the wire. */
  deployment: DeploymentFormValues;
  /**
   * v1.5 Pillar B Phase 4: per-toolset equip state, scope JSON, and the
   * raw credential value the operator pasted (forwarded once, never
   * persisted client-side). Keyed by toolset_key.
   */
  toolsets: ToolsetStateMap;
};

const INITIAL_FIELDS: WizardFields = {
  name: "",
  provider: "anthropic",
  modelName: "",
  apiKey: "",
  deployment: DEFAULT_DEPLOYMENT_VALUES,
  toolsets: {},
};

type WizardState = {
  current: StepKey;
  confirmed: ReadonlySet<StepKey>;
  fields: WizardFields;
  /** Phase 1 of redesign-spawn.md: discriminates gallery vs confirmed entry. */
  harnessMode: "gallery" | "confirmed";
};

type WizardAction =
  | { type: "confirm"; step: StepKey }
  | { type: "edit"; step: StepKey }
  | { type: "setField"; patch: Partial<WizardFields> };

/**
 * State factory — shared by both route entry points so drift between the
 * two mount paths is impossible (redesign-spawn.md Phase 1, risk note).
 *
 * gallery  → Step 1 active, nothing confirmed; renders the harness grid.
 * confirmed → Step 1 already confirmed, Step 2 active; the user came from
 *             the gallery or a direct `/spawn/[id]` deep-link.
 */
function getInitialState(mode: "gallery" | "confirmed"): WizardState {
  if (mode === "gallery") {
    return {
      current: "harness",
      confirmed: new Set(),
      fields: INITIAL_FIELDS,
      harnessMode: "gallery",
    };
  }
  return {
    current: "identity",
    confirmed: new Set<StepKey>(["harness"]),
    fields: INITIAL_FIELDS,
    harnessMode: "confirmed",
  };
}

function reducer(state: WizardState, action: WizardAction): WizardState {
  switch (action.type) {
    case "confirm": {
      const idx = STEPS.indexOf(action.step);
      // Last step's "confirm" doesn't advance — the deploy submission
      // owns the transition (the streaming-log surface replaces the
      // wizard chrome). The reducer just marks confirmed and stays.
      const next = STEPS[idx + 1] ?? action.step;
      const confirmed = new Set(state.confirmed);
      confirmed.add(action.step);
      return { ...state, confirmed, current: next };
    }
    case "edit": {
      // Decision 9: editing a confirmed step un-confirms it AND every
      // step downstream. Prevents stale-config submissions.
      const idx = STEPS.indexOf(action.step);
      const confirmed = new Set<StepKey>();
      for (const s of state.confirmed) {
        if (STEPS.indexOf(s) < idx) confirmed.add(s);
      }
      return { ...state, confirmed, current: action.step };
    }
    case "setField":
      return { ...state, fields: { ...state.fields, ...action.patch } };
  }
}

type FetchState =
  | { kind: "loading" }
  | {
      kind: "ready";
      template: AgentTemplate;
      harness: HarnessEntry | undefined;
    }
  | { kind: "ready-gallery"; templates: AgentTemplate[] }
  | { kind: "not-found" }
  | { kind: "error"; message: string };

type DeployState =
  | { kind: "idle" }
  | { kind: "deploying"; lines: string[] }
  | { kind: "succeeded"; lines: string[] }
  | { kind: "error"; lines: string[]; message: string };

export function Wizard({
  templateId,
  initialMode,
}: {
  templateId?: string;
  initialMode: "gallery" | "confirmed";
}) {
  const [fetchState, setFetchState] = useState<FetchState>({ kind: "loading" });
  const [state, dispatch] = useReducer(reducer, initialMode, getInitialState);
  const [deploy, setDeploy] = useState<DeployState>({ kind: "idle" });
  const router = useRouter();

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const api = createApiClient();
        const res = await api.agents.listAgentTemplates({});
        if (cancelled) return;
        if (initialMode === "gallery") {
          setFetchState({ kind: "ready-gallery", templates: res.templates });
          return;
        }
        if (!templateId) {
          setFetchState({ kind: "not-found" });
          return;
        }
        const template = res.templates.find((t) => t.id === templateId);
        if (!template) {
          setFetchState({ kind: "not-found" });
          return;
        }
        const harness = HARNESSES.find(
          (h) => h.key === template.name.toLowerCase(),
        );
        setFetchState({ kind: "ready", template, harness });
      } catch (e) {
        if (cancelled) return;
        const err = ConnectError.from(e);
        setFetchState({ kind: "error", message: err.message });
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [initialMode, templateId]);

  if (fetchState.kind === "loading") return <WizardSkeleton />;
  if (fetchState.kind === "error") return <WizardError message={fetchState.message} />;
  if (fetchState.kind === "not-found") return <WizardNotFound id={templateId ?? ""} />;
  if (fetchState.kind === "ready-gallery") {
    return <GalleryWizardShell templates={fetchState.templates} />;
  }

  const { template, harness } = fetchState;

  // Once deploy starts, the wizard chrome is replaced by the streaming
  // log surface. The reducer state stays put underneath in case the
  // operator hits a deploy error and we want to surface their config
  // again — today the error branch shows a Retry that returns to Step 5.
  if (deploy.kind !== "idle") {
    return (
      <DeployLog
        deploy={deploy}
        templateName={harness?.name ?? template.name}
        onRetry={() => setDeploy({ kind: "idle" })}
      />
    );
  }

  async function onDeploy() {
    setDeploy({ kind: "deploying", lines: ["› creating fly app…"] });
    try {
      const api = createApiClient();
      const proto = PROVIDERS.find((p) => p.value === state.fields.provider);
      if (!proto) throw new Error(`unknown provider: ${state.fields.provider}`);

      // Resolve toolset → tool_id mapping BEFORE spawn. Hoisting this above
      // spawnAgent closes the post-spawn orphan window — if the catalog
      // round-trip failed after spawn, we'd land in the outer catch with a
      // running Fly app and no rollback. With the lookup hoisted, a catalog
      // failure errors out before any Fly resource exists, and the operator
      // sees a clean "could not load toolset catalog" message.
      const equippedCount = Object.values(state.fields.toolsets).filter(
        (t) => t.equipped,
      ).length;
      let toolIdByKey: Record<string, string> = {};
      if (equippedCount > 0) {
        toolIdByKey = await fetchToolIdsByKey(api, template.harnessAdapterId);
      }

      const spawnRes = await api.agents.spawnAgent({
        templateId: template.id,
        name: state.fields.name,
        provider: proto.proto,
        modelName: state.fields.modelName,
        modelApiKey: state.fields.apiKey,
        deployConfig: deployConfigFromFields(state.fields.deployment),
      });
      const instance = spawnRes.instance;
      if (!instance) throw new Error("spawnAgent returned no instance");

      // v1.5 Pillar B Phase 4: equip the granted toolsets on the freshly
      // spawned instance. Plan §3 Phase 4 deliverable 1: if the grants
      // write fails, the instance is destroyed (single-shot rollback) and
      // the operator is bounced back with an error.
      if (equippedCount > 0) {
        const grants = toolsetMapToGrants(state.fields.toolsets, toolIdByKey);
        try {
          await setInstanceToolGrants(api.tools, {
            instanceId: instance.id,
            grants,
          });
        } catch (grantErr) {
          // Rollback: destroy the instance so a half-configured agent
          // doesn't leak. Surface BOTH the original grant error and (on a
          // failed rollback) the destroy failure — silently swallowing the
          // rollback failure used to leave orphan Fly apps invisible.
          try {
            await api.agents.destroyAgentInstance({ id: instance.id });
          } catch (rbErr) {
            const rbMsg = ConnectError.from(rbErr).message;
            console.error(
              "wizard: rollback destroyAgentInstance failed; orphan Fly app may exist",
              rbErr,
            );
            // Append a warning to the streaming log so the operator sees
            // the orphan-cleanup hint immediately. The outer catch flips to
            // the error state shortly after; this log line carries forward.
            setDeploy((prev) => {
              if (prev.kind !== "deploying") return prev;
              return {
                kind: "deploying",
                lines: [
                  ...prev.lines,
                  `› warning: rollback destroy failed — manual cleanup may be required (${rbMsg})`,
                ],
              };
            });
          }
          throw grantErr;
        }
      }

      // Transition out of "deploying" before navigating so the
      // synthetic-log interval's cleanup runs deterministically. The
      // log surface stays mounted (still non-idle) so no flash of the
      // wizard chrome — DeployLog just stops ticking until /fleet
      // mounts and unmounts this tree entirely.
      setDeploy((prev) => ({
        kind: "succeeded",
        lines: prev.kind === "deploying" ? prev.lines : [],
      }));
      router.push("/fleet");
    } catch (e) {
      const err = ConnectError.from(e);
      const errorLine = `› error: ${err.message}`;
      setDeploy((prev) => {
        const prevLines =
          prev.kind === "deploying" || prev.kind === "error" ? prev.lines : [];
        return {
          kind: "error",
          lines: [...prevLines, errorLine],
          message: err.message,
        };
      });
    }
  }

  return (
    <div className="mx-auto min-w-0 w-full max-w-[112rem] 2xl:max-w-[128rem] space-y-8">
      <RpgHeader harness={harness} template={template} state={state} />
      <RpgBody
        harness={harness}
        template={template}
        state={state}
        dispatch={dispatch}
        onDeploy={onDeploy}
      />
    </div>
  );
}

/* ─── GALLERY MODE (Phase 1 of redesign-spawn.md) ────────────────── */

/**
 * Wizard shell for `initialMode="gallery"` — shown at `/spawn` (no
 * templateId). Step 1 is active and renders `<HarnessCarousel>`; Steps 2–5
 * are visible but `inert`/PENDING shells so the operator sees the shape of
 * the flow before selecting a harness.
 *
 * `<HarnessCarousel>`'s `onSelect` callback issues `router.replace` to
 * `/spawn/[templateId]`, which remounts the Wizard in `confirmed` mode with
 * Step 1 already confirmed and Step 2 active. `router.replace` is
 * intentional: it keeps the back-button history clean (no gallery-on-back
 * trap from /spawn/[id]).
 */
function GalleryWizardShell({ templates }: { templates: AgentTemplate[] }) {
  const [activeKey, setActiveKey] = useState<string>(HARNESSES[0].key);
  const router = useRouter();

  return (
    <div className="mx-auto min-w-0 w-full max-w-[96rem] space-y-6">
      <header className="border-b border-border pb-4">
        <div className="font-display text-xs uppercase tracking-widest text-muted-foreground/60">
          [ SELECT YOUR HARNESS ]
        </div>
        <h1 className="mt-1 font-display text-2xl font-bold uppercase tracking-widest text-foreground">
          SPAWN
        </h1>
      </header>
      <HarnessCarousel
        harnesses={HARNESSES}
        templates={templates}
        activeKey={activeKey}
        onActiveChange={setActiveKey}
        onSelect={(templateId) => router.replace(`/spawn/${templateId}`)}
      />
    </div>
  );
}



type StepBodyProps = {
  step: StepKey;
  state: WizardState;
  dispatch: React.Dispatch<WizardAction>;
  template: AgentTemplate;
  harness: HarnessEntry | undefined;
  isCurrent: boolean;
  isConfirmed: boolean;
  onDeploy: () => void;
};

function StepBody(props: StepBodyProps) {
  switch (props.step) {
    case "harness":
      return <HarnessStep {...props} />;
    case "identity":
      return <IdentityStep {...props} />;
    case "model":
      return <ModelStep {...props} />;
    case "tools":
      return <ToolsStepBody {...props} />;
    case "deployment":
      return <DeploymentStep {...props} />;
    case "review":
      return <ReviewStep {...props} />;
  }
}

/* ─── STEP 4 // TOOLS (v1.5 Pillar B Phase 4) ─────────────────────── */

function ToolsStepBody({
  state,
  dispatch,
  template,
  isCurrent,
}: StepBodyProps) {
  if (!isCurrent) {
    return <ConfirmedSummary rows={toolsetSummaryRows(state.fields.toolsets)} />;
  }
  return (
    <ToolsStep
      harnessAdapterId={template.harnessAdapterId}
      value={state.fields.toolsets}
      isCurrent={isCurrent}
      onConfirm={(next) => {
        dispatch({ type: "setField", patch: { toolsets: next } });
        dispatch({ type: "confirm", step: "tools" });
      }}
    />
  );
}

/* ─── STEP 1 // HARNESS ───────────────────────────────────────────── */

function HarnessStep({
  template,
  harness,
  isCurrent,
  isConfirmed,
  dispatch,
}: StepBodyProps) {
  // Confirmed-not-current — compact horizontal row card per
  // redesign-spawn.md §3 note 2. The full 180px nebula moves to the
  // review portrait in Step 5; here a 56px avatar + spec rows is enough
  // to anchor "this is the harness you picked" without re-mounting the
  // canvas.
  if (isConfirmed && !isCurrent) {
    return (
      <div className="flex items-center gap-4">
        <div className="flex shrink-0 items-center justify-center bg-black/40 p-1.5">
          {harness ? (
            <NebulaAvatar harness={harness.key} size={56} />
          ) : (
            <div className="size-14 border border-border" />
          )}
        </div>
        <div className="flex-1">
          <div className="font-mono text-sm text-foreground">
            {harness?.name ?? template.name}
          </div>
          <div className="font-mono text-[11px] uppercase tracking-wider text-muted-foreground/70">
            from · {harness?.vendor ?? "—"} · adapter · hand-written
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-4">
      <div className="flex flex-col gap-4 sm:flex-row sm:items-start">
        <div className="flex shrink-0 items-center justify-center bg-black/40 p-2">
          {harness ? (
            <NebulaAvatar harness={harness.key} size={180} />
          ) : (
            <div className="size-[180px] border border-border" />
          )}
        </div>
        <div className="flex-1 space-y-3">
          <div>
            <div className="font-display text-[11px] uppercase tracking-widest text-muted-foreground/70">
              HARNESS
            </div>
            <div className="mt-1 font-mono text-base text-foreground">
              {harness?.name ?? template.name}
            </div>
          </div>
          {(template.description || harness?.description) && (
            <p className="text-sm leading-relaxed text-muted-foreground">
              {template.description || harness?.description}
            </p>
          )}
          <dl className="space-y-1 font-mono text-xs">
            <SpecRow label="FROM" value={harness?.vendor ?? "—"} />
            <SpecRow label="ADAPTER" value="hand-written" />
            <SpecRow label="TEMPLATE" value={template.id} />
          </dl>
        </div>
      </div>

      {isCurrent && !isConfirmed && (
        <div className="flex items-center justify-end gap-2 border-t border-border pt-3">
          <Button
            size="sm"
            onClick={() => dispatch({ type: "confirm", step: "harness" })}
          >
            › CONFIRM
          </Button>
        </div>
      )}
    </div>
  );
}

/* ─── STEP 2 // IDENTITY (callsign card) ──────────────────────────── */

const identitySchema = z.object({
  name: z.string().trim().min(1, "Required").max(80, "Up to 80 characters"),
});
type IdentityValues = z.infer<typeof identitySchema>;

const CALLSIGN_PLACEHOLDERS = ["obi-1", "bb-9", "kessel-runner"] as const;

function IdentityStep({ state, dispatch, isCurrent }: StepBodyProps) {
  if (!isCurrent) {
    return (
      <ConfirmedSummary
        rows={[{ label: "CALLSIGN", value: state.fields.name || "—" }]}
      />
    );
  }

  return (
    <IdentityForm
      defaultValue={state.fields.name}
      onSubmit={(v) => {
        dispatch({ type: "setField", patch: { name: v.name } });
        dispatch({ type: "confirm", step: "identity" });
      }}
    />
  );
}

function IdentityForm({
  defaultValue,
  onSubmit,
}: {
  defaultValue: string;
  onSubmit: (v: IdentityValues) => void;
}) {
  const form = useForm<IdentityValues>({
    resolver: zodResolver(identitySchema),
    defaultValues: { name: defaultValue },
  });
  const liveName = useWatch({ control: form.control, name: "name" }) ?? "";
  const placeholder = useRotatingPlaceholder(CALLSIGN_PLACEHOLDERS);
  const errMsg = form.formState.errors.name?.message;
  const display = (liveName.trim() || "—").toUpperCase();

  return (
    <form onSubmit={form.handleSubmit(onSubmit)} noValidate className="space-y-4">
      <div className="space-y-2">
        <div className="font-display text-[11px] uppercase tracking-widest text-muted-foreground/70">
          [ ASSIGN CALLSIGN ]
        </div>
        <input
          id="name"
          autoFocus
          placeholder={placeholder}
          aria-invalid={!!errMsg}
          aria-label="Agent callsign"
          className="w-full border-0 border-b border-border/60 bg-transparent px-0 py-2 font-display text-2xl uppercase tracking-widest text-foreground placeholder:text-muted-foreground/40 focus:border-[hsl(var(--feature-secrets))] focus:outline-none"
          {...form.register("name")}
        />
        <div className="flex items-center justify-between font-mono text-[11px] uppercase tracking-wider text-muted-foreground/70">
          <span>OPERATOR LABEL</span>
          <span className="text-foreground/80">{display}</span>
        </div>
        {errMsg && <p className="text-sm text-destructive">{errMsg}</p>}
      </div>
      <div className="flex items-center justify-end gap-2 border-t border-border pt-3">
        <Button size="sm" type="submit">
          › CONFIRM
        </Button>
      </div>
    </form>
  );
}

/**
 * Cycle through `values` every ~2.4s for the input's placeholder. Pure
 * cosmetic: the values are never inserted as the actual field value.
 */
function useRotatingPlaceholder(values: ReadonlyArray<string>): string {
  const [idx, setIdx] = useState(0);
  useEffect(() => {
    const id = setInterval(() => setIdx((i) => (i + 1) % values.length), 2400);
    return () => clearInterval(id);
  }, [values.length]);
  return values[idx] ?? "";
}

/* ─── STEP 3 // MODEL (faction × class) ───────────────────────────── */

const modelSchema = z.object({
  provider: z.enum(["anthropic", "openai", "openrouter"], {
    message: "Pick a provider",
  }),
  modelName: z
    .string()
    .trim()
    .min(1, "Required")
    .max(200, "Up to 200 characters"),
  apiKey: z.string().min(1, "Required"),
});
type ModelValues = z.infer<typeof modelSchema>;

const PROVIDER_FACTIONS: Record<
  ProviderValue,
  { glyph: string; tagline: string; modelExample: string }
> = {
  anthropic: {
    glyph: "Α",
    tagline: "Careful and considered.",
    modelExample: "claude-opus-4-7",
  },
  openai: {
    glyph: "Ω",
    tagline: "Generalist with reach.",
    modelExample: "gpt-5",
  },
  openrouter: {
    glyph: "✦",
    tagline: "Any model, any provider.",
    modelExample: "meta-llama/llama-4-405b-instruct",
  },
};

function ModelStep({ state, dispatch, isCurrent }: StepBodyProps) {
  if (!isCurrent) {
    return (
      <ConfirmedSummary
        rows={[
          { label: "FACTION", value: providerLabel(state.fields.provider) },
          { label: "CLASS", value: state.fields.modelName || "—" },
          { label: "SIGIL", value: maskApiKey(state.fields.apiKey) },
        ]}
      />
    );
  }

  return (
    <ModelForm
      defaults={{
        provider: state.fields.provider,
        modelName: state.fields.modelName,
        apiKey: state.fields.apiKey,
      }}
      onSubmit={(v) => {
        dispatch({
          type: "setField",
          patch: {
            provider: v.provider,
            modelName: v.modelName,
            apiKey: v.apiKey,
          },
        });
        dispatch({ type: "confirm", step: "model" });
      }}
    />
  );
}

function ModelForm({
  defaults,
  onSubmit,
}: {
  defaults: ModelValues;
  onSubmit: (v: ModelValues) => void;
}) {
  const form = useForm<ModelValues>({
    resolver: zodResolver(modelSchema),
    defaultValues: defaults,
  });
  const provider = useWatch({ control: form.control, name: "provider" });
  const [showKey, setShowKey] = useState(false);
  const faction = PROVIDER_FACTIONS[provider];
  const modelErr = form.formState.errors.modelName?.message;
  const apiKeyErr = form.formState.errors.apiKey?.message;

  return (
    <form onSubmit={form.handleSubmit(onSubmit)} noValidate className="space-y-6">
      <FactionPicker
        value={provider}
        onChange={(v) => form.setValue("provider", v, { shouldValidate: true })}
        error={form.formState.errors.provider?.message}
      />

      <div className="space-y-2">
        <div className="font-display text-[11px] uppercase tracking-widest text-muted-foreground/70">
          [ SELECT CLASS ]
        </div>
        <input
          id="modelName"
          placeholder={faction.modelExample}
          aria-invalid={!!modelErr}
          aria-label="Model identifier"
          className="w-full border-0 border-b border-border/60 bg-transparent px-0 py-2 font-display text-xl uppercase tracking-wider text-foreground placeholder:text-muted-foreground/40 focus:border-[hsl(var(--feature-adapter))] focus:outline-none"
          {...form.register("modelName")}
        />
        {modelErr ? (
          <p className="text-sm text-destructive">{modelErr}</p>
        ) : (
          <p className="font-mono text-[11px] uppercase tracking-wider text-muted-foreground/70">
            example · {faction.modelExample}
          </p>
        )}
      </div>

      <SigilField
        showKey={showKey}
        onToggleShow={() => setShowKey((s) => !s)}
        error={apiKeyErr}
        register={form.register("apiKey")}
      />

      <div className="flex items-center justify-end gap-2 border-t border-border pt-3">
        <Button size="sm" type="submit">
          › CONFIRM
        </Button>
      </div>
    </form>
  );
}

function FactionPicker({
  value,
  onChange,
  error,
}: {
  value: ProviderValue;
  onChange: (v: ProviderValue) => void;
  error?: string;
}) {
  return (
    <div className="space-y-2">
      <div className="font-display text-[11px] uppercase tracking-widest text-muted-foreground/70">
        [ CHOOSE FACTION ]
      </div>
      <div
        role="radiogroup"
        aria-label="Provider"
        className="grid grid-cols-1 gap-2 sm:grid-cols-3 lg:grid-cols-1"
      >
        {PROVIDERS.map((p) => {
          const active = p.value === value;
          const f = PROVIDER_FACTIONS[p.value];
          return (
            <button
              key={p.value}
              type="button"
              role="radio"
              aria-checked={active}
              onClick={() => onChange(p.value)}
              className={
                "flex min-w-0 flex-col items-start gap-1.5 border bg-card px-3 py-3 text-left transition " +
                (active
                  ? "border-[hsl(var(--feature-adapter))] bg-[hsl(var(--feature-adapter))]/10 opacity-100"
                  : "border-border opacity-40 hover:opacity-100 hover:border-[hsl(var(--feature-adapter))]/60")
              }
            >
              <div className="flex w-full min-w-0 items-start justify-between gap-2">
                <span className="min-w-0 font-display text-sm font-bold uppercase tracking-[0.18em] text-foreground">
                  {p.label}
                </span>
                <span
                  className={
                    "shrink-0 font-display text-base " +
                    (active
                      ? "text-[hsl(var(--feature-adapter))]"
                      : "text-muted-foreground")
                  }
                >
                  {f.glyph}
                </span>
              </div>
              <p className="max-w-[20ch] text-xs text-muted-foreground">
                {f.tagline}
              </p>
            </button>
          );
        })}
      </div>
      {error && <p className="text-sm text-destructive">{error}</p>}
    </div>
  );
}

function SigilField({
  showKey,
  onToggleShow,
  error,
  register,
}: {
  showKey: boolean;
  onToggleShow: () => void;
  error?: string;
  register: UseFormRegisterReturn;
}) {
  return (
    <div className="space-y-2">
      <div className="flex items-center gap-2 font-display text-[11px] uppercase tracking-widest text-muted-foreground/70">
        <KeyIcon className="size-3.5 text-[hsl(var(--feature-secrets))]" />
        [ PROVIDE YOUR SIGIL ]
      </div>
      <div className="relative">
        <Input
          id="apiKey"
          type={showKey ? "text" : "password"}
          autoComplete="off"
          placeholder="sk-…"
          aria-invalid={!!error}
          aria-label="API key"
          className="pr-10 font-mono"
          {...register}
        />
        <button
          type="button"
          onClick={onToggleShow}
          className="absolute right-2 top-1/2 -translate-y-1/2 rounded p-1 text-muted-foreground hover:text-foreground"
          aria-label={showKey ? "Hide API key" : "Show API key"}
        >
          {showKey ? (
            <EyeOffIcon className="size-4" />
          ) : (
            <EyeIcon className="size-4" />
          )}
        </button>
      </div>
      <p className="text-sm text-muted-foreground">
        Forwarded once to the agent&apos;s secret store. Never written to
        Corellia&apos;s database.
      </p>
      {error && <p className="text-sm text-destructive">{error}</p>}
    </div>
  );
}

/* ─── STEP 5 // DEPLOYMENT (loadout panel) ────────────────────────── */

const LOADOUT_LABEL_OVERRIDES: DeploymentLabelOverrides = {
  region: "[ THEATRE ]",
  size: "[ ARMOR ]",
  volumeSizeGb: "[ SUPPLY ]",
  desiredReplicas: "[ SQUAD ]",
  restartPolicy: "[ DOCTRINE ]",
  lifecycleMode: "[ MODE ]",
};

function DeploymentStep({ state, dispatch, isCurrent }: StepBodyProps) {
  if (!isCurrent) {
    return <ConfirmedSummary rows={deploymentSummaryRows(state.fields.deployment)} />;
  }

  return (
    <div className="space-y-4">
      <div className="font-display text-[11px] uppercase tracking-widest text-[hsl(var(--feature-deploy))]">
        [ LOADOUT ]
      </div>
      <p className="text-sm leading-relaxed text-muted-foreground">
        Equip the agent. Theatre and armor lock at deploy; squad, doctrine, and
        mode adjust live from the fleet page. Theatre change destroys and
        respawns the agent.
      </p>
      <DeploymentConfigForm
        defaults={state.fields.deployment}
        labelOverrides={LOADOUT_LABEL_OVERRIDES}
        onSubmit={(v) => {
          dispatch({ type: "setField", patch: { deployment: v } });
          dispatch({ type: "confirm", step: "deployment" });
        }}
      />
    </div>
  );
}

function deploymentSummaryRows(d: DeploymentFormValues): ReadonlyArray<{
  label: string;
  value: string;
}> {
  const restart =
    d.restartPolicy === "on-failure"
      ? `on-failure · ${d.restartMaxRetries} retries`
      : d.restartPolicy;
  return [
    { label: "REGION", value: d.region },
    { label: "SIZE", value: describeSize(d.cpuKind, d.cpus, d.memoryMb) },
    { label: "VOLUME", value: `${d.volumeSizeGb}GB` },
    { label: "REPLICAS", value: String(d.desiredReplicas) },
    { label: "RESTART", value: restart },
    { label: "LIFECYCLE", value: d.lifecycleMode },
    { label: "CHAT", value: d.chatEnabled ? "enabled" : "disabled" },
  ];
}

function deployConfigFromFields(d: DeploymentFormValues): DeployConfig {
  return {
    $typeName: "corellia.v1.DeployConfig",
    region: d.region,
    cpuKind: d.cpuKind,
    cpus: d.cpus,
    memoryMb: d.memoryMb,
    restartPolicy: d.restartPolicy,
    restartMaxRetries: d.restartMaxRetries,
    lifecycleMode: d.lifecycleMode,
    desiredReplicas: d.desiredReplicas,
    volumeSizeGb: d.volumeSizeGb,
    chatEnabled: d.chatEnabled,
  };
}

/* ─── STEP 6 // REVIEW ────────────────────────────────────────────── */

function ReviewStep({
  state,
  template,
  harness,
  isCurrent,
  isConfirmed,
  onDeploy,
}: StepBodyProps) {
  // Review has no "confirmed" summary — the deploy itself is the
  // commitment. If ever displayed in confirmed-not-current mode (which
  // shouldn't happen in normal flow because deploy unmounts the
  // wizard), fall through to the same summary.
  const ready = isCurrent || isConfirmed;

  // Fire CheckDeploymentPlacement once on entry; re-fire when the
  // confirmed deployment config changes (cascading invalidation from
  // an earlier-step edit re-confirms and lands the operator back here
  // with possibly-different values). Step 4 commits via `› CONFIRM`,
  // so no debounce — one round-trip per confirmed config.
  const [placement, setPlacement] = useState<PlacementState>({ kind: "idle" });
  const cfg = state.fields.deployment;
  const cfgKey = JSON.stringify(cfg);

  useEffect(() => {
    if (!isCurrent) return;
    let cancelled = false;
    (async () => {
      // setState lives inside the async IIFE rather than the
      // synchronous effect body — same pattern the codebase uses
      // elsewhere to satisfy `react-hooks/set-state-in-effect`
      // without dropping back to a useSyncExternalStore (which
      // doesn't fit an async fetch).
      if (cancelled) return;
      setPlacement({ kind: "checking" });
      try {
        const api = createApiClient();
        const res = await api.agents.checkDeploymentPlacement({
          deployConfig: deployConfigFromFields(cfg),
        });
        if (cancelled) return;
        const result = res.placementResult;
        if (!result) {
          setPlacement({ kind: "error", message: "no placement result" });
          return;
        }
        setPlacement({
          kind: result.available ? "ok" : "blocked",
          result,
        });
      } catch (e) {
        if (cancelled) return;
        setPlacement({ kind: "error", message: ConnectError.from(e).message });
      }
    })();
    return () => {
      cancelled = true;
    };
    // cfgKey covers the structural identity of cfg; isCurrent guards
    // remount-on-edit. Listing both keeps the dep-array exhaustive
    // without re-triggering on every parent re-render.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [cfgKey, isCurrent]);

  if (!ready) return null;

  const deployBlocked =
    placement.kind === "checking" ||
    placement.kind === "blocked" ||
    placement.kind === "error";

  const identityRows: ReadonlyArray<StatRow> = [
    { label: "HARNESS", value: harness?.name ?? template.name },
    { label: "CALLSIGN", value: state.fields.name || "—" },
  ];
  const intelligenceRows: ReadonlyArray<StatRow> = [
    { label: "FACTION", value: providerLabel(state.fields.provider) },
    { label: "CLASS", value: state.fields.modelName || "—" },
    { label: "SIGIL", value: maskApiKey(state.fields.apiKey) },
  ];
  const loadoutRows: ReadonlyArray<StatRow> = [
    ...toolsetSummaryRows(state.fields.toolsets).map((r) => ({
      label: r.label,
      value: r.value,
    })),
    ...deploymentSummaryRows(cfg).map((r) => ({
      label: r.label,
      value: r.value,
    })),
  ];

  const summary =
    cfg.desiredReplicas === 1
      ? `Deploying spins up one Fly machine in ${cfg.region} and lands you on the fleet view.`
      : `Deploying spins up ${cfg.desiredReplicas} Fly machines in ${cfg.region} and lands you on the fleet view.`;

  return (
    <div className="space-y-5">
      <CharacterSheet
        harness={harness}
        templateName={template.name}
        agentName={state.fields.name}
        identityRows={identityRows}
        intelligenceRows={intelligenceRows}
        loadoutRows={loadoutRows}
      />

      {isCurrent && (
        <ReadyToLaunch
          placement={placement}
          onDeploy={onDeploy}
          blocked={deployBlocked}
          summary={summary}
        />
      )}
    </div>
  );
}

/* ─── STREAMING-LOG SURFACE ───────────────────────────────────────── */

const SYNTHETIC_LINES: ReadonlyArray<string> = [
  "› creating fly app…",
  "› setting secrets…",
  "› launching machine…",
  "› awaiting health-check…",
];

function DeployLog({
  deploy,
  templateName,
  onRetry,
}: {
  deploy: Exclude<DeployState, { kind: "idle" }>;
  templateName: string;
  onRetry: () => void;
}) {
  // Synthesize the lines client-side per decision 14 — real per-step
  // events from the BE arrive in M5+ via streaming RPCs. The interval
  // ticks while `deploy.kind === "deploying"`; the success path
  // unmounts before all lines are appended (router.push to /fleet),
  // which is fine — the log is decorative, the redirect is the truth.
  const [tick, setTick] = useState(0);
  useEffect(() => {
    if (deploy.kind !== "deploying") return;
    const id = setInterval(() => setTick((t) => t + 1), 600);
    return () => clearInterval(id);
  }, [deploy.kind]);

  // Initial line was set by `onDeploy`; subsequent ticks append the
  // remaining synthetic lines until exhausted. After success or error
  // the line set is frozen — `succeeded` keeps whatever the last
  // in-flight render showed (no flash) until the route transition
  // unmounts the tree.
  const visibleLines =
    deploy.kind === "deploying"
      ? SYNTHETIC_LINES.slice(0, Math.min(SYNTHETIC_LINES.length, 1 + tick))
      : deploy.lines;

  const isError = deploy.kind === "error";
  const accent: TerminalAccent = isError ? "failed" : "running";

  return (
    <div className="space-y-6">
      <header className="flex items-end justify-between border-b border-border pb-4">
        <div>
          <div className="font-display text-[11px] uppercase tracking-widest text-muted-foreground/60">
            [ LAUNCHPAD // DEPLOYING ]
          </div>
          <h1 className="mt-1 font-display text-2xl font-bold uppercase tracking-widest text-foreground">
            {templateName.toUpperCase()}
          </h1>
        </div>
        <div className="font-display text-[11px] uppercase tracking-widest text-muted-foreground">
          {isError ? "ERROR" : "IN FLIGHT"}
        </div>
      </header>

      <TerminalContainer
        title={isError ? "DEPLOY ERROR" : "DEPLOY LOG"}
        accent={accent}
        meta={isError ? "FAILED" : "STREAMING"}
      >
        <pre className="min-h-[160px] whitespace-pre-wrap font-mono text-xs leading-relaxed text-foreground/80">
          {visibleLines.join("\n")}
        </pre>
        {isError && (
          <div className="mt-4 flex items-center justify-end gap-2 border-t border-border pt-3">
            <Button size="sm" variant="outline" onClick={onRetry}>
              › BACK TO REVIEW
            </Button>
          </div>
        )}
      </TerminalContainer>
    </div>
  );
}

/* ─── RPG CHARACTER LAYOUT ──────────────────────────────────────── */

const STEP_ACCENT_CSS: Record<StepKey, string> = {
  harness: "hsl(var(--feature-catalog))",
  identity: "hsl(var(--feature-secrets))",
  model: "hsl(var(--feature-adapter))",
  tools: "hsl(var(--feature-tools))",
  deployment: "hsl(var(--feature-deploy))",
  review: "hsl(var(--status-running))",
};

function RpgHeader({
  harness,
  template,
  state,
}: {
  harness: HarnessEntry | undefined;
  template: AgentTemplate;
  state: WizardState;
}) {
  const harnessName = (harness?.name ?? template.name).toUpperCase();
  const stepMeta = STEP_META[state.current];
  return (
    <div className="border-b border-border pb-5 text-center">
      <div className="font-display text-[10px] uppercase tracking-widest text-muted-foreground/50">
        [ {harnessName} ]
      </div>
      <h1
        className={[
          "mt-1 font-display text-3xl font-bold uppercase tracking-widest",
          state.fields.name ? "text-foreground" : "text-muted-foreground/40",
        ].join(" ")}
      >
        {state.fields.name ? state.fields.name.toUpperCase() : "[ DESIGNATION PENDING ]"}
      </h1>
      <div className="mt-2 font-mono text-[11px] uppercase tracking-widest text-muted-foreground">
        STEP {stepMeta.ordinal}{" // "}{stepMeta.label}
      </div>
    </div>
  );
}

function RpgBody({
  harness,
  template,
  state,
  dispatch,
  onDeploy,
}: {
  harness: HarnessEntry | undefined;
  template: AgentTemplate;
  state: WizardState;
  dispatch: React.Dispatch<WizardAction>;
  onDeploy: () => void;
}) {
  const hk: HarnessKey = harness?.key ?? "hermes";
  const isReview = state.current === "review";
  const isWideLoadoutStep = state.current === "tools" || state.current === "deployment";

  return (
    <div className="space-y-6">
      {/* Mobile only: compact nebula above the form */}
      <div className="flex justify-center lg:hidden">
        <div className="h-44 w-44">
          <NebulaAvatar fill harness={hk} />
        </div>
      </div>

      {/*
        Three-column layout.
        DOM order: RIGHT → CENTER → LEFT — ensures on mobile (block stack)
        the active form appears first and the history panel appears below.
        On desktop (lg:grid with explicit col-start), the visual order is
        LEFT | CENTER | RIGHT regardless of DOM order.
      */}
      <div
        className={[
          "space-y-6 lg:grid lg:gap-6 lg:space-y-0 lg:items-start",
          isWideLoadoutStep
            ? "lg:grid-cols-[160px_1fr_280px] xl:grid-cols-[180px_1fr_320px]"
            : "lg:grid-cols-[220px_1fr_300px]",
        ].join(" ")}
      >
        {/* RIGHT: active step form — first in DOM, col 3 on desktop */}
        <div
          className={[
            "min-w-0",
            isWideLoadoutStep
              ? "lg:col-start-3 lg:row-start-1"
              : "lg:col-start-3 lg:row-start-1",
          ].join(" ")}
        >
          <RpgRightPanel
            state={state}
            dispatch={dispatch}
            template={template}
            harness={harness}
            onDeploy={onDeploy}
          />
        </div>

        {/* CENTER: large portrait nebula — desktop only */}
        <div
          className={[
            "hidden flex-col items-center gap-4 lg:col-start-2 lg:row-start-1",
            "lg:flex",
          ].join(" ")}
        >
          <div
            className={
              "aspect-square w-full " +
              (isWideLoadoutStep ? "max-w-[30rem]" : "")
            }
          >
            <NebulaAvatar fill harness={hk} />
          </div>
          <div className="text-center font-display text-[11px] uppercase tracking-widest text-muted-foreground/50">
            {harness?.name ?? template.name}
          </div>
        </div>

        {/* LEFT: confirmed history — last in DOM, col 1 on desktop */}
        <div className="lg:col-start-1 lg:row-start-1">
          <RpgLeftPanel
            state={state}
            dispatch={dispatch}
            template={template}
            harness={harness}
            isReview={isReview}
          />
        </div>
      </div>
    </div>
  );
}

function RpgLeftPanel({
  state,
  dispatch,
  template,
  harness,
  isReview,
}: {
  state: WizardState;
  dispatch: React.Dispatch<WizardAction>;
  template: AgentTemplate;
  harness: HarnessEntry | undefined;
  isReview: boolean;
}) {
  // REVIEW: left shows identity-side stats (harness / identity / model).
  // All other steps: left shows every confirmed step in order.
  const stepsToShow: StepKey[] = isReview
    ? (["harness", "identity", "model"] as StepKey[]).filter((s) =>
        state.confirmed.has(s),
      )
    : STEPS.filter((s) => state.confirmed.has(s));

  return (
    <div className="space-y-4">
      <div className="font-display text-[10px] uppercase tracking-widest text-muted-foreground/40">
        [ HISTORY ]
      </div>
      {stepsToShow.length === 0 ? (
        <p className="font-mono text-[11px] text-muted-foreground/40">
          — awaiting confirmation —
        </p>
      ) : (
        <div className="space-y-4 border-l border-border/30 pl-3">
          {stepsToShow.map((step) => (
            <RpgConfirmedEntry
              key={step}
              step={step}
              state={state}
              dispatch={dispatch}
              template={template}
              harness={harness}
              isReview={isReview}
            />
          ))}
        </div>
      )}
    </div>
  );
}

function RpgConfirmedEntry({
  step,
  state,
  dispatch,
  template,
  harness,
  isReview,
}: {
  step: StepKey;
  state: WizardState;
  dispatch: React.Dispatch<WizardAction>;
  template: AgentTemplate;
  harness: HarnessEntry | undefined;
  isReview: boolean;
}) {
  const meta = STEP_META[step];
  const rows = rpgStepSummaryRows(step, state, harness, template);
  // Harness can't be re-selected from this route; on review, edits are locked.
  const canEdit = step !== "harness" && !isReview;

  return (
    <div className="space-y-1">
      <div className="flex items-center justify-between gap-1">
        <span
          className="font-display text-[10px] uppercase tracking-widest"
          style={{ color: STEP_ACCENT_CSS[step] }}
        >
          {meta.label}
        </span>
        {canEdit && (
          <button
            type="button"
            onClick={() => dispatch({ type: "edit", step })}
            className="font-display text-[9px] uppercase tracking-widest text-muted-foreground/40 transition-colors hover:text-foreground"
          >
            [edit]
          </button>
        )}
      </div>
      <dl className="space-y-0.5">
        {rows.map((r) => (
          <div key={r.label} className="flex gap-2 font-mono text-[11px]">
            <dt className="shrink-0 text-muted-foreground/50">{r.label}</dt>
            <dd className="truncate text-foreground/70">{r.value}</dd>
          </div>
        ))}
      </dl>
    </div>
  );
}

function rpgStepSummaryRows(
  step: StepKey,
  state: WizardState,
  harness: HarnessEntry | undefined,
  template: AgentTemplate,
): ReadonlyArray<{ label: string; value: string }> {
  switch (step) {
    case "harness":
      return [
        { label: "harness", value: harness?.key ?? template.name },
        { label: "from", value: harness?.vendor ?? "—" },
      ];
    case "identity":
      return [{ label: "callsign", value: state.fields.name || "—" }];
    case "model":
      return [
        { label: "faction", value: providerLabel(state.fields.provider) },
        { label: "class", value: state.fields.modelName || "—" },
        { label: "sigil", value: maskApiKey(state.fields.apiKey) },
      ];
    case "tools": {
      const count = Object.values(state.fields.toolsets).filter(
        (t) => t.equipped,
      ).length;
      return [
        {
          label: "toolsets",
          value: count === 0 ? "none equipped" : `${count} equipped`,
        },
      ];
    }
    case "deployment":
      return [
        { label: "region", value: state.fields.deployment.region },
        {
          label: "size",
          value: describeSize(
            state.fields.deployment.cpuKind,
            state.fields.deployment.cpus,
            state.fields.deployment.memoryMb,
          ),
        },
        {
          label: "replicas",
          value: String(state.fields.deployment.desiredReplicas),
        },
      ];
    case "review":
      return [];
  }
}

function RpgRightPanel({
  state,
  dispatch,
  template,
  harness,
  onDeploy,
}: {
  state: WizardState;
  dispatch: React.Dispatch<WizardAction>;
  template: AgentTemplate;
  harness: HarnessEntry | undefined;
  onDeploy: () => void;
}) {
  const step = state.current;
  const meta = STEP_META[step];

  if (step === "review") {
    return (
      <ReviewRightContent
        state={state}
        onDeploy={onDeploy}
      />
    );
  }

  return (
    <TerminalContainer
      title={`STEP ${meta.ordinal} // ${meta.label}`}
      accent={meta.accent}
      meta="ACTIVE"
    >
      <StepBody
        step={step}
        state={state}
        dispatch={dispatch}
        template={template}
        harness={harness}
        isCurrent={true}
        isConfirmed={false}
        onDeploy={onDeploy}
      />
    </TerminalContainer>
  );
}

function ReviewRightContent({
  state,
  onDeploy,
}: {
  state: WizardState;
  onDeploy: () => void;
}) {
  const [placement, setPlacement] = useState<PlacementState>({ kind: "idle" });
  const cfg = state.fields.deployment;
  const cfgKey = JSON.stringify(cfg);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      if (cancelled) return;
      setPlacement({ kind: "checking" });
      try {
        const api = createApiClient();
        const res = await api.agents.checkDeploymentPlacement({
          deployConfig: deployConfigFromFields(cfg),
        });
        if (cancelled) return;
        const result = res.placementResult;
        if (!result) {
          setPlacement({ kind: "error", message: "no placement result" });
          return;
        }
        setPlacement({ kind: result.available ? "ok" : "blocked", result });
      } catch (e) {
        if (cancelled) return;
        setPlacement({ kind: "error", message: ConnectError.from(e).message });
      }
    })();
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [cfgKey]);

  const deployBlocked =
    placement.kind === "checking" ||
    placement.kind === "blocked" ||
    placement.kind === "error";

  const loadoutRows = [
    ...toolsetSummaryRows(state.fields.toolsets),
    ...deploymentSummaryRows(cfg),
  ];

  const summary =
    cfg.desiredReplicas === 1
      ? `Deploying spins up one Fly machine in ${cfg.region} and lands you on the fleet view.`
      : `Deploying spins up ${cfg.desiredReplicas} Fly machines in ${cfg.region} and lands you on the fleet view.`;

  return (
    <div className="space-y-4">
      <TerminalContainer title="LOADOUT" accent="deploy" meta="REVIEW">
        <ConfirmedSummary rows={loadoutRows} />
      </TerminalContainer>
      <ReadyToLaunch
        placement={placement}
        onDeploy={onDeploy}
        blocked={deployBlocked}
        summary={summary}
      />
    </div>
  );
}

/* ─── SHARED PRESENTATION ─────────────────────────────────────────── */

function ConfirmedSummary({
  rows,
}: {
  rows: ReadonlyArray<{ label: string; value: string }>;
}) {
  return (
    <dl className="space-y-1 font-mono text-xs">
      {rows.map((r) => (
        <SpecRow key={r.label} label={r.label} value={r.value} />
      ))}
    </dl>
  );
}

function SpecRow({
  label,
  value,
  deferred,
}: {
  label: string;
  value: string;
  deferred?: boolean;
}) {
  return (
    <div className="flex items-baseline gap-2">
      <dt className="w-24 shrink-0 text-[11px] uppercase tracking-wider text-muted-foreground/70">
        {label}
      </dt>
      <dd
        className={
          deferred ? "text-muted-foreground/50" : "text-foreground/80"
        }
      >
        {value}
        {deferred && (
          <span className="ml-2 font-display text-[10px] uppercase tracking-widest text-muted-foreground/50">
            [ COMING WITH FLEET CONTROL ]
          </span>
        )}
      </dd>
    </div>
  );
}

/* ─── HELPERS ─────────────────────────────────────────────────────── */

function providerLabel(v: ProviderValue): string {
  return PROVIDERS.find((p) => p.value === v)?.label ?? v;
}

/**
 * Fetch the catalog and project to `{ toolset_key: tool_id }` so the wizard's
 * `ToolsetStateMap` (keyed by toolset_key) can be translated into the
 * GrantInput[] shape that `setInstanceToolGrants` expects (keyed by tool_id).
 * v1.5 has one harness adapter, so this is a single round-trip.
 */
async function fetchToolIdsByKey(
  api: ReturnType<typeof createApiClient>,
  harnessAdapterId: string,
): Promise<Record<string, string>> {
  const tools = await listTools(api.tools, { harnessAdapterId });
  const out: Record<string, string> = {};
  for (const t of tools) out[t.toolsetKey] = t.id;
  return out;
}

function maskApiKey(key: string): string {
  if (!key) return "—";
  // Show last 4 chars only; fixed-width 8 dots regardless of true
  // length so the mask doesn't leak information about key length.
  const tail = key.length >= 4 ? key.slice(-4) : key;
  return `••••••••${tail}`;
}

/* ─── FETCH-STATE BRANCHES ────────────────────────────────────────── */

function WizardSkeleton() {
  return (
    <div className="space-y-4">
      <div className="h-12 w-full animate-telemetry border border-border bg-card" />
      {STEPS.map((s) => (
        <div
          key={s}
          className="h-32 w-full animate-telemetry border border-border bg-card"
        />
      ))}
    </div>
  );
}

function WizardError({ message }: { message: string }) {
  return (
    <TerminalContainer title="WIZARD" accent="failed">
      <p className="font-mono text-sm text-[hsl(var(--status-failed))]">
        {message}
      </p>
    </TerminalContainer>
  );
}

function WizardNotFound({ id }: { id: string }) {
  return (
    <TerminalContainer title="TEMPLATE NOT FOUND" accent="failed">
      <p className="font-mono text-sm text-muted-foreground">
        No agent template matches{" "}
        <code className="text-foreground">{id}</code>. The template may have
        been removed or the link is stale.
      </p>
    </TerminalContainer>
  );
}
