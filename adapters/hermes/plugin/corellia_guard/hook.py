"""
pre_tool_call hook body. Routes by `tool_name` to the appropriate scope
matcher and returns Hermes's structured-block shape on rejection.

Hermes calls every registered `pre_tool_call` hook with kwargs (verified
against `hermes_cli/plugins.py:742–747` at the pinned digest
`sha256:d4ee57f254aabbe10e41c49533bbf3eb98e6b026463c42843a07588e45ddd338`):

    tool_name: str
    args: dict
    task_id: str
    session_id: str
    tool_call_id: str

Reject return shape (per `get_pre_tool_call_block_message`,
`hermes_cli/plugins.py:766–785`):

    {"action": "block", "message": "<structured reason>"}

Returning `None` lets the call proceed.

The hook reads the latest `scope.json` from disk via mtime caching: stat
once per call, re-parse only when mtime changes. This keeps the hot path
to a single `os.stat` for unchanged scope state.
"""

from __future__ import annotations

import json
import logging
import os
from pathlib import Path
from threading import Lock
from typing import Optional

from . import scope as scope_mod

log = logging.getLogger("corellia_guard.hook")


# ── Tool-name → toolset routing ──────────────────────────────────────────────
#
# The plugin enforces only the three non-native scopes (URL allowlist on
# `web`, command allowlist on `terminal`, path allowlist on `file`). Every
# other Hermes tool name is allowed by the plugin — the operator's gating
# happens at the `platform_toolsets.cli` config level.
#
# Known Hermes tool-name patterns (from `hermes_cli/tools/*` at the pinned
# digest); maintained as a curated map rather than a prefix match so a
# rename upstream cannot silently bypass enforcement (we'd see an unknown
# tool name and allow, but at least the deny on the renamed-old name keeps
# working until upstream catches up).

_WEB_TOOLS = frozenset({"web_search", "web_fetch", "browser_navigate"})
_TERMINAL_TOOLS = frozenset(
    {"shell_exec", "terminal_exec", "execute_command", "run_command"}
)
_FILE_TOOLS = frozenset(
    {
        "read_file",
        "write_file",
        "edit_file",
        "delete_file",
        "list_files",
        "list_directory",
        "search_files",
    }
)


# ── Scope cache ──────────────────────────────────────────────────────────────


class ScopeCache:
    """mtime-aware reader for scope.json. Reads once at init; re-parses only
    when the file's mtime advances. Thread-safe — the polling daemon thread
    rewrites the file under the same lock so partial reads are impossible
    (the rewrite is `os.replace`-atomic anyway, but the lock keeps the
    parsed-Scope object consistent across reader threads)."""

    def __init__(self, path: Path):
        self._path = path
        self._lock = Lock()
        self._mtime: Optional[float] = None
        self._scope: scope_mod.Scope = scope_mod.Scope.deny_all()
        # Initial load — fail-safe if missing.
        self._reload_locked()

    def get(self) -> scope_mod.Scope:
        try:
            mtime = self._path.stat().st_mtime
        except FileNotFoundError:
            with self._lock:
                if self._mtime is not None:
                    log.warning(
                        "corellia_guard: scope.json disappeared at %s — denying all",
                        self._path,
                    )
                    self._mtime = None
                    self._scope = scope_mod.Scope.deny_all()
                return self._scope

        with self._lock:
            if self._mtime is None or mtime > self._mtime:
                self._reload_locked()
            return self._scope

    def _reload_locked(self) -> None:
        try:
            data = self._path.read_text()
            raw = json.loads(data)
            self._scope = scope_mod.Scope.from_dict(raw)
            self._mtime = self._path.stat().st_mtime
            log.info(
                "corellia_guard: scope.json loaded (manifest_version=%d, toolsets=%s)",
                self._scope.manifest_version,
                sorted(self._scope.toolsets.keys()),
            )
        except FileNotFoundError:
            self._scope = scope_mod.Scope.deny_all()
            self._mtime = None
            log.warning(
                "corellia_guard: scope.json absent at %s — denying all",
                self._path,
            )
        except (OSError, ValueError) as e:
            # Unparseable / unreadable. Fail-safe per Phase 5 §5 decision 10:
            # deny all and keep retrying on next stat. Do NOT update mtime so
            # a corrected file is picked up immediately.
            self._scope = scope_mod.Scope.deny_all()
            self._mtime = None
            log.error(
                "corellia_guard: scope.json unreadable (%s) — denying all", e
            )


# ── Hook builder ─────────────────────────────────────────────────────────────


def make_pre_tool_call(cache: ScopeCache):
    """Returns a hook callable bound to the given ScopeCache. Hermes invokes
    the returned callable with kwargs per `plugins.py:742–747`."""

    def _on_pre_tool_call(
        *,
        tool_name: str = "",
        args: Optional[dict] = None,
        task_id: str = "",
        session_id: str = "",
        tool_call_id: str = "",
        **_unused,
    ):
        scope = cache.get()
        args = args or {}

        if tool_name in _WEB_TOOLS:
            return _enforce_web(scope, tool_name, args)
        if tool_name in _TERMINAL_TOOLS:
            return _enforce_terminal(scope, tool_name, args)
        if tool_name in _FILE_TOOLS:
            return _enforce_file(scope, tool_name, args)
        # Unknown tool name — plugin has nothing to enforce. The toolset is
        # gated at config.yaml level if it shouldn't be running at all.
        return None

    return _on_pre_tool_call


# ── Per-toolset enforcement ──────────────────────────────────────────────────


def _enforce_web(scope: scope_mod.Scope, tool_name: str, args: dict):
    web = scope.for_toolset("web")
    url = _coerce_str(args.get("url") or args.get("query") or args.get("href"))
    if scope_mod.match_url(web, url):
        return None
    return _block(
        f"corellia_guard: tool {tool_name!r} blocked — URL {url!r} not in allowlist."
    )


def _enforce_terminal(scope: scope_mod.Scope, tool_name: str, args: dict):
    term = scope.for_toolset("terminal")
    command = _coerce_command(args)
    if not scope_mod.match_command(term, command):
        return _block(
            f"corellia_guard: tool {tool_name!r} blocked — command {command!r} not in allowlist."
        )
    cwd = _coerce_str(args.get("cwd") or args.get("working_directory") or "")
    if cwd and not scope_mod.match_working_dir(term, cwd):
        return _block(
            f"corellia_guard: tool {tool_name!r} blocked — cwd {cwd!r} outside working_directory pin."
        )
    return None


def _enforce_file(scope: scope_mod.Scope, tool_name: str, args: dict):
    f = scope.for_toolset("file")
    path = _coerce_str(args.get("path") or args.get("file_path") or args.get("filename"))
    if scope_mod.match_path(f, path):
        return None
    return _block(
        f"corellia_guard: tool {tool_name!r} blocked — path {path!r} not in allowlist."
    )


# ── helpers ──────────────────────────────────────────────────────────────────


def _coerce_str(v) -> str:
    if isinstance(v, str):
        return v
    return ""


def _coerce_command(args: dict) -> str:
    cmd = args.get("command")
    if isinstance(cmd, str):
        return cmd
    if isinstance(cmd, list):
        return " ".join(str(x) for x in cmd)
    argv = args.get("argv")
    if isinstance(argv, list):
        return " ".join(str(x) for x in argv)
    return ""


def _block(message: str) -> dict:
    return {"action": "block", "message": message}
