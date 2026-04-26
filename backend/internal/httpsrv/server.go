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
	// ToolManifestHandler serves the adapter-to-control-plane manifest
	// fetch endpoint. Auth is a per-instance bearer token (not a Supabase
	// JWT), so it is mounted outside the auth.Middleware group.
	// Nil is safe — the route is simply not registered (tools governance
	// not yet enabled for this deployment).
	ToolManifestHandler http.Handler
	// ToolsHandler is the Connect-go handler for the operator-facing
	// tools-governance RPCs (Phase 3+). Mounted inside the auth.Middleware
	// group so every method runs under a Supabase JWT. Nil is safe — the
	// service is simply not mounted (deployments without tools governance
	// keep their existing surface area).
	//
	// GetToolManifest on this handler returns Unimplemented; the bearer-
	// token plain handler at the same path (registered above the auth
	// group) takes precedence via chi's exact-route-wins-over-Mount rule.
	ToolsHandler corelliav1connect.ToolServiceHandler
}

func New(d Deps) http.Handler {
	r := chi.NewRouter()

	r.Use(middleware.Logger)
	r.Use(middleware.Recoverer)
	r.Use(corsMiddleware(d.AllowedOrigin))

	r.Get("/healthz", func(w http.ResponseWriter, _ *http.Request) {
		w.WriteHeader(http.StatusOK)
	})

	// Manifest endpoint — bearer-token auth, outside the Supabase JWT group.
	// Path matches the Connect-go path convention for forward-compatibility.
	if d.ToolManifestHandler != nil {
		r.Post("/corellia.v1.ToolService/GetToolManifest", d.ToolManifestHandler.ServeHTTP)
	}

	r.Group(func(r chi.Router) {
		r.Use(auth.Middleware(d.AuthVerifier))

		usersPath, usersHandler := corelliav1connect.NewUsersServiceHandler(d.UsersHandler)
		r.Mount(usersPath, usersHandler)

		orgsPath, orgsHandler := corelliav1connect.NewOrganizationsServiceHandler(d.OrganizationsHandler)
		r.Mount(orgsPath, orgsHandler)

		agentsPath, agentsHandler := corelliav1connect.NewAgentsServiceHandler(d.AgentsHandler)
		r.Mount(agentsPath, agentsHandler)

		if d.ToolsHandler != nil {
			toolsPath, toolsHandler := corelliav1connect.NewToolServiceHandler(d.ToolsHandler)
			r.Mount(toolsPath, toolsHandler)
		}
	})

	return r
}
