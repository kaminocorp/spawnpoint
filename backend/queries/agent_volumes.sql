-- M5 fleet-control. agent_volumes is the Corellia-side mirror of Fly's
-- volume state — one row per provisioned Fly volume, tracking which
-- replica owns it. The Fly API is the source of truth for volume
-- existence + actual size; this table tracks (a) "we asked for this
-- volume to exist" and (b) "we believe it should be attached to this
-- machine and this size." Drift detection compares the two.
--
-- Per Phase 3.5: writes to this table happen via the volumeRecorder
-- interface injected into FlyDeployTarget — same package boundary that
-- keeps agents.Service free of Fly-API knowledge while keeping
-- FlyDeployTarget free of direct DB access.

-- name: InsertAgentVolume :one
-- Called by the volumeRecorder right after flaps.CreateVolume returns
-- (decision 8.6 step 2 of Spawn's revised order). fly_machine_id is
-- intentionally omitted — the row is inserted *before* flaps.Launch
-- runs, so the machine ID isn't known yet (Q10's "unattached is a
-- legitimate state" — modeled cleanly here).
INSERT INTO agent_volumes (
    agent_instance_id,
    fly_volume_id,
    region,
    size_gb,
    mount_path
)
VALUES ($1, $2, $3, $4, $5)
RETURNING *;

-- name: SetAgentVolumeMachine :exec
-- Called by the volumeRecorder right after flaps.Launch returns
-- (decision 8.6 step 4). Pins the volume to its machine; from this
-- point forward the (agent_instance_id, fly_machine_id) UNIQUE
-- constraint enforces "one volume per machine per agent."
--
-- Keyed by fly_volume_id (not the row's UUID id) because the caller
-- has just produced the volume ID via flaps.CreateVolume and held it
-- across the Launch call — passing it back here is one fewer DB
-- round-trip than re-fetching the row's UUID id.
UPDATE agent_volumes
   SET fly_machine_id = $2,
       updated_at     = now()
 WHERE fly_volume_id = $1;

-- name: UpdateAgentVolumeSize :exec
-- Called by the service layer after flaps.ExtendVolume succeeds
-- (Phase 4 ResizeVolume). Per-volume update; ResizeVolume loops over
-- the agent's volumes and calls this once per replica, all inside the
-- same tx as the agent_instances.volume_size_gb update so a partial
-- failure doesn't leave the parent's desired-state out of sync with
-- the per-volume desired-state.
UPDATE agent_volumes
   SET size_gb    = $2,
       updated_at = now()
 WHERE fly_volume_id = $1;

-- name: ListAgentVolumesByInstance :many
-- Hot read path: the deployment inspector (Phase 7) renders one row
-- per replica volume; DetectDrift (Phase 4) iterates these against
-- flaps.List output. Returned in created_at order so the inspector's
-- per-replica list is stable across renders (LIFO scale-down per
-- decision 7 means the most-recently-created are the first to be
-- destroyed; ordering by created_at ASC keeps the survivors at the
-- top of the list).
SELECT
    id,
    agent_instance_id,
    fly_volume_id,
    fly_machine_id,
    region,
    size_gb,
    mount_path,
    created_at,
    updated_at
  FROM agent_volumes
 WHERE agent_instance_id = $1
 ORDER BY created_at ASC;

-- name: DeleteAgentVolume :exec
-- Called by the service layer after flaps.DeleteVolume succeeds
-- (decision 8.5 cascade-delete on agents.Service.Destroy, plus the
-- LIFO scale-down branch in Phase 3.5). Hard-delete (not soft) per
-- decision 8.5: there's no audit value in keeping a row that points
-- at a non-existent Fly volume.
--
-- Keyed by fly_volume_id — the caller already holds it from the
-- ListAgentVolumesByInstance enumeration step, so we save the round-
-- trip vs keying by row UUID.
DELETE FROM agent_volumes
 WHERE fly_volume_id = $1;
