package httpsrv

import (
	"context"
	"errors"
	"testing"

	"connectrpc.com/connect"
	"github.com/google/uuid"

	"github.com/hejijunhao/corellia/backend/internal/agents"
	corelliav1 "github.com/hejijunhao/corellia/backend/internal/gen/corellia/v1"
	"github.com/hejijunhao/corellia/backend/internal/users"
)

// fakeAgentsSvc satisfies agentsService. A single err field drives
// every method — the agentsErrToConnect mapping under test is
// method-agnostic, so one RPC entry point exercises all sentinels.
type fakeAgentsSvc struct {
	err error
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
// each agents/users sentinel → Connect code mapping. SpawnAgent is the
// vehicle since it exercises both the user-identity error path and the
// service error path; the agentsErrToConnect mapping is method-agnostic
// so any RPC would work.
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

		// policy-cap → FailedPrecondition (caller asked for more than the
		// v1 limit; the request is well-formed, the cap is the rejection).
		{"agents.ErrSpawnLimit → FailedPrecondition", nil, agents.ErrSpawnLimit, connect.CodeFailedPrecondition},

		// not-found sentinels → NotFound.
		{"agents.ErrTemplateNotFound → NotFound", nil, agents.ErrTemplateNotFound, connect.CodeNotFound},
		{"agents.ErrInstanceNotFound → NotFound", nil, agents.ErrInstanceNotFound, connect.CodeNotFound},
		{"agents.ErrNotFound (M2 holdover) → NotFound", nil, agents.ErrNotFound, connect.CodeNotFound},

		// upstream/resolver — already redacted by the service layer.
		{"agents.ErrFlyAPI → Unavailable", nil, agents.ErrFlyAPI, connect.CodeUnavailable},
		{"agents.ErrTargetUnavailable → Unavailable", nil, agents.ErrTargetUnavailable, connect.CodeUnavailable},

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
