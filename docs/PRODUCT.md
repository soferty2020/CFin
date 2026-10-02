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