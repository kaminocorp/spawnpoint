"""register() single-flight + hook re-attach tests.

Pins the Phase 5 risk-register row "plugin daemon-thread leaks":
Hermes calls `register(ctx)` for every fresh `AIAgent` (including
sub-agent spawns from delegation). Without a guard, the manifest poll
daemon spawns N times. The module-level `_STARTED` sentinel + Lock in
`__init__.py` is the mitigation.

These tests verify:
  1. `register()` called twice in a row spawns the daemon exactly once.
  2. Both ctx objects receive a `pre_tool_call` hook (hooks live on the
     ctx, not the process — re-attach is necessary even though the
     daemon is shared).
  3. With `CORELLIA_TOOL_MANIFEST_URL` / `CORELLIA_INSTANCE_TOKEN`
     unset, the daemon path is skipped entirely (local-dev quiet
     mode).
"""

from __future__ import annotations

import importlib
import threading


class _FakeCtx:
    def __init__(self) -> None:
        self.hooks: list[tuple[str, object]] = []

    def add_hook(self, name: str, fn: object) -> None:
        self.hooks.append((name, fn))


def _reset_module():
    """Re-import the package so module-level `_STARTED` etc. reset between
    tests. Cleaner than poking private globals from the test harness."""
    import corellia_guard

    importlib.reload(corellia_guard)
    return corellia_guard


def test_register_double_call_spawns_one_daemon(monkeypatch, tmp_path):
    monkeypatch.setenv("HERMES_HOME", str(tmp_path))
    # Skip the actual urllib request in the daemon — we just want the
    # spawn-count to be observable. The real daemon would loop forever;
    # we replace it with a counter.
    spawn_calls: list[object] = []

    cg = _reset_module()
    monkeypatch.setattr(
        cg,
        "_start_poll_daemon",
        lambda cache: spawn_calls.append(cache),
    )

    ctx1 = _FakeCtx()
    ctx2 = _FakeCtx()
    cg.register(ctx1)
    cg.register(ctx2)

    assert len(spawn_calls) == 1, (
        f"expected one daemon spawn, got {len(spawn_calls)}"
    )
    assert len(ctx1.hooks) == 1 and ctx1.hooks[0][0] == "pre_tool_call"
    assert len(ctx2.hooks) == 1 and ctx2.hooks[0][0] == "pre_tool_call"
    # Both ctxs receive the SAME hook callable (closure over the shared
    # ScopeCache). This is intentional — sub-agents share the cache.
    assert ctx1.hooks[0][1] is ctx2.hooks[0][1]


def test_register_concurrent_calls_spawn_one_daemon(monkeypatch, tmp_path):
    """Module-level `_STARTED` flip is guarded by `_REGISTER_LOCK`. Verify
    that two threads racing through `register()` produce one daemon spawn."""
    monkeypatch.setenv("HERMES_HOME", str(tmp_path))
    spawn_calls: list[object] = []
    lock = threading.Lock()

    cg = _reset_module()

    def fake_start(cache):
        with lock:
            spawn_calls.append(cache)

    monkeypatch.setattr(cg, "_start_poll_daemon", fake_start)

    ctxs = [_FakeCtx() for _ in range(8)]
    threads = [threading.Thread(target=cg.register, args=(c,)) for c in ctxs]
    for t in threads:
        t.start()
    for t in threads:
        t.join()

    assert len(spawn_calls) == 1, (
        f"concurrent register() should spawn exactly one daemon, got {len(spawn_calls)}"
    )
    for c in ctxs:
        assert len(c.hooks) == 1


def test_register_skips_daemon_when_env_missing(monkeypatch, tmp_path, caplog):
    """Local dev: with the two pillar-B env vars unset, the daemon is
    not spawned — register() still attaches the hook so any pre-existing
    scope.json on disk is enforced, but no manifest polling happens."""
    monkeypatch.setenv("HERMES_HOME", str(tmp_path))
    monkeypatch.delenv("CORELLIA_TOOL_MANIFEST_URL", raising=False)
    monkeypatch.delenv("CORELLIA_INSTANCE_TOKEN", raising=False)

    cg = _reset_module()
    # Use the REAL _start_poll_daemon so we exercise the env-skip branch.
    started_threads: list[threading.Thread] = []
    real_thread_init = threading.Thread.__init__

    def thread_init(self, *args, **kwargs):  # type: ignore[no-untyped-def]
        started_threads.append(self)
        return real_thread_init(self, *args, **kwargs)

    monkeypatch.setattr(threading.Thread, "__init__", thread_init)

    caplog.set_level("WARNING", logger="corellia_guard")
    ctx = _FakeCtx()
    cg.register(ctx)

    # No corellia_guard.poll thread should have been constructed.
    assert not any(
        getattr(t, "name", "") == "corellia_guard.poll" for t in started_threads
    ), "daemon thread should not spawn when env vars are unset"
    # Hook still attached.
    assert len(ctx.hooks) == 1
    # Operator-facing warning surfaced.
    assert any(
        "skipping poll daemon" in record.message for record in caplog.records
    )
