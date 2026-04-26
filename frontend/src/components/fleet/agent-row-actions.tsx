"use client";

import { useState } from "react";
import { ConnectError } from "@connectrpc/connect";
import { ExternalLinkIcon, OctagonIcon, TrashIcon } from "lucide-react";
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
import type { AgentInstance } from "@/gen/corellia/v1/agents_pb";
import { createApiClient } from "@/lib/api/client";

type Props = {
  instance: AgentInstance;
  onChanged: () => void;
};

type Pending = "stop" | "destroy" | null;

export function AgentRowActions({ instance, onChanged }: Props) {
  const [pending, setPending] = useState<Pending>(null);
  const [submitting, setSubmitting] = useState(false);

  const canStop = instance.status === "running";
  const canDestroy = instance.status !== "destroyed";
  const hasLogs = instance.logsUrl !== "";

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

  return (
    <div className="flex items-center justify-end gap-1">
      {hasLogs && (
        <Button
          variant="ghost"
          size="sm"
          render={
            <a
              href={instance.logsUrl}
              target="_blank"
              rel="noopener noreferrer"
            />
          }
          aria-label={`Logs for ${instance.name}`}
        >
          <ExternalLinkIcon />
          Logs
        </Button>
      )}
      {canStop && (
        <Button
          variant="ghost"
          size="sm"
          onClick={() => setPending("stop")}
          disabled={submitting}
        >
          <OctagonIcon />
          Stop
        </Button>
      )}
      {canDestroy && (
        <Button
          variant="ghost"
          size="sm"
          onClick={() => setPending("destroy")}
          disabled={submitting}
          className="text-destructive hover:text-destructive"
        >
          <TrashIcon />
          Destroy
        </Button>
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
                ? "The Fly machine scales to zero. The agent can be destroyed and re-spawned, but cannot be started again in v1."
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
