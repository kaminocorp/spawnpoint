package httpsrv

import (
	"context"
	"errors"
	"fmt"
	"testing"
	"time"

	"connectrpc.com/connect"
	"github.com/google/uuid"

	"github.com/hejijunhao/corellia/backend/internal/agents"
	"github.com/hejijunhao/corellia/backend/internal/deploy"
	corelliav1 "github.com/hejijunhao/corellia/backend/internal/gen/corellia/v1"
	"github.com/hejijunhao/corellia/backend/internal/users"
)

// fakeAgentsSvc satisfies agentsService. A single err field drives the
// generic mapping path; per-method knobs (updateResult, bulkResults,
// regions, chatContent, chatErr) feed the M5 + M-chat happy-path tests
// so one fake covers every RPC.
type fakeAgentsSvc struct {
	err          error
	updateResult *agents.UpdateResult
	bulkResults  []agents.BulkResult
	regions      []deploy.Region
	placement    deploy.PlacementResult
	chatContent  string
	chatErr      error
}

func (f *fakeAgentsSvc) ListAgentTemplates(_ context.Context) ([]*corelliav1.AgentTemplate, error) {
	if f.err != nil {
		return nil, f.err
	}
	return []*corelliav1.AgentTemplate{}, nil
}

func (f *fakeAgentsSvc) Spawn(_ context.Context, _ agents.SpawnInput) (*corelliav1.AgentInstance, error) {
	if f.err != nil {
		return nil, f.err
	}
	return &corelliav1.AgentInstance{}, nil
}

func (f *fakeAgentsSvc) SpawnN(_ context.Context, _ agents.SpawnNInput) ([]*corelliav1.AgentInstance, error) {
	if f.err != nil {
		return nil, f.err
	}
	return nil, nil
}

func (f *fakeAgentsSvc) List(_ context.Context, _ uuid.UUID) ([]*corelliav1.AgentInstance, error) {
	if f.err != nil {
		return nil, f.err
	}
	return nil, nil
}

func (f *fakeAgentsSvc) Get(_ context.Context, _, _ uuid.UUID) (*corelliav1.AgentInstance, error) {
	if f.err != nil {
		return nil, f.err
	}
	return &corelliav1.AgentInstance{}, nil
}

func (f *fakeAgentsSvc) Stop(_ context.Context, _, _ uuid.UUID) (*corelliav1.AgentInstance, error) {
	if f.err != nil {
		return nil, f.err
	}
	return &corelliav1.AgentInstance{}, nil
}

func (f *fakeAgentsSvc) Destroy(_ context.Context, _, _ uuid.UUID) (*corelliav1.AgentInstance, error) {
	if f.err != nil {
		return nil, f.err
	}
	return &corelliav1.AgentInstance{}, nil
}

// M5 fleet-control surface.

func (f *fakeAgentsSvc) ListRegions(_ context.Context) ([]deploy.Region, error) {
	if f.err != nil {
		return nil, f.err
	}
	return f.regions, nil
}

func (f *fakeAgentsSvc) CheckPlacement(_ context.Context, _ deploy.DeployConfig) (deploy.PlacementResult, error) {
	if f.err != nil {
		return deploy.PlacementResult{}, f.err
	}
	return f.placement, nil
}

func (f *fakeAgentsSvc) UpdateDeployConfig(
	_ context.Context, _, _ uuid.UUID, _ deploy.DeployConfig, _ bool,
) (*agents.UpdateResult, error) {
	if f.err != nil {
		return nil, f.err
	}
	return f.updateResult, nil
}

func (f *fakeAgentsSvc) StartInstance(_ context.Context, _, _ uuid.UUID) (*corelliav1.AgentInstance, error) {
	if f.err != nil {
		return nil, f.err
	}
	return &corelliav1.AgentInstance{}, nil
}

func (f *fakeAgentsSvc) ResizeReplicas(
	_ context.Context, _, _ uuid.UUID, _ int,
) (*agents.UpdateResult, error) {
	if f.err != nil {
		return nil, f.err
	}
	return f.updateResult, nil
}

func (f *fakeAgentsSvc) ResizeVolume(
	_ context.Context, _, _ uuid.UUID, _ int,
) (*agents.UpdateResult, error) {
	if f.err != nil {
		return nil, f.err
	}
	return f.updateResult, nil
}

func (f *fakeAgentsSvc) BulkUpdateDeployConfig(
	_ context.Context, _ []uuid.UUID, _ uuid.UUID, _ agents.BulkConfigDelta, _ bool,
) ([]agents.BulkResult, error) {
	if f.err != nil {
		return nil, f.err
	}
	return f.bulkResults, nil
}

func (f *fakeAgentsSvc) ChatWithAgent(
	_ context.Context, _, _ uuid.UUID, _, _ string,
) (string, error) {
	if f.chatErr != nil {
		return "", f.chatErr
	}
	return f.chatContent, nil
}

// fakeUserLookup satisfies userIdentityLookup. Returns fresh UUIDs on
// success — the handler doesn't care about specific values for these
// tests; the org-scoping behavior is covered in agents/service_test.
type fakeUserLookup struct {
	err error
}

func (f *fakeUserLookup) CallerIdentity(_ context.Context) (uuid.UUID, uuid.UUID, error) {
	if f.err != nil {
		return uuid.Nil, uuid.Nil, f.err
	}
	return uuid.New(), uuid.New(), nil
}

// validSpawnReq is the request shape used to exercise the handler in
// each mapping case. The fake service ignores its content — these are
// the minimum non-empty fields the proto generator emits when getters
// are called against a default request.
func validSpawnReq() *connect.Request[corelliav1.SpawnAgentRequest] {
	return connect.NewRequest(&corelliav1.SpawnAgentRequest{
		TemplateId:  uuid.New().String(),
		Name:        "smoke",
		Provider:    corelliav1.ModelProvider_ANTHROPIC,
		ModelName:   "claude-opus-4-7",
		ModelApiKey: "sk-fake",
	})
}

// TestAgentsErrToConnect_SentinelMapping pins the public contract for
// each agents/users/deploy sentinel → Connect code mapping. SpawnAgent
// is the vehicle since it exercises both the user-identity error path
// and the service error path; the agentsErrToConnect mapping is method-
// agnostic so any RPC would work.
func TestAgentsErrToConnect_SentinelMapping(t *testing.T) {
	cases := []struct {
		name     string
		userErr  error
		svcErr   error
		wantCode connect.Code
	}{
		// users sentinels — passthrough from organizations_handler / users_handler convention.
		{"users.ErrUnauthenticated → Unauthenticated", users.ErrUnauthenticated, nil, connect.CodeUnauthenticated},
		{"users.ErrNotProvisioned → PermissionDenied", users.ErrNotProvisioned, nil, connect.CodePermissionDenied},

		// validation sentinels → InvalidArgument.
		{"agents.ErrInvalidName → InvalidArgument", nil, agents.ErrInvalidName, connect.CodeInvalidArgument},
		{"agents.ErrInvalidProvider → InvalidArgument", nil, agents.ErrInvalidProvider, connect.CodeInvalidArgument},
		{"agents.ErrInvalidModel → InvalidArgument", nil, agents.ErrInvalidModel, connect.CodeInvalidArgument},
		{"agents.ErrMissingAPIKey → InvalidArgument", nil, agents.ErrMissingAPIKey, connect.CodeInvalidArgument},

		// M5 validation sentinels (deploy package) → InvalidArgument.
		// errors.Is matches both the bare sentinel and `fmt.Errorf("...%w", sentinel)`
		// wrapped forms; the wrapped form is what the service layer surfaces.
		{"deploy.ErrInvalidSize → InvalidArgument", nil, deploy.ErrInvalidSize, connect.CodeInvalidArgument},
		{"deploy.ErrInvalidSize (wrapped) → InvalidArgument", nil,
			fmt.Errorf("%w: cpus 99 out of range", deploy.ErrInvalidSize), connect.CodeInvalidArgument},
		{"deploy.ErrInvalidVolumeSize → InvalidArgument", nil, deploy.ErrInvalidVolumeSize, connect.CodeInvalidArgument},
		{"deploy.ErrInvalidRegion → InvalidArgument", nil, deploy.ErrInvalidRegion, connect.CodeInvalidArgument},
		{"deploy.ErrVolumeShrink → InvalidArgument", nil, deploy.ErrVolumeShrink, connect.CodeInvalidArgument},
		{"agents.ErrBulkLimit → InvalidArgument", nil, agents.ErrBulkLimit, connect.CodeInvalidArgument},

		// policy-cap → FailedPrecondition. The request is well-formed;
		// the cap (or placement gate) is the rejection reason.
		{"agents.ErrSpawnLimit → FailedPrecondition", nil, agents.ErrSpawnLimit, connect.CodeFailedPrecondition},
		{"deploy.ErrPlacementUnavailable → FailedPrecondition", nil,
			deploy.ErrPlacementUnavailable, connect.CodeFailedPrecondition},

		// Lifecycle deferred to v2 → Unimplemented (DB column accepts;
		// the API gates on plan decision 3 until network-exposure model lands).
		{"deploy.ErrLifecycleUnsupported → Unimplemented", nil,
			deploy.ErrLifecycleUnsupported, connect.CodeUnimplemented},

		// Machine lease contention → Aborted (transient; retryable).
		{"deploy.ErrMachineBusy → Aborted", nil, deploy.ErrMachineBusy, connect.CodeAborted},

		// not-found sentinels → NotFound.
		{"agents.ErrTemplateNotFound → NotFound", nil, agents.ErrTemplateNotFound, connect.CodeNotFound},
		{"agents.ErrInstanceNotFound → NotFound", nil, agents.ErrInstanceNotFound, connect.CodeNotFound},
		{"agents.ErrNotFound (M2 holdover) → NotFound", nil, agents.ErrNotFound, connect.CodeNotFound},

		// upstream/resolver / volume-provision — already redacted by the service layer.
		{"agents.ErrFlyAPI → Unavailable", nil, agents.ErrFlyAPI, connect.CodeUnavailable},
		{"agents.ErrTargetUnavailable → Unavailable", nil, agents.ErrTargetUnavailable, connect.CodeUnavailable},
		{"deploy.ErrVolumeProvisionFailed → Unavailable", nil,
			deploy.ErrVolumeProvisionFailed, connect.CodeUnavailable},

		// Unknown errors → Internal with a generic message. The original
		// error is logged server-side (not asserted here), and the wire
		// surface stays free of pgx/driver internals.
		{"unknown error → Internal", nil, errors.New("surprise: pgx: connection reset"), connect.CodeInternal},
	}

	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			h := NewAgentsHandler(&fakeAgentsSvc{err: tc.svcErr}, &fakeUserLookup{err: tc.userErr})

			_, err := h.SpawnAgent(context.Background(), validSpawnReq())
			if err == nil {
				t.Fatal("want error, got nil")
			}
			if got := connect.CodeOf(err); got != tc.wantCode {
				t.Errorf("code: got %v, want %v (err=%v)", got, tc.wantCode, err)
			}
		})
	}
}

// TestSpawnAgent_BadTemplateID pins the per-handler UUID-parse fast
// path that bypasses the service. The handler returns InvalidArgument
// here (not NotFound), wrapping ErrTemplateNotFound as the message —
// the message is part of the public contract so the FE can branch on
// the sentinel without parsing free-form strings.
func TestSpawnAgent_BadTemplateID(t *testing.T) {
	h := NewAgentsHandler(&fakeAgentsSvc{}, &fakeUserLookup{})
	req := connect.NewRequest(&corelliav1.SpawnAgentRequest{
		TemplateId:  "not-a-uuid",
		Name:        "smoke",
		Provider:    corelliav1.ModelProvider_ANTHROPIC,
		ModelName:   "x",
		ModelApiKey: "y",
	})
	_, err := h.SpawnAgent(context.Background(), req)
	if err == nil {
		t.Fatal("want error, got nil")
	}
	if got := connect.CodeOf(err); got != connect.CodeInvalidArgument {
		t.Errorf("code: got %v, want InvalidArgument", got)
	}
	if !errors.Is(err, agents.ErrTemplateNotFound) {
		t.Errorf("want err to wrap ErrTemplateNotFound, got %v", err)
	}
}

// TestStopAgentInstance_BadID — the lifecycle handlers (Stop, Destroy,
// Get) return NotFound on a malformed instance ID, distinct from the
// SpawnAgent template-ID convention above. Documents the inconsistency
// rather than papering over it; if it's wrong, fix in a separate PR.
func TestStopAgentInstance_BadID(t *testing.T) {
	h := NewAgentsHandler(&fakeAgentsSvc{}, &fakeUserLookup{})
	req := connect.NewRequest(&corelliav1.StopAgentInstanceRequest{Id: "not-a-uuid"})
	_, err := h.StopAgentInstance(context.Background(), req)
	if err == nil {
		t.Fatal("want error, got nil")
	}
	if got := connect.CodeOf(err); got != connect.CodeNotFound {
		t.Errorf("code: got %v, want NotFound", got)
	}
	if !errors.Is(err, agents.ErrInstanceNotFound) {
		t.Errorf("want err to wrap ErrInstanceNotFound, got %v", err)
	}
}

// TestListAgentInstances_HappyPath — the read-side RPC succeeds when
// the user lookup succeeds and the service returns nil. Confirms the
// success path emits the correctly-shaped response (not just that
// the error path is wired).
func TestListAgentInstances_HappyPath(t *testing.T) {
	h := NewAgentsHandler(&fakeAgentsSvc{}, &fakeUserLookup{})
	resp, err := h.ListAgentInstances(context.Background(),
		connect.NewRequest(&corelliav1.ListAgentInstancesRequest{}))
	if err != nil {
		t.Fatalf("ListAgentInstances: %v", err)
	}
	if resp.Msg.GetInstances() != nil {
		t.Errorf("want nil instances slice (matches fake), got %v", resp.Msg.GetInstances())
	}
}

// M5 happy-path tests — one per representative RPC. Plan §4 Phase 5
// names UpdateAgentDeployConfig dry-run, BulkUpdateAgentDeployConfig
// partial success, and ResizeAgentReplicas as the load-bearing
// scenarios; the rest of the M5 surface is covered transitively by
// the sentinel-mapping table above (agentsErrToConnect is RPC-agnostic).

func TestUpdateAgentDeployConfig_DryRunHappyPath(t *testing.T) {
	svc := &fakeAgentsSvc{updateResult: &agents.UpdateResult{
		Kind:              deploy.UpdateLiveAppliedWithRestart,
		EstimatedDowntime: 5 * time.Second,
	}}
	h := NewAgentsHandler(svc, &fakeUserLookup{})
	req := connect.NewRequest(&corelliav1.UpdateAgentDeployConfigRequest{
		InstanceId: uuid.New().String(),
		DeployConfig: &corelliav1.DeployConfig{
			Region: "lhr", CpuKind: "shared", Cpus: 2, MemoryMb: 1024,
			RestartPolicy: "on-failure", LifecycleMode: "always-on",
			DesiredReplicas: 1, VolumeSizeGb: 1,
		},
		DryRun: true,
	})
	resp, err := h.UpdateAgentDeployConfig(context.Background(), req)
	if err != nil {
		t.Fatalf("UpdateAgentDeployConfig: %v", err)
	}
	got := resp.Msg.GetUpdateResult()
	if got.GetUpdateKind() != corelliav1.UpdateKind_UPDATE_KIND_LIVE_APPLIED_WITH_RESTART {
		t.Errorf("update_kind: got %v, want LIVE_APPLIED_WITH_RESTART", got.GetUpdateKind())
	}
	if got.GetEstimatedDowntimeSeconds() != 5 {
		t.Errorf("estimated_downtime_seconds: got %d, want 5", got.GetEstimatedDowntimeSeconds())
	}
	if got.GetWipesPersistentState() {
		t.Errorf("wipes_persistent_state: got true, want false (only true on REQUIRES_RESPAWN)")
	}
}

func TestUpdateAgentDeployConfig_RegionRespawnSetsWipesFlag(t *testing.T) {
	svc := &fakeAgentsSvc{updateResult: &agents.UpdateResult{
		Kind:              deploy.UpdateRequiresRespawn,
		EstimatedDowntime: 30 * time.Second,
	}}
	h := NewAgentsHandler(svc, &fakeUserLookup{})
	req := connect.NewRequest(&corelliav1.UpdateAgentDeployConfigRequest{
		InstanceId: uuid.New().String(),
		DeployConfig: &corelliav1.DeployConfig{
			Region: "ord", CpuKind: "shared", Cpus: 1, MemoryMb: 512,
			RestartPolicy: "on-failure", LifecycleMode: "always-on",
			DesiredReplicas: 1, VolumeSizeGb: 1,
		},
	})
	resp, err := h.UpdateAgentDeployConfig(context.Background(), req)
	if err != nil {
		t.Fatalf("UpdateAgentDeployConfig: %v", err)
	}
	got := resp.Msg.GetUpdateResult()
	if !got.GetWipesPersistentState() {
		t.Error("wipes_persistent_state: got false, want true on REQUIRES_RESPAWN (region change)")
	}
	if got.GetUpdateKind() != corelliav1.UpdateKind_UPDATE_KIND_REQUIRES_RESPAWN {
		t.Errorf("update_kind: got %v, want REQUIRES_RESPAWN", got.GetUpdateKind())
	}
}

func TestResizeAgentReplicas_HappyPath(t *testing.T) {
	svc := &fakeAgentsSvc{updateResult: &agents.UpdateResult{
		Kind: deploy.UpdateLiveApplied,
	}}
	h := NewAgentsHandler(svc, &fakeUserLookup{})
	req := connect.NewRequest(&corelliav1.ResizeAgentReplicasRequest{
		InstanceId:      uuid.New().String(),
		DesiredReplicas: 3,
	})
	resp, err := h.ResizeAgentReplicas(context.Background(), req)
	if err != nil {
		t.Fatalf("ResizeAgentReplicas: %v", err)
	}
	if resp.Msg.GetInstance() == nil {
		t.Error("instance: got nil, want non-nil (handler refetches via Get)")
	}
}

func TestResizeAgentVolume_NeedsRestartReflectsKind(t *testing.T) {
	svc := &fakeAgentsSvc{updateResult: &agents.UpdateResult{
		Kind: deploy.UpdateLiveAppliedWithRestart,
	}}
	h := NewAgentsHandler(svc, &fakeUserLookup{})
	req := connect.NewRequest(&corelliav1.ResizeAgentVolumeRequest{
		InstanceId:   uuid.New().String(),
		VolumeSizeGb: 5,
	})
	resp, err := h.ResizeAgentVolume(context.Background(), req)
	if err != nil {
		t.Fatalf("ResizeAgentVolume: %v", err)
	}
	if !resp.Msg.GetNeedsRestart() {
		t.Error("needs_restart: got false, want true on UpdateLiveAppliedWithRestart")
	}
}

func TestBulkUpdateAgentDeployConfig_PartialSuccess(t *testing.T) {
	failedID := uuid.New()
	successID := uuid.New()
	svc := &fakeAgentsSvc{bulkResults: []agents.BulkResult{
		{InstanceID: successID, Kind: deploy.UpdateLiveApplied},
		{InstanceID: failedID, Err: agents.ErrFlyAPI},
	}}
	h := NewAgentsHandler(svc, &fakeUserLookup{})
	req := connect.NewRequest(&corelliav1.BulkUpdateAgentDeployConfigRequest{
		InstanceIds: []string{successID.String(), failedID.String()},
		DeployConfigDelta: &corelliav1.BulkConfigDelta{
			LifecycleMode: "manual",
		},
	})
	resp, err := h.BulkUpdateAgentDeployConfig(context.Background(), req)
	if err != nil {
		t.Fatalf("BulkUpdateAgentDeployConfig: %v", err)
	}
	results := resp.Msg.GetResults()
	if len(results) != 2 {
		t.Fatalf("results len: got %d, want 2", len(results))
	}
	if results[0].GetInstanceId() != successID.String() {
		t.Errorf("results[0].instance_id: got %s, want %s", results[0].GetInstanceId(), successID)
	}
	if results[0].GetErrorMessage() != "" {
		t.Errorf("results[0].error_message: got %q, want empty (success row)", results[0].GetErrorMessage())
	}
	if results[1].GetInstanceId() != failedID.String() {
		t.Errorf("results[1].instance_id: got %s, want %s", results[1].GetInstanceId(), failedID)
	}
	if results[1].GetErrorMessage() == "" {
		t.Error("results[1].error_message: got empty, want non-empty (failure row carries redacted message)")
	}
}

func TestBulkUpdateAgentDeployConfig_BadInstanceID(t *testing.T) {
	h := NewAgentsHandler(&fakeAgentsSvc{}, &fakeUserLookup{})
	req := connect.NewRequest(&corelliav1.BulkUpdateAgentDeployConfigRequest{
		InstanceIds: []string{uuid.New().String(), "not-a-uuid"},
	})
	_, err := h.BulkUpdateAgentDeployConfig(context.Background(), req)
	if err == nil {
		t.Fatal("want error, got nil")
	}
	if got := connect.CodeOf(err); got != connect.CodeInvalidArgument {
		t.Errorf("code: got %v, want InvalidArgument", got)
	}
}

func TestListDeploymentRegions_HappyPath(t *testing.T) {
	svc := &fakeAgentsSvc{regions: []deploy.Region{
		{Code: "iad", Name: "Ashburn, Virginia (US)", Deprecated: false, RequiresPaidPlan: false},
		{Code: "lhr", Name: "London, United Kingdom", Deprecated: false, RequiresPaidPlan: false},
	}}
	h := NewAgentsHandler(svc, &fakeUserLookup{})
	resp, err := h.ListDeploymentRegions(context.Background(),
		connect.NewRequest(&corelliav1.ListDeploymentRegionsRequest{}))
	if err != nil {
		t.Fatalf("ListDeploymentRegions: %v", err)
	}
	if got := len(resp.Msg.GetRegions()); got != 2 {
		t.Errorf("regions len: got %d, want 2", got)
	}
	if resp.Msg.GetRegions()[0].GetCode() != "iad" {
		t.Errorf("regions[0].code: got %s, want iad", resp.Msg.GetRegions()[0].GetCode())
	}
}

// M-chat Phase 5 handler tests. The sentinel-to-Connect-code mapping
// table covers chat sentinels via the existing TestAgentsErrToConnect
// mechanism; these tests complement with the ChatWithAgent-specific
// paths: happy-path content forwarding and the bad-UUID fast path.

func TestChatWithAgent_SentinelMapping(t *testing.T) {
	cases := []struct {
		name     string
		chatErr  error
		wantCode connect.Code
	}{
		// plan §4 Phase 5 sentinel mapping table.
		{"ErrChatDisabled → FailedPrecondition", agents.ErrChatDisabled, connect.CodeFailedPrecondition},
		{"ErrChatUnreachable → Unavailable", agents.ErrChatUnreachable, connect.CodeUnavailable},
		{"ErrChatAuth → Internal (redacted)", agents.ErrChatAuth, connect.CodeInternal},
		// InstanceNotFound from the service layer surfaces as NotFound.
		{"ErrInstanceNotFound → NotFound", agents.ErrInstanceNotFound, connect.CodeNotFound},
	}
	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			h := NewAgentsHandler(
				&fakeAgentsSvc{chatErr: tc.chatErr},
				&fakeUserLookup{},
			)
			req := connect.NewRequest(&corelliav1.ChatWithAgentRequest{
				InstanceId: uuid.New().String(),
				SessionId:  uuid.New().String(),
				Message:    "hello",
			})
			_, err := h.ChatWithAgent(context.Background(), req)
			if err == nil {
				t.Fatal("want error, got nil")
			}
			if got := connect.CodeOf(err); got != tc.wantCode {
				t.Errorf("code: got %v, want %v (err=%v)", got, tc.wantCode, err)
			}
		})
	}
}

// TestChatWithAgent_HappyPath — content string is forwarded verbatim.
func TestChatWithAgent_HappyPath(t *testing.T) {
	want := "I am Hermes, your AI assistant."
	h := NewAgentsHandler(
		&fakeAgentsSvc{chatContent: want},
		&fakeUserLookup{},
	)
	req := connect.NewRequest(&corelliav1.ChatWithAgentRequest{
		InstanceId: uuid.New().String(),
		SessionId:  uuid.New().String(),
		Message:    "hello",
	})
	resp, err := h.ChatWithAgent(context.Background(), req)
	if err != nil {
		t.Fatalf("ChatWithAgent: %v", err)
	}
	if got := resp.Msg.GetContent(); got != want {
		t.Errorf("content: got %q, want %q", got, want)
	}
}

// TestChatWithAgent_BadInstanceID — malformed UUID returns NotFound
// before the service is called (same pattern as the other lifecycle handlers).
func TestChatWithAgent_BadInstanceID(t *testing.T) {
	h := NewAgentsHandler(&fakeAgentsSvc{}, &fakeUserLookup{})
	req := connect.NewRequest(&corelliav1.ChatWithAgentRequest{
		InstanceId: "not-a-uuid",
		SessionId:  uuid.New().String(),
		Message:    "hello",
	})
	_, err := h.ChatWithAgent(context.Background(), req)
	if err == nil {
		t.Fatal("want error, got nil")
	}
	if got := connect.CodeOf(err); got != connect.CodeNotFound {
		t.Errorf("code: got %v, want NotFound", got)
	}
	if !errors.Is(err, agents.ErrInstanceNotFound) {
		t.Errorf("want err to wrap ErrInstanceNotFound, got %v", err)
	}
}
