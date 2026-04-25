package adapters

import (
	"context"
	"errors"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5"

	"github.com/hejijunhao/corellia/backend/internal/db"
)

var ErrNotFound = errors.New("harness adapter not found")

type adapterQueries interface {
	GetHarnessAdapterByID(ctx context.Context, id uuid.UUID) (db.HarnessAdapter, error)
}

type Service struct {
	queries adapterQueries
}

func NewService(queries adapterQueries) *Service {
	return &Service{queries: queries}
}

func (s *Service) Get(ctx context.Context, id uuid.UUID) (db.HarnessAdapter, error) {
	adapter, err := s.queries.GetHarnessAdapterByID(ctx, id)
	if err != nil {
		if errors.Is(err, pgx.ErrNoRows) {
			return db.HarnessAdapter{}, ErrNotFound
		}
		return db.HarnessAdapter{}, err
	}
	return adapter, nil
}
