package deploy

import (
	"context"
	"errors"
)

// ErrTargetNotConfigured is returned by Resolver implementations when
// no DeployTarget is registered for the requested kind. Distinct from
// ErrNotImplemented (target.go), which means "this target type exists
// as a stub but its methods aren't built yet" — a different operator
// failure with a different response. Conflating them would give
// callers a single ambiguous error to log and react to.
var ErrTargetNotConfigured = errors.New("deploy: target kind not configured")

// Resolver is the only sanctioned way handlers obtain a DeployTarget.
// Today's StaticResolver wraps the process-global, env-var-bootstrapped
// registry; v1.5's DBResolver will read user-configurable rows from
// the deploy_targets table and decrypt per-row credentials. Either
// implementation is selected at boot in cmd/api/main.go; handlers
// only ever see this interface.
//
// The single-method shape mirrors the previous map[string]DeployTarget
// lookup so callsites read naturally as resolver.For(ctx, kind). The
// ctx argument is unused by StaticResolver but required by DBResolver
// for the row fetch + decryption call. Per the deploy-target-resolver
// plan §2 decision 2, v1.5 may widen this interface (e.g.
// ForTarget(ctx, id uuid.UUID)) or replace it once the data model is
// concrete; the abstraction lands at kind granularity today because
// that is what the M3 registry already exposes.
type Resolver interface {
	For(ctx context.Context, kind string) (DeployTarget, error)
}

// StaticResolver is the v1 Resolver: a fixed map populated at boot
// from process-wide env vars. Behavior is byte-identical to the
// pre-resolver registry; the indirection exists so v1.5's swap to
// DBResolver requires no handler-side changes.
type StaticResolver struct {
	targets map[string]DeployTarget
}

// NewStaticResolver wraps a pre-built kind-keyed map. The constructor
// stays decoupled from how the map was built (env vars today, fakes
// in tests) so the resolver doesn't acquire a hidden dependency on
// any specific bootstrap path.
func NewStaticResolver(targets map[string]DeployTarget) *StaticResolver {
	return &StaticResolver{targets: targets}
}

func (r *StaticResolver) For(_ context.Context, kind string) (DeployTarget, error) {
	t, ok := r.targets[kind]
	if !ok {
		return nil, ErrTargetNotConfigured
	}
	return t, nil
}

// Compile-time assertion: any future rename or signature change on
// Resolver produces a directed build failure here rather than a
// runtime surprise at the call site. Matches the pattern already
// established in target_test.go for DeployTarget conformance.
var _ Resolver = (*StaticResolver)(nil)
