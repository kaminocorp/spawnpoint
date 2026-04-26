package config

import (
	"log/slog"
	"os"

	"github.com/caarlos0/env/v11"
)

type Config struct {
	Port int `env:"PORT" envDefault:"8080"`

	// DatabaseURL is Supabase's Direct Connection URL
	// (db.<ref>.supabase.co:5432). Consumed by pgxpool, which acts as
	// an in-process transaction pooler — no external pooler on the wire.
	// Non-superuser role once corellia_app is introduced.
	//
	// DATABASE_URL_DIRECT (same host, postgres superuser role) is
	// deliberately NOT exposed here — it's a shell-only env var read
	// by goose during migrations. Keeping it out of Config means the
	// app binary never holds superuser credentials.
	//
	// If the local network lacks IPv6 reachability to the Direct host,
	// swap DATABASE_URL for the Session Pooler form
	// (*.pooler.supabase.com:5432) — drop-in compatible, no code
	// change. Never use Transaction Pooler (:6543); it breaks pgx's
	// prepared-statement cache, which sqlc relies on.
	DatabaseURL string `env:"DATABASE_URL,required"`

	SupabaseURL string `env:"SUPABASE_URL,required"`

	// FlyAPIToken / FlyOrgSlug are bootstrap credentials for the single
	// process-wide DeployTarget consumed by deploy.StaticResolver. They
	// are slated for retirement in v1.5, when DB-backed deploy_targets
	// rows replace this env-var bootstrap with per-org user-configurable
	// credentials. See docs/executing/deploy-target-resolver.md §1.
	//
	// Env var name is FLY_SPAWN_TOKEN (not FLY_API_TOKEN) because flyctl
	// honors FLY_API_TOKEN ahead of `fly auth login` credentials — using
	// that name in backend/.env caused direnv to silently shadow the
	// operator's interactive identity on `fly deploy`. The runtime
	// spawn credential and the operator's deploy identity are distinct
	// roles; the rename keeps them in their own lanes. See changelog 0.7.6.
	// TODO(v1.5): delete these two fields when DBResolver lands.
	FlyAPIToken string `env:"FLY_SPAWN_TOKEN,required"`
	FlyOrgSlug  string `env:"FLY_ORG_SLUG,required"`

	FrontendOrigin string `env:"FRONTEND_ORIGIN,required"`
}

func Load() Config {
	var cfg Config
	if err := env.Parse(&cfg); err != nil {
		slog.Error("config load failed", "err", err)
		os.Exit(1)
	}
	return cfg
}
