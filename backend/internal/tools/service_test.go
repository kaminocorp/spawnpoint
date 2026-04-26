package tools_test

import (
	"context"
	"encoding/json"
	"errors"
	"strings"
	"testing"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5"

	"github.com/hejijunhao/corellia/backend/internal/db"
	"github.com/hejijunhao/corellia/backend/internal/tools"
)

// ─── scope validator ────────────────────────────────────────────────────────

func TestValidateScope_EmptyShape(t *testing.T) {
	cases := []struct {
		name       string
		scopeShape json.RawMessage
		scopeJSON  json.RawMessage
	}{
		{"nil shape", nil, json.RawMessage(`{"url_allowlist":["*.acme.com"]}`)},
		{"empty object shape", json.RawMessage(`{}`), json.RawMessage(`{"url_allowlist":["*.acme.com"]}`)},
		{"null shape", json.RawMessage(`null`), nil},
	}
	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			if err := tools.ValidateScope(tc.scopeShape, tc.scopeJSON); err != nil {
				t.Fatalf("expected nil, got %v", err)
			}
		})
	}
}

func TestValidateScope_PatternList(t *testing.T) {
	shape := json.RawMessage(`{"url_allowlist":{"type":"pattern_list","description":"URLs","default_deny":true}}`)

	t.Run("valid patterns", func(t *testing.T) {
		scope := json.RawMessage(`{"url_allowlist":["*.acme.com","wiki.example.org/*"]}`)
		if err := tools.ValidateScope(shape, scope); err != nil {
			t.Fatalf("unexpected error: %v", err)
		}
	})

	t.Run("empty scope JSON passes (absent field = default-deny)", func(t *testing.T) {
		if err := tools.ValidateScope(shape, nil); err != nil {
			t.Fatalf("unexpected error: %v", err)
		}
	})

	t.Run("too many patterns", func(t *testing.T) {
		patterns := make([]string, 65)
		for i := range patterns {
			patterns[i] = "*.example.com"
		}
		b, _ := json.Marshal(map[string]any{"url_allowlist": patterns})
		err := tools.ValidateScope(shape, b)
		if !errors.Is(err, tools.ErrInvalidScope) {
			t.Fatalf("expected ErrInvalidScope, got %v", err)
		}
	})

	t.Run("pattern too long", func(t *testing.T) {
		long := strings.Repeat("x", 201)
		scope := json.RawMessage(`{"url_allowlist":["` + long + `"]}`)
		err := tools.ValidateScope(shape, scope)
		if !errors.Is(err, tools.ErrInvalidScope) {
			t.Fatalf("expected ErrInvalidScope, got %v", err)
		}
	})

	t.Run("empty string pattern", func(t *testing.T) {
		scope := json.RawMessage(`{"url_allowlist":[""]}`)
		err := tools.ValidateScope(shape, scope)
		if !errors.Is(err, tools.ErrInvalidScope) {
			t.Fatalf("expected ErrInvalidScope, got %v", err)
		}
	})

	t.Run("field missing from scope — silently skipped", func(t *testing.T) {
		scope := json.RawMessage(`{}`)
		if err := tools.ValidateScope(shape, scope); err != nil {
			t.Fatalf("unexpected error: %v", err)
		}
	})
}

func TestValidateScope_RegexList(t *testing.T) {
	shape := json.RawMessage(`{"command_allowlist":{"type":"regex_list","description":"commands","default_deny":true}}`)

	t.Run("valid regexes", func(t *testing.T) {
		scope := json.RawMessage(`{"command_allowlist":["^ls\\b","^cat\\s"]}`)
		if err := tools.ValidateScope(shape, scope); err != nil {
			t.Fatalf("unexpected error: %v", err)
		}
	})

	t.Run("invalid regex", func(t *testing.T) {
		scope := json.RawMessage(`{"command_allowlist":["[invalid"]}`)
		err := tools.ValidateScope(shape, scope)
		if !errors.Is(err, tools.ErrInvalidScope) {
			t.Fatalf("expected ErrInvalidScope, got %v", err)
		}
	})

	t.Run("too many regexes", func(t *testing.T) {
		patterns := make([]string, 65)
		for i := range patterns {
			patterns[i] = "^ok"
		}
		b, _ := json.Marshal(map[string]any{"command_allowlist": patterns})
		err := tools.ValidateScope(shape, b)
		if !errors.Is(err, tools.ErrInvalidScope) {
			t.Fatalf("expected ErrInvalidScope, got %v", err)
		}
	})

	t.Run("not an array", func(t *testing.T) {
		scope := json.RawMessage(`{"command_allowlist":"not-an-array"}`)
		err := tools.ValidateScope(shape, scope)
		if !errors.Is(err, tools.ErrInvalidScope) {
			t.Fatalf("expected ErrInvalidScope, got %v", err)
		}
	})
}

func TestValidateScope_Path(t *testing.T) {
	shape := json.RawMessage(`{"working_directory":{"type":"path","description":"cwd","default_deny":false}}`)

	t.Run("valid path", func(t *testing.T) {
		scope := json.RawMessage(`{"working_directory":"/workspace"}`)
		if err := tools.ValidateScope(shape, scope); err != nil {
			t.Fatalf("unexpected error: %v", err)
		}
	})

	t.Run("empty string is valid (no pin)", func(t *testing.T) {
		scope := json.RawMessage(`{"working_directory":""}`)
		if err := tools.ValidateScope(shape, scope); err != nil {
			t.Fatalf("unexpected error: %v", err)
		}
	})

	t.Run("path too long", func(t *testing.T) {
		long := "/" + strings.Repeat("a", 200)
		b, _ := json.Marshal(map[string]any{"working_directory": long})
		err := tools.ValidateScope(shape, b)
		if !errors.Is(err, tools.ErrInvalidScope) {
			t.Fatalf("expected ErrInvalidScope, got %v", err)
		}
	})

	t.Run("not a string", func(t *testing.T) {
		scope := json.RawMessage(`{"working_directory":42}`)
		err := tools.ValidateScope(shape, scope)
		if !errors.Is(err, tools.ErrInvalidScope) {
			t.Fatalf("expected ErrInvalidScope, got %v", err)
		}
	})
}

func TestValidateScope_MultipleFields(t *testing.T) {
	// terminal has both command_allowlist + working_directory
	shape := json.RawMessage(`{
		"command_allowlist":{"type":"regex_list","description":"cmds","default_deny":true},
		"working_directory":{"type":"path","description":"cwd","default_deny":false}
	}`)

	t.Run("both fields valid", func(t *testing.T) {
		scope := json.RawMessage(`{"command_allowlist":["^ls"],"working_directory":"/app"}`)
		if err := tools.ValidateScope(shape, scope); err != nil {
			t.Fatalf("unexpected error: %v", err)
		}
	})

	t.Run("invalid regex in first field still caught", func(t *testing.T) {
		scope := json.RawMessage(`{"command_allowlist":["[bad"],"working_directory":"/app"}`)
		err := tools.ValidateScope(shape, scope)
		if !errors.Is(err, tools.ErrInvalidScope) {
			t.Fatalf("expected ErrInvalidScope, got %v", err)
		}
	})
}

func TestValidateScope_UnknownFieldsIgnored(t *testing.T) {
	shape := json.RawMessage(`{"url_allowlist":{"type":"pattern_list","description":"URLs","default_deny":true}}`)
	scope := json.RawMessage(`{"url_allowlist":["*.acme.com"],"future_field":"ignored"}`)
	if err := tools.ValidateScope(shape, scope); err != nil {
		t.Fatalf("unexpected error: %v", err)
	}
}

// ─── fakes ───────────────────────────────────────────────────────────────────

// fakeToolQueries satisfies the unexported toolQueries interface via the
// concrete types from db. Each field is settable so tests script exactly
// what they need.
type fakeToolQueries struct {
	tool         db.Tool
	toolErr      error
	// toolByID overrides single-tool lookup with a per-id map. Set this when
	// a test exercises GetTool against multiple tool ids in one call (e.g.
	// SetInstanceGrants with two grants pointing at different tools).
	toolByID     map[uuid.UUID]db.Tool
	tools        []db.Tool
	listErr      error
	curationRows []db.ListOrgToolCurationRow
	curationErr  error
	upsertErr    error
	guardErr     error
	guardOrgID   uuid.UUID // expected org_id; mismatch returns pgx.ErrNoRows
	grantRows    []db.ListInstanceToolGrantsRow
	grantsErr    error
	tokenRow     db.AgentInstanceManifestToken
	tokenErr     error

	// captured insert payloads for atomicity tests.
	insertedGrants []db.InsertInstanceToolGrantParams
	revokedAll     int // count of RevokeAllActiveToolGrants calls
	bumpedVersion  int // count of BumpManifestVersion calls
	auditAppends   []db.InsertToolGrantAuditParams // Phase 7 — captures audit row writes
	auditErr       error                           // injectable failure for audit-write idempotency tests

	// scripted insert error: trips on the Nth insert (1-indexed).
	insertFailOn int
}

func (f *fakeToolQueries) GetToolByID(_ context.Context, id uuid.UUID) (db.Tool, error) {
	if f.toolByID != nil {
		if t, ok := f.toolByID[id]; ok {
			return t, nil
		}
		return db.Tool{}, pgx.ErrNoRows
	}
	return f.tool, f.toolErr
}
func (f *fakeToolQueries) ListToolsForHarness(_ context.Context, _ db.ListToolsForHarnessParams) ([]db.Tool, error) {
	return f.tools, f.listErr
}
func (f *fakeToolQueries) ListOrgToolCuration(_ context.Context, _ db.ListOrgToolCurationParams) ([]db.ListOrgToolCurationRow, error) {
	return f.curationRows, f.curationErr
}
func (f *fakeToolQueries) UpsertOrgToolCuration(_ context.Context, _ db.UpsertOrgToolCurationParams) error {
	return f.upsertErr
}
func (f *fakeToolQueries) ListInstanceToolGrants(_ context.Context, _ uuid.UUID) ([]db.ListInstanceToolGrantsRow, error) {
	return f.grantRows, f.grantsErr
}
func (f *fakeToolQueries) InsertInstanceToolGrant(_ context.Context, arg db.InsertInstanceToolGrantParams) (db.AgentInstanceToolGrant, error) {
	f.insertedGrants = append(f.insertedGrants, arg)
	if f.insertFailOn > 0 && len(f.insertedGrants) == f.insertFailOn {
		return db.AgentInstanceToolGrant{}, errors.New("simulated insert failure")
	}
	return db.AgentInstanceToolGrant{ID: uuid.New()}, nil
}
func (f *fakeToolQueries) RevokeInstanceToolGrant(_ context.Context, _ db.RevokeInstanceToolGrantParams) error {
	return nil
}
func (f *fakeToolQueries) RevokeAllActiveToolGrants(_ context.Context, _ uuid.UUID) error {
	f.revokedAll++
	return nil
}
func (f *fakeToolQueries) InsertManifestToken(_ context.Context, _ db.InsertManifestTokenParams) error {
	return nil
}
func (f *fakeToolQueries) GetManifestTokenByHash(_ context.Context, _ string) (db.AgentInstanceManifestToken, error) {
	return db.AgentInstanceManifestToken{}, nil
}
func (f *fakeToolQueries) GetManifestTokenByInstance(_ context.Context, _ uuid.UUID) (db.AgentInstanceManifestToken, error) {
	return f.tokenRow, f.tokenErr
}
func (f *fakeToolQueries) BumpManifestVersion(_ context.Context, _ uuid.UUID) error {
	f.bumpedVersion++
	return nil
}
func (f *fakeToolQueries) GetAgentInstanceOrgGuard(_ context.Context, arg db.GetAgentInstanceOrgGuardParams) (uuid.UUID, error) {
	if f.guardErr != nil {
		return uuid.Nil, f.guardErr
	}
	if f.guardOrgID != uuid.Nil && arg.OrgID != f.guardOrgID {
		return uuid.Nil, pgx.ErrNoRows
	}
	return arg.ID, nil
}
func (f *fakeToolQueries) InsertToolGrantAudit(_ context.Context, arg db.InsertToolGrantAuditParams) error {
	f.auditAppends = append(f.auditAppends, arg)
	return f.auditErr
}

// ─── service ─────────────────────────────────────────────────────────────────

func TestService_GetTool_Found(t *testing.T) {
	id := uuid.New()
	q := &fakeToolQueries{
		tool: db.Tool{ID: id, ToolsetKey: "web", DisplayName: "Web Search & Fetch"},
	}
	svc := tools.NewService(q)
	got, err := svc.GetTool(context.Background(), id)
	if err != nil {
		t.Fatalf("unexpected error: %v", err)
	}
	if got.ToolsetKey != "web" {
		t.Fatalf("expected toolset_key 'web', got %q", got.ToolsetKey)
	}
}

func TestService_GetTool_NotFound(t *testing.T) {
	q := &fakeToolQueries{toolErr: pgx.ErrNoRows}
	svc := tools.NewService(q)
	_, err := svc.GetTool(context.Background(), uuid.New())
	if !errors.Is(err, tools.ErrToolNotFound) {
		t.Fatalf("expected ErrToolNotFound, got %v", err)
	}
}

func TestService_ListToolsForHarness(t *testing.T) {
	want := []db.Tool{
		{ToolsetKey: "file"},
		{ToolsetKey: "web"},
	}
	q := &fakeToolQueries{tools: want}
	svc := tools.NewService(q)
	got, err := svc.ListToolsForHarness(context.Background(), uuid.New(), "v2026.4.23")
	if err != nil {
		t.Fatalf("unexpected error: %v", err)
	}
	if len(got) != len(want) {
		t.Fatalf("expected %d tools, got %d", len(want), len(got))
	}
}

func TestService_ValidateScopeForTool_Valid(t *testing.T) {
	id := uuid.New()
	q := &fakeToolQueries{
		tool: db.Tool{
			ID:         id,
			ToolsetKey: "web",
			ScopeShape: []byte(`{"url_allowlist":{"type":"pattern_list","description":"URLs","default_deny":true}}`),
		},
	}
	svc := tools.NewService(q)
	scope := json.RawMessage(`{"url_allowlist":["*.acme.com","*.internal.example.com"]}`)
	if err := svc.ValidateScopeForTool(context.Background(), id, scope); err != nil {
		t.Fatalf("unexpected error: %v", err)
	}
}

func TestService_ValidateScopeForTool_Invalid(t *testing.T) {
	id := uuid.New()
	q := &fakeToolQueries{
		tool: db.Tool{
			ID:         id,
			ToolsetKey: "terminal",
			ScopeShape: []byte(`{"command_allowlist":{"type":"regex_list","description":"cmds","default_deny":true}}`),
		},
	}
	svc := tools.NewService(q)
	scope := json.RawMessage(`{"command_allowlist":["[invalid-regex"]}`)
	err := svc.ValidateScopeForTool(context.Background(), id, scope)
	if !errors.Is(err, tools.ErrInvalidScope) {
		t.Fatalf("expected ErrInvalidScope, got %v", err)
	}
}

func TestService_ValidateScopeForTool_ToolNotFound(t *testing.T) {
	q := &fakeToolQueries{toolErr: pgx.ErrNoRows}
	svc := tools.NewService(q)
	err := svc.ValidateScopeForTool(context.Background(), uuid.New(), nil)
	if !errors.Is(err, tools.ErrToolNotFound) {
		t.Fatalf("expected ErrToolNotFound, got %v", err)
	}
}

func TestService_ValidateScopeForTool_EmptyShapeAlwaysPasses(t *testing.T) {
	id := uuid.New()
	q := &fakeToolQueries{
		tool: db.Tool{
			ID:         id,
			ToolsetKey: "code_execution",
			ScopeShape: []byte(`{}`), // no goverable scope in v1.5
		},
	}
	svc := tools.NewService(q)
	// any scope_json is accepted for a toolset with an empty scope_shape
	scope := json.RawMessage(`{"unexpected_field":"ignored"}`)
	if err := svc.ValidateScopeForTool(context.Background(), id, scope); err != nil {
		t.Fatalf("unexpected error: %v", err)
	}
}


// ─── Phase 3 — Service write paths ───────────────────────────────────────────

// fakeTransactor is the in-memory equivalent of tools.PgxTransactor — the
// fn runs against the same fakeToolQueries the service was built with, so
// inserts/revokes/version-bumps are observable on the same fake.
//
// Failure mode (failOnTx=true): the closure never sees a tx-bound queries
// object — the transactor's BeginTx fails first, so revokes don't run and
// inserts don't run. Used to verify the service's atomicity guarantee.
type fakeTransactor struct {
	q        *fakeToolQueries
	failOnTx bool
}

func (t *fakeTransactor) WithGrantsTx(ctx context.Context, fn func(tools.GrantsTx) error) error {
	if t.failOnTx {
		return errors.New("simulated tx-begin failure")
	}
	// Adapter: fakeToolQueries already exposes the three methods GrantsTx
	// requires (RevokeAllActiveToolGrants, InsertInstanceToolGrant,
	// BumpManifestVersion); pass it through directly.
	return fn(t.q)
}

func TestSetInstanceGrants_HappyPath(t *testing.T) {
	orgID := uuid.New()
	instanceID := uuid.New()
	grantedBy := uuid.New()
	toolA := db.Tool{
		ID:         uuid.New(),
		ToolsetKey: "web",
		ScopeShape: []byte(`{"url_allowlist":{"type":"pattern_list","description":"URLs","default_deny":true}}`),
	}
	toolB := db.Tool{
		ID:         uuid.New(),
		ToolsetKey: "code_execution",
		ScopeShape: []byte(`{}`),
	}
	q := &fakeToolQueries{guardOrgID: orgID}
	// GetTool routes by ID — set tool to whichever the per-call code path
	// asks for. fakeToolQueries.GetToolByID returns f.tool unconditionally,
	// so we need to switch it between calls. Workaround: keep both tools
	// in a map and override GetToolByID via a local subclass… but that's
	// awkward. Easier: prime tool=toolA, run with one grant; then prime
	// tool=toolB, run with two grants for the multi-grant assertion.
	q.tool = toolA
	svc := tools.NewService(q, tools.WithTransactor(&fakeTransactor{q: q}))

	rows, version, err := svc.SetInstanceGrants(context.Background(), instanceID, orgID, grantedBy, []tools.GrantInput{
		{ToolID: toolA.ID, ScopeJSON: json.RawMessage(`{"url_allowlist":["*.acme.com"]}`)},
	})
	if err != nil {
		t.Fatalf("unexpected error: %v", err)
	}
	if q.revokedAll != 1 {
		t.Errorf("expected 1 RevokeAllActiveToolGrants call, got %d", q.revokedAll)
	}
	if len(q.insertedGrants) != 1 {
		t.Fatalf("expected 1 grant insert, got %d", len(q.insertedGrants))
	}
	if q.insertedGrants[0].ToolID != toolA.ID {
		t.Errorf("inserted wrong tool: got %v, want %v", q.insertedGrants[0].ToolID, toolA.ID)
	}
	if q.bumpedVersion != 1 {
		t.Errorf("expected 1 BumpManifestVersion call, got %d", q.bumpedVersion)
	}
	// Phase 7: a successful grant write appends an `instance_grants_set`
	// audit row carrying the actor + org + instance.
	if len(q.auditAppends) != 1 {
		t.Fatalf("expected 1 audit row written, got %d", len(q.auditAppends))
	}
	if q.auditAppends[0].Action != "instance_grants_set" {
		t.Errorf("audit action: got %q, want instance_grants_set", q.auditAppends[0].Action)
	}
	if q.auditAppends[0].ActorUserID != grantedBy {
		t.Errorf("audit actor: got %v, want %v", q.auditAppends[0].ActorUserID, grantedBy)
	}
	_ = rows
	_ = version
	_ = toolB
}

// Phase 7: AppendInstanceRestartAudit writes an `instance_restart` row.
func TestAppendInstanceRestartAudit(t *testing.T) {
	q := &fakeToolQueries{}
	svc := tools.NewService(q)
	actor := uuid.New()
	org := uuid.New()
	instance := uuid.New()

	svc.AppendInstanceRestartAudit(context.Background(), actor, org, instance)

	if len(q.auditAppends) != 1 {
		t.Fatalf("expected 1 audit row, got %d", len(q.auditAppends))
	}
	got := q.auditAppends[0]
	if got.Action != "instance_restart" {
		t.Errorf("action: got %q, want instance_restart", got.Action)
	}
	if got.ActorUserID != actor {
		t.Errorf("actor: got %v, want %v", got.ActorUserID, actor)
	}
	if !got.OrgID.Valid || got.OrgID.Bytes != org {
		t.Errorf("org: got %+v, want valid uuid %v", got.OrgID, org)
	}
	if !got.InstanceID.Valid || got.InstanceID.Bytes != instance {
		t.Errorf("instance: got %+v, want valid uuid %v", got.InstanceID, instance)
	}
	if got.ToolID.Valid {
		t.Errorf("tool: expected NULL for instance_restart action, got valid %v", got.ToolID)
	}
}

func TestSetInstanceGrants_OrgGuardRejects(t *testing.T) {
	orgID := uuid.New()
	otherOrg := uuid.New()
	q := &fakeToolQueries{guardOrgID: orgID}
	svc := tools.NewService(q, tools.WithTransactor(&fakeTransactor{q: q}))

	_, _, err := svc.SetInstanceGrants(context.Background(), uuid.New(), otherOrg, uuid.New(), nil)
	if !errors.Is(err, tools.ErrInstanceNotForOrg) {
		t.Fatalf("expected ErrInstanceNotForOrg, got %v", err)
	}
	if q.revokedAll != 0 || len(q.insertedGrants) != 0 {
		t.Errorf("guard should fire before any DB writes; revokes=%d inserts=%d", q.revokedAll, len(q.insertedGrants))
	}
}

func TestSetInstanceGrants_InvalidScopeRejectsBeforeWrites(t *testing.T) {
	orgID := uuid.New()
	tool := db.Tool{
		ID:         uuid.New(),
		ToolsetKey: "terminal",
		ScopeShape: []byte(`{"command_allowlist":{"type":"regex_list","description":"cmds","default_deny":true}}`),
	}
	q := &fakeToolQueries{tool: tool, guardOrgID: orgID}
	svc := tools.NewService(q, tools.WithTransactor(&fakeTransactor{q: q}))

	_, _, err := svc.SetInstanceGrants(context.Background(), uuid.New(), orgID, uuid.New(), []tools.GrantInput{
		{ToolID: tool.ID, ScopeJSON: json.RawMessage(`{"command_allowlist":["[invalid-regex"]}`)},
	})
	if !errors.Is(err, tools.ErrInvalidScope) {
		t.Fatalf("expected ErrInvalidScope, got %v", err)
	}
	if q.revokedAll != 0 || len(q.insertedGrants) != 0 {
		t.Errorf("scope validation must run before any tx; revokes=%d inserts=%d", q.revokedAll, len(q.insertedGrants))
	}
}

func TestSetInstanceGrants_TransactorMissing(t *testing.T) {
	q := &fakeToolQueries{guardOrgID: uuid.New()}
	svc := tools.NewService(q) // no WithTransactor
	_, _, err := svc.SetInstanceGrants(context.Background(), uuid.New(), uuid.New(), uuid.New(), nil)
	if !errors.Is(err, tools.ErrTransactorMissing) {
		t.Fatalf("expected ErrTransactorMissing, got %v", err)
	}
}

func TestSetInstanceGrants_CredentialMissing(t *testing.T) {
	orgID := uuid.New()
	tool := db.Tool{
		ID:              uuid.New(),
		ToolsetKey:      "web",
		ScopeShape:      []byte(`{}`),
		RequiredEnvVars: []string{"EXA_API_KEY"},
	}
	q := &fakeToolQueries{tool: tool, guardOrgID: orgID}
	svc := tools.NewService(q, tools.WithTransactor(&fakeTransactor{q: q}))

	_, _, err := svc.SetInstanceGrants(context.Background(), uuid.New(), orgID, uuid.New(), []tools.GrantInput{
		{ToolID: tool.ID, ScopeJSON: nil}, // no CredentialStorageRef
	})
	if !errors.Is(err, tools.ErrCredentialMissing) {
		t.Fatalf("expected ErrCredentialMissing, got %v", err)
	}
}

func TestSetInstanceGrants_EmptyGrantSetRevokesAll(t *testing.T) {
	orgID := uuid.New()
	q := &fakeToolQueries{guardOrgID: orgID}
	svc := tools.NewService(q, tools.WithTransactor(&fakeTransactor{q: q}))

	_, _, err := svc.SetInstanceGrants(context.Background(), uuid.New(), orgID, uuid.New(), nil)
	if err != nil {
		t.Fatalf("unexpected error: %v", err)
	}
	if q.revokedAll != 1 {
		t.Errorf("expected revoke-all even on empty grant set, got %d", q.revokedAll)
	}
	if len(q.insertedGrants) != 0 {
		t.Errorf("expected no inserts on empty grant set, got %d", len(q.insertedGrants))
	}
	if q.bumpedVersion != 1 {
		t.Errorf("expected version bump on empty grant set (revoke counts as a change), got %d", q.bumpedVersion)
	}
}

func TestGetInstanceGrants_OrgGuardRejects(t *testing.T) {
	orgID := uuid.New()
	q := &fakeToolQueries{guardOrgID: orgID}
	svc := tools.NewService(q)
	_, err := svc.GetInstanceGrants(context.Background(), uuid.New(), uuid.New())
	if !errors.Is(err, tools.ErrInstanceNotForOrg) {
		t.Fatalf("expected ErrInstanceNotForOrg, got %v", err)
	}
}

func TestSetOrgCuration_HappyPath(t *testing.T) {
	orgID := uuid.New()
	tool := db.Tool{ID: uuid.New(), HarnessAdapterID: uuid.New(), AdapterVersion: "v2026.4.23"}
	q := &fakeToolQueries{
		tool: tool,
		curationRows: []db.ListOrgToolCurationRow{
			{ID: tool.ID, EnabledForOrg: false},
		},
	}
	svc := tools.NewService(q)
	row, err := svc.SetOrgCuration(context.Background(), orgID, tool.ID, uuid.New(), false)
	if err != nil {
		t.Fatalf("unexpected: %v", err)
	}
	if row.EnabledForOrg {
		t.Errorf("expected enabled=false echoed, got true")
	}
}

func TestListAvailableForOrg_EmptyAdapterVersionResolves(t *testing.T) {
	q := &fakeToolQueries{
		curationRows: []db.ListOrgToolCurationRow{{ToolsetKey: "web"}},
	}
	svc := tools.NewService(q)
	rows, err := svc.ListAvailableForOrg(context.Background(), uuid.New(), uuid.New(), "")
	if err != nil {
		t.Fatalf("unexpected: %v", err)
	}
	if len(rows) != 1 {
		t.Errorf("expected 1 row, got %d", len(rows))
	}
}

// ─── Phase 7 hardening — credential reattachment + audit-failure-doesn't-rollback ───

// TestSetInstanceGrants_ReattachesCredentialFromPriorGrant pins the v1.5 Pillar
// B post-review fix (changelog 0.13.9): when the FE sends an empty
// credential_storage_ref on edit, the BE must reattach from the prior active
// grant for the same tool. Without this, every inspector save on a credential-
// bearing toolset would silently strip the stored credential reference (or
// trip ErrCredentialMissing on tools with required_env_vars).
func TestSetInstanceGrants_ReattachesCredentialFromPriorGrant(t *testing.T) {
	orgID := uuid.New()
	instanceID := uuid.New()
	grantedBy := uuid.New()

	tool := db.Tool{
		ID:              uuid.New(),
		ToolsetKey:      "web",
		ScopeShape:      []byte(`{"url_allowlist":{"type":"pattern_list","description":"URLs","default_deny":true}}`),
		RequiredEnvVars: []string{"EXA_API_KEY"},
	}
	priorRef := "fly:" + instanceID.String() + ":EXA_API_KEY"
	q := &fakeToolQueries{
		toolByID:   map[uuid.UUID]db.Tool{tool.ID: tool},
		guardOrgID: orgID,
		grantRows: []db.ListInstanceToolGrantsRow{{
			ID:                   uuid.New(),
			AgentInstanceID:      instanceID,
			ToolID:               tool.ID,
			CredentialStorageRef: &priorRef,
			ToolsetKey:           tool.ToolsetKey,
		}},
	}
	svc := tools.NewService(q, tools.WithTransactor(&fakeTransactor{q: q}))

	// Caller sends scope edit with empty CredentialStorageRef — the FE never
	// re-sends the opaque ref it doesn't have access to.
	_, _, err := svc.SetInstanceGrants(context.Background(), instanceID, orgID, grantedBy, []tools.GrantInput{
		{ToolID: tool.ID, ScopeJSON: json.RawMessage(`{"url_allowlist":["*.acme.com"]}`)},
	})
	if err != nil {
		t.Fatalf("unexpected error: %v", err)
	}
	if len(q.insertedGrants) != 1 {
		t.Fatalf("expected 1 insert, got %d", len(q.insertedGrants))
	}
	got := q.insertedGrants[0].CredentialStorageRef
	if got == nil || *got != priorRef {
		t.Fatalf("credential_storage_ref reattachment broken: got %v, want pointer to %q", got, priorRef)
	}
}

// TestSetInstanceGrants_ExplicitCredentialOverridesPrior: when the caller
// supplies a non-empty CredentialStorageRef, that takes precedence over any
// prior. (Future-proofs for the v1.6 in-flight credential rotation flow.)
func TestSetInstanceGrants_ExplicitCredentialOverridesPrior(t *testing.T) {
	orgID := uuid.New()
	instanceID := uuid.New()

	tool := db.Tool{
		ID:              uuid.New(),
		ToolsetKey:      "web",
		ScopeShape:      []byte(`{}`),
		RequiredEnvVars: []string{"EXA_API_KEY"},
	}
	priorRef := "fly:old:EXA_API_KEY"
	newRef := "fly:new:EXA_API_KEY"
	q := &fakeToolQueries{
		toolByID:   map[uuid.UUID]db.Tool{tool.ID: tool},
		guardOrgID: orgID,
		grantRows: []db.ListInstanceToolGrantsRow{{
			ID:                   uuid.New(),
			AgentInstanceID:      instanceID,
			ToolID:               tool.ID,
			CredentialStorageRef: &priorRef,
			ToolsetKey:           tool.ToolsetKey,
		}},
	}
	svc := tools.NewService(q, tools.WithTransactor(&fakeTransactor{q: q}))

	_, _, err := svc.SetInstanceGrants(context.Background(), instanceID, orgID, uuid.New(), []tools.GrantInput{
		{ToolID: tool.ID, CredentialStorageRef: newRef},
	})
	if err != nil {
		t.Fatalf("unexpected: %v", err)
	}
	got := q.insertedGrants[0].CredentialStorageRef
	if got == nil || *got != newRef {
		t.Fatalf("explicit credential ref ignored: got %v, want %q", got, newRef)
	}
}

// TestSetInstanceGrants_NoPriorAndNoCredentialErrors pins that adding a brand-
// new credential-bearing toolset (prior empty, incoming empty) still trips
// ErrCredentialMissing — the gate is not weakened by the reattachment path.
func TestSetInstanceGrants_NoPriorAndNoCredentialErrors(t *testing.T) {
	orgID := uuid.New()
	tool := db.Tool{
		ID:              uuid.New(),
		ToolsetKey:      "web",
		ScopeShape:      []byte(`{}`),
		RequiredEnvVars: []string{"EXA_API_KEY"},
	}
	q := &fakeToolQueries{
		toolByID:   map[uuid.UUID]db.Tool{tool.ID: tool},
		guardOrgID: orgID,
		// no prior grants
	}
	svc := tools.NewService(q, tools.WithTransactor(&fakeTransactor{q: q}))

	_, _, err := svc.SetInstanceGrants(context.Background(), uuid.New(), orgID, uuid.New(), []tools.GrantInput{
		{ToolID: tool.ID},
	})
	if !errors.Is(err, tools.ErrCredentialMissing) {
		t.Fatalf("expected ErrCredentialMissing, got %v", err)
	}
}

// TestSetInstanceGrants_AuditFailureDoesNotRollback pins the contract documented
// at service.go's auditAppend: audit-write failure is logging-only and must NOT
// roll back the surrounding business write. A bad audit table state should not
// prevent operators from changing tool grants.
func TestSetInstanceGrants_AuditFailureDoesNotRollback(t *testing.T) {
	orgID := uuid.New()
	tool := db.Tool{
		ID:         uuid.New(),
		ToolsetKey: "code_execution",
		ScopeShape: []byte(`{}`),
	}
	q := &fakeToolQueries{
		toolByID:   map[uuid.UUID]db.Tool{tool.ID: tool},
		guardOrgID: orgID,
		auditErr:   errors.New("simulated audit-table outage"),
	}
	svc := tools.NewService(q, tools.WithTransactor(&fakeTransactor{q: q}))

	_, _, err := svc.SetInstanceGrants(context.Background(), uuid.New(), orgID, uuid.New(), []tools.GrantInput{
		{ToolID: tool.ID},
	})
	if err != nil {
		t.Fatalf("audit failure leaked into business return: %v", err)
	}
	if q.revokedAll != 1 || len(q.insertedGrants) != 1 || q.bumpedVersion != 1 {
		t.Errorf("business write did not commit despite audit failure: revokes=%d inserts=%d bumps=%d",
			q.revokedAll, len(q.insertedGrants), q.bumpedVersion)
	}
}
