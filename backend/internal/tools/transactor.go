package tools

import (
	"context"
	"errors"
	"fmt"
	"log/slog"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgxpool"

	"github.com/hejijunhao/corellia/backend/internal/db"
)

// GrantsTx is the narrow query surface SetInstanceGrants touches inside one
// transaction. Three writes — revoke-all → insert-each → bump-version — must
// commit atomically; a partial failure between the revoke and the inserts
// would leave an instance with zero active grants while the manifest_version
// has not advanced, so adapters polling with the old ETag would keep
// enforcing the pre-call grant set.
//
// *db.Queries satisfies this interface structurally so the production
// transactor (PgxTransactor below) hands fn a tx-bound queries object with no
// adapter glue.
type GrantsTx interface {
	RevokeAllActiveToolGrants(ctx context.Context, agentInstanceID uuid.UUID) error
	InsertInstanceToolGrant(ctx context.Context, arg db.InsertInstanceToolGrantParams) (db.AgentInstanceToolGrant, error)
	BumpManifestVersion(ctx context.Context, agentInstanceID uuid.UUID) error
}

// Transactor lifts the SetInstanceGrants write fan-out into a single tx.
// Mirrors agents.Transactor's narrow-tx-shape pattern (one method per write
// fan-out) so the closure boundary documents which queries the fn touches.
type Transactor interface {
	WithGrantsTx(ctx context.Context, fn func(GrantsTx) error) error
}

// PgxTransactor is the production Transactor — a thin lifter over the app's
// pgxpool.Pool. Pool ownership stays with cmd/api/main.go; the transactor
// borrows it for the lifetime of each tx call.
type PgxTransactor struct {
	pool *pgxpool.Pool
}

func NewPgxTransactor(pool *pgxpool.Pool) *PgxTransactor {
	return &PgxTransactor{pool: pool}
}

// WithGrantsTx begins a tx, runs fn against a tx-bound *db.Queries (which
// structurally satisfies GrantsTx), then commits or rolls back. Rollback
// errors are logged at warn and dropped — the fn error is what the caller
// reacts to; obscuring it with a rollback failure would hide the root cause.
func (t *PgxTransactor) WithGrantsTx(ctx context.Context, fn func(GrantsTx) error) error {
	tx, err := t.pool.BeginTx(ctx, pgx.TxOptions{})
	if err != nil {
		return fmt.Errorf("tools: begin tx: %w", err)
	}
	if err := fn(db.New(tx)); err != nil {
		if rbErr := tx.Rollback(ctx); rbErr != nil && !errors.Is(rbErr, pgx.ErrTxClosed) {
			slog.Warn("tools: tx rollback failed", "rollback_err", rbErr, "fn_err", err)
		}
		return err
	}
	if err := tx.Commit(ctx); err != nil {
		return fmt.Errorf("tools: commit tx: %w", err)
	}
	return nil
}
