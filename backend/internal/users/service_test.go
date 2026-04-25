package users_test

import (
	"context"
	"errors"
	"testing"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5"

	"github.com/hejijunhao/corellia/backend/internal/auth"
	"github.com/hejijunhao/corellia/backend/internal/db"
	"github.com/hejijunhao/corellia/backend/internal/users"
)

type fakeQueries struct {
	getResult db.User
	getErr    error

	updateResult db.User
	updateErr    error
}

func (f *fakeQueries) GetUserByAuthID(_ context.Context, _ uuid.UUID) (db.User, error) {
	return f.getResult, f.getErr
}

func (f *fakeQueries) UpdateUserName(_ context.Context, _ db.UpdateUserNameParams) (db.User, error) {
	return f.updateResult, f.updateErr
}

func ctxWithTestClaims(t *testing.T) context.Context {
	t.Helper()
	return auth.ContextWithClaims(context.Background(), auth.AuthClaims{
		AuthUserID: uuid.New(),
		Email:      "test@example.com",
	})
}

func TestGetCurrentUser_NotProvisioned(t *testing.T) {
	s := users.NewService(&fakeQueries{getErr: pgx.ErrNoRows})

	_, err := s.GetCurrentUser(ctxWithTestClaims(t))
	if !errors.Is(err, users.ErrNotProvisioned) {
		t.Fatalf("want ErrNotProvisioned, got %v", err)
	}
}

func TestGetCurrentUser_HappyPath(t *testing.T) {
	name := "Alice"
	row := db.User{
		ID:         uuid.New(),
		AuthUserID: uuid.New(),
		Email:      "alice@example.com",
		OrgID:      uuid.New(),
		Role:       "admin",
		Name:       &name,
	}
	s := users.NewService(&fakeQueries{getResult: row})

	got, err := s.GetCurrentUser(ctxWithTestClaims(t))
	if err != nil {
		t.Fatalf("unexpected error: %v", err)
	}
	if got.GetId() != row.ID.String() {
		t.Errorf("Id: got %q, want %q", got.GetId(), row.ID.String())
	}
	if got.GetEmail() != row.Email {
		t.Errorf("Email: got %q, want %q", got.GetEmail(), row.Email)
	}
	if got.GetOrgId() != row.OrgID.String() {
		t.Errorf("OrgId: got %q, want %q", got.GetOrgId(), row.OrgID.String())
	}
	if got.GetRole() != row.Role {
		t.Errorf("Role: got %q, want %q", got.GetRole(), row.Role)
	}
	if got.GetName() != name {
		t.Errorf("Name: got %q, want %q", got.GetName(), name)
	}
}

func TestGetCurrentUser_NoClaims(t *testing.T) {
	s := users.NewService(&fakeQueries{})

	_, err := s.GetCurrentUser(context.Background())
	if !errors.Is(err, users.ErrUnauthenticated) {
		t.Fatalf("want ErrUnauthenticated, got %v", err)
	}
}
