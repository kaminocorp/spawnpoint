import type { Metadata } from "next";

import { OrgToolCuration } from "@/components/settings/org-tool-curation";

export const metadata: Metadata = {
  title: "Tools — Settings — Corellia",
};

/**
 * `/settings/tools` — org-admin curation of the toolset catalog (v1.5
 * Pillar B Phase 6).
 *
 * Server component shell. The auth + org bootstrap lives in
 * `(app)/layout.tsx`, so by the time `<OrgToolCuration>` mounts the
 * `useUser()` context is populated. Role gating happens inside the
 * client component (non-admins see a `[ ADMIN ONLY ]` notice rather
 * than the curation grid); the BE's `SetOrgToolCuration` handler is
 * the actual security boundary — the FE gate is just UX.
 */
export default function SettingsToolsPage() {
  return <OrgToolCuration />;
}
