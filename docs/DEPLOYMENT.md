# CFin — Deployment

## Production

- URL: https://cfin.calypsoia.ru/
- Project root: `/srv/cfin`
- Deployment: Docker Compose
- Database: PostgreSQL 16

Production is the source of truth for deployed behavior.

## Standard deploy workflow

1. Verify the production version relevant to the issue.
2. Back up changed files.
3. If data/schema are at risk, create a PostgreSQL dump.
4. Build only affected services.
5. Restart only affected services.
6. Check container status and logs.
7. Run smoke tests on production HTTPS URL.

## Frontend

```bash
cd /srv/cfin
sudo docker compose build web
sudo docker compose up -d --no-deps web
sudo docker compose ps
```

## Backend

```bash
cd /srv/cfin
sudo docker compose build api
sudo docker compose up -d --no-deps api
sudo docker compose ps
```

## Frontend + backend

```bash
cd /srv/cfin
sudo docker compose build api web
sudo docker compose up -d --no-deps api web
sudo docker compose ps
```

## Logs

```bash
sudo docker compose logs --tail=100 web
sudo docker compose logs --tail=100 api
sudo docker compose logs --tail=100 db
```

## Health check

Backend exposes `GET /api/health`.

## Smoke test

At minimum:
- login;
- open calendar;
- navigate months;
- open a calendar cell;
- create/edit/delete an entry;
- verify existing data remains;
- verify weekend cells remain clickable;
- verify category management after related changes.

## Never run without explicit approval

- `docker compose down -v`
- deleting Docker volumes
- `docker system prune --volumes`
- destructive database reset
- cascade deletion of financial history

## Secrets

Do not commit or expose:
- `.env`
- passwords
- private SSH keys
- session cookies
- secret tokens
