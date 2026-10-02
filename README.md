# CFin — Cash Flow Service

**Внутренний веб-сервис IT-компании «Калипсо»** для учёта, планирования и контроля денежных потоков.

## Статус

CFin — уже развёрнутое и работающее приложение. Это **не greenfield-проект**.

- **Production:** https://cfin.calypsoia.ru/
- **Сервер:** 82.146.61.4, Ubuntu 24.04 LTS
- **SSH-пользователь:** `cfinadmin`
- **Production root:** `/srv/cfin`
- **Deployment:** Docker Compose
- **Database:** PostgreSQL 16
- **Source of truth для production:** фактические файлы и поведение `/srv/cfin`

> Репозиторий и `server-snapshot/` могут отставать от production. Перед изменениями, влияющими на production, сверять актуальное состояние сервера.

## Стек

| Слой | Технологии |
|---|---|
| Frontend | React 19, TypeScript, Vite 6, CSS |
| Backend | Node.js 22, Express, TypeScript |
| Database | PostgreSQL 16 |
| Deployment | Docker + Docker Compose |
| Web | Nginx |

## Уже реализовано в MVP

- авторизация и серверные сессии;
- группы → подгруппы → статьи;
- платёжный календарь;
- отдельные строки «Доход» / «Расход»;
- несколько `entries` в одной календарной ячейке;
- создание, редактирование и удаление финансовых записей;
- агрегирование сумм по ячейкам;
- навигация по месяцам;
- production HTTPS-доступ.

## Ключевая модель

`groups → subgroups → categories → entries`

Одна календарная ячейка может содержать несколько `entries`. В таблице показывается агрегированный итог, а при открытии ячейки пользователь работает с каждой записью отдельно.

## Где смотреть дальше

- `AGENTS.md` — правила работы агентов;
- `ROADMAP.md` — последовательность продуктовых инкрементов;
- `docs/CURRENT_STATE.md` — текущее подтверждённое состояние и что нужно перепроверить;
- `docs/ARCHITECTURE.md` — архитектурные границы;
- `docs/DEPLOYMENT.md` — production/deploy/rollback;
- GitHub Issues — рабочий backlog.

## Принципы разработки

1. Production не пересоздавать и не переписывать без необходимости.
2. Делать небольшие законченные инкременты.
3. Не удалять/сбрасывать данные.
4. Перед миграциями и рискованными изменениями делать backup.
5. Не публиковать секреты из `.env`, SSH private key, session cookies.
6. После каждого deploy выполнять smoke test на https://cfin.calypsoia.ru/.


## Project context for agents

- `docs/PROJECT_CONTEXT.md` — complete handoff context
- `docs/PRODUCT.md` — product/business rules
- `docs/SERVER.md` — server and production context
- `docs/ARCHITECTURE.md` — canonical architecture overview
- `docs/CURRENT_STATE.md` — verified current state
- `docs/DEPLOYMENT.md` — deployment and rollback
- `docs/DECISIONS.md` — durable confirmed decisions
- `docs/BACKLOG.md` — issue/dependency map
- `ROADMAP.md` — major product sequence
- `AGENTS.md` — operating rules for Hermes/agents
