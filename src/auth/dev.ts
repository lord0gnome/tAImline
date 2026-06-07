import { eq } from "drizzle-orm";
import { db } from "~/db/client.ts";
import { users } from "~/db/schema.ts";

// Dev-only login shortcut for local iteration. STRICTLY gated on DEV_LOGIN=1;
// this env var must NEVER be set in the cluster (it would let anyone sign in as
// the dev user). The /auth/dev endpoint 404s unless this returns true.
export function devLoginEnabled(): boolean {
  return process.env.DEV_LOGIN === "1";
}

const DEV_USER_ID = "dev-user";

type UserRow = typeof users.$inferSelect;

export function getOrCreateDevUser(): UserRow {
  const existing = db.select().from(users).where(eq(users.id, DEV_USER_ID)).get();
  if (existing) return existing;
  db.insert(users)
    .values({
      id: DEV_USER_ID,
      handle: "dev",
      displayName: "Dev User",
      defaultVisibility: "private",
    })
    .run();
  return db.select().from(users).where(eq(users.id, DEV_USER_ID)).get()!;
}
