package httpsrv

import (
	"net/http"

	"github.com/go-chi/chi/v5"
	"github.com/go-chi/chi/v5/middleware"

	"github.com/hejijunhao/corellia/backend/internal/auth"
	"github.com/hejijunhao/corellia/backend/internal/config"
	"github.com/hejijunhao/corellia/backend/internal/deploy"
	"github.com/hejijunhao/corellia/backend/internal/gen/corellia/v1/corelliav1connect"
)

type Deps struct {
	Config               config.Config
	AuthVerifier         *auth.JWKSVerifier
	UsersHandler         corelliav1connect.UsersServiceHandler
	OrganizationsHandler corelliav1connect.OrganizationsServiceHandler
	AgentsHandler        corelliav1connect.AgentsServiceHandler
	DeployTargets        deploy.Resolver
	AllowedOrigin        string
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
		r.Use(auth.Middleware(d.AuthVerifier))

		usersPath, usersHandler := corelliav1connect.NewUsersServiceHandler(d.UsersHandler)
		r.Mount(usersPath, usersHandler)

		orgsPath, orgsHandler := corelliav1connect.NewOrganizationsServiceHandler(d.OrganizationsHandler)
		r.Mount(orgsPath, orgsHandler)

		agentsPath, agentsHandler := corelliav1connect.NewAgentsServiceHandler(d.AgentsHandler)
		r.Mount(agentsPath, agentsHandler)
	})

	return r
}
