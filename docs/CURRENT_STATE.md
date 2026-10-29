# CFin — Current State

## PR #16 / Issue #10 — 2026-10-28 production release (scoped verification)

[PR #16](https://github.com/soferty2020/CFin/pull/16) merged as
`c00e2e367d616aa9d88a470535c884a2ed845984`. The operator's release
record (`t_644a9ad1`, comments 345–368) documents the approved CFin-only
web-then-API stop, post-stop bounded DB session checks, retained private
backup plus verified isolated restore **before** clone rehearsal and one-time
live migration, then API-then-web cutover. Read-only follow-up `t_5976a610`
and finalization `t_dea71d17` verified the resulting state. This is a
historical record, not authority to repeat those operations.

Final readback: DB running/healthy on original image
`sha256:721873c34ceb9f8d8fc265984940dc982404c105f19ad51be9fdc5970a6080ea`;
API running on candidate image
`sha256:40abb620e3d47ca80279ae8c8da9cb2cb00fee5f301d26053a2d14bdeab38833`;
web running on candidate image
`sha256:010cd4987efe85e23b5d9bdecb624822de240124df82d07de996dfea18d08972`.
Public HTTPS `/` and `/api/health` each returned 200, the CFin vhost proxied
to loopback web without an active maintenance return, and no scoped stop
remained to reverse. API/web Docker Health maps were absent; absence is not
an unhealthy result. Live and isolated-clone catalog assertions were
`MIGRATED`; seven-table live/clone counts and row digests matched each other
and retained evidence at the measured snapshot. This is bounded parity,
not proof of all data, future stability or universal writer absence.

Recovery directory `/srv/cfin/backups/pr16-c00e2e3-20261028-aa68cd50`
retains `frozen-cfin.dump` (12,979 bytes; SHA-256
`22c6c1b82110c20160bf9594667f34a2c4803de8b90ef87d5b4a0cb1f3c574a9`),
its verified checksum, isolated clone and evidence. Preserve these; no
restore-to-live, rollback or deletion occurred. The operator's **one**
authenticated POST attempt returned 401 and was not retried or reset; no
operator authenticated GET smoke followed. The Owner personally authenticated
and confirmed article direction selection ("Все ок"). That UI acceptance
does **not** verify every calendar or entry scenario. Finalization involved
read-only checks and no restart or vhost change. See `DEPLOYMENT.md` for a
phase-gated procedure, not a claim of new production checks by this docs edit.

## PR #12 / Issue #3 — 2026-10-14 (Owner-reported deployment)

PR #12 [MERGED](https://github.com/soferty2020/CFin/pull/12) with merge commit `213ddf729a30dc9c8317b0697c1432b898782c9c`. Owner reports local `main` fast-forwarded to that commit and a manual production deploy. The production web image is reported as `sha256:967864020d59166b56ef05f9e106d34f6b7320df1c66a1b9556654950ae89ebf`. The image was prepared from a non-running container of the previous web image by copying locally built static assets; no server-side npm install, Docker build or base-image pull was reported. Only `frontend/src/main.tsx` and `frontend/src/style.css` were updated on the server, and only `web` was switched. The synthetic mock was not deployed; old static assets remain alongside the new ones in the image.

Owner-provided command output reports that HTTPS `index.html`, logo, CSS and JS are byte-identical to the package; `/api/health` returned `{"ok":true}`; `api` and `db` container IDs and images did not change, and the DB was healthy. Inspection reported `backend/src/index.ts`, `docker-compose.yml`, `frontend/Dockerfile` and `frontend/nginx.conf` unchanged. Owner's UI smoke covered login, existing data, month navigation, selected-day persistence and transfer, clickable weekends and today styling. These are **Owner-provided results, not independent production checks by the team**. Financial write operations were not smoke-tested.

Rollback was prepared but neither run nor tested; actual restoration remains UNVERIFIED. The combined today+weekend visual state remains UNVERIFIED. CI is absent (not passing); GitHub reviews are absent, although independent Kanban Review `t_8b0147ff` accepted the implementation. At the time of this 2026-10-14 handoff Issue #3 remained OPEN and the feature branch was retained. Source: hermes-team-pilot card `t_a287d4e3`, comment #14 (Owner-reported production deploy handoff); the historical P0 findings below are dated 2026-10-07 and were not repeated here.

## PR #14 / Issue #3 — 2026-10-16 (merge verified; deployment and UI smoke Owner-reported)

Git records confirm [PR #14](https://github.com/soferty2020/CFin/pull/14) merged into `main` at `82eb171f825514f08a7da5e12e7dd208c76c6d3e` (local merge commit and read-only remote `refs/heads/main` check). This is distinct from the earlier PR #12 deploy recorded above. Owner reports the PR #14 frontend-only deploy on 2026-10-16 from that merge commit with web image `sha256:9aec135c128e0d5c6f26ef2bbc38a6161620aae6c7a658b3ccccf5cd71377cf2` and server result `DEPLOY PR14 TECHNICAL CHECKS PASSED`: HTTPS-served files matched the package, `/api/health` returned `{"ok":true}`, protected files and `api`/`db` containers were unchanged; backup `/srv/cfin/backups/pr14-82eb171` was reported. These are Owner-provided technical results, not independently repeated production checks or independent running-image verification.

Owner's production UI smoke reported an ordinary F5 preserved the selected month even after selecting a different month, and examined existing entries and sums remained in place with no noticed change. This observation is **not** a full database audit or proof of financial-write behavior. Independent synthetic functional verification (Reviewer `t_8f2fe823`, run 31: Chrome mutation 23/23, GET race and calendar regression PASS) and LF-stage Review (`t_0c5255b7`, run 40) concern test/local evidence, **not** a production browser rerun; Owner's visual assessment of the saved image is not an independent pixel-test PASS.

Issue #3 was confirmed CLOSED at `2026-10-16T06:17:13Z` after a final comment was posted and read back (hermes-team-pilot card `t_a67a3ee1`, run 45). Owner-provided final-comment URL: https://github.com/soferty2020/CFin/issues/3#issuecomment-6209380996 (the attached URL returned 404 in a separate attempt; its unseen content is not asserted here). CI PASS is **not** claimed (CI absent); production financial writes were not smoke-tested, and PR #14 rollback was neither executed nor verified. No new deployment or production mutation was performed for this documentation update.

## P0 audit — 2026-10-07 (completed within read-only scope)

**Production-verified:** HTTPS `https://cfin.calypsoia.ru/` serves HTML (200), `/api/health` returns 200 `{"ok":true}`, and HTTP redirects to HTTPS (301). The host Nginx vhost `/etc/nginx/conf.d/cfin.calypsoia.ru.conf` proxies to `127.0.0.1:3001`; the server-side `frontend/nginx.conf` proxies `/api/` to `api:3000`. The production `backend/src/index.ts`, `frontend/src/main.tsx`, `frontend/src/style.css`, and `docker-compose.yml` match their `server-snapshot/` counterparts byte-for-byte by SHA-256. The production `frontend/nginx.conf` differs byte-for-byte from the snapshot (the inspected proxy/security directives have the same meaning; whitespace/layout differs). This comparison concerns files on disk, not independently verified running container images.

**Routes and UI evidence:** The matching backend source defines authenticated category PATCH/DELETE handlers with validation and dependency-aware 409 on delete (`backend/src/index.ts:37–99`). A public, non-mutating `OPTIONS /api/categories/groups/<uuid>` returned `Allow: PATCH,DELETE` (200). The user accepted source plus OPTIONS as sufficient route verification for P0; no authenticated PATCH/DELETE or database mutation was performed. The matching frontend source uses React modals and contains no `prompt()`/`confirm()` calls; the publicly served JavaScript bundle contains no such direct calls in the inspected asset. In a user-reported manual check in an authenticated production session, custom modals were used without browser prompt/confirm for the checked actions; weekends were highlighted and clickable, today was highlighted, and the selected month persisted after an ordinary F5. No create/edit/delete operations were performed. These UI observations are user-reported, not independently reproduced by the agent; absence of browser dialogs is scoped to the checked actions.

**Deployment/origin:** The matching Compose file declares the web port on `127.0.0.1:3001` and passes `APP_ORIGIN` to the API. The user supplied the result of a manual read-only `sudo docker compose ps` in `/srv/cfin`: `cfin-api-1` (`cfin-api`, service `api`, Up 5 days), `cfin-db-1` (`postgres:16-alpine`, service `db`, Up 5 days, healthy, internal `5432/tcp`), and `cfin-web-1` (`cfin-web`, service `web`, Up 5 days, `127.0.0.1:3001->80/tcp`). A separate user-run in-container equality check returned `APP_ORIGIN_OK` for `https://cfin.calypsoia.ru`; the value itself and `.env` were not displayed. Together with the host vhost and public HTTP/HTTPS checks, this confirms the expected ingress/origin path. These two container findings are user-reported manual checks, not independently executed in this audit; the contents of running images were not hashed against source files. My own `docker compose ps` without `sudo` failed with permission denied; I did not attempt `sudo`.

**Repository/production drift:** The five compared P1 files above match except `frontend/nginx.conf` (byte difference, inspected directives equivalent). The product/architecture documentation still describes category browser dialogs and accounts/balances as future work, while the verified production source contains React category modals, account endpoints, and a balance endpoint. The manual UI check confirms modals in the checked production actions; financial correctness remains outside this audit.

**P1 handoff and audit limits:** The P0 read-only acceptance criteria are satisfied using the accepted static route evidence and user-reported UI/container checks. P1 must re-evaluate its scope against the already present modals; actual category CRUD and 409 handling were not exercised in this non-mutating audit. Running image-to-source identity was not verified and is an audit limitation, not a P1 blocker. No production data, files, configuration, or behavior were changed during this audit or the user-reported read-only checks.

## Ранее задокументированное (не всё повторно проверено на production)

CFin — существующее развёрнутое приложение, не greenfield.

- Production URL: https://cfin.calypsoia.ru/
- Production root: `/srv/cfin`
- Deployment: Docker Compose
- Frontend: React + TypeScript + Vite
- Backend: Node.js + Express + TypeScript
- Database: PostgreSQL 16
- Web: Nginx
- Основная модель: `groups → subgroups → categories → entries`
- Одна календарная ячейка может содержать несколько отдельных `entries`.
- В календаре показывается агрегированная сумма; в cell modal — отдельные entries.
- Выходные должны быть визуально выделены и полностью кликабельны.

## Ранее заявленный MVP (требует интерактивной проверки)

- login/session auth;
- hierarchy groups/subgroups/categories;
- payment calendar;
- income/expense rows;
- entry create/edit/delete;
- multiple entries per cell;
- month navigation;
- PostgreSQL persistence;
- production HTTPS access.

## Исторический checklist production verification

Репозиторий содержит `server-snapshot/`, который может отставать от production.

Перед первым новым инкрементом агент должен проверить:
- фактический `backend/src/index.ts` на production;
- фактический `frontend/src/main.tsx`;
- фактический `frontend/src/style.css`;
- `docker-compose.yml`;
- реально доступные category PATCH/DELETE routes;
- наличие оставшихся browser `prompt()` / `confirm()`;
- текущую реализацию weekend/today states;
- текущую production proxy/origin конфигурацию без раскрытия секретов.

Итог P0 и ограничения read-only проверки указаны в разделе P0 audit выше.

## Ближайшая работа

Следующий продуктовый инкремент — UI v2.1: управление groups/subgroups/categories через нормальные React modal dialogs с безопасным delete и без browser `prompt()` / `confirm()`.
