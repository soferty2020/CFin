# CFin — Backlog Map

Последняя сверка с GitHub: **2026-10-30**.

GitHub Issues — основной рабочий backlog. Этот файл — его краткий индекс. Данные о production берутся из `docs/CURRENT_STATE.md` и должны подтверждаться отдельно; код `server-snapshot/` не означает, что функция развернута.

| Priority | Issue | Status in GitHub | Dependencies / next action |
|---|---|---|---|
| P0 | #1 Production audit | **Closed** | Завершено; сверять актуальность перед production-работами |
| P1 | #2 UI v2.1 category management | **Closed** | Завершено |
| P2 | #3 UI v2.2 calendar UX | **Closed** | Завершено в пределах критериев #3 |
| P2-follow-up | #11 Sticky group/subgroup names | **Open** | Требует решения Owner о вертикальной прокрутке |
| P3 | #4 Financial core v1 | **Open** | Уточнить остаточный scope: в server-snapshot уже есть balances |
| P4 | #5 Cash gap detection | **Open** | Зависит от подтверждённой финансовой модели и готовности #4 |
| P5 | #6 Accounts and internal transfers | **Open** | Уточнить остаточный scope: в server-snapshot уже есть accounts и account_id |
| P6 | #7 Extended payment fields | **Open** | Проверить фактическую готовность account_id; остальные поля остаются к проверке |
| P7 | #8 Structure reorder/move/archive | **Open** | После базового CRUD |
| P8 | #9 Analytics foundation | **Open** | После подтверждения финансовых расчётов и измерений |

## Другие завершённые работы

- **#10** «Статьи: выбор допустимых направлений „Доход“ и „Расход“» — **Closed**.
- **PR #16** — merged, документирован выпуск 2026-10-28 в `docs/CURRENT_STATE.md`.

## Открытые документационные pull requests

- **PR #17** — proposal `team-process v1.3`, open, not adopted. Не применять proposal к реальным агентам и настройкам без отдельного разрешения Owner.
- **PR #18** — deployment authorization guardrails, open, not merged. Его содержание не предоставляет отдельного разрешения на production-операции.

## Важное расхождение с первоначальным roadmap

В `server-snapshot/backend/src/index.ts` уже присутствуют API, связанные со счетами/остатками, и использование `account_id`. Это **не** доказывает завершение #4 или #6 и не подтверждает все production-сценарии. Перед работой над ними необходимо провести read-only сверку:

1. Какие API и поля реально присутствуют в running production;
2. Есть ли таблицы, миграции и пользовательские экраны;
3. Какие критерии #4 и #6 уже покрыты;
4. Какие остаются невыполненными и какими тестами это подтверждается.

Результат — уточнить scopes соответствующих issues; не создавать новую параллельную модель счетов.

## Правило выбора следующей задачи

Приоритетное следующее действие: согласовать вертикальное поведение для **#11**, затем реализовать его после явного старта работы. Параллельно допустим read-only анализ остаточного scope #4/#6 без production-изменений.

## Workflow

Backlog → Ready → In Progress → Review → Done; Blocked для неразрешённых зависимостей. Наличие кода само по себе не означает Done.

Любая production-операция требует отдельного разрешения Owner на конкретный релиз и установленного порядка backup, проверки и rollback. Чтение документации или закрытие issue не являются разрешением на deploy.
