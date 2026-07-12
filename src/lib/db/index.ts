import { drizzle } from "drizzle-orm/postgres-js";
import postgres from "postgres";

import * as schema from "./schema";

const connectionString = process.env.DATABASE_URL;

// Next.js reloads server modules frequently in development. Retain one pooled
// postgres client across those reloads so debug switching and smoke tests do
// not consume a connection per module evaluation.
const databaseGlobal = globalThis as typeof globalThis & { postpilotDbClient?: ReturnType<typeof postgres> };
const client = connectionString
  ? (databaseGlobal.postpilotDbClient ??= postgres(connectionString, { prepare: false, max: 10 }))
  : null;

export const db = client ? drizzle(client, { schema }) : null;

export function getDb() {
  if (!db) {
    throw new Error("DATABASE_URL must be configured before database access.");
  }

  return db;
}
