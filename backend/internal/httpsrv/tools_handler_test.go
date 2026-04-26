package httpsrv

import (
	"context"
	"errors"
	"testing"

	"connectrpc.com/connect"
	"github.com/google/uuid"
	"github.com/jackc/pgx/v5/pgtype"

	"github.com/hejijunhao/corellia/backend/internal/db"
	corelliav1 "github.com/hejijunhao/corellia/backend/internal/gen/corellia/v1"
	"github.com/hejijunhao/corellia/backend/internal/tools"
	"github.com/hejijunhao/corellia/backend/internal/users"
)

// fakeToolsSvc satisfies the toolsService interface. One sentinel `err`
// drives the mapping path; per-method knobs feed happy-path tests.
type fakeToolsSvc struct {
	err             error
	listRows        []db.ListOrgToolCurationRow
	curationRow     db.ListOrgToolCurationRow
	grantRows       []db.ListInstanceToolGrantsRow
	manifestVersion int64
	// Captured arguments — tests assert these to verify the handler is
	// passing through caller identity / wire fields correctly.
	gotInstanceID uuid.UUID
	gotOrgID      uuid.UUID
	gotGrants     []tools.GrantInput
}

func (f *fakeToolsSvc) ListAvailableForOrg(_ context.Context, _ uuid.UUID, _ uuid.UUID, _ string) ([]db.ListOrgToolCurationRow, error) {
	if f.err != nil {
		return nil, f.err
	}
	return f.listRows, nil
}

func (f *fakeToolsSvc) SetOrgCuration(_ context.Context, _ uuid.UUID, _ uuid.UUID, _ uuid.UUID, _ bool) (db.ListOrgToolCurationRow, error) {
	if f.err != nil {
		return db.ListOrgToolCurationRow{}, f.err
	}
	return f.curationRow, nil
}

func (f *fakeToolsSvc) GetInstanceGrants(_ context.Context, _ uuid.UUID, _ uuid.UUID) ([]db.ListInstanceToolGrantsRow, error) {
	if f.err != nil {
		return nil, f.err
	}
	return f.grantRows, nil
}

func (f *fakeToolsSvc) SetInstanceGrants(_ context.Context, instanceID, orgID, _ uuid.UUID, grants []tools.GrantInput) ([]db.ListInstanceToolGrantsRow, int64, error) {
	if f.err != nil {
		return nil, 0, f.err
	}
	f.gotInstanceID = instanceID
	f.gotOrgID = orgID
	f.gotGrants = grants
	return f.grantRows, f.manifestVersion, nil
}

// fakeUserLookupRole satisfies userIdentityWithRole. Tests vary `role` to
// exercise the SetOrgToolCuration admin gate.
type fakeUserLookupRole struct {
	err  error
	role string
}

func (f *fakeUserLookupRole) CallerIdentityWithRole(_ context.Context) (uuid.UUID, uuid.UUID, string, error) {
	if f.err != nil {
		return uuid.Nil, uuid.Nil, "", f.err
	}
	role := f.role
	if role == "" {
		role = orgRoleAdmin
	}
	return uuid.New(), uuid.New(), role, nil
}

func newToolsHandler(svc toolsService, lookup userIdentityWithRole) *ToolsHandler {
	return NewToolsHandler(svc, lookup)
}

// ─── happy paths ──────────────────────────────────────────────────────────

func TestListTools_HappyPath(t *testing.T) {
	id := uuid.New()
	svc := &fakeToolsSvc{
		listRows: []db.ListOrgToolCurationRow{
			{ID: id, ToolsetKey: "web", DisplayName: "Web Search & Fetch", Category: "info", AdapterVersion: "v2026.4.23", EnabledForOrg: true},
		},
	}
	h := newToolsHandler(svc, &fakeUserLookupRole{})
	req := connect.NewRequest(&corelliav1.ListToolsRequest{
		HarnessAdapterId: uuid.New().String(),
	})
	resp, err := h.ListTools(context.Background(), req)
	if err != nil {
		t.Fatalf("unexpected: %v", err)
	}
	if len(resp.Msg.Tools) != 1 || resp.Msg.Tools[0].ToolsetKey != "web" {
		t.Fatalf("unexpected response: %+v", resp.Msg.Tools)
	}
	if !resp.Msg.Tools[0].EnabledForOrg {
		t.Errorf("expected enabled_for_org=true, got false")
	}
}

func TestSetOrgToolCuration_AdminAllowed(t *testing.T) {
	id := uuid.New()
	svc := &fakeToolsSvc{curationRow: db.ListOrgToolCurationRow{ID: id, ToolsetKey: "web", EnabledForOrg: false}}
	h := newToolsHandler(svc, &fakeUserLookupRole{role: orgRoleAdmin})
	req := connect.NewRequest(&corelliav1.SetOrgToolCurationRequest{
		ToolId:  id.String(),
		Enabled: false,
	})
	resp, err := h.SetOrgToolCuration(context.Background(), req)
	if err != nil {
		t.Fatalf("unexpected: %v", err)
	}
	if resp.Msg.Tool == nil || resp.Msg.Tool.EnabledForOrg {
		t.Fatalf("expected disabled tool echoed back, got %+v", resp.Msg.Tool)
	}
}

func TestSetOrgToolCuration_NonAdminRejected(t *testing.T) {
	h := newToolsHandler(&fakeToolsSvc{}, &fakeUserLookupRole{role: "member"})
	req := connect.NewRequest(&corelliav1.SetOrgToolCurationRequest{
		ToolId:  uuid.New().String(),
		Enabled: false,
	})
	_, err := h.SetOrgToolCuration(context.Background(), req)
	var connErr *connect.Error
	if !errors.As(err, &connErr) || connErr.Code() != connect.CodePermissionDenied {
		t.Fatalf("expected PermissionDenied, got %v", err)
	}
}

func TestGetInstanceToolGrants_HappyPath(t *testing.T) {
	now := pgtype.Timestamptz{Valid: true}
	rows := []db.ListInstanceToolGrantsRow{
		{
			ID:          uuid.New(),
			ToolID:      uuid.New(),
			ToolsetKey:  "web",
			DisplayName: "Web Search & Fetch",
			ScopeJson:   []byte(`{"url_allowlist":["*.acme.com"]}`),
			GrantedAt:   now,
		},
	}
	h := newToolsHandler(&fakeToolsSvc{grantRows: rows}, &fakeUserLookupRole{})
	req := connect.NewRequest(&corelliav1.GetInstanceToolGrantsRequest{
		InstanceId: uuid.New().String(),
	})
	resp, err := h.GetInstanceToolGrants(context.Background(), req)
	if err != nil {
		t.Fatalf("unexpected: %v", err)
	}
	if len(resp.Msg.Grants) != 1 || resp.Msg.Grants[0].ToolsetKey != "web" {
		t.Fatalf("unexpected grants: %+v", resp.Msg.Grants)
	}
	if resp.Msg.Grants[0].Scope == nil {
		t.Fatalf("expected scope struct, got nil")
	}
}

func TestSetInstanceToolGrants_HappyPath(t *testing.T) {
	toolID := uuid.New()
	instanceID := uuid.New()
	svc := &fakeToolsSvc{
		grantRows: []db.ListInstanceToolGrantsRow{
			{ID: uuid.New(), ToolID: toolID, ToolsetKey: "web", DisplayName: "Web Search & Fetch"},
		},
		manifestVersion: 7,
	}
	h := newToolsHandler(svc, &fakeUserLookupRole{})
	req := connect.NewRequest(&corelliav1.SetInstanceToolGrantsRequest{
		InstanceId: instanceID.String(),
		Grants: []*corelliav1.ToolGrantInput{
			{ToolId: toolID.String()},
		},
	})
	resp, err := h.SetInstanceToolGrants(context.Background(), req)
	if err != nil {
		t.Fatalf("unexpected: %v", err)
	}
	if resp.Msg.ManifestVersion != 7 {
		t.Errorf("expected manifest_version=7, got %d", resp.Msg.ManifestVersion)
	}
	if svc.gotInstanceID != instanceID {
		t.Errorf("instance_id passthrough: got %s, want %s", svc.gotInstanceID, instanceID)
	}
	if len(svc.gotGrants) != 1 || svc.gotGrants[0].ToolID != toolID {
		t.Errorf("grant payload didn't reach service correctly: %+v", svc.gotGrants)
	}
}

// ─── identity errors ──────────────────────────────────────────────────────

func TestToolsHandler_Unauthenticated(t *testing.T) {
	h := newToolsHandler(&fakeToolsSvc{}, &fakeUserLookupRole{err: users.ErrUnauthenticated})
	req := connect.NewRequest(&corelliav1.ListToolsRequest{HarnessAdapterId: uuid.New().String()})
	_, err := h.ListTools(context.Background(), req)
	var connErr *connect.Error
	if !errors.As(err, &connErr) || connErr.Code() != connect.CodeUnauthenticated {
		t.Fatalf("expected Unauthenticated, got %v", err)
	}
}

func TestToolsHandler_NotProvisioned(t *testing.T) {
	h := newToolsHandler(&fakeToolsSvc{}, &fakeUserLookupRole{err: users.ErrNotProvisioned})
	req := connect.NewRequest(&corelliav1.ListToolsRequest{HarnessAdapterId: uuid.New().String()})
	_, err := h.ListTools(context.Background(), req)
	var connErr *connect.Error
	if !errors.As(err, &connErr) || connErr.Code() != connect.CodePermissionDenied {
		t.Fatalf("expected PermissionDenied, got %v", err)
	}
}

// ─── invalid argument paths ───────────────────────────────────────────────

func TestListTools_InvalidHarnessID(t *testing.T) {
	h := newToolsHandler(&fakeToolsSvc{}, &fakeUserLookupRole{})
	req := connect.NewRequest(&corelliav1.ListToolsRequest{HarnessAdapterId: "not-a-uuid"})
	_, err := h.ListTools(context.Background(), req)
	var connErr *connect.Error
	if !errors.As(err, &connErr) || connErr.Code() != connect.CodeInvalidArgument {
		t.Fatalf("expected InvalidArgument, got %v", err)
	}
}

func TestSetInstanceToolGrants_InvalidGrantID(t *testing.T) {
	h := newToolsHandler(&fakeToolsSvc{}, &fakeUserLookupRole{})
	req := connect.NewRequest(&corelliav1.SetInstanceToolGrantsRequest{
		InstanceId: uuid.New().String(),
		Grants: []*corelliav1.ToolGrantInput{
			{ToolId: "not-a-uuid"},
		},
	})
	_, err := h.SetInstanceToolGrants(context.Background(), req)
	var connErr *connect.Error
	if !errors.As(err, &connErr) || connErr.Code() != connect.CodeInvalidArgument {
		t.Fatalf("expected InvalidArgument, got %v", err)
	}
}

// ─── sentinel-to-Connect mapping ──────────────────────────────────────────

func TestToolsErrToConnect_SentinelMapping(t *testing.T) {
	cases := []struct {
		name string
		err  error
		code connect.Code
	}{
		{"tool not found", tools.ErrToolNotFound, connect.CodeNotFound},
		{"instance not in org", tools.ErrInstanceNotForOrg, connect.CodeNotFound},
		{"invalid scope", tools.ErrInvalidScope, connect.CodeInvalidArgument},
		{"credential missing", tools.ErrCredentialMissing, connect.CodeInvalidArgument},
		{"forbidden", tools.ErrForbidden, connect.CodePermissionDenied},
		{"transactor missing", tools.ErrTransactorMissing, connect.CodeInternal},
		{"unknown error", errors.New("some pgx leak"), connect.CodeInternal},
	}
	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			got := toolsErrToConnect(tc.err)
			var connErr *connect.Error
			if !errors.As(got, &connErr) {
				t.Fatalf("expected *connect.Error, got %T", got)
			}
			if connErr.Code() != tc.code {
				t.Errorf("got code %v, want %v", connErr.Code(), tc.code)
			}
		})
	}
}
