package httpsrv

import (
	"context"
	"errors"
	"log/slog"
	"time"

	"connectrpc.com/connect"
	"github.com/google/uuid"

	"github.com/hejijunhao/corellia/backend/internal/agents"
	"github.com/hejijunhao/corellia/backend/internal/deploy"
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
	RestartInstance(ctx context.Context, actorUserID, instanceID, orgID uuid.UUID) (*corelliav1.AgentInstance, error)

	// M5 fleet-control surface (plan §4 Phase 5). Keeps the seam
	// shape consistent with M2/M4: domain types in / proto types out
	// where the handler glue is trivial; thin wrappers where the
	// service method already returns a domain type the handler must
	// re-shape (UpdateResult, BulkResult).
	ListRegions(ctx context.Context) ([]deploy.Region, error)
	CheckPlacement(ctx context.Context, cfg deploy.DeployConfig) (deploy.PlacementResult, error)
	UpdateDeployConfig(ctx context.Context, instanceID, orgID uuid.UUID, cfg deploy.DeployConfig, dryRun bool) (*agents.UpdateResult, error)
	StartInstance(ctx context.Context, instanceID, orgID uuid.UUID) (*corelliav1.AgentInstance, error)
	ResizeReplicas(ctx context.Context, instanceID, orgID uuid.UUID, desired int) (*agents.UpdateResult, error)
	ResizeVolume(ctx context.Context, instanceID, orgID uuid.UUID, newSizeGB int) (*agents.UpdateResult, error)
	BulkUpdateDeployConfig(ctx context.Context, instanceIDs []uuid.UUID, orgID uuid.UUID, delta agents.BulkConfigDelta, dryRun bool) ([]agents.BulkResult, error)

	// M-chat Phase 5 — proxied chat turn (plan decision 11).
	ChatWithAgent(ctx context.Context, instanceID, orgID uuid.UUID, sessionID, message string) (string, error)
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
		TemplateID:   templateID,
		OrgID:        orgID,
		OwnerUserID:  userID,
		Name:         req.Msg.GetName(),
		Provider:     agents.ProviderFromProto(req.Msg.GetProvider()),
		ModelName:    req.Msg.GetModelName(),
		APIKey:       req.Msg.GetModelApiKey(),
		DeployConfig: deployConfigFromProto(req.Msg.GetDeployConfig()),
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
		TemplateID:   templateID,
		OrgID:        orgID,
		OwnerUserID:  userID,
		NamePrefix:   req.Msg.GetNamePrefix(),
		Count:        int(req.Msg.GetCount()),
		Provider:     agents.ProviderFromProto(req.Msg.GetProvider()),
		ModelName:    req.Msg.GetModelName(),
		APIKey:       req.Msg.GetModelApiKey(),
		DeployConfig: deployConfigFromProto(req.Msg.GetDeployConfig()),
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

// RestartAgentInstance — v1.5 Pillar B Phase 7. The actor is captured for
// the audit row written by the service-layer Restart path, so this method
// reads userID alongside orgID (Stop / Destroy don't need it because their
// audit chain runs through tool_grant_audit's instance-grants writes).
func (h *AgentsHandler) RestartAgentInstance(
	ctx context.Context,
	req *connect.Request[corelliav1.RestartAgentInstanceRequest],
) (*connect.Response[corelliav1.RestartAgentInstanceResponse], error) {
	userID, orgID, err := h.users.CallerIdentity(ctx)
	if err != nil {
		return nil, agentsErrToConnect(err)
	}
	instanceID, err := uuid.Parse(req.Msg.GetId())
	if err != nil {
		return nil, connect.NewError(connect.CodeNotFound, agents.ErrInstanceNotFound)
	}
	instance, err := h.svc.RestartInstance(ctx, userID, instanceID, orgID)
	if err != nil {
		return nil, agentsErrToConnect(err)
	}
	return connect.NewResponse(&corelliav1.RestartAgentInstanceResponse{Instance: instance}), nil
}

// M5 fleet-control handlers. Each <30 LOC per blueprint §11.9; no
// business logic here, only shape translation.

func (h *AgentsHandler) ListDeploymentRegions(
	ctx context.Context,
	_ *connect.Request[corelliav1.ListDeploymentRegionsRequest],
) (*connect.Response[corelliav1.ListDeploymentRegionsResponse], error) {
	if _, _, err := h.users.CallerIdentity(ctx); err != nil {
		return nil, agentsErrToConnect(err)
	}
	regions, err := h.svc.ListRegions(ctx)
	if err != nil {
		return nil, agentsErrToConnect(err)
	}
	out := make([]*corelliav1.Region, 0, len(regions))
	for _, r := range regions {
		out = append(out, &corelliav1.Region{
			Code:             r.Code,
			Name:             r.Name,
			Deprecated:       r.Deprecated,
			RequiresPaidPlan: r.RequiresPaidPlan,
		})
	}
	return connect.NewResponse(&corelliav1.ListDeploymentRegionsResponse{Regions: out}), nil
}

func (h *AgentsHandler) CheckDeploymentPlacement(
	ctx context.Context,
	req *connect.Request[corelliav1.CheckDeploymentPlacementRequest],
) (*connect.Response[corelliav1.CheckDeploymentPlacementResponse], error) {
	if _, _, err := h.users.CallerIdentity(ctx); err != nil {
		return nil, agentsErrToConnect(err)
	}
	result, err := h.svc.CheckPlacement(ctx, deployConfigFromProto(req.Msg.GetDeployConfig()))
	if err != nil {
		return nil, agentsErrToConnect(err)
	}
	return connect.NewResponse(&corelliav1.CheckDeploymentPlacementResponse{
		PlacementResult: &corelliav1.PlacementResult{
			Available:        result.Available,
			Reason:           result.Reason,
			AlternateRegions: result.AlternateRegions,
		},
	}), nil
}

func (h *AgentsHandler) UpdateAgentDeployConfig(
	ctx context.Context,
	req *connect.Request[corelliav1.UpdateAgentDeployConfigRequest],
) (*connect.Response[corelliav1.UpdateAgentDeployConfigResponse], error) {
	_, orgID, err := h.users.CallerIdentity(ctx)
	if err != nil {
		return nil, agentsErrToConnect(err)
	}
	instanceID, err := uuid.Parse(req.Msg.GetInstanceId())
	if err != nil {
		return nil, connect.NewError(connect.CodeNotFound, agents.ErrInstanceNotFound)
	}
	result, err := h.svc.UpdateDeployConfig(ctx, instanceID, orgID,
		deployConfigFromProto(req.Msg.GetDeployConfig()), req.Msg.GetDryRun())
	if err != nil {
		return nil, agentsErrToConnect(err)
	}
	return connect.NewResponse(&corelliav1.UpdateAgentDeployConfigResponse{
		UpdateResult: updateResultToProto(result),
	}), nil
}

func (h *AgentsHandler) StartAgentInstance(
	ctx context.Context,
	req *connect.Request[corelliav1.StartAgentInstanceRequest],
) (*connect.Response[corelliav1.StartAgentInstanceResponse], error) {
	_, orgID, err := h.users.CallerIdentity(ctx)
	if err != nil {
		return nil, agentsErrToConnect(err)
	}
	instanceID, err := uuid.Parse(req.Msg.GetInstanceId())
	if err != nil {
		return nil, connect.NewError(connect.CodeNotFound, agents.ErrInstanceNotFound)
	}
	instance, err := h.svc.StartInstance(ctx, instanceID, orgID)
	if err != nil {
		return nil, agentsErrToConnect(err)
	}
	return connect.NewResponse(&corelliav1.StartAgentInstanceResponse{Instance: instance}), nil
}

func (h *AgentsHandler) ResizeAgentReplicas(
	ctx context.Context,
	req *connect.Request[corelliav1.ResizeAgentReplicasRequest],
) (*connect.Response[corelliav1.ResizeAgentReplicasResponse], error) {
	_, orgID, err := h.users.CallerIdentity(ctx)
	if err != nil {
		return nil, agentsErrToConnect(err)
	}
	instanceID, err := uuid.Parse(req.Msg.GetInstanceId())
	if err != nil {
		return nil, connect.NewError(connect.CodeNotFound, agents.ErrInstanceNotFound)
	}
	if _, err := h.svc.ResizeReplicas(ctx, instanceID, orgID, int(req.Msg.GetDesiredReplicas())); err != nil {
		return nil, agentsErrToConnect(err)
	}
	instance, err := h.svc.Get(ctx, instanceID, orgID)
	if err != nil {
		return nil, agentsErrToConnect(err)
	}
	return connect.NewResponse(&corelliav1.ResizeAgentReplicasResponse{Instance: instance}), nil
}

func (h *AgentsHandler) ResizeAgentVolume(
	ctx context.Context,
	req *connect.Request[corelliav1.ResizeAgentVolumeRequest],
) (*connect.Response[corelliav1.ResizeAgentVolumeResponse], error) {
	_, orgID, err := h.users.CallerIdentity(ctx)
	if err != nil {
		return nil, agentsErrToConnect(err)
	}
	instanceID, err := uuid.Parse(req.Msg.GetInstanceId())
	if err != nil {
		return nil, connect.NewError(connect.CodeNotFound, agents.ErrInstanceNotFound)
	}
	result, err := h.svc.ResizeVolume(ctx, instanceID, orgID, int(req.Msg.GetVolumeSizeGb()))
	if err != nil {
		return nil, agentsErrToConnect(err)
	}
	instance, err := h.svc.Get(ctx, instanceID, orgID)
	if err != nil {
		return nil, agentsErrToConnect(err)
	}
	return connect.NewResponse(&corelliav1.ResizeAgentVolumeResponse{
		Instance:     instance,
		NeedsRestart: result.Kind == deploy.UpdateLiveAppliedWithRestart,
	}), nil
}

func (h *AgentsHandler) BulkUpdateAgentDeployConfig(
	ctx context.Context,
	req *connect.Request[corelliav1.BulkUpdateAgentDeployConfigRequest],
) (*connect.Response[corelliav1.BulkUpdateAgentDeployConfigResponse], error) {
	_, orgID, err := h.users.CallerIdentity(ctx)
	if err != nil {
		return nil, agentsErrToConnect(err)
	}
	ids := make([]uuid.UUID, 0, len(req.Msg.GetInstanceIds()))
	for _, raw := range req.Msg.GetInstanceIds() {
		id, parseErr := uuid.Parse(raw)
		if parseErr != nil {
			return nil, connect.NewError(connect.CodeInvalidArgument, agents.ErrInstanceNotFound)
		}
		ids = append(ids, id)
	}
	results, err := h.svc.BulkUpdateDeployConfig(ctx, ids, orgID,
		bulkDeltaFromProto(req.Msg.GetDeployConfigDelta()), req.Msg.GetDryRun())
	if err != nil {
		return nil, agentsErrToConnect(err)
	}
	out := make([]*corelliav1.BulkResult, 0, len(results))
	for _, r := range results {
		out = append(out, bulkResultToProto(r))
	}
	return connect.NewResponse(&corelliav1.BulkUpdateAgentDeployConfigResponse{Results: out}), nil
}

// ChatWithAgent proxies a single chat turn to the agent's sidecar.
// Handler stays <30 LOC per blueprint §11.9; all logic lives in the
// agents domain method (chat.go).
func (h *AgentsHandler) ChatWithAgent(
	ctx context.Context,
	req *connect.Request[corelliav1.ChatWithAgentRequest],
) (*connect.Response[corelliav1.ChatWithAgentResponse], error) {
	_, orgID, err := h.users.CallerIdentity(ctx)
	if err != nil {
		return nil, agentsErrToConnect(err)
	}
	instanceID, err := uuid.Parse(req.Msg.GetInstanceId())
	if err != nil {
		return nil, connect.NewError(connect.CodeNotFound, agents.ErrInstanceNotFound)
	}
	content, err := h.svc.ChatWithAgent(ctx, instanceID, orgID,
		req.Msg.GetSessionId(), req.Msg.GetMessage())
	if err != nil {
		return nil, agentsErrToConnect(err)
	}
	return connect.NewResponse(&corelliav1.ChatWithAgentResponse{Content: content}), nil
}

// deployConfigFromProto translates the wire DeployConfig to the domain
// shape. Nil-safe: a nil proto returns the zero domain config (which
// the service's WithDefaults canonicalises). Empty fields stay empty so
// WithDefaults picks the right defaults; partial overrides from the FE
// flow naturally.
func deployConfigFromProto(p *corelliav1.DeployConfig) deploy.DeployConfig {
	if p == nil {
		return deploy.DeployConfig{}
	}
	return deploy.DeployConfig{
		Region:            p.GetRegion(),
		CPUKind:           p.GetCpuKind(),
		CPUs:              int(p.GetCpus()),
		MemoryMB:          int(p.GetMemoryMb()),
		RestartPolicy:     p.GetRestartPolicy(),
		RestartMaxRetries: int(p.GetRestartMaxRetries()),
		LifecycleMode:     p.GetLifecycleMode(),
		DesiredReplicas:   int(p.GetDesiredReplicas()),
		VolumeSizeGB:      int(p.GetVolumeSizeGb()),
		ChatEnabled:       p.GetChatEnabled(),
	}
}

func bulkDeltaFromProto(p *corelliav1.BulkConfigDelta) agents.BulkConfigDelta {
	if p == nil {
		return agents.BulkConfigDelta{}
	}
	return agents.BulkConfigDelta{
		Region:            p.GetRegion(),
		CPUKind:           p.GetCpuKind(),
		CPUs:              int(p.GetCpus()),
		MemoryMB:          int(p.GetMemoryMb()),
		RestartPolicy:     p.GetRestartPolicy(),
		RestartMaxRetries: int(p.GetRestartMaxRetries()),
		LifecycleMode:     p.GetLifecycleMode(),
		DesiredReplicas:   int(p.GetDesiredReplicas()),
	}
}

func updateResultToProto(r *agents.UpdateResult) *corelliav1.UpdateResult {
	if r == nil {
		return nil
	}
	return &corelliav1.UpdateResult{
		UpdateKind:               updateKindToProto(r.Kind),
		EstimatedDowntimeSeconds: int32(r.EstimatedDowntime / time.Second),
		WipesPersistentState:     r.Kind == deploy.UpdateRequiresRespawn,
	}
}

func bulkResultToProto(r agents.BulkResult) *corelliav1.BulkResult {
	out := &corelliav1.BulkResult{
		InstanceId: r.InstanceID.String(),
		UpdateKind: updateKindToProto(r.Kind),
	}
	if r.Err != nil {
		// Per-row errors are part of the wire contract — the FE branches
		// on a non-empty error_message to render the failed-row state.
		// The error is already redacted by the service layer (errors.Is
		// against the agents/deploy sentinel set); free-form pgx /
		// driver internals never reach this surface.
		out.ErrorMessage = r.Err.Error()
	}
	return out
}

func updateKindToProto(k deploy.UpdateKind) corelliav1.UpdateKind {
	switch k {
	case deploy.UpdateLiveApplied:
		return corelliav1.UpdateKind_UPDATE_KIND_LIVE_APPLIED
	case deploy.UpdateLiveAppliedWithRestart:
		return corelliav1.UpdateKind_UPDATE_KIND_LIVE_APPLIED_WITH_RESTART
	case deploy.UpdateRequiresRespawn:
		return corelliav1.UpdateKind_UPDATE_KIND_REQUIRES_RESPAWN
	}
	return corelliav1.UpdateKind_UPDATE_KIND_UNSPECIFIED
}

// agentsErrToConnect mirrors users_handler.go's toConnectErr and
// organizations_handler.go's orgErrToConnect: sentinel errors flow through
// with their messages (part of the public contract — FE branches on the
// Connect code), unknowns are logged server-side and replaced with a generic
// "internal error" on the wire so pgx / driver internals can't leak.
//
// Sentinel mapping per spawn-flow plan decision 25 + M5 plan §4 Phase 5:
//   - validation sentinels         → InvalidArgument
//   - not-found sentinels          → NotFound
//   - spawn-count overflow         → FailedPrecondition (caller asked for more
//     than the v1 cap; not a malformed argument, just a v1 product limit)
//   - placement unavailable        → FailedPrecondition (recoverable by
//     editing the request — different region or smaller size)
//   - lifecycle deferred to v2     → Unimplemented
//   - machine lease contention     → Aborted (transient; retryable)
//   - upstream/resolver / volume   → Unavailable (already redacted by the service)
//   - bulk-size cap                → InvalidArgument
//   - users sentinels              → passthrough (Unauthenticated / PermissionDenied)
func agentsErrToConnect(err error) error {
	switch {
	case errors.Is(err, users.ErrUnauthenticated):
		return connect.NewError(connect.CodeUnauthenticated, err)
	case errors.Is(err, users.ErrNotProvisioned):
		return connect.NewError(connect.CodePermissionDenied, err)
	case errors.Is(err, agents.ErrInvalidName),
		errors.Is(err, agents.ErrInvalidProvider),
		errors.Is(err, agents.ErrInvalidModel),
		errors.Is(err, agents.ErrMissingAPIKey),
		errors.Is(err, agents.ErrBulkLimit),
		errors.Is(err, deploy.ErrInvalidSize),
		errors.Is(err, deploy.ErrInvalidVolumeSize),
		errors.Is(err, deploy.ErrInvalidRegion),
		errors.Is(err, deploy.ErrVolumeShrink):
		return connect.NewError(connect.CodeInvalidArgument, err)
	case errors.Is(err, agents.ErrSpawnLimit),
		errors.Is(err, deploy.ErrPlacementUnavailable):
		return connect.NewError(connect.CodeFailedPrecondition, err)
	case errors.Is(err, deploy.ErrLifecycleUnsupported):
		return connect.NewError(connect.CodeUnimplemented, err)
	case errors.Is(err, deploy.ErrMachineBusy):
		return connect.NewError(connect.CodeAborted, err)
	case errors.Is(err, agents.ErrTemplateNotFound),
		errors.Is(err, agents.ErrInstanceNotFound),
		errors.Is(err, agents.ErrNotFound):
		return connect.NewError(connect.CodeNotFound, err)
	case errors.Is(err, agents.ErrFlyAPI),
		errors.Is(err, agents.ErrTargetUnavailable),
		errors.Is(err, deploy.ErrVolumeProvisionFailed):
		return connect.NewError(connect.CodeUnavailable, err)

	// M-chat Phase 5 sentinel mapping (plan §4 Phase 5 + chat.go doc-comment):
	//   ErrChatDisabled    → FailedPrecondition (operator must enable chat first)
	//   ErrChatUnreachable → Unavailable        (sidecar down / network error)
	//   ErrChatAuth        → Internal           (Corellia-side token drift; not a user error)
	case errors.Is(err, agents.ErrChatDisabled):
		return connect.NewError(connect.CodeFailedPrecondition, err)
	case errors.Is(err, agents.ErrChatUnreachable):
		return connect.NewError(connect.CodeUnavailable, err)
	case errors.Is(err, agents.ErrChatAuth):
		slog.Error("agents handler: chat auth inconsistency", "err", err)
		return connect.NewError(connect.CodeInternal, errors.New("internal error"))

	default:
		slog.Error("agents handler: unexpected error", "err", err)
		return connect.NewError(connect.CodeInternal, errors.New("internal error"))
	}
}
