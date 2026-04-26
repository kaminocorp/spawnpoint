package deploy

import (
	"fmt"
	"time"
)

// DeployConfig is the typed shape callers pass to Spawn / Update —
// the v1.5 fleet-control surface. Per plan decision 5: typed Go
// fields, not a JSONB blob, so the agent_instances columns get
// CHECK-constrained at the DB layer and stay queryable for fleet
// stats. The nine fields here mirror the nine columns added in
// migration 20260426160000_fleet_control.sql.
//
// Zero values are accepted at the Validate boundary as "use defaults"
// (Phase 2 caveat: existing callers in agents.Service and
// cmd/smoke-deploy pass zero-value DeployConfig{} until Phase 4 wires
// real values from the wire). Plan §4 Phase 2 exit criterion
// explicitly relies on this.
type DeployConfig struct {
	Region            string
	CPUKind           string
	CPUs              int
	MemoryMB          int
	RestartPolicy     string
	RestartMaxRetries int
	LifecycleMode     string
	DesiredReplicas   int
	VolumeSizeGB      int

	// ChatEnabled controls whether the chat sidecar runs alongside the
	// harness inside the deployed machine. M-chat Phase 3 + plan
	// decision 6.
	//
	// When TRUE: FlyDeployTarget.Spawn emits a `services` block on the
	// machine config (external :443 → internal :8642), and the agents
	// service layer adds CORELLIA_CHAT_ENABLED=true plus a generated
	// CORELLIA_SIDECAR_AUTH_TOKEN to the spec.Env map (which the
	// FlyDeployTarget.Spawn loop persists as Fly app secrets, alongside
	// CORELLIA_MODEL_API_KEY). The adapter image's entrypoint.sh
	// (Phase 2) reads CORELLIA_CHAT_ENABLED and starts the sidecar
	// process only on the literal string "true" (default-deny per risk
	// 4); the sidecar's bearer-auth middleware reads the token.
	//
	// When FALSE (Go zero, the byte-equivalent-to-M5 path): no services
	// block, no chat env vars, no audit secret row. The deployed
	// machine has no inbound network exposure — same posture as every
	// pre-this-milestone agent.
	//
	// No WithDefaults treatment — the wire / handler layer is the
	// single source of truth. Phase 3-to-Phase 5 callers (which don't
	// yet carry the field on the wire) get the Go zero value (FALSE),
	// matching the gap-period intent that chat opt-in lands when the
	// wizard ships in Phase 5.
	ChatEnabled bool
}

// Defaults that line up with the migration's column DEFAULTs and
// decision 5's typed-primitive choice. Centralised so Validate's
// "zero means default" path and the eventual Phase 4 service-layer
// fallback path read the same numbers.
const (
	DefaultRegion            = "iad"
	DefaultCPUKind           = "shared"
	DefaultCPUs              = 1
	DefaultMemoryMB          = 512
	DefaultRestartPolicy     = "on-failure"
	DefaultRestartMaxRetries = 3
	DefaultLifecycleMode     = "always-on"
	DefaultDesiredReplicas   = 1
	DefaultVolumeSizeGB      = 1

	// Replica + volume bounds. These mirror the DB CHECK constraints
	// in migration 20260426160000_fleet_control.sql; duplicating them
	// in Go is deliberate (decision 20: validation belongs with the
	// type that defines the field set, not deferred to the SQL layer
	// where the error surface is unstructured).
	MinReplicas    = 1
	MaxReplicas    = 10
	MinVolumeSize  = 1
	MaxVolumeSize  = 500
	MinCPUs        = 1
	MaxCPUs        = 16
	MinMemoryMB    = 256
	MaxMemoryMB    = 131072
	MemoryStepMB   = 256
)

// WithDefaults returns a copy with zero-valued fields filled in.
// Callers ahead of Phase 4 (agents.Service.Spawn, cmd/smoke-deploy)
// pass zero values; this method is the single place that decides
// what zero means. Once Phase 4 lands and the service layer carries
// real values from the wire, the only zero-coalescing left is the
// Validate-time treatment of "client omitted optional field" via
// the proto's `optional` semantics.
func (c DeployConfig) WithDefaults() DeployConfig {
	if c.Region == "" {
		c.Region = DefaultRegion
	}
	if c.CPUKind == "" {
		c.CPUKind = DefaultCPUKind
	}
	if c.CPUs == 0 {
		c.CPUs = DefaultCPUs
	}
	if c.MemoryMB == 0 {
		c.MemoryMB = DefaultMemoryMB
	}
	if c.RestartPolicy == "" {
		c.RestartPolicy = DefaultRestartPolicy
	}
	// RestartMaxRetries: 0 is a meaningful value (no retries); only
	// the negative case is invalid and gets caught in Validate.
	if c.LifecycleMode == "" {
		c.LifecycleMode = DefaultLifecycleMode
	}
	if c.DesiredReplicas == 0 {
		c.DesiredReplicas = DefaultDesiredReplicas
	}
	if c.VolumeSizeGB == 0 {
		c.VolumeSizeGB = DefaultVolumeSizeGB
	}
	return c
}

// Validate enforces the field-level constraints from plan decision
// 20. Region membership against the live cached list is NOT checked
// here — that's a runtime concern (the cache lives on FlyDeployTarget
// per decision 17) and would couple this struct to the deploy target.
// The service layer cross-checks region against ListRegions before
// calling Spawn / Update.
//
// Returns wrapped sentinels so handlers can fmt.Errorf("...: %w", e)
// and downstream errors.Is() still discriminates.
func (c DeployConfig) Validate() error {
	c = c.WithDefaults()
	switch c.CPUKind {
	case "shared", "performance":
	default:
		return fmt.Errorf("%w: cpu_kind %q (want shared|performance)", ErrInvalidSize, c.CPUKind)
	}
	if c.CPUs < MinCPUs || c.CPUs > MaxCPUs {
		return fmt.Errorf("%w: cpus %d out of range [%d,%d]", ErrInvalidSize, c.CPUs, MinCPUs, MaxCPUs)
	}
	if c.MemoryMB < MinMemoryMB || c.MemoryMB > MaxMemoryMB {
		return fmt.Errorf("%w: memory_mb %d out of range [%d,%d]", ErrInvalidSize, c.MemoryMB, MinMemoryMB, MaxMemoryMB)
	}
	if c.MemoryMB%MemoryStepMB != 0 {
		return fmt.Errorf("%w: memory_mb %d must be a multiple of %d", ErrInvalidSize, c.MemoryMB, MemoryStepMB)
	}
	switch c.RestartPolicy {
	case "no", "always", "on-failure":
	default:
		return fmt.Errorf("%w: restart_policy %q", ErrInvalidSize, c.RestartPolicy)
	}
	if c.RestartMaxRetries < 0 {
		return fmt.Errorf("%w: restart_max_retries %d (must be >= 0)", ErrInvalidSize, c.RestartMaxRetries)
	}
	switch c.LifecycleMode {
	case "always-on", "manual":
		// Accepted in v1.5 per plan decision 3.
	case "idle-on-demand", "suspended":
		// DB column admits these but the API rejects them in v1.5
		// (plan decision 3 — gated on the agent-network-exposure
		// model decision). Surface as Unimplemented at the handler
		// layer via the sentinel.
		return fmt.Errorf("%w: lifecycle_mode %q (deferred to v2)", ErrLifecycleUnsupported, c.LifecycleMode)
	default:
		return fmt.Errorf("%w: lifecycle_mode %q", ErrInvalidSize, c.LifecycleMode)
	}
	if c.DesiredReplicas < MinReplicas || c.DesiredReplicas > MaxReplicas {
		return fmt.Errorf("%w: desired_replicas %d out of range [%d,%d]", ErrInvalidSize, c.DesiredReplicas, MinReplicas, MaxReplicas)
	}
	if c.VolumeSizeGB < MinVolumeSize || c.VolumeSizeGB > MaxVolumeSize {
		return fmt.Errorf("%w: volume_size_gb %d out of range [%d,%d]", ErrInvalidVolumeSize, c.VolumeSizeGB, MinVolumeSize, MaxVolumeSize)
	}
	return nil
}

// Region is Corellia's projection of fly.Region (plan decision 17).
// Re-exporting fly.Region would leak the Fly type out of
// internal/deploy and break blueprint §11.1; this four-field shape
// is what the FE actually consumes via the ListDeploymentRegions
// RPC.
type Region struct {
	Code           string // e.g. "iad"
	Name           string // e.g. "Ashburn, Virginia (US)"
	Deprecated     bool
	RequiresPaidPlan bool
}

// UpdateKind tells the caller whether an Update was applied in
// place, applied with a brief restart, or requires destroy + respawn.
// Three values per plan decision 6 (refining the original two-value
// proposal). The FE uses this to pick the right confirmation copy:
// silent toast / brief-restart toast / destructive-confirmation
// modal.
type UpdateKind string

const (
	UpdateLiveApplied            UpdateKind = "live_applied"
	UpdateLiveAppliedWithRestart UpdateKind = "live_applied_with_restart"
	UpdateRequiresRespawn        UpdateKind = "requires_respawn"
)

// PlacementResult is the FE-renderable answer to "can this config
// fit in this region for this org's token?" Plan decision 10:
// CheckPlacement runs on the BE before Spawn / Update, and is also
// exposed to the FE for preview-time green/red gating (decision 27).
type PlacementResult struct {
	Available        bool
	Reason           string
	AlternateRegions []string
}

// MachineState is the per-replica observation projected from
// flaps.List. Plan decision 2: no agent_machines table; per-machine
// state is read from Fly on demand and shaped into this struct for
// rendering and drift detection.
//
// AttachedVolumeID is populated from machine.Config.Mounts (Phase
// 3.5 wires it). Empty string on machines that have no mount —
// expected on M4 agents pre-volume-backfill.
type MachineState struct {
	ID               string
	Region           string
	State            string // raw Fly state; map via mapFlyState for HealthStatus
	CPUKind          string
	CPUs             int
	MemoryMB         int
	CreatedAt        time.Time
	AttachedVolumeID string
}

// VolumeRef is the typed return from EnsureVolume / the projected
// shape from agent_volumes rows. Plan decision 8: one row per
// replica, region-pinned, mounted at /opt/data (Hermes default per
// upstream Dockerfile; Q9 makes the path a column for forward
// compatibility).
type VolumeRef struct {
	VolumeID  string
	Region    string
	SizeGB    int
	MachineID string // empty until SetAgentVolumeMachine fills it
}
