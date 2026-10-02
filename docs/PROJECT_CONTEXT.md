# CFin — Project Handoff Context

## Important

CFin is an existing production application. Do not start a new project, replace the stack, or regenerate the application from scratch.

The application has already been designed to MVP level, deployed on an Ubuntu server, containerized with Docker Compose, connected to PostgreSQL, and exposed at https://cfin.calypsoia.ru/.

## Production

- URL: https://cfin.calypsoia.ru/
- Server: 82.146.61.4
- Hostname: o.sagabiev.fvds.ru
- Project root: /srv/cfin
- Linux user: cfinadmin

Detailed operational context: docs/SERVER.md

## Stack

- Frontend: React 19, TypeScript, Vite 6, CSS
- Backend: Node.js 22, Express, TypeScript
- Database: PostgreSQL 16
- Web: Nginx
- Deployment: Docker Compose

## Current MVP

- login and server-side sessions
- groups / subgroups / categories
- payment calendar
- separate income and expense rows
- multiple entries in one calendar cell
- create/edit/delete financial entries
- aggregated cell totals
- month navigation
- PostgreSQL persistence
- production HTTPS access

## Data hierarchy

groups -> subgroups -> categories -> entries

One cell may contain multiple entries. This is a product invariant.

## Product rules

See docs/PRODUCT.md and docs/requirements.md.

Key rules:
- weekends remain clickable and functional;
- past dates remain editable;
- linked financial history must not be silently deleted;
- planned money must not be automatically moved;
- internal transfers between own accounts are not company income/expense;
- cash gaps should be surfaced, not auto-fixed.

## Development source of truth

Production behavior and current files in /srv/cfin outrank stale local snapshots, old archives, .bak/.new files, and old chat snippets.

Before production-relevant work, verify current deployed state.

## Agent workflow

1. Read AGENTS.md.
2. Read docs/CURRENT_STATE.md.
3. Read ROADMAP.md.
4. Read the selected GitHub Issue.
5. Verify production if the issue depends on deployed behavior.
6. Implement the smallest complete increment.
7. Build/type-check and run regression checks.
8. Prepare deploy and rollback notes.
9. Deploy carefully and smoke-test production.
10. Update the issue and CURRENT_STATE if facts changed.

## Current roadmap

P0 production audit.
P1 UI v2.1 category management.
P2 UI v2.2 calendar UX.
P3 opening and daily balances.
P4 cash-gap detection.
P5 accounts and internal transfers.
P6 extended payment fields.
P7 hierarchy reorder/move/archive.
P8 analytics.

## User working preference

Prefer complete modified files, patches, or deployable changes. Avoid asking the user to manually splice large code fragments when a complete patch can be prepared.

## Security

Never expose .env contents, database credentials, private SSH keys, session cookies, or secret tokens.