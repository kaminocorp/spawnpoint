package auth

import "github.com/google/uuid"

type AuthClaims struct {
	AuthUserID uuid.UUID
	Email      string
}
