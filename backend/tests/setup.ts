import path from "node:path";
import dotenv from "dotenv";

const testEnvPath = path.resolve(process.cwd(), ".env.test");

dotenv.config({ path: testEnvPath, override: true });

if (process.env.DATABASE_URL_TEST && !process.env.DATABASE_URL) {
  process.env.DATABASE_URL = process.env.DATABASE_URL_TEST;
}

process.env.NODE_ENV = "test";
