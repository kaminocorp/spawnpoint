package agents

import (
	"context"
	"errors"
	"fmt"
	"log/slog"

	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgxpool"

	"github.com/hejijunhao/corellia/backend/internal/db"
)

// SpawnTx is the narrow query surface Spawn touches *inside* the
// transaction — instance + secret inserts plus the M5 Phase 4
// deploy-config persist. Reads (template lookup, deploy-target lookup)
// and post-Fly writes (deploy ref set) happen outside the tx via the
// wider agentQueries view, so they don't belong here.
//
// Defined as an exported interface so external Transactor
// implementations (production pgx-backed, test fakes) can name it
// in their fn signature without reaching into agents-internal types.
// *db.Queries satisfies it structurally.
type SpawnTx interface {
	InsertAgentInstance(ctx context.Context, arg db.InsertAgentInstanceParams) (db.AgentInstance, error)
	InsertSecret(ctx context.Context, arg db.InsertSecretParams) (db.Secret, error)

	// M5 Phase 4: persist the resolved DeployConfig in the same tx as
	// the instance + secret writes. The agent_instances row is
	// inserted first (column DEFAULTs cover the nine new fields),
	// then this method overwrites them with the validated config.
	UpdateAgentDeployConfig(ctx context.Context, arg db.UpdateAgentDeployConfigParams) error
}

// ResizeVolumeTx is the narrow query surface ResizeVolume runs
// inside one tx. The parent's desired-state column
// (agent_instances.volume_size_gb) and each per-row mirror
// (agent_volumes.size_gb) commit atomically — a partial failure
// between them would leave the parent's intent out of sync with the
// per-row state and confuse drift detection forever.
type ResizeVolumeTx interface {
	UpdateAgentInstanceVolumeSize(ctx context.Context, arg db.UpdateAgentInstanceVolumeSizeParams) error
	UpdateAgentVolumeSize(ctx context.Context, arg db.UpdateAgentVolumeSizeParams) error
}

// Transactor lifts a function into a DB transaction. The function
// receives a typed view bound to the live transaction; nil return
// commits, non-nil return rolls back.
//
// Phase 8 hardening (spawn-flow plan decision 27 step 6, deferred at
// M4 ship): Spawn's InsertAgentInstance + InsertSecret are a paired
// write whose only honest atomic shape is one tx. Pre-Phase-8 they
// ran sequentially non-transactional — a process crash between the
// two would leave an instance row with no audit row, or vice versa.
//
// M5 Phase 4 widens this to a second tx shape (WithResizeVolumeTx)
// for ResizeVolume's parent + per-row write pair. Two narrow tx
// shapes vs one generic Querier-bound tx: the narrow shape is
// self-documenting at the closure boundary and test fakes only need
// to expose the methods each surface actually calls.
type Transactor interface {
	WithSpawnTx(ctx context.Context, fn func(SpawnTx) error) error
	WithResizeVolumeTx(ctx context.Context, fn func(ResizeVolumeTx) error) error
}

// PgxTransactor is the production Transactor — a thin lifter over a
// pgxpool.Pool. Pool ownership stays with `cmd/api/main.go`; the
// transactor borrows it for the lifetime of each tx call.
type PgxTransactor struct {
	pool *pgxpool.Pool
}

// NewPgxTransactor binds the transactor to the app's pool.
func NewPgxTransactor(pool *pgxpool.Pool) *PgxTransactor {
	return &PgxTransactor{pool: pool}
}

// WithSpawnTx begins a tx, runs fn against a tx-bound *db.Queries
// (which satisfies SpawnTx), then commits or rolls back. Rollback
// errors are logged at warn and dropped: the fn error is what the
// caller is reacting to; obscuring it with a downstream rollback
// failure would hide the root cause.
func (t *PgxTransactor) WithSpawnTx(ctx context.Context, fn func(SpawnTx) error) error {
	return t.runTx(ctx, func(q *db.Queries) error { return fn(q) })
}

// WithResizeVolumeTx is the M5 Phase 4 sibling of WithSpawnTx for
// the volume-size update flow. *db.Queries structurally satisfies
// the narrower ResizeVolumeTx interface.
func (t *PgxTransactor) WithResizeVolumeTx(ctx context.Context, fn func(ResizeVolumeTx) error) error {
	return t.runTx(ctx, func(q *db.Queries) error { return fn(q) })
}

func (t *PgxTransactor) runTx(ctx context.Context, fn func(*db.Queries) error) error {
	tx, err := t.pool.BeginTx(ctx, pgx.TxOptions{})
	if err != nil {
		return fmt.Errorf("agents: begin tx: %w", err)
	}
	if err := fn(db.New(tx)); err != nil {
		if rbErr := tx.Rollback(ctx); rbErr != nil && !errors.Is(rbErr, pgx.ErrTxClosed) {
			slog.Warn("agents: tx rollback failed", "rollback_err", rbErr, "fn_err", err)
		}
		return err
	}
	if err := tx.Commit(ctx); err != nil {
		return fmt.Errorf("agents: commit tx: %w", err)
	}
	return nil
}
