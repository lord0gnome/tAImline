import { afterAll, beforeAll, describe, expect, it } from "vitest";

// DB-backed test for OIDC config persistence + the admin allowlist helper.
const DB = `./data/test-oidc-${Date.now()}.db`;
process.env.DATABASE_PATH = DB;

let cfg: typeof import("./oidcConfig.ts");
let admin: typeof import("./admin.ts");

beforeAll(async () => {
  const { migrate } = await import("drizzle-orm/better-sqlite3/migrator");
  const { db } = await import("./../db/client.ts");
  migrate(db, { migrationsFolder: "./src/db/migrations" });
  cfg = await import("./oidcConfig.ts");
  admin = await import("./admin.ts");
});

afterAll(async () => {
  const { rmSync } = await import("node:fs");
  for (const s of ["", "-shm", "-wal"]) try { rmSync(DB + s); } catch {}
});

describe("oidcConfig", () => {
  it("starts empty and never reports a secret it doesn't have", () => {
    const c = cfg.getPublicOidcConfig();
    expect(c.enabled).toBe(false);
    expect(c.hasSecret).toBe(false);
    expect(cfg.oidcEnabled()).toBe(false);
  });

  it("rejects enabling without a full config", () => {
    const r = cfg.updateOidcConfig({ enabled: true, issuer: "https://id.example.com", clientId: "abc" });
    expect(r.ok).toBe(false);
  });

  it("rejects a non-https issuer", () => {
    const r = cfg.updateOidcConfig({ issuer: "http://id.example.com" });
    expect(r.ok).toBe(false);
  });

  it("stores a full config and exposes it without the secret", () => {
    const r = cfg.updateOidcConfig({
      enabled: true,
      label: "Authentik",
      issuer: "https://id.example.com/",
      clientId: "client-123",
      clientSecret: "s3cret",
      scopes: "openid profile email",
    });
    expect(r.ok).toBe(true);
    const c = cfg.getPublicOidcConfig();
    expect(c).toMatchObject({ enabled: true, label: "Authentik", clientId: "client-123", hasSecret: true });
    expect(c.issuer).toBe("https://id.example.com"); // trailing slash trimmed
    expect((c as unknown as Record<string, unknown>).clientSecret).toBeUndefined();
    expect(cfg.oidcEnabled()).toBe(true);
    // the raw row keeps the secret for the auth flow
    expect(cfg.getOidcConfig()?.clientSecret).toBe("s3cret");
  });

  it("preserves the secret when updating with a blank secret", () => {
    const r = cfg.updateOidcConfig({
      enabled: true,
      label: "Authentik renamed",
      issuer: "https://id.example.com",
      clientId: "client-123",
      clientSecret: "",
    });
    expect(r.ok).toBe(true);
    expect(cfg.getOidcConfig()?.clientSecret).toBe("s3cret");
    expect(cfg.getPublicOidcConfig().label).toBe("Authentik renamed");
  });
});

describe("admin allowlist", () => {
  it("matches case-insensitively and ignores blanks", () => {
    process.env.ADMIN_EMAILS = "Alice@x.com, bob@x.com";
    expect(admin.isAdminEmail("alice@x.com")).toBe(true);
    expect(admin.isAdminEmail("BOB@X.COM")).toBe(true);
    expect(admin.isAdminEmail("carol@x.com")).toBe(false);
    expect(admin.isAdminEmail(null)).toBe(false);
  });
});
