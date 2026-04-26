"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { useForm, useWatch, type UseFormRegisterReturn } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { ConnectError } from "@connectrpc/connect";
import { toast } from "sonner";
import { z } from "zod";
import { EyeIcon, EyeOffIcon } from "lucide-react";

import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import type { AgentTemplate } from "@/gen/corellia/v1/agents_pb";
import { ModelProvider } from "@/gen/corellia/v1/agents_pb";
import { createApiClient } from "@/lib/api/client";

type Mode = "one" | "many";

type Props = {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  template: AgentTemplate;
  mode: Mode;
};

const PROVIDERS = [
  { value: "anthropic", label: "Anthropic", proto: ModelProvider.ANTHROPIC },
  { value: "openai", label: "OpenAI", proto: ModelProvider.OPENAI },
  { value: "openrouter", label: "OpenRouter", proto: ModelProvider.OPENROUTER },
] as const;

type ProviderValue = (typeof PROVIDERS)[number]["value"];

const sharedFields = {
  provider: z.enum(["anthropic", "openai", "openrouter"], {
    message: "Pick a provider",
  }),
  modelName: z
    .string()
    .trim()
    .min(1, "Required")
    .max(200, "Up to 200 characters"),
  apiKey: z.string().min(1, "Required"),
};

const oneSchema = z.object({
  ...sharedFields,
  name: z.string().trim().min(1, "Required").max(80, "Up to 80 characters"),
});

const manySchema = z.object({
  ...sharedFields,
  namePrefix: z
    .string()
    .trim()
    .min(1, "Required")
    .max(60, "Up to 60 characters"),
  count: z
    .number({ message: "Required" })
    .int("Whole numbers only")
    .min(1, "At least 1")
    .max(10, "v1 caps deploys at 10 per request"),
});

type OneValues = z.infer<typeof oneSchema>;
type ManyValues = z.infer<typeof manySchema>;

export function DeployModal({ open, onOpenChange, template, mode }: Props) {
  // Submitting is hoisted here so the Dialog itself can refuse outside-click
  // and ESC dismissals while an RPC is in flight (plan Q4).
  const [submitting, setSubmitting] = useState(false);

  function handleOpenChange(next: boolean) {
    if (submitting && !next) return;
    onOpenChange(next);
  }

  return (
    <Dialog open={open} onOpenChange={handleOpenChange}>
      <DialogContent
        showCloseButton={!submitting}
        className="sm:max-w-md"
      >
        {mode === "one" ? (
          <DeployOneForm
            key="one"
            template={template}
            submitting={submitting}
            setSubmitting={setSubmitting}
            onClose={() => onOpenChange(false)}
          />
        ) : (
          <DeployManyForm
            key="many"
            template={template}
            submitting={submitting}
            setSubmitting={setSubmitting}
            onClose={() => onOpenChange(false)}
          />
        )}
      </DialogContent>
    </Dialog>
  );
}

type FormProps = {
  template: AgentTemplate;
  submitting: boolean;
  setSubmitting: (b: boolean) => void;
  onClose: () => void;
};

function DeployOneForm({ template, submitting, setSubmitting, onClose }: FormProps) {
  const router = useRouter();
  const [showKey, setShowKey] = useState(false);

  const form = useForm<OneValues>({
    resolver: zodResolver(oneSchema),
    defaultValues: {
      name: "",
      provider: "anthropic",
      modelName: "",
      apiKey: "",
    },
  });
  const provider = useWatch({ control: form.control, name: "provider" });

  async function onSubmit(values: OneValues) {
    setSubmitting(true);
    try {
      const api = createApiClient();
      await api.agents.spawnAgent({
        templateId: template.id,
        name: values.name,
        provider: providerToProto(values.provider),
        modelName: values.modelName,
        modelApiKey: values.apiKey,
      });
      toast.success(`Spawning ${values.name}.`);
      setSubmitting(false);
      onClose();
      router.push("/fleet");
    } catch (e) {
      const err = ConnectError.from(e);
      toast.error(err.message);
      setSubmitting(false);
    }
  }

  return (
    <form onSubmit={form.handleSubmit(onSubmit)} noValidate>
      <DialogHeader>
        <DialogTitle>Deploy {template.name}</DialogTitle>
        <DialogDescription>
          Name the agent, pick a model, paste a provider key. Deploy spins up
          one Fly machine and lands you on the fleet view.
        </DialogDescription>
      </DialogHeader>

      <div className="space-y-4 py-4">
        <Field
          id="name"
          label="Agent name"
          error={form.formState.errors.name?.message}
        >
          <Input
            id="name"
            autoFocus
            placeholder="e.g. research-bot"
            aria-invalid={!!form.formState.errors.name}
            disabled={submitting}
            {...form.register("name")}
          />
        </Field>

        <ProviderField
          value={provider}
          onChange={(v) =>
            form.setValue("provider", v, { shouldValidate: true })
          }
          error={form.formState.errors.provider?.message}
          disabled={submitting}
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
            disabled={submitting}
            {...form.register("modelName")}
          />
        </Field>

        <ApiKeyField
          showKey={showKey}
          onToggleShow={() => setShowKey((s) => !s)}
          error={form.formState.errors.apiKey?.message}
          disabled={submitting}
          register={form.register("apiKey")}
        />
      </div>

      <DialogFooter>
        <Button
          type="button"
          variant="ghost"
          onClick={onClose}
          disabled={submitting}
        >
          Cancel
        </Button>
        <Button type="submit" disabled={submitting}>
          {submitting ? "Deploying…" : "Deploy"}
        </Button>
      </DialogFooter>
    </form>
  );
}

function DeployManyForm({ template, submitting, setSubmitting, onClose }: FormProps) {
  const router = useRouter();
  const [showKey, setShowKey] = useState(false);

  const form = useForm<ManyValues>({
    resolver: zodResolver(manySchema),
    defaultValues: {
      namePrefix: "",
      count: 5,
      provider: "anthropic",
      modelName: "",
      apiKey: "",
    },
  });
  const provider = useWatch({ control: form.control, name: "provider" });
  const count = useWatch({ control: form.control, name: "count" });

  async function onSubmit(values: ManyValues) {
    setSubmitting(true);
    try {
      const api = createApiClient();
      await api.agents.spawnNAgents({
        templateId: template.id,
        namePrefix: values.namePrefix,
        count: values.count,
        provider: providerToProto(values.provider),
        modelName: values.modelName,
        modelApiKey: values.apiKey,
      });
      toast.success(`Spawning ${values.count} ${template.name} agents.`);
      setSubmitting(false);
      onClose();
      router.push("/fleet");
    } catch (e) {
      const err = ConnectError.from(e);
      toast.error(err.message);
      setSubmitting(false);
    }
  }

  return (
    <form onSubmit={form.handleSubmit(onSubmit)} noValidate>
      <DialogHeader>
        <DialogTitle>Deploy {template.name} — fan out</DialogTitle>
        <DialogDescription>
          Spawn up to 10 agents in parallel. They share one provider key and
          model; names are auto-numbered from the prefix.
        </DialogDescription>
      </DialogHeader>

      <div className="space-y-4 py-4">
        <div className="grid grid-cols-[1fr_5rem] gap-3">
          <Field
            id="namePrefix"
            label="Name prefix"
            error={form.formState.errors.namePrefix?.message}
          >
            <Input
              id="namePrefix"
              autoFocus
              placeholder="fanout"
              aria-invalid={!!form.formState.errors.namePrefix}
              disabled={submitting}
              {...form.register("namePrefix")}
            />
          </Field>

          <Field
            id="count"
            label="Count"
            error={form.formState.errors.count?.message}
          >
            <Input
              id="count"
              type="number"
              min={1}
              max={10}
              aria-invalid={!!form.formState.errors.count}
              disabled={submitting}
              {...form.register("count", { valueAsNumber: true })}
            />
          </Field>
        </div>

        <ProviderField
          value={provider}
          onChange={(v) =>
            form.setValue("provider", v, { shouldValidate: true })
          }
          error={form.formState.errors.provider?.message}
          disabled={submitting}
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
            disabled={submitting}
            {...form.register("modelName")}
          />
        </Field>

        <ApiKeyField
          showKey={showKey}
          onToggleShow={() => setShowKey((s) => !s)}
          error={form.formState.errors.apiKey?.message}
          disabled={submitting}
          register={form.register("apiKey")}
        />
      </div>

      <DialogFooter>
        <Button
          type="button"
          variant="ghost"
          onClick={onClose}
          disabled={submitting}
        >
          Cancel
        </Button>
        <Button type="submit" disabled={submitting}>
          {submitting ? "Deploying…" : `Deploy ${count || ""}`}
        </Button>
      </DialogFooter>
    </form>
  );
}

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
  disabled,
}: {
  value: ProviderValue;
  onChange: (v: ProviderValue) => void;
  error?: string;
  disabled?: boolean;
}) {
  return (
    <div className="space-y-1.5">
      <Label htmlFor="provider">Provider</Label>
      <Select
        value={value}
        onValueChange={(v) => onChange(v as ProviderValue)}
        disabled={disabled}
      >
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
  disabled,
  register,
}: {
  showKey: boolean;
  onToggleShow: () => void;
  error?: string;
  disabled?: boolean;
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
          disabled={disabled}
          className="pr-10"
          {...register}
        />
        <button
          type="button"
          onClick={onToggleShow}
          disabled={disabled}
          className="absolute right-2 top-1/2 -translate-y-1/2 rounded p-1 text-muted-foreground hover:text-foreground disabled:pointer-events-none"
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

function providerToProto(v: ProviderValue): ModelProvider {
  const found = PROVIDERS.find((p) => p.value === v);
  if (!found) throw new Error(`unknown provider: ${v}`);
  return found.proto;
}
