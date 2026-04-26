package httpsrv

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"net/http"
	"strings"

	"github.com/google/uuid"

	"github.com/hejijunhao/corellia/backend/internal/tools"
	corelliav1 "github.com/hejijunhao/corellia/backend/internal/gen/corellia/v1"
)

// toolManifestService is the narrow tools.Service surface the manifest
// handler needs. Declared here so tests can fake without pulling in the
// whole tools package.
type toolManifestService interface {
	AuthenticateManifestToken(ctx context.Context, rawToken string) (instanceID uuid.UUID, manifestVersion int64, err error)
	BuildManifestForInstance(ctx context.Context, instanceID uuid.UUID) (*corelliav1.ToolManifest, error)
}

// ToolManifestHandler serves GET /corellia.v1.ToolService/GetToolManifest as
// a plain JSON HTTP handler (not a Connect-go handler). Using the plain
// handler gives us full HTTP control — in particular ETag + 304 — which
// Connect-go's handler contract doesn't expose.
//
// The URL matches the Connect-go path convention so the adapter's curl call
// is path-compatible if the endpoint is ever migrated to a Connect handler.
//
// Auth: per-instance opaque bearer token, NOT a Supabase JWT. This handler
// must be mounted OUTSIDE the auth.Middleware group in server.go.
//
// v1.5 Pillar B Phase 7 hardening: per-instance rate limit. A misbehaving
// adapter that polls in a tight loop instead of honouring the TTL is bounded
// to the configured limit (60 req/min by default, see tool_manifest_ratelimit.go).
// The legitimate poll cadence is ≤12/min per instance, so the cap absorbs a
// 5× burst from operator-driven manifest changes without ever throttling
// healthy adapters.
type ToolManifestHandler struct {
	svc     toolManifestService
	limiter *manifestRateLimiter
}

func NewToolManifestHandler(svc toolManifestService) *ToolManifestHandler {
	return &ToolManifestHandler{
		svc:     svc,
		limiter: newManifestRateLimiter(defaultManifestRateLimit, defaultManifestRateWindow),
	}
}

// ServeHTTP handles POST /corellia.v1.ToolService/GetToolManifest.
//
// Request: JSON body `{"instance_id":"<uuid>"}` (optional — token identifies
// the instance; the field is used only for request-level logging/validation).
// Auth: `Authorization: Bearer <raw_token>`.
//
// Response:
//   - 200 + `{"manifest":{...}}` — full manifest, ETag set.
//   - 304 — If-None-Match matched the current manifest_version; body empty.
//   - 401 — missing or invalid bearer token.
//   - 500 — unexpected internal error.
func (h *ToolManifestHandler) ServeHTTP(w http.ResponseWriter, r *http.Request) {
	// Extract bearer token.
	authHeader := r.Header.Get("Authorization")
	rawToken, ok := strings.CutPrefix(authHeader, "Bearer ")
	if !ok || rawToken == "" {
		http.Error(w, `{"code":"unauthenticated","message":"missing bearer token"}`, http.StatusUnauthorized)
		return
	}

	instanceID, manifestVersion, err := h.svc.AuthenticateManifestToken(r.Context(), rawToken)
	if err != nil {
		if errors.Is(err, tools.ErrInvalidManifestToken) {
			http.Error(w, `{"code":"unauthenticated","message":"invalid token"}`, http.StatusUnauthorized)
			return
		}
		http.Error(w, `{"code":"internal"}`, http.StatusInternalServerError)
		return
	}

	// Per-instance rate limit. Applied AFTER auth so a flood of unauthenticated
	// requests can't pollute the bucket table. Phase 7 hardening item 1.
	if h.limiter != nil && !h.limiter.allow(instanceID) {
		w.Header().Set("Retry-After", "60")
		http.Error(w, `{"code":"resource_exhausted","message":"manifest poll rate exceeded"}`, http.StatusTooManyRequests)
		return
	}

	// ETag is the manifest_version as a quoted string (HTTP ETag format).
	etag := fmt.Sprintf(`"%d"`, manifestVersion)

	// If-None-Match: if the adapter's cached version matches, return 304.
	if r.Header.Get("If-None-Match") == etag {
		w.Header().Set("ETag", etag)
		w.WriteHeader(http.StatusNotModified)
		return
	}

	manifest, err := h.svc.BuildManifestForInstance(r.Context(), instanceID)
	if err != nil {
		http.Error(w, `{"code":"internal"}`, http.StatusInternalServerError)
		return
	}

	// Encode ToolManifest to our JSON response shape. We use a manual
	// struct (not protojson.Marshal) to keep the adapter-facing wire format
	// stable and independent of proto field numbering changes.
	resp := manifestResponseJSON(manifest)
	body, err := json.Marshal(resp)
	if err != nil {
		http.Error(w, `{"code":"internal"}`, http.StatusInternalServerError)
		return
	}

	w.Header().Set("Content-Type", "application/json")
	w.Header().Set("ETag", etag)
	w.WriteHeader(http.StatusOK)
	w.Write(body) //nolint:errcheck
}

// ── wire format ──────────────────────────────────────────────────────────────
// These structs define the JSON shape the adapter's render_config.py parses.
// They mirror the proto message layout but are decoupled from protojson so
// the wire format is explicitly controlled here.

type manifestResponseWire struct {
	Manifest *toolManifestWire `json:"manifest"`
}

type toolManifestWire struct {
	InstanceID      string               `json:"instance_id,omitempty"`
	AdapterVersion  string               `json:"adapter_version,omitempty"`
	Toolsets        []equippedToolsetWire `json:"toolsets"`
	Env             map[string]string     `json:"env"`
	ManifestVersion int64                 `json:"manifest_version"`
}

type equippedToolsetWire struct {
	ToolsetKey string                 `json:"toolset_key"`
	Scope      map[string]interface{} `json:"scope,omitempty"`
}

func manifestResponseJSON(m *corelliav1.ToolManifest) manifestResponseWire {
	toolsets := make([]equippedToolsetWire, 0, len(m.Toolsets))
	for _, t := range m.Toolsets {
		var scope map[string]interface{}
		if t.Scope != nil {
			scope = t.Scope.AsMap()
		}
		toolsets = append(toolsets, equippedToolsetWire{
			ToolsetKey: t.ToolsetKey,
			Scope:      scope,
		})
	}
	env := m.Env
	if env == nil {
		env = map[string]string{}
	}
	return manifestResponseWire{
		Manifest: &toolManifestWire{
			InstanceID:      m.InstanceId,
			AdapterVersion:  m.AdapterVersion,
			Toolsets:        toolsets,
			Env:             env,
			ManifestVersion: m.ManifestVersion,
		},
	}
}
