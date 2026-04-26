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

    Fail-safe: on any error, the previous scope.json on disk is left
    untouched and the cache continues serving last-known-good. Stale
    manifest never relaxes enforcement (Phase 5 acceptance gate)."""
    backoff = _BACKOFF_INITIAL
    etag = ""  # most recent ETag we saw; sent as If-None-Match

    while True:
        try:
            new_etag = _poll_once(cache, url, token, instance_id, etag)
            if new_etag is not None:
                etag = new_etag
            backoff = _BACKOFF_INITIAL
            time.sleep(_ttl_seconds())
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
    the existing ETag on 304, or None on transport error."""
    body = json.dumps({"instance_id": instance_id}).encode()
    headers = {
        "Authorization": f"Bearer {token}",
        "Content-Type": "application/json",
    }
    if etag:
        headers["If-None-Match"] = etag
    req = urllib.request.Request(url, data=body, headers=headers, method="POST")

    try:
        with urllib.request.urlopen(req, timeout=10) as resp:
            status = resp.status
            response_etag = resp.headers.get("ETag", "") or etag
            payload = resp.read()
    except urllib.error.HTTPError as e:
        if e.code == 304:
            return etag
        if e.code == 401:
            log.error(
                "corellia_guard: manifest endpoint returned 401 — token rejected. "
                "Will retry; check CORELLIA_INSTANCE_TOKEN."
            )
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
