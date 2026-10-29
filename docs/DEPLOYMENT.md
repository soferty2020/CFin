# CFin — Deployment

## Production

- URL: https://cfin.calypsoia.ru/
- Project root: `/srv/cfin`
- Deployment: Docker Compose
- Database: PostgreSQL 16

Production is the source of truth for deployed behavior.

## Release procedure (scope and phase gates)

This is a checklist, not permission to operate production. Obtain the Owner's
release-specific authorization, exact commit, affected services, migration,
recovery scope and stop/resume gates first. Inspect current production state;
the repository snapshot is not a running-image attestation. Bind staged files,
Compose configuration and candidate image IDs to the reviewed release before
changing anything. Keep private recovery material and evidence; deletion,
restore-to-live and rollback need separate authorization.

1. **Pre-stop:** Check the exact CFin Compose project, existing container IDs,
   image IDs, restart policies, resolved configuration, used mounts (including
   DB data volume and init bind), network, ingress, disk/inodes, memory/PIDs,
   permissions and recovery-path collision. Establish enough capacity for a
   retained dump, isolated restore clone and migration growth. Build/stage
   reviewed candidate images without replacing the running services; record
   and recheck their image IDs and staged-file hashes. A tag alone does not
   establish image provenance. Stop if a target or prerequisite differs.
2. **Maintenance/freeze:** Under the approved CFin-only maintenance scope,
   stop **web, verify stopped/ingress**, then stop **API, verify stopped**;
   leave DB running. Check exact IDs, restart policies and phase-specific
   network topology: stopped web/API may detach, while DB remains attached.
   Sample DB client sessions after stopping (including reconnects across
   bounded samples); investigate any observed writer/restart source. Quiet
   samples are not proof that every external writer is impossible.
3. **Recovery before migration:** Create a new private retained PostgreSQL
   dump only after the post-stop gates pass; verify its checksum and catalog.
   Restore into an isolated, resource-bounded clone with no published ports
   or production network access. Independently verify restore, schema/catalog
   and scoped data count/digest parity against the frozen source. Keep the
   original dump untouched; a dump's existence alone is not restore proof.
4. **Rehearse and migrate:** Rehearse the exact reviewed migration on the
   clone and check post-migration schema and data invariants. Only after the
   restore and rehearsal gates pass, run the one-time live migration and
   read back its exact result. Never blindly replay a migration on ambiguous
   output; reconcile the live schema/catalog and evidence first.
5. **Cutover:** Switch API to the pinned candidate image and check its running
   ID/image and private health, then switch web to its pinned image and check
   loopback/public HTTPS and `GET /api/health`. Docker `.State.Health` is
   optional: an absent API/web Health map is **not** an unhealthy status.
   Inspect running/status/image independently and use the HTTP endpoint;
   rely on a Docker health status only where a healthcheck exists.
6. **Acceptance and resumption:** Perform only the Owner-authorized smoke
   scenarios; stop on an authentication refusal rather than retrying or
   resetting credentials. After Owner acceptance and fresh technical checks,
   read back CFin maintenance/ingress controls and resume only those actually
   still active within the authorized scope. Verify service IDs/images,
   migration state, retained recovery and public health again. Preserve the
   clone, dump and evidence until separately authorized otherwise.

At every phase, capture the exact target and read back after a write. An
ambiguous external result is **UNKNOWN**, not success or permission to retry.
Use targeted read-only diagnostics for the affected service/path, not a broad
host audit. With SSH, a pinned `ssh -T` command that consumes a script on
stdin must **not** use `-n` (which redirects stdin away); use `-n` only for
commands intentionally taking no stdin. Pin the approved host/identity and
do not print credentials, financial records or private dump contents.

## PR #16 historical release (not a reusable command sequence)

PR #16 merged as `c00e2e367d616aa9d88a470535c884a2ed845984`.
The 2026-10-28 release followed the phase order above after scoped corrections
to local release helpers and read-only probes. The retained recovery directory
is `/srv/cfin/backups/pr16-c00e2e3-20261028-aa68cd50`; its original
`frozen-cfin.dump`, checksum, isolated clone and evidence remain retained.
The clone restore and migration rehearsal preceded the one-time live migration;
API then web were switched to pinned candidate images. The operator's single
authenticated POST returned 401; it was not retried, and authenticated GET
smoke was not performed. The Owner instead personally authenticated and
confirmed article direction selection ("Все ок"). Final independent technical
readback found the services running and public HTTPS `/` and `/api/health`
returning 200, with no active CFin stop/vhost return to reverse. This is not
evidence that every calendar/entry scenario was exercised or that no writer
can ever appear. See `CURRENT_STATE.md` for the scoped evidence and limits.

Do not treat generic `docker compose build` / `up` examples as a migration
release recipe: they omit image provenance, freeze, recovery and phase gates.

## Logs

```bash
sudo docker compose logs --tail=100 web
sudo docker compose logs --tail=100 api
sudo docker compose logs --tail=100 db
```

## Health check

Backend exposes `GET /api/health`.

## Smoke test

Choose and authorize scenarios for the particular release (for example login,
calendar navigation, cell interaction, entry CRUD, retention and category
management where affected). Report which were actually exercised, by whom,
and which remain unverified; do not infer a full smoke pass from HTTP 200.

## Never run without explicit approval

- `docker compose down -v`
- deleting Docker volumes
- `docker system prune --volumes`
- destructive database reset
- cascade deletion of financial history

## Secrets

Do not commit or expose:
- `.env`
- passwords
- private SSH keys
- session cookies
- secret tokens
