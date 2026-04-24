package users

import (
	"context"
	"errors"

	"github.com/google/uuid"

	"github.com/hejijunhao/corellia/backend/internal/auth"
	"github.com/hejijunhao/corellia/backend/internal/db"
	corelliav1 "github.com/hejijunhao/corellia/backend/internal/gen/corellia/v1"
)

var defaultOrgID = uuid.MustParse("00000000-0000-0000-0000-000000000001")

type Service struct {
	queries *db.Queries
}

func NewService(queries *db.Queries) *Service {
	return &Service{queries: queries}
}

func (s *Service) GetCurrentUser(ctx context.Context) (*corelliav1.User, error) {
	claims, ok := auth.FromContext(ctx)
	if !ok {
		return nil, errors.New("unauthenticated")
	}

	user, err := s.queries.GetUserByAuthID(ctx, claims.AuthUserID)
	if err != nil {
		// Auto-provision on first login.
		user, err = s.queries.CreateUser(ctx, db.CreateUserParams{
			AuthUserID: claims.AuthUserID,
			Email:      claims.Email,
			OrgID:      defaultOrgID,
		})
		if err != nil {
			return nil, err
		}
	}

	return &corelliav1.User{
		Id:    user.ID.String(),
		Email: user.Email,
		OrgId: user.OrgID.String(),
		Role:  user.Role,
	}, nil
}
