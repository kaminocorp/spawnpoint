package deploy

import "context"

// LocalDeployTarget and AWSDeployTarget are real interface
// implementations that return ErrNotImplemented from every method.
// Per blueprint §11.4, deferred features are stubbed at the
// interface level — never as fake UI buttons.
//
// M5 widening: each stub gains seven new methods (Update, Start,
// ListRegions, CheckPlacement, ListMachines, EnsureVolume,
// ExtendVolume) plus the Spawn signature gains a DeployConfig
// param. The bodies stay uniform — every method is "I don't exist
// yet, surface that to the caller cleanly."

type LocalDeployTarget struct{}

func NewLocalDeployTarget() *LocalDeployTarget { return &LocalDeployTarget{} }
func (*LocalDeployTarget) Kind() string         { return "local" }
func (*LocalDeployTarget) Spawn(_ context.Context, _ SpawnSpec, _ DeployConfig) (SpawnResult, error) {
	return SpawnResult{}, ErrNotImplemented
}
func (*LocalDeployTarget) Update(_ context.Context, _ string, _ DeployConfig) (UpdateKind, error) {
	return "", ErrNotImplemented
}
func (*LocalDeployTarget) PreviewUpdate(_ context.Context, _ string, _ DeployConfig) (UpdateKind, error) {
	return "", ErrNotImplemented
}
func (*LocalDeployTarget) Stop(_ context.Context, _ string) error    { return ErrNotImplemented }
func (*LocalDeployTarget) Start(_ context.Context, _ string) error   { return ErrNotImplemented }
func (*LocalDeployTarget) Destroy(_ context.Context, _ string) error { return ErrNotImplemented }
func (*LocalDeployTarget) Health(_ context.Context, _ string, _ bool) (HealthStatus, error) {
	return HealthUnknown, ErrNotImplemented
}
func (*LocalDeployTarget) ListRegions(_ context.Context) ([]Region, error) {
	return nil, ErrNotImplemented
}
func (*LocalDeployTarget) CheckPlacement(_ context.Context, _ DeployConfig) (PlacementResult, error) {
	return PlacementResult{}, ErrNotImplemented
}
func (*LocalDeployTarget) ListMachines(_ context.Context, _ string) ([]MachineState, error) {
	return nil, ErrNotImplemented
}
func (*LocalDeployTarget) EnsureVolume(_ context.Context, _ string, _ string, _ int) (VolumeRef, error) {
	return VolumeRef{}, ErrNotImplemented
}
func (*LocalDeployTarget) ExtendVolume(_ context.Context, _ string, _ string, _ int) (bool, error) {
	return false, ErrNotImplemented
}
func (*LocalDeployTarget) GetAppSecret(_ context.Context, _ string, _ string) (string, error) {
	return "", ErrNotImplemented
}

type AWSDeployTarget struct{}

func NewAWSDeployTarget() *AWSDeployTarget { return &AWSDeployTarget{} }
func (*AWSDeployTarget) Kind() string       { return "aws" }
func (*AWSDeployTarget) Spawn(_ context.Context, _ SpawnSpec, _ DeployConfig) (SpawnResult, error) {
	return SpawnResult{}, ErrNotImplemented
}
func (*AWSDeployTarget) Update(_ context.Context, _ string, _ DeployConfig) (UpdateKind, error) {
	return "", ErrNotImplemented
}
func (*AWSDeployTarget) PreviewUpdate(_ context.Context, _ string, _ DeployConfig) (UpdateKind, error) {
	return "", ErrNotImplemented
}
func (*AWSDeployTarget) Stop(_ context.Context, _ string) error    { return ErrNotImplemented }
func (*AWSDeployTarget) Start(_ context.Context, _ string) error   { return ErrNotImplemented }
func (*AWSDeployTarget) Destroy(_ context.Context, _ string) error { return ErrNotImplemented }
func (*AWSDeployTarget) Health(_ context.Context, _ string, _ bool) (HealthStatus, error) {
	return HealthUnknown, ErrNotImplemented
}
func (*AWSDeployTarget) ListRegions(_ context.Context) ([]Region, error) {
	return nil, ErrNotImplemented
}
func (*AWSDeployTarget) CheckPlacement(_ context.Context, _ DeployConfig) (PlacementResult, error) {
	return PlacementResult{}, ErrNotImplemented
}
func (*AWSDeployTarget) ListMachines(_ context.Context, _ string) ([]MachineState, error) {
	return nil, ErrNotImplemented
}
func (*AWSDeployTarget) EnsureVolume(_ context.Context, _ string, _ string, _ int) (VolumeRef, error) {
	return VolumeRef{}, ErrNotImplemented
}
func (*AWSDeployTarget) ExtendVolume(_ context.Context, _ string, _ string, _ int) (bool, error) {
	return false, ErrNotImplemented
}
func (*AWSDeployTarget) GetAppSecret(_ context.Context, _ string, _ string) (string, error) {
	return "", ErrNotImplemented
}
