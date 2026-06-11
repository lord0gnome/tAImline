import { createHash } from "node:crypto";
import { eq } from "drizzle-orm";
import { db } from "~/db/client.ts";
import { users } from "~/db/schema.ts";
import { getOidcConfig, oidcEnabled } from "~/lib/oidcConfig.ts";
import { upsertOidcUser } from "./account.ts";
import { discover } from "./oidc.ts";

type UserRow = typeof users.$inferSelect;

/**
 * Validate a bearer access token issued by the configured OIDC provider (e.g.
 * Authentik) via RFC 7662 introspection, and map it to the local user. This is
 * what lets each Open WebUI user drive the MCP server as themselves: Open WebUI
 * runs an OAuth flow per user and forwards that user's access token, which we
 * introspect here. Returns null for anything not active/resolvable.
 */

interface Introspection {
  active: boolean;
  sub?: string;
  email?: string;
  emailVerified?: boolean;
  name?: string;
  preferredUsername?: string;
  iss?: string;
  exp?: number;
}

/** Normalize a raw RFC 7662 introspection response. Pure — unit-tested. */
export function parseIntrospection(raw: Record<string, unknown>): Introspection {
  return {
    active: raw.active === true,
    sub: typeof raw.sub === "string" ? raw.sub : undefined,
    email: typeof raw.email === "string" ? raw.email : undefined,
    emailVerified: typeof raw.email_verified === "boolean" ? raw.email_verified : undefined,
    name: typeof raw.name === "string" ? raw.name : undefined,
    preferredUsername: typeof raw.preferred_username === "string" ? raw.preferred_username : undefined,
    iss: typeof raw.iss === "string" ? raw.iss : undefined,
    exp: typeof raw.exp === "number" ? raw.exp : undefined,
  };
}

// Cache token → resolved user for a short window so a burst of JSON-RPC calls
// in one chat turn doesn't introspect on every message. Keyed by token hash.
const cache = new Map<string, { userId: string; expiresAt: number }>();
const MAX_CACHE_MS = 60_000;
const hash = (t: string) => createHash("sha256").update(t).digest("hex");

function cacheGet(token: string): UserRow | null {
  const hit = cache.get(hash(token));
  if (!hit) return null;
  if (Date.now() >= hit.expiresAt) {
    cache.delete(hash(token));
    return null;
  }
  return db.select().from(users).where(eq(users.id, hit.userId)).get() ?? null;
}

export async function validateOidcAccessToken(token: string): Promise<UserRow | null> {
  if (!token || !oidcEnabled()) return null;

  const cached = cacheGet(token);
  if (cached) return cached;

  const cfg = getOidcConfig()!;
  let info: Introspection;
  try {
    const doc = await discover(cfg.issuer!);
    if (!doc.introspection_endpoint) return null; // provider can't introspect
    const res = await fetch(doc.introspection_endpoint, {
      method: "POST",
      headers: { "content-type": "application/x-www-form-urlencoded", accept: "application/json" },
      body: new URLSearchParams({
        token,
        token_type_hint: "access_token",
        client_id: cfg.clientId!,
        client_secret: cfg.clientSecret!,
      }),
    });
    if (!res.ok) return null;
    info = parseIntrospection((await res.json()) as Record<string, unknown>);
  } catch (e) {
    console.error("[oidc] introspection failed:", e instanceof Error ? e.message : e);
    return null;
  }

  if (!info.active || !info.sub) return null;
  // If the provider echoes the issuer, make sure it's the one we configured.
  if (info.iss && cfg.issuer && info.iss.replace(/\/+$/, "") !== cfg.issuer.replace(/\/+$/, "")) {
    return null;
  }

  // Map to the local user (auto-provisioning on first use, like OIDC login).
  const user = upsertOidcUser({
    sub: info.sub,
    email: info.email,
    emailVerified: info.emailVerified,
    name: info.name,
    preferredUsername: info.preferredUsername,
  });

  const ttl = info.exp ? Math.min(MAX_CACHE_MS, info.exp * 1000 - Date.now()) : MAX_CACHE_MS;
  if (ttl > 0) cache.set(hash(token), { userId: user.id, expiresAt: Date.now() + ttl });
  return user;
}
