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
- A user may begin mid-year by manually attesting effective dates and signed opening amounts per account and filling required elapsed months; an undated legacy opening is not silently adopted.
- Internal transfers between company-owned accounts are not company income or expense.
- All entered operations count once on their stored date, including future-month entries; no execution-status classification or overdue exclusion is inferred. End-of-yesterday is current; today onward is forecast. The server business timezone is Asia/Novosibirsk.
- A company balance is the sum of per-account balances; if inventory, openings, account allocation, historical transfer classification or reset reconciliation is unresolved, the trusted total is incomplete/null rather than an invented zero. New transfers have two equal/opposite account legs; legacy paired legs are linked by manual review without rewriting or double-counting history.
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
