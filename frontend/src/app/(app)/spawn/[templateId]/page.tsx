import type { Metadata } from "next";

import { Wizard } from "@/components/spawn/wizard";

export const metadata: Metadata = {
  title: "Spawn // Configure — Corellia",
};

/**
 * `/spawn/[templateId]` — character configuration wizard.
 *
 * Phase 4 of `docs/executing/agents-ui-mods.md`. Server entry unwraps the
 * Next 16 async-params Promise and hands the id to the client `<Wizard>`,
 * which performs the template lookup via the existing `listAgentTemplates`
 * RPC (no dedicated `getAgentTemplate` per plan §4 Phase 4 — future
 * cleanup). The lookup happens client-side because the project's
 * `createApiClient()` transport binds to the browser-only Supabase
 * session; introducing a server-side variant is the kind of abstraction
 * Phase 4 deliberately doesn't take on.
 */
export default async function SpawnTemplatePage({
  params,
}: {
  params: Promise<{ templateId: string }>;
}) {
  const { templateId } = await params;
  return <Wizard templateId={templateId} initialMode="confirmed" />;
}
