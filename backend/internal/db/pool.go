package db

import (
	"context"
	"time"

	"github.com/jackc/pgx/v5/pgxpool"
)

// NewPool builds the app's single pgxpool connected to the Supabase session
// pooler. Tuning values are v1 starters — revisit when we know real traffic
// shape and how many Fly machines are in rotation.
func NewPool(ctx context.Context, dsn string) (*pgxpool.Pool, error) {
	cfg, err := pgxpool.ParseConfig(dsn)
	if err != nil {
		return nil, err
	}

	cfg.MaxConns = 10
	cfg.MinConns = 2
	cfg.MaxConnLifetime = time.Hour
	cfg.MaxConnIdleTime = 30 * time.Minute
	cfg.HealthCheckPeriod = time.Minute

	return pgxpool.NewWithConfig(ctx, cfg)
}
