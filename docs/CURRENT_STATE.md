# CFin — Current State

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
