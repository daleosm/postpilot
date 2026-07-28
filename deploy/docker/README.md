# Docker Compose

Use this path for local development, an internal proof of concept, or a
single-host installation that is operated and backed up by the facility. It
does not provide automatic host, database, or availability-zone failover.

## Start

```bash
cd deploy/docker
cp .env.example .env
# Set unique POSTGRES_PASSWORD and POSTPILOT_SESSION_SECRET values.
docker compose up --build -d
```

Open [http://localhost:5000](http://localhost:5000).

Migrations run once in the `migrate` container before the API starts. Inspect
them with:

```bash
docker compose logs migrate
docker compose logs -f api web
```

## Disposable demo data

The normal Compose stack never creates demo accounts. To load the fictional
demo workspace into a disposable database only:

```bash
docker compose --profile demo run --rm demo-seed
```

This seed replaces its own known demo records. Never run it against a facility
database.

## Before an internet-facing use

- Put the `web` service behind an HTTPS reverse proxy and set
  `POSTPILOT_FRONTEND_ORIGINS` to that exact HTTPS origin.
- Set `POSTPILOT_COOKIE_SECURE=true` in the API environment.
- Keep `.env` outside Git and use a secret manager where available.
- Back up the PostgreSQL volume and test a restore.
- Run one host only if its downtime is acceptable.

For a two-AZ AWS topology, use [`../eks-ha/`](../eks-ha/README.md) instead.
