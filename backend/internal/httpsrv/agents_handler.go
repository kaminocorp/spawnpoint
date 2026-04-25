package httpsrv

import (
	"context"
	"errors"
	"log/slog"

	"connectrpc.com/connect"

	"github.com/hejijunhao/corellia/backend/internal/agents"
	corelliav1 "github.com/hejijunhao/corellia/backend/internal/gen/corellia/v1"
)

type AgentsHandler struct {
	svc *agents.Service
}

func NewAgentsHandler(svc *agents.Service) *AgentsHandler {
	return &AgentsHandler{svc: svc}
}

func (h *AgentsHandler) ListAgentTemplates(
	ctx context.Context,
	_ *connect.Request[corelliav1.ListAgentTemplatesRequest],
) (*connect.Response[corelliav1.ListAgentTemplatesResponse], error) {
	templates, err := h.svc.ListAgentTemplates(ctx)
	if err != nil {
		return nil, agentsErrToConnect(err)
	}
	return connect.NewResponse(&corelliav1.ListAgentTemplatesResponse{Templates: templates}), nil
}

// agentsErrToConnect mirrors users_handler.go's toConnectErr and
// organizations_handler.go's orgErrToConnect: sentinel errors flow through
// with their messages (part of the public contract — FE branches on the
// Connect code), unknowns are logged server-side and replaced with a generic
// "internal error" on the wire so pgx / driver internals can't leak. The
// ErrNotFound arm has no caller in M2 — wired now so M4's GetAgentTemplate
// reuses the switch without an edit-during-M4.
func agentsErrToConnect(err error) error {
	switch {
	case errors.Is(err, agents.ErrNotFound):
		return connect.NewError(connect.CodeNotFound, err)
	default:
		slog.Error("agents handler: unexpected error", "err", err)
		return connect.NewError(connect.CodeInternal, errors.New("internal error"))
	}
}
