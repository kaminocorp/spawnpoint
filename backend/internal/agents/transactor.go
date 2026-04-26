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
// transaction — instance + secret inserts, nothing else. Reads (template
// lookup, deploy-target lookup) and post-Fly writes (deploy ref set)
// happen outside the tx via the wider agentQueries view, so they don't
// belong here.
//
// Defined as an exported interface so external Transactor
// implementations (production pgx-backed, test fakes) can name it
// in their fn signature without reaching into agents-internal types.
// *db.Queries satisfies it structurally.
type SpawnTx interface {
	InsertAgentInstance(ctx context.Context, arg db.InsertAgentInstanceParams) (db.AgentInstance, error)
	InsertSecret(ctx context.Context, arg db.InsertSecretParams) (db.Secret, error)
}

// Transactor lifts a function into a DB transaction. The function
// receives a SpawnTx view bound to the live transaction; nil return
// commits, non-nil return rolls back.
//
// Phase 8 hardening (spawn-flow plan decision 27 step 6, deferred at
// M4 ship): Spawn's InsertAgentInstance + InsertSecret are a paired
// write whose only honest atomic shape is one tx. Pre-Phase-8 they
// ran sequentially non-transactional — a process crash between the
// two would leave an instance row with no audit row, or vice versa.
type Transactor interface {
	WithSpawnTx(ctx context.Context, fn func(SpawnTx) error) error
}

// PgxTransactor is the production Transactor — a thin lifter over a
// pgxpool.Pool. Pool ownership stays with `cmd/api/main.go`; the
// transactor borrows it for the lifetime of each WithSpawnTx call.
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
