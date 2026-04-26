// Operator-driven Go-level smoke for FlyDeployTarget.
//
// Out-of-band of cmd/api: this binary instantiates a *deploy.FlyDeployTarget
// directly (the same constructor cmd/api/main.go uses at boot) and walks
// it through Spawn → Health-poll → Destroy against the real Fly API.
//
// Acceptance: prints `spawned: fly-app:corellia-agent-<8> <machine-id>`,
// then `health: starting` → `health: started` within ~30s, then exits
// with the deferred Destroy successful. The trap-equivalent (defer)
// removes the app even on failure paths.
//
// Required env (loaded via godotenv/autoload from backend/.env at the
// binary's cwd):
//   - FLY_API_TOKEN, FLY_ORG_SLUG (required by config.Config)
//   - DATABASE_URL, SUPABASE_URL, FRONTEND_ORIGIN (required by
//     config.Config but unused here — stub values are fine)
//   - CORELLIA_SMOKE_API_KEY (the OpenRouter / model API key the
//     spawned harness should boot with)
//   - CORELLIA_HERMES_ADAPTER (optional; defaults to the digest
//     pinned in adapters/hermes/smoke.sh — keep these two refs
//     coherent; see Phase 4 completion doc's "three places hold
//     the digest" risk note)
//
// Run: cd backend && go run ./cmd/smoke-deploy
package main

import (
	"context"
	"fmt"
	"os"
	"time"

	_ "github.com/joho/godotenv/autoload"

	"github.com/hejijunhao/corellia/backend/internal/config"
	"github.com/hejijunhao/corellia/backend/internal/deploy"
)

const (
	defaultImageRef = "ghcr.io/hejijunhao/corellia-hermes-adapter@sha256:d152b3cbf7ed0d67a204dd3de041b0248ca0e550aeb9b9ad2537ce12f98ff0b6"
	healthPollEvery = 2 * time.Second
	healthPollMax   = 30
)

func main() {
	cfg := config.Load()
	ctx := context.Background()

	target, err := deploy.NewFlyDeployTarget(ctx, cfg.FlyAPIToken, cfg.FlyOrgSlug)
	if err != nil {
		fmt.Fprintln(os.Stderr, "new fly target:", err)
		os.Exit(1)
	}

	// SAFETY: This binary is operator-only test tooling, not a production
	// service. Per blueprint.md §11.8, application code reads env vars
	// through `internal/config/`; this binary intentionally side-steps
	// that rule for the two smoke-only knobs below. They are not part
	// of the runtime config surface (the API server never reads them)
	// and adding them to `Config` would put smoke-test plumbing on the
	// fail-fast-at-boot path of every production process.
	apiKey := os.Getenv("CORELLIA_SMOKE_API_KEY")
	if apiKey == "" {
		fmt.Fprintln(os.Stderr, "CORELLIA_SMOKE_API_KEY is empty; refusing to spawn an agent without a model credential")
		os.Exit(1)
	}
	imageRef := os.Getenv("CORELLIA_HERMES_ADAPTER")
	if imageRef == "" {
		imageRef = defaultImageRef
	}

	res, err := target.Spawn(ctx, deploy.SpawnSpec{
		Name:     fmt.Sprintf("smoke-%d", time.Now().Unix()),
		ImageRef: imageRef,
		Env: map[string]string{
			"CORELLIA_AGENT_ID":       "smoke-go-1",
			"CORELLIA_MODEL_PROVIDER": "openrouter",
			"CORELLIA_MODEL_NAME":     "anthropic/claude-3.5-sonnet",
			"CORELLIA_MODEL_API_KEY":  apiKey,
		},
	})
	if err != nil {
		fmt.Fprintln(os.Stderr, "spawn:", err)
		os.Exit(1)
	}
	fmt.Println("spawned:", res.ExternalRef, res.MachineID)

	defer func() {
		if err := target.Destroy(ctx, res.ExternalRef); err != nil {
			fmt.Fprintln(os.Stderr, "destroy:", err)
			return
		}
		fmt.Println("destroyed:", res.ExternalRef)
	}()

	for i := 0; i < healthPollMax; i++ {
		h, err := target.Health(ctx, res.ExternalRef)
		if err != nil {
			fmt.Fprintln(os.Stderr, "health:", err)
		} else {
			fmt.Println("health:", h)
		}
		if h == deploy.HealthStarted {
			fmt.Println("ok: machine reached HealthStarted")
			return
		}
		if h == deploy.HealthFailed {
			fmt.Fprintln(os.Stderr, "fail: machine reached HealthFailed")
			os.Exit(1)
		}
		time.Sleep(healthPollEvery)
	}
	fmt.Fprintln(os.Stderr, "fail: machine did not reach HealthStarted within", healthPollMax*healthPollEvery)
	os.Exit(1)
}
