import { randomUUID } from "node:crypto";
import { and, eq } from "drizzle-orm";
import { db } from "~/db/client.ts";
import { oauthAccounts, users } from "~/db/schema.ts";
import { claimInvites } from "~/lib/shares.ts";
import type { GoogleClaims } from "./google.ts";
import type { OidcClaims } from "./oidc.ts";

type UserRow = typeof users.$inferSelect;

/** Normalized identity used to link/create a user across OAuth/OIDC providers. */
interface OAuthIdentity {
  provider: string;
  providerUserId: string;
  email?: string | null;
  /** Whether the IdP reports the email as verified. Linking by email is only
   *  done when this isn't explicitly false (prevents account takeover via an
   *  unverified address). */
  emailVerified?: boolean;
  name?: string | null;
  picture?: string | null;
  /** Seed for the auto-generated handle (e.g. preferred_username). */
  handleSeed?: string | null;
}

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
 * Resolve the user for an OAuth/OIDC identity, or create one on first login.
 * Resolution order:
 *   1. existing (provider, providerUserId) link — a returning account;
 *   2. else link to an existing user with the SAME verified email — so the same
 *      person signing in through a different provider (e.g. Google then
 *      Authentik) lands on one account instead of a duplicate;
 *   3. else create a fresh user.
 * Email linking is skipped when the IdP marks the email unverified, to avoid
 * takeover via an attacker-controlled address.
 */
function upsertOAuthUser(identity: OAuthIdentity): UserRow {
  const { provider, providerUserId } = identity;
  const email = identity.email?.toLowerCase() ?? null;

  const link = db
    .select()
    .from(oauthAccounts)
    .where(and(eq(oauthAccounts.provider, provider), eq(oauthAccounts.providerUserId, providerUserId)))
    .get();

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

  // No link yet for this (provider, sub): attach to an existing user that owns
  // this verified email, rather than creating a duplicate account.
  if (email && identity.emailVerified !== false) {
    const byEmail = db.select().from(users).where(eq(users.email, email)).get();
    if (byEmail) {
      db.insert(oauthAccounts).values({ provider, providerUserId, userId: byEmail.id }).run();
      if (!byEmail.avatarUrl && identity.picture) {
        db.update(users).set({ avatarUrl: identity.picture }).where(eq(users.id, byEmail.id)).run();
      }
      claimInvites(byEmail);
      return db.select().from(users).where(eq(users.id, byEmail.id)).get()!;
    }
  }

  const id = randomUUID();
  const handleBase = identity.handleSeed ?? email?.split("@")[0] ?? identity.name ?? "user";
  const user: typeof users.$inferInsert = {
    id,
    handle: generateUniqueHandle(handleBase),
    displayName: identity.name ?? email?.split("@")[0] ?? "New user",
    email,
    avatarUrl: identity.picture ?? null,
  };

  db.insert(users).values(user).run();
  db.insert(oauthAccounts).values({ provider, providerUserId, userId: id }).run();

  const created = db.select().from(users).where(eq(users.id, id)).get()!;
  claimInvites(created);
  return created;
}

export function upsertGoogleUser(claims: GoogleClaims): UserRow {
  return upsertOAuthUser({
    provider: "google",
    providerUserId: claims.sub,
    email: claims.email,
    emailVerified: claims.emailVerified,
    name: claims.name,
    picture: claims.picture,
  });
}

export function upsertOidcUser(claims: OidcClaims): UserRow {
  return upsertOAuthUser({
    provider: "oidc",
    providerUserId: claims.sub,
    email: claims.email,
    emailVerified: claims.emailVerified,
    name: claims.name,
    picture: claims.picture,
    handleSeed: claims.preferredUsername,
  });
}
