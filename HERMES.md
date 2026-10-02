# Hermes — CFin entry point

This repository is an existing production application, not a greenfield task.

## Start here

Before changing code:

1. Read `AGENTS.md`.
2. Read `docs/PROJECT_CONTEXT.md`.
3. Read `docs/CURRENT_STATE.md`.
4. Read `docs/PRODUCT.md`.
5. Read `docs/SERVER.md` if production/server behavior matters.
6. Read `ROADMAP.md` and `docs/BACKLOG.md`.
7. Open the earliest dependency-complete GitHub Issue.
8. Verify production state whenever the issue depends on deployed behavior.

## Current first task

Issue #1 is the production audit. Do not skip it for production-dependent work.

After #1, proceed through the issue dependency chain rather than inventing a new roadmap.

## Rules

- Production `/srv/cfin` is the deployed source of truth.
- Preserve existing data.
- Do not recreate the app.
- Keep scope bounded to the selected issue.
- Do not expose secrets.
- Use PR/review/build/smoke-test discipline.
- Update `docs/CURRENT_STATE.md` when confirmed production facts change.

## Primary production URL

https://cfin.calypsoia.ru/
