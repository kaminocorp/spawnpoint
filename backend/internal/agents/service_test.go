package agents_test

import (
	"context"
	"encoding/base64"
	"errors"
	"io"
	"net/http"
	"strings"
	"sync/atomic"
	"testing"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5"

	"github.com/hejijunhao/corellia/backend/internal/agents"
	"github.com/hejijunhao/corellia/backend/internal/db"
	"github.com/hejijunhao/corellia/backend/internal/deploy"
	corelliav1 "github.com/hejijunhao/corellia/backend/internal/gen/corellia/v1"
)

// chatHTTPFake records the last request and returns a scripted
// response. M-chat Phase 4 plan: "table-driven tests with a
// chatTransport interface stub (so the HTTP call is fakeable)".
type chatHTTPFake struct {
	respStatus int
	respBody   string
	doErr      error

	calls   int32
	lastReq *http.Request
}

func (f *chatHTTPFake) Do(req *http.Request) (*http.Response, error) {
	atomic.AddInt32(&f.calls, 1)
	f.lastReq = req
	if f.doErr != nil {
		return nil, f.doErr
	}
	status := f.respStatus
	if status == 0 {
		status = http.StatusOK
	}
	return &http.Response{
		StatusCode: status,
		Body:       io.NopCloser(strings.NewReader(f.respBody)),
		Header:     make(http.Header),
	}, nil
}

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

	// M5 fleet-control. agentVolumes is keyed by instance ID.
	agentVolumes               map[uuid.UUID][]db.AgentVolume
	listVolumesErr             error
	updateDeployConfigErr      error
	updateDeployConfigCalls    int32
	lastUpdateDeployConfig     db.UpdateAgentDeployConfigParams
	updateReplicasErr          error
	updateReplicasCalls        int32
	lastUpdateReplicas         db.UpdateAgentReplicasParams
	updateInstanceVolSizeErr   error
	updateInstanceVolSizeCalls int32
	lastUpdateInstanceVolSize  db.UpdateAgentInstanceVolumeSizeParams
	updateVolSizeErr           error
	updateVolSizeCalls         int32
	bulkUpdateErr              error
	bulkUpdateCalls            int32
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

func (f *fakeQueries) UpdateAgentDeployConfig(_ context.Context, arg db.UpdateAgentDeployConfigParams) error {
	atomic.AddInt32(&f.updateDeployConfigCalls, 1)
	f.lastUpdateDeployConfig = arg
	return f.updateDeployConfigErr
}
func (f *fakeQueries) UpdateAgentReplicas(_ context.Context, arg db.UpdateAgentReplicasParams) error {
	atomic.AddInt32(&f.updateReplicasCalls, 1)
	f.lastUpdateReplicas = arg
	return f.updateReplicasErr
}
func (f *fakeQueries) UpdateAgentInstanceVolumeSize(_ context.Context, arg db.UpdateAgentInstanceVolumeSizeParams) error {
	atomic.AddInt32(&f.updateInstanceVolSizeCalls, 1)
	f.lastUpdateInstanceVolSize = arg
	return f.updateInstanceVolSizeErr
}
func (f *fakeQueries) UpdateAgentVolumeSize(_ context.Context, _ db.UpdateAgentVolumeSizeParams) error {
	atomic.AddInt32(&f.updateVolSizeCalls, 1)
	return f.updateVolSizeErr
}
func (f *fakeQueries) BulkUpdateAgentDeployConfig(_ context.Context, _ db.BulkUpdateAgentDeployConfigParams) error {
	atomic.AddInt32(&f.bulkUpdateCalls, 1)
	return f.bulkUpdateErr
}
func (f *fakeQueries) ListAgentVolumesByInstance(_ context.Context, instanceID uuid.UUID) ([]db.AgentVolume, error) {
	if f.listVolumesErr != nil {
		return nil, f.listVolumesErr
	}
	return f.agentVolumes[instanceID], nil
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
	lastCfg      deploy.DeployConfig

	// M5 fleet-control injection points.
	updateKind          deploy.UpdateKind
	updateErr           error
	updateCount         int32
	previewKind         deploy.UpdateKind
	previewErr          error
	previewCount        int32
	startErr            error
	startCount          int32
	listRegions         []deploy.Region
	listRegionsErr      error
	placement           deploy.PlacementResult
	placementErr        error
	machines            []deploy.MachineState
	listMachinesErr     error
	ensureVolume        deploy.VolumeRef
	ensureVolumeErr     error
	extendVolumeRestart bool
	extendVolumeErr     error

	// M-chat Phase 4: GetAppSecret stub. getAppSecretValues is keyed
	// by secret key name; missing keys return ("", nil) — i.e.
	// "secret name registered but value not surfaced", same shape
	// flapsClientFake produces.
	getAppSecretValues map[string]string
	getAppSecretErr    error
	getAppSecretCalls  int32
}

func (f *fakeDeployTarget) Kind() string { return f.kind }
func (f *fakeDeployTarget) Spawn(_ context.Context, spec deploy.SpawnSpec, cfg deploy.DeployConfig) (deploy.SpawnResult, error) {
	atomic.AddInt32(&f.spawnCount, 1)
	f.lastSpec = spec
	f.lastCfg = cfg
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
func (f *fakeDeployTarget) Health(_ context.Context, _ string, _ bool) (deploy.HealthStatus, error) {
	idx := int(atomic.AddInt32(&f.healthIdx, 1) - 1)
	if f.healthErr != nil {
		return deploy.HealthUnknown, f.healthErr
	}
	if idx >= len(f.healthSeq) {
		return deploy.HealthStarting, nil
	}
	return f.healthSeq[idx], nil
}

// M5 fleet-control: every new DeployTarget method tracks its call
// count and accepts canned responses + per-method error injection.
// Tests assert on the counts to pin the order-of-operations
// invariants from plan §4 Phase 4.
func (f *fakeDeployTarget) Update(_ context.Context, _ string, cfg deploy.DeployConfig) (deploy.UpdateKind, error) {
	atomic.AddInt32(&f.updateCount, 1)
	f.lastCfg = cfg
	if f.updateErr != nil {
		return "", f.updateErr
	}
	if f.updateKind == "" {
		return deploy.UpdateLiveApplied, nil
	}
	return f.updateKind, nil
}
func (f *fakeDeployTarget) PreviewUpdate(_ context.Context, _ string, cfg deploy.DeployConfig) (deploy.UpdateKind, error) {
	atomic.AddInt32(&f.previewCount, 1)
	f.lastCfg = cfg
	if f.previewErr != nil {
		return "", f.previewErr
	}
	if f.previewKind == "" {
		return deploy.UpdateLiveApplied, nil
	}
	return f.previewKind, nil
}
func (f *fakeDeployTarget) Start(_ context.Context, _ string) error {
	atomic.AddInt32(&f.startCount, 1)
	return f.startErr
}
func (f *fakeDeployTarget) ListRegions(_ context.Context) ([]deploy.Region, error) {
	return f.listRegions, f.listRegionsErr
}
func (f *fakeDeployTarget) CheckPlacement(_ context.Context, _ deploy.DeployConfig) (deploy.PlacementResult, error) {
	if f.placementErr != nil {
		return deploy.PlacementResult{}, f.placementErr
	}
	if f.placement.Available || f.placement.Reason != "" || len(f.placement.AlternateRegions) > 0 {
		return f.placement, nil
	}
	return deploy.PlacementResult{Available: true}, nil
}
func (f *fakeDeployTarget) ListMachines(_ context.Context, _ string) ([]deploy.MachineState, error) {
	return f.machines, f.listMachinesErr
}
func (f *fakeDeployTarget) EnsureVolume(_ context.Context, _ string, region string, sizeGB int) (deploy.VolumeRef, error) {
	if f.ensureVolumeErr != nil {
		return deploy.VolumeRef{}, f.ensureVolumeErr
	}
	if f.ensureVolume.VolumeID != "" {
		return f.ensureVolume, nil
	}
	return deploy.VolumeRef{VolumeID: "vol_fake", Region: region, SizeGB: sizeGB}, nil
}
func (f *fakeDeployTarget) ExtendVolume(_ context.Context, _ string, _ string, _ int) (bool, error) {
	return f.extendVolumeRestart, f.extendVolumeErr
}

func (f *fakeDeployTarget) GetAppSecret(_ context.Context, _ string, key string) (string, error) {
	atomic.AddInt32(&f.getAppSecretCalls, 1)
	if f.getAppSecretErr != nil {
		return "", f.getAppSecretErr
	}
	return f.getAppSecretValues[key], nil
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

func (f *fakeTransactor) WithResizeVolumeTx(_ context.Context, fn func(agents.ResizeVolumeTx) error) error {
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

// M-chat Phase 3: chat-enabled spawn asserts on the secret-row + env
// fan-out.
//
// Two invariants. (1) Two audit rows insert when ChatEnabled=true
// (CORELLIA_MODEL_API_KEY *and* CORELLIA_SIDECAR_AUTH_TOKEN), exactly
// one when ChatEnabled=false. (2) The deploy spec's Env map carries
// CORELLIA_CHAT_ENABLED=true plus a non-empty CORELLIA_SIDECAR_AUTH_TOKEN
// when chat is on, and neither key when chat is off (byte-equivalent
// to the M5 spawn-spec shape).
func TestSpawn_ChatEnabled_PlumbsTokenAndSecrets(t *testing.T) {
	q, a, d, r := newSpawnReadyHarness()
	s := agents.NewService(q, a, r, &fakeTransactor{q: q})

	in := validSpawnInput()
	in.DeployConfig.ChatEnabled = true
	if _, err := s.Spawn(context.Background(), in); err != nil {
		t.Fatalf("Spawn: %v", err)
	}

	// Two secret rows = MODEL_API_KEY + SIDECAR_AUTH_TOKEN.
	if got := atomic.LoadInt32(&q.secretCalls); got != 2 {
		t.Errorf("InsertSecret calls = %d, want 2 (model key + chat token)", got)
	}

	if got := d.lastSpec.Env["CORELLIA_CHAT_ENABLED"]; got != "true" {
		t.Errorf("CORELLIA_CHAT_ENABLED env = %q, want %q (entrypoint default-deny literal)", got, "true")
	}
	tok := d.lastSpec.Env["CORELLIA_SIDECAR_AUTH_TOKEN"]
	if tok == "" {
		t.Fatal("CORELLIA_SIDECAR_AUTH_TOKEN env is empty; want a generated token")
	}
	// Token shape: 32 bytes base64-RawURL = 43 chars. Plan decision 5:
	// per-instance 32-byte URL-safe random.
	if got := base64.RawURLEncoding.DecodedLen(len(tok)); got != 32 {
		t.Errorf("token decoded len = %d, want 32 (decision 5)", got)
	}
	if _, err := base64.RawURLEncoding.DecodeString(tok); err != nil {
		t.Errorf("token does not parse as base64-RawURL: %v", err)
	}
}

func TestSpawn_ChatDisabled_OmitsChatPlumbing(t *testing.T) {
	q, a, d, r := newSpawnReadyHarness()
	s := agents.NewService(q, a, r, &fakeTransactor{q: q})

	// Default validSpawnInput has ChatEnabled=false (Go zero) — the
	// canonical M5 byte-equivalent path.
	if _, err := s.Spawn(context.Background(), validSpawnInput()); err != nil {
		t.Fatalf("Spawn: %v", err)
	}

	if got := atomic.LoadInt32(&q.secretCalls); got != 1 {
		t.Errorf("InsertSecret calls = %d, want 1 (model key only — no chat audit row)", got)
	}
	if got, ok := d.lastSpec.Env["CORELLIA_CHAT_ENABLED"]; ok {
		t.Errorf("CORELLIA_CHAT_ENABLED env present (=%q); want absent for chat-disabled spawn", got)
	}
	if got, ok := d.lastSpec.Env["CORELLIA_SIDECAR_AUTH_TOKEN"]; ok {
		t.Errorf("CORELLIA_SIDECAR_AUTH_TOKEN env present (=%q); want absent for chat-disabled spawn", got)
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

// ---------- Phase 4 — Spawn DeployConfig validation + persist ----------

func TestSpawn_PersistsDeployConfigInTx(t *testing.T) {
	q, a, d, r := newSpawnReadyHarness()
	s := agents.NewService(q, a, r, &fakeTransactor{q: q})

	in := validSpawnInput()
	in.DeployConfig = deploy.DeployConfig{
		Region:          "lhr",
		CPUKind:         "shared",
		CPUs:            2,
		MemoryMB:        1024,
		RestartPolicy:   "on-failure",
		LifecycleMode:   "always-on",
		DesiredReplicas: 3,
		VolumeSizeGB:    5,
	}
	if _, err := s.Spawn(context.Background(), in); err != nil {
		t.Fatalf("Spawn: %v", err)
	}
	if atomic.LoadInt32(&q.updateDeployConfigCalls) != 1 {
		t.Errorf("UpdateAgentDeployConfig calls: got %d, want 1 (must run inside spawn tx)", q.updateDeployConfigCalls)
	}
	if got := q.lastUpdateDeployConfig.Region; got != "lhr" {
		t.Errorf("persisted Region: got %q, want %q", got, "lhr")
	}
	if got := q.lastUpdateDeployConfig.DesiredReplicas; got != 3 {
		t.Errorf("persisted DesiredReplicas: got %d, want 3", got)
	}
	if got := q.lastUpdateDeployConfig.VolumeSizeGb; got != 5 {
		t.Errorf("persisted VolumeSizeGB: got %d, want 5", got)
	}
	if d.lastCfg.Region != "lhr" || d.lastCfg.DesiredReplicas != 3 {
		t.Errorf("deployer.Spawn cfg not threaded: %+v", d.lastCfg)
	}
}

func TestSpawn_RejectsInvalidVolumeSize(t *testing.T) {
	q, a, _, r := newSpawnReadyHarness()
	s := agents.NewService(q, a, r, &fakeTransactor{q: q})
	in := validSpawnInput()
	in.DeployConfig = deploy.DeployConfig{VolumeSizeGB: 99999} // out of [1,500]
	_, err := s.Spawn(context.Background(), in)
	if !errors.Is(err, deploy.ErrInvalidVolumeSize) {
		t.Fatalf("err: got %v, want ErrInvalidVolumeSize", err)
	}
	if atomic.LoadInt32(&q.insertCalls) != 0 {
		t.Errorf("InsertAgentInstance called %d times, want 0 (validation must precede DB writes)", q.insertCalls)
	}
}

func TestSpawn_RejectsInvalidLifecycle(t *testing.T) {
	q, a, _, r := newSpawnReadyHarness()
	s := agents.NewService(q, a, r, &fakeTransactor{q: q})
	in := validSpawnInput()
	in.DeployConfig = deploy.DeployConfig{LifecycleMode: "idle-on-demand"}
	_, err := s.Spawn(context.Background(), in)
	if !errors.Is(err, deploy.ErrLifecycleUnsupported) {
		t.Fatalf("err: got %v, want ErrLifecycleUnsupported", err)
	}
}

// ---------- Phase 4 — UpdateDeployConfig ----------

func newReadyInstance(externalRef string) db.GetAgentInstanceByIDRow {
	id := uuid.New()
	ref := externalRef
	return db.GetAgentInstanceByIDRow{
		ID:                id,
		Name:              "alpha",
		AgentTemplateID:   uuid.New(),
		OwnerUserID:       uuid.New(),
		OrgID:             uuid.New(),
		DeployTargetID:    uuid.New(),
		DeployExternalRef: &ref,
		ModelProvider:     "openrouter",
		ModelName:         "claude",
		Status:            "running",
		ConfigOverrides:   []byte(`{}`),
		Region:            "iad",
		CpuKind:           "shared",
		Cpus:              1,
		MemoryMb:          256,
		RestartPolicy:     "on-failure",
		RestartMaxRetries: 3,
		LifecycleMode:     "always-on",
		DesiredReplicas:   1,
		VolumeSizeGb:      1,
		TemplateName:      "Hermes",
	}
}

func TestUpdateDeployConfig_DryRunDoesNotMutate(t *testing.T) {
	q, a, d, r := newSpawnReadyHarness()
	row := newReadyInstance("fly-app:corellia-agent-deadbeef")
	q.getInst = row
	d.previewKind = deploy.UpdateLiveApplied
	s := agents.NewService(q, a, r, &fakeTransactor{q: q})

	cfg := deployConfigFromRow(row)
	cfg.MemoryMB = 1024
	res, err := s.UpdateDeployConfig(context.Background(), row.ID, row.OrgID, cfg, true)
	if err != nil {
		t.Fatalf("UpdateDeployConfig: %v", err)
	}
	if res.Kind != deploy.UpdateLiveApplied {
		t.Errorf("Kind = %v, want LiveApplied", res.Kind)
	}
	if atomic.LoadInt32(&d.updateCount) != 0 {
		t.Errorf("deployer.Update count: got %d, want 0 (dry run must not mutate)", d.updateCount)
	}
	if atomic.LoadInt32(&q.updateDeployConfigCalls) != 0 {
		t.Errorf("UpdateAgentDeployConfig count: got %d, want 0 (dry run must not persist)", q.updateDeployConfigCalls)
	}
	if atomic.LoadInt32(&d.previewCount) != 1 {
		t.Errorf("PreviewUpdate count: got %d, want 1", d.previewCount)
	}
}

func TestUpdateDeployConfig_ApplyLive(t *testing.T) {
	q, a, d, r := newSpawnReadyHarness()
	row := newReadyInstance("fly-app:corellia-agent-deadbeef")
	q.getInst = row
	d.previewKind = deploy.UpdateLiveApplied
	d.updateKind = deploy.UpdateLiveApplied
	s := agents.NewService(q, a, r, &fakeTransactor{q: q})

	cfg := deployConfigFromRow(row)
	cfg.MemoryMB = 1024
	res, err := s.UpdateDeployConfig(context.Background(), row.ID, row.OrgID, cfg, false)
	if err != nil {
		t.Fatalf("UpdateDeployConfig: %v", err)
	}
	if res.Kind != deploy.UpdateLiveApplied {
		t.Errorf("Kind = %v, want LiveApplied", res.Kind)
	}
	if atomic.LoadInt32(&d.updateCount) != 1 {
		t.Errorf("deployer.Update count: got %d, want 1", d.updateCount)
	}
	if atomic.LoadInt32(&q.updateDeployConfigCalls) != 1 {
		t.Errorf("UpdateAgentDeployConfig count: got %d, want 1", q.updateDeployConfigCalls)
	}
	if got := q.lastUpdateDeployConfig.MemoryMb; got != 1024 {
		t.Errorf("persisted MemoryMB: got %d, want 1024", got)
	}
}

func TestUpdateDeployConfig_PlacementUnavailable(t *testing.T) {
	q, a, d, r := newSpawnReadyHarness()
	row := newReadyInstance("fly-app:corellia-agent-deadbeef")
	q.getInst = row
	d.placement = deploy.PlacementResult{Available: false, Reason: "iad full"}
	s := agents.NewService(q, a, r, &fakeTransactor{q: q})

	cfg := deployConfigFromRow(row)
	_, err := s.UpdateDeployConfig(context.Background(), row.ID, row.OrgID, cfg, false)
	if !errors.Is(err, deploy.ErrPlacementUnavailable) {
		t.Fatalf("err: got %v, want ErrPlacementUnavailable", err)
	}
	if atomic.LoadInt32(&d.updateCount) != 0 {
		t.Errorf("deployer.Update count: got %d, want 0 (placement gate)", d.updateCount)
	}
}

func TestUpdateDeployConfig_RequiresRespawn(t *testing.T) {
	q, a, d, r := newSpawnReadyHarness()
	row := newReadyInstance("fly-app:corellia-agent-deadbeef")
	q.getInst = row
	d.previewKind = deploy.UpdateRequiresRespawn
	d.spawnResult = deploy.SpawnResult{ExternalRef: "fly-app:corellia-agent-newapp01", MachineID: "m-new"}
	s := agents.NewService(q, a, r, &fakeTransactor{q: q})

	cfg := deployConfigFromRow(row)
	cfg.Region = "lhr"
	res, err := s.UpdateDeployConfig(context.Background(), row.ID, row.OrgID, cfg, false)
	if err != nil {
		t.Fatalf("UpdateDeployConfig: %v", err)
	}
	if res.Kind != deploy.UpdateRequiresRespawn {
		t.Errorf("Kind = %v, want RequiresRespawn", res.Kind)
	}
	if atomic.LoadInt32(&d.destroyCount) != 1 {
		t.Errorf("deployer.Destroy count: got %d, want 1", d.destroyCount)
	}
	if atomic.LoadInt32(&d.spawnCount) != 1 {
		t.Errorf("deployer.Spawn count: got %d, want 1 (respawn)", d.spawnCount)
	}
	if atomic.LoadInt32(&d.updateCount) != 0 {
		t.Errorf("deployer.Update count: got %d, want 0 (respawn path skips Update)", d.updateCount)
	}
	if atomic.LoadInt32(&q.updateDeployConfigCalls) != 1 {
		t.Errorf("UpdateAgentDeployConfig count: got %d, want 1", q.updateDeployConfigCalls)
	}
}

// ---------- Phase 4 — ResizeReplicas ----------

func TestResizeReplicas_HappyPath(t *testing.T) {
	q, a, d, r := newSpawnReadyHarness()
	row := newReadyInstance("fly-app:corellia-agent-deadbeef")
	q.getInst = row
	s := agents.NewService(q, a, r, &fakeTransactor{q: q})

	res, err := s.ResizeReplicas(context.Background(), row.ID, row.OrgID, 4)
	if err != nil {
		t.Fatalf("ResizeReplicas: %v", err)
	}
	if res.Kind != deploy.UpdateLiveApplied {
		t.Errorf("Kind = %v, want LiveApplied", res.Kind)
	}
	if atomic.LoadInt32(&q.updateReplicasCalls) != 1 {
		t.Errorf("UpdateAgentReplicas count: got %d, want 1", q.updateReplicasCalls)
	}
	if got := q.lastUpdateReplicas.DesiredReplicas; got != 4 {
		t.Errorf("persisted DesiredReplicas: got %d, want 4", got)
	}
	if d.lastCfg.DesiredReplicas != 4 {
		t.Errorf("deployer.Update cfg.DesiredReplicas: got %d, want 4", d.lastCfg.DesiredReplicas)
	}
}

func TestResizeReplicas_OutOfRange(t *testing.T) {
	q, a, _, r := newSpawnReadyHarness()
	s := agents.NewService(q, a, r, &fakeTransactor{q: q})
	for _, n := range []int{0, -1, 11, 100} {
		_, err := s.ResizeReplicas(context.Background(), uuid.New(), uuid.New(), n)
		if !errors.Is(err, deploy.ErrInvalidSize) {
			t.Errorf("desired=%d: err = %v, want ErrInvalidSize", n, err)
		}
	}
}

// ---------- Phase 4 — ResizeVolume ----------

func TestResizeVolume_HappyPath(t *testing.T) {
	q, a, _, r := newSpawnReadyHarness()
	row := newReadyInstance("fly-app:corellia-agent-deadbeef")
	row.VolumeSizeGb = 1
	q.getInst = row
	q.agentVolumes = map[uuid.UUID][]db.AgentVolume{
		row.ID: {
			{ID: uuid.New(), AgentInstanceID: row.ID, FlyVolumeID: "vol_a", Region: "iad", SizeGb: 1},
			{ID: uuid.New(), AgentInstanceID: row.ID, FlyVolumeID: "vol_b", Region: "iad", SizeGb: 1},
		},
	}
	s := agents.NewService(q, a, r, &fakeTransactor{q: q})

	res, err := s.ResizeVolume(context.Background(), row.ID, row.OrgID, 5)
	if err != nil {
		t.Fatalf("ResizeVolume: %v", err)
	}
	if res.Kind != deploy.UpdateLiveApplied {
		t.Errorf("Kind = %v, want LiveApplied", res.Kind)
	}
	if got := atomic.LoadInt32(&q.updateInstanceVolSizeCalls); got != 1 {
		t.Errorf("parent volume_size_gb update count: got %d, want 1", got)
	}
	if got := atomic.LoadInt32(&q.updateVolSizeCalls); got != 2 {
		t.Errorf("per-volume size_gb update count: got %d, want 2 (one per volume)", got)
	}
}

func TestResizeVolume_RejectsShrink(t *testing.T) {
	q, a, _, r := newSpawnReadyHarness()
	row := newReadyInstance("fly-app:corellia-agent-deadbeef")
	row.VolumeSizeGb = 5
	q.getInst = row
	s := agents.NewService(q, a, r, &fakeTransactor{q: q})

	_, err := s.ResizeVolume(context.Background(), row.ID, row.OrgID, 1)
	if !errors.Is(err, deploy.ErrVolumeShrink) {
		t.Fatalf("err: got %v, want ErrVolumeShrink", err)
	}
}

func TestResizeVolume_OutOfRange(t *testing.T) {
	q, a, _, r := newSpawnReadyHarness()
	s := agents.NewService(q, a, r, &fakeTransactor{q: q})
	for _, n := range []int{0, -1, 501, 9999} {
		_, err := s.ResizeVolume(context.Background(), uuid.New(), uuid.New(), n)
		if !errors.Is(err, deploy.ErrInvalidVolumeSize) {
			t.Errorf("size=%d: err = %v, want ErrInvalidVolumeSize", n, err)
		}
	}
}

// ---------- Phase 4 — StartInstance ----------

func TestStartInstance_HappyPath(t *testing.T) {
	q, a, d, r := newSpawnReadyHarness()
	row := newReadyInstance("fly-app:corellia-agent-deadbeef")
	q.getInst = row
	s := agents.NewService(q, a, r, &fakeTransactor{q: q})

	if _, err := s.StartInstance(context.Background(), row.ID, row.OrgID); err != nil {
		t.Fatalf("StartInstance: %v", err)
	}
	if atomic.LoadInt32(&d.startCount) != 1 {
		t.Errorf("deployer.Start count: got %d, want 1", d.startCount)
	}
}

func TestStartInstance_NotFound(t *testing.T) {
	q, a, _, r := newSpawnReadyHarness()
	q.getInstErr = pgx.ErrNoRows
	s := agents.NewService(q, a, r, &fakeTransactor{q: q})
	_, err := s.StartInstance(context.Background(), uuid.New(), uuid.New())
	if !errors.Is(err, agents.ErrInstanceNotFound) {
		t.Fatalf("err: got %v, want ErrInstanceNotFound", err)
	}
}

// ---------- Phase 4 — BulkUpdateDeployConfig ----------

func TestBulkUpdateDeployConfig_PartialFailure(t *testing.T) {
	q, a, d, r := newSpawnReadyHarness()
	id1 := uuid.New()
	id2 := uuid.New()
	id3 := uuid.New()
	orgID := uuid.New()
	// fakeQueries.getInst is shared across calls — for partial-failure we
	// need different rows per ID. Hack: set a callback-style return below.
	rows := map[uuid.UUID]db.GetAgentInstanceByIDRow{
		id1: newReadyInstance("fly-app:corellia-agent-aaaaaaaa"),
		id2: newReadyInstance(""), // pending — no external ref → ErrInstanceNotFound
		id3: newReadyInstance("fly-app:corellia-agent-cccccccc"),
	}
	for k, v := range rows {
		v.ID = k
		v.OrgID = orgID
		rows[k] = v
	}
	q.getInst = rows[id1] // baseline
	// Override the fakeQueries' getter via a small wrapper. Easiest: load
	// rows by iteration in the helper and have a callback. Since
	// fakeQueries.getInst is a single value, we instead route through a
	// closure-aware fake by mutating per call — implemented via a pre-test
	// stub here:
	originalGet := q.getInstErr
	defer func() { q.getInstErr = originalGet }()
	// Use the queries-level callback: replace GetAgentInstanceByID via a
	// dedicated map lookup.
	q.agentVolumes = map[uuid.UUID][]db.AgentVolume{}
	q2 := &perIDQueries{fakeQueries: q, byID: rows}
	s := agents.NewService(q2, a, r, &fakeTransactor{q: q})

	delta := agents.BulkConfigDelta{
		Region: "iad", CPUKind: "shared", CPUs: 1, MemoryMB: 256,
		RestartPolicy: "on-failure", RestartMaxRetries: 3,
		LifecycleMode: "always-on", DesiredReplicas: 1,
	}
	results, err := s.BulkUpdateDeployConfig(context.Background(),
		[]uuid.UUID{id1, id2, id3}, orgID, delta, false)
	if err != nil {
		t.Fatalf("BulkUpdateDeployConfig: %v", err)
	}
	if len(results) != 3 {
		t.Fatalf("results len: got %d, want 3", len(results))
	}

	byID := map[uuid.UUID]agents.BulkResult{}
	for _, r := range results {
		byID[r.InstanceID] = r
	}
	if byID[id1].Err != nil {
		t.Errorf("id1: unexpected err %v", byID[id1].Err)
	}
	if !errors.Is(byID[id2].Err, agents.ErrInstanceNotFound) {
		t.Errorf("id2: err = %v, want ErrInstanceNotFound (no external ref)", byID[id2].Err)
	}
	if byID[id3].Err != nil {
		t.Errorf("id3: unexpected err %v", byID[id3].Err)
	}
	// Two successful instances → two deployer.Update calls.
	if got := atomic.LoadInt32(&d.updateCount); got != 2 {
		t.Errorf("deployer.Update count: got %d, want 2 (one per successful row)", got)
	}
}

func TestBulkUpdateDeployConfig_OverLimit(t *testing.T) {
	q, a, _, r := newSpawnReadyHarness()
	s := agents.NewService(q, a, r, &fakeTransactor{q: q})

	ids := make([]uuid.UUID, 51)
	for i := range ids {
		ids[i] = uuid.New()
	}
	_, err := s.BulkUpdateDeployConfig(context.Background(), ids, uuid.New(), agents.BulkConfigDelta{}, false)
	if !errors.Is(err, agents.ErrBulkLimit) {
		t.Fatalf("err: got %v, want ErrBulkLimit", err)
	}
}

func TestBulkUpdateDeployConfig_ContextCancellation(t *testing.T) {
	q, a, _, r := newSpawnReadyHarness()
	s := agents.NewService(q, a, r, &fakeTransactor{q: q})

	ids := make([]uuid.UUID, 3)
	for i := range ids {
		ids[i] = uuid.New()
	}

	ctx, cancel := context.WithCancel(context.Background())
	cancel() // cancelled before the call

	_, err := s.BulkUpdateDeployConfig(ctx, ids, uuid.New(), agents.BulkConfigDelta{}, false)
	if err == nil {
		t.Fatal("expected error from cancelled context, got nil")
	}
}

// ---------- Phase 4 — DetectDrift ----------

func TestDetectDrift_CountMismatch(t *testing.T) {
	q, a, d, r := newSpawnReadyHarness()
	row := newReadyInstance("fly-app:corellia-agent-deadbeef")
	row.DesiredReplicas = 3
	q.getInst = row
	d.machines = []deploy.MachineState{
		{ID: "m1", Region: "iad", CPUKind: "shared", CPUs: 1, MemoryMB: 256},
	}
	s := agents.NewService(q, a, r, &fakeTransactor{q: q})

	report, err := s.DetectDrift(context.Background(), row.ID, row.OrgID)
	if err != nil {
		t.Fatalf("DetectDrift: %v", err)
	}
	if !containsCategory(report.Categories, agents.DriftCountMismatch) {
		t.Errorf("missing count_mismatch: %v", report.Categories)
	}
}

func TestDetectDrift_SizeMismatch(t *testing.T) {
	q, a, d, r := newSpawnReadyHarness()
	row := newReadyInstance("fly-app:corellia-agent-deadbeef")
	q.getInst = row
	d.machines = []deploy.MachineState{
		{ID: "m1", CPUKind: "shared", CPUs: 4, MemoryMB: 1024}, // differs from row's 1×256
	}
	s := agents.NewService(q, a, r, &fakeTransactor{q: q})

	report, err := s.DetectDrift(context.Background(), row.ID, row.OrgID)
	if err != nil {
		t.Fatalf("DetectDrift: %v", err)
	}
	if !containsCategory(report.Categories, agents.DriftSizeMismatch) {
		t.Errorf("missing size_mismatch: %v", report.Categories)
	}
}

func TestDetectDrift_VolumeUnattached(t *testing.T) {
	q, a, d, r := newSpawnReadyHarness()
	row := newReadyInstance("fly-app:corellia-agent-deadbeef")
	q.getInst = row
	d.machines = []deploy.MachineState{
		{ID: "m1", CPUKind: "shared", CPUs: 1, MemoryMB: 256},
	}
	q.agentVolumes = map[uuid.UUID][]db.AgentVolume{
		row.ID: {
			{ID: uuid.New(), AgentInstanceID: row.ID, FlyVolumeID: "vol_a", SizeGb: 1, FlyMachineID: nil},
		},
	}
	s := agents.NewService(q, a, r, &fakeTransactor{q: q})

	report, err := s.DetectDrift(context.Background(), row.ID, row.OrgID)
	if err != nil {
		t.Fatalf("DetectDrift: %v", err)
	}
	if !containsCategory(report.Categories, agents.DriftVolumeUnattached) {
		t.Errorf("missing volume_unattached: %v", report.Categories)
	}
}

func TestDetectDrift_NoDrift(t *testing.T) {
	q, a, d, r := newSpawnReadyHarness()
	row := newReadyInstance("fly-app:corellia-agent-deadbeef")
	q.getInst = row
	d.machines = []deploy.MachineState{
		{ID: "m1", CPUKind: "shared", CPUs: 1, MemoryMB: 256},
	}
	s := agents.NewService(q, a, r, &fakeTransactor{q: q})

	report, err := s.DetectDrift(context.Background(), row.ID, row.OrgID)
	if err != nil {
		t.Fatalf("DetectDrift: %v", err)
	}
	if len(report.Categories) != 0 {
		t.Errorf("unexpected drift: %v", report.Categories)
	}
}

// ---------- helpers ----------

// deployConfigFromRow mirrors the production helper for tests.
func deployConfigFromRow(r db.GetAgentInstanceByIDRow) deploy.DeployConfig {
	return deploy.DeployConfig{
		Region:            r.Region,
		CPUKind:           r.CpuKind,
		CPUs:              int(r.Cpus),
		MemoryMB:          int(r.MemoryMb),
		RestartPolicy:     r.RestartPolicy,
		RestartMaxRetries: int(r.RestartMaxRetries),
		LifecycleMode:     r.LifecycleMode,
		DesiredReplicas:   int(r.DesiredReplicas),
		VolumeSizeGB:      int(r.VolumeSizeGb),
	}
}

func containsCategory(haystack []agents.DriftCategory, needle agents.DriftCategory) bool {
	for _, c := range haystack {
		if c == needle {
			return true
		}
	}
	return false
}

// perIDQueries layers a per-ID GetAgentInstanceByID lookup on top of
// fakeQueries — the bulk-failure test needs different rows for
// different IDs in one run, which the single-value fakeQueries.getInst
// can't express. Embed + override pattern keeps the shape minimal.
type perIDQueries struct {
	*fakeQueries
	byID map[uuid.UUID]db.GetAgentInstanceByIDRow
}

func (p *perIDQueries) GetAgentInstanceByID(_ context.Context, arg db.GetAgentInstanceByIDParams) (db.GetAgentInstanceByIDRow, error) {
	if row, ok := p.byID[arg.ID]; ok {
		return row, nil
	}
	return db.GetAgentInstanceByIDRow{}, pgx.ErrNoRows
}

// ---------- M-chat Phase 4 — ChatWithAgent ----------

// newChatReadyInstance returns a chat-enabled, running, Fly-backed
// instance row. Tests mutate the fields they care about.
func newChatReadyInstance() db.GetAgentInstanceByIDRow {
	row := newReadyInstance("fly-app:corellia-agent-chatdev")
	row.ChatEnabled = true
	return row
}

func TestChatWithAgent_HappyPath(t *testing.T) {
	q, a, d, r := newSpawnReadyHarness()
	row := newChatReadyInstance()
	q.getInst = row
	d.getAppSecretValues = map[string]string{
		"CORELLIA_SIDECAR_AUTH_TOKEN": "tok-from-fly",
	}
	chat := &chatHTTPFake{
		respStatus: http.StatusOK,
		respBody:   `{"content":"pong"}`,
	}
	s := agents.NewService(q, a, r, &fakeTransactor{q: q}, agents.WithChatHTTPClient(chat))

	got, err := s.ChatWithAgent(context.Background(), row.ID, row.OrgID, "sess-1", "say pong")
	if err != nil {
		t.Fatalf("ChatWithAgent: %v", err)
	}
	if got != "pong" {
		t.Errorf("content = %q, want %q", got, "pong")
	}
	if atomic.LoadInt32(&d.getAppSecretCalls) != 1 {
		t.Errorf("GetAppSecret calls = %d, want 1", d.getAppSecretCalls)
	}
	if atomic.LoadInt32(&chat.calls) != 1 {
		t.Errorf("chatHTTP.Do calls = %d, want 1", chat.calls)
	}
	if chat.lastReq == nil {
		t.Fatal("chatHTTP captured no request")
	}
	// Decision 12: URL is https://corellia-agent-<...>.fly.dev/chat.
	wantURL := "https://corellia-agent-chatdev.fly.dev/chat"
	if got := chat.lastReq.URL.String(); got != wantURL {
		t.Errorf("URL = %q, want %q", got, wantURL)
	}
	// Decision 11: bearer token attached to every proxied request.
	if got := chat.lastReq.Header.Get("Authorization"); got != "Bearer tok-from-fly" {
		t.Errorf("Authorization = %q, want %q", got, "Bearer tok-from-fly")
	}
	if got := chat.lastReq.Header.Get("Content-Type"); got != "application/json" {
		t.Errorf("Content-Type = %q, want application/json", got)
	}
}

func TestChatWithAgent_ChatDisabled(t *testing.T) {
	q, a, d, r := newSpawnReadyHarness()
	row := newChatReadyInstance()
	row.ChatEnabled = false
	q.getInst = row
	chat := &chatHTTPFake{}
	s := agents.NewService(q, a, r, &fakeTransactor{q: q}, agents.WithChatHTTPClient(chat))

	_, err := s.ChatWithAgent(context.Background(), row.ID, row.OrgID, "sess-1", "say pong")
	if !errors.Is(err, agents.ErrChatDisabled) {
		t.Fatalf("err: got %v, want ErrChatDisabled", err)
	}
	if atomic.LoadInt32(&d.getAppSecretCalls) != 0 {
		t.Errorf("GetAppSecret calls = %d, want 0 (gate must precede secret read)", d.getAppSecretCalls)
	}
	if atomic.LoadInt32(&chat.calls) != 0 {
		t.Errorf("chatHTTP.Do calls = %d, want 0 (gate must precede HTTP)", chat.calls)
	}
}

func TestChatWithAgent_InstanceNotFound(t *testing.T) {
	q, a, _, r := newSpawnReadyHarness()
	q.getInstErr = pgx.ErrNoRows
	s := agents.NewService(q, a, r, &fakeTransactor{q: q})

	_, err := s.ChatWithAgent(context.Background(), uuid.New(), uuid.New(), "sess-1", "msg")
	if !errors.Is(err, agents.ErrInstanceNotFound) {
		t.Fatalf("err: got %v, want ErrInstanceNotFound", err)
	}
}

func TestChatWithAgent_PendingNoExternalRef(t *testing.T) {
	q, a, _, r := newSpawnReadyHarness()
	row := newChatReadyInstance()
	row.DeployExternalRef = nil
	q.getInst = row
	s := agents.NewService(q, a, r, &fakeTransactor{q: q})

	_, err := s.ChatWithAgent(context.Background(), row.ID, row.OrgID, "sess-1", "msg")
	if !errors.Is(err, agents.ErrInstanceNotFound) {
		t.Fatalf("err: got %v, want ErrInstanceNotFound (pending row has no app)", err)
	}
}

func TestChatWithAgent_SecretEmptyIsAuthFailure(t *testing.T) {
	q, a, d, r := newSpawnReadyHarness()
	row := newChatReadyInstance()
	q.getInst = row
	// d.getAppSecretValues left nil → fake returns ("", nil),
	// matching the Fly "secret name registered, value not surfaced"
	// drift case the chat path treats as ErrChatAuth.
	d.getAppSecretValues = map[string]string{}
	chat := &chatHTTPFake{}
	s := agents.NewService(q, a, r, &fakeTransactor{q: q}, agents.WithChatHTTPClient(chat))

	_, err := s.ChatWithAgent(context.Background(), row.ID, row.OrgID, "sess-1", "msg")
	if !errors.Is(err, agents.ErrChatAuth) {
		t.Fatalf("err: got %v, want ErrChatAuth", err)
	}
	if atomic.LoadInt32(&chat.calls) != 0 {
		t.Errorf("chatHTTP.Do calls = %d, want 0 (no token → no proxy attempt)", chat.calls)
	}
}

func TestChatWithAgent_SecretReadError(t *testing.T) {
	q, a, d, r := newSpawnReadyHarness()
	row := newChatReadyInstance()
	q.getInst = row
	d.getAppSecretErr = errors.New("flaps: 503 Service Unavailable")
	chat := &chatHTTPFake{}
	s := agents.NewService(q, a, r, &fakeTransactor{q: q}, agents.WithChatHTTPClient(chat))

	_, err := s.ChatWithAgent(context.Background(), row.ID, row.OrgID, "sess-1", "msg")
	if !errors.Is(err, agents.ErrChatUnreachable) {
		t.Fatalf("err: got %v, want ErrChatUnreachable", err)
	}
}

func TestChatWithAgent_Sidecar401(t *testing.T) {
	q, a, d, r := newSpawnReadyHarness()
	row := newChatReadyInstance()
	q.getInst = row
	d.getAppSecretValues = map[string]string{
		"CORELLIA_SIDECAR_AUTH_TOKEN": "stale-token",
	}
	chat := &chatHTTPFake{respStatus: http.StatusUnauthorized}
	s := agents.NewService(q, a, r, &fakeTransactor{q: q}, agents.WithChatHTTPClient(chat))

	_, err := s.ChatWithAgent(context.Background(), row.ID, row.OrgID, "sess-1", "msg")
	if !errors.Is(err, agents.ErrChatAuth) {
		t.Fatalf("err: got %v, want ErrChatAuth (sidecar 401)", err)
	}
}

func TestChatWithAgent_TransportError(t *testing.T) {
	q, a, d, r := newSpawnReadyHarness()
	row := newChatReadyInstance()
	q.getInst = row
	d.getAppSecretValues = map[string]string{
		"CORELLIA_SIDECAR_AUTH_TOKEN": "tok",
	}
	chat := &chatHTTPFake{doErr: errors.New("dial tcp: connection refused")}
	s := agents.NewService(q, a, r, &fakeTransactor{q: q}, agents.WithChatHTTPClient(chat))

	_, err := s.ChatWithAgent(context.Background(), row.ID, row.OrgID, "sess-1", "msg")
	if !errors.Is(err, agents.ErrChatUnreachable) {
		t.Fatalf("err: got %v, want ErrChatUnreachable", err)
	}
}

func TestChatWithAgent_Sidecar5xx(t *testing.T) {
	q, a, d, r := newSpawnReadyHarness()
	row := newChatReadyInstance()
	q.getInst = row
	d.getAppSecretValues = map[string]string{
		"CORELLIA_SIDECAR_AUTH_TOKEN": "tok",
	}
	chat := &chatHTTPFake{respStatus: http.StatusInternalServerError, respBody: `{"detail":"boom"}`}
	s := agents.NewService(q, a, r, &fakeTransactor{q: q}, agents.WithChatHTTPClient(chat))

	_, err := s.ChatWithAgent(context.Background(), row.ID, row.OrgID, "sess-1", "msg")
	if !errors.Is(err, agents.ErrChatUnreachable) {
		t.Fatalf("err: got %v, want ErrChatUnreachable on non-2xx", err)
	}
}
