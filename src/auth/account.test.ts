import { rmSync } from "node:fs";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

// DB-backed test for cross-provider account linking by verified email.
const DB = `./data/test-account-${Date.now()}.db`;
process.env.DATABASE_PATH = DB;

let account: typeof import("./account.ts");
let countLinks: (userId: string) => number;

beforeAll(async () => {
  const { migrate } = await import("drizzle-orm/better-sqlite3/migrator");
  const { eq } = await import("drizzle-orm");
  const { db } = await import("./../db/client.ts");
  migrate(db, { migrationsFolder: "./src/db/migrations" });
  const schema = await import("./../db/schema.ts");
  account = await import("./account.ts");
  countLinks = (userId: string) =>
    db.select().from(schema.oauthAccounts).where(eq(schema.oauthAccounts.userId, userId)).all().length;
});

afterAll(() => {
  for (const s of ["", "-shm", "-wal"]) try { rmSync(DB + s); } catch {}
});

describe("cross-provider linking by verified email", () => {
  it("links a second provider to the same user when the verified email matches", () => {
    const g = account.upsertGoogleUser({ sub: "g-1", email: "Sam@Example.com", emailVerified: true, name: "Sam" });
    const o = account.upsertOidcUser({ sub: "o-1", email: "sam@example.com", emailVerified: true, name: "Sam" });

    expect(o.id).toBe(g.id); // same account, not a duplicate
    expect(countLinks(g.id)).toBe(2); // google + oidc both linked
  });

  it("returns the same user (via the existing link) on a repeat OIDC login", () => {
    const again = account.upsertOidcUser({ sub: "o-1", email: "sam@example.com", emailVerified: true, name: "Sam" });
    const g = account.upsertGoogleUser({ sub: "g-1", email: "sam@example.com", emailVerified: true });
    expect(again.id).toBe(g.id);
    expect(countLinks(g.id)).toBe(2); // no extra link created
  });

  it("does NOT link when the incoming email is explicitly unverified", () => {
    const a = account.upsertGoogleUser({ sub: "g-2", email: "kim@example.com", emailVerified: true, name: "Kim" });
    const b = account.upsertOidcUser({ sub: "o-2", email: "kim@example.com", emailVerified: false, name: "Kim" });
    expect(b.id).not.toBe(a.id); // separate account — no takeover via unverified email
  });

  it("creates a fresh user when no email matches", () => {
    const a = account.upsertOidcUser({ sub: "o-3", email: "new@example.com", emailVerified: true, name: "New" });
    expect(countLinks(a.id)).toBe(1);
  });
});
