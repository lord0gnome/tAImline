import { createHash, randomBytes } from "node:crypto";
import type { AstroCookies } from "astro";
import { eq } from "drizzle-orm";
import { db } from "~/db/client.ts";
import { sessions, users } from "~/db/schema.ts";

export const SESSION_COOKIE = "taimline_session";

const DAY = 60 * 60 * 24;
const SESSION_TTL = 30 * DAY; // seconds
const REFRESH_THRESHOLD = 15 * DAY; // extend when this close to expiry

type UserRow = typeof users.$inferSelect;
type SessionRow = typeof sessions.$inferSelect;

const nowSeconds = () => Math.floor(Date.now() / 1000);

/** Opaque token handed to the client; only its hash is stored server-side. */
export function generateSessionToken(): string {
  return randomBytes(24).toString("base64url");
}

function hashToken(token: string): string {
  return createHash("sha256").update(token).digest("hex");
}

export function createSession(token: string, userId: string): SessionRow {
  const session: SessionRow = {
    id: hashToken(token),
    userId,
    expiresAt: nowSeconds() + SESSION_TTL,
  };
  db.insert(sessions).values(session).run();
  return session;
}

export interface SessionValidation {
  user: UserRow;
  session: SessionRow;
}

export function validateSessionToken(token: string): SessionValidation | null {
  const id = hashToken(token);
  const row = db
    .select({ user: users, session: sessions })
    .from(sessions)
    .innerJoin(users, eq(sessions.userId, users.id))
    .where(eq(sessions.id, id))
    .get();

  if (!row) return null;

  const now = nowSeconds();
  if (now >= row.session.expiresAt) {
    db.delete(sessions).where(eq(sessions.id, id)).run();
    return null;
  }

  // Sliding expiry: extend when the session is past its refresh threshold.
  if (now >= row.session.expiresAt - REFRESH_THRESHOLD) {
    row.session.expiresAt = now + SESSION_TTL;
    db.update(sessions)
      .set({ expiresAt: row.session.expiresAt })
      .where(eq(sessions.id, id))
      .run();
  }

  return { user: row.user, session: row.session };
}

export function invalidateSession(sessionId: string): void {
  db.delete(sessions).where(eq(sessions.id, sessionId)).run();
}

function cookieSecure(): boolean {
  return (process.env.PUBLIC_BASE_URL ?? "").startsWith("https");
}

export function setSessionCookie(cookies: AstroCookies, token: string): void {
  cookies.set(SESSION_COOKIE, token, {
    httpOnly: true,
    sameSite: "lax",
    secure: cookieSecure(),
    path: "/",
    maxAge: SESSION_TTL,
  });
}

export function deleteSessionCookie(cookies: AstroCookies): void {
  cookies.set(SESSION_COOKIE, "", {
    httpOnly: true,
    sameSite: "lax",
    secure: cookieSecure(),
    path: "/",
    maxAge: 0,
  });
}
