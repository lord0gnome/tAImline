import { sql } from "drizzle-orm";
import {
  index,
  integer,
  sqliteTable,
  text,
  uniqueIndex,
} from "drizzle-orm/sqlite-core";

/**
 * Shared enums (kept as TS unions + text columns so the schema stays
 * dialect-portable — no SQLite-only types — per the scalability plan).
 */
export const VISIBILITIES = ["private", "gated", "unlisted", "public"] as const;
export type Visibility = (typeof VISIBILITIES)[number];

/** Eras may additionally `inherit` the owner's default visibility. */
export const ERA_VISIBILITIES = ["inherit", ...VISIBILITIES] as const;
export type EraVisibility = (typeof ERA_VISIBILITIES)[number];

export const PRECISIONS = ["year", "month", "day"] as const;
export type Precision = (typeof PRECISIONS)[number];

export const SHARE_SCOPES = ["timeline", "era"] as const;
export type ShareScope = (typeof SHARE_SCOPES)[number];

const now = sql`(unixepoch())`;

export const users = sqliteTable(
  "users",
  {
    id: text("id").primaryKey(),
    handle: text("handle").notNull(),
    displayName: text("display_name").notNull(),
    /** From the OAuth provider; used to claim email-invited shares. */
    email: text("email"),
    avatarUrl: text("avatar_url"),
    bio: text("bio"),
    /** Timeline anchor (ISO date string), nullable. */
    birthDate: text("birth_date"),
    defaultVisibility: text("default_visibility")
      .$type<Visibility>()
      .notNull()
      .default("private"),
    createdAt: integer("created_at").notNull().default(now),
  },
  (t) => [uniqueIndex("users_handle_uq").on(t.handle)],
);

export const oauthAccounts = sqliteTable(
  "oauth_accounts",
  {
    provider: text("provider").notNull(),
    providerUserId: text("provider_user_id").notNull(),
    userId: text("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
  },
  (t) => [
    uniqueIndex("oauth_provider_uid_uq").on(t.provider, t.providerUserId),
    index("oauth_user_idx").on(t.userId),
  ],
);

export const sessions = sqliteTable(
  "sessions",
  {
    /** Hashed session token. */
    id: text("id").primaryKey(),
    userId: text("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    expiresAt: integer("expires_at").notNull(),
  },
  (t) => [index("sessions_user_idx").on(t.userId)],
);

export const apiTokens = sqliteTable(
  "api_tokens",
  {
    id: text("id").primaryKey(),
    userId: text("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    name: text("name").notNull(),
    /** SHA-256 hex of the full token; the plaintext is shown once at creation. */
    tokenHash: text("token_hash").notNull(),
    /** Short non-secret prefix for display, e.g. "tai_ab12…". */
    prefix: text("prefix").notNull(),
    createdAt: integer("created_at").notNull().default(now),
    lastUsedAt: integer("last_used_at"),
  },
  (t) => [
    uniqueIndex("api_tokens_hash_uq").on(t.tokenHash),
    index("api_tokens_user_idx").on(t.userId),
  ],
);

export const eras = sqliteTable(
  "eras",
  {
    id: text("id").primaryKey(),
    userId: text("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    title: text("title").notNull(),
    slug: text("slug").notNull(),
    descriptionMd: text("description_md"),
    descriptionHtml: text("description_html"),
    startDate: text("start_date").notNull(),
    startPrecision: text("start_precision")
      .$type<Precision>()
      .notNull()
      .default("day"),
    /** Null = ongoing. */
    endDate: text("end_date"),
    endPrecision: text("end_precision").$type<Precision>(),
    color: text("color"),
    /** Tag-like grouping, stored as a JSON string array (e.g. ["Career"]). */
    categories: text("categories"),
    /** Manual lane preference set by dragging; null = auto-packed. */
    lane: integer("lane"),
    coverMediaId: text("cover_media_id"),
    visibility: text("visibility")
      .$type<EraVisibility>()
      .notNull()
      .default("inherit"),
    createdAt: integer("created_at").notNull().default(now),
    updatedAt: integer("updated_at").notNull().default(now),
  },
  (t) => [
    index("eras_user_start_idx").on(t.userId, t.startDate),
    uniqueIndex("eras_user_slug_uq").on(t.userId, t.slug),
  ],
);

export const posts = sqliteTable(
  "posts",
  {
    id: text("id").primaryKey(),
    userId: text("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    /** Null = free-floating moment not attached to an era. */
    eraId: text("era_id").references(() => eras.id, { onDelete: "set null" }),
    title: text("title").notNull(),
    slug: text("slug").notNull(),
    bodyMd: text("body_md"),
    bodyHtml: text("body_html"),
    /** Tag-like grouping, stored as a JSON string array (e.g. ["Career"]). */
    categories: text("categories"),
    eventDate: text("event_date").notNull(),
    eventPrecision: text("event_precision")
      .$type<Precision>()
      .notNull()
      .default("day"),
    /** Null = point in time; set = span. */
    eventEndDate: text("event_end_date"),
    visibility: text("visibility")
      .$type<EraVisibility>()
      .notNull()
      .default("inherit"),
    createdAt: integer("created_at").notNull().default(now),
    updatedAt: integer("updated_at").notNull().default(now),
  },
  (t) => [
    index("posts_era_date_idx").on(t.eraId, t.eventDate),
    index("posts_user_vis_idx").on(t.userId, t.visibility),
    uniqueIndex("posts_user_slug_uq").on(t.userId, t.slug),
  ],
);

export const media = sqliteTable(
  "media",
  {
    id: text("id").primaryKey(),
    userId: text("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    eraId: text("era_id").references(() => eras.id, { onDelete: "cascade" }),
    postId: text("post_id").references(() => posts.id, { onDelete: "cascade" }),
    storageKey: text("storage_key").notNull(),
    /** Object key of the generated thumbnail (image downscale or video poster). */
    thumbKey: text("thumb_key"),
    /** Clean per-post reference name used in markdown, e.g. ![cap](beach-sunset). */
    name: text("name"),
    publicUrl: text("public_url"),
    thumbUrl: text("thumb_url"),
    width: integer("width"),
    height: integer("height"),
    mime: text("mime"),
    alt: text("alt"),
    caption: text("caption"),
    sortOrder: integer("sort_order").notNull().default(0),
    createdAt: integer("created_at").notNull().default(now),
  },
  (t) => [
    index("media_post_idx").on(t.postId),
    index("media_era_idx").on(t.eraId),
  ],
);

/**
 * Single-row (id = "default") admin-configurable OIDC identity provider, so the
 * timeline can authenticate against any IdP (e.g. self-hosted Authentik) via
 * discovery without baking creds into env. The client secret lives here but is
 * never returned to the browser. Admin = email ∈ ADMIN_EMAILS (env), not a column.
 */
export const oidcConfig = sqliteTable("oidc_config", {
  id: text("id").primaryKey(),
  enabled: integer("enabled", { mode: "boolean" }).notNull().default(false),
  /** Sign-in button label, e.g. "Authentik". */
  label: text("label").notNull().default("OIDC"),
  /** Issuer base URL; discovery doc lives at <issuer>/.well-known/openid-configuration. */
  issuer: text("issuer"),
  clientId: text("client_id"),
  clientSecret: text("client_secret"),
  scopes: text("scopes").notNull().default("openid profile email"),
  updatedAt: integer("updated_at").notNull().default(now),
});

export const shares = sqliteTable(
  "shares",
  {
    id: text("id").primaryKey(),
    ownerUserId: text("owner_user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    scope: text("scope").$type<ShareScope>().notNull(),
    /** Null when scope = timeline. */
    eraId: text("era_id").references(() => eras.id, { onDelete: "cascade" }),
    /** Null until an invited email is claimed by a registered user. */
    granteeUserId: text("grantee_user_id").references(() => users.id, {
      onDelete: "cascade",
    }),
    inviteEmail: text("invite_email"),
    createdAt: integer("created_at").notNull().default(now),
  },
  (t) => [
    uniqueIndex("shares_scope_era_grantee_uq").on(
      t.scope,
      t.eraId,
      t.granteeUserId,
    ),
    index("shares_grantee_idx").on(t.granteeUserId),
    index("shares_owner_scope_era_idx").on(t.ownerUserId, t.scope, t.eraId),
  ],
);
