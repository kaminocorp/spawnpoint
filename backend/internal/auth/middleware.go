package auth

import (
	"context"
	"net/http"
	"strings"

	"github.com/golang-jwt/jwt/v5"
	"github.com/google/uuid"
)

type ctxKey struct{}

// Middleware validates the Supabase access token on `Authorization: Bearer`
// and attaches parsed claims to the request context.
func Middleware(jwtSecret string) func(http.Handler) http.Handler {
	return func(next http.Handler) http.Handler {
		return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
			tokenStr := strings.TrimPrefix(r.Header.Get("Authorization"), "Bearer ")
			if tokenStr == "" {
				http.Error(w, "missing bearer token", http.StatusUnauthorized)
				return
			}

			claims := jwt.MapClaims{}
			if _, err := jwt.ParseWithClaims(tokenStr, claims, func(t *jwt.Token) (any, error) {
				return []byte(jwtSecret), nil
			}); err != nil {
				http.Error(w, "invalid token", http.StatusUnauthorized)
				return
			}

			sub, _ := claims["sub"].(string)
			email, _ := claims["email"].(string)
			authUserID, err := uuid.Parse(sub)
			if err != nil {
				http.Error(w, "invalid sub claim", http.StatusUnauthorized)
				return
			}

			ctx := context.WithValue(r.Context(), ctxKey{}, &AuthClaims{
				AuthUserID: authUserID,
				Email:      email,
			})
			next.ServeHTTP(w, r.WithContext(ctx))
		})
	}
}

func FromContext(ctx context.Context) (*AuthClaims, bool) {
	ac, ok := ctx.Value(ctxKey{}).(*AuthClaims)
	return ac, ok
}
