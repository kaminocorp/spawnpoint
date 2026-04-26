"""ScopeCache reloads on mtime advance and falls back to deny-all when
scope.json is missing or unparseable. Validates the Phase 5 fail-safe
behaviour: stale manifest never relaxes enforcement."""

from __future__ import annotations

import json
import os
import time
from pathlib import Path

import pytest

from corellia_guard.hook import ScopeCache
from corellia_guard.scope import match_url


def _write(path: Path, doc: dict) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(json.dumps(doc))
    # Bump mtime by ≥1s — some filesystems have 1s mtime granularity, so
    # touching twice in the same second wouldn't show a delta to the cache.
    new_t = time.time() + 2
    os.utime(path, (new_t, new_t))


def test_initial_load_reads_disk(tmp_path: Path):
    p = tmp_path / "scope.json"
    _write(p, {
        "manifest_version": 7,
        "toolsets": {"web": {"url_allowlist": ["*.acme.com"]}},
    })
    cache = ScopeCache(p)
    assert cache.get().manifest_version == 7
    web = cache.get().for_toolset("web")
    assert match_url(web, "https://wiki.acme.com") is True
    assert match_url(web, "https://evil.com") is False


def test_reload_on_mtime_advance(tmp_path: Path):
    p = tmp_path / "scope.json"
    _write(p, {"toolsets": {"web": {"url_allowlist": ["*.acme.com"]}}})
    cache = ScopeCache(p)
    assert match_url(cache.get().for_toolset("web"), "https://wiki.acme.com") is True

    # Operator revokes — write a new scope.json with an empty list.
    _write(p, {"toolsets": {"web": {"url_allowlist": []}}})
    web = cache.get().for_toolset("web")
    assert match_url(web, "https://wiki.acme.com") is False


def test_missing_file_denies_all(tmp_path: Path):
    p = tmp_path / "scope.json"  # not created
    cache = ScopeCache(p)
    scope = cache.get()
    assert scope.toolsets == {}
    # Any governed call lookup returns None and matchers default-deny.
    assert match_url(scope.for_toolset("web"), "https://wiki.acme.com") is False


def test_unparseable_file_denies_all(tmp_path: Path):
    p = tmp_path / "scope.json"
    p.write_text("{ this is not json")
    cache = ScopeCache(p)
    scope = cache.get()
    assert scope.toolsets == {}
    assert match_url(scope.for_toolset("web"), "https://wiki.acme.com") is False


def test_disappearing_file_denies_all(tmp_path: Path):
    """If scope.json is removed mid-process the cache falls back to
    deny-all on the next read. Stale-allow is the unsafe failure mode
    we explicitly avoid."""
    p = tmp_path / "scope.json"
    _write(p, {"toolsets": {"web": {"url_allowlist": ["*.acme.com"]}}})
    cache = ScopeCache(p)
    assert match_url(cache.get().for_toolset("web"), "https://wiki.acme.com") is True

    p.unlink()
    scope = cache.get()
    assert match_url(scope.for_toolset("web"), "https://wiki.acme.com") is False


# Phase 7 hardening (changelog 0.13.9): mtime that moves backwards
# (NTP correction, file restored from backup) must still trigger a
# reload. Previously `mtime > self._mtime` silently missed this case.
def test_reload_on_mtime_regression(tmp_path: Path):
    p = tmp_path / "scope.json"
    _write(p, {"toolsets": {"web": {"url_allowlist": ["*.acme.com"]}}})
    cache = ScopeCache(p)
    assert match_url(cache.get().for_toolset("web"), "https://wiki.acme.com") is True

    # Write a NEW doc but stamp it with an older mtime than what's cached.
    p.write_text(json.dumps({"toolsets": {"web": {"url_allowlist": []}}}))
    older = time.time() - 60  # 60s in the past
    os.utime(p, (older, older))

    web = cache.get().for_toolset("web")
    assert match_url(web, "https://wiki.acme.com") is False, (
        "regressing mtime should still trigger a reload (`!=` not `>`)"
    )


# Phase 7 hardening: bad-then-good recovery — after a parse error, the
# cache leaves _mtime = None so the *next* stat re-tries the read. Pin
# that the operator's "fix the file" path actually picks up.
def test_unparseable_then_recovers(tmp_path: Path):
    p = tmp_path / "scope.json"
    p.write_text("{ this is not json")
    cache = ScopeCache(p)
    assert cache.get().toolsets == {}

    # Repair the file.
    _write(p, {"toolsets": {"web": {"url_allowlist": ["*.acme.com"]}}})
    web = cache.get().for_toolset("web")
    assert match_url(web, "https://wiki.acme.com") is True


# Phase 7 hardening: explicit deny-all from the daemon (revocation
# signal) bypasses the mtime cache so the next get() returns the empty
# scope without waiting for an on-disk update.
def test_force_deny_all_takes_effect_immediately(tmp_path: Path):
    p = tmp_path / "scope.json"
    _write(p, {"toolsets": {"web": {"url_allowlist": ["*.acme.com"]}}})
    cache = ScopeCache(p)
    assert match_url(cache.get().for_toolset("web"), "https://wiki.acme.com") is True

    cache.force_deny_all()
    assert match_url(cache.get().for_toolset("web"), "https://wiki.acme.com") is False
