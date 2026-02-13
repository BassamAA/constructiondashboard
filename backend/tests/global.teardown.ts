import { getTestDatabaseUrl, loadTestEnvironment } from "./env";

export default async function globalTeardown() {
  loadTestEnvironment();

  const databaseUrl = getTestDatabaseUrl();
  const isCi = process.env.CI === "true";
  const shouldTeardown = process.env.TEST_DB_TEARDOWN === "true" || isCi;

  if (!databaseUrl || !shouldTeardown) {
    return;
  }

  const { default: prisma } = await import("../src/prismaClient");

  try {
    const tables = await prisma.$queryRaw<Array<{ tablename: string }>>`
      SELECT tablename
      FROM pg_tables
      WHERE schemaname = 'public'
      AND tablename <> '_prisma_migrations'
    `;

    if (tables.length === 0) {
      return;
    }

    const tableList = tables
      .map((row) => `"public"."${row.tablename.replace(/"/g, '""')}"`)
      .join(", ");

    await prisma.$executeRawUnsafe(`TRUNCATE TABLE ${tableList} RESTART IDENTITY CASCADE`);
  } finally {
    await prisma.$disconnect();
  }
}
