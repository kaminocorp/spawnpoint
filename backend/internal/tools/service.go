package tools

import (
	"context"
	"encoding/json"
	"errors"
	"log/slog"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgtype"

	"github.com/hejijunhao/corellia/backend/internal/db"
)

// toolQueries is the narrow view of db.Queries this service touches.
// Phases 1–3 widen it as new RPCs land. Keeping it narrow makes the fake in
// service_test.go small and self-contained.
type toolQueries interface {
	// Phase 1 — catalog + grant primitives.
	GetToolByID(ctx context.Context, id uuid.UUID) (db.Tool, error)
	ListToolsForHarness(ctx context.Context, arg db.ListToolsForHarnessParams) ([]db.Tool, error)
	ListOrgToolCuration(ctx context.Context, arg db.ListOrgToolCurationParams) ([]db.ListOrgToolCurationRow, error)
	UpsertOrgToolCuration(ctx context.Context, arg db.UpsertOrgToolCurationParams) error
	ListInstanceToolGrants(ctx context.Context, agentInstanceID uuid.UUID) ([]db.ListInstanceToolGrantsRow, error)
	InsertInstanceToolGrant(ctx context.Context, arg db.InsertInstanceToolGrantParams) (db.AgentInstanceToolGrant, error)
	RevokeInstanceToolGrant(ctx context.Context, arg db.RevokeInstanceToolGrantParams) error
	RevokeAllActiveToolGrants(ctx context.Context, agentInstanceID uuid.UUID) error

	// Phase 2 — manifest bearer tokens.
	InsertManifestToken(ctx context.Context, arg db.InsertManifestTokenParams) error
	GetManifestTokenByHash(ctx context.Context, tokenHash string) (db.AgentInstanceManifestToken, error)
	GetManifestTokenByInstance(ctx context.Context, agentInstanceID uuid.UUID) (db.AgentInstanceManifestToken, error)
	BumpManifestVersion(ctx context.Context, agentInstanceID uuid.UUID) error

	// Phase 3 — instance org guard for grant writes/reads.
	GetAgentInstanceOrgGuard(ctx context.Context, arg db.GetAgentInstanceOrgGuardParams) (uuid.UUID, error)

	// Phase 7 — audit log append (fills the no-op auditAppend call sites
	// planted in Phase 3). Append-only; read paths land post-v1.5.
	InsertToolGrantAudit(ctx context.Context, arg db.InsertToolGrantAuditParams) error
}

// Service owns tools-governance domain logic. Phase 1 exposes the catalog
// read path and scope validation; Phase 2 adds BuildManifestForInstance and
// the per-instance bearer-token issuance/auth surface; Phase 3 adds the
// RPC-facing read/write methods (ListAvailableForOrg, SetInstanceGrants,
// SetOrgCuration, ...).
type Service struct {
	queries toolQueries
	txr     Transactor
}

// ServiceOption is the functional-option shape NewService accepts after its
// required collaborators. Mirrors agents.ServiceOption — per-feature
// collaborators (Transactor for SetInstanceGrants) opt in here so existing
// Phase 1/2 callers don't break.
type ServiceOption func(*Service)

// WithTransactor wires a Transactor into the service. Required for
// SetInstanceGrants (which fails with ErrTransactorMissing without it).
// Other methods (read paths, GetTool, BuildManifestForInstance) work with
// or without it.
func WithTransactor(txr Transactor) ServiceOption {
	return func(s *Service) { s.txr = txr }
}

func NewService(queries toolQueries, opts ...ServiceOption) *Service {
	s := &Service{queries: queries}
	for _, opt := range opts {
		opt(s)
	}
	return s
}

// GetTool returns a single catalog row by ID. Returns ErrToolNotFound when no
// row matches.
func (s *Service) GetTool(ctx context.Context, id uuid.UUID) (db.Tool, error) {
	tool, err := s.queries.GetToolByID(ctx, id)
	if err != nil {
		if errors.Is(err, pgx.ErrNoRows) {
			return db.Tool{}, ErrToolNotFound
		}
		return db.Tool{}, err
	}
	return tool, nil
}

// ListToolsForHarness returns the raw catalog (no org-curation merge). Used
// by Phase 2's manifest assembly path. Phase 3 RPC consumers should call
// ListAvailableForOrg instead so the org curation flag flows through.
func (s *Service) ListToolsForHarness(ctx context.Context, harnessAdapterID uuid.UUID, adapterVersion string) ([]db.Tool, error) {
	return s.queries.ListToolsForHarness(ctx, db.ListToolsForHarnessParams{
		HarnessAdapterID: harnessAdapterID,
		AdapterVersion:   adapterVersion,
	})
}

// ListAvailableForOrg returns the catalog with the per-org enabled_for_org
// flag merged in. Powers the Phase 3 ListTools and GetOrgToolCuration RPCs.
// adapterVersion = "" resolves to currentAdapterVersion (the v1.5 single-pin).
func (s *Service) ListAvailableForOrg(ctx context.Context, orgID, harnessAdapterID uuid.UUID, adapterVersion string) ([]db.ListOrgToolCurationRow, error) {
	if adapterVersion == "" {
		adapterVersion = currentAdapterVersion
	}
	return s.queries.ListOrgToolCuration(ctx, db.ListOrgToolCurationParams{
		OrgID:            orgID,
		HarnessAdapterID: harnessAdapterID,
		AdapterVersion:   adapterVersion,
	})
}

// SetOrgCuration toggles a single toolset for the org. The caller layer
// (handler) is responsible for the role gate — this method only enforces
// existence (ErrToolNotFound) and writes. Returns the updated row so the
// handler can echo it back to the FE without a re-fetch.
//
// Phase 7 will tee an audit-row write here; the call site is reserved with
// a no-op auditAppend below.
func (s *Service) SetOrgCuration(ctx context.Context, orgID, toolID, curatedBy uuid.UUID, enabled bool) (db.ListOrgToolCurationRow, error) {
	tool, err := s.GetTool(ctx, toolID)
	if err != nil {
		return db.ListOrgToolCurationRow{}, err
	}
	if err := s.queries.UpsertOrgToolCuration(ctx, db.UpsertOrgToolCurationParams{
		OrgID:     orgID,
		ToolID:    toolID,
		Enabled:   enabled,
		CuratedBy: curatedBy,
	}); err != nil {
		return db.ListOrgToolCurationRow{}, err
	}

	// Re-read the merged row so the response carries the canonical
	// post-write enabled_for_org flag (avoids a FE round-trip).
	rows, err := s.queries.ListOrgToolCuration(ctx, db.ListOrgToolCurationParams{
		OrgID:            orgID,
		HarnessAdapterID: tool.HarnessAdapterID,
		AdapterVersion:   tool.AdapterVersion,
	})
	if err != nil {
		return db.ListOrgToolCurationRow{}, err
	}
	for _, r := range rows {
		if r.ID == toolID {
			s.auditAppend(ctx, curatedBy, "org_curation_set", &orgID, nil, &toolID)
			return r, nil
		}
	}
	// Should be unreachable — the catalog row exists (GetTool succeeded)
	// and ListOrgToolCuration returns every catalog row for the harness.
	return db.ListOrgToolCurationRow{}, ErrToolNotFound
}

// GetInstanceGrants returns the active grants for an instance after asserting
// the instance belongs to the caller's org. Wraps ErrInstanceNotForOrg on
// any mismatch (no cross-org leak via 403 vs 404 differential).
func (s *Service) GetInstanceGrants(ctx context.Context, instanceID, orgID uuid.UUID) ([]db.ListInstanceToolGrantsRow, error) {
	if err := s.assertInstanceInOrg(ctx, instanceID, orgID); err != nil {
		return nil, err
	}
	return s.queries.ListInstanceToolGrants(ctx, instanceID)
}

// GrantInput is the resolved per-grant intent passed by the handler. Keeps
// the handler's wire-shape coupling out of the service.
type GrantInput struct {
	ToolID               uuid.UUID
	ScopeJSON            json.RawMessage
	CredentialStorageRef string // empty = no credential
}

// SetInstanceGrants atomically replaces the active grant set for an
// instance. Steps:
//
//  1. Org-guard the instance (ErrInstanceNotForOrg on mismatch).
//  2. Validate every grant's scope_json against its tool's scope_shape
//     before opening the tx — a bad scope must not flush the existing
//     grants (ValidateScopeForTool failures return ErrInvalidScope/
//     ErrToolNotFound).
//  3. Inside one tx: revoke all active grants → insert each new grant →
//     bump manifest_version. A failure between revoke and insert rolls
//     back; the partial state never commits.
//  4. After commit: append an audit row (Phase 7 stub) and re-read the
//     fresh grant set + manifest_version for the response.
//
// Note on default-deny: Phase 1 ValidateScope leaves a missing field as
// "absent" — the Phase 5 plugin enforces default-deny on the missing
// surface. This method accepts the empty grant set (`grants == nil`) as
// a valid revoke-all.
func (s *Service) SetInstanceGrants(ctx context.Context, instanceID, orgID, grantedBy uuid.UUID, grants []GrantInput) ([]db.ListInstanceToolGrantsRow, int64, error) {
	if s.txr == nil {
		return nil, 0, ErrTransactorMissing
	}
	if err := s.assertInstanceInOrg(ctx, instanceID, orgID); err != nil {
		return nil, 0, err
	}

	// Pre-tx scope validation. Loads each tool row to fetch scope_shape +
	// required_env_vars; bad scopes / unknown tools fail before any write.
	for i, g := range grants {
		tool, err := s.GetTool(ctx, g.ToolID)
		if err != nil {
			return nil, 0, err
		}
		if err := ValidateScope(json.RawMessage(tool.ScopeShape), g.ScopeJSON); err != nil {
			return nil, 0, err
		}
		if len(tool.RequiredEnvVars) > 0 && g.CredentialStorageRef == "" {
			// Phase 4 captures credentials from the wizard; in Phase 3 the
			// FE writes nothing here, so this gate effectively flags any
			// pre-Phase-4 attempt to grant a credential-required toolset.
			return nil, 0, ErrCredentialMissing
		}
		// Defensive: silence unused-loop-index warning by keeping i in scope
		// (kept here as a breadcrumb for Phase 7 audit-row indexing).
		_ = i
	}

	// Atomic revoke-all → insert-N → bump-version.
	err := s.txr.WithGrantsTx(ctx, func(tx GrantsTx) error {
		if err := tx.RevokeAllActiveToolGrants(ctx, instanceID); err != nil {
			return err
		}
		for _, g := range grants {
			var credRef *string
			if g.CredentialStorageRef != "" {
				v := g.CredentialStorageRef
				credRef = &v
			}
			scope := []byte(g.ScopeJSON)
			if len(scope) == 0 {
				scope = []byte("{}")
			}
			if _, err := tx.InsertInstanceToolGrant(ctx, db.InsertInstanceToolGrantParams{
				AgentInstanceID:      instanceID,
				ToolID:               g.ToolID,
				ScopeJson:            scope,
				CredentialStorageRef: credRef,
				GrantedBy:            grantedBy,
			}); err != nil {
				return err
			}
		}
		return tx.BumpManifestVersion(ctx, instanceID)
	})
	if err != nil {
		return nil, 0, err
	}

	s.auditAppend(ctx, grantedBy, "instance_grants_set", &orgID, &instanceID, nil)

	// Read-back outside the tx — the FE response shape includes the merged
	// display_name + scope_shape via the join.
	out, err := s.queries.ListInstanceToolGrants(ctx, instanceID)
	if err != nil {
		return nil, 0, err
	}
	tokenRow, err := s.queries.GetManifestTokenByInstance(ctx, instanceID)
	if err != nil {
		// Manifest token row absent is non-fatal for the response — it just
		// means no adapter has booted with tools governance yet. The grants
		// were written; the FE doesn't need the version for v1.5.
		if errors.Is(err, pgx.ErrNoRows) {
			return out, 0, nil
		}
		return nil, 0, err
	}
	return out, tokenRow.ManifestVersion, nil
}

// ValidateScopeForTool loads the tool's scope_shape from the catalog and
// validates that scopeJSON conforms to it. Returns ErrToolNotFound if the
// tool row doesn't exist, or ErrInvalidScope (with details) on any shape
// violation. Used by SetInstanceGrants (above) inline; exported for the
// Phase 4 wizard-side preview path.
func (s *Service) ValidateScopeForTool(ctx context.Context, toolID uuid.UUID, scopeJSON json.RawMessage) error {
	tool, err := s.GetTool(ctx, toolID)
	if err != nil {
		return err
	}
	return ValidateScope(json.RawMessage(tool.ScopeShape), scopeJSON)
}

// assertInstanceInOrg returns ErrInstanceNotForOrg when the (instance, org)
// pair has no row. Maps pgx.ErrNoRows (cross-org or missing) to a single
// sentinel so the caller never needs to branch.
func (s *Service) assertInstanceInOrg(ctx context.Context, instanceID, orgID uuid.UUID) error {
	_, err := s.queries.GetAgentInstanceOrgGuard(ctx, db.GetAgentInstanceOrgGuardParams{
		ID:    instanceID,
		OrgID: orgID,
	})
	if err != nil {
		if errors.Is(err, pgx.ErrNoRows) {
			return ErrInstanceNotForOrg
		}
		return err
	}
	return nil
}

// AppendInstanceRestartAudit records an operator-driven `flyctl machine
// restart` invoked through the fleet inspector's "Restart now" button (Phase 7
// FE; called by agents.Service after a successful restart). Lives on the
// tools service because the audit table is the tools-governance audit log;
// instance restarts on a tools-governance-enabled instance are how operators
// apply restart-required scope changes.
func (s *Service) AppendInstanceRestartAudit(ctx context.Context, actorUserID, orgID, instanceID uuid.UUID) {
	s.auditAppend(ctx, actorUserID, "instance_restart", &orgID, &instanceID, nil)
}

// auditAppend persists one row in tool_grant_audit. The signature mirrors the
// table columns (action + nullable org / instance / tool FKs); before_json /
// after_json are reserved for the v1.6 reader UI and stay nil today.
//
// Logging-only failure mode: a write failure here must NOT roll back the
// surrounding business write. Audit is an after-the-fact ledger — losing a
// row to a transient DB hiccup is recoverable, but rolling back a successful
// curation toggle or grant set because the audit row failed would be a worse
// outcome (the operator's intent is already persisted in the primary table).
// Errors are logged at warn so an alerting pass picks them up post-v1.5.
func (s *Service) auditAppend(ctx context.Context, actorUserID uuid.UUID, action string, orgID, instanceID, toolID *uuid.UUID) {
	if err := s.queries.InsertToolGrantAudit(ctx, db.InsertToolGrantAuditParams{
		ActorUserID: actorUserID,
		OrgID:       uuidPtrToPg(orgID),
		InstanceID:  uuidPtrToPg(instanceID),
		ToolID:      uuidPtrToPg(toolID),
		Action:      action,
	}); err != nil {
		slog.Warn("tools: audit append failed",
			"action", action,
			"actor_user_id", actorUserID,
			"err", err,
		)
	}
}

// uuidPtrToPg projects a nullable *uuid.UUID into the pgtype.UUID shape sqlc
// uses for nullable UUID columns. nil → invalid (NULL); non-nil → valid.
func uuidPtrToPg(p *uuid.UUID) pgtype.UUID {
	if p == nil {
		return pgtype.UUID{}
	}
	return pgtype.UUID{Bytes: *p, Valid: true}
}
