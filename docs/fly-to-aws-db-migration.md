# Fly To AWS DB Migration

Use this runbook to migrate the existing Fly Postgres database into AWS RDS with a controlled cutover.

## Migration strategy

- keep Fly as the current live environment
- restore a copy into AWS staging first
- validate application behavior on AWS
- perform a short cutover window for final sync
- keep Fly available as rollback for a limited period

## Prerequisites

- Fly database connection string
- AWS RDS endpoint and credentials
- local `pg_dump`, `pg_restore`, and `psql`
- schema parity confirmed through Prisma migrations

## 1) Export from Fly

```bash
pg_dump \
  --format=custom \
  --no-owner \
  --no-privileges \
  --dbname="$FLY_DATABASE_URL" \
  --file=fly-backup.dump
```

## 2) Restore into AWS RDS staging

```bash
pg_restore \
  --no-owner \
  --no-privileges \
  --clean \
  --if-exists \
  --dbname="$AWS_STAGING_DATABASE_URL" \
  fly-backup.dump
```

## 3) Apply migrations against AWS staging

```bash
cd backend
DATABASE_URL="$AWS_STAGING_DATABASE_URL" npx prisma migrate deploy
```

## 4) Validate data

- compare row counts on critical tables
- test login flow
- test one write path and one read/reporting path
- confirm `/ready` passes

## 5) Production cutover

During a short maintenance window:

1. pause writes to Fly if possible
2. take a fresh final dump
3. restore into AWS production RDS
4. run `prisma migrate deploy`
5. point production app to AWS

## 6) Rollback window

- keep Fly database and app available for at least 2 to 4 weeks
- do not destroy Fly resources immediately after cutover
- if severe issues appear, redeploy previous app target and route traffic back

## 7) Evidence to keep for portfolio

- migration commands used
- validation checklist
- before/after architecture note
- cutover timestamp
- rollback plan
