import { randomUUID } from "node:crypto";
import { and, eq } from "drizzle-orm";
import { db } from "~/db/client.ts";
import { oauthAccounts, users } from "~/db/schema.ts";
import { claimInvites } from "~/lib/shares.ts";
import type { GoogleClaims } from "./google.ts";

type UserRow = typeof users.$inferSelect;

function slugify(input: string): string {
  const slug = input
    .toLowerCase()
    .normalize("NFKD")
    .replace(/[̀-ͯ]/g, "") // strip combining diacritics
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 20);
  return slug || "user";
}

function generateUniqueHandle(base: string): string {
  const root = slugify(base);
  let candidate = root;
  let n = 1;
  while (db.select({ id: users.id }).from(users).where(eq(users.handle, candidate)).get()) {
    n += 1;
    candidate = `${root}-${n}`;
  }
  return candidate;
}

/**
 * Find the user linked to this Google account, or create one on first login.
 * Account linking by email across providers is deferred (M5+); we key strictly
 * on (provider, providerUserId).
 */
export function upsertGoogleUser(claims: GoogleClaims): UserRow {
  const link = db
    .select()
    .from(oauthAccounts)
    .where(
      and(
        eq(oauthAccounts.provider, "google"),
        eq(oauthAccounts.providerUserId, claims.sub),
      ),
    )
    .get();

  const email = claims.email?.toLowerCase() ?? null;

  if (link) {
    const existing = db.select().from(users).where(eq(users.id, link.userId)).get();
    if (existing) {
      // Backfill email if newly available, then claim any pending invites.
      if (email && existing.email !== email) {
        db.update(users).set({ email }).where(eq(users.id, existing.id)).run();
        existing.email = email;
      }
      claimInvites(existing);
      return existing;
    }
  }

  const id = randomUUID();
  const handleBase = claims.email?.split("@")[0] ?? claims.name ?? "user";
  const user: typeof users.$inferInsert = {
    id,
    handle: generateUniqueHandle(handleBase),
    displayName: claims.name ?? claims.email?.split("@")[0] ?? "New user",
    email,
    avatarUrl: claims.picture ?? null,
  };

  db.insert(users).values(user).run();
  db.insert(oauthAccounts)
    .values({ provider: "google", providerUserId: claims.sub, userId: id })
    .run();

  const created = db.select().from(users).where(eq(users.id, id)).get()!;
  claimInvites(created);
  return created;
}
