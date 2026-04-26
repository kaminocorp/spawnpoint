"""Command allowlist matcher — regex correctness, default-deny, and
graceful handling of an invalid pattern (Phase 4 client-side validation
should reject these, but the matcher must not crash if one slips through)."""

from __future__ import annotations

import pytest

from corellia_guard.scope import ToolsetScope, match_command


@pytest.mark.parametrize(
    "patterns,command,expected",
    [
        # anchored prefixes
        ([r"^ls(\s|$)"], "ls -la", True),
        ([r"^ls(\s|$)"], "rm -rf /", False),
        # multiple patterns
        ([r"^ls(\s|$)", r"^git\s+log"], "git log --oneline", True),
        # unanchored search
        ([r"git\s+log"], "/usr/bin/git log -n 5", True),
        # default-deny
        ([], "ls", False),
    ],
)
def test_command_matcher_table(patterns, command, expected):
    scope = ToolsetScope(command_allowlist=list(patterns))
    assert match_command(scope, command) is expected


def test_command_matcher_none_scope_denies():
    assert match_command(None, "ls") is False


def test_command_matcher_invalid_regex_skipped():
    """An invalid regex — e.g. unbalanced parens — should not crash; the
    pattern is simply skipped. The remaining patterns still apply."""
    scope = ToolsetScope(command_allowlist=["(unbalanced", r"^ls$"])
    assert match_command(scope, "ls") is True
    assert match_command(scope, "rm") is False
