import { eq } from "drizzle-orm";
import { db } from "~/db/client.ts";
import { oidcConfig } from "~/db/schema.ts";

const ROW_ID = "default";

type OidcRow = typeof oidcConfig.$inferSelect;

/** What the admin UI is allowed to see — the secret is replaced by a flag. */
export interface PublicOidcConfig {
  enabled: boolean;
  label: string;
  issuer: string;
  clientId: string;
  scopes: string;
  hasSecret: boolean;
}

const DEFAULTS: PublicOidcConfig = {
  enabled: false,
  label: "OIDC",
  issuer: "",
  clientId: "",
  scopes: "openid profile email",
  hasSecret: false,
};

/** Raw row (incl. secret) for the auth flow. Null when never configured. */
export function getOidcConfig(): OidcRow | null {
  return db.select().from(oidcConfig).where(eq(oidcConfig.id, ROW_ID)).get() ?? null;
}

/** Browser-safe view: never includes the client secret. */
export function getPublicOidcConfig(): PublicOidcConfig {
  const row = getOidcConfig();
  if (!row) return { ...DEFAULTS };
  return {
    enabled: row.enabled,
    label: row.label,
    issuer: row.issuer ?? "",
    clientId: row.clientId ?? "",
    scopes: row.scopes,
    hasSecret: Boolean(row.clientSecret),
  };
}

/** Usable for sign-in only when enabled and fully configured. */
export function oidcEnabled(): boolean {
  const row = getOidcConfig();
  return Boolean(row?.enabled && row.issuer && row.clientId && row.clientSecret);
}

export interface OidcConfigInput {
  enabled?: unknown;
  label?: unknown;
  issuer?: unknown;
  clientId?: unknown;
  /** Omitted/empty keeps the stored secret; a value replaces it. */
  clientSecret?: unknown;
  scopes?: unknown;
}

const asString = (v: unknown): string => (typeof v === "string" ? v.trim() : "");

/**
 * Validate + persist the OIDC config (single row). A blank/omitted clientSecret
 * preserves the existing one (so the write-only field need not be re-entered).
 * Returns the public view or an error.
 */
export function updateOidcConfig(
  input: OidcConfigInput,
): { ok: true; config: PublicOidcConfig } | { ok: false; error: string } {
  const existing = getOidcConfig();

  const enabled = Boolean(input.enabled);
  const label = asString(input.label) || "OIDC";
  const issuer = asString(input.issuer).replace(/\/+$/, ""); // no trailing slash
  const clientId = asString(input.clientId);
  const scopes = asString(input.scopes) || "openid profile email";
  const secretIn = asString(input.clientSecret);
  const clientSecret = secretIn || existing?.clientSecret || "";

  if (issuer) {
    let u: URL;
    try {
      u = new URL(issuer);
    } catch {
      return { ok: false, error: "Issuer must be a valid URL (e.g. https://id.example.com)." };
    }
    if (u.protocol !== "https:" && u.hostname !== "localhost") {
      return { ok: false, error: "Issuer must use https." };
    }
  }

  // Enabling requires a complete config.
  if (enabled && (!issuer || !clientId || !clientSecret)) {
    return {
      ok: false,
      error: "To enable OIDC, set the issuer URL, client ID, and client secret.",
    };
  }
  if (scopes && !scopes.split(/\s+/).includes("openid")) {
    return { ok: false, error: "Scopes must include 'openid'." };
  }

  const row: typeof oidcConfig.$inferInsert = {
    id: ROW_ID,
    enabled,
    label,
    issuer: issuer || null,
    clientId: clientId || null,
    clientSecret: clientSecret || null,
    scopes,
    updatedAt: Math.floor(Date.now() / 1000),
  };

  if (existing) {
    db.update(oidcConfig).set(row).where(eq(oidcConfig.id, ROW_ID)).run();
  } else {
    db.insert(oidcConfig).values(row).run();
  }
  return { ok: true, config: getPublicOidcConfig() };
}
