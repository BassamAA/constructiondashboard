import path from "node:path";
import dotenv from "dotenv";

let loaded = false;

export function loadTestEnvironment() {
  if (loaded) {
    return;
  }

  const testEnvPath = path.resolve(process.cwd(), ".env.test");
  dotenv.config({ path: testEnvPath, override: true, quiet: true });

  if (process.env.DATABASE_URL_TEST) {
    process.env.DATABASE_URL = process.env.DATABASE_URL_TEST;
  }

  process.env.NODE_ENV = "test";
  loaded = true;
}

export function getTestDatabaseUrl() {
  return process.env.DATABASE_URL;
}
