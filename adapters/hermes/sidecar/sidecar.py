"""corellia/hermes-adapter — chat sidecar (Phase 1).

A small FastAPI app that runs alongside `hermes` inside the same
Firecracker microVM and exposes a Corellia-shaped HTTP runtime contract
(per blueprint.md §3.1):

  POST /chat           {session_id, message} -> {content}    (auth)
  GET  /health         -> {ok, hermes}                       (no auth)
  POST /tools/invoke   501 NotImplemented                    (auth)

Why this exists: changelog 0.9.5 documented that the upstream Hermes
v0.11.0 image already ships an importable `AIAgent` Python class plus
FastAPI + uvicorn (via the upstream Dockerfile's `[all]` extra). The
gap is a Corellia-shaped `/chat` + `/health` bound to the Fly machine's
external port. Plan: docs/executing/hermes-chat-sidecar.md, Phase 1.

Phase 1 scope: source files only. No Dockerfile change, no entrypoint
change, no Go, no TS, no Fly deploy. The sidecar runs locally via
smoke.sh (`docker run` against the unmodified upstream image with this
directory bind-mounted in). Phase 2 bakes the source into the adapter
image; Phase 3 onward wires the Fly + Corellia BE/FE plumbing.
"""

from __future__ import annotations

import logging
import os
import secrets
import threading
from collections import OrderedDict
from contextlib import asynccontextmanager
from typing import Optional

from fastapi import FastAPI, HTTPException, Request
from fastapi.responses import JSONResponse
from pydantic import BaseModel, Field

# --- Upstream AIAgent import (decision 2: in-process, no subprocess) ---
#
# Inside the deployed adapter image, `run_agent.py` is on PYTHONPATH and
# exposes `AIAgent`. During local development on a workstation without
# the upstream package, the import fails and we fall back to a stub so
# the FastAPI shape itself stays testable. The smoke.sh script runs the
# sidecar inside the real upstream image, so its run path uses the real
# AIAgent.
try:
    from run_agent import AIAgent as _UpstreamAIAgent  # type: ignore[import-not-found]

    AIAGENT_AVAILABLE = True
except Exception:  # noqa: BLE001 — any import-time failure routes us to the stub
    AIAGENT_AVAILABLE = False

    class _UpstreamAIAgent:  # type: ignore[no-redef]
        """Stub AIAgent used when the upstream package isn't importable.

        Returns a deterministic reply so the smoke can assert non-empty
        content without round-tripping a real model. Phase 2 onward this
        path is dead code inside the deployed image.
        """

        def __init__(self, *_: object, **__: object) -> None:
            pass

        def chat(self, prompt: str) -> str:
            return f"[stub-aiagent] echo: {prompt}"


# --- Logger ---------------------------------------------------------------

logger = logging.getLogger("corellia.hermes.sidecar")
if not logger.handlers:
    handler = logging.StreamHandler()
    handler.setFormatter(logging.Formatter("%(asctime)s %(levelname)s %(name)s %(message)s"))
    logger.addHandler(handler)
logger.setLevel(os.environ.get("CORELLIA_SIDECAR_LOG_LEVEL", "INFO"))


# --- Configuration --------------------------------------------------------

# Per-instance bearer token (decision 5). Generated at spawn time by the
# Corellia BE in Phase 3 and injected as a Fly app secret. Empty here is
# treated as misconfigured and refuses all authenticated routes.
AUTH_TOKEN: str = os.environ.get("CORELLIA_SIDECAR_AUTH_TOKEN", "")

# Per-machine LRU cap on cached AIAgent instances (risk 5). Hermes's
# durable session state lives in $HERMES_HOME/sessions/<id>.sqlite, so
# evicting an in-memory entry just costs the next request a re-load
# from disk — never data loss.
MAX_SESSIONS: int = int(os.environ.get("CORELLIA_SIDECAR_MAX_SESSIONS", "100"))

# Production safety gate (0.11.9): when the upstream AIAgent isn't
# importable, the stub returns "[stub-aiagent] echo: ..." — useful for
# workstation dev + smoke, never acceptable in a deployed agent. Set
# CORELLIA_SIDECAR_ALLOW_STUB=true to permit the stub path; any other
# value (including unset) refuses to boot when AIAGENT_AVAILABLE is
# False. The Phase 1 sidecar smoke (sidecar/smoke.sh) sets this flag;
# the entrypoint-driven prod boot does not.
ALLOW_STUB: bool = os.environ.get("CORELLIA_SIDECAR_ALLOW_STUB", "").lower() == "true"
if not AIAGENT_AVAILABLE and not ALLOW_STUB:
    raise SystemExit(
        "corellia/hermes-adapter sidecar: refusing to boot — upstream AIAgent "
        "not importable and CORELLIA_SIDECAR_ALLOW_STUB is not 'true'. This "
        "almost always means the deployed image is missing run_agent on "
        "PYTHONPATH; verify the upstream digest pin in adapters/hermes/Dockerfile."
    )


# --- Session cache --------------------------------------------------------

# OrderedDict gives O(1) move-to-end on hit and O(1) popitem(last=False)
# on eviction. Wrapped in a threading.Lock because uvicorn's default
# worker model can run sync endpoints in a thread pool — even though our
# endpoints are async today, the cache is the kind of structure that
# silently breaks under future shape changes if it isn't lock-guarded
# from day one.
_sessions: "OrderedDict[str, _UpstreamAIAgent]" = OrderedDict()
_sessions_lock = threading.Lock()


def _get_or_create_agent(session_id: str) -> _UpstreamAIAgent:
    """Return a cached AIAgent for the session, evicting the oldest on overflow."""

    with _sessions_lock:
        existing = _sessions.get(session_id)
        if existing is not None:
            _sessions.move_to_end(session_id)
            return existing

        # AIAgent's exact constructor signature is upstream-internal and
        # subject to change. Try the named-arg form first (matches the
        # `gateway/session.py` upstream pattern), fall back to no-args
        # (which lets Hermes auto-detect provider from env vars set by
        # entrypoint.sh's CORELLIA_* translation).
        try:
            agent = _UpstreamAIAgent(session_id=session_id)  # type: ignore[call-arg]
        except TypeError:
            agent = _UpstreamAIAgent()

        _sessions[session_id] = agent
        while len(_sessions) > MAX_SESSIONS:
            evicted_id, _ = _sessions.popitem(last=False)
            logger.info("evicted session_id=%s (LRU cap=%d)", evicted_id, MAX_SESSIONS)
        return agent


# --- FastAPI app ----------------------------------------------------------


@asynccontextmanager
async def lifespan(app: FastAPI):
    logger.info(
        "sidecar starting aiagent_available=%s max_sessions=%d auth_token_set=%s",
        AIAGENT_AVAILABLE,
        MAX_SESSIONS,
        bool(AUTH_TOKEN),
    )
    yield
    logger.info("sidecar stopping")


app = FastAPI(title="corellia/hermes-adapter sidecar", lifespan=lifespan)


# --- Schemas --------------------------------------------------------------


class ChatRequest(BaseModel):
    # session_id is restricted to URL-safe characters because it eventually
    # lands on disk as $HERMES_HOME/sessions/<id>.sqlite — refusing path
    # traversal / control chars at the schema boundary is cheaper than
    # trusting the upstream's filename hygiene. message is capped to 64KB
    # so a runaway POST doesn't get fully buffered before pydantic rejects.
    session_id: str = Field(..., min_length=1, max_length=128, pattern=r"^[A-Za-z0-9_-]+$")
    message: str = Field(..., min_length=1, max_length=65536)


class ChatResponse(BaseModel):
    content: str


class HealthResponse(BaseModel):
    ok: bool
    hermes: str


# --- Auth middleware (decision 5, risk 3) ---------------------------------


@app.middleware("http")
async def bearer_auth(request: Request, call_next):
    # /health is the unauthenticated probe surface. Fly's edge proxy
    # health checks (Phase 3) hit it without a bearer token, and we
    # want the same behaviour for any future TCP/HTTP healthcheck.
    if request.url.path == "/health":
        return await call_next(request)

    if not AUTH_TOKEN:
        # Defence in depth: an empty token at boot means the sidecar is
        # misconfigured. Fail closed (503) rather than going wide open.
        return JSONResponse(
            {"detail": "sidecar misconfigured: CORELLIA_SIDECAR_AUTH_TOKEN unset"},
            status_code=503,
        )

    header = request.headers.get("authorization", "")
    if not header.startswith("Bearer "):
        return JSONResponse({"detail": "missing bearer token"}, status_code=401)

    presented = header[len("Bearer ") :]
    # Constant-time compare: never branch on token contents.
    if not secrets.compare_digest(presented, AUTH_TOKEN):
        return JSONResponse({"detail": "invalid bearer token"}, status_code=401)

    return await call_next(request)


# --- Routes ---------------------------------------------------------------


@app.get("/health", response_model=HealthResponse)
async def health() -> HealthResponse:
    # 0.11.9: honest readiness signal. We can verify the AIAgent import
    # succeeded (so chat calls won't immediately 502 on missing-class)
    # but we can't probe Hermes-the-process from here — they're sibling
    # processes under entrypoint.sh's supervisor branch. Phase 6 of the
    # BE interprets ok=false as HealthStarting, ok=true as HealthStarted;
    # surfacing the import state at this seam is the strictly-true signal
    # the sidecar can offer without a Hermes-side probe.
    if not AIAGENT_AVAILABLE:
        return HealthResponse(ok=False, hermes="missing")
    return HealthResponse(ok=True, hermes="ready")


@app.post("/chat", response_model=ChatResponse)
async def chat(req: ChatRequest) -> ChatResponse:
    try:
        agent = _get_or_create_agent(req.session_id)
        # AIAgent.chat is sync. We're in an async handler, so this
        # blocks the event loop for the duration of the model call.
        # Acceptable for v1 (decision: unary chat, single in-flight
        # call per session keyed on session_id). v1.6 streaming is
        # the right time to reshape this onto a thread-pool offload.
        reply = agent.chat(req.message)
    except Exception as exc:  # noqa: BLE001 — surface a clean 502 to the caller
        logger.exception("chat failed session_id=%s", req.session_id)
        raise HTTPException(
            status_code=502,
            detail=f"chat failed: {type(exc).__name__}",
        ) from exc

    if not isinstance(reply, str):
        # AIAgent's contract says str. If upstream changes shape under
        # us, surface it as a 502 rather than letting pydantic raise.
        raise HTTPException(status_code=502, detail="agent returned non-string reply")

    return ChatResponse(content=reply)


@app.post("/tools/invoke")
async def tools_invoke() -> JSONResponse:
    # blueprint.md §3.1's third sub-endpoint. Out of scope for this
    # plan (anti-scope-creep §5). Reserved here so the route exists
    # and returns the right shape for clients probing capabilities.
    return JSONResponse({"detail": "tools/invoke not implemented"}, status_code=501)
