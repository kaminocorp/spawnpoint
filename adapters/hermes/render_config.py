#!/usr/bin/env python3
"""
corellia/hermes-adapter — manifest renderer (v1.5 Pillar B Phase 2 + 5)

Fetches the per-instance ToolManifest from the Corellia control plane and
renders:
  - $HERMES_HOME/config.yaml             (platform_toolsets.cli + plugins.enabled)
  - $HERMES_HOME/.env                    (per-toolset credential env vars, if any)
  - $HERMES_HOME/plugins/corellia_guard/ (Phase 5 enforcement plugin)
  - $HERMES_HOME/corellia/scope.json     (Phase 5 initial scope state)

The plugin's daemon thread keeps scope.json fresh on the configured TTL
(default 30s, env-overridable). This module writes the *initial* state so
the plugin reads a non-empty scope at startup — without it, the plugin
would deny-all until the first poll completes (~30s blackout).

Usage:
    python render_config.py <manifest_url> <bearer_token>

Both arguments are passed by entrypoint.sh from CORELLIA_TOOL_MANIFEST_URL
and CORELLIA_INSTANCE_TOKEN. On any error the script exits non-zero and
entrypoint.sh logs the failure; the agent then boots with Hermes's own
defaults (safe, non-fatal fallback per Phase 2 design).
"""

import json
import os
import shutil
import sys
import urllib.error
import urllib.request


def hermes_home() -> str:
    return os.environ.get("HERMES_HOME", os.path.expanduser("~/.hermes"))


def fetch_manifest(url: str, token: str) -> dict:
    body = json.dumps(
        {"instance_id": os.environ.get("CORELLIA_AGENT_ID", "")}
    ).encode()
    req = urllib.request.Request(
        url,
        data=body,
        headers={
            "Content-Type": "application/json",
            "Authorization": f"Bearer {token}",
        },
        method="POST",
    )
    try:
        with urllib.request.urlopen(req, timeout=10) as resp:
            return json.loads(resp.read())
    except urllib.error.HTTPError as e:
        raise RuntimeError(f"manifest endpoint returned HTTP {e.code}") from e
    except urllib.error.URLError as e:
        raise RuntimeError(f"manifest fetch network error: {e.reason}") from e


def install_plugin_stub(home: str) -> None:
    """Copy the corellia_guard plugin into HERMES_HOME/plugins/."""
    src = "/corellia/plugin/corellia_guard"
    dst = os.path.join(home, "plugins", "corellia_guard")
    if os.path.isdir(src) and not os.path.exists(dst):
        os.makedirs(os.path.join(home, "plugins"), exist_ok=True)
        shutil.copytree(src, dst)
        print(
            "corellia render_config: installed corellia_guard plugin",
            file=sys.stderr,
        )


# Plugin-enforced scope-shape keys (Phase 5). Other shape keys exist in
# the catalog (e.g. forward-compat `browser.url_allowlist`) but the plugin
# only enforces these four today.
_PLUGIN_ENFORCED_SCOPE_KEYS = (
    "url_allowlist",
    "command_allowlist",
    "path_allowlist",
    "working_directory",
)


def write_scope_json(home: str, manifest: dict) -> None:
    """Write the initial scope.json the corellia_guard plugin reads at startup.

    Shape:
        {
          "manifest_version": <int>,
          "toolsets": {
            "<toolset_key>": { ...plugin-enforced scope shape... }
          }
        }

    Empty toolsets dict is a valid state: every governed call default-denies
    until the plugin's poll daemon refreshes from the control plane."""
    out_toolsets: dict = {}
    for ts in manifest.get("toolsets") or []:
        if not isinstance(ts, dict):
            continue
        key = ts.get("toolset_key")
        if not isinstance(key, str):
            continue
        scope = ts.get("scope") or {}
        if not isinstance(scope, dict):
            continue
        projected = {k: scope[k] for k in _PLUGIN_ENFORCED_SCOPE_KEYS if k in scope}
        if projected:
            out_toolsets[key] = projected

    doc = {
        "manifest_version": int(manifest.get("manifest_version") or 0),
        "toolsets": out_toolsets,
    }
    scope_dir = os.path.join(home, "corellia")
    os.makedirs(scope_dir, exist_ok=True)
    atomic_write(
        os.path.join(scope_dir, "scope.json"),
        json.dumps(doc, indent=2, sort_keys=True),
    )
    print(
        f"corellia render_config: wrote scope.json (manifest_version={doc['manifest_version']}, "
        f"governed_toolsets={sorted(out_toolsets.keys())})",
        file=sys.stderr,
    )


def atomic_write(path: str, content: str) -> None:
    """Write content to path atomically via a temp file + rename."""
    tmp = path + ".corellia.tmp"
    with open(tmp, "w") as f:
        f.write(content)
    os.replace(tmp, path)


def write_config_yaml(home: str, toolset_keys: list[str]) -> None:
    lines = [
        "# Written by corellia render_config.py — do not edit by hand\n",
        "platform_toolsets:\n",
        "  cli:\n",
    ]
    for key in toolset_keys:
        lines.append(f"    - {key}\n")
    lines += [
        "plugins:\n",
        "  enabled:\n",
        "    - corellia_guard\n",
    ]
    atomic_write(os.path.join(home, "config.yaml"), "".join(lines))
    print(
        f"corellia render_config: wrote config.yaml ({len(toolset_keys)} toolsets: {toolset_keys})",
        file=sys.stderr,
    )


def write_env_file(home: str, env_vars: dict[str, str]) -> None:
    lines = ["# Written by corellia render_config.py\n"]
    for key, val in env_vars.items():
        # Single-quote the value; escape embedded single-quotes.
        escaped = val.replace("'", "'\\''")
        lines.append(f"{key}='{escaped}'\n")
    atomic_write(os.path.join(home, ".env"), "".join(lines))
    print(
        f"corellia render_config: wrote .env ({len(env_vars)} credentials)",
        file=sys.stderr,
    )


def main() -> None:
    if len(sys.argv) != 3:
        print("usage: render_config.py <manifest_url> <bearer_token>", file=sys.stderr)
        sys.exit(1)

    manifest_url = sys.argv[1]
    bearer_token = sys.argv[2]
    home = hermes_home()

    try:
        body = fetch_manifest(manifest_url, bearer_token)
    except RuntimeError as e:
        print(f"corellia render_config: {e}", file=sys.stderr)
        sys.exit(1)

    manifest = body.get("manifest", {})
    toolsets = manifest.get("toolsets", [])
    env_vars = manifest.get("env", {})

    # Always install the plugin into $HERMES_HOME/plugins/ — Hermes's plugin
    # discovery only walks that directory.
    install_plugin_stub(home)

    # Always write scope.json (even with an empty toolsets dict). The
    # plugin reads it at startup; an empty doc means default-deny on
    # every governed call until the poll daemon refreshes — which is the
    # safe initial state (Phase 5 §5 decision 10).
    os.makedirs(home, exist_ok=True)
    write_scope_json(home, manifest)

    if not toolsets:
        # No tools equipped — leave Hermes's own config.yaml intact.
        # The agent boots with Hermes's default toolset configuration.
        print(
            "corellia render_config: manifest has no toolsets — keeping Hermes defaults",
            file=sys.stderr,
        )
    else:
        toolset_keys = [t["toolset_key"] for t in toolsets]
        write_config_yaml(home, toolset_keys)

    if env_vars:
        write_env_file(home, env_vars)


if __name__ == "__main__":
    main()
