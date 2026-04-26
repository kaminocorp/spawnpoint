"""Working-directory pin — default-allow on empty, prefix match otherwise."""

from __future__ import annotations

import pytest

from corellia_guard.scope import ToolsetScope, match_working_dir


@pytest.mark.parametrize(
    "pin,cwd,expected",
    [
        # default-allow on empty pin
        ("", "/anywhere", True),
        ("", "", True),
        # exact equality
        ("/workspace", "/workspace", True),
        # prefix under pin
        ("/workspace", "/workspace/sub/file", True),
        # trailing-slash insensitivity
        ("/workspace/", "/workspace/sub", True),
        ("/workspace", "/workspace/", True),
        # sibling directory not admitted (the prefix-without-slash trap)
        ("/workspace", "/workspace-other", False),
        # outside pin
        ("/workspace", "/etc", False),
    ],
)
def test_working_dir_table(pin, cwd, expected):
    scope = ToolsetScope(working_directory=pin)
    assert match_working_dir(scope, cwd) is expected


def test_working_dir_none_scope_allows():
    """When the terminal toolset isn't in scope at all there is no cwd
    to enforce against — allow. (The toolset gating happens at the
    config.yaml `platform_toolsets` level.)"""
    assert match_working_dir(None, "/anywhere") is True
