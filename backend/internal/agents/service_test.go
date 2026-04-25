package agents_test

import (
	"context"
	"testing"

	"github.com/google/uuid"

	"github.com/hejijunhao/corellia/backend/internal/agents"
	"github.com/hejijunhao/corellia/backend/internal/db"
)

type fakeQueries struct {
	rows []db.ListAgentTemplatesRow
	err  error
}

func (f *fakeQueries) ListAgentTemplates(_ context.Context) ([]db.ListAgentTemplatesRow, error) {
	return f.rows, f.err
}

func TestListAgentTemplates_HappyPath(t *testing.T) {
	row := db.ListAgentTemplatesRow{
		ID:            uuid.New(),
		Name:          "Hermes",
		Description:   "Tool-using agent.",
		DefaultConfig: []byte(`{}`),
	}
	s := agents.NewService(&fakeQueries{rows: []db.ListAgentTemplatesRow{row}})

	got, err := s.ListAgentTemplates(context.Background())
	if err != nil {
		t.Fatalf("unexpected error: %v", err)
	}
	if len(got) != 1 {
		t.Fatalf("len(got): want 1, got %d", len(got))
	}
	if got[0].GetId() != row.ID.String() {
		t.Errorf("Id: got %q, want %q", got[0].GetId(), row.ID.String())
	}
	if got[0].GetName() != row.Name {
		t.Errorf("Name: got %q, want %q", got[0].GetName(), row.Name)
	}
	if got[0].GetDescription() != row.Description {
		t.Errorf("Description: got %q, want %q", got[0].GetDescription(), row.Description)
	}
}

func TestListAgentTemplates_Empty(t *testing.T) {
	s := agents.NewService(&fakeQueries{rows: nil})

	got, err := s.ListAgentTemplates(context.Background())
	if err != nil {
		t.Fatalf("unexpected error: %v", err)
	}
	if got == nil {
		t.Fatal("want non-nil empty slice (pinned wire-shape contract), got nil")
	}
	if len(got) != 0 {
		t.Fatalf("len(got): want 0, got %d", len(got))
	}
}
