"""Pytest config for corellia_guard tests.

The plugin imports `from . import scope` etc. — running pytest from inside
the plugin directory needs the parent directory on sys.path so the
`corellia_guard` package resolves. Adding it here keeps the test invocation
short: `pytest adapters/hermes/plugin/corellia_guard/tests/`.
"""

from __future__ import annotations

import sys
from pathlib import Path

_PLUGIN_PARENT = Path(__file__).resolve().parent.parent.parent
if str(_PLUGIN_PARENT) not in sys.path:
    sys.path.insert(0, str(_PLUGIN_PARENT))
