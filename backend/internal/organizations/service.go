package organizations

import (
	"context"
	"errors"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5"

	"github.com/hejijunhao/corellia/backend/internal/db"
	corelliav1 "github.com/hejijunhao/corellia/backend/internal/gen/corellia/v1"
)

var (
	ErrForbidden = errors.New("organization access denied")
	ErrNotFound  = errors.New("organization not found")
)

type orgQueries interface {
	GetOrganizationByID(ctx context.Context, id uuid.UUID) (db.Organization, error)
	UpdateOrganizationName(ctx context.Context, arg db.UpdateOrganizationNameParams) (db.Organization, error)
}

// userLookup resolves the authenticated caller's org_id. The service depends
// only on this minimal surface rather than the full users.Service so the two
// packages stay loosely coupled.
type userLookup interface {
	CallerOrgID(ctx context.Context) (uuid.UUID, error)
}

type Service struct {
	queries orgQueries
	users   userLookup
}

func NewService(queries orgQueries, users userLookup) *Service {
	return &Service{queries: queries, users: users}
}

func (s *Service) GetOrganization(ctx context.Context, id string) (*corelliav1.Organization, error) {
	orgID, err := uuid.Parse(id)
	if err != nil {
		return nil, ErrNotFound
	}
	if err := s.authorize(ctx, orgID); err != nil {
		return nil, err
	}
	org, err := s.queries.GetOrganizationByID(ctx, orgID)
	if err != nil {
		if errors.Is(err, pgx.ErrNoRows) {
			return nil, ErrNotFound
		}
		return nil, err
	}
	return toProtoOrg(org), nil
}

func (s *Service) UpdateOrganizationName(ctx context.Context, id, name string) (*corelliav1.Organization, error) {
	orgID, err := uuid.Parse(id)
	if err != nil {
		return nil, ErrNotFound
	}
	if err := s.authorize(ctx, orgID); err != nil {
		return nil, err
	}
	org, err := s.queries.UpdateOrganizationName(ctx, db.UpdateOrganizationNameParams{
		ID:   orgID,
		Name: name,
	})
	if err != nil {
		if errors.Is(err, pgx.ErrNoRows) {
			return nil, ErrNotFound
		}
		return nil, err
	}
	return toProtoOrg(org), nil
}

// authorize enforces the v1 rule: callers may only touch their own org.
// Multi-org membership (Pattern C) would expand this check to a membership
// lookup; for Pattern A (one user per org) the equality check is sufficient.
func (s *Service) authorize(ctx context.Context, orgID uuid.UUID) error {
	callerOrgID, err := s.users.CallerOrgID(ctx)
	if err != nil {
		return err
	}
	if callerOrgID != orgID {
		return ErrForbidden
	}
	return nil
}

func toProtoOrg(o db.Organization) *corelliav1.Organization {
	return &corelliav1.Organization{
		Id:   o.ID.String(),
		Name: o.Name,
	}
}
