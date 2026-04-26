package deploy

import "context"

// LocalDeployTarget and AWSDeployTarget are real interface
// implementations that return ErrNotImplemented from every method.
// Per blueprint §11.4, deferred features are stubbed at the
// interface level — never as fake UI buttons.

type LocalDeployTarget struct{}

func NewLocalDeployTarget() *LocalDeployTarget { return &LocalDeployTarget{} }
func (*LocalDeployTarget) Kind() string         { return "local" }
func (*LocalDeployTarget) Spawn(_ context.Context, _ SpawnSpec) (SpawnResult, error) {
	return SpawnResult{}, ErrNotImplemented
}
func (*LocalDeployTarget) Stop(_ context.Context, _ string) error    { return ErrNotImplemented }
func (*LocalDeployTarget) Destroy(_ context.Context, _ string) error { return ErrNotImplemented }
func (*LocalDeployTarget) Health(_ context.Context, _ string) (HealthStatus, error) {
	return HealthUnknown, ErrNotImplemented
}

type AWSDeployTarget struct{}

func NewAWSDeployTarget() *AWSDeployTarget { return &AWSDeployTarget{} }
func (*AWSDeployTarget) Kind() string       { return "aws" }
func (*AWSDeployTarget) Spawn(_ context.Context, _ SpawnSpec) (SpawnResult, error) {
	return SpawnResult{}, ErrNotImplemented
}
func (*AWSDeployTarget) Stop(_ context.Context, _ string) error    { return ErrNotImplemented }
func (*AWSDeployTarget) Destroy(_ context.Context, _ string) error { return ErrNotImplemented }
func (*AWSDeployTarget) Health(_ context.Context, _ string) (HealthStatus, error) {
	return HealthUnknown, ErrNotImplemented
}
