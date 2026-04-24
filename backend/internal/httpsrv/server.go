package httpsrv

import (
	"net/http"

	"github.com/go-chi/chi/v5"
	"github.com/go-chi/chi/v5/middleware"

	"github.com/hejijunhao/corellia/backend/internal/auth"
	"github.com/hejijunhao/corellia/backend/internal/config"
	"github.com/hejijunhao/corellia/backend/internal/gen/corellia/v1/corelliav1connect"
)

type Deps struct {
	Config        config.Config
	UsersHandler  corelliav1connect.UsersServiceHandler
	AllowedOrigin string
}

func New(d Deps) http.Handler {
	r := chi.NewRouter()

	r.Use(middleware.Logger)
	r.Use(middleware.Recoverer)
	r.Use(corsMiddleware(d.AllowedOrigin))

	r.Get("/healthz", func(w http.ResponseWriter, _ *http.Request) {
		w.WriteHeader(http.StatusOK)
	})

	r.Group(func(r chi.Router) {
		r.Use(auth.Middleware(d.Config.SupabaseJWTSecret))

		path, handler := corelliav1connect.NewUsersServiceHandler(d.UsersHandler)
		r.Mount(path, handler)
	})

	return r
}
