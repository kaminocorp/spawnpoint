"use client";

import { useState } from "react";
import { ConnectError } from "@connectrpc/connect";
import {
  ExternalLinkIcon,
  OctagonIcon,
  PlayIcon,
  SettingsIcon,
  TrashIcon,
  Wrench,
} from "lucide-react";
import { toast } from "sonner";

import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { Button } from "@/components/ui/button";
import { DeploymentInspector } from "@/components/fleet/deployment-inspector";
import { InstanceToolEditor } from "@/components/fleet/instance-tool-editor";
import type { AgentInstance } from "@/gen/corellia/v1/agents_pb";
import { createApiClient } from "@/lib/api/client";

type Props = {
  instance: AgentInstance;
  onChanged: () => void;
  /**
   * v1.5 Pillar B Phase 7: the harness adapter id for this instance's
   * template. Threaded from the fleet page (which fetches the template
   * list once) so the InstanceToolEditor can scope its catalog fetch.
   * When empty, the Tools button is hidden — typically only happens on
   * destroyed rows or pre-Phase-4 templates that lack the FK on the wire.
   */
  harnessAdapterId?: string;
  /**
   * When true, render icon-only buttons with `title` tooltips. Used by the
   * gallery card footer where horizontal space is tight. List view keeps
   * the default labelled treatment.
   */
  compact?: boolean;
};

type Pending = "stop" | "destroy" | null;

export function AgentRowActions({
  instance,
  onChanged,
  harnessAdapterId,
  compact = false,
}: Props) {
  const [pending, setPending] = useState<Pending>(null);
  const [submitting, setSubmitting] = useState(false);
  const [inspectorOpen, setInspectorOpen] = useState(false);
  const [toolsOpen, setToolsOpen] = useState(false);
  const [starting, setStarting] = useState(false);

  const canStop = instance.status === "running";
  const canDestroy = instance.status !== "destroyed";
  const hasLogs = instance.logsUrl !== "";
  // Phase 7: Start button is visible when lifecycle_mode=manual AND
  // the agent is in `stopped`. The BE rejects Start in other states
  // — gating client-side keeps the surface uncluttered.
  const canStart =
    instance.lifecycleMode === "manual" && instance.status === "stopped";
  const canInspect = instance.status !== "destroyed";
  // v1.5 Pillar B Phase 7: edit grants on running / stopped / pending
  // agents. Destroyed rows hide the action entirely; without a harness
  // adapter id we have no catalog to fetch.
  const canEditTools =
    instance.status !== "destroyed" && !!harnessAdapterId;

  async function confirm() {
    if (!pending) return;
    setSubmitting(true);
    try {
      const api = createApiClient();
      if (pending === "stop") {
        await api.agents.stopAgentInstance({ id: instance.id });
        toast.success(`Stopped ${instance.name}.`);
      } else {
        await api.agents.destroyAgentInstance({ id: instance.id });
        toast.success(`Destroyed ${instance.name}.`);
      }
      setPending(null);
      onChanged();
    } catch (e) {
      const err = ConnectError.from(e);
      toast.error(err.message);
    } finally {
      setSubmitting(false);
    }
  }

  async function startInstance() {
    setStarting(true);
    try {
      const api = createApiClient();
      await api.agents.startAgentInstance({ instanceId: instance.id });
      toast.success(`Started ${instance.name}.`);
      onChanged();
    } catch (e) {
      const err = ConnectError.from(e);
      toast.error(err.message);
    } finally {
      setStarting(false);
    }
  }

  const buttonSize = compact ? "icon-sm" : "sm";

  return (
    <div className="flex items-center justify-end gap-1">
      {hasLogs && (
        <Button
          variant="ghost"
          size={buttonSize}
          render={
            <a
              href={instance.logsUrl}
              target="_blank"
              rel="noopener noreferrer"
            />
          }
          aria-label={`Logs for ${instance.name}`}
          title={compact ? "Logs" : undefined}
        >
          <ExternalLinkIcon />
          {!compact && "Logs"}
        </Button>
      )}
      {canInspect && (
        <Button
          variant="ghost"
          size={buttonSize}
          onClick={() => setInspectorOpen(true)}
          aria-label={`Deployment for ${instance.name}`}
          title={compact ? "Deployment" : undefined}
        >
          <SettingsIcon />
          {!compact && "Deployment"}
        </Button>
      )}
      {canEditTools && (
        <Button
          variant="ghost"
          size={buttonSize}
          onClick={() => setToolsOpen(true)}
          aria-label={`Tools for ${instance.name}`}
          title={compact ? "Tools" : undefined}
        >
          <Wrench />
          {!compact && "Tools"}
        </Button>
      )}
      {canStart && (
        <Button
          variant="ghost"
          size={buttonSize}
          onClick={startInstance}
          disabled={starting}
          aria-label={`Start ${instance.name}`}
          title={compact ? "Start" : undefined}
        >
          <PlayIcon />
          {!compact && "Start"}
        </Button>
      )}
      {canStop && (
        <Button
          variant="ghost"
          size={buttonSize}
          onClick={() => setPending("stop")}
          disabled={submitting}
          aria-label={`Stop ${instance.name}`}
          title={compact ? "Stop" : undefined}
        >
          <OctagonIcon />
          {!compact && "Stop"}
        </Button>
      )}
      {canDestroy && (
        <Button
          variant="ghost"
          size={buttonSize}
          onClick={() => setPending("destroy")}
          disabled={submitting}
          className="text-destructive hover:text-destructive"
          aria-label={`Destroy ${instance.name}`}
          title={compact ? "Destroy" : undefined}
        >
          <TrashIcon />
          {!compact && "Destroy"}
        </Button>
      )}

      <DeploymentInspector
        open={inspectorOpen}
        onOpenChange={setInspectorOpen}
        instance={instance}
        onChanged={onChanged}
      />

      {harnessAdapterId && (
        <InstanceToolEditor
          open={toolsOpen}
          onOpenChange={setToolsOpen}
          instance={instance}
          harnessAdapterId={harnessAdapterId}
          onChanged={onChanged}
        />
      )}

      <AlertDialog
        open={pending !== null}
        onOpenChange={(open) => {
          if (!open && !submitting) setPending(null);
        }}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>
              {pending === "stop"
                ? `Stop ${instance.name}?`
                : `Destroy ${instance.name}?`}
            </AlertDialogTitle>
            <AlertDialogDescription>
              {pending === "stop"
                ? "The Fly machine scales to zero. Manual-lifecycle agents can be started again from the fleet row; always-on agents are managed by Fly's auto-start."
                : "The Fly app and all its secrets are removed. This cannot be undone — the row stays for audit."}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={submitting}>Cancel</AlertDialogCancel>
            <AlertDialogAction
              onClick={confirm}
              disabled={submitting}
              variant={pending === "destroy" ? "destructive" : "default"}
            >
              {submitting
                ? pending === "stop"
                  ? "Stopping…"
                  : "Destroying…"
                : pending === "stop"
                  ? "Stop"
                  : "Destroy"}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
