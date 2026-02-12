#!/usr/bin/env node

/**
 * Release helper that clears the previously failed migration
 * before running `prisma migrate deploy`.
 */

const { spawnSync } = require('child_process');
const { PrismaClient } = require('@prisma/client');
const fs = require('fs');
const path = require('path');

const TARGET_MIGRATION = '20251113142720_add_manual_balance_overrides';

const prisma = new PrismaClient();

async function hasFailedMigration() {
  try {
    const rows = await prisma.$queryRaw`
      SELECT migration_name
      FROM "_prisma_migrations"
      WHERE migration_name = ${TARGET_MIGRATION}
        AND finished_at IS NULL
        AND rolled_back_at IS NULL
      LIMIT 1
    `;
    return rows.length > 0;
  } catch (err) {
    // The table does not exist on a brand new database.
    if (err.code === 'P2010' || err.code === '42P01') {
      return false;
    }
    throw err;
  }
}

function runCommand(cmd, args) {
  const result = spawnSync(cmd, args, { stdio: 'inherit', env: process.env });
  if (result.error) {
    throw result.error;
  }
  if (result.status !== 0) {
    process.exit(result.status ?? 1);
  }
}

async function main() {
  verifyMigrationFiles();
  const needsResolve = await hasFailedMigration();
  if (needsResolve) {
    console.log(
      `Detected failed migration ${TARGET_MIGRATION}. Marking it as rolled back before re-running deploy...`,
    );
    runCommand('npx', ['prisma', 'migrate', 'resolve', '--rolled-back', TARGET_MIGRATION]);
  } else {
    console.log('No failed migrations detected, running deploy normally...');
  }

  runCommand('npx', ['prisma', 'migrate', 'deploy']);
}

main()
  .catch((err) => {
    console.error('Release migration helper failed:', err);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });

function verifyMigrationFiles() {
  const migrationsDir = path.join(process.cwd(), 'prisma', 'migrations');
  if (!fs.existsSync(migrationsDir)) {
    throw new Error(`Migrations directory missing at ${migrationsDir}`);
  }

  const missing = [];
  for (const entry of fs.readdirSync(migrationsDir)) {
    const fullPath = path.join(migrationsDir, entry);
    if (!fs.statSync(fullPath).isDirectory()) {
      continue;
    }
    const migrationFile = path.join(fullPath, 'migration.sql');
    if (!fs.existsSync(migrationFile)) {
      missing.push(path.relative(process.cwd(), migrationFile));
    }
  }

  if (missing.length > 0) {
    throw new Error(
      `The following migration files are missing in the container:\n${missing.join('\n')}`,
    );
  }
}
