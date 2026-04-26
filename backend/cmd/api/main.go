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

	"github.com/hejijunhao/corellia/backend/internal/adapters"
	"github.com/hejijunhao/corellia/backend/internal/agents"
	"github.com/hejijunhao/corellia/backend/internal/auth"
	"github.com/hejijunhao/corellia/backend/internal/config"
	"github.com/hejijunhao/corellia/backend/internal/db"
	"github.com/hejijunhao/corellia/backend/internal/deploy"
	"github.com/hejijunhao/corellia/backend/internal/httpsrv"
	"github.com/hejijunhao/corellia/backend/internal/organizations"
	"github.com/hejijunhao/corellia/backend/internal/tools"
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
	adaptersSvc := adapters.NewService(queries)

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

	toolsSvc := tools.NewService(queries, tools.WithTransactor(tools.NewPgxTransactor(pool)))

	// v1.5 Pillar B: wire manifest issuer into the spawn flow if
	// CORELLIA_API_URL is configured. When it's absent, agents spawn
	// without tools governance — safe for local dev and pre-Pillar-B
	// deployments.
	agentOpts := []agents.ServiceOption{}
	if cfg.CorelliaAPIURL != "" {
		agentOpts = append(agentOpts, agents.WithManifestIssuer(toolsSvc, cfg.CorelliaAPIURL))
		slog.Info("tools governance: manifest issuer wired", "api_url", cfg.CorelliaAPIURL)
	} else {
		slog.Info("tools governance: CORELLIA_API_URL not set — manifest token generation disabled")
	}
	// Phase 7: tools audit hook for the operator-driven RestartInstance path.
	// Always wired when toolsSvc exists (which it always does post-Phase 1 —
	// the Phase 6 curation page also calls into toolsSvc); independent of
	// CORELLIA_API_URL because audit-row writes work whether or not the
	// adapter-side manifest endpoint is reachable.
	agentOpts = append(agentOpts, agents.WithToolsAuditAppender(toolsSvc))

	agentsSvc := agents.NewService(queries, adaptersSvc, deployResolver, agents.NewPgxTransactor(pool), agentOpts...)

	// Boot-time stale-pending sweep (spawn-flow plan decision 32). Reaps
	// any agent_instances row stuck in 'pending' for >5 min — typically
	// the residue of a process crash mid-spawn whose poll goroutine was
	// abandoned. Logged warn-level with the IDs so the operator can
	// cross-reference the crash event.
	if reaped, err := agentsSvc.ReapStalePending(ctx); err != nil {
		slog.Error("agents: stale-pending sweep", "err", err)
	} else if len(reaped) > 0 {
		slog.Warn("agents: reaped stale pending instances", "count", len(reaped), "ids", reaped)
	}

	var manifestHandler *httpsrv.ToolManifestHandler
	if cfg.CorelliaAPIURL != "" {
		manifestHandler = httpsrv.NewToolManifestHandler(toolsSvc)
	}

	handler := httpsrv.New(httpsrv.Deps{
		Config:               cfg,
		AuthVerifier:         verifier,
		UsersHandler:         httpsrv.NewUsersHandler(usersSvc),
		OrganizationsHandler: httpsrv.NewOrganizationsHandler(orgsSvc),
		AgentsHandler:        httpsrv.NewAgentsHandler(agentsSvc, usersSvc),
		DeployTargets:        deployResolver,
		AllowedOrigin:        cfg.FrontendOrigin,
		ToolManifestHandler:  manifestHandler,
		ToolsHandler:         httpsrv.NewToolsHandler(toolsSvc, usersSvc),
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
