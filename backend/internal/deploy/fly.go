package deploy

import (
	"context"
	"errors"
	"fmt"
	"log/slog"
	"strings"
	"time"

	"github.com/google/uuid"
	fly "github.com/superfly/fly-go"
	"github.com/superfly/fly-go/flaps"
	"github.com/superfly/fly-go/tokens"
)

const (
	flyKind         = "fly"
	defaultRegion   = "iad"
	defaultCPUs     = 1
	defaultMemoryMB = 512
	externalRefPfx  = "fly-app:"
	cleanupTimeout  = 30 * time.Second
)

// FlyDeployTarget is the only place in the codebase that imports
// `fly-go` or talks to the Fly.io API. Per blueprint §11.1, every
// other package sees only the DeployTarget interface.
type FlyDeployTarget struct {
	flaps   *flaps.Client
	orgSlug string
}

// NewFlyDeployTarget constructs a Fly-backed deploy target. The
// flaps client is global across apps; per-app routing happens at
// each method call via the appName argument.
func NewFlyDeployTarget(ctx context.Context, token, orgSlug string) (*FlyDeployTarget, error) {
	fc, err := flaps.NewWithOptions(ctx, flaps.NewClientOpts{
		Tokens:    tokens.Parse(token),
		UserAgent: "corellia",
	})
	if err != nil {
		return nil, fmt.Errorf("fly: flaps client: %w", err)
	}
	return &FlyDeployTarget{flaps: fc, orgSlug: orgSlug}, nil
}

func (f *FlyDeployTarget) Kind() string { return flyKind }

func (f *FlyDeployTarget) Spawn(ctx context.Context, spec SpawnSpec) (_ SpawnResult, err error) {
	if err = validateImageRef(spec.ImageRef); err != nil {
		return SpawnResult{}, err
	}
	app := appNameFor(spec.Name)
	region := spec.Region
	if region == "" {
		region = defaultRegion
	}
	cpus := spec.CPUs
	if cpus == 0 {
		cpus = defaultCPUs
	}
	mem := spec.MemoryMB
	if mem == 0 {
		mem = defaultMemoryMB
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
	// would leak the app indefinitely.
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

	m, err := f.flaps.Launch(ctx, app, fly.LaunchMachineInput{
		Region: region,
		Config: &fly.MachineConfig{
			Image: spec.ImageRef,
			Guest: &fly.MachineGuest{
				CPUKind:  "shared",
				CPUs:     cpus,
				MemoryMB: mem,
			},
			AutoDestroy: false,
			Restart:     &fly.MachineRestart{Policy: fly.MachineRestartPolicyOnFailure},
		},
	})
	if err != nil {
		return SpawnResult{}, fmt.Errorf("fly: launch machine in %q: %w", app, err)
	}

	return SpawnResult{
		ExternalRef: externalRefPfx + app,
		MachineID:   m.ID,
	}, nil
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
		if err := f.flaps.Stop(ctx, app, fly.StopMachineInput{ID: m.ID}, ""); err != nil {
			return fmt.Errorf("fly: stop machine %q: %w", m.ID, err)
		}
	}
	return nil
}

func (f *FlyDeployTarget) Destroy(ctx context.Context, externalRef string) error {
	app, err := parseExternalRef(externalRef)
	if err != nil {
		return err
	}
	if err := f.flaps.DeleteApp(ctx, app); err != nil {
		return fmt.Errorf("fly: delete app %q: %w", app, err)
	}
	return nil
}

func (f *FlyDeployTarget) Health(ctx context.Context, externalRef string) (HealthStatus, error) {
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
	// Blueprint §8: one AgentInstance = one Fly app = one Fly machine. If
	// we ever see >1 machine, the invariant is broken — surface as an
	// error rather than silently reporting an arbitrary machine's state.
	if len(machines) > 1 {
		return HealthUnknown, fmt.Errorf("fly: app %q has %d machines, v1 invariant expects exactly one", app, len(machines))
	}
	return mapFlyState(machines[0].State), nil
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
