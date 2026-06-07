import { mkdirSync } from "node:fs";
import { dirname } from "node:path";
import Database from "better-sqlite3";
import { drizzle } from "drizzle-orm/better-sqlite3";
import * as schema from "./schema.ts";

const dbPath = process.env.DATABASE_PATH ?? "./data/taimline.db";

// Ensure the parent directory exists (e.g. ./data) before opening the file.
mkdirSync(dirname(dbPath), { recursive: true });

const sqlite = new Database(dbPath);
// WAL improves read concurrency on a single node (see scalability plan).
sqlite.pragma("journal_mode = WAL");
sqlite.pragma("foreign_keys = ON");

export const db = drizzle(sqlite, { schema });
export { schema };
