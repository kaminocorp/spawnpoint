package users

import (
	"context"
	"errors"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5"

	"github.com/hejijunhao/corellia/backend/internal/auth"
	"github.com/hejijunhao/corellia/backend/internal/db"
	corelliav1 "github.com/hejijunhao/corellia/backend/internal/gen/corellia/v1"
)

var (
	ErrUnauthenticated = errors.New("unauthenticated")
	ErrNotProvisioned  = errors.New("user not provisioned")
)

// userQueries is the subset of db.Queries this service touches. Declaring it
// here (rather than consuming the full sqlc-generated Querier) keeps the
// dependency surface tight and makes the service trivially fakeable in tests.
type userQueries interface {
	GetUserByAuthID(ctx context.Context, authUserID uuid.UUID) (db.User, error)
	UpdateUserName(ctx context.Context, arg db.UpdateUserNameParams) (db.User, error)
}

type Service struct {
	queries userQueries
}

func NewService(queries userQueries) *Service {
	return &Service{queries: queries}
}

func (s *Service) GetCurrentUser(ctx context.Context) (*corelliav1.User, error) {
	user, err := s.loadCurrentUser(ctx)
	if err != nil {
		return nil, err
	}
	return toProtoUser(user), nil
}

func (s *Service) UpdateCurrentUserName(ctx context.Context, name string) (*corelliav1.User, error) {
	user, err := s.loadCurrentUser(ctx)
	if err != nil {
		return nil, err
	}
	updated, err := s.queries.UpdateUserName(ctx, db.UpdateUserNameParams{
		ID:   user.ID,
		Name: &name,
	})
	if err != nil {
		return nil, err
	}
	return toProtoUser(updated), nil
}

// CallerOrgID returns the org_id of the authenticated caller. Used by the
// organizations package to authorise org-scoped operations without pulling
// in the whole users.Service surface.
func (s *Service) CallerOrgID(ctx context.Context) (uuid.UUID, error) {
	user, err := s.loadCurrentUser(ctx)
	if err != nil {
		return uuid.Nil, err
	}
	return user.OrgID, nil
}

func (s *Service) loadCurrentUser(ctx context.Context) (db.User, error) {
	claims, ok := auth.FromContext(ctx)
	if !ok {
		return db.User{}, ErrUnauthenticated
	}
	user, err := s.queries.GetUserByAuthID(ctx, claims.AuthUserID)
	if err != nil {
		if errors.Is(err, pgx.ErrNoRows) {
			return db.User{}, ErrNotProvisioned
		}
		return db.User{}, err
	}
	return user, nil
}

func toProtoUser(u db.User) *corelliav1.User {
	return &corelliav1.User{
		Id:    u.ID.String(),
		Email: u.Email,
		OrgId: u.OrgID.String(),
		Role:  u.Role,
		Name:  u.Name,
	}
}
