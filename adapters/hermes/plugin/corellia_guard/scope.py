"""
Scope dataclass + matchers for the corellia_guard plugin.

Phase 5 (v1.5 Pillar B): the three non-native scopes that Hermes's config
cannot natively express, plus the working-directory pin reserved for the
terminal toolset:

    url_allowlist        — fnmatch globs.   Empty = deny (default-deny).
    command_allowlist    — Python regexes.  Empty = deny (default-deny).
    path_allowlist       — fnmatch globs.   Empty = deny (default-deny).
    working_directory    — single path.     Empty = allow (default-allow).

Default-deny on the three list shapes is the Phase 1 catalog decision
(`docs/executing/tools-governance.md` §3 Phase 1 open-question resolution
and §5 decision 1). Default-allow on `working_directory` matches the same
decision.

This module is pure logic — no I/O, no Hermes imports. Tests live alongside
in `tests/`.
"""

from __future__ import annotations

import fnmatch
import re
from dataclasses import dataclass, field


@dataclass
class ToolsetScope:
    """One equipped toolset's plugin-enforced scope. Mirrors the JSON shape
    that the control plane stores in `agent_instance_tool_grants.scope_json`
    for the three governed toolsets (`web`, `terminal`, `file`)."""

    url_allowlist: list[str] = field(default_factory=list)
    command_allowlist: list[str] = field(default_factory=list)
    path_allowlist: list[str] = field(default_factory=list)
    working_directory: str = ""

    @classmethod
    def from_dict(cls, raw: dict | None) -> "ToolsetScope":
        if not isinstance(raw, dict):
            return cls()
        return cls(
            url_allowlist=_string_list(raw.get("url_allowlist")),
            command_allowlist=_string_list(raw.get("command_allowlist")),
            path_allowlist=_string_list(raw.get("path_allowlist")),
            working_directory=str(raw.get("working_directory", "") or ""),
        )


@dataclass
class Scope:
    """Per-instance scope state, keyed by toolset_key. Anything not present
    here is either (a) not equipped (gated by Hermes's `platform_toolsets`
    config) or (b) a toolset without a plugin-tier scope shape (in which
    case the plugin has nothing to enforce — `code_execution`, `vision`,
    `memory`, etc. all fall in this bucket)."""

    manifest_version: int = 0
    toolsets: dict[str, ToolsetScope] = field(default_factory=dict)

    @classmethod
    def from_dict(cls, raw: dict | None) -> "Scope":
        if not isinstance(raw, dict):
            return cls()
        toolsets_raw = raw.get("toolsets") or {}
        toolsets: dict[str, ToolsetScope] = {}
        if isinstance(toolsets_raw, dict):
            for key, val in toolsets_raw.items():
                if isinstance(key, str):
                    toolsets[key] = ToolsetScope.from_dict(val)
        version = raw.get("manifest_version", 0)
        try:
            version_int = int(version)
        except (TypeError, ValueError):
            version_int = 0
        return cls(manifest_version=version_int, toolsets=toolsets)

    @classmethod
    def deny_all(cls) -> "Scope":
        """Fail-safe scope: no toolsets, no patterns. Every governed call
        rejects. Used when scope.json is missing/unparseable at startup
        (Phase 5 §5 decision 10)."""
        return cls()

    def for_toolset(self, key: str) -> ToolsetScope | None:
        return self.toolsets.get(key)


# ── Matchers ─────────────────────────────────────────────────────────────────


def match_url(scope: ToolsetScope | None, url: str) -> bool:
    """True iff `url` matches any glob in scope.url_allowlist.

    Pattern semantics: a pattern without `/` is a host-only pattern and
    admits any path under that host (so `*.acme.com` matches both
    `wiki.acme.com` and `wiki.acme.com/foo/bar`). A pattern containing
    `/` is matched against the full host+path target — operator wrote
    `wiki.example.org/*`, they get a path-aware match.

    Default-deny: empty list rejects every URL. A missing toolset (None)
    rejects too — the scope was either not granted or the manifest lost it."""
    if scope is None:
        return False
    if not isinstance(url, str) or not url:
        return False
    if not scope.url_allowlist:
        return False
    full = _normalize_url_for_match(url)
    host_only = full.split("/", 1)[0]
    for pattern in scope.url_allowlist:
        target = host_only if "/" not in pattern else full
        if fnmatch.fnmatchcase(target, pattern):
            return True
    return False


def match_command(scope: ToolsetScope | None, command: str) -> bool:
    """True iff `command` matches any regex in scope.command_allowlist.

    `re.search` (not `re.match`) — patterns are anchored by the operator
    when they want anchoring (`^ls(\\s|$)`)."""
    if scope is None:
        return False
    if not isinstance(command, str):
        return False
    if not scope.command_allowlist:
        return False
    for pattern in scope.command_allowlist:
        try:
            if re.search(pattern, command):
                return True
        except re.error:
            # Invalid regex slips through Phase-4 client-side validation
            # and Phase-1 server-side `regexp.MustCompile` — treat as
            # non-matching rather than crashing the hook.
            continue
    return False


def match_path(scope: ToolsetScope | None, path: str) -> bool:
    """True iff `path` matches any glob in scope.path_allowlist.

    fnmatch is used over pathlib.PurePath.match because it understands `**`
    and is consistent with url_allowlist's matcher."""
    if scope is None:
        return False
    if not isinstance(path, str) or not path:
        return False
    if not scope.path_allowlist:
        return False
    for pattern in scope.path_allowlist:
        if fnmatch.fnmatchcase(path, pattern):
            return True
    return False


def match_working_dir(scope: ToolsetScope | None, requested_cwd: str) -> bool:
    """True iff `requested_cwd` is under (or equal to) scope.working_directory.

    Default-allow: empty pin admits any cwd. Matching is prefix-based on
    normalized paths so `/workspace` admits `/workspace/sub/file.txt` but
    NOT `/workspace-other`."""
    if scope is None:
        # Working-dir is paired with the terminal toolset; if terminal isn't
        # in scope there is no cwd to enforce against — allow.
        return True
    pin = scope.working_directory.strip()
    if not pin:
        return True
    if not isinstance(requested_cwd, str) or not requested_cwd:
        return False
    pin_norm = pin.rstrip("/")
    cwd_norm = requested_cwd.rstrip("/")
    if cwd_norm == pin_norm:
        return True
    return cwd_norm.startswith(pin_norm + "/")


# ── helpers ──────────────────────────────────────────────────────────────────


def _string_list(raw) -> list[str]:
    if not isinstance(raw, list):
        return []
    return [s for s in raw if isinstance(s, str) and s]


def _normalize_url_for_match(url: str) -> str:
    """Strip scheme so an allowlist of `*.acme.com` matches both
    `https://wiki.acme.com` and `http://wiki.acme.com/path`. The allowlist
    is host-/path-shaped, not scheme-shaped — schemes are governed at the
    toolset level (e.g., `web` provider only emits HTTP(S))."""
    for prefix in ("https://", "http://"):
        if url.startswith(prefix):
            return url[len(prefix):]
    return url
