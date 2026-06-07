import type { APIRoute } from "astro";
import { and, eq, ne } from "drizzle-orm";
import { db } from "~/db/client.ts";
import { VISIBILITIES, type Visibility, users } from "~/db/schema.ts";
import { isValidISODate } from "~/lib/dates.ts";
import { json, jsonError, readJson } from "~/lib/http.ts";

export const prerender = false;

function slugifyHandle(s: string): string {
  return s.toLowerCase().replace(/[^a-z0-9_-]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 30);
}

export const PATCH: APIRoute = async ({ locals, request }) => {
  if (!locals.user) return jsonError("Not authenticated.", 401);
  const body = await readJson<Record<string, unknown>>(request);
  const set: Partial<typeof users.$inferInsert> = {};

  if (typeof body.displayName === "string" && body.displayName.trim()) {
    set.displayName = body.displayName.trim().slice(0, 80);
  }
  if (typeof body.bio === "string") set.bio = body.bio.trim().slice(0, 500) || null;
  if (body.birthDate === null || body.birthDate === "") set.birthDate = null;
  else if (typeof body.birthDate === "string") {
    if (!isValidISODate(body.birthDate)) return jsonError("birthDate must be YYYY-MM-DD.", 422);
    set.birthDate = body.birthDate;
  }
  if (typeof body.defaultVisibility === "string") {
    if (!VISIBILITIES.includes(body.defaultVisibility as Visibility)) {
      return jsonError("Invalid default visibility.", 422);
    }
    set.defaultVisibility = body.defaultVisibility as Visibility;
  }
  if (typeof body.handle === "string" && body.handle.trim()) {
    const handle = slugifyHandle(body.handle);
    if (!handle) return jsonError("Invalid handle.", 422);
    const taken = db
      .select({ id: users.id })
      .from(users)
      .where(and(eq(users.handle, handle), ne(users.id, locals.user.id)))
      .get();
    if (taken) return jsonError("That handle is taken.", 409);
    set.handle = handle;
  }

  if (Object.keys(set).length === 0) return jsonError("Nothing to update.", 400);
  db.update(users).set(set).where(eq(users.id, locals.user.id)).run();
  const updated = db.select().from(users).where(eq(users.id, locals.user.id)).get()!;
  return json({
    profile: {
      handle: updated.handle,
      displayName: updated.displayName,
      bio: updated.bio,
      birthDate: updated.birthDate,
      defaultVisibility: updated.defaultVisibility,
    },
  });
};
