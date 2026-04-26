package httpsrv

import (
	"context"
	"encoding/json"
	"errors"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
	"time"

	"github.com/google/uuid"

	"github.com/hejijunhao/corellia/backend/internal/tools"
	corelliav1 "github.com/hejijunhao/corellia/backend/internal/gen/corellia/v1"
)

// ── fake ─────────────────────────────────────────────────────────────────────

type fakeManifestSvc struct {
	instanceID      uuid.UUID
	manifestVersion int64
	authErr         error
	manifest        *corelliav1.ToolManifest
	buildErr        error
}

func (f *fakeManifestSvc) AuthenticateManifestToken(_ context.Context, _ string) (uuid.UUID, int64, error) {
	return f.instanceID, f.manifestVersion, f.authErr
}

func (f *fakeManifestSvc) BuildManifestForInstance(_ context.Context, _ uuid.UUID) (*corelliav1.ToolManifest, error) {
	return f.manifest, f.buildErr
}

// ── helpers ───────────────────────────────────────────────────────────────────

func postManifest(h http.Handler, bearer, ifNoneMatch string) *httptest.ResponseRecorder {
	body := strings.NewReader(`{"instance_id":"test"}`)
	req := httptest.NewRequest(http.MethodPost, "/corellia.v1.ToolService/GetToolManifest", body)
	req.Header.Set("Content-Type", "application/json")
	if bearer != "" {
		req.Header.Set("Authorization", "Bearer "+bearer)
	}
	if ifNoneMatch != "" {
		req.Header.Set("If-None-Match", ifNoneMatch)
	}
	rr := httptest.NewRecorder()
	h.ServeHTTP(rr, req)
	return rr
}

// ── tests ─────────────────────────────────────────────────────────────────────

func TestToolManifest_MissingToken(t *testing.T) {
	h := NewToolManifestHandler(&fakeManifestSvc{})
	rr := postManifest(h, "", "")
	if rr.Code != http.StatusUnauthorized {
		t.Fatalf("expected 401, got %d", rr.Code)
	}
}

func TestToolManifest_InvalidToken(t *testing.T) {
	svc := &fakeManifestSvc{authErr: tools.ErrInvalidManifestToken}
	h := NewToolManifestHandler(svc)
	rr := postManifest(h, "bad-token", "")
	if rr.Code != http.StatusUnauthorized {
		t.Fatalf("expected 401, got %d", rr.Code)
	}
}

func TestToolManifest_HappyPath(t *testing.T) {
	instanceID := uuid.New()
	svc := &fakeManifestSvc{
		instanceID:      instanceID,
		manifestVersion: 3,
		manifest: &corelliav1.ToolManifest{
			InstanceId:      instanceID.String(),
			AdapterVersion:  "v2026.4.23",
			Toolsets:        []*corelliav1.EquippedToolset{{ToolsetKey: "web"}},
			Env:             map[string]string{},
			ManifestVersion: 3,
		},
	}
	h := NewToolManifestHandler(svc)
	rr := postManifest(h, "valid-token", "")

	if rr.Code != http.StatusOK {
		t.Fatalf("expected 200, got %d: %s", rr.Code, rr.Body.String())
	}
	if rr.Header().Get("ETag") != `"3"` {
		t.Fatalf("expected ETag '\"3\"', got %q", rr.Header().Get("ETag"))
	}
	var resp manifestResponseWire
	if err := json.NewDecoder(rr.Body).Decode(&resp); err != nil {
		t.Fatalf("decode body: %v", err)
	}
	if resp.Manifest == nil {
		t.Fatal("manifest is nil")
	}
	if len(resp.Manifest.Toolsets) != 1 || resp.Manifest.Toolsets[0].ToolsetKey != "web" {
		t.Fatalf("unexpected toolsets: %+v", resp.Manifest.Toolsets)
	}
	if resp.Manifest.ManifestVersion != 3 {
		t.Fatalf("expected manifest_version 3, got %d", resp.Manifest.ManifestVersion)
	}
}

func TestToolManifest_IfNoneMatch_304(t *testing.T) {
	instanceID := uuid.New()
	svc := &fakeManifestSvc{
		instanceID:      instanceID,
		manifestVersion: 7,
	}
	h := NewToolManifestHandler(svc)

	// Send If-None-Match matching current version.
	rr := postManifest(h, "valid-token", `"7"`)
	if rr.Code != http.StatusNotModified {
		t.Fatalf("expected 304, got %d", rr.Code)
	}
	if rr.Header().Get("ETag") != `"7"` {
		t.Fatalf("expected ETag '\"7\"', got %q", rr.Header().Get("ETag"))
	}
	if rr.Body.Len() != 0 {
		t.Fatalf("expected empty body on 304, got %q", rr.Body.String())
	}
}

func TestToolManifest_IfNoneMatch_Stale(t *testing.T) {
	instanceID := uuid.New()
	svc := &fakeManifestSvc{
		instanceID:      instanceID,
		manifestVersion: 7,
		manifest: &corelliav1.ToolManifest{
			InstanceId:      instanceID.String(),
			AdapterVersion:  "v2026.4.23",
			Toolsets:        nil,
			Env:             map[string]string{},
			ManifestVersion: 7,
		},
	}
	h := NewToolManifestHandler(svc)

	// Stale ETag (old version) → should return 200 with full body.
	rr := postManifest(h, "valid-token", `"6"`)
	if rr.Code != http.StatusOK {
		t.Fatalf("expected 200 for stale ETag, got %d", rr.Code)
	}
}

func TestToolManifest_BuildError_Internal(t *testing.T) {
	svc := &fakeManifestSvc{
		instanceID:      uuid.New(),
		manifestVersion: 1,
		buildErr:        errors.New("db exploded"),
	}
	h := NewToolManifestHandler(svc)
	rr := postManifest(h, "valid-token", "")
	if rr.Code != http.StatusInternalServerError {
		t.Fatalf("expected 500, got %d", rr.Code)
	}
}

// Phase 7 hardening: per-instance rate limit. Once the bucket is exhausted
// further requests return 429 with a Retry-After header.
func TestToolManifest_RateLimit(t *testing.T) {
	instanceID := uuid.New()
	svc := &fakeManifestSvc{
		instanceID:      instanceID,
		manifestVersion: 1,
		manifest: &corelliav1.ToolManifest{
			InstanceId:      instanceID.String(),
			AdapterVersion:  "v2026.4.23",
			Env:             map[string]string{},
			ManifestVersion: 1,
		},
	}
	h := NewToolManifestHandler(svc)
	// Override the bucket with a tiny limit so the test stays fast.
	h.limiter = newManifestRateLimiter(2, time.Minute)

	for i := 0; i < 2; i++ {
		rr := postManifest(h, "valid-token", "")
		if rr.Code != http.StatusOK {
			t.Fatalf("call %d: expected 200, got %d", i, rr.Code)
		}
	}
	rr := postManifest(h, "valid-token", "")
	if rr.Code != http.StatusTooManyRequests {
		t.Fatalf("expected 429 once bucket is full, got %d", rr.Code)
	}
	if rr.Header().Get("Retry-After") == "" {
		t.Fatalf("expected Retry-After header on 429")
	}
}

// Per-instance isolation: a noisy neighbour must not throttle a different
// instance's bucket.
func TestToolManifest_RateLimit_IsolatedPerInstance(t *testing.T) {
	a, b := uuid.New(), uuid.New()
	svcA := &fakeManifestSvc{
		instanceID:      a,
		manifestVersion: 1,
		manifest: &corelliav1.ToolManifest{
			InstanceId:      a.String(),
			AdapterVersion:  "v",
			Env:             map[string]string{},
			ManifestVersion: 1,
		},
	}
	hA := NewToolManifestHandler(svcA)
	hA.limiter = newManifestRateLimiter(1, time.Minute)

	// Burn instance A's bucket.
	if rr := postManifest(hA, "tok-a", ""); rr.Code != http.StatusOK {
		t.Fatalf("first call A: expected 200, got %d", rr.Code)
	}
	if rr := postManifest(hA, "tok-a", ""); rr.Code != http.StatusTooManyRequests {
		t.Fatalf("second call A: expected 429, got %d", rr.Code)
	}

	// Instance B authenticates as a different instance via the fake — uses
	// the same handler's limiter table and gets its own bucket.
	svcA.instanceID = b
	if rr := postManifest(hA, "tok-b", ""); rr.Code != http.StatusOK {
		t.Fatalf("instance B: expected 200 (separate bucket), got %d", rr.Code)
	}
}
