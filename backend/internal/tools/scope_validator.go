package tools

import (
	"encoding/json"
	"fmt"
	"regexp"
)

const (
	maxPatternListLen = 64  // max entries in a pattern_list or regex_list field
	maxPatternLen     = 200 // max chars per individual pattern or path
)

// scopeFieldShape describes one field in a toolset's scope_shape JSONB column.
// The JSON keys match the catalog YAML's scope_shape sub-object keys.
type scopeFieldShape struct {
	Type        string `json:"type"`        // "pattern_list" | "regex_list" | "path"
	Description string `json:"description"` // human-readable, for UI display
	DefaultDeny bool   `json:"default_deny"`
}

// ValidateScope checks that scopeJSON conforms to the toolset's scopeShape.
//
// scopeShape is the tools.scope_shape JSONB column value; scopeJSON is the
// operator-supplied scope (from the wizard or the fleet-view grant editor).
//
// Type semantics:
//   - "pattern_list": a JSON array of strings; each ≤200 chars, max 64 entries,
//     no empty strings. Used for URL globs (web) and path globs (file).
//   - "regex_list":   a JSON array of strings; each must compile as a Go regexp.
//     Used for terminal command allowlists.
//   - "path":         a JSON string; empty is valid (means "no pin").
//     Used for working_directory.
//
// Fields present in scopeShape but absent or null in scopeJSON are skipped
// (they will use default-deny at enforcement time — Phase 5 plugin).
// Fields present in scopeJSON but absent in scopeShape are silently ignored
// (forward-compatible with future shape additions).
// An empty scopeShape (nil, "{}", or "null") always returns nil.
func ValidateScope(scopeShape, scopeJSON json.RawMessage) error {
	if isEmptyJSON(scopeShape) {
		return nil
	}

	var shape map[string]scopeFieldShape
	if err := json.Unmarshal(scopeShape, &shape); err != nil {
		return fmt.Errorf("%w: malformed scope_shape: %v", ErrInvalidScope, err)
	}
	if len(shape) == 0 {
		return nil
	}

	var incoming map[string]json.RawMessage
	if !isEmptyJSON(scopeJSON) {
		if err := json.Unmarshal(scopeJSON, &incoming); err != nil {
			return fmt.Errorf("%w: scope JSON is not a valid object: %v", ErrInvalidScope, err)
		}
	}

	for key, field := range shape {
		raw, present := incoming[key]
		if !present || string(raw) == "null" {
			continue
		}
		switch field.Type {
		case "pattern_list":
			if err := validatePatternList(key, raw); err != nil {
				return err
			}
		case "regex_list":
			if err := validateRegexList(key, raw); err != nil {
				return err
			}
		case "path":
			if err := validatePathField(key, raw); err != nil {
				return err
			}
		}
		// unknown type: silently accept — forward-compatible
	}
	return nil
}

func isEmptyJSON(raw json.RawMessage) bool {
	s := string(raw)
	return len(raw) == 0 || s == "null" || s == "{}" || s == "[]"
}

func validatePatternList(field string, raw json.RawMessage) error {
	var patterns []string
	if err := json.Unmarshal(raw, &patterns); err != nil {
		return fmt.Errorf("%w: field %q must be an array of strings", ErrInvalidScope, field)
	}
	if len(patterns) > maxPatternListLen {
		return fmt.Errorf("%w: field %q has %d patterns (max %d)", ErrInvalidScope, field, len(patterns), maxPatternListLen)
	}
	for i, p := range patterns {
		if len(p) == 0 {
			return fmt.Errorf("%w: field %q: pattern %d is empty", ErrInvalidScope, field, i)
		}
		if len(p) > maxPatternLen {
			return fmt.Errorf("%w: field %q: pattern %d exceeds %d chars", ErrInvalidScope, field, i, maxPatternLen)
		}
	}
	return nil
}

func validateRegexList(field string, raw json.RawMessage) error {
	var patterns []string
	if err := json.Unmarshal(raw, &patterns); err != nil {
		return fmt.Errorf("%w: field %q must be an array of strings", ErrInvalidScope, field)
	}
	if len(patterns) > maxPatternListLen {
		return fmt.Errorf("%w: field %q has %d patterns (max %d)", ErrInvalidScope, field, len(patterns), maxPatternListLen)
	}
	for i, p := range patterns {
		if _, err := regexp.Compile(p); err != nil {
			return fmt.Errorf("%w: field %q: pattern %d is not a valid regexp: %v", ErrInvalidScope, field, i, err)
		}
	}
	return nil
}

func validatePathField(field string, raw json.RawMessage) error {
	var p string
	if err := json.Unmarshal(raw, &p); err != nil {
		return fmt.Errorf("%w: field %q must be a string", ErrInvalidScope, field)
	}
	// empty string is valid — it means "no working directory pin"
	if len(p) > maxPatternLen {
		return fmt.Errorf("%w: field %q path exceeds %d chars", ErrInvalidScope, field, maxPatternLen)
	}
	return nil
}
