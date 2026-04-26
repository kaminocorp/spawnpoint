package agents

import (
	"context"
	"errors"
	"fmt"
	"log/slog"
	"time"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5"
	"golang.org/x/sync/errgroup"
	"golang.org/x/sync/semaphore"

	"github.com/hejijunhao/corellia/backend/internal/db"
	"github.com/hejijunhao/corellia/backend/internal/deploy"
	corelliav1 "github.com/hejijunhao/corellia/backend/internal/gen/corellia/v1"
)

// UpdateResult is the typed return from UpdateDeployConfig — the
// dry-run preview surface and the apply-success surface use the same
// shape so the FE renders one component for both. Plan §4 Phase 4
// resolved Q5 dropped the cost estimate; EstimatedDowntime stays
// because the FE's confirmation modal copy diverges across the three
// UpdateKind values.
type UpdateResult struct {
	Kind              deploy.UpdateKind
	EstimatedDowntime time.Duration
}

// BulkResult is the per-instance outcome of a BulkUpdateDeployConfig
// fan-out. Plan §4 Phase 4 + Phase 8 risk 5: partial success is
// normal; the FE renders a row per result so failed instances stay
// selected for retry.
type BulkResult struct {
	InstanceID uuid.UUID
	Kind       deploy.UpdateKind
	Err        error
}

// BulkConfigDelta is DeployConfig minus VolumeSizeGB. Per decision
// 8.4 + Phase 1's BulkUpdateAgentDeployConfig SQL: bulk apply must
// not touch volume size. Carving the type at the type level (not
// just at the SQL boundary) makes that invariant compile-time-
// enforced — no caller can accidentally bulk-extend volumes.
type BulkConfigDelta struct {
	Region            string
	CPUKind           string
	CPUs              int
	MemoryMB          int
	RestartPolicy     string
	RestartMaxRetries int
	LifecycleMode     string
	DesiredReplicas   int
}

// AsDeployConfig projects BulkConfigDelta back into a DeployConfig
// for validation + the per-instance Update path. VolumeSizeGB is
// filled with the per-instance current value by the caller before
// invoking deployer.Update — the bulk delta carries no volume info.
func (d BulkConfigDelta) AsDeployConfig(currentVolumeSizeGB int) deploy.DeployConfig {
	return deploy.DeployConfig{
		Region:            d.Region,
		CPUKind:           d.CPUKind,
		CPUs:              d.CPUs,
		MemoryMB:          d.MemoryMB,
		RestartPolicy:     d.RestartPolicy,
		RestartMaxRetries: d.RestartMaxRetries,
		LifecycleMode:     d.LifecycleMode,
		DesiredReplicas:   d.DesiredReplicas,
		VolumeSizeGB:      currentVolumeSizeGB,
	}
}

// DriftReport is the aggregate of the five drift categories from
// plan §4 Phase 4. Empty `Categories` slice means "no drift" — the
// FE renders the row's banner accordingly.
type DriftReport struct {
	InstanceID uuid.UUID
	Categories []DriftCategory
	Details    []string // human-readable bullet per category
}

// DriftCategory is the closed set of drift kinds the v1.5 inspector
// surfaces. Plan §4 Phase 4 enumerates the five values; widening the
// set in v2 is a typed-enum addition, not a string-format change.
type DriftCategory string

const (
	DriftCountMismatch       DriftCategory = "count_mismatch"
	DriftSizeMismatch        DriftCategory = "size_mismatch"
	DriftVolumeMismatch      DriftCategory = "volume_mismatch"
	DriftVolumeSizeMismatch  DriftCategory = "volume_size_mismatch"
	DriftVolumeUnattached    DriftCategory = "volume_unattached"
)

// estimatedDowntime maps an UpdateKind to a coarse FE-renderable
// duration. The values are intentionally round-numbered estimates,
// not measurements — the M5 fleet UI surfaces them as "no downtime",
// "~5s", "~30s" copy, so single-digit precision is fine.
func estimatedDowntime(kind deploy.UpdateKind) time.Duration {
	switch kind {
	case deploy.UpdateLiveApplied:
		return 0
	case deploy.UpdateLiveAppliedWithRestart:
		return 5 * time.Second
	case deploy.UpdateRequiresRespawn:
		return 30 * time.Second
	}
	return 0
}

// ListRegions returns the cached non-deprecated Fly regions. Plan §4
// Phase 5: thin service-layer wrapper so the handler stays <30 LOC and
// the deploy package stays sealed behind agents.Service. The cache
// itself lives on FlyDeployTarget per decision 9.
func (s *Service) ListRegions(ctx context.Context) ([]deploy.Region, error) {
	target, err := s.flyTarget(ctx)
	if err != nil {
		return nil, err
	}
	return target.ListRegions(ctx)
}

// CheckPlacement pre-flights a (size, region, replicas, org) tuple via
// flaps.GetPlacements. Same code path the spawn wizard's review step
// (FE) and Spawn / Update (BE) call — plan decision 27.
func (s *Service) CheckPlacement(
	ctx context.Context, cfg deploy.DeployConfig,
) (deploy.PlacementResult, error) {
	cfg = cfg.WithDefaults()
	if err := cfg.Validate(); err != nil {
		return deploy.PlacementResult{}, err
	}
	target, err := s.flyTarget(ctx)
	if err != nil {
		return deploy.PlacementResult{}, err
	}
	return target.CheckPlacement(ctx, cfg)
}

// UpdateDeployConfig applies a config delta against an existing
// agent. Plan §4 Phase 4:
//
//  1. Load instance with org-guard.
//  2. Validate cfg.
//  3. CheckPlacement (read-only) — fail-fast if Fly can't place it.
//  4. Resolve UpdateKind via deployer.PreviewUpdate (read-only).
//  5. dryRun? → return UpdateResult without persisting or mutating Fly.
//  6. RequiresRespawn → destroy old app + spawn new one + persist new
//     config + new deploy_external_ref. The instance.id is preserved.
//  7. LiveApplied / LiveAppliedWithRestart → call deployer.Update +
//     persist via UpdateAgentDeployConfig + spawn pollHealth.
func (s *Service) UpdateDeployConfig(
	ctx context.Context,
	instanceID, orgID uuid.UUID,
	cfg deploy.DeployConfig,
	dryRun bool,
) (*UpdateResult, error) {
	row, err := s.queries.GetAgentInstanceByID(ctx, db.GetAgentInstanceByIDParams{ID: instanceID, OrgID: orgID})
	if err != nil {
		if errors.Is(err, pgx.ErrNoRows) {
			return nil, ErrInstanceNotFound
		}
		return nil, err
	}
	cfg = cfg.WithDefaults()
	if err := cfg.Validate(); err != nil {
		return nil, err
	}

	target, err := s.flyTarget(ctx)
	if err != nil {
		return nil, err
	}

	placement, err := target.CheckPlacement(ctx, cfg)
	if err != nil {
		return nil, err
	}
	if !placement.Available {
		return nil, fmt.Errorf("%w: %s", deploy.ErrPlacementUnavailable, placement.Reason)
	}

	if row.DeployExternalRef == nil || *row.DeployExternalRef == "" {
		// Pending instance with no Fly app yet — the boot-time sweep
		// will reap it; UpdateDeployConfig is meaningless on this
		// row. Surface as not-found so the FE doesn't render a
		// confusing "edit succeeded" toast on a row that will fail
		// in a few minutes.
		return nil, ErrInstanceNotFound
	}
	ref := *row.DeployExternalRef

	kind, err := target.PreviewUpdate(ctx, ref, cfg)
	if err != nil {
		return nil, err
	}

	if dryRun {
		return &UpdateResult{Kind: kind, EstimatedDowntime: estimatedDowntime(kind)}, nil
	}

	switch kind {
	case deploy.UpdateRequiresRespawn:
		if err := s.respawnAgent(ctx, row, cfg, target); err != nil {
			return nil, err
		}
	case deploy.UpdateLiveApplied, deploy.UpdateLiveAppliedWithRestart:
		appliedKind, err := target.Update(ctx, ref, cfg)
		if err != nil {
			slog.Error("agents: update deploy config", "instance_id", instanceID, "err", err)
			return nil, ErrFlyAPI
		}
		kind = appliedKind
		if err := s.queries.UpdateAgentDeployConfig(ctx, deployConfigParams(instanceID, orgID, cfg)); err != nil {
			return nil, fmt.Errorf("agents: persist deploy config: %w", err)
		}
		go s.pollHealth(instanceID, target, ref, row.ChatEnabled)
	default:
		return nil, fmt.Errorf("agents: unexpected update kind %q", kind)
	}

	return &UpdateResult{Kind: kind, EstimatedDowntime: estimatedDowntime(kind)}, nil
}

// respawnAgent is the destructive update path: destroy the existing
// app, spawn a fresh one with the new config, and rewrite the
// agent_instances row's deploy_external_ref. The instance.id is
// preserved (FE links / audit history survive the respawn). Plan §6
// risk 3: on Spawn failure mid-respawn, the old app has already been
// destroyed; we surface the error and rely on the boot-time sweep
// (decision 32) to mark the row failed.
//
// Note: today's Spawn signature uses spec.Name = instance.ID.String()
// which produces a deterministic Fly app name. The "fresh" Spawn
// will collide with the just-destroyed app's name unless Fly's
// destroy is fully synchronous before the create. Empirically Fly's
// DeleteApp blocks until the app is gone; we accept that contract
// here. If a future Fly API change makes destroy async, this path
// would need a wait-for-deletion step.
func (s *Service) respawnAgent(
	ctx context.Context, row db.GetAgentInstanceByIDRow, cfg deploy.DeployConfig, target deploy.DeployTarget,
) error {
	if row.DeployExternalRef == nil {
		return ErrInstanceNotFound
	}
	if err := target.Destroy(ctx, *row.DeployExternalRef); err != nil {
		slog.Error("agents: respawn destroy", "instance_id", row.ID, "err", err)
		return ErrFlyAPI
	}

	// Re-resolve the template + adapter to get the image ref. Same
	// helper Spawn uses — keeps the resolution logic single-sourced.
	tmpl, adapter, _, _, err := s.resolveSpawnDeps(ctx, row.AgentTemplateID)
	if err != nil {
		return err
	}
	_ = tmpl // template name isn't needed here; the row already has agent_template_id pinned.

	spec := deploy.SpawnSpec{
		Name:     row.ID.String(),
		ImageRef: adapter.AdapterImageRef,
		Env: map[string]string{
			"CORELLIA_AGENT_ID":       row.ID.String(),
			"CORELLIA_MODEL_PROVIDER": row.ModelProvider,
			"CORELLIA_MODEL_NAME":     row.ModelName,
			// Note: the model API key isn't re-supplied on respawn
			// today. v1.5 follow-up — the secret store path that the
			// audit row points at is the source of truth; the
			// respawn flow needs to fetch it from there. Until that
			// lands, region-change respawns require the operator to
			// re-paste the API key via the wizard. Tracked in the
			// Phase 4 completion notes.
		},
	}
	result, err := target.Spawn(ctx, spec, cfg)
	if err != nil {
		slog.Error("agents: respawn spawn", "instance_id", row.ID, "err", err)
		return ErrFlyAPI
	}

	if err := s.queries.SetAgentInstanceDeployRef(ctx, db.SetAgentInstanceDeployRefParams{
		ID:                row.ID,
		DeployExternalRef: ptrOf(result.ExternalRef),
	}); err != nil {
		return fmt.Errorf("agents: respawn ref update: %w", err)
	}
	if err := s.queries.UpdateAgentDeployConfig(ctx, deployConfigParams(row.ID, row.OrgID, cfg)); err != nil {
		return fmt.Errorf("agents: respawn persist deploy config: %w", err)
	}
	go s.pollHealth(row.ID, target, result.ExternalRef, row.ChatEnabled)
	return nil
}

// StartInstance brings every stopped machine back to "started" and
// flips status from stopped → pending while the poll waits for
// running. Plan §4 Phase 4: paired with the per-row Start button on
// the fleet page when an agent's lifecycle_mode is "manual".
func (s *Service) StartInstance(ctx context.Context, instanceID, orgID uuid.UUID) (*corelliav1.AgentInstance, error) {
	row, err := s.queries.GetAgentInstanceByID(ctx, db.GetAgentInstanceByIDParams{ID: instanceID, OrgID: orgID})
	if err != nil {
		if errors.Is(err, pgx.ErrNoRows) {
			return nil, ErrInstanceNotFound
		}
		return nil, err
	}
	if row.DeployExternalRef == nil || *row.DeployExternalRef == "" {
		return nil, ErrInstanceNotFound
	}
	target, err := s.flyTarget(ctx)
	if err != nil {
		return nil, err
	}
	if err := target.Start(ctx, *row.DeployExternalRef); err != nil {
		slog.Error("agents: start", "instance_id", instanceID, "err", err)
		return nil, ErrFlyAPI
	}
	go s.pollHealth(instanceID, target, *row.DeployExternalRef, row.ChatEnabled)
	return s.Get(ctx, instanceID, orgID)
}

// RestartInstance cycles every started machine in the instance's Fly app.
// v1.5 Pillar B Phase 7: drives the fleet inspector's "Restart now" button
// so operators can apply restart-required tool-grant changes (the new
// platform_toolsets list in $HERMES_HOME/config.yaml only re-reads at boot)
// without editing Fly directly.
//
// Skips and stays graceful in two cases:
//   - row is in a terminal state (destroyed) → returns ErrInstanceNotFound
//     so the FE 404s instead of issuing a no-op flaps call;
//   - row.deploy_external_ref is unset → ErrInstanceNotFound (a pending
//     instance with no Fly app has nothing to restart).
//
// On success, appends an `instance_restart` audit row through the
// tools-governance audit hook (no-op when WithToolsAuditAppender wasn't
// wired, e.g. local dev without CORELLIA_API_URL).
func (s *Service) RestartInstance(ctx context.Context, actorUserID, instanceID, orgID uuid.UUID) (*corelliav1.AgentInstance, error) {
	row, err := s.queries.GetAgentInstanceByID(ctx, db.GetAgentInstanceByIDParams{ID: instanceID, OrgID: orgID})
	if err != nil {
		if errors.Is(err, pgx.ErrNoRows) {
			return nil, ErrInstanceNotFound
		}
		return nil, err
	}
	if row.Status == "destroyed" {
		return nil, ErrInstanceNotFound
	}
	if row.DeployExternalRef == nil || *row.DeployExternalRef == "" {
		return nil, ErrInstanceNotFound
	}
	target, err := s.flyTarget(ctx)
	if err != nil {
		return nil, err
	}
	if err := target.Restart(ctx, *row.DeployExternalRef); err != nil {
		slog.Error("agents: restart", "instance_id", instanceID, "err", err)
		return nil, ErrFlyAPI
	}
	if s.auditAppender != nil {
		s.auditAppender.AppendInstanceRestartAudit(ctx, actorUserID, orgID, instanceID)
	}
	return s.Get(ctx, instanceID, orgID)
}

// ResizeReplicas changes only the desired replica count. Plan §4
// Phase 4: validate desired in [1, 10], persist, call deployer.Update
// for the reconciliation. The per-replica volume provisioning /
// cleanup is deployer.Update's job (Phase 3.5); agents.Service does
// not loop machines itself.
func (s *Service) ResizeReplicas(
	ctx context.Context, instanceID, orgID uuid.UUID, desired int,
) (*UpdateResult, error) {
	if desired < deploy.MinReplicas || desired > deploy.MaxReplicas {
		return nil, fmt.Errorf("%w: desired_replicas %d out of range [%d,%d]",
			deploy.ErrInvalidSize, desired, deploy.MinReplicas, deploy.MaxReplicas)
	}
	row, err := s.queries.GetAgentInstanceByID(ctx, db.GetAgentInstanceByIDParams{ID: instanceID, OrgID: orgID})
	if err != nil {
		if errors.Is(err, pgx.ErrNoRows) {
			return nil, ErrInstanceNotFound
		}
		return nil, err
	}
	if row.DeployExternalRef == nil || *row.DeployExternalRef == "" {
		return nil, ErrInstanceNotFound
	}
	target, err := s.flyTarget(ctx)
	if err != nil {
		return nil, err
	}

	cfg := deployConfigFromInstance(row)
	cfg.DesiredReplicas = desired

	kind, err := target.Update(ctx, *row.DeployExternalRef, cfg)
	if err != nil {
		slog.Error("agents: resize replicas", "instance_id", instanceID, "err", err)
		return nil, ErrFlyAPI
	}
	if err := s.queries.UpdateAgentReplicas(ctx, db.UpdateAgentReplicasParams{
		ID: instanceID, OrgID: orgID, DesiredReplicas: int32(desired),
	}); err != nil {
		return nil, fmt.Errorf("agents: persist replicas: %w", err)
	}
	go s.pollHealth(instanceID, target, *row.DeployExternalRef, row.ChatEnabled)
	return &UpdateResult{Kind: kind, EstimatedDowntime: estimatedDowntime(kind)}, nil
}

// ResizeVolume extends the agent's volumes to a new size. Plan §4
// Phase 4: validate newSizeGB ≥ current (else ErrVolumeShrink),
// enumerate agent_volumes rows, call deployer.ExtendVolume for each,
// then update the parent's desired-state column AND every per-row
// mirror in one tx. Spawn pollHealth if any extension reported
// needsRestart (Fly may roll the machine to apply the size change).
//
// Empty volumes slice (M4-era agents) → no-op success after the
// shrink check + parent-row update. ResizeVolume on a pre-volume
// agent is a forward-compat path that becomes meaningful once the
// agent runs through Phase 3.5's volume-aware Spawn.
func (s *Service) ResizeVolume(
	ctx context.Context, instanceID, orgID uuid.UUID, newSizeGB int,
) (*UpdateResult, error) {
	if newSizeGB < deploy.MinVolumeSize || newSizeGB > deploy.MaxVolumeSize {
		return nil, fmt.Errorf("%w: volume_size_gb %d out of range [%d,%d]",
			deploy.ErrInvalidVolumeSize, newSizeGB, deploy.MinVolumeSize, deploy.MaxVolumeSize)
	}
	row, err := s.queries.GetAgentInstanceByID(ctx, db.GetAgentInstanceByIDParams{ID: instanceID, OrgID: orgID})
	if err != nil {
		if errors.Is(err, pgx.ErrNoRows) {
			return nil, ErrInstanceNotFound
		}
		return nil, err
	}
	if newSizeGB < int(row.VolumeSizeGb) {
		return nil, fmt.Errorf("%w: %d → %d", deploy.ErrVolumeShrink, row.VolumeSizeGb, newSizeGB)
	}
	if row.DeployExternalRef == nil || *row.DeployExternalRef == "" {
		return nil, ErrInstanceNotFound
	}

	volumes, err := s.queries.ListAgentVolumesByInstance(ctx, instanceID)
	if err != nil {
		return nil, fmt.Errorf("agents: list volumes: %w", err)
	}

	target, err := s.flyTarget(ctx)
	if err != nil {
		return nil, err
	}

	anyRestart := false
	for _, v := range volumes {
		needsRestart, err := target.ExtendVolume(ctx, *row.DeployExternalRef, v.FlyVolumeID, newSizeGB)
		if err != nil {
			if errors.Is(err, deploy.ErrVolumeShrink) {
				return nil, err
			}
			slog.Error("agents: extend volume", "instance_id", instanceID, "volume_id", v.FlyVolumeID, "err", err)
			return nil, ErrFlyAPI
		}
		if needsRestart {
			anyRestart = true
		}
	}

	if err := s.txr.WithResizeVolumeTx(ctx, func(tx ResizeVolumeTx) error {
		if err := tx.UpdateAgentInstanceVolumeSize(ctx, db.UpdateAgentInstanceVolumeSizeParams{
			ID: instanceID, OrgID: orgID, VolumeSizeGb: int32(newSizeGB),
		}); err != nil {
			return err
		}
		for _, v := range volumes {
			if err := tx.UpdateAgentVolumeSize(ctx, db.UpdateAgentVolumeSizeParams{
				FlyVolumeID: v.FlyVolumeID, SizeGb: int32(newSizeGB),
			}); err != nil {
				return err
			}
		}
		return nil
	}); err != nil {
		return nil, fmt.Errorf("agents: persist volume size: %w", err)
	}

	kind := deploy.UpdateLiveApplied
	if anyRestart {
		kind = deploy.UpdateLiveAppliedWithRestart
		go s.pollHealth(instanceID, target, *row.DeployExternalRef, row.ChatEnabled)
	}
	return &UpdateResult{Kind: kind, EstimatedDowntime: estimatedDowntime(kind)}, nil
}

// BulkUpdateDeployConfig fans out a uniform config delta across N
// instances. Plan §4 Phase 4 + decision 28: capped at maxBulkCount =
// 50, errgroup + semaphore at bulkConcurrency. Per-instance results
// surface in BulkResult — partial failure is normal.
//
// Today's apply path: per-instance deployer.Update + per-instance
// UpdateAgentDeployConfig. The plan's BulkUpdateAgentDeployConfig
// SQL exists for the column-level fan-out (decision 28's faster
// "one statement, N rows" path) but Phase 4 uses per-instance writes
// because each instance also needs its own Fly-side Update call —
// the bulk SQL only saves on the DB-write step, which isn't the
// bottleneck. The bulk SQL stays available for v1.5+ surfaces
// (lifecycle-only flips that don't touch Fly).
func (s *Service) BulkUpdateDeployConfig(
	ctx context.Context,
	instanceIDs []uuid.UUID,
	orgID uuid.UUID,
	delta BulkConfigDelta,
	dryRun bool,
) ([]BulkResult, error) {
	if len(instanceIDs) == 0 {
		return nil, ErrBulkLimit
	}
	if len(instanceIDs) > maxBulkCount {
		return nil, ErrBulkLimit
	}

	target, err := s.flyTarget(ctx)
	if err != nil {
		return nil, err
	}

	results := make([]BulkResult, len(instanceIDs))
	sem := semaphore.NewWeighted(int64(bulkConcurrency))
	g, gctx := errgroup.WithContext(ctx)
	for i, id := range instanceIDs {
		i, id := i, id
		g.Go(func() error {
			if err := sem.Acquire(gctx, 1); err != nil {
				return err
			}
			defer sem.Release(1)
			results[i] = s.applyBulkOne(gctx, id, orgID, delta, dryRun, target)
			// Errors are recorded per-row; the group keeps running.
			return nil
		})
	}
	if err := g.Wait(); err != nil {
		return results, err
	}
	return results, nil
}

func (s *Service) applyBulkOne(
	ctx context.Context,
	instanceID, orgID uuid.UUID,
	delta BulkConfigDelta,
	dryRun bool,
	target deploy.DeployTarget,
) BulkResult {
	out := BulkResult{InstanceID: instanceID}
	row, err := s.queries.GetAgentInstanceByID(ctx, db.GetAgentInstanceByIDParams{ID: instanceID, OrgID: orgID})
	if err != nil {
		if errors.Is(err, pgx.ErrNoRows) {
			out.Err = ErrInstanceNotFound
			return out
		}
		out.Err = err
		return out
	}
	if row.DeployExternalRef == nil || *row.DeployExternalRef == "" {
		out.Err = ErrInstanceNotFound
		return out
	}
	cfg := delta.AsDeployConfig(int(row.VolumeSizeGb))
	if err := cfg.Validate(); err != nil {
		out.Err = err
		return out
	}
	ref := *row.DeployExternalRef
	if dryRun {
		kind, err := target.PreviewUpdate(ctx, ref, cfg)
		if err != nil {
			out.Err = err
			return out
		}
		out.Kind = kind
		return out
	}
	kind, err := target.Update(ctx, ref, cfg)
	if err != nil {
		out.Err = ErrFlyAPI
		slog.Error("agents: bulk update one", "instance_id", instanceID, "err", err)
		return out
	}
	if err := s.queries.UpdateAgentDeployConfig(ctx, deployConfigParams(instanceID, orgID, cfg)); err != nil {
		out.Err = fmt.Errorf("agents: persist deploy config: %w", err)
		return out
	}
	go s.pollHealth(instanceID, target, ref, row.ChatEnabled)
	out.Kind = kind
	return out
}

// DetectDrift compares the DB's desired state against Fly's actual
// state and returns the categorised drift. Plan §4 Phase 4 + Phase
// 7's per-row banner. Five categories:
//   - count_mismatch: machine count != desired_replicas
//   - size_mismatch: any machine's CPUs/MemoryMB differ from cfg
//   - volume_mismatch: agent_volumes count != desired_replicas
//   - volume_size_mismatch: any volume's size_gb differs from cfg
//   - volume_unattached: any agent_volumes row has fly_machine_id
//     NULL despite a running machine being available
//
// Empty-volumes case (M4-era agents) skips the volume_* categories —
// drift on volumes that don't exist yet is forward-compat noise, not
// a real signal.
func (s *Service) DetectDrift(ctx context.Context, instanceID, orgID uuid.UUID) (*DriftReport, error) {
	row, err := s.queries.GetAgentInstanceByID(ctx, db.GetAgentInstanceByIDParams{ID: instanceID, OrgID: orgID})
	if err != nil {
		if errors.Is(err, pgx.ErrNoRows) {
			return nil, ErrInstanceNotFound
		}
		return nil, err
	}
	report := &DriftReport{InstanceID: instanceID}
	if row.DeployExternalRef == nil || *row.DeployExternalRef == "" {
		// Pending row with no Fly app → not yet meaningful.
		return report, nil
	}

	target, err := s.flyTarget(ctx)
	if err != nil {
		return nil, err
	}

	machines, err := target.ListMachines(ctx, *row.DeployExternalRef)
	if err != nil {
		return nil, ErrFlyAPI
	}

	if len(machines) != int(row.DesiredReplicas) {
		report.Categories = append(report.Categories, DriftCountMismatch)
		report.Details = append(report.Details,
			fmt.Sprintf("machines: %d / desired_replicas: %d", len(machines), row.DesiredReplicas))
	}
	sizeFlagged := false
	for _, m := range machines {
		if m.CPUs != int(row.Cpus) || m.MemoryMB != int(row.MemoryMb) {
			if !sizeFlagged {
				report.Categories = append(report.Categories, DriftSizeMismatch)
				sizeFlagged = true
			}
			report.Details = append(report.Details,
				fmt.Sprintf("machine %s size: %dx%dMB / desired: %dx%dMB",
					m.ID, m.CPUs, m.MemoryMB, row.Cpus, row.MemoryMb))
		}
	}

	volumes, err := s.queries.ListAgentVolumesByInstance(ctx, instanceID)
	if err != nil {
		return nil, fmt.Errorf("agents: list volumes for drift: %w", err)
	}
	if len(volumes) > 0 {
		if len(volumes) != int(row.DesiredReplicas) {
			report.Categories = append(report.Categories, DriftVolumeMismatch)
			report.Details = append(report.Details,
				fmt.Sprintf("volumes: %d / desired_replicas: %d", len(volumes), row.DesiredReplicas))
		}
		volumeSizeFlagged := false
		for _, v := range volumes {
			if v.SizeGb != row.VolumeSizeGb {
				if !volumeSizeFlagged {
					report.Categories = append(report.Categories, DriftVolumeSizeMismatch)
					volumeSizeFlagged = true
				}
				report.Details = append(report.Details,
					fmt.Sprintf("volume %s size: %dGB / desired: %dGB", v.FlyVolumeID, v.SizeGb, row.VolumeSizeGb))
			}
		}
		unattachedFlagged := false
		for _, v := range volumes {
			if v.FlyMachineID == nil || *v.FlyMachineID == "" {
				if !unattachedFlagged {
					report.Categories = append(report.Categories, DriftVolumeUnattached)
					unattachedFlagged = true
				}
				report.Details = append(report.Details,
					fmt.Sprintf("volume %s not attached to a machine", v.FlyVolumeID))
			}
		}
	}
	return report, nil
}

