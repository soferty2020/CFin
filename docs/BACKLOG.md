# CFin — Backlog Map

GitHub Issues are the actionable backlog. This file is a compact index for agents.

| Priority | Issue | Stage | Depends on |
|---|---|---|---|
| P0 | #1 Production audit | Ready | — |
| P1 | #2 UI v2.1 category management | Backlog | #1 |
| P2 | #3 UI v2.2 payment calendar UX | Backlog | #2 |
| P3 | #4 Financial core v1 | Backlog | #3 |
| P4 | #5 Cash gap detection | Backlog | #4 |
| P5 | #6 Accounts and internal transfers | Backlog | #4 |
| P6 | #7 Extended payment fields | Backlog | #6 |
| P7 | #8 Structure reorder/move/archive | Backlog | #2 |
| P8 | #9 Analytics foundation | Backlog | #4, #6, #7 as relevant |

## Agent selection rule

Agents should start with the earliest dependency-complete issue whose requirements and acceptance criteria are clear.

Do not skip #1 for production-dependent work.

## Suggested status vocabulary

Until a GitHub Project board is configured, use issue comments/PR links to reflect:

- Backlog
- Ready
- In Progress
- Review
- Done
- Blocked

## Completion rule

An issue is not Done merely because code exists. It must satisfy its acceptance criteria, pass regression checks, and include deploy/rollback notes when production is affected.
