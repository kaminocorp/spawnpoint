package httpsrv

import (
	"context"

	"connectrpc.com/connect"

	corelliav1 "github.com/hejijunhao/corellia/backend/internal/gen/corellia/v1"
	"github.com/hejijunhao/corellia/backend/internal/users"
)

type UsersHandler struct {
	svc *users.Service
}

func NewUsersHandler(svc *users.Service) *UsersHandler {
	return &UsersHandler{svc: svc}
}

func (h *UsersHandler) GetCurrentUser(
	ctx context.Context,
	_ *connect.Request[corelliav1.GetCurrentUserRequest],
) (*connect.Response[corelliav1.GetCurrentUserResponse], error) {
	user, err := h.svc.GetCurrentUser(ctx)
	if err != nil {
		return nil, connect.NewError(connect.CodeUnauthenticated, err)
	}
	return connect.NewResponse(&corelliav1.GetCurrentUserResponse{User: user}), nil
}
