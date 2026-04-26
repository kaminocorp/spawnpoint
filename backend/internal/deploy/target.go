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
// back-reference to whatever the target created.
type SpawnResult struct {
	ExternalRef string
	MachineID   string
}

// HealthStatus is the deployment-side health summary, distinct from
// the harness-side /health endpoint. "started" means the target
// considers the machine running; whether the application inside is
// responsive is a separate concern (see blueprint §3.1).
type HealthStatus string

const (
	HealthUnknown  HealthStatus = "unknown"
	HealthStarting HealthStatus = "starting"
	HealthStarted  HealthStatus = "started"
	HealthStopped  HealthStatus = "stopped"
	HealthFailed   HealthStatus = "failed"
)

// DeployTarget abstracts an infrastructure provider. Per blueprint
// §11.1: no Fly-specific (or AWS-specific, etc.) types leak past
// this interface boundary.
type DeployTarget interface {
	Kind() string
	Spawn(ctx context.Context, spec SpawnSpec) (SpawnResult, error)
	Stop(ctx context.Context, externalRef string) error
	Destroy(ctx context.Context, externalRef string) error
	Health(ctx context.Context, externalRef string) (HealthStatus, error)
}
