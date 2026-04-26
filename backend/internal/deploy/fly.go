package deploy

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"log/slog"
	"net/http"
	"sort"
	"strings"
	"sync"
	"time"

	"github.com/google/uuid"
	fly "github.com/superfly/fly-go"
	"github.com/superfly/fly-go/flaps"
	"github.com/superfly/fly-go/tokens"
)

const (
	flyKind        = "fly"
	externalRefPfx = "fly-app:"
	cleanupTimeout = 30 * time.Second

	// leaseTTLSeconds is the default lease window for compute-mutating
	// flaps calls. Plan §4 Phase 3 specifies 30s — long enough to
	// cover Acquire → Get → Update → ReleaseLease in one round trip
	// without holding the lease past the operation's actual duration.
	leaseTTLSeconds = 30

	// waitTimeout caps how long Update / Start wait for a machine to
	// reach the target state via flaps.Wait. Plan §7 Q2 (resolved):
	// 60s. Less than M4's 90s pollHealth because Update is a Fly state
	// flip (no harness port-bind); typical state transitions <10s,
	// short enough that the FE's submitting spinner doesn't overstay.
	waitTimeout = 60 * time.Second

	// regionRefreshInterval is the cadence at which the background
	// goroutine refreshes the cached non-deprecated region list.
	// Plan §4 Phase 3 + decision 9: 1 hour. Region churn is operator-
	// scale, not request-scale.
	regionRefreshInterval = 1 * time.Hour

	// redactFlyErrorMaxLen caps the length of upstream Fly error
	// strings that surface in operator-facing messages (e.g.,
	// PlacementResult.Reason). Anything longer is replaced with a
	// generic redaction.
	redactFlyErrorMaxLen = 200

	// chatSidecarInternalPort is the canonical Hermes harness port
	// from blueprint §3.1 — the FastAPI sidecar binds 0.0.0.0:8642
	// inside the container per the adapter's entrypoint.sh (M-chat
	// Phase 2). The matching CORELLIA_SIDECAR_PORT entrypoint env var
	// exists as a dev-only override; production always uses 8642.
	chatSidecarInternalPort = 8642

	// chatSidecarExternalPort is :443 — TLS-terminated by Fly's edge.
	// M-chat plan decision 4 + 12: callers reach the agent at
	// https://corellia-agent-<uuid>.fly.dev/, no custom DNS.
	chatSidecarExternalPort = 443
)

// flapsClient is the subset of *flaps.Client that FlyDeployTarget
// uses. Defining it as an interface here lets the table-driven tests
// in fly_test.go inject a fake without spinning up the real Fly API.
// Per plan §4 Phase 3: "small interface that flaps.Client satisfies;
// fake implements it."
//
// Adding a new flaps method? Append it here, then implement on the
// fake. The interface is the single grep target for "what does
// FlyDeployTarget reach for in fly-go?"
type flapsClient interface {
	CreateApp(ctx context.Context, in flaps.CreateAppRequest) (*flaps.App, error)
	DeleteApp(ctx context.Context, name string) error
	SetAppSecret(ctx context.Context, app, name, value string) (*fly.SetAppSecretResp, error)
	GetAppSecrets(ctx context.Context, app, name string, version *uint64, showSecrets bool) (*fly.AppSecret, error)

	Launch(ctx context.Context, app string, in fly.LaunchMachineInput) (*fly.Machine, error)
	List(ctx context.Context, app, state string) ([]*fly.Machine, error)
	Get(ctx context.Context, app, machineID string) (*fly.Machine, error)
	Update(ctx context.Context, app string, in fly.LaunchMachineInput, nonce string) (*fly.Machine, error)
	Stop(ctx context.Context, app string, in fly.StopMachineInput, nonce string) error
	Start(ctx context.Context, app, machineID, nonce string) (*fly.MachineStartResponse, error)
	Restart(ctx context.Context, app string, in fly.RestartMachineInput, nonce string) error
	Destroy(ctx context.Context, app string, in fly.RemoveMachineInput, nonce string) error
	Wait(ctx context.Context, app, machineID string, opts ...flaps.WaitOption) error

	AcquireLease(ctx context.Context, app, machineID string, ttl *int) (*fly.MachineLease, error)
	ReleaseLease(ctx context.Context, app, machineID, nonce string) error

	GetRegions(ctx context.Context) (*flaps.RegionData, error)
	GetPlacements(ctx context.Context, req *flaps.GetPlacementsRequest) ([]flaps.RegionPlacement, error)
}

// FlyCredentials carries the per-account inputs NewFlyDeployTarget
// needs to construct a flaps client. Today the two fields exactly
// mirror what the previous positional constructor took; the struct
// exists so v1.5's per-org credential rows (DefaultRegion, scoped
// API tokens, etc.) can land additively without rippling through
// every caller's signature. Per the deploy-target-resolver plan §2
// decision 4: no fields beyond what current callers need.
//
// TODO(v1.5): split this. v1.5's resolver loads per-target credentials
// from the secret store via deploy_targets.credentials_storage_ref;
// the boot-time FLY_SPAWN_TOKEN / FLY_ORG_SLUG env path becomes the
// operator-only fallback for the platform's own service-account
// (Corellia's own dogfood deploys). User-supplied targets get an
// org-scoped Fly macaroon via OAuth — never a PAT pasted into a form.
// See docs/executing/deploy-target-credentials.md.
type FlyCredentials struct {
	APIToken string
	OrgSlug  string
}

// regionCache holds the most-recently-fetched non-deprecated regions
// the configured Fly token can deploy to. Plan decision 9 + Phase 3:
// boot fetches synchronously (fail-fast on infra misconfig); a
// background goroutine refreshes every regionRefreshInterval. ListRegions
// returns whatever's in the cache without ever blocking on Fly.
type regionCache struct {
	mu        sync.RWMutex
	regions   []Region
	lastFetch time.Time
}

func (rc *regionCache) snapshot() []Region {
	rc.mu.RLock()
	defer rc.mu.RUnlock()
	out := make([]Region, len(rc.regions))
	copy(out, rc.regions)
	return out
}

func (rc *regionCache) store(regions []Region) {
	rc.mu.Lock()
	defer rc.mu.Unlock()
	rc.regions = regions
	rc.lastFetch = time.Now()
}

// FlyDeployTarget is the only place in the codebase that imports
// `fly-go` or talks to the Fly.io API. Per blueprint §11.1, every
// other package sees only the DeployTarget interface.
type FlyDeployTarget struct {
	flaps      flapsClient
	orgSlug    string
	regions    *regionCache
	healthHTTP HealthHTTPClient // HTTP probe client for chat-enabled /health checks
}

// NewFlyDeployTarget constructs a Fly-backed deploy target. The
// flaps client is global across apps; per-app routing happens at
// each method call via the appName argument.
//
// M5 Phase 3: also seeds the region cache with one synchronous
// flaps.GetRegions call and starts an hourly refresh goroutine.
// Returns an error on the boot fetch failure rather than panicking
// (matches the existing constructor's error contract — main.go is
// the fail-fast point) — divergence from plan literal "panic"
// flagged in completion notes; the operational outcome ("boot
// stops on misconfigured Fly token") is identical.
func NewFlyDeployTarget(ctx context.Context, creds FlyCredentials) (*FlyDeployTarget, error) {
	fc, err := flaps.NewWithOptions(ctx, flaps.NewClientOpts{
		Tokens:    tokens.Parse(creds.APIToken),
		UserAgent: "corellia",
	})
	if err != nil {
		return nil, fmt.Errorf("fly: flaps client: %w", err)
	}
	t := &FlyDeployTarget{
		flaps:      fc,
		orgSlug:    creds.OrgSlug,
		regions:    &regionCache{},
		healthHTTP: &http.Client{Timeout: 10 * time.Second},
	}
	if err := t.refreshRegions(ctx); err != nil {
		return nil, fmt.Errorf("fly: initial region fetch: %w", err)
	}
	// The refresh loop runs for the process lifetime, not the
	// caller-of-NewFlyDeployTarget's request lifetime. Using ctx
	// here would have the goroutine exit the moment the boot ctx
	// cancels — common in graceful-shutdown / test-cleanup paths.
	// context.Background() lets the loop survive until the process
	// exits, which is the documented contract.
	go t.regionRefreshLoop(context.Background())
	return t, nil
}

func (f *FlyDeployTarget) Kind() string { return flyKind }

// refreshRegions fetches the live region list and stores the
// non-deprecated entries in the cache. Plan decision 9: deprecated
// regions are filtered server-side from the FE pickers; the BE does
// the filtering once at fetch time so every consumer sees the same
// non-deprecated set.
func (f *FlyDeployTarget) refreshRegions(ctx context.Context) error {
	data, err := f.flaps.GetRegions(ctx)
	if err != nil {
		return err
	}
	if data == nil {
		return errors.New("fly: GetRegions returned nil")
	}
	out := make([]Region, 0, len(data.Regions))
	for _, r := range data.Regions {
		if r.Deprecated {
			continue
		}
		out = append(out, Region{
			Code:             r.Code,
			Name:             r.Name,
			Deprecated:       r.Deprecated,
			RequiresPaidPlan: r.RequiresPaidPlan,
		})
	}
	sort.Slice(out, func(i, j int) bool { return out[i].Code < out[j].Code })
	f.regions.store(out)
	return nil
}

// regionRefreshLoop is the background ticker that keeps the region
// cache fresh. Boot already paid for one synchronous fetch (in
// NewFlyDeployTarget); this goroutine lives for the process lifetime
// and refreshes hourly. Failures log at slog.Warn and the cache
// keeps the prior snapshot — rationale: a transient Fly outage
// shouldn't blank the picker.
func (f *FlyDeployTarget) regionRefreshLoop(ctx context.Context) {
	ticker := time.NewTicker(regionRefreshInterval)
	defer ticker.Stop()
	for {
		select {
		case <-ctx.Done():
			return
		case <-ticker.C:
			refreshCtx, cancel := context.WithTimeout(context.Background(), cleanupTimeout)
			if err := f.refreshRegions(refreshCtx); err != nil {
				slog.Warn("fly: region refresh failed; retaining prior cache", "err", err)
			}
			cancel()
		}
	}
}

// Spawn — Phase 3 form. Loops cfg.DesiredReplicas times calling
// flaps.Launch, returning every machine ID via SpawnResult.MachineIDs.
// Volumes are still NOT mounted at this checkpoint; Phase 3.5 closes
// the $HERMES_HOME-survives-restart gap.
//
// Region precedence: spec.Region (M4 caller path) wins if set; else
// cfg.Region. Same fall-through for cpus/memory. Once Phase 4 wires
// real wire-side values into cfg, the spec.* preference path becomes
// dead and gets dropped.
//
// The deferred cleanup chain orphans nothing on failure: any state
// created before the error (app, secrets, machines) gets removed by
// the single DeleteApp call (Fly cascades app → machines → secrets).
func (f *FlyDeployTarget) Spawn(ctx context.Context, spec SpawnSpec, cfg DeployConfig) (_ SpawnResult, err error) {
	cfg = cfg.WithDefaults()
	if err = validateImageRef(spec.ImageRef); err != nil {
		return SpawnResult{}, err
	}
	app := appNameFor(spec.Name)
	region := spec.Region
	if region == "" {
		region = cfg.Region
	}
	cpus := spec.CPUs
	if cpus == 0 {
		cpus = cfg.CPUs
	}
	mem := spec.MemoryMB
	if mem == 0 {
		mem = cfg.MemoryMB
	}

	if _, err = f.flaps.CreateApp(ctx, flaps.CreateAppRequest{
		Name: app,
		Org:  f.orgSlug,
	}); err != nil {
		return SpawnResult{}, fmt.Errorf("fly: create app %q: %w", app, err)
	}

	// Once the Fly app exists, every subsequent error path must clean it up
	// or we orphan a paid resource. Disarmed by the success-path return below.
	// Uses a fresh context with bounded timeout: the caller's ctx may be the
	// reason we're aborting (cancellation, deadline), and a hung cleanup
	// would leak the app indefinitely. DeleteApp cascades to all machines
	// + secrets so a partial replica loop doesn't need per-machine cleanup.
	defer func() {
		if err == nil {
			return
		}
		cleanupCtx, cancel := context.WithTimeout(context.Background(), cleanupTimeout)
		defer cancel()
		if delErr := f.flaps.DeleteApp(cleanupCtx, app); delErr != nil {
			slog.Warn("fly: spawn rollback failed; app may be orphaned",
				"app", app, "spawn_err", err, "cleanup_err", delErr)
		}
	}()

	for k, v := range spec.Env {
		if _, err = f.flaps.SetAppSecret(ctx, app, k, v); err != nil {
			return SpawnResult{}, fmt.Errorf("fly: set secret %q on %q: %w", k, app, err)
		}
	}

	machineIDs := make([]string, 0, cfg.DesiredReplicas)
	for i := 0; i < cfg.DesiredReplicas; i++ {
		var m *fly.Machine
		m, err = f.flaps.Launch(ctx, app, fly.LaunchMachineInput{
			Region: region,
			Config: machineConfigFor(spec.ImageRef, cpus, mem, cfg),
		})
		if err != nil {
			return SpawnResult{}, fmt.Errorf("fly: launch replica %d/%d in %q: %w", i+1, cfg.DesiredReplicas, app, err)
		}
		machineIDs = append(machineIDs, m.ID)
	}

	return SpawnResult{
		ExternalRef: externalRefPfx + app,
		MachineID:   machineIDs[0],
		MachineIDs:  machineIDs,
	}, nil
}

// Update applies a config delta against an already-spawned agent.
// Plan §4 Phase 3 + decision 6:
//
//  1. Region change → return UpdateRequiresRespawn without touching
//     Fly. The orchestrator (agents.Service.UpdateDeployConfig in
//     Phase 4) handles the destroy + respawn with state-loss
//     confirmation. Volumes are region-pinned (decision 8 + plan
//     §4 Phase 3.5), so a region change wipes persistent state — the
//     RequiresRespawn return is what triggers the destructive UX.
//  2. Per-machine compute mutate (size / restart policy) under a
//     lease so concurrent edits don't race. Each machine's lease is
//     held only for the duration of its own Acquire → Get → Update →
//     Release cycle.
//  3. Replica count delta: scale up via flaps.Launch loop, scale
//     down via flaps.Destroy on the LIFO tail. Each Destroy acquires
//     its own lease. Volume cleanup for scale-down lands in Phase 3.5;
//     today scale-down leaks any future volume rows (no volumes yet
//     either, so the leak window is empty until 3.5 ships).
//  4. Returns UpdateLiveApplied on success. UpdateLiveAppliedWithRestart
//     is reserved for Phase 3.5's volume-extend path.
func (f *FlyDeployTarget) Update(ctx context.Context, externalRef string, cfg DeployConfig) (UpdateKind, error) {
	cfg = cfg.WithDefaults()
	app, err := parseExternalRef(externalRef)
	if err != nil {
		return "", err
	}

	machines, err := f.flaps.List(ctx, app, "")
	if err != nil {
		return "", fmt.Errorf("fly: list machines for %q: %w", app, err)
	}
	for _, m := range machines {
		if m.Region != "" && m.Region != cfg.Region {
			return UpdateRequiresRespawn, nil
		}
	}

	for _, m := range machines {
		if err := f.updateOneMachineConfig(ctx, app, m, cfg); err != nil {
			return "", err
		}
	}

	current := len(machines)
	switch {
	case cfg.DesiredReplicas > current:
		// Scale up: launch the diff. Each Launch is independent —
		// failure mid-loop returns immediately and leaves the prior
		// new replicas in place. The caller's reconcile loop catches
		// up on the next Update call. (No partial rollback: rolling
		// back would also need to identify *which* machines were
		// pre-existing vs new, which is fragile.)
		spawned, err := f.firstMachineForLaunch(ctx, app, machines)
		if err != nil {
			return "", err
		}
		for i := 0; i < cfg.DesiredReplicas-current; i++ {
			if _, err := f.flaps.Launch(ctx, app, spawned); err != nil {
				return "", fmt.Errorf("fly: scale up replica in %q: %w", app, err)
			}
		}
	case cfg.DesiredReplicas < current:
		// Scale down LIFO: order by created_at descending and destroy
		// the diff from the tail. Plan §6 risk 2: "scale down deletes
		// the wrong machine" — failed-first ordering is a Phase 3 TODO
		// once we have per-machine state inspection in tests; today's
		// LIFO captures the canonical case.
		victims := lifoTail(machines, current-cfg.DesiredReplicas)
		for _, m := range victims {
			if err := f.destroyMachine(ctx, app, m.ID); err != nil {
				return "", err
			}
		}
	}
	return UpdateLiveApplied, nil
}

// PreviewUpdate is the read-only dry-run companion to Update. Same
// region-delta gate as Update step 1, but without touching any
// machine state. Phase 3.5 will widen this to also surface
// LiveAppliedWithRestart for volume-extend cases; today's body is
// strictly compute-side.
func (f *FlyDeployTarget) PreviewUpdate(ctx context.Context, externalRef string, cfg DeployConfig) (UpdateKind, error) {
	cfg = cfg.WithDefaults()
	app, err := parseExternalRef(externalRef)
	if err != nil {
		return "", err
	}
	machines, err := f.flaps.List(ctx, app, "")
	if err != nil {
		return "", fmt.Errorf("fly: list machines for %q: %w", app, err)
	}
	for _, m := range machines {
		if m.Region != "" && m.Region != cfg.Region {
			return UpdateRequiresRespawn, nil
		}
	}
	return UpdateLiveApplied, nil
}

// updateOneMachineConfig runs the lease-protected compute-side
// update for a single machine. Lease nonces are per-machine and
// short-lived; the defer-release path uses a fresh context so a
// caller cancellation doesn't strand the lease on Fly's side past
// its TTL.
func (f *FlyDeployTarget) updateOneMachineConfig(ctx context.Context, app string, m *fly.Machine, cfg DeployConfig) error {
	nonce, release, err := f.acquireLease(ctx, app, m.ID)
	if err != nil {
		return err
	}
	defer release()

	current, err := f.flaps.Get(ctx, app, m.ID)
	if err != nil {
		return fmt.Errorf("fly: get machine %q: %w", m.ID, err)
	}
	cfgPtr := mergeMachineConfig(current.Config, cfg)
	if _, err := f.flaps.Update(ctx, app, fly.LaunchMachineInput{
		ID:     m.ID,
		Region: m.Region,
		Config: cfgPtr,
	}, nonce); err != nil {
		return fmt.Errorf("fly: update machine %q: %w", m.ID, err)
	}
	if err := f.flaps.Wait(ctx, app, m.ID,
		flaps.WithWaitStates("started", "stopped"),
		flaps.WithWaitTimeout(waitTimeout),
	); err != nil {
		return fmt.Errorf("fly: wait machine %q: %w", m.ID, err)
	}
	return nil
}

// destroyMachine runs the lease-protected destroy for one machine.
// Leases on the to-be-destroyed machine are short — Acquire → Destroy
// → Release — so concurrent edits on sibling machines don't block.
// Plan §4 Phase 3.5 closes the volume-cleanup gap that this method
// currently opens.
func (f *FlyDeployTarget) destroyMachine(ctx context.Context, app, machineID string) error {
	nonce, release, err := f.acquireLease(ctx, app, machineID)
	if err != nil {
		return err
	}
	defer release()
	if err := f.flaps.Destroy(ctx, app, fly.RemoveMachineInput{ID: machineID, Kill: true}, nonce); err != nil {
		return fmt.Errorf("fly: destroy machine %q: %w", machineID, err)
	}
	return nil
}

// acquireLease wraps flaps.AcquireLease and returns a release closure
// that uses a fresh context so caller cancellation can't strand a
// nonce past its TTL on Fly's side. Lease contention surfaces as
// ErrMachineBusy at the caller, mapped to Connect's Aborted code in
// Phase 5.
func (f *FlyDeployTarget) acquireLease(ctx context.Context, app, machineID string) (string, func(), error) {
	ttl := leaseTTLSeconds
	lease, err := f.flaps.AcquireLease(ctx, app, machineID, &ttl)
	if err != nil {
		return "", nil, fmt.Errorf("%w: %v", ErrMachineBusy, err)
	}
	nonce := ""
	if lease != nil && lease.Data != nil {
		nonce = lease.Data.Nonce
	}
	if lease != nil && nonce == "" {
		// Defensive: AcquireLease succeeded but the nonce is empty.
		// This shouldn't happen against a well-behaved Fly API, but
		// silently swallowing it would mask a provider-side bug —
		// log it so operators get a signal if Fly's response shape
		// changes. The caller proceeds nonce-less; downstream calls
		// that require a nonce will error normally.
		slog.Warn("fly: lease handshake incomplete (nil nonce)", "machine", machineID)
	}
	release := func() {
		if nonce == "" {
			return
		}
		relCtx, cancel := context.WithTimeout(context.Background(), cleanupTimeout)
		defer cancel()
		if err := f.flaps.ReleaseLease(relCtx, app, machineID, nonce); err != nil {
			slog.Warn("fly: release lease failed", "machine", machineID, "err", err)
		}
	}
	return nonce, release, nil
}

func (f *FlyDeployTarget) Stop(ctx context.Context, externalRef string) error {
	app, err := parseExternalRef(externalRef)
	if err != nil {
		return err
	}
	machines, err := f.flaps.List(ctx, app, "")
	if err != nil {
		return fmt.Errorf("fly: list machines for %q: %w", app, err)
	}
	for _, m := range machines {
		if err := f.stopOne(ctx, app, m.ID); err != nil {
			return err
		}
	}
	return nil
}

func (f *FlyDeployTarget) stopOne(ctx context.Context, app, machineID string) error {
	nonce, release, err := f.acquireLease(ctx, app, machineID)
	if err != nil {
		return err
	}
	defer release()
	if err := f.flaps.Stop(ctx, app, fly.StopMachineInput{ID: machineID}, nonce); err != nil {
		return fmt.Errorf("fly: stop machine %q: %w", machineID, err)
	}
	return nil
}

// Start brings every stopped machine in the app back to "started".
// M5 Phase 3: paired with the per-row Start button on the fleet page
// when an agent's lifecycle_mode is "manual". Already-running
// machines are skipped (Fly's Start API is not idempotent — calling
// it on a started machine returns an error).
func (f *FlyDeployTarget) Start(ctx context.Context, externalRef string) error {
	app, err := parseExternalRef(externalRef)
	if err != nil {
		return err
	}
	machines, err := f.flaps.List(ctx, app, "")
	if err != nil {
		return fmt.Errorf("fly: list machines for %q: %w", app, err)
	}
	for _, m := range machines {
		if m.State != "stopped" {
			continue
		}
		if err := f.startOne(ctx, app, m.ID); err != nil {
			return err
		}
	}
	return nil
}

func (f *FlyDeployTarget) startOne(ctx context.Context, app, machineID string) error {
	nonce, release, err := f.acquireLease(ctx, app, machineID)
	if err != nil {
		return err
	}
	defer release()
	if _, err := f.flaps.Start(ctx, app, machineID, nonce); err != nil {
		return fmt.Errorf("fly: start machine %q: %w", machineID, err)
	}
	if err := f.flaps.Wait(ctx, app, machineID,
		flaps.WithWaitStates("started"),
		flaps.WithWaitTimeout(waitTimeout),
	); err != nil {
		return fmt.Errorf("fly: wait machine %q: %w", machineID, err)
	}
	return nil
}

// Restart cycles every started machine in the app. v1.5 Pillar B Phase 7 —
// drives the fleet inspector's "Restart now" button so operators can apply
// restart-required tool-grant changes (the new platform_toolsets list in
// $HERMES_HOME/config.yaml only re-reads at boot) without editing Fly
// directly. Stopped machines are skipped — Fly's restart endpoint returns
// an error against a non-running machine, and the operator should Start
// them via the existing fleet row's Start button if needed.
//
// One nonce per machine, mirroring Start: lease + restart + release. Wait
// is bounded by waitTimeout (60s, matching Start's wait) — typical Fly
// restarts complete well inside that envelope.
func (f *FlyDeployTarget) Restart(ctx context.Context, externalRef string) error {
	app, err := parseExternalRef(externalRef)
	if err != nil {
		return err
	}
	machines, err := f.flaps.List(ctx, app, "")
	if err != nil {
		return fmt.Errorf("fly: list machines for %q: %w", app, err)
	}
	for _, m := range machines {
		if m.State != "started" {
			continue
		}
		if err := f.restartOne(ctx, app, m.ID); err != nil {
			return err
		}
	}
	return nil
}

func (f *FlyDeployTarget) restartOne(ctx context.Context, app, machineID string) error {
	nonce, release, err := f.acquireLease(ctx, app, machineID)
	if err != nil {
		return err
	}
	defer release()
	if err := f.flaps.Restart(ctx, app, fly.RestartMachineInput{ID: machineID}, nonce); err != nil {
		return fmt.Errorf("fly: restart machine %q: %w", machineID, err)
	}
	if err := f.flaps.Wait(ctx, app, machineID,
		flaps.WithWaitStates("started"),
		flaps.WithWaitTimeout(waitTimeout),
	); err != nil {
		return fmt.Errorf("fly: wait machine %q after restart: %w", machineID, err)
	}
	return nil
}

// Destroy deletes the Fly app backing this AgentInstance. Idempotent
// against externally-deleted apps: a `flaps.ErrFlapsNotFound` is
// treated as success so concurrent destroys (operator UI + boot-time
// reaper, two operators, etc.) never deadlock the respawn path on a
// "can't find app to delete" error. The agent_instances row is the
// authoritative liveness signal; the Fly app is bookkeeping.
func (f *FlyDeployTarget) Destroy(ctx context.Context, externalRef string) error {
	app, err := parseExternalRef(externalRef)
	if err != nil {
		return err
	}
	if err := f.flaps.DeleteApp(ctx, app); err != nil {
		if errors.Is(err, flaps.ErrFlapsNotFound) {
			slog.Warn("fly: destroy on already-deleted app (idempotent success)", "app", app)
			return nil
		}
		return fmt.Errorf("fly: delete app %q: %w", app, err)
	}
	return nil
}

// GetAppSecret reads the plaintext value of a Fly app-level secret via
// flaps.GetAppSecrets with showSecrets=true. M-chat Phase 4: the BE
// reads CORELLIA_SIDECAR_AUTH_TOKEN here on every proxied chat call so
// the token never lives in Corellia's own database (rule §11). The
// flaps endpoint is `GET /apps/<app>/secrets/<name>?show_secrets=true`,
// which returns the AppSecret with a populated Value field.
//
// Caller is responsible for redacting the returned token from any log
// or error surface — this method's only redaction is wrapping the
// upstream error in fmt.Errorf for context (the underlying flaps call
// already keeps the value out of the error path).
func (f *FlyDeployTarget) GetAppSecret(ctx context.Context, externalRef, key string) (string, error) {
	app, err := parseExternalRef(externalRef)
	if err != nil {
		return "", err
	}
	sec, err := f.flaps.GetAppSecrets(ctx, app, key, nil, true)
	if err != nil {
		return "", fmt.Errorf("fly: get app secret %q on %q: %w", key, app, err)
	}
	if sec == nil || sec.Value == nil {
		// Secret name registered but value not returned — Fly's API
		// honours showSecrets only on tokens with the right scope; an
		// empty Value here typically signals a token-scope shape we
		// can't proxy through, and the chat call cannot proceed.
		return "", nil
	}
	return *sec.Value, nil
}

// Health collapses N replica states into one HealthStatus.
//
// M-chat Phase 6: when chatEnabled is true, the sidecar exposes a real
// /health HTTP endpoint (blueprint §3.1). HTTP-probing it is strictly
// more informative than polling Fly machine state — it catches the case
// where the machine is "started" but hermes has crashed inside the
// container. Response semantics: {"ok": true} → HealthStarted; {"ok":
// false} → HealthStarting (hermes still booting); transport error →
// HealthUnknown (keep polling); non-200 → HealthFailed.
//
// When chatEnabled is false, the machine-state poll (existing path) is
// used — backward-compatible with every pre-M-chat agent.
func (f *FlyDeployTarget) Health(ctx context.Context, externalRef string, chatEnabled bool) (HealthStatus, error) {
	if chatEnabled {
		return f.httpHealthProbe(ctx, externalRef)
	}
	return f.machineStateHealth(ctx, externalRef)
}

// machineStateHealth is the pre-M-chat machine-state poll extracted
// from the original Health() body. Used when chat is disabled.
func (f *FlyDeployTarget) machineStateHealth(ctx context.Context, externalRef string) (HealthStatus, error) {
	app, err := parseExternalRef(externalRef)
	if err != nil {
		return HealthUnknown, err
	}
	machines, err := f.flaps.List(ctx, app, "")
	if err != nil {
		return HealthUnknown, fmt.Errorf("fly: list machines for %q: %w", app, err)
	}
	if len(machines) == 0 {
		return HealthStopped, nil
	}
	// M5 plan decision 1 retired the M4 "one app = one machine"
	// invariant; plan decision 14 defines aggregate semantics across
	// replicas. Phase 3 keeps the simple "any started → started" rule;
	// HealthDrifted is not yet returnable from this path.
	any := func(pred func(s string) bool) bool {
		for _, m := range machines {
			if pred(m.State) {
				return true
			}
		}
		return false
	}
	if any(func(s string) bool { return s == "started" }) {
		return HealthStarted, nil
	}
	if any(func(s string) bool { return s == "starting" || s == "created" }) {
		return HealthStarting, nil
	}
	if any(func(s string) bool { return s == "failed" }) {
		return HealthFailed, nil
	}
	return mapFlyState(machines[0].State), nil
}

// httpHealthProbe GET-probes the sidecar's unauthenticated /health
// endpoint. The sidecar exempts /health from bearer auth so Fly's edge
// health-check probes (which can't carry a secret) also work.
//
// Response semantics (Phase 1 sidecar contract):
//   - 200 + {"ok": true}  → HealthStarted   (sidecar + hermes both ready)
//   - 200 + {"ok": false} → HealthStarting  (sidecar ready, hermes booting)
//   - non-200             → HealthFailed
//   - transport error     → HealthUnknown   (machine may still be starting)
func (f *FlyDeployTarget) httpHealthProbe(ctx context.Context, externalRef string) (HealthStatus, error) {
	app, err := parseExternalRef(externalRef)
	if err != nil {
		return HealthUnknown, err
	}
	url := "https://" + app + ".fly.dev/health"
	req, err := http.NewRequestWithContext(ctx, http.MethodGet, url, nil)
	if err != nil {
		return HealthUnknown, fmt.Errorf("fly: health probe: build request: %w", err)
	}
	req.Header.Set("Accept", "application/json")

	resp, err := f.healthHTTP.Do(req)
	if err != nil {
		// TCP / TLS error — machine may still be starting; keep polling.
		slog.Debug("fly: health probe transport error", "app", app, "err", err)
		return HealthUnknown, nil
	}
	defer resp.Body.Close()

	if resp.StatusCode != http.StatusOK {
		slog.Warn("fly: health probe non-200", "app", app, "status", resp.StatusCode)
		return HealthFailed, nil
	}

	var body struct {
		Ok bool `json:"ok"`
	}
	if err := json.NewDecoder(io.LimitReader(resp.Body, 8192)).Decode(&body); err != nil {
		slog.Warn("fly: health probe unmarshal", "app", app, "err", err)
		return HealthFailed, nil
	}
	if body.Ok {
		return HealthStarted, nil
	}
	// ok:false — sidecar is up, hermes is still booting (plan risk 7).
	return HealthStarting, nil
}

// ListRegions returns the cached non-deprecated region list. Plan
// decision 9: ListRegions never blocks on Fly — the cache lives on
// FlyDeployTarget itself, refreshed hourly in the background. A
// caller invoked before the boot fetch completes would observe an
// empty slice; that path is impossible in practice because
// NewFlyDeployTarget returns only after the synchronous boot fetch
// succeeds.
func (f *FlyDeployTarget) ListRegions(_ context.Context) ([]Region, error) {
	return f.regions.snapshot(), nil
}

// CheckPlacement pre-flights a (size, region, replicas, org) tuple
// via flaps.GetPlacements. Plan decision 27: the FE calls this on
// the spawn wizard's Step 5 (Review) for green/red affordance, and
// the BE calls it before Spawn / Update — same code path, two
// callers. Volume-size hint is forwarded as VolumeSizeBytes so Fly
// considers volume capacity in placement.
func (f *FlyDeployTarget) CheckPlacement(ctx context.Context, cfg DeployConfig) (PlacementResult, error) {
	cfg = cfg.WithDefaults()
	guest := guestForConfig(cfg)
	req := &flaps.GetPlacementsRequest{
		ComputeRequirements: guest,
		Region:              cfg.Region,
		Count:               uint64(cfg.DesiredReplicas),
		VolumeSizeBytes:     uint64(cfg.VolumeSizeGB) * 1024 * 1024 * 1024,
		Org:                 f.orgSlug,
	}
	placements, err := f.flaps.GetPlacements(ctx, req)
	if err != nil {
		return PlacementResult{
			Available: false,
			Reason:    redactFlyError(err),
		}, fmt.Errorf("%w: %v", ErrPlacementUnavailable, err)
	}
	var matched int
	alternates := make([]string, 0, len(placements))
	for _, p := range placements {
		if p.Region == cfg.Region {
			matched = p.Count
			continue
		}
		if p.Count >= cfg.DesiredReplicas {
			alternates = append(alternates, p.Region)
		}
	}
	if matched < cfg.DesiredReplicas {
		return PlacementResult{
			Available:        false,
			Reason:           fmt.Sprintf("region %q has capacity for %d/%d replicas", cfg.Region, matched, cfg.DesiredReplicas),
			AlternateRegions: alternates,
		}, nil
	}
	return PlacementResult{Available: true, AlternateRegions: alternates}, nil
}

// ListMachines projects flaps.List into Corellia-shaped MachineState.
// Plan decision 2: no agent_machines materialised table; per-machine
// state is read from Fly on demand. AttachedVolumeID picks the first
// mount (one volume per machine in the M5 model — decision 8.4).
func (f *FlyDeployTarget) ListMachines(ctx context.Context, externalRef string) ([]MachineState, error) {
	app, err := parseExternalRef(externalRef)
	if err != nil {
		return nil, err
	}
	machines, err := f.flaps.List(ctx, app, "")
	if err != nil {
		return nil, fmt.Errorf("fly: list machines for %q: %w", app, err)
	}
	out := make([]MachineState, 0, len(machines))
	for _, m := range machines {
		out = append(out, projectMachine(m))
	}
	return out, nil
}

// Phase 3.5 — volume lifecycle methods. Stubbed today; real bodies
// arrive when EnsureVolume / ExtendVolume land alongside the
// volumeRecorder interface and `agent_volumes`-table-backed wiring.

func (f *FlyDeployTarget) EnsureVolume(_ context.Context, _ string, _ string, _ int) (VolumeRef, error) {
	return VolumeRef{}, ErrNotImplemented
}

func (f *FlyDeployTarget) ExtendVolume(_ context.Context, _ string, _ string, _ int) (bool, error) {
	return false, ErrNotImplemented
}

// machineConfigFor builds the MachineConfig for a fresh Spawn replica.
// Phase 3.5 will widen this to attach a volume mount; today's body
// matches the M4 launch shape, plus the M-chat Phase 3 services block
// when cfg.ChatEnabled is true.
func machineConfigFor(imageRef string, cpus, mem int, cfg DeployConfig) *fly.MachineConfig {
	mc := &fly.MachineConfig{
		Image: imageRef,
		Guest: &fly.MachineGuest{
			CPUKind:  cfg.CPUKind,
			CPUs:     cpus,
			MemoryMB: mem,
		},
		AutoDestroy: false,
		Restart: &fly.MachineRestart{
			Policy:     restartPolicyFromCfg(cfg.RestartPolicy),
			MaxRetries: cfg.RestartMaxRetries,
		},
	}
	if cfg.ChatEnabled {
		mc.Services = chatSidecarServices()
	}
	return mc
}

// chatSidecarServices returns the single fly.MachineService that
// routes external :443 to the sidecar's internal :8642. M-chat plan
// decision 4: internal HTTP at :8642 (the canonical Hermes harness
// port from blueprint §3.1) with TLS terminated at Fly's edge.
//
// Two handlers — "http" + "tls" — give Fly's edge proxy the standard
// HTTP-over-TLS termination path; the sidecar itself binds plain HTTP
// at :8642 inside the container. ForceHTTPS is not set because Fly's
// edge already redirects HTTP to HTTPS at the platform level for any
// services block carrying the "tls" handler.
//
// Lifted into its own helper rather than inlined in machineConfigFor
// so the Phase 5+ "toggle chat on a running agent" Update path can
// call this directly when the chat-enabled bit flips on, without
// duplicating the port + handler set.
func chatSidecarServices() []fly.MachineService {
	port := chatSidecarExternalPort
	return []fly.MachineService{{
		Protocol:     "tcp",
		InternalPort: chatSidecarInternalPort,
		Ports: []fly.MachinePort{{
			Port:     &port,
			Handlers: []string{"http", "tls"},
		}},
	}}
}

// mergeMachineConfig overlays the deploy-config compute fields onto
// the existing MachineConfig fetched via flaps.Get. Mutates a copy;
// preserves non-compute fields (Image, Mounts, Env, Services, etc.)
// so an Update never silently changes the running image or strips a
// mount. Phase 3.5 will extend this with the size hint that triggers
// `flaps.ExtendVolume` on volume size changes.
func mergeMachineConfig(current *fly.MachineConfig, cfg DeployConfig) *fly.MachineConfig {
	if current == nil {
		// Defensive: an empty current config means we have nothing to
		// preserve, so build one from the deploy-config alone.
		return &fly.MachineConfig{
			Guest: &fly.MachineGuest{CPUKind: cfg.CPUKind, CPUs: cfg.CPUs, MemoryMB: cfg.MemoryMB},
			Restart: &fly.MachineRestart{
				Policy:     restartPolicyFromCfg(cfg.RestartPolicy),
				MaxRetries: cfg.RestartMaxRetries,
			},
		}
	}
	out := *current
	out.Guest = &fly.MachineGuest{
		CPUKind:  cfg.CPUKind,
		CPUs:     cfg.CPUs,
		MemoryMB: cfg.MemoryMB,
	}
	out.Restart = &fly.MachineRestart{
		Policy:     restartPolicyFromCfg(cfg.RestartPolicy),
		MaxRetries: cfg.RestartMaxRetries,
	}
	return &out
}

func restartPolicyFromCfg(s string) fly.MachineRestartPolicy {
	switch s {
	case "no":
		return fly.MachineRestartPolicyNo
	case "always":
		return fly.MachineRestartPolicyAlways
	case "on-failure":
		return fly.MachineRestartPolicyOnFailure
	}
	return fly.MachineRestartPolicyOnFailure
}

func guestForConfig(cfg DeployConfig) *fly.MachineGuest {
	return &fly.MachineGuest{
		CPUKind:  cfg.CPUKind,
		CPUs:     cfg.CPUs,
		MemoryMB: cfg.MemoryMB,
	}
}

// firstMachineForLaunch builds the LaunchMachineInput a scale-up
// uses for each new replica. Reuses the first existing machine's
// region + image + config so the new replicas match what's already
// running rather than re-deriving from cfg (which doesn't carry the
// Image — that lives on the AgentTemplate).
func (f *FlyDeployTarget) firstMachineForLaunch(ctx context.Context, app string, machines []*fly.Machine) (fly.LaunchMachineInput, error) {
	if len(machines) == 0 {
		return fly.LaunchMachineInput{}, fmt.Errorf("fly: cannot scale up %q from zero machines", app)
	}
	first := machines[0]
	full, err := f.flaps.Get(ctx, app, first.ID)
	if err != nil {
		return fly.LaunchMachineInput{}, fmt.Errorf("fly: get template machine %q: %w", first.ID, err)
	}
	return fly.LaunchMachineInput{
		Region: first.Region,
		Config: full.Config,
	}, nil
}

// lifoTail returns the n machines that should be destroyed first on
// a scale-down. Two-key sort: failed-state machines come first (so
// scaling 3→1 with a "failed" replica destroys the failed one rather
// than a healthy newer one — plan §6 risk 2), then by CreatedAt
// descending (LIFO over the survivors). Ties broken by ID for
// determinism.
func lifoTail(machines []*fly.Machine, n int) []*fly.Machine {
	if n <= 0 || len(machines) == 0 {
		return nil
	}
	cp := make([]*fly.Machine, len(machines))
	copy(cp, machines)
	sort.SliceStable(cp, func(i, j int) bool {
		fi, fj := cp[i].State == "failed", cp[j].State == "failed"
		if fi != fj {
			return fi
		}
		if cp[i].CreatedAt != cp[j].CreatedAt {
			return cp[i].CreatedAt > cp[j].CreatedAt
		}
		return cp[i].ID > cp[j].ID
	})
	if n > len(cp) {
		n = len(cp)
	}
	return cp[:n]
}

func projectMachine(m *fly.Machine) MachineState {
	out := MachineState{
		ID:     m.ID,
		Region: m.Region,
		State:  m.State,
	}
	if m.Config != nil {
		if g := m.Config.Guest; g != nil {
			out.CPUKind = g.CPUKind
			out.CPUs = g.CPUs
			out.MemoryMB = g.MemoryMB
		}
		if len(m.Config.Mounts) > 0 {
			out.AttachedVolumeID = m.Config.Mounts[0].Volume
		}
	}
	if m.CreatedAt != "" {
		if t, err := time.Parse(time.RFC3339, m.CreatedAt); err == nil {
			out.CreatedAt = t
		} else {
			slog.Debug("fly: projectMachine CreatedAt parse failed", "machine", m.ID, "raw", m.CreatedAt, "err", err)
		}
	}
	return out
}

// redactFlyError strips upstream error wording from operator-facing
// messages. Phase 5's handler layer applies the same redaction to
// every deploy-package error before mapping to a Connect code; this
// helper is the source-of-truth for what shows up in PlacementResult.Reason.
func redactFlyError(err error) string {
	if err == nil {
		return ""
	}
	msg := err.Error()
	if len(msg) > redactFlyErrorMaxLen {
		return "fly placement check failed"
	}
	return msg
}

func mapFlyState(s string) HealthStatus {
	switch s {
	case "started":
		return HealthStarted
	case "starting", "created":
		return HealthStarting
	case "stopped", "stopping", "destroyed", "destroying":
		return HealthStopped
	default:
		return HealthFailed
	}
}

// appNameFor returns "corellia-agent-<8-char-uuid-prefix>". A stringified
// UUID is used directly; any other string is hashed via UUIDv5(NameSpaceURL,
// "corellia/<name>") to a deterministic UUID before truncation.
func appNameFor(name string) string {
	if id, err := uuid.Parse(name); err == nil {
		return "corellia-agent-" + strings.ReplaceAll(id.String(), "-", "")[:8]
	}
	id := uuid.NewSHA1(uuid.NameSpaceURL, []byte("corellia/"+name))
	return "corellia-agent-" + strings.ReplaceAll(id.String(), "-", "")[:8]
}

func parseExternalRef(ref string) (string, error) {
	if !strings.HasPrefix(ref, externalRefPfx) {
		return "", fmt.Errorf("deploy: external ref %q does not have %q prefix", ref, externalRefPfx)
	}
	return strings.TrimPrefix(ref, externalRefPfx), nil
}

func validateImageRef(ref string) error {
	if !strings.Contains(ref, "@sha256:") {
		return errors.New("deploy: image ref must be digest-pinned (@sha256:...)")
	}
	return nil
}
