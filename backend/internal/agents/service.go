package agents

import (
	"context"
	"errors"

	"github.com/hejijunhao/corellia/backend/internal/db"
	corelliav1 "github.com/hejijunhao/corellia/backend/internal/gen/corellia/v1"
)

var ErrNotFound = errors.New("agent template not found")

// templateQueries is the subset of db.Queries this service touches. Mirrors
// the users.userQueries / organizations.orgQueries pattern — keeps the test
// surface tight (no need to fake the full Querier) and isolates the service
// from sqlc regen churn on unrelated queries.
type templateQueries interface {
	ListAgentTemplates(ctx context.Context) ([]db.ListAgentTemplatesRow, error)
	// GetAgentTemplateByID added by M4.
}

type Service struct {
	queries templateQueries
}

func NewService(queries templateQueries) *Service {
	return &Service{queries: queries}
}

func (s *Service) ListAgentTemplates(ctx context.Context) ([]*corelliav1.AgentTemplate, error) {
	rows, err := s.queries.ListAgentTemplates(ctx)
	if err != nil {
		return nil, err
	}
	// make([]…, 0, len) — non-nil empty slice on zero rows. The FE branches on
	// length, but a non-nil JSON marshal produces "[]" not "null" — friendlier
	// wire shape and pinned by the Phase 6 _Empty test.
	out := make([]*corelliav1.AgentTemplate, 0, len(rows))
	for _, r := range rows {
		out = append(out, toProtoTemplate(r))
	}
	return out, nil
}

func toProtoTemplate(r db.ListAgentTemplatesRow) *corelliav1.AgentTemplate {
	return &corelliav1.AgentTemplate{
		Id:          r.ID.String(),
		Name:        r.Name,
		Description: r.Description,
	}
}
