package httpsrv

import (
	"context"
	"errors"
	"log/slog"

	"connectrpc.com/connect"

	corelliav1 "github.com/hejijunhao/corellia/backend/internal/gen/corellia/v1"
	"github.com/hejijunhao/corellia/backend/internal/organizations"
	"github.com/hejijunhao/corellia/backend/internal/users"
)

type OrganizationsHandler struct {
	svc *organizations.Service
}

func NewOrganizationsHandler(svc *organizations.Service) *OrganizationsHandler {
	return &OrganizationsHandler{svc: svc}
}

func (h *OrganizationsHandler) GetOrganization(
	ctx context.Context,
	req *connect.Request[corelliav1.GetOrganizationRequest],
) (*connect.Response[corelliav1.GetOrganizationResponse], error) {
	org, err := h.svc.GetOrganization(ctx, req.Msg.GetId())
	if err != nil {
		return nil, orgErrToConnect(err)
	}
	return connect.NewResponse(&corelliav1.GetOrganizationResponse{Organization: org}), nil
}

func (h *OrganizationsHandler) UpdateOrganizationName(
	ctx context.Context,
	req *connect.Request[corelliav1.UpdateOrganizationNameRequest],
) (*connect.Response[corelliav1.UpdateOrganizationNameResponse], error) {
	org, err := h.svc.UpdateOrganizationName(ctx, req.Msg.GetId(), req.Msg.GetName())
	if err != nil {
		return nil, orgErrToConnect(err)
	}
	return connect.NewResponse(&corelliav1.UpdateOrganizationNameResponse{Organization: org}), nil
}

// orgErrToConnect mirrors users_handler.go's toConnectErr: sentinels pass
// through (their messages are part of the public contract), unknowns are
// logged server-side and replaced with a generic "internal error" on the
// wire so pgx / driver internals don't leak to the client.
func orgErrToConnect(err error) error {
	switch {
	case errors.Is(err, users.ErrUnauthenticated):
		return connect.NewError(connect.CodeUnauthenticated, err)
	case errors.Is(err, users.ErrNotProvisioned),
		errors.Is(err, organizations.ErrForbidden):
		return connect.NewError(connect.CodePermissionDenied, err)
	case errors.Is(err, organizations.ErrNotFound):
		return connect.NewError(connect.CodeNotFound, err)
	default:
		slog.Error("organizations handler: unexpected error", "err", err)
		return connect.NewError(connect.CodeInternal, errors.New("internal error"))
	}
}
