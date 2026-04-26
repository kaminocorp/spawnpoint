"""Path allowlist matcher — fnmatch globs with `**` recursion."""

from __future__ import annotations

import pytest

from corellia_guard.scope import ToolsetScope, match_path


@pytest.mark.parametrize(
    "patterns,path,expected",
    [
        (["/workspace/**"], "/workspace/foo/bar.txt", True),
        (["/workspace/**"], "/etc/passwd", False),
        (["/etc/hosts"], "/etc/hosts", True),
        (["/etc/hosts"], "/etc/hostname", False),
        # multiple patterns
        (["/workspace/**", "/tmp/*"], "/tmp/scratch", True),
        (["/workspace/**", "/tmp/*"], "/var/log/syslog", False),
        # default-deny
        ([], "/anywhere", False),
    ],
)
def test_path_matcher_table(patterns, path, expected):
    scope = ToolsetScope(path_allowlist=list(patterns))
    assert match_path(scope, path) is expected


def test_path_matcher_none_scope_denies():
    assert match_path(None, "/workspace/x") is False
