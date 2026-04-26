package tools

import "errors"

var (
	// ErrToolNotFound is returned when a tool ID has no matching catalog row.
	ErrToolNotFound = errors.New("tool not found")

	// ErrToolNotAvailableForOrg is returned when the operator tries to grant a
	// toolset that the org-admin has curated out, or that is not in the catalog
	// for the instance's harness adapter. Phase 3 SetInstanceGrants checks this.
	ErrToolNotAvailableForOrg = errors.New("tool not available for this org")

	// ErrInvalidScope is returned by ValidateScope when the caller-supplied
	// scope_json does not conform to the toolset's scope_shape. The error is
	// always wrapped with a description of the first violation, so callers
	// should use errors.Is rather than equality comparison.
	ErrInvalidScope = errors.New("invalid tool scope")

	// ErrCredentialMissing is returned when a grant for a toolset with
	// required_env_vars is submitted without a credential_storage_ref.
	// Phase 3 SetInstanceGrants enforces this.
	ErrCredentialMissing = errors.New("credential required for this toolset")

	// ErrInstanceNotForOrg is returned when an instance ID exists in a
	// different org (or not at all). The handler maps this to NotFound —
	// not PermissionDenied — to avoid leaking cross-org existence
	// (matches the M4 multi-tenancy posture in agents.GetAgentInstanceByID).
	ErrInstanceNotForOrg = errors.New("agent instance not found")

	// ErrForbidden is returned when the caller lacks the required role
	// for an org-curation write. Mapped to Connect PermissionDenied.
	ErrForbidden = errors.New("forbidden")

	// ErrTransactorMissing is returned by SetInstanceGrants when the
	// service was constructed without a Transactor. Programmer error
	// (cmd/api wiring oversight); never reachable from the wire.
	ErrTransactorMissing = errors.New("tools: transactor not configured")
)
