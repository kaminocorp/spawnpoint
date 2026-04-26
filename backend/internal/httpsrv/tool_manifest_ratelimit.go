package httpsrv

import (
	"sync"
	"time"

	"github.com/google/uuid"
)

// tokenBucket is a simple sliding-rate counter — N requests per window. Used
// per-instance by the manifest handler to bound a misbehaving adapter's poll
// rate. v1.5 Pillar B Phase 7 plan §3 hardening item 1.
//
// Why a counting window instead of a leaky bucket:
//   - The adapter's poll daemon is on a 30s default TTL with a 5s lower bound
//     (Phase 5's CORELLIA_MANIFEST_POLL_TTL clamp). The legitimate steady-state
//     request rate is ≤12/min per instance.
//   - An emergency revoke flow may legitimately spike an instance's request
//     rate when the operator clicks the fleet-inspector save button — the
//     adapter's next poll fetches the new manifest, and a manual ETag-mismatch
//     burst could happen if multiple operators edit the same instance.
//   - 60 requests/min cap absorbs a 10× burst above the legitimate rate
//     without throttling legitimate poll-after-edit cases.
//
// The bucket is in-process state. Multiple Corellia API instances each track
// their own buckets, so a misbehaving adapter pinned to one Corellia instance
// is rate-limited by that instance only — acceptable for v1.5 (single Fly
// machine for the control plane). When the control plane scales horizontally
// (post-v1.5), the bucket migrates to Redis or similar.
type tokenBucket struct {
	mu       sync.Mutex
	limit    int
	window   time.Duration
	requests []time.Time
}

func (b *tokenBucket) allow(now time.Time) bool {
	b.mu.Lock()
	defer b.mu.Unlock()
	cutoff := now.Add(-b.window)
	// Drop expired entries — linear scan, fine because the window is small
	// and the buckets are bounded by `limit` entries each.
	kept := b.requests[:0]
	for _, t := range b.requests {
		if t.After(cutoff) {
			kept = append(kept, t)
		}
	}
	b.requests = kept
	if len(b.requests) >= b.limit {
		return false
	}
	b.requests = append(b.requests, now)
	return true
}

// manifestRateLimiter is the per-instance rate-limit registry the manifest
// handler consults before assembling a manifest response. Buckets are created
// on first use and never garbage-collected — the table grows linearly with
// active-instance count, capped by the agent_instances row count and bounded
// at v1.5 scale (≤thousands). When that ceases to hold, the registry gains a
// timed cleaner; for now, simplicity wins.
type manifestRateLimiter struct {
	mu      sync.Mutex
	buckets map[uuid.UUID]*tokenBucket
	limit   int
	window  time.Duration
	now     func() time.Time // injectable for tests
}

func newManifestRateLimiter(limit int, window time.Duration) *manifestRateLimiter {
	return &manifestRateLimiter{
		buckets: make(map[uuid.UUID]*tokenBucket),
		limit:   limit,
		window:  window,
		now:     time.Now,
	}
}

func (l *manifestRateLimiter) allow(instanceID uuid.UUID) bool {
	l.mu.Lock()
	bucket, ok := l.buckets[instanceID]
	if !ok {
		bucket = &tokenBucket{limit: l.limit, window: l.window}
		l.buckets[instanceID] = bucket
	}
	l.mu.Unlock()
	return bucket.allow(l.now())
}

// Default per-instance limits. Changing these requires bumping the adapter's
// CORELLIA_MANIFEST_POLL_TTL bounds in concert (Phase 5's plugin clamp) so
// the legitimate poll rate remains a comfortable fraction of the cap.
const (
	defaultManifestRateLimit  = 60
	defaultManifestRateWindow = 1 * time.Minute
)
