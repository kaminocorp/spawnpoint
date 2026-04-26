package deploy

import "errors"

// Sentinels for the M5 fleet-control surface. Plan decision 25
// shapes the Connect-code mapping at the handler layer:
//
//   ErrInvalidRegion / ErrInvalidSize / ErrInvalidVolumeSize → InvalidArgument
//   ErrPlacementUnavailable                                  → FailedPrecondition
//   ErrLifecycleUnsupported                                  → Unimplemented
//   ErrMachineBusy                                           → Aborted
//   ErrVolumeShrink                                          → InvalidArgument
//   ErrVolumeProvisionFailed                                 → Unavailable (redacted message)
//
// The mapping itself lives in agents.agentsErrToConnect (added in
// Phase 5); these sentinels are the source-of-truth axis.
//
// Pre-existing sentinels (ErrNotImplemented in target.go,
// ErrTargetNotConfigured in resolver.go) stay where they are —
// they predate this file and renaming them would churn unrelated
// imports. New sentinels collect here so a future contributor has
// a single grep target for the M5 error vocabulary.
var (
	// ErrInvalidRegion: the region code is not in the cached
	// ListRegions result (or the cache is empty / never refreshed).
	// Validation that needs the live list lives on the service
	// layer, not on DeployConfig.Validate (decision 20 caveat).
	ErrInvalidRegion = errors.New("deploy: invalid region")

	// ErrInvalidSize: cpu_kind / cpus / memory_mb / replicas /
	// restart_* fail DeployConfig.Validate's static bounds. The
	// wrapped error message identifies which field.
	ErrInvalidSize = errors.New("deploy: invalid size")

	// ErrInvalidVolumeSize: volume_size_gb out of [1,500]. Distinct
	// sentinel because the FE renders different copy and because
	// shrink-attempts get their own sentinel below.
	ErrInvalidVolumeSize = errors.New("deploy: invalid volume size")

	// ErrPlacementUnavailable: flaps.GetPlacements rejected the
	// (size, region, count, org) tuple. Surfaced as FailedPrecondition
	// because it is recoverable by editing the request (different
	// region or smaller size), not by retrying as-is.
	ErrPlacementUnavailable = errors.New("deploy: placement unavailable")

	// ErrLifecycleUnsupported: the requested lifecycle_mode is in
	// the DB enum but not accepted by v1.5's API (idle-on-demand /
	// suspended — plan decision 3). The DB column is forwards-
	// compatible; this sentinel is the API-side gate.
	ErrLifecycleUnsupported = errors.New("deploy: lifecycle mode unsupported in v1.5")

	// ErrMachineBusy: flaps.AcquireLease failed because another
	// operation holds the lease (plan decision 18). Mapped to
	// Aborted at the handler layer per Connect's semantic
	// ("transient; retryable").
	ErrMachineBusy = errors.New("deploy: machine busy (lease contention)")

	// ErrVolumeShrink: caller asked to set volume_size_gb below
	// the current value. Fly's API only supports extend (decision
	// 8.3); the FE blocks client-side and the BE rejects as a
	// belt-and-braces guard.
	ErrVolumeShrink = errors.New("deploy: volume size can only be extended, not shrunk")

	// ErrVolumeProvisionFailed: flaps.CreateVolume failed mid-Spawn.
	// Surfaced as Unavailable (provider-side failure) and the
	// upstream error string is redacted at the handler layer per
	// the M4 ErrFlyAPI redaction pattern (decision 25 cross-ref).
	ErrVolumeProvisionFailed = errors.New("deploy: volume provision failed")
)
