# CFin — Server and Production Context

## Production endpoint

- Public URL: https://cfin.calypsoia.ru/
- Server IP: 82.146.61.4
- Hostname: o.sagabiev.fvds.ru
- OS: Ubuntu 24.04 LTS
- Production project root: /srv/cfin
- Admin user: cfinadmin

## SSH

Key-based SSH is used for administration. Root SSH login and password authentication were disabled during hardening.

Typical Windows PowerShell access:

```powershell
ssh -i "$env:USERPROFILE\.ssh\cfin_admin_ed25519" cfinadmin@82.146.61.4
```

Historical SSH-tunnel access existed before the public HTTPS endpoint and is no longer the primary user path.

## Existing server environment

The server already contained ISPmanager 6 Lite and related services. During CFin setup the following were intentionally kept: ssh, nginx, apache2, mysql, ihttpd/ISPmanager, fail2ban.

Historical local bindings observed during setup included Apache on 127.0.0.1:8080 and MySQL on localhost. CFin therefore used localhost port 3001 during the tunnel phase.

Unused services disabled during setup included exim4, dovecot, named/BIND, and proftpd.

Do not stop or reconfigure nginx, Apache, MySQL, or ISPmanager blindly; they may be required by the hosting control panel.

## Firewall and networking

UFW was enabled with deny-incoming / allow-outgoing policy. Historically allowed public ports included SSH, HTTP, HTTPS, and ISPmanager ports.

Docker creates its own networking rules, so Docker port publishing must be reviewed explicitly.

Architecture rule: do not expose PostgreSQL or the backend API directly to the Internet without an explicit architecture/security decision.

## Docker

CFin is deployed with Docker Compose.

Expected services:
- web
- api
- db

Observed container names:
- cfin-web-1
- cfin-api-1
- cfin-db-1

Standard status check:

```bash
cd /srv/cfin
sudo docker compose ps
```

## Environment

Production environment file: /srv/cfin/.env

Known variable names include DB_PASSWORD, ADMIN_LOGIN, ADMIN_PASSWORD, and APP_ORIGIN. Never commit or print secret values.

Because production is now served at https://cfin.calypsoia.ru/, Origin enforcement and reverse-proxy configuration must remain consistent with that endpoint.

## Database

PostgreSQL 16 is used. Core tables include users, sessions, groups, subgroups, categories, and entries.

Persistent database storage must not be removed casually.

Do not run destructive volume operations such as docker compose down -v or docker system prune --volumes without explicit approval and a verified backup.

## Backups

Backup directory: /srv/cfin/backups

Historical backups include a database dump and UI backup folders. Before risky data/schema work, create a fresh PostgreSQL dump and file backup.

## Diagnostics

```bash
sudo docker compose logs --tail=100 web
sudo docker compose logs --tail=100 api
sudo docker compose logs --tail=100 db
```

Backend health endpoint: GET /api/health, expected response {"ok":true}.

## Source of truth

Production /srv/cfin is the source of truth for deployed code and behavior. Old chat excerpts, .bak/.new files, local archives, and server-snapshot may be stale.

Before a production-relevant change: inspect production, compare with the repository snapshot, document drift, then modify code.