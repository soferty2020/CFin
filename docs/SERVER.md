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

## Historical server sizing

Observed during initial setup:

- 2 vCPU
- about 3.7 GiB RAM
- about 1.9 GiB swap
- about 59 GiB disk

These are historical observations and must be rechecked for current capacity decisions.

## SSH hardening details

The dedicated user `cfinadmin` was added to sudo. SSH was hardened using a drop-in configuration under `/etc/ssh/sshd_config.d/`.

Confirmed settings at setup time:

```text
PermitRootLogin no
PasswordAuthentication no
KbdInteractiveAuthentication no
PubkeyAuthentication yes
```

Configuration validation was performed with `sshd -t`, and a new key-based login was tested before relying on it.

The hosting provider's VNC/console remained the emergency fallback.

## Historical tunnel configuration

Before the public domain was configured, the web container was intentionally published only to server loopback:

```text
127.0.0.1:3001 -> web:80
```

The frontend Nginx proxied `/api/` to:

```text
http://api:3000
```

PostgreSQL remained internal to the Docker network.

The loopback port was changed from the originally considered 8080 because Apache already occupied `127.0.0.1:8080`.

## ISPmanager and public ports

ISPmanager 6 Lite is installed.

Historical public ports allowed during setup:

- 22/tcp — SSH
- 80/tcp — HTTP
- 443/tcp — HTTPS
- 1500/tcp — ISPmanager
- 1501/tcp — ISPmanager

UFW was configured for both IPv4 and IPv6 with default deny incoming, allow outgoing, and deny routed.

ISPmanager also maintains its own iptables chains. Any firewall change must account for both UFW and ISPmanager-managed rules.

## Services retained and disabled

Retained because they belonged to the server/control-panel environment:

- ssh
- nginx
- apache2
- mysql
- ihttpd / ISPmanager
- fail2ban

Disabled because they were not needed for the CFin server role at setup time:

- exim4
- dovecot
- named / BIND
- proftpd

Historical local service bindings included:

- Apache on `127.0.0.1:8080`
- MySQL on `127.0.0.1:3306` and `127.0.0.1:33060`

Do not stop or reconfigure retained services without checking their relationship to ISPmanager and other hosting functions.

## Docker versions observed during setup

Historical versions:

- Docker Engine 29.1.3
- Docker Compose 2.40.3
- containerd 2.2.1

Git was also installed.

These versions are historical context; verify the current server before relying on version-specific behavior.

## Docker and UFW caveat

Docker-published ports can bypass expectations based only on UFW rules because Docker installs its own iptables chains.

The server had `DOCKER` and `DOCKER-USER` chains.

CFin security rule: do not publish the API or PostgreSQL on `0.0.0.0`. Review every new `ports:` mapping explicitly.

## Database persistence and known backup

The database uses persistent Docker storage (historically the `pgdata` volume).

A known database backup created during earlier work:

```text
/srv/cfin/backups/cfin-before-editing.dump
```

It was checked with `pg_restore -l`.

Known UI backup locations included:

```text
/srv/cfin/backups/ui-v1/
/srv/cfin/backups/ui-v2/
```

Create a new timestamped backup for new work instead of overwriting historical backups.

## Historical package-installation incident

During initial Docker installation, a stale `adduser/passwd` process held `/run/adduser` and blocked package configuration.

After the stale process was terminated, package configuration was repaired with:

```bash
sudo dpkg --configure -a
```

This is historical troubleshooting context, not an active issue.
