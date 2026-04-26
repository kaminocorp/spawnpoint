"""
corellia_guard — Hermes plugin for v1.5 Pillar B (Tools Governance) Phase 5.

Enforces the three non-native scopes (URL allowlist on `web`, command-pattern
allowlist on `terminal`, path allowlist on `file`) plus the working-directory
pin on `terminal`. Hermes's `platform_toolsets.cli` config gates which
*toolsets* load; this plugin gates which *calls within an equipped toolset*
are allowed.

Wiring:

    plugin.yaml declares  hooks: [pre_tool_call]
    register(ctx)         called per AIAgent instantiation (single-flight
                          guard — see _ensure_started). Spawns the daemon
                          poll thread once per process. Re-attaches the
                          pre_tool_call hook to every fresh ctx.
    daemon thread         polls CORELLIA_TOOL_MANIFEST_URL on a TTL
                          (default 30s, env-overridable, clamped 5s..5min).
                          ETag-aware — sends If-None-Match: "<version>".
                          On 200, atomically rewrites scope.json. On 304,
                          no-op. On error, logs + retries with backoff.
    pre_tool_call hook    reads scope.json via mtime cache; routes by
                          tool_name to the matching scope; returns
                          {"action": "block", "message": ...} on rejection
                          or None to permit.

Per Phase 5 risk-register row "plugin daemon-thread leaks": Hermes calls
`register(ctx)` for every fresh AIAgent — including any code path that
spins up a sub-agent (delegation toolset). Without a guard, the daemon
thread spawns N times. The module-level sentinel + Lock below prevents
that; hooks are still re-attached on every ctx because hooks live on the
ctx, not the process.
"""

from __future__ import annotations

import json
import logging
import os
import threading
import time
import urllib.error
import urllib.request
from pathlib import Path
from typing import Optional

from .hook import ScopeCache, make_pre_tool_call

log = logging.getLogger("corellia_guard")


# ── single-flight guard ──────────────────────────────────────────────────────

_REGISTER_LOCK = threading.Lock()
_STARTED = False
_CACHE: Optional[ScopeCache] = None
_HOOK = None  # closure bound to the ScopeCache


# ── poll TTL: 30s default, clamped 5s..5min per plan §5 decision 5 ───────────

_TTL_DEFAULT_SECONDS = 30.0
_TTL_MIN_SECONDS = 5.0
_TTL_MAX_SECONDS = 300.0
_BACKOFF_INITIAL = 5.0
_BACKOFF_MAX = 60.0

# After this many CONSECUTIVE 401/403 responses from the manifest endpoint,
# the daemon force-denies the cached scope. The behaviour distinguishes
# transient blips (network / TLS / DNS — manifest endpoint *unreachable*,
# preserves last-known-good per Phase 5 acceptance gate) from a deliberate
# revocation by the control plane (token rejected — last-known-good would
# silently keep enforcing grants the operator just removed).
#
# Threshold: 3 polls. With the default TTL clamped at the 5s floor by
# backoff, this is at most ~3×60s = 3 minutes before deny-all kicks in,
# which is the right order of magnitude for "operator clicked revoke and
# expects it to take effect within minutes" without flapping on a single
# transient 401. A 403 (instance not found, deliberately revoked) flips
# to deny-all immediately.
_AUTH_DENY_AFTER_CONSECUTIVE_401 = 3


def register(ctx) -> None:  # noqa: ANN001 — Hermes injects untyped ctx
    """Plugin entry point. Hermes calls this per AIAgent instantiation."""
    global _STARTED, _CACHE, _HOOK

    with _REGISTER_LOCK:
        if not _STARTED:
            _CACHE = ScopeCache(_scope_path())
            _HOOK = make_pre_tool_call(_CACHE)
            _start_poll_daemon(_CACHE)
            _STARTED = True
            log.info("corellia_guard: registered (process-global poll daemon spawned)")
        else:
            log.debug("corellia_guard: re-registering hook on fresh ctx (poll daemon already live)")

    # Hooks live on the ctx — re-attach on every register call so subagent
    # AIAgent instantiations get the hook too. The cache + thread are
    # process-global, but the hook itself is cheap to add per ctx.
    if _HOOK is not None:
        try:
            ctx.add_hook("pre_tool_call", _HOOK)
        except Exception as e:  # pragma: no cover — defensive
            log.error("corellia_guard: failed to attach pre_tool_call hook: %s", e)


# ── scope.json path ──────────────────────────────────────────────────────────


def _scope_path() -> Path:
    home = os.environ.get("HERMES_HOME") or os.path.expanduser("~/.hermes")
    return Path(home) / "corellia" / "scope.json"


# ── poll daemon ──────────────────────────────────────────────────────────────


def _ttl_seconds() -> float:
    raw = os.environ.get("CORELLIA_MANIFEST_POLL_TTL")
    if not raw:
        return _TTL_DEFAULT_SECONDS
    try:
        v = float(raw)
    except ValueError:
        log.warning(
            "corellia_guard: bogus CORELLIA_MANIFEST_POLL_TTL=%r — using default %.0fs",
            raw,
            _TTL_DEFAULT_SECONDS,
        )
        return _TTL_DEFAULT_SECONDS
    return max(_TTL_MIN_SECONDS, min(_TTL_MAX_SECONDS, v))


def _start_poll_daemon(cache: ScopeCache) -> None:
    url = os.environ.get("CORELLIA_TOOL_MANIFEST_URL", "")
    token = os.environ.get("CORELLIA_INSTANCE_TOKEN", "")
    instance_id = os.environ.get("CORELLIA_AGENT_ID", "")

    if not url or not token:
        log.warning(
            "corellia_guard: CORELLIA_TOOL_MANIFEST_URL or CORELLIA_INSTANCE_TOKEN unset "
            "— skipping poll daemon. Plugin will only enforce the initial scope.json."
        )
        return

    t = threading.Thread(
        target=_poll_loop,
        args=(cache, url, token, instance_id),
        name="corellia_guard.poll",
        daemon=True,
    )
    t.start()


def _poll_loop(cache: ScopeCache, url: str, token: str, instance_id: str) -> None:
    """Polling loop: TTL on success, exponential backoff on error.

    Fail-safe: on a transient error (network, 5xx, malformed body), the
    previous scope.json on disk is left untouched and the cache continues
    serving last-known-good. Stale manifest never relaxes enforcement
    (Phase 5 acceptance gate).

    Hard revocation: a 403 (instance not found / deliberately revoked)
    immediately forces the cache to deny-all. Sustained 401 (token
    rejected over `_AUTH_DENY_AFTER_CONSECUTIVE_401` polls) does the same
    — distinguishes transient TLS blips from a real "operator killed
    this token" event."""
    backoff = _BACKOFF_INITIAL
    etag = ""  # most recent ETag we saw; sent as If-None-Match
    consecutive_401 = 0

    while True:
        try:
            new_etag = _poll_once(cache, url, token, instance_id, etag)
            if new_etag is not None:
                etag = new_etag
            backoff = _BACKOFF_INITIAL
            consecutive_401 = 0
            # A successful poll means the token is accepted — lift any
            # sticky deny-all that a prior 401/403 burst installed. The
            # next `get()` resumes serving the on-disk scope.
            cache.clear_force_deny()
            time.sleep(_ttl_seconds())
        except urllib.error.HTTPError as e:
            if e.code == 403:
                log.error(
                    "corellia_guard: manifest endpoint returned 403 — instance "
                    "or token revoked. Forcing scope to deny-all immediately."
                )
                cache.force_deny_all()
                # Continue polling at backoff cadence so a re-grant restores
                # enforcement; do NOT exit the loop.
                time.sleep(backoff)
                backoff = min(_BACKOFF_MAX, backoff * 2)
                continue
            if e.code == 401:
                consecutive_401 += 1
                if consecutive_401 >= _AUTH_DENY_AFTER_CONSECUTIVE_401:
                    log.error(
                        "corellia_guard: %d consecutive 401s from manifest "
                        "endpoint — forcing scope to deny-all (token revoked).",
                        consecutive_401,
                    )
                    cache.force_deny_all()
                else:
                    log.warning(
                        "corellia_guard: manifest endpoint returned 401 (%d/%d) — "
                        "preserving last-known-good scope.",
                        consecutive_401,
                        _AUTH_DENY_AFTER_CONSECUTIVE_401,
                    )
                time.sleep(backoff)
                backoff = min(_BACKOFF_MAX, backoff * 2)
                continue
            log.warning(
                "corellia_guard: manifest poll HTTP %d — backoff %.0fs",
                e.code,
                backoff,
            )
            time.sleep(backoff)
            backoff = min(_BACKOFF_MAX, backoff * 2)
        except Exception as e:  # pragma: no cover — defensive
            log.warning(
                "corellia_guard: manifest poll error (%s) — backoff %.0fs",
                e,
                backoff,
            )
            time.sleep(backoff)
            backoff = min(_BACKOFF_MAX, backoff * 2)


def _poll_once(
    cache: ScopeCache, url: str, token: str, instance_id: str, etag: str
) -> Optional[str]:
    """Single poll. Returns the new ETag (str) on 200 + write,
    the existing ETag on 304, or None on transport error.

    HTTPErrors (401, 403, 4xx, 5xx) are NOT caught here — they propagate
    up to `_poll_loop` so the auth-revocation policy can fire on the
    correct status codes. Transport-level errors (urllib.error.URLError
    other than HTTPError, OSError) propagate to the generic `Exception`
    catch in the loop and preserve last-known-good."""
    body = json.dumps({"instance_id": instance_id}).encode()
    headers = {
        "Authorization": f"Bearer {token}",
        "Content-Type": "application/json",
    }
    if etag:
        # RFC 7232: If-None-Match value must be quoted unless it's the
        # bare `*` wildcard. The control-plane manifest endpoint emits
        # quoted ETags (per Phase 2 ServeHTTP), but defensively re-quote
        # if we ever see a bare-token one to keep intermediaries happy.
        headers["If-None-Match"] = etag if etag.startswith('"') else f'"{etag}"'
    req = urllib.request.Request(url, data=body, headers=headers, method="POST")

    # 304s arrive as HTTPError under urllib's default handler — handle
    # them inline so the caller's success counter still advances.
    try:
        with urllib.request.urlopen(req, timeout=10) as resp:
            status = resp.status
            response_etag = resp.headers.get("ETag", "") or etag
            payload = resp.read()
    except urllib.error.HTTPError as e:
        if e.code == 304:
            return etag
        # Re-raise — _poll_loop's per-status handler picks it up.
        raise

    if status == 304:
        return etag
    if status != 200:
        raise RuntimeError(f"manifest endpoint returned HTTP {status}")

    try:
        manifest = json.loads(payload).get("manifest", {})
    except ValueError as e:
        raise RuntimeError(f"manifest endpoint returned invalid JSON: {e}") from e

    scope_doc = _manifest_to_scope_doc(manifest)
    _write_scope_atomic(cache._path, scope_doc)
    log.info(
        "corellia_guard: scope.json updated (manifest_version=%s, toolsets=%s, etag=%s)",
        scope_doc.get("manifest_version"),
        sorted(scope_doc.get("toolsets", {}).keys()),
        response_etag,
    )
    return response_etag


def _manifest_to_scope_doc(manifest: dict) -> dict:
    """Project the wire ToolManifest into the scope.json shape the hook
    consumes. Only the three governed toolsets carry plugin-enforced shapes;
    everything else is gated at config.yaml level."""
    out_toolsets: dict[str, dict] = {}
    for ts in manifest.get("toolsets") or []:
        if not isinstance(ts, dict):
            continue
        key = ts.get("toolset_key")
        if not isinstance(key, str):
            continue
        scope = ts.get("scope") or {}
        if not isinstance(scope, dict):
            continue
        # Pass through only the shape keys the hook understands.
        projected: dict = {}
        for shape_key in (
            "url_allowlist",
            "command_allowlist",
            "path_allowlist",
            "working_directory",
        ):
            if shape_key in scope:
                projected[shape_key] = scope[shape_key]
        if projected:
            out_toolsets[key] = projected
    return {
        "manifest_version": int(manifest.get("manifest_version") or 0),
        "toolsets": out_toolsets,
    }


def _write_scope_atomic(path: Path, doc: dict) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    tmp = path.with_suffix(path.suffix + ".corellia.tmp")
    tmp.write_text(json.dumps(doc, indent=2, sort_keys=True))
    os.replace(tmp, path)
