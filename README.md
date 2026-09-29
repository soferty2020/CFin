# CFin — Cash Flow Service

**Внутренний веб-сервис IT-компании «Калипсо»** для учёта, планирования и контроля денежных потоков.

## Текущий статус

CFin — развёрнутое и работающее веб-приложение. Не greenfield-проект.

- **Сервер:** 82.146.61.4 (Ubuntu 24.04 LTS, пользователь `cfinadmin`)
- **Корень проекта:** `/srv/cfin`
- **Доступ:** SSH-туннель → http://127.0.0.1:3001
- **Контейнеры:** `cfin-api-1`, `cfin-db-1` (PostgreSQL 16), `cfin-web-1` (Nginx)
- **Локальный снимок кода:** `server-snapshot/`

## Технологический стек

| Слой | Технологии |
|------|-----------|
| Frontend | React 19, TypeScript, Vite 6, CSS без UI-фреймворка |
| Backend | Node.js 22, Express, TypeScript |
| Database | PostgreSQL 16 |
| Deployment | Docker + Docker Compose |
| Web frontend | Nginx внутри web-контейнера |

## Модель данных

Иерархия: `groups` → `subgroups` → `categories` → `entries`

- `users` — пользователи (login, password_hash, role)
- `sessions` — сессии (token_hash, user_id, expires_at)
- `groups` — группы статей (id, name, sort_order)
- `subgroups` — подгруппы (id, group_id, name, sort_order)
- `categories` — статьи (id, subgroup_id, name, sort_order)
- `entries` — финансовые записи (id, category_id, entry_date, direction, amount, created_by, created_at, updated_at)

Принцип: одна календарная ячейка может содержать несколько `entries`. В календаре показывается агрегированный итог, при открытии ячейки — работа с каждой записью отдельно.

## Уже реализовано (MVP)

- Авторизация по логину и паролю (cookie-сессии)
- Создание групп, подгрупп и статей
- Платёжный календарь с навигацией по месяцам
- Раздельные строки «Доход» и «Расход» для каждой статьи
- Добавление, редактирование, удаление финансовых записей
- Несколько записей в одной календарной ячейке
- Агрегирование суммы и количества записей в календаре
- PATCH/DELETE для групп, подгрупп и статей (backend готов)
- Визуальное выделение выходных и текущего дня

## Ближайший инкремент: UI v2.1

Цель — полноценное управление группами, подгруппами и статьями через собственные модальные окна, без `prompt()`/`confirm()`.

Подробнее — в `docs/requirements.md` и `docs/architecture-proposal.md`.

## Структура локальной папки

```
D:\Hermes\CFin\
├── README.md                         ← этот файл
├── docs/
│   ├── requirements.md               ← функциональные требования
│   └── architecture-proposal.md      ← архитектурное предложение
└── server-snapshot/                  ← локальная копия серверного кода
    ├── backend/
    │   ├── Dockerfile
    │   ├── package.json
    │   ├── tsconfig.json
    │   └── src/
    │       └── index.ts             ← Express API (source of truth на сервере)
    ├── frontend/
    │   ├── Dockerfile
    │   ├── index.html
    │   ├── nginx.conf
    │   ├── package.json
    │   ├── tsconfig.json
    │   └── src/
    │       ├── main.tsx             ← React-приложение
    │       └── style.css            ← стили
    ├── db/
    │   └── init.sql                  ← схема БД
    └── docker-compose.yml
```

## Правила разработки

1. **Серверная версия — source of truth.** Перед каждым инкрементом — получать актуальные файлы с сервера.
2. **Инкрементальный подход.** Небольшие завершённые изменения поверх существующего кода.
3. **Сохранять данные.** Не использовать каскадное удаление без согласования.
4. **Backup перед destructive-операциями.** `pg_dump` при риске для данных, копии файлов в `/srv/cfin/backups/`.
5. **Не выводить секреты.** `.env`, пароли, токены, SSH-ключи, session cookie — не показывать.
6. **Docker-сборка.** `docker compose build` → `docker compose up -d --no-deps` → smoke-test.
