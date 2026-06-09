import { and, eq, ne } from "drizzle-orm";
import { db } from "~/db/client.ts";
import { VISIBILITIES, type Visibility, users } from "~/db/schema.ts";
import { isValidISODate } from "~/lib/dates.ts";

export interface ProfileDTO {
  handle: string;
  displayName: string;
  bio: string | null;
  birthDate: string | null;
  defaultVisibility: Visibility;
  avatarUrl: string | null;
}

function slugifyHandle(s: string): string {
  return s.toLowerCase().replace(/[^a-z0-9_-]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 30);
}

function toProfile(row: typeof users.$inferSelect): ProfileDTO {
  return {
    handle: row.handle,
    displayName: row.displayName,
    bio: row.bio,
    birthDate: row.birthDate,
    defaultVisibility: row.defaultVisibility,
    avatarUrl: row.avatarUrl,
  };
}

export function getProfile(userId: string): ProfileDTO | null {
  const row = db.select().from(users).where(eq(users.id, userId)).get();
  return row ? toProfile(row) : null;
}

export type ProfileInput = Record<string, unknown>;

/** Validate + apply a partial profile update. Shared by /api/profile and MCP. */
export function updateProfile(
  userId: string,
  body: ProfileInput,
): { ok: true; profile: ProfileDTO } | { ok: false; error: string; status: number } {
  const set: Partial<typeof users.$inferInsert> = {};

  if (typeof body.displayName === "string" && body.displayName.trim()) {
    set.displayName = body.displayName.trim().slice(0, 80);
  }
  if (typeof body.bio === "string") set.bio = body.bio.trim().slice(0, 500) || null;
  if (body.birthDate === null || body.birthDate === "") set.birthDate = null;
  else if (typeof body.birthDate === "string") {
    if (!isValidISODate(body.birthDate)) {
      return { ok: false, error: "birthDate must be YYYY-MM-DD.", status: 422 };
    }
    set.birthDate = body.birthDate;
  }
  if (typeof body.defaultVisibility === "string") {
    if (!VISIBILITIES.includes(body.defaultVisibility as Visibility)) {
      return { ok: false, error: "Invalid default visibility.", status: 422 };
    }
    set.defaultVisibility = body.defaultVisibility as Visibility;
  }
  if (typeof body.handle === "string" && body.handle.trim()) {
    const handle = slugifyHandle(body.handle);
    if (!handle) return { ok: false, error: "Invalid handle.", status: 422 };
    const taken = db
      .select({ id: users.id })
      .from(users)
      .where(and(eq(users.handle, handle), ne(users.id, userId)))
      .get();
    if (taken) return { ok: false, error: "That handle is taken.", status: 409 };
    set.handle = handle;
  }

  if (Object.keys(set).length === 0) {
    return { ok: false, error: "Nothing to update.", status: 400 };
  }
  db.update(users).set(set).where(eq(users.id, userId)).run();
  return { ok: true, profile: getProfile(userId)! };
}
