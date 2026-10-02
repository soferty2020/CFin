# CFin — Confirmed Decisions

This file captures durable decisions from the project history. If a newer explicit requirement conflicts with one of these, update this file and the relevant issue/document.

## Product

- CFin is primarily a payment calendar / cash-flow management system.
- The hierarchy is Group -> Subgroup -> Category.
- A category can contain both income and expense entries.
- Income and Expense are shown as separate calendar rows.
- One calendar cell may contain multiple independent entries.
- The cell displays the aggregate total; each entry remains individually editable.
- Past dates remain editable.
- Weekend days are visually highlighted but remain fully functional.
- Planned/expected money is maintained manually and is not automatically moved to another date.
- Cash gaps are surfaced visually; CFin does not automatically reschedule payments.
- A user may begin mid-year by entering an opening balance for January 1 and manually filling required elapsed months.
- Internal transfers between company-owned accounts are not company income or expense.
- Linked financial history must not be silently cascade-deleted.

## UX

- Dark Calypso-branded interface.
- Prefer custom React dialogs to browser prompt()/confirm().
- Keep the calendar dense and operationally efficient.
- Visual styling must not disable financial actions on weekends.

## Engineering

- Production /srv/cfin is the source of truth for deployed behavior.
- Development is incremental; do not recreate the application.
- Preserve the current React/TypeScript, Node/Express, PostgreSQL and Docker Compose stack unless an explicit architecture decision changes it.
- Prefer deployable patches/complete files over asking the user to manually splice large code fragments.
- Backup before risky changes.
- Never expose .env contents, credentials, private SSH keys, session cookies or secret tokens.

## Future direction

- Initial and daily balances.
- Forecast and cash-gap detection.
- Accounts and internal transfers.
- Extended entry fields: account, counterparty, project, comment.
- Reorder/move/archive hierarchy.
- Analytics and export.
