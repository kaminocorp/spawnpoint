package deploy

import (
	"strings"
	"testing"

	"github.com/google/uuid"
)

// Compile-time assertions that every concrete type in this package
// satisfies the DeployTarget interface. Removing or renaming a
// method on any of them produces a directed build failure here
// rather than a runtime surprise at the call site.
var (
	_ DeployTarget = (*FlyDeployTarget)(nil)
	_ DeployTarget = (*LocalDeployTarget)(nil)
	_ DeployTarget = (*AWSDeployTarget)(nil)
)

func TestValidateImageRef(t *testing.T) {
	tests := []struct {
		name    string
		ref     string
		wantErr bool
	}{
		{"digest-pinned ghcr", "ghcr.io/hejijunhao/corellia-hermes-adapter@sha256:d152b3cbf7", false},
		{"digest-pinned dockerhub", "docker.io/nousresearch/hermes-agent@sha256:d4ee57f254", false},
		{"tag-pinned latest", "ghcr.io/foo/bar:latest", true},
		{"tag-pinned semver", "ghcr.io/foo/bar:v1.2.3", true},
		{"bare repo no tag", "ghcr.io/foo/bar", true},
		{"empty string", "", true},
		{"contains sha256 but no @", "ghcr.io/foo/bar-sha256-abc", true},
	}
	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			err := validateImageRef(tt.ref)
			if (err != nil) != tt.wantErr {
				t.Errorf("validateImageRef(%q) err = %v, wantErr = %v", tt.ref, err, tt.wantErr)
			}
		})
	}
}

func TestMapFlyState(t *testing.T) {
	tests := []struct {
		state string
		want  HealthStatus
	}{
		{"started", HealthStarted},
		{"starting", HealthStarting},
		{"created", HealthStarting},
		{"stopped", HealthStopped},
		{"stopping", HealthStopped},
		{"destroyed", HealthStopped},
		{"destroying", HealthStopped},
		{"failed", HealthFailed},
		{"unknown-future-state", HealthFailed},
		{"", HealthFailed},
	}
	for _, tt := range tests {
		t.Run(tt.state, func(t *testing.T) {
			if got := mapFlyState(tt.state); got != tt.want {
				t.Errorf("mapFlyState(%q) = %v, want %v", tt.state, got, tt.want)
			}
		})
	}
}

func TestAppNameFor(t *testing.T) {
	t.Run("uuid passthrough", func(t *testing.T) {
		id := uuid.MustParse("11111111-2222-3333-4444-555555555555")
		got := appNameFor(id.String())
		want := "corellia-agent-11111111"
		if got != want {
			t.Errorf("appNameFor(%q) = %q, want %q", id.String(), got, want)
		}
	})
	t.Run("non-uuid name hashes deterministically", func(t *testing.T) {
		got1 := appNameFor("alice-hermes")
		got2 := appNameFor("alice-hermes")
		if got1 != got2 {
			t.Errorf("appNameFor non-deterministic: %q vs %q", got1, got2)
		}
		if !strings.HasPrefix(got1, "corellia-agent-") {
			t.Errorf("missing prefix: %q", got1)
		}
		if suffix := strings.TrimPrefix(got1, "corellia-agent-"); len(suffix) != 8 {
			t.Errorf("expected 8-char suffix, got %q (len %d)", suffix, len(suffix))
		}
	})
	t.Run("different inputs hash differently", func(t *testing.T) {
		if appNameFor("alice") == appNameFor("bob") {
			t.Error("hash collision on distinct names")
		}
	})
}

func TestParseExternalRef(t *testing.T) {
	tests := []struct {
		name    string
		ref     string
		wantApp string
		wantErr bool
	}{
		{"valid", "fly-app:corellia-agent-12345678", "corellia-agent-12345678", false},
		{"missing prefix", "corellia-agent-12345678", "", true},
		{"wrong prefix", "fly:corellia-agent-12345678", "", true},
		{"empty string", "", "", true},
	}
	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			got, err := parseExternalRef(tt.ref)
			if (err != nil) != tt.wantErr {
				t.Errorf("parseExternalRef(%q) err = %v, wantErr = %v", tt.ref, err, tt.wantErr)
			}
			if got != tt.wantApp {
				t.Errorf("parseExternalRef(%q) app = %q, want %q", tt.ref, got, tt.wantApp)
			}
		})
	}
}
