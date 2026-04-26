package agents

import (
	"bytes"
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"log/slog"
	"net/http"
	"strings"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5"

	"github.com/hejijunhao/corellia/backend/internal/db"
)

// chatRequestBody mirrors the Phase 1 sidecar's POST /chat input:
// {"session_id": ..., "message": ...}. The sidecar is OpenAI-shaped
// at the response edge (`{"content": ...}`); the request edge is
// Corellia's own minimal contract — no `model` field (the upstream
// AIAgent reads its own config), no `messages` array (single-turn
// inputs threaded by session_id, history persists in the sidecar's
// SQLite). Decision 3 + plan §1.
type chatRequestBody struct {
	SessionID string `json:"session_id"`
	Message   string `json:"message"`
}

// chatResponseBody is the Phase 1 sidecar's POST /chat success shape.
// One field; the sidecar may add fields later (e.g., usage stats once
// observability lands) — JSON unmarshalling is forward-compatible by
// default.
type chatResponseBody struct {
	Content string `json:"content"`
}

// ChatWithAgent proxies a single chat turn to the agent's per-instance
// sidecar. Plan decision 11: the FE never talks to the sidecar
// directly — the bearer token stays on the BE, and the round-trip
// becomes a single audit point for who chatted with what (post-v1.5
// audit pillar consumes this).
//
// Order of operations:
//
//  1. Load instance with org-guard. Mismatch → ErrInstanceNotFound.
//  2. Reject if chat_enabled=false → ErrChatDisabled. The sidecar
//     never spawned for this instance, so there's nothing to call.
//  3. Reject if deploy_external_ref is missing → ErrInstanceNotFound
//     (pending-without-Fly-app row; same shape as M5 update paths).
//  4. Read CORELLIA_SIDECAR_AUTH_TOKEN from the deploy target's
//     secret store (Fly app secret store via flaps). The audit row
//     in `secrets` exists only as bookkeeping; the value lives in
//     Fly per rule §11.
//  5. Construct URL from external ref (decision 12: flaps app name
//     → https://<app>.fly.dev/chat) and POST with bearer auth.
//  6. Map status: 200 → return content; 401 → ErrChatAuth (drift
//     between our DB row and Fly's secret store); other non-2xx /
//     transport errors → ErrChatUnreachable.
//
// Sentinel mapping (Phase 5 handler layer):
//
//	ErrInstanceNotFound → NotFound
//	ErrChatDisabled     → FailedPrecondition
//	ErrChatAuth         → Internal (Corellia bug, not a user error)
//	ErrChatUnreachable  → Unavailable
func (s *Service) ChatWithAgent(
	ctx context.Context,
	instanceID, orgID uuid.UUID,
	sessionID, message string,
) (string, error) {
	row, err := s.queries.GetAgentInstanceByID(ctx, db.GetAgentInstanceByIDParams{
		ID:    instanceID,
		OrgID: orgID,
	})
	if err != nil {
		if errors.Is(err, pgx.ErrNoRows) {
			return "", ErrInstanceNotFound
		}
		return "", err
	}
	if !row.ChatEnabled {
		return "", ErrChatDisabled
	}
	if row.DeployExternalRef == nil || *row.DeployExternalRef == "" {
		// Same posture as the M5 update paths — pending-without-app
		// rows aren't reachable.
		return "", ErrInstanceNotFound
	}
	ref := *row.DeployExternalRef

	target, err := s.flyTarget(ctx)
	if err != nil {
		return "", err
	}

	// Read the bearer token from Fly's secret store (rule §11: the
	// value never lives in our DB). An empty token here means the
	// secret was set without showSecrets surfacing — equivalent to
	// "drift between audit row and store"; treat as auth failure.
	//
	// `err` here originates in fly-go's flaps client, which wraps
	// HTTP API errors *without* including secret values. Logging
	// `err.Error()` is operator-side only and safe by audit; the FE
	// path returns the generic `ErrChatUnreachable` regardless.
	token, err := target.GetAppSecret(ctx, ref, envKeySidecarAuthToken)
	if err != nil {
		slog.Error("agents: chat get secret",
			"instance_id", instanceID, "err", err.Error())
		return "", ErrChatUnreachable
	}
	if token == "" {
		return "", ErrChatAuth
	}

	url, err := chatURL(ref)
	if err != nil {
		return "", err
	}

	body, err := json.Marshal(chatRequestBody{SessionID: sessionID, Message: message})
	if err != nil {
		return "", fmt.Errorf("agents: chat marshal: %w", err)
	}
	req, err := http.NewRequestWithContext(ctx, http.MethodPost, url, bytes.NewReader(body))
	if err != nil {
		return "", fmt.Errorf("agents: chat new request: %w", err)
	}
	req.Header.Set("Authorization", "Bearer "+token)
	req.Header.Set("Content-Type", "application/json")
	req.Header.Set("Accept", "application/json")

	resp, err := s.chatHTTP.Do(req)
	if err != nil {
		// Network / transport failure. Token is in req.Header
		// memory only — never logged, never marshalled into the
		// returned error.
		slog.Warn("agents: chat transport error",
			"instance_id", instanceID, "err", err)
		return "", ErrChatUnreachable
	}
	defer resp.Body.Close()

	switch {
	case resp.StatusCode == http.StatusUnauthorized:
		// 401 from the sidecar means our token doesn't match what
		// the sidecar holds — Fly secret-store drift, not a user
		// error. Surfaced as Internal at the handler layer.
		// 0.11.9: drain the body before returning so the underlying
		// connection can be reused from the pool.
		_, _ = io.Copy(io.Discard, io.LimitReader(resp.Body, 1<<20))
		return "", ErrChatAuth
	case resp.StatusCode < 200 || resp.StatusCode >= 300:
		_, _ = io.Copy(io.Discard, io.LimitReader(resp.Body, 1<<20))
		slog.Warn("agents: chat non-2xx",
			"instance_id", instanceID, "status", resp.StatusCode)
		return "", ErrChatUnreachable
	}

	respBytes, err := io.ReadAll(io.LimitReader(resp.Body, 1<<20)) // 1 MiB cap
	if err != nil {
		slog.Warn("agents: chat read body",
			"instance_id", instanceID, "err", err)
		return "", ErrChatUnreachable
	}
	var parsed chatResponseBody
	if err := json.Unmarshal(respBytes, &parsed); err != nil {
		slog.Warn("agents: chat unmarshal",
			"instance_id", instanceID, "err", err)
		return "", ErrChatUnreachable
	}
	return parsed.Content, nil
}

// chatURL builds the per-instance sidecar URL from a Fly external
// ref. Mirrors logsURL's blueprint §11.1 trade-off: the alternative
// (a ChatURL method on every DeployTarget) widens the interface for
// one caller. Until v1.5+ adds a second deploy target with a chat
// surface, this helper stays here. Plan decision 12.
func chatURL(externalRef string) (string, error) {
	if externalRef == "" {
		return "", ErrInstanceNotFound
	}
	if !strings.HasPrefix(externalRef, flyExternalRefPfx) {
		return "", fmt.Errorf("agents: chat url: unrecognised external ref %q", externalRef)
	}
	app := strings.TrimPrefix(externalRef, flyExternalRefPfx)
	if app == "" {
		return "", fmt.Errorf("agents: chat url: empty app name in %q", externalRef)
	}
	return "https://" + app + ".fly.dev/chat", nil
}

// Compile-time assertion that *http.Client satisfies ChatHTTPClient.
// Catches any future change to the interface that would silently
// downgrade the default client.
var _ ChatHTTPClient = (*http.Client)(nil)
