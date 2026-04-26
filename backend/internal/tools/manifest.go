package tools

import (
	"context"
	"crypto/rand"
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"errors"
	"fmt"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5"
	"google.golang.org/protobuf/types/known/structpb"

	"github.com/hejijunhao/corellia/backend/internal/db"
	corelliav1 "github.com/hejijunhao/corellia/backend/internal/gen/corellia/v1"
)

// currentAdapterVersion is the Hermes adapter version this build of
// Corellia's tools catalog is grounded against. When the Hermes upstream
// digest bumps and a new catalog migration ships, this constant changes
// alongside it.
const currentAdapterVersion = "v2026.4.23"

// manifestTokenBytes is the entropy of the per-instance bearer token.
// 32 bytes hex-encode to a 64-char string — well inside Fly's secret-value
// size limit and large enough that brute-force is uneconomic.
const manifestTokenBytes = 32

// IssueManifestToken generates a fresh per-instance bearer token, stores
// its SHA-256 hash in agent_instance_manifest_tokens, and returns the raw
// hex token for the caller to set as a Fly app secret
// (CORELLIA_INSTANCE_TOKEN). Called by the agents.Service spawn flow
// immediately after the instance row is committed.
//
// The raw token never touches Corellia's DB — only the SHA-256 hex hash
// is persisted, consistent with blueprint §11.6's credential-isolation rule
// applied to control-plane auth tokens.
func (s *Service) IssueManifestToken(ctx context.Context, instanceID uuid.UUID) (string, error) {
	buf := make([]byte, manifestTokenBytes)
	if _, err := rand.Read(buf); err != nil {
		return "", fmt.Errorf("tools: generate manifest token: %w", err)
	}
	rawHex := hex.EncodeToString(buf)
	if err := s.queries.InsertManifestToken(ctx, db.InsertManifestTokenParams{
		AgentInstanceID: instanceID,
		TokenHash:       hashManifestToken(rawHex),
	}); err != nil {
		return "", fmt.Errorf("tools: store manifest token: %w", err)
	}
	return rawHex, nil
}

// AuthenticateManifestToken verifies an incoming bearer token from the
// adapter and returns the instance ID + current manifest_version.
// Returns ErrInvalidManifestToken (wraps ErrInvalidScope for simplicity)
// when the token has no matching hash in the DB.
func (s *Service) AuthenticateManifestToken(ctx context.Context, rawToken string) (uuid.UUID, int64, error) {
	hash := hashManifestToken(rawToken)
	row, err := s.queries.GetManifestTokenByHash(ctx, hash)
	if err != nil {
		if errors.Is(err, pgx.ErrNoRows) {
			return uuid.Nil, 0, ErrInvalidManifestToken
		}
		return uuid.Nil, 0, err
	}
	return row.AgentInstanceID, row.ManifestVersion, nil
}

// BuildManifestForInstance assembles the ToolManifest proto for the given
// instance from its active grants. The env map is always empty in Phase 2 —
// credentials are already available as Fly app secrets. Phase 7 will populate
// it when post-spawn credential updates are wired.
func (s *Service) BuildManifestForInstance(ctx context.Context, instanceID uuid.UUID) (*corelliav1.ToolManifest, error) {
	tokenRow, err := s.queries.GetManifestTokenByInstance(ctx, instanceID)
	if err != nil {
		if errors.Is(err, pgx.ErrNoRows) {
			return nil, ErrToolNotFound
		}
		return nil, err
	}

	grants, err := s.queries.ListInstanceToolGrants(ctx, instanceID)
	if err != nil {
		return nil, err
	}

	toolsets := make([]*corelliav1.EquippedToolset, 0, len(grants))
	for _, g := range grants {
		scope, err := scopeJSONToStruct(g.ScopeJson)
		if err != nil {
			return nil, fmt.Errorf("tools: build manifest scope for %s: %w", g.ToolsetKey, err)
		}
		toolsets = append(toolsets, &corelliav1.EquippedToolset{
			ToolsetKey: g.ToolsetKey,
			Scope:      scope,
		})
	}

	return &corelliav1.ToolManifest{
		InstanceId:      instanceID.String(),
		AdapterVersion:  currentAdapterVersion,
		Toolsets:        toolsets,
		Env:             map[string]string{},
		ManifestVersion: tokenRow.ManifestVersion,
	}, nil
}

// BumpManifestVersion increments the manifest_version counter for an instance.
// Called by Phase 3's SetInstanceGrants after a successful grant write so
// the adapter's poll daemon detects the change via ETag.
func (s *Service) BumpManifestVersion(ctx context.Context, instanceID uuid.UUID) error {
	return s.queries.BumpManifestVersion(ctx, instanceID)
}

// hashManifestToken returns the hex-encoded SHA-256 of the raw bearer token.
// Stored in the DB; compared against incoming tokens on each request.
func hashManifestToken(raw string) string {
	sum := sha256.Sum256([]byte(raw))
	return hex.EncodeToString(sum[:])
}

// scopeJSONToStruct converts a scope_json JSONB value ([]byte) to a
// google.protobuf.Struct, which is the proto representation of a free-form
// JSON object. Returns nil (not an error) for empty scope.
func scopeJSONToStruct(raw []byte) (*structpb.Struct, error) {
	if len(raw) == 0 || string(raw) == "{}" || string(raw) == "null" {
		return nil, nil
	}
	var m map[string]interface{}
	if err := json.Unmarshal(raw, &m); err != nil {
		return nil, err
	}
	return structpb.NewStruct(m)
}

// Sentinel for invalid/unknown manifest tokens.
var ErrInvalidManifestToken = errors.New("invalid manifest token")
