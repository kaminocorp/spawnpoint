/**
 * Deployment-config preset tables shared by the spawn wizard
 * (`<DeploymentConfigForm>`) and the fleet inspector edit form
 * (Phase 7). Single source of truth for the preset chips, the
 * default `DeployConfig`, and the labels rendered in fleet rows.
 *
 * Mirrors `internal/deploy/types.go` defaults + bounds. The two
 * sides drift only when this file is updated without the BE side
 * (CHECK constraints in `migrations/20260426160000_fleet_control.sql`
 * are the safety net) — keep both honest.
 */

export type CpuKind = "shared" | "performance";
export type LifecycleMode =
  | "always-on"
  | "manual"
  | "idle-on-demand"
  | "suspended";
export type RestartPolicy = "no" | "always" | "on-failure";

export type DeploymentConfigValues = {
  region: string;
  cpuKind: CpuKind;
  cpus: number;
  memoryMb: number;
  restartPolicy: RestartPolicy;
  restartMaxRetries: number;
  lifecycleMode: LifecycleMode;
  desiredReplicas: number;
  volumeSizeGb: number;
};

/**
 * Region default = `sin` per fleet-control plan resolved Q1.
 * Matches `backend/fly.toml`'s primary region. Org-level default
 * is post-M5; the dropdown lets the operator pick anything else.
 */
export const DEFAULT_REGION = "sin";

/** Mirrors `internal/deploy/types.go` MinReplicas/MaxReplicas. */
export const REPLICA_BOUNDS = { min: 1, max: 10 } as const;

/** Mirrors `internal/deploy/types.go` MinVolumeSize/MaxVolumeSize. */
export const VOLUME_BOUNDS_GB = { min: 1, max: 500 } as const;

export type SizePreset = {
  /** Stable identifier (e.g. `shared-cpu-1x`). Used for chip selection + `Custom · …` rendering on off-preset tuples. */
  readonly id: string;
  readonly label: string;
  readonly cpuKind: CpuKind;
  readonly cpus: number;
  readonly memoryMb: number;
};

/**
 * Preset chips shown in the wizard's Size row. GPU presets hidden
 * per Q3 / decision 3. The trailing `Custom…` chip in the form
 * reveals two number inputs for off-preset tuples.
 *
 * Default = the smallest entry (`shared-cpu-1x · 512MB`), matching
 * the control plane's own size + the Go layer's `DefaultMemoryMB`.
 */
export const SIZE_PRESETS: readonly SizePreset[] = [
  { id: "shared-cpu-1x", label: "shared-cpu-1x · 512MB", cpuKind: "shared", cpus: 1, memoryMb: 512 },
  { id: "shared-cpu-2x", label: "shared-cpu-2x · 1GB", cpuKind: "shared", cpus: 2, memoryMb: 1024 },
  { id: "shared-cpu-4x", label: "shared-cpu-4x · 2GB", cpuKind: "shared", cpus: 4, memoryMb: 2048 },
  { id: "shared-cpu-8x", label: "shared-cpu-8x · 4GB", cpuKind: "shared", cpus: 8, memoryMb: 4096 },
  { id: "performance-1x", label: "performance-1x · 2GB", cpuKind: "performance", cpus: 1, memoryMb: 2048 },
  { id: "performance-2x", label: "performance-2x · 4GB", cpuKind: "performance", cpus: 2, memoryMb: 4096 },
  { id: "performance-4x", label: "performance-4x · 8GB", cpuKind: "performance", cpus: 4, memoryMb: 8192 },
  { id: "performance-8x", label: "performance-8x · 16GB", cpuKind: "performance", cpus: 8, memoryMb: 16384 },
];

export const DEFAULT_PRESET: SizePreset = SIZE_PRESETS[0];

export const DEFAULT_DEPLOYMENT_VALUES: DeploymentConfigValues = {
  region: DEFAULT_REGION,
  cpuKind: DEFAULT_PRESET.cpuKind,
  cpus: DEFAULT_PRESET.cpus,
  memoryMb: DEFAULT_PRESET.memoryMb,
  restartPolicy: "on-failure",
  restartMaxRetries: 3,
  lifecycleMode: "always-on",
  desiredReplicas: 1,
  volumeSizeGb: 1,
};

/** Returns the preset matching (cpuKind, cpus, memoryMb) tuple, or undefined for off-preset values (Custom). */
export function findMatchingPreset(
  cpuKind: CpuKind,
  cpus: number,
  memoryMb: number,
): SizePreset | undefined {
  return SIZE_PRESETS.find(
    (p) => p.cpuKind === cpuKind && p.cpus === cpus && p.memoryMb === memoryMb,
  );
}

/**
 * Renders the size tuple as a fleet-row label. Exact-preset matches
 * surface as the preset id (`shared-cpu-2x`); off-preset tuples
 * render as `Custom · 2x · 1.5GB` per resolved Q3.
 */
export function describeSize(
  cpuKind: CpuKind,
  cpus: number,
  memoryMb: number,
): string {
  const match = findMatchingPreset(cpuKind, cpus, memoryMb);
  if (match) return match.id;
  const gb = (memoryMb / 1024).toFixed(memoryMb % 1024 === 0 ? 0 : 1);
  return `Custom · ${cpus}x · ${gb}GB`;
}
