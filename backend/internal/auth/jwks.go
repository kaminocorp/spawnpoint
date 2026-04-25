package auth

import (
	"context"
	"fmt"
	"time"

	"github.com/MicahParks/keyfunc/v3"
	"github.com/golang-jwt/jwt/v5"
)

// JWKSVerifier wraps a background-refreshed Supabase JWKS cache. Network
// I/O happens at construction and inside the refresh goroutine; request-path
// token validation is offline against the cached public keys.
type JWKSVerifier struct {
	kf keyfunc.Keyfunc
}

// NewJWKSVerifier performs the initial JWKS fetch and returns a verifier
// bound to ctx's lifetime. A failed first fetch (bad URL, unreachable host)
// returns an error so callers can fail loud at boot rather than mask the
// misconfiguration as a stream of request-time 401s.
func NewJWKSVerifier(ctx context.Context, jwksURL string) (*JWKSVerifier, error) {
	// keyfunc's default is NoErrorReturnFirstHTTPReq=true (swallow first-
	// fetch failures for graceful startup). Flip it — we want a
	// misconfigured SUPABASE_URL to fail boot immediately.
	failOnFirstFetchError := false
	kf, err := keyfunc.NewDefaultOverrideCtx(ctx, []string{jwksURL}, keyfunc.Override{
		NoErrorReturnFirstHTTPReq: &failOnFirstFetchError,
		HTTPTimeout:               10 * time.Second,
	})
	if err != nil {
		return nil, fmt.Errorf("auth: initial JWKS fetch from %s: %w", jwksURL, err)
	}
	return &JWKSVerifier{kf: kf}, nil
}

// Keyfunc returns a jwt.Keyfunc that resolves the public key for a token
// by its `kid` header.
func (v *JWKSVerifier) Keyfunc() jwt.Keyfunc {
	return v.kf.Keyfunc
}
