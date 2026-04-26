package main

import (
	"context"
	"fmt"
	"log/slog"
	"net/http"
	"os"
	"sort"
	"strings"

	_ "github.com/joho/godotenv/autoload"

	"github.com/hejijunhao/corellia/backend/internal/agents"
	"github.com/hejijunhao/corellia/backend/internal/auth"
	"github.com/hejijunhao/corellia/backend/internal/config"
	"github.com/hejijunhao/corellia/backend/internal/db"
	"github.com/hejijunhao/corellia/backend/internal/deploy"
	"github.com/hejijunhao/corellia/backend/internal/httpsrv"
	"github.com/hejijunhao/corellia/backend/internal/organizations"
	"github.com/hejijunhao/corellia/backend/internal/users"
)

func main() {
	slog.SetDefault(slog.New(slog.NewJSONHandler(os.Stdout, nil)))

	cfg := config.Load()
	ctx := context.Background()

	pool, err := db.NewPool(ctx, cfg.DatabaseURL)
	if err != nil {
		slog.Error("db pool", "err", err)
		os.Exit(1)
	}
	defer pool.Close()

	jwksURL := strings.TrimRight(cfg.SupabaseURL, "/") + "/auth/v1/.well-known/jwks.json"
	verifier, err := auth.NewJWKSVerifier(ctx, jwksURL)
	if err != nil {
		slog.Error("jwks verifier", "err", err, "url", jwksURL)
		os.Exit(1)
	}
	slog.Info("jwks initialised", "url", jwksURL)

	queries := db.New(pool)
	usersSvc := users.NewService(queries)
	orgsSvc := organizations.NewService(queries, usersSvc)
	agentsSvc := agents.NewService(queries)

	flyTarget, err := deploy.NewFlyDeployTarget(ctx, deploy.FlyCredentials{
		APIToken: cfg.FlyAPIToken,
		OrgSlug:  cfg.FlyOrgSlug,
	})
	if err != nil {
		slog.Error("fly deploy target", "err", err)
		os.Exit(1)
	}
	localTarget := deploy.NewLocalDeployTarget()
	awsTarget := deploy.NewAWSDeployTarget()
	deployTargets := map[string]deploy.DeployTarget{
		flyTarget.Kind():   flyTarget,
		localTarget.Kind(): localTarget,
		awsTarget.Kind():   awsTarget,
	}
	slog.Info("deploy targets initialised",
		"kinds", strings.Join(keysOf(deployTargets), ","),
		"fly_org", cfg.FlyOrgSlug)
	deployResolver := deploy.NewStaticResolver(deployTargets)

	handler := httpsrv.New(httpsrv.Deps{
		Config:               cfg,
		AuthVerifier:         verifier,
		UsersHandler:         httpsrv.NewUsersHandler(usersSvc),
		OrganizationsHandler: httpsrv.NewOrganizationsHandler(orgsSvc),
		AgentsHandler:        httpsrv.NewAgentsHandler(agentsSvc),
		DeployTargets:        deployResolver,
		AllowedOrigin:        cfg.FrontendOrigin,
	})

	addr := fmt.Sprintf(":%d", cfg.Port)
	slog.Info("listening", "addr", addr)
	if err := http.ListenAndServe(addr, handler); err != nil {
		slog.Error("server", "err", err)
		os.Exit(1)
	}
}

func keysOf[V any](m map[string]V) []string {
	out := make([]string, 0, len(m))
	for k := range m {
		out = append(out, k)
	}
	sort.Strings(out)
	return out
}
