// Thin wrappers over the tools-governance Connect-go RPCs (Phase 3).
//
// The wizard "TOOLS" step (Phase 4), the org-curation page (Phase 6), and
// the per-instance grant editor (Phase 7) all consume these. Each wrapper:
//   1. takes the Connect transport-bound client (`createApiClient().tools`),
//   2. shapes its arguments into the request message,
//   3. unwraps the response message to the field the caller actually wants.
//
// No logic beyond shape translation lives here — keep this module a flat
// surface so callers don't have to learn the proto field names.

import { create } from "@bufbuild/protobuf";
import type { JsonObject } from "@bufbuild/protobuf";

import {
  GetInstanceToolGrantsRequestSchema,
  GetOrgToolCurationRequestSchema,
  ListToolsRequestSchema,
  SetInstanceToolGrantsRequestSchema,
  SetOrgToolCurationRequestSchema,
  ToolGrantInputSchema,
  type Tool,
  type ToolGrant,
  type ToolService,
} from "@/gen/corellia/v1/tools_pb";

import type { Client } from "@connectrpc/connect";

type ToolsClient = Client<typeof ToolService>;

/** ListTools — catalog scoped to the caller's org (enabled_for_org merged). */
export async function listTools(
  client: ToolsClient,
  args: { harnessAdapterId: string; adapterVersion?: string },
): Promise<Tool[]> {
  const req = create(ListToolsRequestSchema, {
    harnessAdapterId: args.harnessAdapterId,
    adapterVersion: args.adapterVersion ?? "",
  });
  const res = await client.listTools(req);
  return res.tools;
}

/** GetOrgToolCuration — full catalog with the per-toolset enabled flag. */
export async function getOrgToolCuration(
  client: ToolsClient,
  args: { harnessAdapterId: string; adapterVersion?: string },
): Promise<Tool[]> {
  const req = create(GetOrgToolCurationRequestSchema, {
    harnessAdapterId: args.harnessAdapterId,
    adapterVersion: args.adapterVersion ?? "",
  });
  const res = await client.getOrgToolCuration(req);
  return res.tools;
}

/**
 * SetOrgToolCuration — toggle a single toolset for the caller's org.
 * Server enforces the org-admin role gate; the FE will hide the toggle
 * for non-admins (Phase 6 wires the role check in the page component).
 */
export async function setOrgToolCuration(
  client: ToolsClient,
  args: { toolId: string; enabled: boolean },
): Promise<Tool> {
  const req = create(SetOrgToolCurationRequestSchema, {
    toolId: args.toolId,
    enabled: args.enabled,
  });
  const res = await client.setOrgToolCuration(req);
  if (!res.tool) throw new Error("setOrgToolCuration: server returned no tool");
  return res.tool;
}

/** GetInstanceToolGrants — the active grant set for an instance. */
export async function getInstanceToolGrants(
  client: ToolsClient,
  args: { instanceId: string },
): Promise<ToolGrant[]> {
  const req = create(GetInstanceToolGrantsRequestSchema, {
    instanceId: args.instanceId,
  });
  const res = await client.getInstanceToolGrants(req);
  return res.grants;
}

/** GrantInput — the per-grant intent the wizard / inspector sends. */
export type GrantInput = {
  toolId: string;
  /**
   * Free-form scope object (matches the toolset's scope_shape).
   * Sent over the wire as google.protobuf.Struct, which protobuf-es
   * surfaces as a JsonObject — i.e. any JSON-clean value works.
   */
  scope?: JsonObject;
  credentialStorageRef?: string;
};

/**
 * SetInstanceToolGrants — atomically replace the grant set. Returns the
 * canonical post-write grants + the new manifest_version (for ETag-aware
 * callers, e.g. the optional fleet-view "Restart now" affordance in
 * Phase 7).
 */
export async function setInstanceToolGrants(
  client: ToolsClient,
  args: { instanceId: string; grants: GrantInput[] },
): Promise<{ grants: ToolGrant[]; manifestVersion: bigint }> {
  const req = create(SetInstanceToolGrantsRequestSchema, {
    instanceId: args.instanceId,
    grants: args.grants.map((g) =>
      create(ToolGrantInputSchema, {
        toolId: g.toolId,
        scope: g.scope,
        credentialStorageRef: g.credentialStorageRef ?? "",
      }),
    ),
  });
  const res = await client.setInstanceToolGrants(req);
  return { grants: res.grants, manifestVersion: res.manifestVersion };
}
