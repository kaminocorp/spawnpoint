package agents_test

import (
	"context"
	"errors"
	"sync/atomic"
	"testing"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5"

	"github.com/hejijunhao/corellia/backend/internal/agents"
	"github.com/hejijunhao/corellia/backend/internal/db"
	"github.com/hejijunhao/corellia/backend/internal/deploy"
	corelliav1 "github.com/hejijunhao/corellia/backend/internal/gen/corellia/v1"
)

// ---------- Fakes ----------

// fakeQueries records every call and returns scripted values. Each
// method is independently settable so a test can inject precisely
// what it needs and leave the rest as benign defaults.
type fakeQueries struct {
	listRows    []db.ListAgentTemplatesRow
	listErr     error
	tmpl        db.AgentTemplate
	tmplErr     error
	target      db.DeployTarget
	targetErr   error
	insertedRow db.AgentInstance
	insertErr   error
	insertCalls int32
	secretErr   error
	secretCalls int32
	setRefErr   error
	listInst    []db.ListAgentInstancesByOrgRow
	listInstErr error
	getInst     db.GetAgentInstanceByIDRow
	getInstErr  error
	reapIDs     []uuid.UUID
	reapErr     error

	// status-flip counters; tests assert on these.
	stoppedCalls   int32
	destroyedCalls int32
	failedCalls    int32
	runningCalls   int32
}

func (f *fakeQueries) ListAgentTemplates(_ context.Context) ([]db.ListAgentTemplatesRow, error) {
	return f.listRows, f.listErr
}
func (f *fakeQueries) GetAgentTemplateByID(_ context.Context, _ uuid.UUID) (db.AgentTemplate, error) {
	return f.tmpl, f.tmplErr
}
func (f *fakeQueries) GetDeployTargetByName(_ context.Context, _ string) (db.DeployTarget, error) {
	return f.target, f.targetErr
}
func (f *fakeQueries) InsertAgentInstance(_ context.Context, p db.InsertAgentInstanceParams) (db.AgentInstance, error) {
	atomic.AddInt32(&f.insertCalls, 1)
	if f.insertErr != nil {
		return db.AgentInstance{}, f.insertErr
	}
	row := f.insertedRow
	row.ID = uuid.New() // unique per call so SpawnN's parallel inserts don't collide
	row.Name = p.Name
	row.AgentTemplateID = p.AgentTemplateID
	row.OwnerUserID = p.OwnerUserID
	row.OrgID = p.OrgID
	row.DeployTargetID = p.DeployTargetID
	row.ModelProvider = p.ModelProvider
	row.ModelName = p.ModelName
	row.Status = "pending"
	return row, nil
}
func (f *fakeQueries) InsertSecret(_ context.Context, _ db.InsertSecretParams) (db.Secret, error) {
	atomic.AddInt32(&f.secretCalls, 1)
	return db.Secret{}, f.secretErr
}
func (f *fakeQueries) SetAgentInstanceDeployRef(_ context.Context, _ db.SetAgentInstanceDeployRefParams) error {
	return f.setRefErr
}
func (f *fakeQueries) SetAgentInstanceRunning(_ context.Context, _ uuid.UUID) error {
	atomic.AddInt32(&f.runningCalls, 1)
	return nil
}
func (f *fakeQueries) SetAgentInstanceStopped(_ context.Context, _ uuid.UUID) error {
	atomic.AddInt32(&f.stoppedCalls, 1)
	return nil
}
func (f *fakeQueries) SetAgentInstanceDestroyed(_ context.Context, _ uuid.UUID) error {
	atomic.AddInt32(&f.destroyedCalls, 1)
	return nil
}
func (f *fakeQueries) SetAgentInstanceFailed(_ context.Context, _ uuid.UUID) error {
	atomic.AddInt32(&f.failedCalls, 1)
	return nil
}
func (f *fakeQueries) ListAgentInstancesByOrg(_ context.Context, _ uuid.UUID) ([]db.ListAgentInstancesByOrgRow, error) {
	return f.listInst, f.listInstErr
}
func (f *fakeQueries) GetAgentInstanceByID(_ context.Context, _ db.GetAgentInstanceByIDParams) (db.GetAgentInstanceByIDRow, error) {
	return f.getInst, f.getInstErr
}
func (f *fakeQueries) ReapStalePendingInstances(_ context.Context) ([]uuid.UUID, error) {
	return f.reapIDs, f.reapErr
}

type fakeAdapters struct {
	adapter db.HarnessAdapter
	err     error
}

func (f *fakeAdapters) Get(_ context.Context, _ uuid.UUID) (db.HarnessAdapter, error) {
	return f.adapter, f.err
}

// fakeDeployTarget records SpawnSpec inputs and returns canned
// SpawnResults. errInjector lets per-method failure injection.
type fakeDeployTarget struct {
	kind        string
	spawnResult deploy.SpawnResult
	spawnErr    error
	stopErr     error
	destroyErr  error
	healthSeq   []deploy.HealthStatus
	healthIdx   int32
	healthErr   error

	spawnCount   int32
	stopCount    int32
	destroyCount int32
	lastSpec     deploy.SpawnSpec
}

func (f *fakeDeployTarget) Kind() string { return f.kind }
func (f *fakeDeployTarget) Spawn(_ context.Context, spec deploy.SpawnSpec) (deploy.SpawnResult, error) {
	atomic.AddInt32(&f.spawnCount, 1)
	f.lastSpec = spec
	if f.spawnErr != nil {
		return deploy.SpawnResult{}, f.spawnErr
	}
	return f.spawnResult, nil
}
func (f *fakeDeployTarget) Stop(_ context.Context, _ string) error {
	atomic.AddInt32(&f.stopCount, 1)
	return f.stopErr
}
func (f *fakeDeployTarget) Destroy(_ context.Context, _ string) error {
	atomic.AddInt32(&f.destroyCount, 1)
	return f.destroyErr
}
func (f *fakeDeployTarget) Health(_ context.Context, _ string) (deploy.HealthStatus, error) {
	idx := int(atomic.AddInt32(&f.healthIdx, 1) - 1)
	if f.healthErr != nil {
		return deploy.HealthUnknown, f.healthErr
	}
	if idx >= len(f.healthSeq) {
		return deploy.HealthStarting, nil
	}
	return f.healthSeq[idx], nil
}

// fakeResolver returns a single target keyed by Kind().
type fakeResolver struct {
	target deploy.DeployTarget
	err    error
}

func (f *fakeResolver) For(_ context.Context, _ string) (deploy.DeployTarget, error) {
	if f.err != nil {
		return nil, f.err
	}
	return f.target, nil
}

// fakeTransactor satisfies agents.Transactor by running the closure
// in-place against the test's fakeQueries — no real BeginTx, since
// the fake's "DB" is just struct fields. The production PgxTransactor
// is exercised end-to-end by the integration smoke, not unit tests.
type fakeTransactor struct {
	q *fakeQueries
}

func (f *fakeTransactor) WithSpawnTx(_ context.Context, fn func(agents.SpawnTx) error) error {
	return fn(f.q)
}

// ---------- Helpers ----------

func newSpawnReadyHarness() (*fakeQueries, *fakeAdapters, *fakeDeployTarget, *fakeResolver) {
	q := &fakeQueries{
		tmpl: db.AgentTemplate{
			ID:               uuid.New(),
			Name:             "Hermes",
			HarnessAdapterID: uuid.New(),
		},
		target: db.DeployTarget{
			ID:   uuid.New(),
			Name: "fly",
			Kind: "fly",
		},
		insertedRow: db.AgentInstance{},
	}
	a := &fakeAdapters{
		adapter: db.HarnessAdapter{
			ID:                  q.tmpl.HarnessAdapterID,
			HarnessName:         "hermes",
			AdapterImageRef:     "ghcr.io/example/hermes-adapter@sha256:" + repeatHex(64),
			UpstreamImageDigest: "sha256:" + repeatHex(64),
		},
	}
	d := &fakeDeployTarget{
		kind: "fly",
		spawnResult: deploy.SpawnResult{
			ExternalRef: "fly-app:corellia-agent-abcdef12",
			MachineID:   "machine-1",
		},
	}
	r := &fakeResolver{target: d}
	return q, a, d, r
}

func repeatHex(n int) string {
	out := make([]byte, n)
	for i := range out {
		out[i] = 'a'
	}
	return string(out)
}

func validSpawnInput() agents.SpawnInput {
	return agents.SpawnInput{
		TemplateID:  uuid.New(),
		OrgID:       uuid.New(),
		OwnerUserID: uuid.New(),
		Name:        "smoke-01",
		Provider:    "openrouter",
		ModelName:   "anthropic/claude-opus-4.6",
		APIKey:      "sk-or-v1-fake",
	}
}

// ---------- M2 holdover tests (still green) ----------

func TestListAgentTemplates_HappyPath(t *testing.T) {
	row := db.ListAgentTemplatesRow{
		ID:            uuid.New(),
		Name:          "Hermes",
		Description:   "Tool-using agent.",
		DefaultConfig: []byte(`{}`),
	}
	q := &fakeQueries{listRows: []db.ListAgentTemplatesRow{row}}
	s := agents.NewService(q, &fakeAdapters{}, &fakeResolver{}, &fakeTransactor{q: q})

	got, err := s.ListAgentTemplates(context.Background())
	if err != nil {
		t.Fatalf("unexpected error: %v", err)
	}
	if len(got) != 1 {
		t.Fatalf("len(got): want 1, got %d", len(got))
	}
	if got[0].GetName() != row.Name {
		t.Errorf("Name: got %q, want %q", got[0].GetName(), row.Name)
	}
}

func TestListAgentTemplates_Empty(t *testing.T) {
	q := &fakeQueries{listRows: nil}
	s := agents.NewService(q, &fakeAdapters{}, &fakeResolver{}, &fakeTransactor{q: q})

	got, err := s.ListAgentTemplates(context.Background())
	if err != nil {
		t.Fatalf("unexpected error: %v", err)
	}
	if got == nil {
		t.Fatal("want non-nil empty slice (pinned wire-shape contract), got nil")
	}
	if len(got) != 0 {
		t.Fatalf("len(got): want 0, got %d", len(got))
	}
}

// rows is the M2 test field name for fakeQueries.listRows; preserve so
// the M2 test reads identically. Compatibility shim.
type _ = struct{}

// ---------- Phase 2 — Spawn ----------

func TestSpawn_HappyPath(t *testing.T) {
	q, a, d, r := newSpawnReadyHarness()
	s := agents.NewService(q, a, r, &fakeTransactor{q: q})

	in := validSpawnInput()
	got, err := s.Spawn(context.Background(), in)
	if err != nil {
		t.Fatalf("Spawn: %v", err)
	}
	if got.GetStatus() != "pending" {
		t.Errorf("Status: got %q, want %q", got.GetStatus(), "pending")
	}
	if got.GetDeployExternalRef() != d.spawnResult.ExternalRef {
		t.Errorf("DeployExternalRef: got %q, want %q", got.GetDeployExternalRef(), d.spawnResult.ExternalRef)
	}
	if got.GetLogsUrl() == "" {
		t.Error("LogsUrl: want non-empty (Fly app set)")
	}
	if atomic.LoadInt32(&d.spawnCount) != 1 {
		t.Errorf("DeployTarget.Spawn calls: got %d, want 1", d.spawnCount)
	}
	// API key must travel through the env map exactly once, never logged.
	if d.lastSpec.Env["CORELLIA_MODEL_API_KEY"] != in.APIKey {
		t.Error("API key not forwarded to deploy spec")
	}
	if d.lastSpec.Env["CORELLIA_AGENT_ID"] == "" {
		t.Error("CORELLIA_AGENT_ID missing from deploy spec env")
	}
}

func TestSpawn_TemplateNotFound(t *testing.T) {
	q, a, _, r := newSpawnReadyHarness()
	q.tmplErr = pgx.ErrNoRows
	s := agents.NewService(q, a, r, &fakeTransactor{q: q})

	_, err := s.Spawn(context.Background(), validSpawnInput())
	if !errors.Is(err, agents.ErrTemplateNotFound) {
		t.Fatalf("err: got %v, want ErrTemplateNotFound", err)
	}
}

func TestSpawn_InvalidName(t *testing.T) {
	cases := []struct {
		label string
		name  string
	}{
		{"empty", ""},
		{"whitespace", "   "},
		{"too long", string(make([]byte, 200))},
	}
	for _, tc := range cases {
		t.Run(tc.label, func(t *testing.T) {
			q, a, _, r := newSpawnReadyHarness()
			s := agents.NewService(q, a, r, &fakeTransactor{q: q})

			in := validSpawnInput()
			in.Name = tc.name
			_, err := s.Spawn(context.Background(), in)
			if !errors.Is(err, agents.ErrInvalidName) {
				t.Fatalf("err: got %v, want ErrInvalidName", err)
			}
		})
	}
}

func TestSpawn_InvalidProvider(t *testing.T) {
	q, a, _, r := newSpawnReadyHarness()
	s := agents.NewService(q, a, r, &fakeTransactor{q: q})

	in := validSpawnInput()
	in.Provider = "google"
	_, err := s.Spawn(context.Background(), in)
	if !errors.Is(err, agents.ErrInvalidProvider) {
		t.Fatalf("err: got %v, want ErrInvalidProvider", err)
	}
}

func TestSpawn_MissingAPIKey(t *testing.T) {
	q, a, _, r := newSpawnReadyHarness()
	s := agents.NewService(q, a, r, &fakeTransactor{q: q})

	in := validSpawnInput()
	in.APIKey = ""
	_, err := s.Spawn(context.Background(), in)
	if !errors.Is(err, agents.ErrMissingAPIKey) {
		t.Fatalf("err: got %v, want ErrMissingAPIKey", err)
	}
}

func TestSpawn_FlyFailureRedacted(t *testing.T) {
	q, a, d, r := newSpawnReadyHarness()
	d.spawnErr = errors.New("fly: 429 Too Many Requests at https://api.fly.io/v1/secrets/abc123")
	s := agents.NewService(q, a, r, &fakeTransactor{q: q})

	_, err := s.Spawn(context.Background(), validSpawnInput())
	if !errors.Is(err, agents.ErrFlyAPI) {
		t.Fatalf("err: got %v, want ErrFlyAPI", err)
	}
	// Decision 25: the upstream Fly error must not leak through. Test
	// strict equality against the redacted sentinel — wrapping would
	// expose the inner message.
	if err.Error() != agents.ErrFlyAPI.Error() {
		t.Errorf("redaction failed: %q (want %q)", err.Error(), agents.ErrFlyAPI.Error())
	}
}

func TestSpawn_TargetUnavailable(t *testing.T) {
	q, a, _, r := newSpawnReadyHarness()
	r.err = deploy.ErrTargetNotConfigured
	s := agents.NewService(q, a, r, &fakeTransactor{q: q})

	_, err := s.Spawn(context.Background(), validSpawnInput())
	if !errors.Is(err, agents.ErrTargetUnavailable) {
		t.Fatalf("err: got %v, want ErrTargetUnavailable", err)
	}
}

// ---------- Phase 2 — SpawnN ----------

func TestSpawnN_NamingAndCount(t *testing.T) {
	cases := []struct {
		label    string
		count    int
		prefix   string
		expected []string
	}{
		{"single-digit width", 5, "alpha", []string{"alpha-1", "alpha-2", "alpha-3", "alpha-4", "alpha-5"}},
		{"two-digit width pads", 10, "fanout", []string{
			"fanout-01", "fanout-02", "fanout-03", "fanout-04", "fanout-05",
			"fanout-06", "fanout-07", "fanout-08", "fanout-09", "fanout-10",
		}},
	}
	for _, tc := range cases {
		t.Run(tc.label, func(t *testing.T) {
			q, a, d, r := newSpawnReadyHarness()
			s := agents.NewService(q, a, r, &fakeTransactor{q: q})

			got, err := s.SpawnN(context.Background(), agents.SpawnNInput{
				TemplateID:  uuid.New(),
				OrgID:       uuid.New(),
				OwnerUserID: uuid.New(),
				NamePrefix:  tc.prefix,
				Count:       tc.count,
				Provider:    "openrouter",
				ModelName:   "anthropic/claude-opus-4.6",
				APIKey:      "sk-or-v1-fake",
			})
			if err != nil {
				t.Fatalf("SpawnN: %v", err)
			}
			if len(got) != tc.count {
				t.Fatalf("len(got): want %d, got %d", tc.count, len(got))
			}
			gotNames := make([]string, len(got))
			for i, inst := range got {
				gotNames[i] = inst.GetName()
			}
			for i, want := range tc.expected {
				if gotNames[i] != want {
					t.Errorf("name[%d]: got %q, want %q", i, gotNames[i], want)
				}
			}
			if int(atomic.LoadInt32(&d.spawnCount)) != tc.count {
				t.Errorf("DeployTarget.Spawn count: got %d, want %d", d.spawnCount, tc.count)
			}
		})
	}
}

func TestSpawnN_LimitExceeded(t *testing.T) {
	q, a, _, r := newSpawnReadyHarness()
	s := agents.NewService(q, a, r, &fakeTransactor{q: q})

	_, err := s.SpawnN(context.Background(), agents.SpawnNInput{
		TemplateID:  uuid.New(),
		OrgID:       uuid.New(),
		OwnerUserID: uuid.New(),
		NamePrefix:  "boom",
		Count:       11,
		Provider:    "openrouter",
		ModelName:   "x",
		APIKey:      "k",
	})
	if !errors.Is(err, agents.ErrSpawnLimit) {
		t.Fatalf("err: got %v, want ErrSpawnLimit", err)
	}
}

func TestSpawnN_ZeroCount(t *testing.T) {
	q, a, _, r := newSpawnReadyHarness()
	s := agents.NewService(q, a, r, &fakeTransactor{q: q})

	_, err := s.SpawnN(context.Background(), agents.SpawnNInput{
		TemplateID:  uuid.New(),
		OrgID:       uuid.New(),
		OwnerUserID: uuid.New(),
		NamePrefix:  "boom",
		Count:       0,
		Provider:    "openrouter",
		ModelName:   "x",
		APIKey:      "k",
	})
	if !errors.Is(err, agents.ErrSpawnLimit) {
		t.Fatalf("err: got %v, want ErrSpawnLimit", err)
	}
}

// ---------- Phase 2 — Stop / Destroy / List / Get ----------

func TestStop_RunningTransitions(t *testing.T) {
	q, a, d, r := newSpawnReadyHarness()
	ref := "fly-app:corellia-agent-deadbeef"
	q.getInst = db.GetAgentInstanceByIDRow{
		ID:                uuid.New(),
		Status:            "running",
		DeployExternalRef: &ref,
		TemplateName:      "Hermes",
		ModelProvider:     "openrouter",
	}
	s := agents.NewService(q, a, r, &fakeTransactor{q: q})

	_, err := s.Stop(context.Background(), q.getInst.ID, uuid.New())
	if err != nil {
		t.Fatalf("Stop: %v", err)
	}
	if atomic.LoadInt32(&d.stopCount) != 1 {
		t.Errorf("DeployTarget.Stop count: got %d, want 1", d.stopCount)
	}
	if atomic.LoadInt32(&q.stoppedCalls) != 1 {
		t.Errorf("SetAgentInstanceStopped count: got %d, want 1", q.stoppedCalls)
	}
}

func TestStop_NonRunningNoOp(t *testing.T) {
	q, a, d, r := newSpawnReadyHarness()
	q.getInst = db.GetAgentInstanceByIDRow{
		ID:     uuid.New(),
		Status: "pending",
	}
	s := agents.NewService(q, a, r, &fakeTransactor{q: q})

	_, err := s.Stop(context.Background(), q.getInst.ID, uuid.New())
	if err != nil {
		t.Fatalf("Stop: %v", err)
	}
	if atomic.LoadInt32(&d.stopCount) != 0 {
		t.Errorf("DeployTarget.Stop count: got %d, want 0 on pending", d.stopCount)
	}
	if atomic.LoadInt32(&q.stoppedCalls) != 0 {
		t.Errorf("SetAgentInstanceStopped count: got %d, want 0", q.stoppedCalls)
	}
}

func TestStop_InstanceNotFound(t *testing.T) {
	q, a, _, r := newSpawnReadyHarness()
	q.getInstErr = pgx.ErrNoRows
	s := agents.NewService(q, a, r, &fakeTransactor{q: q})

	_, err := s.Stop(context.Background(), uuid.New(), uuid.New())
	if !errors.Is(err, agents.ErrInstanceNotFound) {
		t.Fatalf("err: got %v, want ErrInstanceNotFound", err)
	}
}

func TestDestroy_HappyPath(t *testing.T) {
	q, a, d, r := newSpawnReadyHarness()
	ref := "fly-app:corellia-agent-deadbeef"
	q.getInst = db.GetAgentInstanceByIDRow{
		ID:                uuid.New(),
		Status:            "running",
		DeployExternalRef: &ref,
		ModelProvider:     "openrouter",
	}
	s := agents.NewService(q, a, r, &fakeTransactor{q: q})

	_, err := s.Destroy(context.Background(), q.getInst.ID, uuid.New())
	if err != nil {
		t.Fatalf("Destroy: %v", err)
	}
	if atomic.LoadInt32(&d.destroyCount) != 1 {
		t.Errorf("DeployTarget.Destroy count: got %d, want 1", d.destroyCount)
	}
	if atomic.LoadInt32(&q.destroyedCalls) != 1 {
		t.Errorf("SetAgentInstanceDestroyed count: got %d, want 1", q.destroyedCalls)
	}
}

func TestDestroy_AlreadyDestroyedNoOp(t *testing.T) {
	q, a, d, r := newSpawnReadyHarness()
	q.getInst = db.GetAgentInstanceByIDRow{
		ID:     uuid.New(),
		Status: "destroyed",
	}
	s := agents.NewService(q, a, r, &fakeTransactor{q: q})

	_, err := s.Destroy(context.Background(), q.getInst.ID, uuid.New())
	if err != nil {
		t.Fatalf("Destroy: %v", err)
	}
	if atomic.LoadInt32(&d.destroyCount) != 0 {
		t.Errorf("DeployTarget.Destroy count: got %d, want 0 on already-destroyed", d.destroyCount)
	}
}

func TestList_ProtoConversion(t *testing.T) {
	q, a, _, r := newSpawnReadyHarness()
	q.listInst = []db.ListAgentInstancesByOrgRow{
		{
			ID:            uuid.New(),
			Name:          "alpha",
			Status:        "running",
			ModelProvider: "anthropic",
			ModelName:     "claude-opus-4-7",
			TemplateName:  "Hermes",
		},
		{
			ID:            uuid.New(),
			Name:          "beta",
			Status:        "pending",
			ModelProvider: "openrouter",
			ModelName:     "anthropic/claude-opus-4.6",
			TemplateName:  "Hermes",
		},
	}
	s := agents.NewService(q, a, r, &fakeTransactor{q: q})

	got, err := s.List(context.Background(), uuid.New())
	if err != nil {
		t.Fatalf("List: %v", err)
	}
	if len(got) != 2 {
		t.Fatalf("len(got): want 2, got %d", len(got))
	}
	if got[0].GetProvider() != corelliav1.ModelProvider_ANTHROPIC {
		t.Errorf("Provider[0]: got %v, want ANTHROPIC", got[0].GetProvider())
	}
	if got[1].GetProvider() != corelliav1.ModelProvider_OPENROUTER {
		t.Errorf("Provider[1]: got %v, want OPENROUTER", got[1].GetProvider())
	}
}

func TestList_Empty(t *testing.T) {
	q, a, _, r := newSpawnReadyHarness()
	s := agents.NewService(q, a, r, &fakeTransactor{q: q})

	got, err := s.List(context.Background(), uuid.New())
	if err != nil {
		t.Fatalf("List: %v", err)
	}
	if got == nil || len(got) != 0 {
		t.Fatalf("want non-nil empty slice, got %v", got)
	}
}

func TestProviderFromProto(t *testing.T) {
	cases := []struct {
		in   corelliav1.ModelProvider
		want string
	}{
		{corelliav1.ModelProvider_ANTHROPIC, "anthropic"},
		{corelliav1.ModelProvider_OPENAI, "openai"},
		{corelliav1.ModelProvider_OPENROUTER, "openrouter"},
		{corelliav1.ModelProvider_MODEL_PROVIDER_UNSPECIFIED, ""},
	}
	for _, tc := range cases {
		if got := agents.ProviderFromProto(tc.in); got != tc.want {
			t.Errorf("ProviderFromProto(%v): got %q, want %q", tc.in, got, tc.want)
		}
	}
}

// ---------- Phase 2 — ReapStalePending ----------

func TestReapStalePending(t *testing.T) {
	want := []uuid.UUID{uuid.New(), uuid.New()}
	q, a, _, r := newSpawnReadyHarness()
	q.reapIDs = want
	s := agents.NewService(q, a, r, &fakeTransactor{q: q})

	got, err := s.ReapStalePending(context.Background())
	if err != nil {
		t.Fatalf("ReapStalePending: %v", err)
	}
	if len(got) != len(want) {
		t.Fatalf("len: got %d, want %d", len(got), len(want))
	}
}
