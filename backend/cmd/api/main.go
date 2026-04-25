package main

import (
	"context"
	"fmt"
	"log/slog"
	"net/http"
	"os"
	"strings"

	_ "github.com/joho/godotenv/autoload"

	"github.com/hejijunhao/corellia/backend/internal/auth"
	"github.com/hejijunhao/corellia/backend/internal/config"
	"github.com/hejijunhao/corellia/backend/internal/db"
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

	handler := httpsrv.New(httpsrv.Deps{
		Config:               cfg,
		AuthVerifier:         verifier,
		UsersHandler:         httpsrv.NewUsersHandler(usersSvc),
		OrganizationsHandler: httpsrv.NewOrganizationsHandler(orgsSvc),
		AllowedOrigin:        cfg.FrontendOrigin,
	})

	addr := fmt.Sprintf(":%d", cfg.Port)
	slog.Info("listening", "addr", addr)
	if err := http.ListenAndServe(addr, handler); err != nil {
		slog.Error("server", "err", err)
		os.Exit(1)
	}
}
