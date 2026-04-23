# Agent Deployment Architecture

How SpawnPoint deploys agents across arbitrary infrastructure — major cloud providers, PaaS platforms, and self-hosted hardware — using a single unified model.

---

## Goals

1. **Provider-agnostic.** Deploy the same agent to AWS, GCP, Azure, Fly.io, Railway, Render, or a user's own home server, from a single control plane.
2. **Self-host friendly.** Users running SpawnPoint OSS must be able to link their own hardware (VPS, home server, bare metal) as a deployment target — without port-forwarding, dynamic DNS, or firewall changes.
3. **Uniform interface.** Spawning an agent should look the same from the user's perspective regardless of target. Infrastructure differences are absorbed by SpawnPoint.
4. **Extensible.** Adding a new provider should be a one-time adapter implementation, not a platform change.

---

## Core Primitives

Two primitives make this achievable:

### 1. OCI containers as the universal unit of deployment

Every provider SpawnPoint targets runs OCI-compliant containers:

| Provider | Native container runtime |
|---|---|
| AWS | ECS, Fargate, EKS, App Runner |
| GCP | Cloud Run, GKE, Compute Engine + Docker |
| Azure | Container Apps, ACI, AKS |
| Fly.io | Fly Machines (OCI-based) |
| Railway / Render | Docker-based by default |
| Self-hosted | Docker, Podman, containerd |

By standardizing on **"every agent is packaged as an OCI image,"** the multi-provider problem collapses into a solved one: *run this container somewhere*.

WebAssembly (WASM) via wasmCloud / Fermyon Spin is a promising future alternative — lighter, faster cold starts, better sandboxing — but the ecosystem is not yet mature enough to be the default in v1. Worth revisiting in 12–18 months.

### 2. Provider adapter pattern

SpawnPoint defines a **single provider interface**. Each target (AWS, GCP, Fly, self-host, etc.) is an adapter implementing this interface. Adding support for a new provider is a one-time implementation — not a platform change.

This is the same pattern used by Terraform providers, Crossplane providers, Pulumi providers, and Kubernetes cloud-controller-manager implementations.

---

## The Provider Interface

A minimal v1 interface, roughly:

```go
type Provider interface {
    // Lifecycle
    Deploy(ctx, spec DeploymentSpec) (Deployment, error)
    Update(ctx, id DeploymentID, spec DeploymentSpec) error
    Destroy(ctx, id DeploymentID) error

    // Observability
    HealthCheck(ctx, id DeploymentID) (Status, error)
    Logs(ctx, id DeploymentID, opts LogOptions) (LogStream, error)

    // Capabilities (what this provider supports)
    Capabilities() ProviderCapabilities
}

type DeploymentSpec struct {
    Image          string            // OCI image reference
    Env            map[string]string // resolved env (secrets materialized)
    Resources      ResourceLimits    // cpu, memory, disk
    Networking     NetworkConfig     // ports, egress rules
    HealthProbe    ProbeConfig
    Labels         map[string]string // for audit/tagging
}
```

The `Capabilities()` method lets the control plane reason about what each provider can offer (e.g. AWS supports GPU, Railway doesn't; Fly.io supports persistent volumes, Cloud Run doesn't). The UI uses this to filter deploy targets for a given agent spec.

**Key design principle:** the interface is intentionally small. Anything a specific provider can do beyond this (e.g. AWS-specific IAM role attachment) is exposed through provider-specific optional config under a `providerExtensions` field, not by expanding the core interface.

---

## Self-Hosted Runner Model

This is the pattern that makes "link your home server" work without requiring the user to open ports, configure dynamic DNS, or expose anything publicly.

### The outbound tunnel pattern

```
┌─────────────────────────┐         ┌──────────────────────────┐
│   SpawnPoint Control    │         │   User's Home Server     │
│   Plane (hosted or      │◄────────┤   spawnpoint-runner      │
│   self-hosted)          │ outbound│   (lightweight binary)   │
│                         │ persistent│                          │
│  - receives deploy reqs │ conn    │  - holds socket open     │
│  - sends commands down  ├────────►│  - pulls images          │
│  - receives logs/health │ commands│  - runs containers       │
└─────────────────────────┘         │  - streams logs up       │
                                    └──────────────────────────┘
```

1. User installs a lightweight OSS binary (`spawnpoint-runner`) on their hardware.
2. Runner opens a **persistent authenticated outbound connection** to the SpawnPoint control plane. Outbound means it traverses NAT/firewalls without any inbound port exposure.
3. Control plane sends deploy commands down the tunnel ("pull image `X`, run with env `Y`, limit to `Z` resources").
4. Runner executes locally against Docker / Podman / containerd.
5. Runner streams logs, metrics, and health back up the same tunnel.
6. On disconnect, runner retries with exponential backoff. Control plane marks the target as degraded.

### Runner responsibilities

- **Auth** — present a long-lived token (enrolled once via `spawnpoint-runner enroll`) plus short-lived rotating credentials.
- **Image pull** — from the SpawnPoint-managed registry, or a user-specified private registry with injected credentials.
- **Container lifecycle** — start, stop, restart, resource limits, health probes.
- **Log/metric forwarding** — stream to the control plane.
- **Local isolation** — each agent runs in its own container with scoped network and filesystem.
- **Offline survival** — continue running deployed agents if the control-plane connection drops; reconnect and reconcile state on recovery.

### Transport options

- **gRPC bidirectional streaming** — clean, typed, widely supported. Likely the default.
- **WebSocket + JSON-RPC** — simpler, browser-inspectable, easier to proxy.
- **NATS** — if SpawnPoint grows into a multi-node control plane, NATS as a message fabric between control-plane and runners is a strong option.

All three traverse firewalls as outbound HTTPS-like traffic. Default to gRPC streaming for v1.

---

## Who has solved parts of this

SpawnPoint is not inventing a new category of infrastructure. The runner/control-plane pattern is well-proven:

| System | What it teaches us |
|---|---|
| **GitHub Actions self-hosted runners** | Almost exactly the pattern: enrollment, outbound tunnel, job dispatch, log streaming. Reference implementation for UX. |
| **HashiCorp Nomad clients** | Agents on hosts, outbound to a central control plane, workload dispatch. |
| **Kubernetes kubelet** | Same pattern at hyperscale. More complex than SpawnPoint needs. |
| **Fly.io `flyd`** | Per-host daemon managing Firecracker microVMs via a central API. |
| **Tailscale** | Solves the authenticated secure-transport layer specifically; can be used as the transport substrate. |
| **Coolify / CapRover / Dokku** | OSS multi-provider deploy platforms (not agent-specific) worth studying for ergonomics. |

---

## Protocols & Standards We Leverage

| Standard | Role |
|---|---|
| **OCI image + runtime spec** | Universal packaging format. Non-negotiable. |
| **Docker Engine API** | Simplest "run a container on this host" interface — the self-host adapter's backend. |
| **gRPC / Protobuf** | Typed bidirectional streaming between control plane and runners. |
| **WireGuard / Tailscale** | Optional secure-transport layer for runner ↔ control plane. |
| **OpenTelemetry** | Standard for emitting traces, metrics, logs — lets SpawnPoint integrate with any observability backend. |
| **Kubernetes (optional adapter)** | For users who already run K8s — deploy agents as Pods. Not required in v1. |

---

## Adapter Rollout Plan

To validate the interface without building N providers upfront, start with **three**:

1. **Fly.io** — cleanest developer experience, well-documented Machines API, fast iteration.
2. **AWS ECS / Fargate** — the hardest major cloud. If the interface holds up here, every other major cloud is straightforward.
3. **Self-host runner** — proves the OSS self-host value proposition end-to-end.

Later additions (in rough priority order): GCP Cloud Run → Azure Container Apps → Railway → Render → Kubernetes (generic) → bare SSH-to-a-VM.

---

## Cross-cutting Concerns

These apply to *every* adapter and must be solved once centrally:

### Image registry

Agents need images to pull. Options:
- Host a SpawnPoint-managed registry (simplest for users).
- Support user-provided registries (ECR, GCR, GHCR, private registries) with credential injection.
- Both.

Lean toward **both**, with SpawnPoint's managed registry as the default.

### Secrets & env injection

Secrets must never be stored in plaintext in the DB or image. Pattern:
- Control plane encrypts at rest (KMS / libsodium).
- At deploy time, secrets are materialized into the `DeploymentSpec.Env` field inside a secure channel.
- Self-hosted runners never cache secrets to disk.

### Agent identity & outbound auth

Each agent needs an identity (for audit, for tool-access checks, for memory provider auth). On deploy, SpawnPoint injects a short-lived, rotating token scoped to that agent. This is consumed by the permission layer (covered in a separate doc).

### Health & reconciliation

The control plane's view of deployments must stay in sync with reality. Pattern: **desired-state vs. actual-state reconciliation loops**, like Kubernetes controllers. The DB stores desired state; reconcilers compare to actual state from each adapter and converge.

### Log and event pipeline

All log/event data flows into a standardized schema (OpenTelemetry-compatible), regardless of provider. Downstream consumers (audit UI, third-party observability tools) hook into this single stream.

---

## Out of Scope for v1

- Kubernetes-native operator (CRDs, custom resources). Add after v1.
- GPU-aware scheduling. Pass through to providers that support it; no cross-provider GPU pool.
- WASM runtime. Revisit after OCI adapters are solid.
- Cross-provider migration (moving a live agent from AWS to Fly.io without downtime). v2+.
- Built-in observability dashboards. We integrate with existing tools (Langfuse, Helicone, Grafana, etc.) rather than rebuild.

---

## Summary

The architecture reduces to:

> **Every agent is an OCI container. Every target is a provider adapter. Self-host is a provider whose runner phones home over an outbound tunnel. The control plane orchestrates; providers execute.**

This keeps SpawnPoint's core surface small, leverages decades of existing infrastructure work, and makes both major-cloud and bring-your-own-hardware deployments behave identically from the user's perspective.
