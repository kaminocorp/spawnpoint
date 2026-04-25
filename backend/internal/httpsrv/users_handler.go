package httpsrv

import (
	"context"
	"errors"
	"log/slog"

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
		return nil, toConnectErr(err)
	}
	return connect.NewResponse(&corelliav1.GetCurrentUserResponse{User: user}), nil
}

func (h *UsersHandler) UpdateCurrentUserName(
	ctx context.Context,
	req *connect.Request[corelliav1.UpdateCurrentUserNameRequest],
) (*connect.Response[corelliav1.UpdateCurrentUserNameResponse], error) {
	user, err := h.svc.UpdateCurrentUserName(ctx, req.Msg.GetName())
	if err != nil {
		return nil, toConnectErr(err)
	}
	return connect.NewResponse(&corelliav1.UpdateCurrentUserNameResponse{User: user}), nil
}

// toConnectErr maps domain sentinels to Connect status codes.
// Unknown errors are wrapped as Internal — the default here was previously
// Unauthenticated, which conflated "bad token" with "valid token but no user
// row" and masked provisioning bugs as auth failures on the FE.
//
// Sentinel errors flow through unredacted: their message is part of the
// public contract (the FE branches on the Connect code, not the string).
// Unknown errors are logged server-side and replaced with a generic
// "internal error" on the wire — pgx / driver messages can leak schema and
// infrastructure shape, so they must not reach the client.
func toConnectErr(err error) error {
	switch {
	case errors.Is(err, users.ErrUnauthenticated):
		return connect.NewError(connect.CodeUnauthenticated, err)
	case errors.Is(err, users.ErrNotProvisioned):
		return connect.NewError(connect.CodePermissionDenied, err)
	default:
		slog.Error("users handler: unexpected error", "err", err)
		return connect.NewError(connect.CodeInternal, errors.New("internal error"))
	}
}
