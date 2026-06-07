import { createHash, randomBytes, randomUUID } from "node:crypto";
import { and, desc, eq } from "drizzle-orm";
import { db } from "~/db/client.ts";
import { apiTokens, users } from "~/db/schema.ts";

type UserRow = typeof users.$inferSelect;
type TokenRow = typeof apiTokens.$inferSelect;

const PREFIX = "tai_";

function hashToken(token: string): string {
  return createHash("sha256").update(token).digest("hex");
}

export interface CreatedToken {
  /** Full plaintext token — shown to the user exactly once. */
  token: string;
  row: Omit<TokenRow, "tokenHash">;
}

export function createApiToken(userId: string, name: string): CreatedToken {
  const secret = randomBytes(32).toString("base64url");
  const token = `${PREFIX}${secret}`;
  const id = randomUUID();
  const prefix = `${token.slice(0, 12)}…`;
  const row: typeof apiTokens.$inferInsert = {
    id,
    userId,
    name: name.trim() || "token",
    tokenHash: hashToken(token),
    prefix,
  };
  db.insert(apiTokens).values(row).run();
  const saved = db.select().from(apiTokens).where(eq(apiTokens.id, id)).get()!;
  const { tokenHash: _omit, ...safe } = saved;
  return { token, row: safe };
}

/** Resolve a bearer token to its user, updating last-used. Null if invalid. */
export function validateApiToken(token: string): UserRow | null {
  if (!token.startsWith(PREFIX)) return null;
  const row = db
    .select({ user: users, tokenId: apiTokens.id })
    .from(apiTokens)
    .innerJoin(users, eq(apiTokens.userId, users.id))
    .where(eq(apiTokens.tokenHash, hashToken(token)))
    .get();
  if (!row) return null;
  db.update(apiTokens)
    .set({ lastUsedAt: Math.floor(Date.now() / 1000) })
    .where(eq(apiTokens.id, row.tokenId))
    .run();
  return row.user;
}

export function listApiTokens(userId: string): Omit<TokenRow, "tokenHash">[] {
  return db
    .select({
      id: apiTokens.id,
      userId: apiTokens.userId,
      name: apiTokens.name,
      prefix: apiTokens.prefix,
      createdAt: apiTokens.createdAt,
      lastUsedAt: apiTokens.lastUsedAt,
    })
    .from(apiTokens)
    .where(eq(apiTokens.userId, userId))
    .orderBy(desc(apiTokens.createdAt))
    .all();
}

export function revokeApiToken(userId: string, id: string): boolean {
  const res = db
    .delete(apiTokens)
    .where(and(eq(apiTokens.id, id), eq(apiTokens.userId, userId)))
    .run();
  return res.changes > 0;
}
