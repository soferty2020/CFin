# CFin — Current State

## Подтверждённое

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

## Подтверждённый MVP

- login/session auth;
- hierarchy groups/subgroups/categories;
- payment calendar;
- income/expense rows;
- entry create/edit/delete;
- multiple entries per cell;
- month navigation;
- PostgreSQL persistence;
- production HTTPS access.

## Что требует production verification перед изменениями

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

После проверки этот файл следует обновить фактами и датой аудита.

## Ближайшая работа

Следующий продуктовый инкремент — UI v2.1: управление groups/subgroups/categories через нормальные React modal dialogs с безопасным delete и без browser `prompt()` / `confirm()`.
