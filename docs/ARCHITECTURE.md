# CFin — Architecture

## Deployed stack

| Layer | Technology |
|---|---|
| Frontend | React 19 + TypeScript + Vite 6 |
| Styling | CSS |
| Backend | Node.js 22 + Express + TypeScript |
| Database | PostgreSQL 16 |
| Web | Nginx |
| Deployment | Docker Compose |

## Production structure

```text
/srv/cfin/
  backend/
  frontend/
  db/
  backups/
  docker-compose.yml
  .env
```

## Core model

```text
groups
  -> subgroups
    -> categories
      -> entries
```

Core supporting tables also include users and sessions.

Referential integrity is intentionally restrictive. Financial history must not be silently cascade-deleted.

## API areas

- health
- auth
- categories hierarchy
- entries
- calendar aggregation

Mutation requests use Origin protection in the deployed backend design.

## Frontend shape

The current frontend is a compact single-page React application with two primary areas:
- payment calendar;
- category hierarchy management.

The calendar aggregates multiple entries per category/date/direction cell. Opening a cell exposes individual records.

## Deployment boundaries

- public traffic terminates through the production web/reverse-proxy path;
- frontend serves the application and proxies /api to the backend;
- API should not be directly public;
- PostgreSQL should not be directly public;
- production /srv/cfin remains the deployed source of truth.

## Change strategy

Do not replace the current stack without an explicit architecture decision. Prefer incremental changes that preserve the working MVP.

## Related documents

- docs/architecture-proposal.md — earlier detailed architecture snapshot;
- docs/SERVER.md — server and networking context;
- docs/PRODUCT.md — business rules;
- docs/CURRENT_STATE.md — verified current state;
- docs/DEPLOYMENT.md — deploy/rollback workflow.