"""URL allowlist matcher — table-driven coverage of the demo case
(`*.acme.com` allowing `wiki.acme.com` and rejecting `evil.com`) plus
default-deny behaviour and scheme normalization."""

from __future__ import annotations

import pytest

from corellia_guard.scope import ToolsetScope, match_url


@pytest.mark.parametrize(
    "patterns,url,expected",
    [
        # demo case from §1.3
        (["*.acme.com"], "https://wiki.acme.com", True),
        (["*.acme.com"], "http://wiki.acme.com/path", True),
        (["*.acme.com"], "https://evil.com", False),
        # multiple patterns
        (["*.acme.com", "wiki.example.org/*"], "https://wiki.example.org/api", True),
        (["*.acme.com", "wiki.example.org/*"], "https://other.example.org", False),
        # exact host
        (["api.example.com"], "https://api.example.com", True),
        (["api.example.com"], "https://other.example.com", False),
        # default-deny on empty
        ([], "https://anything.example.com", False),
        # missing url
        (["*.acme.com"], "", False),
    ],
)
def test_url_matcher_table(patterns, url, expected):
    scope = ToolsetScope(url_allowlist=list(patterns))
    assert match_url(scope, url) is expected


def test_url_matcher_none_scope_denies():
    """A missing toolset means the toolset wasn't equipped — deny."""
    assert match_url(None, "https://wiki.acme.com") is False


def test_url_matcher_non_string_url_denies():
    scope = ToolsetScope(url_allowlist=["*"])
    assert match_url(scope, None) is False  # type: ignore[arg-type]


# Phase 7 hardening (changelog 0.13.9): scheme detection is case-insensitive.
# Previously `Https://...` and `HTTP://...` failed the lower-case
# `startswith("https://")` check and the scheme leaked through into the
# matcher target, causing `*.acme.com` to silently reject mixed-case URLs.
@pytest.mark.parametrize(
    "url,expected",
    [
        ("https://wiki.acme.com", True),
        ("HTTPS://wiki.acme.com", True),
        ("Https://wiki.acme.com", True),
        ("http://wiki.acme.com", True),
        ("HTTP://wiki.acme.com", True),
    ],
)
def test_url_matcher_mixed_case_scheme(url, expected):
    scope = ToolsetScope(url_allowlist=["*.acme.com"])
    assert match_url(scope, url) is expected
