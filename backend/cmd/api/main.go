package main

import (
	"context"
	"fmt"
	"log/slog"
	"net/http"
	"os"

	_ "github.com/joho/godotenv/autoload"

	"github.com/hejijunhao/corellia/backend/internal/config"
	"github.com/hejijunhao/corellia/backend/internal/db"
	"github.com/hejijunhao/corellia/backend/internal/httpsrv"
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

	queries := db.New(pool)
	usersSvc := users.NewService(queries)

	handler := httpsrv.New(httpsrv.Deps{
		Config:        cfg,
		UsersHandler:  httpsrv.NewUsersHandler(usersSvc),
		AllowedOrigin: cfg.FrontendOrigin,
	})

	addr := fmt.Sprintf(":%d", cfg.Port)
	slog.Info("listening", "addr", addr)
	if err := http.ListenAndServe(addr, handler); err != nil {
		slog.Error("server", "err", err)
		os.Exit(1)
	}
}
