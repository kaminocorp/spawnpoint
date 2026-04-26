package agents

import (
	"context"
	"errors"
	"fmt"
	"log/slog"
	"strconv"
	"strings"
	"time"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgtype"
	"golang.org/x/sync/errgroup"
	"golang.org/x/sync/semaphore"

	"github.com/hejijunhao/corellia/backend/internal/db"
	"github.com/hejijunhao/corellia/backend/internal/deploy"
	corelliav1 "github.com/hejijunhao/corellia/backend/internal/gen/corellia/v1"
)

// Sentinels — the public contract handlers map to Connect codes
// (httpsrv.agentsErrToConnect). Tests assert via errors.Is so future
// wrapping (fmt.Errorf("...%w", Err)) doesn't break the contract.
var (
	// ErrNotFound — M2 holdover. Retained because handler error mapping
	// already references it (httpsrv.agentsErrToConnect default arm).
	ErrNotFound = errors.New("agent template not found")

	// M4 sentinels.
	ErrTemplateNotFound  = errors.New("agent template not found")
	ErrInvalidName       = errors.New("agent name invalid")
	ErrInvalidProvider   = errors.New("model provider invalid")
	ErrInvalidModel      = errors.New("model name invalid")
	ErrMissingAPIKey     = errors.New("model api key required")
	ErrSpawnLimit        = errors.New("spawn count exceeds limit")
	ErrInstanceNotFound  = errors.New("agent instance not found")
	ErrFlyAPI            = errors.New("upstream provider error") // redacted (decision 25)
	ErrTargetUnavailable = errors.New("deploy target unavailable")

	// M5 fleet-control sentinels. Each maps to a Connect code at the
	// handler layer (Phase 5 sentinel mapping table). Most service-
	// layer paths delegate to the deploy-package sentinels via
	// `errors.Is`; these are the agents-package-side names where the
	// failure is domain-shaped (instance-not-found, bulk size cap)
	// rather than infrastructure-shaped.
	ErrBulkLimit = errors.New("bulk operation count exceeds limit")
)

// Spawn-flow tunables. Decisions 14, 16, 29 in the plan.
const (
	maxNameLen          = 80
	maxNamePrefixLen    = 60
	maxSpawnCount       = 10
	maxBulkCount        = 50 // M5 plan decision 28: bulk apply caps at 50.
	spawnConcurrency    = 3
	bulkConcurrency     = 3
	pollInterval        = 2 * time.Second
	pollBudget          = 90 * time.Second
	flyDeployTargetName = "fly" // server-resolved per decision 5
	flyExternalRefPfx   = "fly-app:"
)

// agentQueries is the narrowed view of db.Queries this service touches.
// Single interface (not split per-table) — the call sites are tightly
// coupled (Spawn touches templates, instances, secrets, deploy_targets
// in one logical operation), and splitting would force the fake to live
// in five places. Same single-interface pattern users.userQueries and
// organizations.orgQueries set in earlier milestones.
type agentQueries interface {
	// M2 — catalog.
	ListAgentTemplates(ctx context.Context) ([]db.ListAgentTemplatesRow, error)

	// M4 — spawn lifecycle.
	GetAgentTemplateByID(ctx context.Context, id uuid.UUID) (db.AgentTemplate, error)
	GetDeployTargetByName(ctx context.Context, name string) (db.DeployTarget, error)
	InsertAgentInstance(ctx context.Context, arg db.InsertAgentInstanceParams) (db.AgentInstance, error)
	InsertSecret(ctx context.Context, arg db.InsertSecretParams) (db.Secret, error)
	SetAgentInstanceDeployRef(ctx context.Context, arg db.SetAgentInstanceDeployRefParams) error
	SetAgentInstanceRunning(ctx context.Context, id uuid.UUID) error
	SetAgentInstanceStopped(ctx context.Context, id uuid.UUID) error
	SetAgentInstanceDestroyed(ctx context.Context, id uuid.UUID) error
	SetAgentInstanceFailed(ctx context.Context, id uuid.UUID) error
	ListAgentInstancesByOrg(ctx context.Context, orgID uuid.UUID) ([]db.ListAgentInstancesByOrgRow, error)
	GetAgentInstanceByID(ctx context.Context, arg db.GetAgentInstanceByIDParams) (db.GetAgentInstanceByIDRow, error)
	ReapStalePendingInstances(ctx context.Context) ([]uuid.UUID, error)

	// M5 — fleet control. UpdateAgentDeployConfig writes the full
	// nine-tuple in one statement; UpdateAgentReplicas /
	// UpdateAgentInstanceVolumeSize are the single-column flows for
	// ResizeReplicas / ResizeVolume; BulkUpdateAgentDeployConfig is
	// the multi-row flow for the fleet bulk-edit surface (Phase 8).
	// agent_volumes reads/writes feed DetectDrift + ResizeVolume.
	UpdateAgentDeployConfig(ctx context.Context, arg db.UpdateAgentDeployConfigParams) error
	UpdateAgentReplicas(ctx context.Context, arg db.UpdateAgentReplicasParams) error
	UpdateAgentInstanceVolumeSize(ctx context.Context, arg db.UpdateAgentInstanceVolumeSizeParams) error
	BulkUpdateAgentDeployConfig(ctx context.Context, arg db.BulkUpdateAgentDeployConfigParams) error
	ListAgentVolumesByInstance(ctx context.Context, agentInstanceID uuid.UUID) ([]db.AgentVolume, error)
	UpdateAgentVolumeSize(ctx context.Context, arg db.UpdateAgentVolumeSizeParams) error
}

// adapterReader is the slice of adapters.Service the spawn flow needs.
// Defined here (not imported as *adapters.Service directly) so tests
// can fake it without standing up the whole adapters package.
type adapterReader interface {
	Get(ctx context.Context, id uuid.UUID) (db.HarnessAdapter, error)
}

type Service struct {
	queries  agentQueries
	adapters adapterReader
	resolver deploy.Resolver
	txr      Transactor
}

// NewService wires the spawn lifecycle's four collaborators.
//
// Plan-vs-reality drift: spawn-flow plan decision 35 specifies a
// map[string]deploy.DeployTarget for the third arg, predating M3.5's
// deploy.Resolver indirection (0.5.1). The Resolver is the post-M3.5
// architecture and the M3.5 plan explicitly named M4 as its first
// reader; passing a resolver instead of a raw map is the
// forward-correction. The txr arg is a Phase 8 addition (decision 27
// step 6 deferred from M4 ship); see transactor.go.
func NewService(queries agentQueries, adapters adapterReader, resolver deploy.Resolver, txr Transactor) *Service {
	return &Service{queries: queries, adapters: adapters, resolver: resolver, txr: txr}
}

// SpawnInput is the resolved, post-auth caller intent. The handler
// translates wire-form (proto request + auth claims) → SpawnInput; the
// service never touches connect.Request or auth.Claims directly.
//
// M5 Phase 4: gains a DeployConfig field. Zero value is accepted as
// "use defaults" — DeployConfig.WithDefaults yields the M4-equivalent
// shape (1 replica, shared/1/256, iad, on-failure×3, always-on, 1GB).
type SpawnInput struct {
	TemplateID   uuid.UUID
	OrgID        uuid.UUID
	OwnerUserID  uuid.UUID
	Name         string
	Provider     string
	ModelName    string
	APIKey       string // SECRET — never logged, never persisted to our DB
	DeployConfig deploy.DeployConfig
}

// SpawnNInput mirrors SpawnInput plus the fan-out shape. Per decision
// 15: all N agents share one APIKey (demo affordance, not production).
// All N spawned agents share the same DeployConfig too — the bulk
// surface assumes uniform per-agent config (per-agent deviation is
// the per-instance UpdateDeployConfig flow).
type SpawnNInput struct {
	TemplateID   uuid.UUID
	OrgID        uuid.UUID
	OwnerUserID  uuid.UUID
	NamePrefix   string
	Count        int
	Provider     string
	ModelName    string
	APIKey       string
	DeployConfig deploy.DeployConfig
}

// ListAgentTemplates returns the M2 catalog. Unchanged contract.
func (s *Service) ListAgentTemplates(ctx context.Context) ([]*corelliav1.AgentTemplate, error) {
	rows, err := s.queries.ListAgentTemplates(ctx)
	if err != nil {
		return nil, err
	}
	out := make([]*corelliav1.AgentTemplate, 0, len(rows))
	for _, r := range rows {
		out = append(out, toProtoTemplate(r))
	}
	return out, nil
}

// Spawn implements decision 27's order of operations. The DB writes
// (steps 5–7) run inside one tx via s.txr.WithTx so the instance row
// and its audit secret row commit atomically — pre-Phase-8 they were
// sequential, and a process crash between them could leave one without
// the other. The Fly call (step 8) sits *outside* the tx so a 1–5s
// network operation doesn't hold a DB connection.
func (s *Service) Spawn(ctx context.Context, in SpawnInput) (*corelliav1.AgentInstance, error) {
	if err := validateSpawn(in.Name, in.Provider, in.ModelName, in.APIKey); err != nil {
		return nil, err
	}
	cfg := in.DeployConfig.WithDefaults()
	if err := cfg.Validate(); err != nil {
		return nil, err
	}

	tmpl, adapter, targetRow, deployer, err := s.resolveSpawnDeps(ctx, in.TemplateID)
	if err != nil {
		return nil, err
	}

	var instance db.AgentInstance
	if err := s.txr.WithSpawnTx(ctx, func(q SpawnTx) error {
		var qErr error
		instance, qErr = q.InsertAgentInstance(ctx, db.InsertAgentInstanceParams{
			Name:            in.Name,
			AgentTemplateID: tmpl.ID,
			OwnerUserID:     in.OwnerUserID,
			OrgID:           in.OrgID,
			DeployTargetID:  targetRow.ID,
			ModelProvider:   in.Provider,
			ModelName:       in.ModelName,
			ConfigOverrides: []byte(`{}`),
		})
		if qErr != nil {
			return fmt.Errorf("agents: insert instance: %w", qErr)
		}

		// Audit row — records *what* secret was set, not its value.
		// Decision 6: storage_ref is opaque. Synthesised from
		// instance.ID + key pre-Fly so the row is insertable before
		// the deploy target assigns an external ref. Future fetch
		// path: deploy target API + (app, key).
		//
		// Policy (Phase 8 pin): one secrets row per *secret-shaped*
		// CORELLIA_* env var, not per CORELLIA_* env var. Today
		// CORELLIA_MODEL_API_KEY is the only credential the spawn
		// flow forwards; CORELLIA_AGENT_ID / CORELLIA_MODEL_PROVIDER
		// / CORELLIA_MODEL_NAME are configuration, not secrets, and
		// don't get audit rows. New secret-shaped vars (e.g.
		// CORELLIA_TOOL_AUTH_TOKEN in v1.5+) each insert their own
		// row here.
		if _, qErr = q.InsertSecret(ctx, db.InsertSecretParams{
			AgentInstanceID: instance.ID,
			KeyName:         "CORELLIA_MODEL_API_KEY",
			StorageRef:      fmt.Sprintf("%s:%s:CORELLIA_MODEL_API_KEY", deployer.Kind(), instance.ID),
		}); qErr != nil {
			return fmt.Errorf("agents: insert secret audit row: %w", qErr)
		}

		// M5 Phase 4: persist the resolved DeployConfig in the same
		// tx. The InsertAgentInstance query relies on column DEFAULTs
		// for the nine new fields (so the M4 shape was preserved at
		// the SQL boundary); UpdateAgentDeployConfig overwrites them
		// with the validated config inside the same atomic boundary.
		// A two-step pattern (insert + update) inside one tx is
		// equivalent to a widened insert; chosen for the smaller
		// SQL-shape change in Phase 1.
		if qErr = q.UpdateAgentDeployConfig(ctx, deployConfigParams(instance.ID, in.OrgID, cfg)); qErr != nil {
			return fmt.Errorf("agents: persist deploy config: %w", qErr)
		}
		// Patch the in-memory copy so the proto projection at the end
		// of Spawn reflects the post-update state — InsertAgentInstance
		// returns the column DEFAULTs, but the cfg the caller asked for
		// is what hit the row in the same tx via UpdateAgentDeployConfig.
		applyDeployConfigToInstance(&instance, cfg)
		return nil
	}); err != nil {
		return nil, err
	}

	// Step 8 — outside any tx. Spawn errors leave the row in 'pending';
	// the boot-time sweep (decision 32) reaps after 5 min. We do *not*
	// flip the row to 'failed' synchronously here so the FE gets to see
	// the pending → failed transition through its normal poll loop
	// rather than a special inline error path.
	// M5 Phase 4: cfg fully owns Region / CPUs / MemoryMB; the
	// per-call SpawnSpec fields (Region/CPUs/MemoryMB) stay empty so
	// FlyDeployTarget reads them from cfg via WithDefaults. The Phase
	// 3 fall-through path is now dormant — preserved on the deploy
	// side as back-compat, unused from here onward.
	result, err := deployer.Spawn(ctx, deploy.SpawnSpec{
		Name:     instance.ID.String(),
		ImageRef: adapter.AdapterImageRef,
		Env: map[string]string{
			"CORELLIA_AGENT_ID":       instance.ID.String(),
			"CORELLIA_MODEL_PROVIDER": in.Provider,
			"CORELLIA_MODEL_NAME":     in.ModelName,
			"CORELLIA_MODEL_API_KEY":  in.APIKey,
		},
	}, cfg)
	if err != nil {
		// Redact the upstream error (decision 25): generic ErrFlyAPI
		// to the caller; full err recorded server-side.
		slog.Error("agents: spawn deploy target",
			"instance_id", instance.ID, "kind", deployer.Kind(), "err", err)
		return nil, ErrFlyAPI
	}

	if err := s.queries.SetAgentInstanceDeployRef(ctx, db.SetAgentInstanceDeployRefParams{
		ID:                instance.ID,
		DeployExternalRef: ptrOf(result.ExternalRef),
	}); err != nil {
		return nil, fmt.Errorf("agents: set deploy ref: %w", err)
	}
	instance.DeployExternalRef = ptrOf(result.ExternalRef)

	// Detached background poll. Per decision 19 the goroutine binds to
	// context.Background(), not the request ctx — the request returns
	// to the caller within ~5s of Fly's response and its ctx dies; the
	// poll outlives it for up to 90s.
	go s.pollHealth(instance.ID, deployer, result.ExternalRef)

	return toProtoInstance(instance, tmpl.Name), nil
}

// SpawnN fans out per decisions 28–29. errgroup so a single failure
// short-circuits the rest (fail-stop is more demo-predictable than
// best-effort partial state). Semaphore caps in-flight Fly calls at 3.
func (s *Service) SpawnN(ctx context.Context, in SpawnNInput) ([]*corelliav1.AgentInstance, error) {
	if in.Count <= 0 || in.Count > maxSpawnCount {
		return nil, ErrSpawnLimit
	}
	if err := validateNamePrefix(in.NamePrefix); err != nil {
		return nil, err
	}
	if err := validateSpawn("placeholder", in.Provider, in.ModelName, in.APIKey); err != nil {
		// validateSpawn re-runs on each per-instance Spawn anyway; the
		// up-front call here surfaces provider/model/key validation
		// before we begin paying for Fly app creates.
		return nil, err
	}

	width := len(strconv.Itoa(in.Count))
	// Pre-allocate so each goroutine writes its disjoint index without
	// a lock. errgroup ordering is racy, but slice element writes at
	// non-overlapping indices are safe under the Go memory model when
	// the slice header itself is not concurrently mutated.
	results := make([]*corelliav1.AgentInstance, in.Count)

	sem := semaphore.NewWeighted(int64(spawnConcurrency))
	g, gctx := errgroup.WithContext(ctx)

	for i := 0; i < in.Count; i++ {
		i := i
		g.Go(func() error {
			if err := sem.Acquire(gctx, 1); err != nil {
				return err
			}
			defer sem.Release(1)

			name := fmt.Sprintf("%s-%0*d", in.NamePrefix, width, i+1)
			inst, err := s.Spawn(gctx, SpawnInput{
				TemplateID:   in.TemplateID,
				OrgID:        in.OrgID,
				OwnerUserID:  in.OwnerUserID,
				Name:         name,
				Provider:     in.Provider,
				ModelName:    in.ModelName,
				APIKey:       in.APIKey,
				DeployConfig: in.DeployConfig,
			})
			if err != nil {
				return err
			}
			// Index-disjoint write — no lock needed; the make() above
			// pre-allocated the slot.
			results[i] = inst
			return nil
		})
	}
	if err := g.Wait(); err != nil {
		return nil, err
	}
	return results, nil
}

// List returns the calling org's agents, newest first.
func (s *Service) List(ctx context.Context, orgID uuid.UUID) ([]*corelliav1.AgentInstance, error) {
	rows, err := s.queries.ListAgentInstancesByOrg(ctx, orgID)
	if err != nil {
		return nil, err
	}
	out := make([]*corelliav1.AgentInstance, 0, len(rows))
	for _, r := range rows {
		out = append(out, toProtoInstanceListRow(r))
	}
	return out, nil
}

// Get fetches one instance with the org-guard at the query layer.
func (s *Service) Get(ctx context.Context, instanceID, orgID uuid.UUID) (*corelliav1.AgentInstance, error) {
	row, err := s.queries.GetAgentInstanceByID(ctx, db.GetAgentInstanceByIDParams{
		ID:    instanceID,
		OrgID: orgID,
	})
	if err != nil {
		if errors.Is(err, pgx.ErrNoRows) {
			return nil, ErrInstanceNotFound
		}
		return nil, err
	}
	return toProtoInstanceGetRow(row), nil
}

// Stop is sync — the Fly call is 1–3s, fits in a request budget
// (decision 23, 43). Idempotent for non-running statuses (silent
// no-op per Q2 — revisit if a user reports confusion).
func (s *Service) Stop(ctx context.Context, instanceID, orgID uuid.UUID) (*corelliav1.AgentInstance, error) {
	row, err := s.queries.GetAgentInstanceByID(ctx, db.GetAgentInstanceByIDParams{ID: instanceID, OrgID: orgID})
	if err != nil {
		if errors.Is(err, pgx.ErrNoRows) {
			return nil, ErrInstanceNotFound
		}
		return nil, err
	}
	if row.Status != "running" {
		return toProtoInstanceGetRow(row), nil
	}
	if err := s.callDeployStop(ctx, row.DeployExternalRef); err != nil {
		return nil, err
	}
	if err := s.queries.SetAgentInstanceStopped(ctx, instanceID); err != nil {
		return nil, fmt.Errorf("agents: set stopped: %w", err)
	}
	return s.Get(ctx, instanceID, orgID)
}

// Destroy is sync; soft-deletes (status='destroyed', row stays for
// audit). Fly app + secrets + image cache go away.
func (s *Service) Destroy(ctx context.Context, instanceID, orgID uuid.UUID) (*corelliav1.AgentInstance, error) {
	row, err := s.queries.GetAgentInstanceByID(ctx, db.GetAgentInstanceByIDParams{ID: instanceID, OrgID: orgID})
	if err != nil {
		if errors.Is(err, pgx.ErrNoRows) {
			return nil, ErrInstanceNotFound
		}
		return nil, err
	}
	if row.Status == "destroyed" {
		return toProtoInstanceGetRow(row), nil
	}
	if err := s.callDeployDestroy(ctx, row.DeployExternalRef); err != nil {
		return nil, err
	}
	if err := s.queries.SetAgentInstanceDestroyed(ctx, instanceID); err != nil {
		return nil, fmt.Errorf("agents: set destroyed: %w", err)
	}
	return s.Get(ctx, instanceID, orgID)
}

// ReapStalePending runs once at boot (decision 32). Returns the IDs of
// reaped rows so cmd/api can log them.
func (s *Service) ReapStalePending(ctx context.Context) ([]uuid.UUID, error) {
	return s.queries.ReapStalePendingInstances(ctx)
}

// resolveSpawnDeps does steps 2–4 of decision 27's order of operations:
// load the template, the harness adapter (for the image ref), the
// deploy_targets row, and resolve the DeployTarget via the resolver.
// Returns the four collaborators Spawn() needs in one fan-in.
func (s *Service) resolveSpawnDeps(
	ctx context.Context, templateID uuid.UUID,
) (db.AgentTemplate, db.HarnessAdapter, db.DeployTarget, deploy.DeployTarget, error) {
	zero := func(err error) (db.AgentTemplate, db.HarnessAdapter, db.DeployTarget, deploy.DeployTarget, error) {
		return db.AgentTemplate{}, db.HarnessAdapter{}, db.DeployTarget{}, nil, err
	}

	tmpl, err := s.queries.GetAgentTemplateByID(ctx, templateID)
	if err != nil {
		if errors.Is(err, pgx.ErrNoRows) {
			return zero(ErrTemplateNotFound)
		}
		return zero(err)
	}
	adapter, err := s.adapters.Get(ctx, tmpl.HarnessAdapterID)
	if err != nil {
		return zero(fmt.Errorf("agents: load adapter: %w", err))
	}
	targetRow, err := s.queries.GetDeployTargetByName(ctx, flyDeployTargetName)
	if err != nil {
		if errors.Is(err, pgx.ErrNoRows) {
			return zero(ErrTargetUnavailable)
		}
		return zero(err)
	}
	deployer, err := s.resolver.For(ctx, targetRow.Kind)
	if err != nil {
		if errors.Is(err, deploy.ErrTargetNotConfigured) {
			return zero(ErrTargetUnavailable)
		}
		return zero(err)
	}
	return tmpl, adapter, targetRow, deployer, nil
}

// callDeployStop / callDeployDestroy — small wrappers that handle the
// "no external ref yet" case gracefully (a pending instance with no
// Fly app should still flip status; nothing to call on the deploy
// side).
func (s *Service) callDeployStop(ctx context.Context, externalRef *string) error {
	target, err := s.flyTarget(ctx)
	if err != nil {
		return err
	}
	if externalRef == nil || *externalRef == "" {
		return nil
	}
	if err := target.Stop(ctx, *externalRef); err != nil {
		slog.Error("agents: deploy stop", "ref", *externalRef, "err", err)
		return ErrFlyAPI
	}
	return nil
}

func (s *Service) callDeployDestroy(ctx context.Context, externalRef *string) error {
	target, err := s.flyTarget(ctx)
	if err != nil {
		return err
	}
	if externalRef == nil || *externalRef == "" {
		return nil
	}
	if err := target.Destroy(ctx, *externalRef); err != nil {
		slog.Error("agents: deploy destroy", "ref", *externalRef, "err", err)
		return ErrFlyAPI
	}
	return nil
}

// flyTarget — v1 hard-resolves to the 'fly' deploy target (decision 5).
// When v1.5 introduces user-configurable targets, this method becomes
// "load the instance's deploy_target row, resolve via kind." For now,
// every Stop/Destroy goes through Fly.
func (s *Service) flyTarget(ctx context.Context) (deploy.DeployTarget, error) {
	target, err := s.resolver.For(ctx, "fly")
	if err != nil {
		if errors.Is(err, deploy.ErrTargetNotConfigured) {
			return nil, ErrTargetUnavailable
		}
		return nil, err
	}
	return target, nil
}

// pollHealth drives pending → running | failed via the DeployTarget's
// Health() probe. Detached context (decision 19): bound to
// context.Background() with a 90s timeout, so the poll outlives the
// HTTP request that triggered it. DB writes use context.Background()
// directly so a poll-timeout-induced failure transition still commits.
func (s *Service) pollHealth(instanceID uuid.UUID, target deploy.DeployTarget, externalRef string) {
	ctx, cancel := context.WithTimeout(context.Background(), pollBudget)
	defer cancel()

	ticker := time.NewTicker(pollInterval)
	defer ticker.Stop()

	probe := func() (deploy.HealthStatus, error) {
		probeCtx, probeCancel := context.WithTimeout(ctx, pollInterval)
		defer probeCancel()
		return target.Health(probeCtx, externalRef)
	}

	for {
		select {
		case <-ctx.Done():
			if err := s.queries.SetAgentInstanceFailed(context.Background(), instanceID); err != nil {
				slog.Error("agents: poll timeout failed-flip", "instance_id", instanceID, "err", err)
			}
			slog.Info("agents: poll timed out", "instance_id", instanceID, "ref", externalRef)
			return
		case <-ticker.C:
			status, err := probe()
			if err != nil {
				slog.Warn("agents: health probe", "instance_id", instanceID, "err", err)
				continue
			}
			if status == deploy.HealthStarted {
				if err := s.queries.SetAgentInstanceRunning(context.Background(), instanceID); err != nil {
					slog.Error("agents: poll running-flip", "instance_id", instanceID, "err", err)
				}
				slog.Info("agents: poll running", "instance_id", instanceID, "ref", externalRef)
				return
			}
			if status == deploy.HealthFailed {
				if err := s.queries.SetAgentInstanceFailed(context.Background(), instanceID); err != nil {
					slog.Error("agents: poll failed-flip", "instance_id", instanceID, "err", err)
				}
				slog.Info("agents: poll failed", "instance_id", instanceID, "ref", externalRef)
				return
			}
		}
	}
}

// validateSpawn applies decision 26's BE-side never-trust-the-client
// checks. model_name length only — provider model lists change too
// often to enumerate (the provider's API will reject an invalid name
// at first /chat call; that's the v1 product gap).
func validateSpawn(name, provider, modelName, apiKey string) error {
	if err := validateName(name); err != nil {
		return err
	}
	if !isValidProvider(provider) {
		return ErrInvalidProvider
	}
	if strings.TrimSpace(modelName) == "" || len(modelName) > 200 {
		return ErrInvalidModel
	}
	if strings.TrimSpace(apiKey) == "" {
		return ErrMissingAPIKey
	}
	return nil
}

func validateName(name string) error {
	trimmed := strings.TrimSpace(name)
	if trimmed == "" || len(trimmed) > maxNameLen {
		return ErrInvalidName
	}
	return nil
}

func validateNamePrefix(prefix string) error {
	trimmed := strings.TrimSpace(prefix)
	if trimmed == "" || len(trimmed) > maxNamePrefixLen {
		return ErrInvalidName
	}
	return nil
}

func isValidProvider(p string) bool {
	switch p {
	case "anthropic", "openai", "openrouter":
		return true
	}
	return false
}

// Proto conversion. Three variants because the three rows are three
// different sqlc-generated types (full table, list-row with join,
// get-row with join). All three converge on *corelliav1.AgentInstance.

func toProtoTemplate(r db.ListAgentTemplatesRow) *corelliav1.AgentTemplate {
	return &corelliav1.AgentTemplate{
		Id:          r.ID.String(),
		Name:        r.Name,
		Description: r.Description,
	}
}

func toProtoInstance(i db.AgentInstance, templateName string) *corelliav1.AgentInstance {
	return &corelliav1.AgentInstance{
		Id:                i.ID.String(),
		Name:              i.Name,
		TemplateId:        i.AgentTemplateID.String(),
		TemplateName:      templateName,
		Provider:          providerToProto(i.ModelProvider),
		ModelName:         i.ModelName,
		Status:            i.Status,
		DeployExternalRef: stringDeref(i.DeployExternalRef),
		LogsUrl:           logsURL(i.DeployExternalRef),
		CreatedAt:         tsToRFC3339(i.CreatedAt),
		LastStartedAt:     tsToRFC3339(i.LastStartedAt),
		LastStoppedAt:     tsToRFC3339(i.LastStoppedAt),
		// M5 deploy-config projection. The Phase 4 spawn-tx patches
		// these fields onto the in-memory row via
		// applyDeployConfigToInstance after the UpdateAgentDeployConfig
		// call, so the Spawn response surfaces the same nine-tuple the
		// caller asked for.
		Region:            i.Region,
		CpuKind:           i.CpuKind,
		Cpus:              i.Cpus,
		MemoryMb:          i.MemoryMb,
		RestartPolicy:     i.RestartPolicy,
		RestartMaxRetries: i.RestartMaxRetries,
		LifecycleMode:     i.LifecycleMode,
		DesiredReplicas:   i.DesiredReplicas,
		VolumeSizeGb:      i.VolumeSizeGb,
	}
}

func toProtoInstanceListRow(r db.ListAgentInstancesByOrgRow) *corelliav1.AgentInstance {
	return &corelliav1.AgentInstance{
		Id:                r.ID.String(),
		Name:              r.Name,
		TemplateId:        r.AgentTemplateID.String(),
		TemplateName:      r.TemplateName,
		Provider:          providerToProto(r.ModelProvider),
		ModelName:         r.ModelName,
		Status:            r.Status,
		DeployExternalRef: stringDeref(r.DeployExternalRef),
		LogsUrl:           logsURL(r.DeployExternalRef),
		CreatedAt:         tsToRFC3339(r.CreatedAt),
		LastStartedAt:     tsToRFC3339(r.LastStartedAt),
		LastStoppedAt:     tsToRFC3339(r.LastStoppedAt),
	}
}

func toProtoInstanceGetRow(r db.GetAgentInstanceByIDRow) *corelliav1.AgentInstance {
	return &corelliav1.AgentInstance{
		Id:                r.ID.String(),
		Name:              r.Name,
		TemplateId:        r.AgentTemplateID.String(),
		TemplateName:      r.TemplateName,
		Provider:          providerToProto(r.ModelProvider),
		ModelName:         r.ModelName,
		Status:            r.Status,
		DeployExternalRef: stringDeref(r.DeployExternalRef),
		LogsUrl:           logsURL(r.DeployExternalRef),
		CreatedAt:         tsToRFC3339(r.CreatedAt),
		LastStartedAt:     tsToRFC3339(r.LastStartedAt),
		LastStoppedAt:     tsToRFC3339(r.LastStoppedAt),
		// M5 deploy-config projection from the Phase 4 widened query.
		// drift_summary + volumes stay nil here — they need separate
		// round-trips (DetectDrift / ListAgentVolumesByInstance) and
		// the M5 inspector calls those RPCs on demand.
		Region:            r.Region,
		CpuKind:           r.CpuKind,
		Cpus:              r.Cpus,
		MemoryMb:          r.MemoryMb,
		RestartPolicy:     r.RestartPolicy,
		RestartMaxRetries: r.RestartMaxRetries,
		LifecycleMode:     r.LifecycleMode,
		DesiredReplicas:   r.DesiredReplicas,
		VolumeSizeGb:      r.VolumeSizeGb,
	}
}

func providerToProto(s string) corelliav1.ModelProvider {
	switch s {
	case "anthropic":
		return corelliav1.ModelProvider_ANTHROPIC
	case "openai":
		return corelliav1.ModelProvider_OPENAI
	case "openrouter":
		return corelliav1.ModelProvider_OPENROUTER
	}
	return corelliav1.ModelProvider_MODEL_PROVIDER_UNSPECIFIED
}

// ProviderFromProto maps the wire enum to the DB-CHECK string. Exposed
// so the handler (Phase 4) can translate proto → SpawnInput.Provider.
// Returns "" for UNSPECIFIED so validateSpawn rejects it.
func ProviderFromProto(p corelliav1.ModelProvider) string {
	switch p {
	case corelliav1.ModelProvider_ANTHROPIC:
		return "anthropic"
	case corelliav1.ModelProvider_OPENAI:
		return "openai"
	case corelliav1.ModelProvider_OPENROUTER:
		return "openrouter"
	}
	return ""
}

// logsURL is the one place in this package that knows about Fly's URL
// scheme — a small blueprint §11.1 tension, accepted in v1 because the
// alternative (LogsURL method on DeployTarget) widens an interface
// most callers don't need. Decision 33's "computed server-side"
// requirement places this helper *somewhere*; toProto* is the closest
// fit. v1.5 candidate: lift to deploy.DeployTarget interface.
func logsURL(externalRef *string) string {
	if externalRef == nil || *externalRef == "" {
		return ""
	}
	if !strings.HasPrefix(*externalRef, flyExternalRefPfx) {
		return ""
	}
	return "https://fly.io/apps/" + strings.TrimPrefix(*externalRef, flyExternalRefPfx) + "/monitoring"
}

func stringDeref(p *string) string {
	if p == nil {
		return ""
	}
	return *p
}

func tsToRFC3339(t pgtype.Timestamptz) string {
	if !t.Valid {
		return ""
	}
	return t.Time.Format(time.RFC3339)
}

func ptrOf(s string) *string { return &s }

// applyDeployConfigToInstance writes the cfg's nine fields onto the
// in-memory db.AgentInstance row. Used by Spawn after the in-tx
// UpdateAgentDeployConfig call so the wire response surfaces the
// post-update state without a re-read. The DB row is the source of
// truth; this helper only keeps the in-memory copy in sync.
func applyDeployConfigToInstance(i *db.AgentInstance, cfg deploy.DeployConfig) {
	i.Region = cfg.Region
	i.CpuKind = cfg.CPUKind
	i.Cpus = int32(cfg.CPUs)
	i.MemoryMb = int32(cfg.MemoryMB)
	i.RestartPolicy = cfg.RestartPolicy
	i.RestartMaxRetries = int32(cfg.RestartMaxRetries)
	i.LifecycleMode = cfg.LifecycleMode
	i.DesiredReplicas = int32(cfg.DesiredReplicas)
	i.VolumeSizeGb = int32(cfg.VolumeSizeGB)
}

// deployConfigParams projects a deploy.DeployConfig into the sqlc
// param shape. Centralised so every caller (Spawn's tx closure,
// UpdateDeployConfig non-dry-run path, the per-row applyBulkOne
// helper) stays in lockstep with the column set.
func deployConfigParams(id, orgID uuid.UUID, cfg deploy.DeployConfig) db.UpdateAgentDeployConfigParams {
	return db.UpdateAgentDeployConfigParams{
		ID:                id,
		OrgID:             orgID,
		Region:            cfg.Region,
		CpuKind:           cfg.CPUKind,
		Cpus:              int32(cfg.CPUs),
		MemoryMb:          int32(cfg.MemoryMB),
		RestartPolicy:     cfg.RestartPolicy,
		RestartMaxRetries: int32(cfg.RestartMaxRetries),
		LifecycleMode:     cfg.LifecycleMode,
		DesiredReplicas:   int32(cfg.DesiredReplicas),
		VolumeSizeGb:      int32(cfg.VolumeSizeGB),
	}
}

// deployConfigFromInstance reverses the projection — reads the nine
// columns off an agent_instances row and returns a DeployConfig.
// Used by UpdateDeployConfig / ResizeReplicas / ResizeVolume to load
// the current desired state before applying a delta.
//
// WithDefaults is applied because rows inserted before Phase 1's
// migration carry the column DEFAULTs (which match the M4 shape) but
// rows inserted post-Phase-1 always carry explicit values from the
// service layer; either way, the WithDefaults call is idempotent on
// non-zero inputs.
func deployConfigFromInstance(r db.GetAgentInstanceByIDRow) deploy.DeployConfig {
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
	}.WithDefaults()
}
