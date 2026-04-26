package deploy

import (
	"context"
	"errors"
	"fmt"
	"strings"
	"sync"
	"testing"
	"time"

	fly "github.com/superfly/fly-go"
	"github.com/superfly/fly-go/flaps"
)

// flapsClientFake is the in-memory stand-in for *flaps.Client used
// throughout this file. Every method records the call in `calls`,
// returns the canned value from the appropriate map, and falls
// through to a sensible default (no-op success) when no canned entry
// is set. This keeps each test's setup local — only the methods
// it cares about need fixtures.
//
// Concurrency: a few tests fan out across goroutines via Spawn's
// replica loop. The sync.Mutex around the maps + counter is enough
// for the depth our table cases reach.
type flapsClientFake struct {
	mu sync.Mutex

	regions    *flaps.RegionData
	regionsErr error

	placements    []flaps.RegionPlacement
	placementsErr error

	createApp    *flaps.App
	createAppErr error
	deleteAppErr error

	setSecretErr error

	machines  []*fly.Machine
	listErr   error
	getByID   map[string]*fly.Machine
	launchSeq []*fly.Machine
	launchErr error
	updateErr error
	stopErr   error
	startErr  error
	destroyErr error
	waitErr   error

	leases       map[string]*fly.MachineLease
	leaseErr     error
	releaseErr   error

	calls map[string]int
}

func newFakeFlaps() *flapsClientFake {
	return &flapsClientFake{
		getByID: make(map[string]*fly.Machine),
		leases:  make(map[string]*fly.MachineLease),
		calls:   make(map[string]int),
	}
}

func (f *flapsClientFake) record(method string) {
	f.mu.Lock()
	defer f.mu.Unlock()
	f.calls[method]++
}

func (f *flapsClientFake) callCount(method string) int {
	f.mu.Lock()
	defer f.mu.Unlock()
	return f.calls[method]
}

func (f *flapsClientFake) CreateApp(_ context.Context, _ flaps.CreateAppRequest) (*flaps.App, error) {
	f.record("CreateApp")
	if f.createAppErr != nil {
		return nil, f.createAppErr
	}
	if f.createApp != nil {
		return f.createApp, nil
	}
	return &flaps.App{Name: "corellia-agent-fake"}, nil
}

func (f *flapsClientFake) DeleteApp(_ context.Context, _ string) error {
	f.record("DeleteApp")
	return f.deleteAppErr
}

func (f *flapsClientFake) SetAppSecret(_ context.Context, _, _, _ string) (*fly.SetAppSecretResp, error) {
	f.record("SetAppSecret")
	if f.setSecretErr != nil {
		return nil, f.setSecretErr
	}
	return &fly.SetAppSecretResp{}, nil
}

func (f *flapsClientFake) Launch(_ context.Context, _ string, _ fly.LaunchMachineInput) (*fly.Machine, error) {
	f.record("Launch")
	if f.launchErr != nil {
		return nil, f.launchErr
	}
	if len(f.launchSeq) > 0 {
		f.mu.Lock()
		m := f.launchSeq[0]
		f.launchSeq = f.launchSeq[1:]
		f.mu.Unlock()
		return m, nil
	}
	return &fly.Machine{ID: fmt.Sprintf("m-fake-%d", f.callCount("Launch"))}, nil
}

func (f *flapsClientFake) List(_ context.Context, _, _ string) ([]*fly.Machine, error) {
	f.record("List")
	if f.listErr != nil {
		return nil, f.listErr
	}
	return f.machines, nil
}

func (f *flapsClientFake) Get(_ context.Context, _, machineID string) (*fly.Machine, error) {
	f.record("Get")
	if m, ok := f.getByID[machineID]; ok {
		return m, nil
	}
	return &fly.Machine{ID: machineID, Config: &fly.MachineConfig{Image: "img@sha256:00"}}, nil
}

func (f *flapsClientFake) Update(_ context.Context, _ string, _ fly.LaunchMachineInput, _ string) (*fly.Machine, error) {
	f.record("Update")
	if f.updateErr != nil {
		return nil, f.updateErr
	}
	return &fly.Machine{ID: "m-updated"}, nil
}

func (f *flapsClientFake) Stop(_ context.Context, _ string, _ fly.StopMachineInput, _ string) error {
	f.record("Stop")
	return f.stopErr
}

func (f *flapsClientFake) Start(_ context.Context, _, _, _ string) (*fly.MachineStartResponse, error) {
	f.record("Start")
	if f.startErr != nil {
		return nil, f.startErr
	}
	return &fly.MachineStartResponse{Status: "ok"}, nil
}

func (f *flapsClientFake) Destroy(_ context.Context, _ string, _ fly.RemoveMachineInput, _ string) error {
	f.record("Destroy")
	return f.destroyErr
}

func (f *flapsClientFake) Wait(_ context.Context, _, _ string, _ ...flaps.WaitOption) error {
	f.record("Wait")
	return f.waitErr
}

func (f *flapsClientFake) AcquireLease(_ context.Context, _, machineID string, _ *int) (*fly.MachineLease, error) {
	f.record("AcquireLease")
	if f.leaseErr != nil {
		return nil, f.leaseErr
	}
	if l, ok := f.leases[machineID]; ok {
		return l, nil
	}
	return &fly.MachineLease{Status: "success", Data: &fly.MachineLeaseData{Nonce: "nonce-" + machineID}}, nil
}

func (f *flapsClientFake) ReleaseLease(_ context.Context, _, _, _ string) error {
	f.record("ReleaseLease")
	return f.releaseErr
}

func (f *flapsClientFake) GetRegions(_ context.Context) (*flaps.RegionData, error) {
	f.record("GetRegions")
	if f.regionsErr != nil {
		return nil, f.regionsErr
	}
	if f.regions != nil {
		return f.regions, nil
	}
	return &flaps.RegionData{Regions: []fly.Region{
		{Code: "iad", Name: "Ashburn"},
		{Code: "sin", Name: "Singapore"},
		{Code: "old", Name: "Deprecated City", Deprecated: true},
	}}, nil
}

func (f *flapsClientFake) GetPlacements(_ context.Context, _ *flaps.GetPlacementsRequest) ([]flaps.RegionPlacement, error) {
	f.record("GetPlacements")
	if f.placementsErr != nil {
		return nil, f.placementsErr
	}
	return f.placements, nil
}

// newFlyTargetForTest constructs a FlyDeployTarget without going through
// NewFlyDeployTarget — skips the synchronous boot fetch and the hourly
// goroutine. The region cache is left empty unless the caller seeds it.
func newFlyTargetForTest(fake *flapsClientFake) *FlyDeployTarget {
	return &FlyDeployTarget{
		flaps:   fake,
		orgSlug: "test-org",
		regions: &regionCache{},
	}
}

// -----------------------------------------------------------------------------
// ListRegions / region cache
// -----------------------------------------------------------------------------

func TestRefreshRegions_FiltersDeprecated(t *testing.T) {
	fake := newFakeFlaps()
	target := newFlyTargetForTest(fake)
	if err := target.refreshRegions(context.Background()); err != nil {
		t.Fatalf("refreshRegions: %v", err)
	}
	got, _ := target.ListRegions(context.Background())
	if len(got) != 2 {
		t.Fatalf("expected 2 regions, got %d (%v)", len(got), got)
	}
	for _, r := range got {
		if r.Deprecated {
			t.Errorf("deprecated region leaked: %v", r)
		}
	}
	if got[0].Code != "iad" || got[1].Code != "sin" {
		t.Errorf("expected sorted iad,sin, got %v", got)
	}
}

func TestRefreshRegions_PreservesPriorOnError(t *testing.T) {
	fake := newFakeFlaps()
	target := newFlyTargetForTest(fake)
	if err := target.refreshRegions(context.Background()); err != nil {
		t.Fatalf("first refresh: %v", err)
	}
	fake.regionsErr = errors.New("fly api down")
	err := target.refreshRegions(context.Background())
	if err == nil {
		t.Fatal("expected error on second refresh")
	}
	got, _ := target.ListRegions(context.Background())
	if len(got) != 2 {
		t.Errorf("cache wiped on error: got %v", got)
	}
}

// -----------------------------------------------------------------------------
// Spawn — replica loop, rollback
// -----------------------------------------------------------------------------

func TestSpawn_LaunchesEachReplica(t *testing.T) {
	cases := []struct {
		name     string
		replicas int
	}{
		{"single replica", 1},
		{"two replicas", 2},
		{"five replicas", 5},
	}
	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			fake := newFakeFlaps()
			target := newFlyTargetForTest(fake)
			res, err := target.Spawn(context.Background(),
				SpawnSpec{
					Name:     "alice",
					ImageRef: "ghcr.io/foo/bar@sha256:abc",
				},
				DeployConfig{DesiredReplicas: tc.replicas},
			)
			if err != nil {
				t.Fatalf("Spawn: %v", err)
			}
			if got := fake.callCount("Launch"); got != tc.replicas {
				t.Errorf("Launch called %d times, want %d", got, tc.replicas)
			}
			if len(res.MachineIDs) != tc.replicas {
				t.Errorf("MachineIDs len = %d, want %d", len(res.MachineIDs), tc.replicas)
			}
			if !strings.HasPrefix(res.ExternalRef, externalRefPfx) {
				t.Errorf("external ref %q missing prefix", res.ExternalRef)
			}
			if res.MachineID != res.MachineIDs[0] {
				t.Errorf("singular MachineID %q != MachineIDs[0] %q", res.MachineID, res.MachineIDs[0])
			}
		})
	}
}

func TestSpawn_RollsBackOnLaunchFailure(t *testing.T) {
	fake := newFakeFlaps()
	fake.launchErr = errors.New("fly: capacity exhausted")
	target := newFlyTargetForTest(fake)
	_, err := target.Spawn(context.Background(),
		SpawnSpec{Name: "bob", ImageRef: "ghcr.io/foo/bar@sha256:abc"},
		DeployConfig{DesiredReplicas: 3},
	)
	if err == nil {
		t.Fatal("expected error from Spawn")
	}
	if got := fake.callCount("DeleteApp"); got != 1 {
		t.Errorf("DeleteApp called %d times, want 1 (rollback)", got)
	}
}

func TestSpawn_RejectsTagPinnedImage(t *testing.T) {
	fake := newFakeFlaps()
	target := newFlyTargetForTest(fake)
	_, err := target.Spawn(context.Background(),
		SpawnSpec{Name: "carol", ImageRef: "ghcr.io/foo/bar:latest"},
		DeployConfig{},
	)
	if err == nil {
		t.Fatal("expected validation error for tag-pinned image")
	}
	if got := fake.callCount("CreateApp"); got != 0 {
		t.Errorf("CreateApp called %d times, want 0 (validation should run first)", got)
	}
}

// -----------------------------------------------------------------------------
// Update — region delta + lease + scale
// -----------------------------------------------------------------------------

func TestUpdate_RegionChangeReturnsRespawn(t *testing.T) {
	fake := newFakeFlaps()
	fake.machines = []*fly.Machine{{ID: "m1", Region: "iad"}}
	target := newFlyTargetForTest(fake)
	kind, err := target.Update(context.Background(), "fly-app:corellia-agent-12345678",
		DeployConfig{Region: "lhr", CPUKind: "shared", CPUs: 1, MemoryMB: 256, RestartPolicy: "on-failure", LifecycleMode: "always-on", DesiredReplicas: 1, VolumeSizeGB: 1})
	if err != nil {
		t.Fatalf("Update: %v", err)
	}
	if kind != UpdateRequiresRespawn {
		t.Errorf("kind = %v, want %v", kind, UpdateRequiresRespawn)
	}
	if got := fake.callCount("AcquireLease"); got != 0 {
		t.Errorf("AcquireLease called %d times on region change, want 0 (must not touch Fly)", got)
	}
	if got := fake.callCount("Update"); got != 0 {
		t.Errorf("flaps.Update called %d times on region change, want 0", got)
	}
}

func TestUpdate_LiveAppliesAcrossReplicas(t *testing.T) {
	fake := newFakeFlaps()
	fake.machines = []*fly.Machine{
		{ID: "m1", Region: "iad", Config: &fly.MachineConfig{Image: "img@sha256:00"}},
		{ID: "m2", Region: "iad", Config: &fly.MachineConfig{Image: "img@sha256:00"}},
	}
	target := newFlyTargetForTest(fake)
	kind, err := target.Update(context.Background(), "fly-app:corellia-agent-12345678",
		DeployConfig{Region: "iad", CPUKind: "shared", CPUs: 2, MemoryMB: 512, RestartPolicy: "on-failure", LifecycleMode: "always-on", DesiredReplicas: 2, VolumeSizeGB: 1})
	if err != nil {
		t.Fatalf("Update: %v", err)
	}
	if kind != UpdateLiveApplied {
		t.Errorf("kind = %v, want %v", kind, UpdateLiveApplied)
	}
	if got := fake.callCount("AcquireLease"); got != 2 {
		t.Errorf("AcquireLease %d, want 2 (one per machine)", got)
	}
	if got := fake.callCount("Update"); got != 2 {
		t.Errorf("flaps.Update %d, want 2", got)
	}
	if got := fake.callCount("ReleaseLease"); got != 2 {
		t.Errorf("ReleaseLease %d, want 2", got)
	}
}

func TestUpdate_ScalesUp(t *testing.T) {
	fake := newFakeFlaps()
	fake.machines = []*fly.Machine{
		{ID: "m1", Region: "iad", Config: &fly.MachineConfig{Image: "img@sha256:00"}},
	}
	target := newFlyTargetForTest(fake)
	kind, err := target.Update(context.Background(), "fly-app:corellia-agent-12345678",
		DeployConfig{Region: "iad", CPUKind: "shared", CPUs: 1, MemoryMB: 256, RestartPolicy: "on-failure", LifecycleMode: "always-on", DesiredReplicas: 3, VolumeSizeGB: 1})
	if err != nil {
		t.Fatalf("Update: %v", err)
	}
	if kind != UpdateLiveApplied {
		t.Errorf("kind = %v, want %v", kind, UpdateLiveApplied)
	}
	if got := fake.callCount("Launch"); got != 2 {
		t.Errorf("Launch called %d times, want 2 (scale 1→3)", got)
	}
}

func TestUpdate_ScalesDownLIFO(t *testing.T) {
	fake := newFakeFlaps()
	fake.machines = []*fly.Machine{
		{ID: "m-old", Region: "iad", CreatedAt: "2026-04-26T10:00:00Z", Config: &fly.MachineConfig{Image: "img@sha256:00"}},
		{ID: "m-mid", Region: "iad", CreatedAt: "2026-04-26T11:00:00Z", Config: &fly.MachineConfig{Image: "img@sha256:00"}},
		{ID: "m-new", Region: "iad", CreatedAt: "2026-04-26T12:00:00Z", Config: &fly.MachineConfig{Image: "img@sha256:00"}},
	}
	target := newFlyTargetForTest(fake)
	_, err := target.Update(context.Background(), "fly-app:corellia-agent-12345678",
		DeployConfig{Region: "iad", CPUKind: "shared", CPUs: 1, MemoryMB: 256, RestartPolicy: "on-failure", LifecycleMode: "always-on", DesiredReplicas: 1, VolumeSizeGB: 1})
	if err != nil {
		t.Fatalf("Update: %v", err)
	}
	if got := fake.callCount("Destroy"); got != 2 {
		t.Errorf("Destroy %d, want 2 (scale 3→1)", got)
	}
}

func TestPreviewUpdate_RegionChangeReturnsRespawn(t *testing.T) {
	fake := newFakeFlaps()
	fake.machines = []*fly.Machine{{ID: "m1", Region: "iad", Config: &fly.MachineConfig{Image: "img@sha256:00"}}}
	target := newFlyTargetForTest(fake)
	kind, err := target.PreviewUpdate(context.Background(), "fly-app:corellia-agent-12345678",
		DeployConfig{Region: "lhr", CPUKind: "shared", CPUs: 1, MemoryMB: 256, RestartPolicy: "on-failure", LifecycleMode: "always-on", DesiredReplicas: 1, VolumeSizeGB: 1})
	if err != nil {
		t.Fatalf("PreviewUpdate: %v", err)
	}
	if kind != UpdateRequiresRespawn {
		t.Errorf("kind = %v, want %v", kind, UpdateRequiresRespawn)
	}
	// PreviewUpdate is read-only: zero compute-mutating calls.
	for _, m := range []string{"AcquireLease", "Update", "Launch", "Destroy", "ReleaseLease"} {
		if got := fake.callCount(m); got != 0 {
			t.Errorf("%s called %d times in PreviewUpdate, want 0", m, got)
		}
	}
}

func TestPreviewUpdate_NoRegionChangeReturnsLiveApplied(t *testing.T) {
	fake := newFakeFlaps()
	fake.machines = []*fly.Machine{{ID: "m1", Region: "iad", Config: &fly.MachineConfig{Image: "img@sha256:00"}}}
	target := newFlyTargetForTest(fake)
	kind, err := target.PreviewUpdate(context.Background(), "fly-app:corellia-agent-12345678",
		DeployConfig{Region: "iad", CPUKind: "shared", CPUs: 2, MemoryMB: 512, RestartPolicy: "on-failure", LifecycleMode: "always-on", DesiredReplicas: 1, VolumeSizeGB: 1})
	if err != nil {
		t.Fatalf("PreviewUpdate: %v", err)
	}
	if kind != UpdateLiveApplied {
		t.Errorf("kind = %v, want %v", kind, UpdateLiveApplied)
	}
	if got := fake.callCount("AcquireLease"); got != 0 {
		t.Errorf("AcquireLease called %d times in PreviewUpdate, want 0", got)
	}
}

func TestDestroy_IdempotentOnNotFound(t *testing.T) {
	fake := newFakeFlaps()
	fake.deleteAppErr = flaps.ErrFlapsNotFound
	target := newFlyTargetForTest(fake)
	if err := target.Destroy(context.Background(), "fly-app:corellia-agent-12345678"); err != nil {
		t.Fatalf("Destroy returned %v, want nil (idempotent on NotFound)", err)
	}
	if got := fake.callCount("DeleteApp"); got != 1 {
		t.Errorf("DeleteApp called %d times, want 1", got)
	}
}

func TestUpdate_LeaseContentionReturnsBusy(t *testing.T) {
	fake := newFakeFlaps()
	fake.machines = []*fly.Machine{{ID: "m1", Region: "iad", Config: &fly.MachineConfig{Image: "img@sha256:00"}}}
	fake.leaseErr = errors.New("lease held by other operation")
	target := newFlyTargetForTest(fake)
	_, err := target.Update(context.Background(), "fly-app:corellia-agent-12345678",
		DeployConfig{Region: "iad", CPUKind: "shared", CPUs: 1, MemoryMB: 256, RestartPolicy: "on-failure", LifecycleMode: "always-on", DesiredReplicas: 1, VolumeSizeGB: 1})
	if !errors.Is(err, ErrMachineBusy) {
		t.Fatalf("err = %v, want ErrMachineBusy", err)
	}
}

// -----------------------------------------------------------------------------
// Start — only stopped machines, lease pattern
// -----------------------------------------------------------------------------

func TestStart_OnlyTouchesStoppedMachines(t *testing.T) {
	fake := newFakeFlaps()
	fake.machines = []*fly.Machine{
		{ID: "m1", State: "stopped"},
		{ID: "m2", State: "started"},
		{ID: "m3", State: "stopped"},
	}
	target := newFlyTargetForTest(fake)
	if err := target.Start(context.Background(), "fly-app:corellia-agent-12345678"); err != nil {
		t.Fatalf("Start: %v", err)
	}
	if got := fake.callCount("Start"); got != 2 {
		t.Errorf("Start %d, want 2", got)
	}
	if got := fake.callCount("AcquireLease"); got != 2 {
		t.Errorf("AcquireLease %d, want 2", got)
	}
}

// -----------------------------------------------------------------------------
// Stop — lease pattern across replicas
// -----------------------------------------------------------------------------

func TestStop_AcquiresLeasePerMachine(t *testing.T) {
	fake := newFakeFlaps()
	fake.machines = []*fly.Machine{{ID: "m1"}, {ID: "m2"}}
	target := newFlyTargetForTest(fake)
	if err := target.Stop(context.Background(), "fly-app:corellia-agent-12345678"); err != nil {
		t.Fatalf("Stop: %v", err)
	}
	if got := fake.callCount("AcquireLease"); got != 2 {
		t.Errorf("AcquireLease %d, want 2", got)
	}
	if got := fake.callCount("Stop"); got != 2 {
		t.Errorf("Stop %d, want 2", got)
	}
}

// -----------------------------------------------------------------------------
// CheckPlacement
// -----------------------------------------------------------------------------

func TestCheckPlacement_AvailableInRequestedRegion(t *testing.T) {
	fake := newFakeFlaps()
	fake.placements = []flaps.RegionPlacement{
		{Region: "iad", Count: 3},
		{Region: "lhr", Count: 5},
	}
	target := newFlyTargetForTest(fake)
	res, err := target.CheckPlacement(context.Background(),
		DeployConfig{Region: "iad", DesiredReplicas: 2})
	if err != nil {
		t.Fatalf("CheckPlacement: %v", err)
	}
	if !res.Available {
		t.Errorf("Available = false, want true (3 capacity for 2 desired in iad)")
	}
	if !contains(res.AlternateRegions, "lhr") {
		t.Errorf("AlternateRegions missing lhr: %v", res.AlternateRegions)
	}
}

func TestCheckPlacement_UnavailableSurfacesAlternates(t *testing.T) {
	fake := newFakeFlaps()
	fake.placements = []flaps.RegionPlacement{
		{Region: "iad", Count: 0},
		{Region: "lhr", Count: 10},
		{Region: "sin", Count: 4},
	}
	target := newFlyTargetForTest(fake)
	res, err := target.CheckPlacement(context.Background(),
		DeployConfig{Region: "iad", DesiredReplicas: 3})
	if err != nil {
		t.Fatalf("CheckPlacement: %v", err)
	}
	if res.Available {
		t.Errorf("Available = true, want false")
	}
	if !contains(res.AlternateRegions, "lhr") || !contains(res.AlternateRegions, "sin") {
		t.Errorf("AlternateRegions %v missing lhr/sin", res.AlternateRegions)
	}
}

// -----------------------------------------------------------------------------
// ListMachines projection
// -----------------------------------------------------------------------------

func TestListMachines_ProjectsConfig(t *testing.T) {
	fake := newFakeFlaps()
	fake.machines = []*fly.Machine{{
		ID:        "m1",
		Region:    "iad",
		State:     "started",
		CreatedAt: "2026-04-26T10:00:00Z",
		Config: &fly.MachineConfig{
			Guest: &fly.MachineGuest{CPUKind: "shared", CPUs: 2, MemoryMB: 512},
			Mounts: []fly.MachineMount{{Volume: "vol_abc", Path: "/opt/data", SizeGb: 5}},
		},
	}}
	target := newFlyTargetForTest(fake)
	got, err := target.ListMachines(context.Background(), "fly-app:corellia-agent-12345678")
	if err != nil {
		t.Fatalf("ListMachines: %v", err)
	}
	if len(got) != 1 {
		t.Fatalf("len = %d, want 1", len(got))
	}
	m := got[0]
	if m.ID != "m1" || m.Region != "iad" || m.State != "started" {
		t.Errorf("base fields wrong: %+v", m)
	}
	if m.CPUKind != "shared" || m.CPUs != 2 || m.MemoryMB != 512 {
		t.Errorf("guest projection wrong: %+v", m)
	}
	if m.AttachedVolumeID != "vol_abc" {
		t.Errorf("AttachedVolumeID = %q, want vol_abc", m.AttachedVolumeID)
	}
	if m.CreatedAt.IsZero() {
		t.Errorf("CreatedAt parsed as zero")
	}
}

// -----------------------------------------------------------------------------
// lifoTail ordering
// -----------------------------------------------------------------------------

func TestLifoTail_OrdersByCreatedAtDesc(t *testing.T) {
	machines := []*fly.Machine{
		{ID: "old", CreatedAt: "2026-04-26T10:00:00Z"},
		{ID: "newest", CreatedAt: "2026-04-26T12:00:00Z"},
		{ID: "mid", CreatedAt: "2026-04-26T11:00:00Z"},
	}
	got := lifoTail(machines, 2)
	if len(got) != 2 {
		t.Fatalf("len = %d, want 2", len(got))
	}
	if got[0].ID != "newest" || got[1].ID != "mid" {
		t.Errorf("order = [%s,%s], want [newest,mid]", got[0].ID, got[1].ID)
	}
}

func TestLifoTail_NRequestExceedsLen(t *testing.T) {
	machines := []*fly.Machine{{ID: "a"}}
	got := lifoTail(machines, 5)
	if len(got) != 1 {
		t.Errorf("len = %d, want 1 (clamp to len)", len(got))
	}
}

func TestLifoTail_FailedMachinesDestroyedFirst(t *testing.T) {
	// Scale 3→1 with one failed-state replica should destroy the
	// failed one *and* the LIFO-newest survivor — never the healthy
	// older replicas. Plan §6 risk 2: scale-down preferring failed
	// keeps the fleet recovering toward green automatically.
	machines := []*fly.Machine{
		{ID: "old-running", State: "started", CreatedAt: "2026-04-26T10:00:00Z"},
		{ID: "mid-failed", State: "failed", CreatedAt: "2026-04-26T11:00:00Z"},
		{ID: "new-running", State: "started", CreatedAt: "2026-04-26T12:00:00Z"},
	}
	got := lifoTail(machines, 2)
	if len(got) != 2 {
		t.Fatalf("len = %d, want 2", len(got))
	}
	if got[0].ID != "mid-failed" {
		t.Errorf("got[0] = %s, want mid-failed (failed-first wins over LIFO)", got[0].ID)
	}
	if got[1].ID != "new-running" {
		t.Errorf("got[1] = %s, want new-running (LIFO over remaining survivors)", got[1].ID)
	}
}

// -----------------------------------------------------------------------------
// helpers
// -----------------------------------------------------------------------------

func contains(haystack []string, needle string) bool {
	for _, s := range haystack {
		if s == needle {
			return true
		}
	}
	return false
}

// silence unused import warnings if a future trim removes references
var _ = time.Second
