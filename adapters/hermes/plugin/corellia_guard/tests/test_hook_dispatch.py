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


def test_web_search_allowed(tmp_path: Path):
    hook = _make_hook(
        tmp_path,
        {"toolsets": {"web": {"url_allowlist": ["*.acme.com"]}}},
    )
    result = hook(
        tool_name="web_search",
        args={"url": "https://wiki.acme.com"},
    )
    assert result is None


def test_web_search_blocked(tmp_path: Path):
    hook = _make_hook(
        tmp_path,
        {"toolsets": {"web": {"url_allowlist": ["*.acme.com"]}}},
    )
    result = hook(
        tool_name="web_search",
        args={"url": "https://evil.com"},
    )
    assert isinstance(result, dict)
    assert result["action"] == "block"
    assert "evil.com" in result["message"]


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
        tool_name="web_search",
        args={"url": "https://anything.example"},
        task_id="t-1",
        session_id="s-1",
        tool_call_id="tc-1",
        future_kwarg="ignored",
    )
    assert result is None
