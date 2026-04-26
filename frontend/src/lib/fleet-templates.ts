"use client";

import { useEffect, useState } from "react";

import { createApiClient } from "@/lib/api/client";

/**
 * `useTemplateAdapterMap` — resolves each AgentInstance's `templateId` to
 * its `harnessAdapterId` so fleet-row surfaces (the v1.5 Pillar B Phase 7
 * `<InstanceToolEditor>`) can scope their tool-catalog fetch correctly.
 *
 * Single-shot fetch on mount; templates rarely change, and the wizard
 * already maintains its own listAgentTemplates cache. v2 (multi-template,
 * post-v1.5) would extend this hook to refetch on visibility regain or on
 * template-creation events.
 */
export function useTemplateAdapterMap(): Record<string, string> {
  const [map, setMap] = useState<Record<string, string>>({});

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const api = createApiClient();
        const res = await api.agents.listAgentTemplates({});
        if (cancelled) return;
        const next: Record<string, string> = {};
        for (const t of res.templates) {
          if (t.id && t.harnessAdapterId) next[t.id] = t.harnessAdapterId;
        }
        setMap(next);
      } catch {
        // Best-effort — without the map the Tools button silently hides
        // (canEditTools gate in `<AgentRowActions>`). The fleet page's
        // primary fetch surfaces any auth / network errors via its own
        // error state.
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  return map;
}
