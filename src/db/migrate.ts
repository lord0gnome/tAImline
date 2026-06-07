import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { migrate } from "drizzle-orm/better-sqlite3/migrator";
import { db } from "./client.ts";

// Runs all pending migrations. Used by `npm run db:migrate` (dev) and the
// Kubernetes init container (prod) — keeps drizzle-kit out of the runtime image.
const migrationsFolder = join(
  dirname(fileURLToPath(import.meta.url)),
  "migrations",
);

migrate(db, { migrationsFolder });
console.log("migrations applied");
