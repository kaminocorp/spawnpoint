"""Hook dispatch — verifies tool_name routes to the right matcher and the
reject return shape matches Hermes's `get_pre_tool_call_block_message`
(`{"action": "block", "message": "..."}`)."""

from __future__ import annotations

import json
from pathlib import Path

import pytest

from corellia_guard.hook import ScopeCache, make_pre_tool_call


def _make_hook(tmp_path: Path, doc: dict):
    p = tmp_path / "scope.json"
    p.write_text(json.dumps(doc))
    cache = ScopeCache(p)
    return make_pre_tool_call(cache)


def test_web_fetch_allowed(tmp_path: Path):
    hook = _make_hook(
        tmp_path,
        {"toolsets": {"web": {"url_allowlist": ["*.acme.com"]}}},
    )
    result = hook(
        tool_name="web_fetch",
        args={"url": "https://wiki.acme.com"},
    )
    assert result is None


def test_web_fetch_blocked(tmp_path: Path):
    hook = _make_hook(
        tmp_path,
        {"toolsets": {"web": {"url_allowlist": ["*.acme.com"]}}},
    )
    result = hook(
        tool_name="web_fetch",
        args={"url": "https://evil.com"},
    )
    assert isinstance(result, dict)
    assert result["action"] == "block"
    assert "evil.com" in result["message"]


# Phase 7 hardening (changelog 0.13.9): `web_search` no longer routes
# through the URL matcher — its `query` arg is a search string, not a
# user-controlled URL. The toolset gate (platform_toolsets.cli) is the
# safety net for whether `web_search` runs at all.
def test_web_search_passes_through_plugin(tmp_path: Path):
    hook = _make_hook(
        tmp_path,
        {"toolsets": {"web": {"url_allowlist": ["*.acme.com"]}}},
    )
    result = hook(
        tool_name="web_search",
        args={"query": "weather today"},
    )
    assert result is None


# Phase 7 hardening: `browser_navigate` routes through the `browser`
# toolset's url_allowlist, NOT `web`'s. Operators set them separately
# in the catalog.
def test_browser_navigate_uses_browser_scope(tmp_path: Path):
    hook = _make_hook(
        tmp_path,
        {
            "toolsets": {
                "web": {"url_allowlist": ["*.acme.com"]},
                "browser": {"url_allowlist": ["*.example.org"]},
            }
        },
    )
    # In `browser` allowlist — allowed.
    assert (
        hook(
            tool_name="browser_navigate",
            args={"url": "https://wiki.example.org"},
        )
        is None
    )
    # In `web` allowlist but NOT `browser` — blocked (correctly enforces
    # the browser scope, not web's).
    res = hook(
        tool_name="browser_navigate",
        args={"url": "https://wiki.acme.com"},
    )
    assert res is not None and res["action"] == "block"
    assert "browser" in res["message"]


# Phase 7 defense-in-depth: shell-shaped tool names that miss the explicit
# _TERMINAL_TOOLS frozenset (e.g. an upstream rename `shell_exec` →
# `bash_exec`) still get routed through the terminal command allowlist.
def test_shell_shaped_unknown_name_routes_to_terminal(tmp_path: Path):
    hook = _make_hook(
        tmp_path,
        {"toolsets": {"terminal": {"command_allowlist": [r"^ls(\s|$)"]}}},
    )
    # `bash_exec` not in _TERMINAL_TOOLS but matches _SHELL_SHAPED_RE.
    blocked = hook(tool_name="bash_exec", args={"command": "rm -rf /"})
    assert blocked is not None and blocked["action"] == "block"
    allowed = hook(tool_name="bash_exec", args={"command": "ls -la"})
    assert allowed is None


def test_terminal_command_blocked(tmp_path: Path):
    hook = _make_hook(
        tmp_path,
        {"toolsets": {"terminal": {"command_allowlist": [r"^ls(\s|$)"]}}},
    )
    result = hook(
        tool_name="shell_exec",
        args={"command": "rm -rf /"},
    )
    assert result is not None and result["action"] == "block"


def test_terminal_command_allowed(tmp_path: Path):
    hook = _make_hook(
        tmp_path,
        {"toolsets": {"terminal": {"command_allowlist": [r"^ls(\s|$)"]}}},
    )
    result = hook(
        tool_name="shell_exec",
        args={"command": "ls -la"},
    )
    assert result is None


def test_terminal_cwd_outside_pin_blocks(tmp_path: Path):
    hook = _make_hook(
        tmp_path,
        {
            "toolsets": {
                "terminal": {
                    "command_allowlist": [r"^ls"],
                    "working_directory": "/workspace",
                }
            }
        },
    )
    result = hook(
        tool_name="shell_exec",
        args={"command": "ls", "cwd": "/etc"},
    )
    assert result is not None and result["action"] == "block"
    assert "cwd" in result["message"]


def test_file_tool_blocked(tmp_path: Path):
    hook = _make_hook(
        tmp_path,
        {"toolsets": {"file": {"path_allowlist": ["/workspace/**"]}}},
    )
    result = hook(
        tool_name="read_file",
        args={"path": "/etc/passwd"},
    )
    assert result is not None and result["action"] == "block"


def test_file_tool_allowed(tmp_path: Path):
    hook = _make_hook(
        tmp_path,
        {"toolsets": {"file": {"path_allowlist": ["/workspace/**"]}}},
    )
    result = hook(
        tool_name="read_file",
        args={"path": "/workspace/foo.txt"},
    )
    assert result is None


def test_unknown_tool_name_passes_through(tmp_path: Path):
    """Tools the plugin doesn't recognise are allowed — the toolset
    they belong to is gated at the `platform_toolsets.cli` config.yaml
    level, not by this plugin."""
    hook = _make_hook(tmp_path, {"toolsets": {}})
    result = hook(
        tool_name="vision_analyze_image",
        args={"image_url": "https://example.com/x.png"},
    )
    assert result is None


def test_extra_kwargs_dont_break_hook(tmp_path: Path):
    """Hermes invokes hooks with kwargs; future kwargs must not break
    the hook (the **_ catch-all is the contract)."""
    hook = _make_hook(
        tmp_path,
        {"toolsets": {"web": {"url_allowlist": ["*"]}}},
    )
    result = hook(
        tool_name="web_fetch",
        args={"url": "https://anything.example"},
        task_id="t-1",
        session_id="s-1",
        tool_call_id="tc-1",
        future_kwarg="ignored",
    )
    assert result is None


# Phase 7 hardening: rejection messages must not leak query-string
# credentials (`?token=…`, `?api_key=…`). The hook's `_redact_url`
# strips the query before echoing.
def test_rejection_redacts_url_query_string(tmp_path: Path):
    hook = _make_hook(
        tmp_path,
        {"toolsets": {"web": {"url_allowlist": ["*.acme.com"]}}},
    )
    result = hook(
        tool_name="web_fetch",
        args={"url": "https://evil.com/path?token=secret-abcd1234"},
    )
    assert result is not None
    msg = result["message"]
    assert "secret-abcd1234" not in msg
    assert "<redacted>" in msg


def test_rejection_truncates_long_command(tmp_path: Path):
    """Long commands are truncated in the rejection message so a curl with
    embedded credentials doesn't push the full token into the LLM context."""
    hook = _make_hook(
        tmp_path,
        {"toolsets": {"terminal": {"command_allowlist": [r"^ls"]}}},
    )
    cmd = "curl https://x.example.com?token=" + ("A" * 500)
    result = hook(tool_name="shell_exec", args={"command": cmd})
    assert result is not None
    # The rejection message echoes the command; the unredacted command was
    # ~520 chars, the redacted version should be shorter and end with the
    # truncation marker.
    msg = result["message"]
    assert "<truncated>" in msg
    # The very long token tail must NOT survive in full.
    assert ("A" * 500) not in msg
