# CFin — Архитектура (фактическая)

## 1. Фактический технологический стек (развёрнутый)

| Слой | Технология | Причина |
|------|-----------|---------|
| Frontend | **React 19 + TypeScript + Vite 6** | Уже работает. Один файл `main.tsx` — весь UI. |
| Стили | **Чистый CSS** (`style.css`), без UI-фреймворка | Полный контроль над тёмной темой; минимум зависимостей. |
| Backend | **Node.js 22 + Express + TypeScript** | Уже работает. Один файл `index.ts` — весь API. |
| Database | **PostgreSQL 16** (Docker) | Уже работает. Схема в `db/init.sql`. |
| Web-сервер | **Nginx** (внутри frontend-контейнера) | Раздаёт статику, проксирует `/api/` на `api:3000`. |
| Auth | **Cookie-сессии** (`cfin_session`, HttpOnly, Secure) | Собственная реализация, scrypt-хэширование паролей. |
| ORM | **Нет** — голый `pg.Pool` | Уже работает; для текущего объёма достаточно. |

> **Не менять стек без отдельного решения.** Серверная версия — source of truth.

---

## 2. Фактическая структура проекта (на сервере)

```
/srv/cfin/
├── backend/
│   ├── Dockerfile
│   ├── package.json          # express, pg, @types/*
│   ├── tsconfig.json         # ES2022, NodeNext, strict
│   └── src/
│       └── index.ts          # весь backend в одном файле
├── frontend/
│   ├── Dockerfile
│   ├── index.html
│   ├── nginx.conf            # proxy /api/ → api:3000
│   ├── package.json          # react 19, vite 6, typescript
│   ├── tsconfig.json         # ES2022, Bundler, jsx: react-jsx
│   └── src/
│       ├── main.tsx          # весь frontend в одном файле
│       └── style.css         # все стили
├── db/
│   └── init.sql              # схема БД
├── backups/
├── docker-compose.yml
├── .env
└── README.md
```

---

## 3. Фактическая модель данных

### Схема БД (`db/init.sql`)

```sql
users       (id uuid PK, login text UNIQUE, password_hash text, role text CHECK IN ('admin','user'))
sessions    (token_hash text PK, user_id uuid FK→users CASCADE, expires_at timestamptz)
groups      (id uuid PK, name text, sort_order int DEFAULT 0)
subgroups   (id uuid PK, group_id uuid FK→groups RESTRICT, name text, sort_order int DEFAULT 0)
categories  (id uuid PK, subgroup_id uuid FK→subgroups RESTRICT, name text, sort_order int DEFAULT 0)
entries     (id uuid PK, category_id uuid FK→categories RESTRICT, entry_date date,
             direction text CHECK IN ('income','expense'), amount numeric(18,2) CHECK(>0),
             created_by uuid FK→users, created_at timestamptz DEFAULT now(), updated_at timestamptz DEFAULT now())
```

Индекс: `entries_cell_idx ON entries(entry_date, category_id, direction)`

### Иерархия справочников

```
groups
  └── subgroups (group_id → groups.id, ON DELETE RESTRICT)
        └── categories (subgroup_id → subgroups.id, ON DELETE RESTRICT)
              └── entries (category_id → categories.id, ON DELETE RESTRICT)
```

Защита при удалении:
- Группу нельзя удалить, если есть подгруппы.
- Подгруппу нельзя удалить, если есть статьи.
- Статью нельзя удалить, если есть записи.
- Backend проверяет зависимости и возвращает 409 с понятным сообщением.

---

## 4. Текущий API (`backend/src/index.ts`)

| Метод | Путь | Назначение |
|-------|------|-----------|
| GET | /api/health | Health check |
| POST | /api/auth/login | Вход (login + password → cookie) |
| POST | /api/auth/logout | Выход (удаление сессии) |
| GET | /api/auth/me | Текущий пользователь |
| GET | /api/categories | Дерево groups + subgroups + categories |
| POST | /api/categories/:kind | Создание (kind = groups \| subgroups \| categories) |
| PATCH | /api/categories/:kind/:id | Переименование |
| DELETE | /api/categories/:kind/:id | Удаление (с проверкой зависимостей) |
| GET | /api/entries?date=&categoryId=&direction= | Записи в ячейке |
| POST | /api/entries | Создание записи |
| PATCH | /api/entries/:id | Редактирование записи |
| DELETE | /api/entries/:id | Удаление записи |
| GET | /api/calendar?month=YYYY-MM | Агрегированные суммы по ячейкам месяца |

Безопасность:
- Origin-проверка на POST/PUT/PATCH/DELETE (`APP_ORIGIN`).
- Cookie `cfin_session` (HttpOnly, Secure, SameSite=Strict, Max-Age=43200).
- Пароли: scrypt с солью, timingSafeEqual.
- Все маршруты кроме `/api/health` и `/api/auth/login` — под `auth` middleware.

---

## 5. Текущий UI (`frontend/src/main.tsx`)

Одностраничное приложение, две страницы:

1. **Платёжный календарь** — таблица: строки = статьи (с разделением Доход/Расход), столбцы = дни месяца. Клик по ячейке → модальное окно с записями. Выходные визуально выделены. Текущий день — рамка `.today`.

2. **Статьи** — дерево groups → subgroups → categories с кнопками создания, переименования, удаления.

**Проблема:** создание/переименование/удаление групп, подгрупп и статей использует `prompt()` и `confirm()` — нативные диалоги браузера. Это и есть цель инкремента UI v2.1.

---

## 6. Что нужно для UI v2.1

### Цель
Заменить `prompt()`/`confirm()` на собственные модальные окна для управления группами, подгруппами и статьями.

### Backend — уже готов
PATCH `/api/categories/:kind/:id` и DELETE `/api/categories/:kind/:id` уже реализованы в `index.ts` (строки 75–137). Фронтенд уже вызывает их (функции `renameCategory` и `deleteCategory`), но через `prompt()`/`confirm()`.

### Frontend — что менять
В `main.tsx` нужно заменить:

1. **`create()`** (стр. 20) — `prompt()` → модальное окно с полем ввода.
2. **`renameCategory()`** (стр. 18) — `prompt()` → модальное окно с предзаполненным полем.
3. **`deleteCategory()`** (стр. 19) — `confirm()` → модальное окно подтверждения с обработкой 409.

### Компоненты для добавления
- `Modal` — переиспользуемый оверлей с контентом (уже есть CSS `.overlay` + `.modal`).
- `PromptModal` — модальное окно с текстовым полем (для создания и переименования).
- `ConfirmModal` — модальное окно подтверждения (для удаления), с показом ошибки от сервера.

### Что НЕ менять
- Модель данных, API, авторизацию, календарь, записи.
- Backend — уже готов.
- `style.css` — добавить минимальные стили для новых модальных элементов, если нужно.

---

## 7. Дальнейшая эволюция (после UI v2.1)

| Инкремент | Содержание |
|-----------|------------|
| UI v2.2 | Улучшение календаря: компактная сетка, маркеры доходов/расходов, текущий день |
| Финансовая логика v1 | Начальный остаток, ежедневные остатки, текущие деньги, прогноз |
| Переводы | Операция «Перевод» между счетами (не доход/расход) |
| Кассовые разрывы | Определение по общему остатку компании |
| Регулярные операции | Повторяющиеся записи: «только эта дата / все будущие» |
| Аналитика | По статьям, контрагентам, проектам, счетам; сравнение периодов |
| Экспорт | Календарь и отчёты в Excel |
| Контрагенты | Справочник с типом: клиент, поставщик, сотрудник, другое |
| Проекты | Справочник с типом: клиентский / внутренний |
| Drag-and-drop | Порядок групп, подгрупп, статей |
