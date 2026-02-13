import { spawnSync } from "node:child_process";
import { getTestDatabaseUrl, loadTestEnvironment } from "./env";

export default async function globalSetup() {
  loadTestEnvironment();

  const databaseUrl = getTestDatabaseUrl();
  const isCi = process.env.CI === "true";
  const shouldMigrate = process.env.TEST_DB_MIGRATE !== "false";

  if (!databaseUrl) {
    if (isCi) {
      throw new Error("DATABASE_URL_TEST (or DATABASE_URL) must be set in CI test runs.");
    }
    return;
  }

  if (!shouldMigrate) {
    return;
  }

  const result = spawnSync("npx", ["prisma", "migrate", "deploy"], {
    cwd: process.cwd(),
    env: process.env,
    stdio: "inherit",
    shell: process.platform === "win32",
  });

  if (result.status !== 0) {
    throw new Error("Failed to run test database migrations via prisma migrate deploy.");
  }
}
