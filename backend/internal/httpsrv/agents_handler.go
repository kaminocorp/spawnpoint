package httpsrv

import (
	"context"
	"errors"
	"log/slog"

	"connectrpc.com/connect"
	"github.com/google/uuid"

	"github.com/hejijunhao/corellia/backend/internal/agents"
	corelliav1 "github.com/hejijunhao/corellia/backend/internal/gen/corellia/v1"
	"github.com/hejijunhao/corellia/backend/internal/users"
)

// userIdentityLookup is the slim users.Service surface the agents handler
// needs. Mirrors organizations.userLookup — declared here (not imported
// as *users.Service) so the seam between transport and identity stays
// narrow. One method, one DB query per RPC.
type userIdentityLookup interface {
	CallerIdentity(ctx context.Context) (userID, orgID uuid.UUID, err error)
}

// agentsService is the slim agents.Service surface this handler needs.
// Faked in agents_handler_test.go so the sentinel → Connect-code
// mapping (agentsErrToConnect, the public wire contract) can be
// tested without a DB or a deploy-target stack. *agents.Service
// satisfies it structurally.
type agentsService interface {
	ListAgentTemplates(ctx context.Context) ([]*corelliav1.AgentTemplate, error)
	Spawn(ctx context.Context, in agents.SpawnInput) (*corelliav1.AgentInstance, error)
	SpawnN(ctx context.Context, in agents.SpawnNInput) ([]*corelliav1.AgentInstance, error)
	List(ctx context.Context, orgID uuid.UUID) ([]*corelliav1.AgentInstance, error)
	Get(ctx context.Context, instanceID, orgID uuid.UUID) (*corelliav1.AgentInstance, error)
	Stop(ctx context.Context, instanceID, orgID uuid.UUID) (*corelliav1.AgentInstance, error)
	Destroy(ctx context.Context, instanceID, orgID uuid.UUID) (*corelliav1.AgentInstance, error)
}

type AgentsHandler struct {
	svc   agentsService
	users userIdentityLookup
}

func NewAgentsHandler(svc agentsService, users userIdentityLookup) *AgentsHandler {
	return &AgentsHandler{svc: svc, users: users}
}

func (h *AgentsHandler) ListAgentTemplates(
	ctx context.Context,
	_ *connect.Request[corelliav1.ListAgentTemplatesRequest],
) (*connect.Response[corelliav1.ListAgentTemplatesResponse], error) {
	templates, err := h.svc.ListAgentTemplates(ctx)
	if err != nil {
		return nil, agentsErrToConnect(err)
	}
	return connect.NewResponse(&corelliav1.ListAgentTemplatesResponse{Templates: templates}), nil
}

func (h *AgentsHandler) SpawnAgent(
	ctx context.Context,
	req *connect.Request[corelliav1.SpawnAgentRequest],
) (*connect.Response[corelliav1.SpawnAgentResponse], error) {
	userID, orgID, err := h.users.CallerIdentity(ctx)
	if err != nil {
		return nil, agentsErrToConnect(err)
	}
	templateID, err := uuid.Parse(req.Msg.GetTemplateId())
	if err != nil {
		return nil, connect.NewError(connect.CodeInvalidArgument, agents.ErrTemplateNotFound)
	}
	instance, err := h.svc.Spawn(ctx, agents.SpawnInput{
		TemplateID:  templateID,
		OrgID:       orgID,
		OwnerUserID: userID,
		Name:        req.Msg.GetName(),
		Provider:    agents.ProviderFromProto(req.Msg.GetProvider()),
		ModelName:   req.Msg.GetModelName(),
		APIKey:      req.Msg.GetModelApiKey(),
	})
	if err != nil {
		return nil, agentsErrToConnect(err)
	}
	return connect.NewResponse(&corelliav1.SpawnAgentResponse{Instance: instance}), nil
}

func (h *AgentsHandler) SpawnNAgents(
	ctx context.Context,
	req *connect.Request[corelliav1.SpawnNAgentsRequest],
) (*connect.Response[corelliav1.SpawnNAgentsResponse], error) {
	userID, orgID, err := h.users.CallerIdentity(ctx)
	if err != nil {
		return nil, agentsErrToConnect(err)
	}
	templateID, err := uuid.Parse(req.Msg.GetTemplateId())
	if err != nil {
		return nil, connect.NewError(connect.CodeInvalidArgument, agents.ErrTemplateNotFound)
	}
	instances, err := h.svc.SpawnN(ctx, agents.SpawnNInput{
		TemplateID:  templateID,
		OrgID:       orgID,
		OwnerUserID: userID,
		NamePrefix:  req.Msg.GetNamePrefix(),
		Count:       int(req.Msg.GetCount()),
		Provider:    agents.ProviderFromProto(req.Msg.GetProvider()),
		ModelName:   req.Msg.GetModelName(),
		APIKey:      req.Msg.GetModelApiKey(),
	})
	if err != nil {
		return nil, agentsErrToConnect(err)
	}
	return connect.NewResponse(&corelliav1.SpawnNAgentsResponse{Instances: instances}), nil
}

func (h *AgentsHandler) ListAgentInstances(
	ctx context.Context,
	_ *connect.Request[corelliav1.ListAgentInstancesRequest],
) (*connect.Response[corelliav1.ListAgentInstancesResponse], error) {
	_, orgID, err := h.users.CallerIdentity(ctx)
	if err != nil {
		return nil, agentsErrToConnect(err)
	}
	instances, err := h.svc.List(ctx, orgID)
	if err != nil {
		return nil, agentsErrToConnect(err)
	}
	return connect.NewResponse(&corelliav1.ListAgentInstancesResponse{Instances: instances}), nil
}

func (h *AgentsHandler) GetAgentInstance(
	ctx context.Context,
	req *connect.Request[corelliav1.GetAgentInstanceRequest],
) (*connect.Response[corelliav1.GetAgentInstanceResponse], error) {
	_, orgID, err := h.users.CallerIdentity(ctx)
	if err != nil {
		return nil, agentsErrToConnect(err)
	}
	instanceID, err := uuid.Parse(req.Msg.GetId())
	if err != nil {
		return nil, connect.NewError(connect.CodeNotFound, agents.ErrInstanceNotFound)
	}
	instance, err := h.svc.Get(ctx, instanceID, orgID)
	if err != nil {
		return nil, agentsErrToConnect(err)
	}
	return connect.NewResponse(&corelliav1.GetAgentInstanceResponse{Instance: instance}), nil
}

func (h *AgentsHandler) StopAgentInstance(
	ctx context.Context,
	req *connect.Request[corelliav1.StopAgentInstanceRequest],
) (*connect.Response[corelliav1.StopAgentInstanceResponse], error) {
	_, orgID, err := h.users.CallerIdentity(ctx)
	if err != nil {
		return nil, agentsErrToConnect(err)
	}
	instanceID, err := uuid.Parse(req.Msg.GetId())
	if err != nil {
		return nil, connect.NewError(connect.CodeNotFound, agents.ErrInstanceNotFound)
	}
	instance, err := h.svc.Stop(ctx, instanceID, orgID)
	if err != nil {
		return nil, agentsErrToConnect(err)
	}
	return connect.NewResponse(&corelliav1.StopAgentInstanceResponse{Instance: instance}), nil
}

func (h *AgentsHandler) DestroyAgentInstance(
	ctx context.Context,
	req *connect.Request[corelliav1.DestroyAgentInstanceRequest],
) (*connect.Response[corelliav1.DestroyAgentInstanceResponse], error) {
	_, orgID, err := h.users.CallerIdentity(ctx)
	if err != nil {
		return nil, agentsErrToConnect(err)
	}
	instanceID, err := uuid.Parse(req.Msg.GetId())
	if err != nil {
		return nil, connect.NewError(connect.CodeNotFound, agents.ErrInstanceNotFound)
	}
	instance, err := h.svc.Destroy(ctx, instanceID, orgID)
	if err != nil {
		return nil, agentsErrToConnect(err)
	}
	return connect.NewResponse(&corelliav1.DestroyAgentInstanceResponse{Instance: instance}), nil
}

// agentsErrToConnect mirrors users_handler.go's toConnectErr and
// organizations_handler.go's orgErrToConnect: sentinel errors flow through
// with their messages (part of the public contract — FE branches on the
// Connect code), unknowns are logged server-side and replaced with a generic
// "internal error" on the wire so pgx / driver internals can't leak.
//
// Sentinel mapping per spawn-flow plan decision 25:
//   - validation sentinels → InvalidArgument
//   - not-found sentinels  → NotFound
//   - spawn-count overflow → FailedPrecondition (caller asked for more
//     than the v1 cap; not a malformed argument, just a v1 product limit)
//   - upstream/resolver    → Unavailable (already redacted by the service)
//   - users sentinels      → passthrough (Unauthenticated / PermissionDenied)
func agentsErrToConnect(err error) error {
	switch {
	case errors.Is(err, users.ErrUnauthenticated):
		return connect.NewError(connect.CodeUnauthenticated, err)
	case errors.Is(err, users.ErrNotProvisioned):
		return connect.NewError(connect.CodePermissionDenied, err)
	case errors.Is(err, agents.ErrInvalidName),
		errors.Is(err, agents.ErrInvalidProvider),
		errors.Is(err, agents.ErrInvalidModel),
		errors.Is(err, agents.ErrMissingAPIKey):
		return connect.NewError(connect.CodeInvalidArgument, err)
	case errors.Is(err, agents.ErrSpawnLimit):
		return connect.NewError(connect.CodeFailedPrecondition, err)
	case errors.Is(err, agents.ErrTemplateNotFound),
		errors.Is(err, agents.ErrInstanceNotFound),
		errors.Is(err, agents.ErrNotFound):
		return connect.NewError(connect.CodeNotFound, err)
	case errors.Is(err, agents.ErrFlyAPI),
		errors.Is(err, agents.ErrTargetUnavailable):
		return connect.NewError(connect.CodeUnavailable, err)
	default:
		slog.Error("agents handler: unexpected error", "err", err)
		return connect.NewError(connect.CodeInternal, errors.New("internal error"))
	}
}
