"""Manifest poll daemon — `_poll_once` happy path, ETag short-circuit,
401-revocation policy, and the manifest→scope projection.

Tests use `unittest.mock.patch` to replace `urllib.request.urlopen` so
we exercise the loop logic without touching a real socket. The daemon
loop itself runs in a thread and would never exit; we only test the
single-poll function and the ScopeCache.force_deny_all() integration."""

from __future__ import annotations

import importlib
import io
import json
from pathlib import Path
from typing import Optional
from unittest.mock import MagicMock, patch
from urllib.error import HTTPError

import pytest

import corellia_guard
from corellia_guard.hook import ScopeCache


def _make_response(status: int, body: bytes, etag: str = ""):
    """Build a context-manager-shaped fake matching urllib's urlopen
    return shape (the parts our code touches)."""
    cm = MagicMock()
    cm.__enter__ = MagicMock(return_value=cm)
    cm.__exit__ = MagicMock(return_value=False)
    cm.status = status
    cm.headers = {"ETag": etag} if etag else {}
    cm.read = MagicMock(return_value=body)
    return cm


def test_poll_once_200_writes_scope_json(tmp_path: Path):
    p = tmp_path / "scope.json"
    p.parent.mkdir(parents=True, exist_ok=True)
    cache = ScopeCache(p)  # missing file → deny-all initially

    body = json.dumps(
        {
            "manifest": {
                "manifest_version": 5,
                "toolsets": [
                    {
                        "toolset_key": "web",
                        "scope": {"url_allowlist": ["*.acme.com"]},
                    }
                ],
            }
        }
    ).encode()
    fake_resp = _make_response(200, body, etag='"5"')

    with patch("urllib.request.urlopen", return_value=fake_resp):
        new_etag = corellia_guard._poll_once(
            cache, "https://example/v1/tools/manifest", "tok", "i-1", ""
        )

    assert new_etag == '"5"'
    assert p.exists(), "scope.json should be atomically written on 200"
    data = json.loads(p.read_text())
    assert data["manifest_version"] == 5
    assert data["toolsets"]["web"]["url_allowlist"] == ["*.acme.com"]


def test_poll_once_304_keeps_etag(tmp_path: Path):
    p = tmp_path / "scope.json"
    p.parent.mkdir(parents=True, exist_ok=True)
    cache = ScopeCache(p)

    # urllib raises HTTPError for 4xx/5xx including 304 with the default
    # opener — match that contract.
    err = HTTPError(
        "https://example", 304, "Not Modified", {}, io.BytesIO(b"")
    )
    with patch("urllib.request.urlopen", side_effect=err):
        out = corellia_guard._poll_once(
            cache, "https://example/v1/tools/manifest", "tok", "i-1", '"42"'
        )
    assert out == '"42"', "304 should return the existing ETag unchanged"
    assert not p.exists(), "304 must NOT write scope.json"


def test_poll_once_401_propagates(tmp_path: Path):
    """`_poll_once` does NOT catch 401 — the loop's per-status handler does."""
    p = tmp_path / "scope.json"
    cache = ScopeCache(p)
    err = HTTPError(
        "https://example", 401, "Unauthorized", {}, io.BytesIO(b"")
    )
    with patch("urllib.request.urlopen", side_effect=err), pytest.raises(HTTPError):
        corellia_guard._poll_once(
            cache, "https://example/v1/tools/manifest", "tok", "i-1", ""
        )


def test_manifest_to_scope_doc_projection():
    manifest = {
        "manifest_version": 17,
        "toolsets": [
            {
                "toolset_key": "web",
                "scope": {"url_allowlist": ["*.acme.com"]},
            },
            {
                "toolset_key": "terminal",
                "scope": {
                    "command_allowlist": [r"^ls"],
                    "working_directory": "/workspace",
                    "future_field": "ignored",  # forward-compat: silently dropped
                },
            },
            # Non-dict toolsets silently skipped.
            "garbage",
            {"toolset_key": 42},
            {"scope": {"url_allowlist": ["x"]}},  # missing key
            # Toolset with no governable shape — dropped.
            {"toolset_key": "memory", "scope": {"sticky_keys": ["x"]}},
        ],
    }
    out = corellia_guard._manifest_to_scope_doc(manifest)
    assert out["manifest_version"] == 17
    assert set(out["toolsets"].keys()) == {"web", "terminal"}
    assert out["toolsets"]["terminal"] == {
        "command_allowlist": ["^ls"],
        "working_directory": "/workspace",
    }


def test_manifest_to_scope_doc_handles_missing_version():
    """A manifest without `manifest_version` (BE bug or pre-v1.5 client)
    should still produce a valid doc with version=0 rather than crash."""
    out = corellia_guard._manifest_to_scope_doc({"toolsets": []})
    assert out["manifest_version"] == 0
    assert out["toolsets"] == {}


def test_ttl_seconds_clamps_bogus_values(monkeypatch):
    monkeypatch.setenv("CORELLIA_MANIFEST_POLL_TTL", "not-a-number")
    cg = importlib.reload(corellia_guard)
    assert cg._ttl_seconds() == cg._TTL_DEFAULT_SECONDS


def test_ttl_seconds_clamps_too_low(monkeypatch):
    monkeypatch.setenv("CORELLIA_MANIFEST_POLL_TTL", "1")
    cg = importlib.reload(corellia_guard)
    assert cg._ttl_seconds() == cg._TTL_MIN_SECONDS


def test_ttl_seconds_clamps_too_high(monkeypatch):
    monkeypatch.setenv("CORELLIA_MANIFEST_POLL_TTL", "9999")
    cg = importlib.reload(corellia_guard)
    assert cg._ttl_seconds() == cg._TTL_MAX_SECONDS
