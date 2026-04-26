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
import { EyeIcon, EyeOffIcon } from "lucide-react";

import { NebulaAvatar } from "@/components/spawn/nebula-avatar";
import {
  DeploymentConfigForm,
  type DeploymentFormValues,
} from "@/components/fleet/deployment-config-form";
import {
  PlacementBanner,
  type PlacementState,
} from "@/components/fleet/placement-banner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
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
import {
  DEFAULT_DEPLOYMENT_VALUES,
  describeSize,
} from "@/lib/spawn/deployment-presets";

/**
 * `<Wizard>` — Phases 4 + 5 of `docs/executing/agents-ui-mods.md`.
 *
 * Five-step character-creation flow at `/spawn/[templateId]`. Phase 4
 * delivered the shell + gating logic; Phase 5 wires real fields and the
 * `spawnAgent` RPC. The wizard's contract on the wire is identical to
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
  "deployment",
  "review",
] as const;
type StepKey = (typeof STEPS)[number];

const STEP_META: Record<
  StepKey,
  { ordinal: number; label: string; accent: TerminalAccent }
> = {
  // Accent assignments per plan §4 Phase 4: MODEL → violet, DEPLOYMENT
  // → blue. The other three follow the §5.4 feature-color sequence.
  harness: { ordinal: 1, label: "HARNESS", accent: "catalog" },
  identity: { ordinal: 2, label: "IDENTITY", accent: "secrets" },
  model: { ordinal: 3, label: "MODEL", accent: "adapter" },
  deployment: { ordinal: 4, label: "DEPLOYMENT", accent: "deploy" },
  review: { ordinal: 5, label: "REVIEW", accent: "running" },
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
};

const INITIAL_FIELDS: WizardFields = {
  name: "",
  provider: "anthropic",
  modelName: "",
  apiKey: "",
  deployment: DEFAULT_DEPLOYMENT_VALUES,
};

type WizardState = {
  current: StepKey;
  confirmed: ReadonlySet<StepKey>;
  fields: WizardFields;
};

type WizardAction =
  | { type: "confirm"; step: StepKey }
  | { type: "edit"; step: StepKey }
  | { type: "setField"; patch: Partial<WizardFields> };

function initialState(): WizardState {
  return {
    current: "harness",
    confirmed: new Set(),
    fields: INITIAL_FIELDS,
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
  | { kind: "not-found" }
  | { kind: "error"; message: string };

type DeployState =
  | { kind: "idle" }
  | { kind: "deploying"; lines: string[] }
  | { kind: "succeeded"; lines: string[] }
  | { kind: "error"; lines: string[]; message: string };

export function Wizard({ templateId }: { templateId: string }) {
  const [fetchState, setFetchState] = useState<FetchState>({ kind: "loading" });
  const [state, dispatch] = useReducer(reducer, undefined, initialState);
  const [deploy, setDeploy] = useState<DeployState>({ kind: "idle" });
  const router = useRouter();

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const api = createApiClient();
        const res = await api.agents.listAgentTemplates({});
        if (cancelled) return;
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
  }, [templateId]);

  if (fetchState.kind === "loading") return <WizardSkeleton />;
  if (fetchState.kind === "error") return <WizardError message={fetchState.message} />;
  if (fetchState.kind === "not-found") return <WizardNotFound id={templateId} />;

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
      await api.agents.spawnAgent({
        templateId: template.id,
        name: state.fields.name,
        provider: proto.proto,
        modelName: state.fields.modelName,
        modelApiKey: state.fields.apiKey,
        deployConfig: deployConfigFromFields(state.fields.deployment),
      });
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
    <div className="space-y-6">
      <header className="flex items-end justify-between border-b border-border pb-4">
        <div>
          <div className="font-display text-[10px] uppercase tracking-widest text-muted-foreground/60">
            [ LAUNCHPAD // CONFIGURE ]
          </div>
          <h1 className="mt-1 font-display text-2xl font-bold uppercase tracking-widest text-foreground">
            {(harness?.name ?? template.name).toUpperCase()}
          </h1>
        </div>
        <div className="font-display text-[10px] uppercase tracking-widest text-muted-foreground">
          STEP {STEP_META[state.current].ordinal} OF {STEPS.length}
        </div>
      </header>

      <div className="space-y-4">
        {STEPS.map((step) => (
          <StepShell
            key={step}
            step={step}
            state={state}
            dispatch={dispatch}
            template={template}
            harness={harness}
            onDeploy={onDeploy}
          />
        ))}
      </div>
    </div>
  );
}

function StepShell({
  step,
  state,
  dispatch,
  template,
  harness,
  onDeploy,
}: {
  step: StepKey;
  state: WizardState;
  dispatch: React.Dispatch<WizardAction>;
  template: AgentTemplate;
  harness: HarnessEntry | undefined;
  onDeploy: () => void;
}) {
  const meta = STEP_META[step];
  const isCurrent = state.current === step;
  const isConfirmed = state.confirmed.has(step);
  const isFuture = !isCurrent && !isConfirmed;

  const title = `STEP ${meta.ordinal} // ${meta.label}`;
  const stateTag = isCurrent ? "ACTIVE" : isConfirmed ? "CONFIRMED" : "PENDING";

  return (
    <div
      className={isFuture ? "pointer-events-none opacity-40" : undefined}
      // `inert` removes the subtree from the tab order and the a11y
      // tree, matching the visual disabled state. Without it, ghost
      // [ EDIT ] buttons in not-yet-confirmed steps remain
      // keyboard-focusable behind `pointer-events-none`.
      inert={isFuture || undefined}
    >
      <TerminalContainer title={title} accent={meta.accent} meta={stateTag}>
        <StepBody
          step={step}
          state={state}
          dispatch={dispatch}
          template={template}
          harness={harness}
          isCurrent={isCurrent}
          isConfirmed={isConfirmed}
          onDeploy={onDeploy}
        />

        {isConfirmed && !isCurrent && (
          <div className="mt-4 flex items-center justify-end gap-2 border-t border-border pt-3">
            <Button
              size="xs"
              variant="ghost"
              onClick={() => dispatch({ type: "edit", step })}
            >
              [ EDIT ]
            </Button>
          </div>
        )}
      </TerminalContainer>
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
    case "deployment":
      return <DeploymentStep {...props} />;
    case "review":
      return <ReviewStep {...props} />;
  }
}

/* ─── STEP 1 // HARNESS ───────────────────────────────────────────── */

function HarnessStep({
  template,
  harness,
  isCurrent,
  isConfirmed,
  dispatch,
}: StepBodyProps) {
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
            <div className="font-display text-[10px] uppercase tracking-widest text-muted-foreground/70">
              HARNESS
            </div>
            <div className="mt-1 font-mono text-sm text-foreground">
              {harness?.name ?? template.name}
            </div>
          </div>
          {(template.description || harness?.description) && (
            <p className="text-xs leading-relaxed text-muted-foreground">
              {template.description || harness?.description}
            </p>
          )}
          <dl className="space-y-1 font-mono text-[11px]">
            <SpecRow label="ADAPTER" value="hand-written" />
            <SpecRow label="DEPLOY" value="fly.io" />
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

/* ─── STEP 2 // IDENTITY ──────────────────────────────────────────── */

const identitySchema = z.object({
  name: z.string().trim().min(1, "Required").max(80, "Up to 80 characters"),
});
type IdentityValues = z.infer<typeof identitySchema>;

function IdentityStep({ state, dispatch, isCurrent }: StepBodyProps) {
  if (!isCurrent) {
    return (
      <ConfirmedSummary
        rows={[{ label: "NAME", value: state.fields.name || "—" }]}
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

  return (
    <form onSubmit={form.handleSubmit(onSubmit)} noValidate className="space-y-4">
      <Field id="name" label="Agent name" error={form.formState.errors.name?.message}>
        <Input
          id="name"
          autoFocus
          placeholder="e.g. research-bot"
          aria-invalid={!!form.formState.errors.name}
          {...form.register("name")}
        />
      </Field>
      <div className="flex items-center justify-end gap-2 border-t border-border pt-3">
        <Button size="sm" type="submit">
          › CONFIRM
        </Button>
      </div>
    </form>
  );
}

/* ─── STEP 3 // MODEL ─────────────────────────────────────────────── */

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

function ModelStep({ state, dispatch, isCurrent }: StepBodyProps) {
  if (!isCurrent) {
    return (
      <ConfirmedSummary
        rows={[
          { label: "PROVIDER", value: providerLabel(state.fields.provider) },
          { label: "MODEL", value: state.fields.modelName || "—" },
          { label: "API KEY", value: maskApiKey(state.fields.apiKey) },
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

  return (
    <form onSubmit={form.handleSubmit(onSubmit)} noValidate className="space-y-4">
      <ProviderField
        value={provider}
        onChange={(v) => form.setValue("provider", v, { shouldValidate: true })}
        error={form.formState.errors.provider?.message}
      />

      <Field
        id="modelName"
        label="Model"
        hint="The provider's model identifier (e.g. claude-opus-4-7)."
        error={form.formState.errors.modelName?.message}
      >
        <Input
          id="modelName"
          placeholder="claude-opus-4-7"
          aria-invalid={!!form.formState.errors.modelName}
          {...form.register("modelName")}
        />
      </Field>

      <ApiKeyField
        showKey={showKey}
        onToggleShow={() => setShowKey((s) => !s)}
        error={form.formState.errors.apiKey?.message}
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

/* ─── STEP 4 // DEPLOYMENT ────────────────────────────────────────── */

function DeploymentStep({ state, dispatch, isCurrent }: StepBodyProps) {
  if (!isCurrent) {
    return <ConfirmedSummary rows={deploymentSummaryRows(state.fields.deployment)} />;
  }

  return (
    <div className="space-y-4">
      <p className="text-xs leading-relaxed text-muted-foreground">
        Where and how this agent runs. Region + size + volume become
        immutable lightly: most can be edited live from the fleet page;
        region change destroys and respawns the agent.
      </p>
      <DeploymentConfigForm
        defaults={state.fields.deployment}
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
  };
}

/* ─── STEP 5 // REVIEW ────────────────────────────────────────────── */

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

  return (
    <div className="space-y-4">
      <p className="text-xs leading-relaxed text-muted-foreground">
        Review the configuration. Deploying spins up{" "}
        {cfg.desiredReplicas === 1 ? "one Fly machine" : `${cfg.desiredReplicas} Fly machines`}{" "}
        in <code className="text-foreground">{cfg.region}</code> and lands you
        on the fleet view.
      </p>

      <dl className="space-y-1 font-mono text-[11px]">
        <SpecRow label="HARNESS" value={harness?.name ?? template.name} />
        <SpecRow label="NAME" value={state.fields.name} />
        <SpecRow label="PROVIDER" value={providerLabel(state.fields.provider)} />
        <SpecRow label="MODEL" value={state.fields.modelName} />
        <SpecRow label="API KEY" value={maskApiKey(state.fields.apiKey)} />
        {deploymentSummaryRows(cfg).map((r) => (
          <SpecRow key={r.label} label={r.label} value={r.value} />
        ))}
      </dl>

      {isCurrent && <PlacementBanner state={placement} />}

      {isCurrent && (
        <div className="flex items-center justify-end gap-2 border-t border-[hsl(var(--status-running))]/30 pt-3">
          <Button size="sm" onClick={onDeploy} disabled={deployBlocked}>
            › DEPLOY AGENT
          </Button>
        </div>
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
          <div className="font-display text-[10px] uppercase tracking-widest text-muted-foreground/60">
            [ LAUNCHPAD // DEPLOYING ]
          </div>
          <h1 className="mt-1 font-display text-2xl font-bold uppercase tracking-widest text-foreground">
            {templateName.toUpperCase()}
          </h1>
        </div>
        <div className="font-display text-[10px] uppercase tracking-widest text-muted-foreground">
          {isError ? "ERROR" : "IN FLIGHT"}
        </div>
      </header>

      <TerminalContainer
        title={isError ? "DEPLOY ERROR" : "DEPLOY LOG"}
        accent={accent}
        meta={isError ? "FAILED" : "STREAMING"}
      >
        <pre className="min-h-[160px] whitespace-pre-wrap font-mono text-[11px] leading-relaxed text-foreground/80">
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

/* ─── SHARED FIELD CHROME ─────────────────────────────────────────── */

function Field({
  id,
  label,
  hint,
  error,
  children,
}: {
  id: string;
  label: string;
  hint?: string;
  error?: string;
  children: React.ReactNode;
}) {
  return (
    <div className="space-y-1.5">
      <Label htmlFor={id}>{label}</Label>
      {children}
      {hint && !error && (
        <p className="text-xs text-muted-foreground">{hint}</p>
      )}
      {error && <p className="text-sm text-destructive">{error}</p>}
    </div>
  );
}

function ProviderField({
  value,
  onChange,
  error,
}: {
  value: ProviderValue;
  onChange: (v: ProviderValue) => void;
  error?: string;
}) {
  return (
    <div className="space-y-1.5">
      <Label htmlFor="provider">Provider</Label>
      <Select value={value} onValueChange={(v) => onChange(v as ProviderValue)}>
        <SelectTrigger id="provider" className="w-full" aria-invalid={!!error}>
          <SelectValue placeholder="Pick a provider" />
        </SelectTrigger>
        <SelectContent>
          {PROVIDERS.map((p) => (
            <SelectItem key={p.value} value={p.value}>
              {p.label}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
      {error && <p className="text-sm text-destructive">{error}</p>}
    </div>
  );
}

function ApiKeyField({
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
    <div className="space-y-1.5">
      <Label htmlFor="apiKey">API key</Label>
      <div className="relative">
        <Input
          id="apiKey"
          type={showKey ? "text" : "password"}
          autoComplete="off"
          placeholder="sk-…"
          aria-invalid={!!error}
          className="pr-10"
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
      <p className="text-xs text-muted-foreground">
        Forwarded once to the agent&apos;s secret store. Never written to
        Corellia&apos;s database.
      </p>
      {error && <p className="text-sm text-destructive">{error}</p>}
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
    <dl className="space-y-1 font-mono text-[11px]">
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
      <dt className="w-24 shrink-0 text-[10px] uppercase tracking-wider text-muted-foreground/70">
        {label}
      </dt>
      <dd
        className={
          deferred ? "text-muted-foreground/50" : "text-foreground/80"
        }
      >
        {value}
        {deferred && (
          <span className="ml-2 font-display text-[9px] uppercase tracking-widest text-muted-foreground/50">
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
      <p className="font-mono text-xs text-[hsl(var(--status-failed))]">
        {message}
      </p>
    </TerminalContainer>
  );
}

function WizardNotFound({ id }: { id: string }) {
  return (
    <TerminalContainer title="TEMPLATE NOT FOUND" accent="failed">
      <p className="font-mono text-xs text-muted-foreground">
        No agent template matches{" "}
        <code className="text-foreground">{id}</code>. The template may have
        been removed or the link is stale.
      </p>
    </TerminalContainer>
  );
}
