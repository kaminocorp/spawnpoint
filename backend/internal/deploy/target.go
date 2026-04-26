package deploy

import (
	"context"
	"errors"
)

// ErrNotImplemented is returned by stub DeployTarget implementations.
// Per blueprint §11.4: deferred features stub as real interface
// implementations, not as fake UI buttons. Callers branch on this
// sentinel to render "Coming soon" or surface a 501.
var ErrNotImplemented = errors.New("deploy target not implemented")

// SpawnSpec is the minimal information needed to bring up one
// AgentInstance on any DeployTarget.
type SpawnSpec struct {
	Name     string
	ImageRef string
	Env      map[string]string
	Region   string
	CPUs     int
	MemoryMB int
}

// SpawnResult is what the caller persists as the AgentInstance's
// back-reference to whatever the target created. M5 widening: a
// single Spawn call can create N replicas (plan decision 1 retired
// the M4 one-app=one-machine invariant), so MachineIDs carries every
// machine launched in this Spawn. MachineID stays as a single-value
// convenience for M4-era callers (cmd/smoke-deploy and the agents
// service's pre-Phase-4 path); it equals MachineIDs[0] when N>=1.
type SpawnResult struct {
	ExternalRef string
	MachineID   string
	MachineIDs  []string
}

// HealthStatus is the deployment-side health summary, distinct from
// the harness-side /health endpoint. "started" means the target
// considers the machine running; whether the application inside is
// responsive is a separate concern (see blueprint §3.1).
//
// M5 plan decision 14 adds HealthDrifted: the actual machine count
// or attached-volume size differs from the desired columns. Distinct
// from HealthFailed (which means *broken* — e.g. machine running
// without its $HERMES_HOME volume) so the FE can render a yellow
// banner for recoverable drift vs a red "failed" indicator.
type HealthStatus string

const (
	HealthUnknown  HealthStatus = "unknown"
	HealthStarting HealthStatus = "starting"
	HealthStarted  HealthStatus = "started"
	HealthStopped  HealthStatus = "stopped"
	HealthFailed   HealthStatus = "failed"
	HealthDrifted  HealthStatus = "drifted"
)

// DeployTarget abstracts an infrastructure provider. Per blueprint
// §11.1: no Fly-specific (or AWS-specific, etc.) types leak past
// this interface boundary.
//
// M5 widening (plan §4 Phase 2): seven new methods land on this
// interface plus the Spawn signature gains a DeployConfig param.
// FlyDeployTarget will fill them across Phase 3 (compute side) and
// Phase 3.5 (volume side); the AWS / Local stubs return
// ErrNotImplemented for every new method per blueprint §11.4.
type DeployTarget interface {
	Kind() string

	// Spawn creates the agent's external resources. The DeployConfig
	// arg is M5-new; pre-Phase-4 callers may pass DeployConfig{} and
	// the implementation applies WithDefaults internally.
	Spawn(ctx context.Context, spec SpawnSpec, cfg DeployConfig) (SpawnResult, error)

	// Update applies a config delta against an already-spawned
	// agent. Returns the UpdateKind so the caller can pick the right
	// downtime / confirmation UX. Region change returns
	// UpdateRequiresRespawn without touching Fly — the orchestrator
	// (agents.Service.UpdateDeployConfig) handles destroy + respawn
	// with state-loss confirmation.
	Update(ctx context.Context, externalRef string, cfg DeployConfig) (UpdateKind, error)

	// PreviewUpdate is the read-only dry-run companion to Update —
	// inspects current Fly state and reports what an apply would do
	// (UpdateLiveApplied / UpdateLiveAppliedWithRestart /
	// UpdateRequiresRespawn) without mutating anything. Plan §4
	// Phase 4 NB: the dry-run / apply split is the cleaner shape vs a
	// dryRun bool flag through Update. Used by
	// agents.Service.UpdateDeployConfig when its dryRun argument is
	// true.
	PreviewUpdate(ctx context.Context, externalRef string, cfg DeployConfig) (UpdateKind, error)

	Stop(ctx context.Context, externalRef string) error

	// Start brings every stopped machine back to "started". M5-new:
	// pairs with the per-row Start button on the fleet page when an
	// agent's lifecycle_mode is "manual".
	Start(ctx context.Context, externalRef string) error

	Destroy(ctx context.Context, externalRef string) error

	// Health collapses N replica states into one HealthStatus per
	// plan decision 14. M4's len(machines)>1 error path is gone (it
	// was the v1 invariant; M5 retires it).
	Health(ctx context.Context, externalRef string) (HealthStatus, error)

	// ListRegions returns the cached list of non-deprecated regions
	// the configured Fly token can deploy to. Plan decision 9: the
	// cache lives on FlyDeployTarget itself, refreshed hourly in a
	// background goroutine; this method reads it.
	ListRegions(ctx context.Context) ([]Region, error)

	// CheckPlacement pre-flights a (size, region, replicas, org)
	// tuple via flaps.GetPlacements. The FE calls this on the spawn
	// wizard's Step 5 (Review) for green/red affordance; the BE
	// also calls it before Spawn / Update. Same code path, two
	// callers — plan decision 27.
	CheckPlacement(ctx context.Context, cfg DeployConfig) (PlacementResult, error)

	// ListMachines projects flaps.List into Corellia-shaped
	// MachineState. Used by the fleet inspector and DetectDrift.
	// Plan decision 2: no agent_machines materialised table; this
	// is the read-on-demand path.
	ListMachines(ctx context.Context, externalRef string) ([]MachineState, error)

	// EnsureVolume idempotently provisions a per-replica Fly volume
	// in the given region at the given size. Returns the VolumeRef
	// the caller threads into flaps.Launch's Mounts. Plan decision
	// 8.6: volume-create precedes Launch in the Spawn order, and
	// failure here is rolled back via the existing app-delete
	// deferred chain.
	//
	// Implementation note (Phase 3.5): writes an agent_volumes row
	// via the volumeRecorder interface injected on FlyDeployTarget —
	// keeps blueprint §11.1 (Fly-only inside FlyDeployTarget) AND
	// the M4 separation (DB-only inside the service layer) intact.
	EnsureVolume(ctx context.Context, externalRef string, region string, sizeGB int) (VolumeRef, error)

	// ExtendVolume calls flaps.ExtendVolume and returns whether the
	// machine needs a restart for the new size to take effect (Fly's
	// API surfaces this as a separate boolean). Shrink attempts
	// must be rejected by the caller before reaching here; this
	// method assumes newSizeGB >= current.
	ExtendVolume(ctx context.Context, externalRef string, volumeID string, newSizeGB int) (needsRestart bool, err error)
}
