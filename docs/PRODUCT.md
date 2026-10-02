# CFin — Product Context

CFin is an existing production cash-flow and payment-calendar application. It is not a greenfield project.

## Core business rules

- Hierarchy: groups -> subgroups -> categories -> entries.
- A category can contain both income and expense entries; the calendar shows separate Income and Expense rows.
- One calendar cell may contain multiple entries.
- The calendar cell shows an aggregate total; opening the cell shows individual entries.
- Past dates remain editable.
- Weekend cells are visually highlighted but remain fully clickable and functional.
- Planned/expected money is maintained manually; the system must not silently move payment dates.
- The user may start mid-year by entering an opening balance for January 1 and manually filling elapsed months.
- Deletion must not silently destroy linked financial history.
- Internal transfers between company accounts are not company income or expense.
- Cash gaps should be highlighted, not automatically fixed by moving payments.

## Current entry fields

- date
- category
- direction
- amount

Planned later:
- account
- counterparty
- project
- comment

## UX direction

Dark Calypso-branded interface, compact finance dashboard, high-density calendar, clear income/expense distinction, and custom dialogs instead of browser prompt/confirm.

## Roadmap

P0 production audit.
P1 UI v2.1 category management with custom modals and safe delete.
P2 UI v2.2 calendar UX.
P3 opening and daily balances.
P4 cash-gap detection.
P5 accounts and internal transfers.
P6 extended payment fields.
P7 reorder/move/archive hierarchy.
P8 analytics.

## Detailed functional decisions

### Calendar semantics

CFin is primarily a payment calendar, not a classic plan/fact accounting screen.

Rows represent the financial hierarchy and direction; columns represent calendar days.

Past, current and future dates can contain manually entered records.

Expected money does not automatically roll forward, expire, or change dates. The user maintains the calendar manually.

"Requires attention" or similar states are visual signals only unless a future requirement explicitly adds automation.

### Multiple records in one cell

This is required from the first stage.

A cell may contain several records. The grid shows their total, while opening the cell shows the list and allows each record to be edited separately.

Do not simplify the data model to one record per cell.

### Category hierarchy

The user creates the hierarchy from scratch:

```text
Group -> Subgroup -> Category
```

Long-term structure-management requirements include:

- create
- rename
- reorder
- move
- hide/archive

A future delete workflow may offer moving dependent records to another category before removing the old one. Until such a workflow is explicitly implemented, linked data must block destructive deletion.

### Income and expense on one category

One category can contain both income and expense records.

The calendar presents these as two separate rows for the same category.

### Mid-year start

A user may adopt CFin after the year has already started.

Agreed operating model:

1. enter the opening balance for January 1;
2. manually fill the required records for elapsed months;
3. continue using the calendar normally.

CFin should not fabricate historical transactions.

### Current money and forecast direction

A previously agreed product direction is:

- current money = calculated balance at the end of yesterday;
- today is part of the forecast.

This must be confirmed when P3 is designed in detail because it affects balance semantics.

### Accounts and transfers

Accounts are planned for a later stage.

Future functionality may include:

- bank accounts
- cash
- opening balance by account
- account-linked payments
- transfers between own accounts
- overdraft or limits

Internal transfers must not be counted as company income or expense.

### Extended entry fields

Planned entry attributes beyond the current MVP:

- account
- counterparty
- project
- comment

Counterparties may later have types such as client, supplier, employee, or other.

Projects may later be client or internal projects.

Inactive counterparties and completed projects should be hidden from new selection while remaining visible in historical records.

### Structure ordering

The long-term direction includes user-controlled ordering of groups, subgroups and categories, potentially with drag-and-drop.

### Cash gaps

Cash-gap functionality should:

- identify negative forecast balances;
- show the deficit amount;
- highlight the problem date or period.

It must not automatically move or reschedule payments.

### Analytics

Analytics is intentionally later than the financial core.

Possible dimensions and views:

- income and expense by period
- expense structure
- cash-flow trend
- balance trend
- account
- counterparty
- project
- comparison of week/month/quarter/year/custom periods
- export

### Users

Expected initial usage is small, approximately two users, with at least one administrator.

Role expansion and audit trail are later concerns; do not replace the current authentication system without a specific requirement.
