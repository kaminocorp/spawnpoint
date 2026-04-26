package httpsrv

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"log/slog"

	"connectrpc.com/connect"
	"github.com/google/uuid"
	"github.com/jackc/pgx/v5/pgtype"
	"google.golang.org/protobuf/types/known/structpb"

	"github.com/hejijunhao/corellia/backend/internal/db"
	corelliav1 "github.com/hejijunhao/corellia/backend/internal/gen/corellia/v1"
	"github.com/hejijunhao/corellia/backend/internal/tools"
	"github.com/hejijunhao/corellia/backend/internal/users"
)

// orgRoleAdmin is the public.users.role string the SetOrgToolCuration write
// gate accepts. Mirrors the value seeded by users.Service first-login
// provisioning ("admin") — we don't currently have an enum for roles
// (v1.5 has one), so this stays a literal until the RBAC pillar formalises
// the role set.
const orgRoleAdmin = "admin"

// userIdentityWithRole is the slim users.Service surface this handler needs.
// Mirrors the agents handler's userIdentityLookup pattern (one-method
// dependency declared at the seam) so the role check can be faked in tests
// without standing up the whole users service.
type userIdentityWithRole interface {
	CallerIdentityWithRole(ctx context.Context) (userID, orgID uuid.UUID, role string, err error)
}

// toolsService is the slim tools.Service surface the operator-facing RPCs
// depend on. Faked in tools_handler_test.go so the sentinel → Connect-code
// mapping (toolsErrToConnect, the public wire contract) can be tested
// without a DB or transactor stack. *tools.Service satisfies it
// structurally.
type toolsService interface {
	ListAvailableForOrg(ctx context.Context, orgID, harnessAdapterID uuid.UUID, adapterVersion string) ([]db.ListOrgToolCurationRow, error)
	SetOrgCuration(ctx context.Context, orgID, toolID, curatedBy uuid.UUID, enabled bool) (db.ListOrgToolCurationRow, error)
	GetInstanceGrants(ctx context.Context, instanceID, orgID uuid.UUID) ([]db.ListInstanceToolGrantsRow, error)
	SetInstanceGrants(ctx context.Context, instanceID, orgID, grantedBy uuid.UUID, grants []tools.GrantInput) ([]db.ListInstanceToolGrantsRow, int64, error)
}

// ToolsHandler implements corelliav1connect.ToolServiceHandler for the five
// operator-facing RPCs added in Phase 3 (ListTools, GetOrgToolCuration,
// SetOrgToolCuration, GetInstanceToolGrants, SetInstanceToolGrants).
//
// GetToolManifest is the sixth RPC on the proto service but is served by
// the bearer-token plain handler at the same path (mounted ahead of this
// handler in server.go). The implementation here returns Unimplemented so
// the ToolServiceHandler interface is satisfied; the route is never hit
// because chi's exact-Post match wins over the prefix Mount.
type ToolsHandler struct {
	svc   toolsService
	users userIdentityWithRole
}

func NewToolsHandler(svc toolsService, users userIdentityWithRole) *ToolsHandler {
	return &ToolsHandler{svc: svc, users: users}
}

// GetToolManifest is intentionally Unimplemented here — the bearer-token
// plain handler in tool_manifest.go owns the wire path. See server.go for
// mount ordering.
func (h *ToolsHandler) GetToolManifest(
	_ context.Context,
	_ *connect.Request[corelliav1.GetToolManifestRequest],
) (*connect.Response[corelliav1.GetToolManifestResponse], error) {
	return nil, connect.NewError(connect.CodeUnimplemented, errors.New("GetToolManifest is served by the bearer-token endpoint"))
}

func (h *ToolsHandler) ListTools(
	ctx context.Context,
	req *connect.Request[corelliav1.ListToolsRequest],
) (*connect.Response[corelliav1.ListToolsResponse], error) {
	_, orgID, _, err := h.users.CallerIdentityWithRole(ctx)
	if err != nil {
		return nil, toolsErrToConnect(err)
	}
	harnessID, err := uuid.Parse(req.Msg.GetHarnessAdapterId())
	if err != nil {
		return nil, connect.NewError(connect.CodeInvalidArgument, errors.New("invalid harness_adapter_id"))
	}
	rows, err := h.svc.ListAvailableForOrg(ctx, orgID, harnessID, req.Msg.GetAdapterVersion())
	if err != nil {
		return nil, toolsErrToConnect(err)
	}
	return connect.NewResponse(&corelliav1.ListToolsResponse{Tools: toolRowsToProto(rows)}), nil
}

func (h *ToolsHandler) GetOrgToolCuration(
	ctx context.Context,
	req *connect.Request[corelliav1.GetOrgToolCurationRequest],
) (*connect.Response[corelliav1.GetOrgToolCurationResponse], error) {
	_, orgID, _, err := h.users.CallerIdentityWithRole(ctx)
	if err != nil {
		return nil, toolsErrToConnect(err)
	}
	harnessID, err := uuid.Parse(req.Msg.GetHarnessAdapterId())
	if err != nil {
		return nil, connect.NewError(connect.CodeInvalidArgument, errors.New("invalid harness_adapter_id"))
	}
	rows, err := h.svc.ListAvailableForOrg(ctx, orgID, harnessID, req.Msg.GetAdapterVersion())
	if err != nil {
		return nil, toolsErrToConnect(err)
	}
	return connect.NewResponse(&corelliav1.GetOrgToolCurationResponse{Tools: toolRowsToProto(rows)}), nil
}

func (h *ToolsHandler) SetOrgToolCuration(
	ctx context.Context,
	req *connect.Request[corelliav1.SetOrgToolCurationRequest],
) (*connect.Response[corelliav1.SetOrgToolCurationResponse], error) {
	userID, orgID, role, err := h.users.CallerIdentityWithRole(ctx)
	if err != nil {
		return nil, toolsErrToConnect(err)
	}
	if role != orgRoleAdmin {
		return nil, connect.NewError(connect.CodePermissionDenied, tools.ErrForbidden)
	}
	toolID, err := uuid.Parse(req.Msg.GetToolId())
	if err != nil {
		return nil, connect.NewError(connect.CodeNotFound, tools.ErrToolNotFound)
	}
	row, err := h.svc.SetOrgCuration(ctx, orgID, toolID, userID, req.Msg.GetEnabled())
	if err != nil {
		return nil, toolsErrToConnect(err)
	}
	return connect.NewResponse(&corelliav1.SetOrgToolCurationResponse{Tool: toolRowToProto(row)}), nil
}

func (h *ToolsHandler) GetInstanceToolGrants(
	ctx context.Context,
	req *connect.Request[corelliav1.GetInstanceToolGrantsRequest],
) (*connect.Response[corelliav1.GetInstanceToolGrantsResponse], error) {
	_, orgID, _, err := h.users.CallerIdentityWithRole(ctx)
	if err != nil {
		return nil, toolsErrToConnect(err)
	}
	instanceID, err := uuid.Parse(req.Msg.GetInstanceId())
	if err != nil {
		return nil, connect.NewError(connect.CodeNotFound, tools.ErrInstanceNotForOrg)
	}
	rows, err := h.svc.GetInstanceGrants(ctx, instanceID, orgID)
	if err != nil {
		return nil, toolsErrToConnect(err)
	}
	return connect.NewResponse(&corelliav1.GetInstanceToolGrantsResponse{Grants: grantRowsToProto(rows)}), nil
}

func (h *ToolsHandler) SetInstanceToolGrants(
	ctx context.Context,
	req *connect.Request[corelliav1.SetInstanceToolGrantsRequest],
) (*connect.Response[corelliav1.SetInstanceToolGrantsResponse], error) {
	userID, orgID, _, err := h.users.CallerIdentityWithRole(ctx)
	if err != nil {
		return nil, toolsErrToConnect(err)
	}
	instanceID, err := uuid.Parse(req.Msg.GetInstanceId())
	if err != nil {
		return nil, connect.NewError(connect.CodeNotFound, tools.ErrInstanceNotForOrg)
	}
	grants, err := grantInputsFromProto(req.Msg.GetGrants())
	if err != nil {
		return nil, connect.NewError(connect.CodeInvalidArgument, err)
	}
	rows, version, err := h.svc.SetInstanceGrants(ctx, instanceID, orgID, userID, grants)
	if err != nil {
		return nil, toolsErrToConnect(err)
	}
	return connect.NewResponse(&corelliav1.SetInstanceToolGrantsResponse{
		Grants:          grantRowsToProto(rows),
		ManifestVersion: version,
	}), nil
}

// ─── translation helpers ───────────────────────────────────────────────────

func toolRowsToProto(rows []db.ListOrgToolCurationRow) []*corelliav1.Tool {
	out := make([]*corelliav1.Tool, 0, len(rows))
	for _, r := range rows {
		out = append(out, toolRowToProto(r))
	}
	return out
}

func toolRowToProto(r db.ListOrgToolCurationRow) *corelliav1.Tool {
	icon := ""
	if r.Icon != nil {
		icon = *r.Icon
	}
	scopeShape := bytesToStruct(r.ScopeShape)
	return &corelliav1.Tool{
		Id:                r.ID.String(),
		ToolsetKey:        r.ToolsetKey,
		DisplayName:       r.DisplayName,
		Description:       r.Description,
		Category:          r.Category,
		Icon:              icon,
		DefaultOnInHermes: r.DefaultOnInHermes,
		OauthOnly:         r.OauthOnly,
		ScopeShape:        scopeShape,
		RequiredEnvVars:   r.RequiredEnvVars,
		AdapterVersion:    r.AdapterVersion,
		EnabledForOrg:     r.EnabledForOrg,
	}
}

func grantRowsToProto(rows []db.ListInstanceToolGrantsRow) []*corelliav1.ToolGrant {
	out := make([]*corelliav1.ToolGrant, 0, len(rows))
	for _, r := range rows {
		out = append(out, &corelliav1.ToolGrant{
			Id:            r.ID.String(),
			ToolId:        r.ToolID.String(),
			ToolsetKey:    r.ToolsetKey,
			DisplayName:   r.DisplayName,
			Scope:         bytesToStruct(r.ScopeJson),
			HasCredential: r.CredentialStorageRef != nil && *r.CredentialStorageRef != "",
			GrantedAt:     timestampString(r.GrantedAt),
		})
	}
	return out
}

func grantInputsFromProto(in []*corelliav1.ToolGrantInput) ([]tools.GrantInput, error) {
	out := make([]tools.GrantInput, 0, len(in))
	for i, g := range in {
		toolID, err := uuid.Parse(g.GetToolId())
		if err != nil {
			return nil, fmt.Errorf("grant %d: invalid tool_id", i)
		}
		var scope json.RawMessage
		if g.GetScope() != nil {
			b, marshalErr := g.GetScope().MarshalJSON()
			if marshalErr != nil {
				return nil, fmt.Errorf("grant %d: scope: %w", i, marshalErr)
			}
			scope = b
		}
		out = append(out, tools.GrantInput{
			ToolID:               toolID,
			ScopeJSON:            scope,
			CredentialStorageRef: g.GetCredentialStorageRef(),
		})
	}
	return out, nil
}

// bytesToStruct decodes a JSONB column into a *structpb.Struct. Empty / null /
// bare-object values yield nil so the proto field stays unset (one fewer
// field in the wire body).
func bytesToStruct(raw []byte) *structpb.Struct {
	s := string(raw)
	if len(raw) == 0 || s == "null" {
		return nil
	}
	var m map[string]interface{}
	if err := json.Unmarshal(raw, &m); err != nil {
		return nil
	}
	if len(m) == 0 {
		return nil
	}
	out, err := structpb.NewStruct(m)
	if err != nil {
		return nil
	}
	return out
}

func timestampString(ts pgtype.Timestamptz) string {
	if !ts.Valid {
		return ""
	}
	return ts.Time.UTC().Format("2006-01-02T15:04:05Z07:00")
}

// toolsErrToConnect maps tools.* sentinels to Connect codes. Mirrors the
// users / agents / organizations handlers' redact-unknowns posture: known
// sentinels pass through (their messages are part of the wire contract);
// unknown errors are logged and replaced with a generic "internal error"
// so pgx / driver internals can't leak.
func toolsErrToConnect(err error) error {
	switch {
	case errors.Is(err, users.ErrUnauthenticated):
		return connect.NewError(connect.CodeUnauthenticated, err)
	case errors.Is(err, users.ErrNotProvisioned),
		errors.Is(err, tools.ErrForbidden):
		return connect.NewError(connect.CodePermissionDenied, err)
	case errors.Is(err, tools.ErrToolNotFound),
		errors.Is(err, tools.ErrInstanceNotForOrg):
		return connect.NewError(connect.CodeNotFound, err)
	case errors.Is(err, tools.ErrInvalidScope),
		errors.Is(err, tools.ErrCredentialMissing),
		errors.Is(err, tools.ErrToolNotAvailableForOrg):
		return connect.NewError(connect.CodeInvalidArgument, err)
	case errors.Is(err, tools.ErrTransactorMissing):
		// Programmer error (cmd/api wiring oversight); should never reach
		// the wire. Log loudly and fail closed.
		slog.Error("tools handler: transactor not configured", "err", err)
		return connect.NewError(connect.CodeInternal, errors.New("internal error"))
	default:
		slog.Error("tools handler: unexpected error", "err", err)
		return connect.NewError(connect.CodeInternal, errors.New("internal error"))
	}
}
