package config

import (
	"log/slog"
	"os"

	"github.com/caarlos0/env/v11"
)

type Config struct {
	Port int `env:"PORT" envDefault:"8080"`

	// DatabaseURL is the Supabase session-pooler URL (port 5432 on the
	// Supavisor hostname). Used by the app at runtime. Non-superuser role
	// once corellia_app is introduced.
	//
	// DATABASE_URL_DIRECT (postgres role, port 5432 on db.<ref>.supabase.co)
	// is deliberately NOT exposed here — it's a shell-only env var read by
	// goose during migrations. Keeping it out of Config means the app
	// binary never holds superuser credentials.
	DatabaseURL string `env:"DATABASE_URL,required"`

	SupabaseURL       string `env:"SUPABASE_URL,required"`
	SupabaseJWTSecret string `env:"SUPABASE_JWT_SECRET,required"`
	FlyAPIToken       string `env:"FLY_API_TOKEN,required"`
	FlyOrgSlug        string `env:"FLY_ORG_SLUG,required"`
	FrontendOrigin    string `env:"FRONTEND_ORIGIN,required"`
}

func Load() Config {
	var cfg Config
	if err := env.Parse(&cfg); err != nil {
		slog.Error("config load failed", "err", err)
		os.Exit(1)
	}
	return cfg
}
