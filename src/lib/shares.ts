import { randomUUID } from "node:crypto";
import { and, eq, isNull } from "drizzle-orm";
import { db } from "~/db/client.ts";
import { type ShareScope, eras, shares, users } from "~/db/schema.ts";
import { NO_GRANTS, type ViewerGrants } from "~/lib/authz.ts";
import { getOwnedEra } from "~/lib/eras.ts";

type UserRow = typeof users.$inferSelect;

export function getUserByHandle(handle: string): UserRow | null {
  return db.select().from(users).where(eq(users.handle, handle)).get() ?? null;
}

export function getUserById(id: string): UserRow | null {
  return db.select().from(users).where(eq(users.id, id)).get() ?? null;
}

/** Resolve a viewer's gated grants against an owner's content (one query). */
export function getViewerGrants(ownerId: string, viewerId: string | null): ViewerGrants {
  if (viewerId && viewerId === ownerId) {
    return { isOwner: true, timelineGrant: false, eraGrants: new Set() };
  }
  if (!viewerId) return NO_GRANTS;
  const rows = db
    .select({ scope: shares.scope, eraId: shares.eraId })
    .from(shares)
    .where(and(eq(shares.ownerUserId, ownerId), eq(shares.granteeUserId, viewerId)))
    .all();
  let timelineGrant = false;
  const eraGrants = new Set<string>();
  for (const r of rows) {
    if (r.scope === "timeline") timelineGrant = true;
    else if (r.eraId) eraGrants.add(r.eraId);
  }
  return { isOwner: false, timelineGrant, eraGrants };
}

export interface ShareInput {
  scope?: unknown;
  eraId?: unknown;
  granteeHandle?: unknown;
  inviteEmail?: unknown;
}

export function createShare(
  ownerId: string,
  input: ShareInput,
): { ok: true; id: string } | { ok: false; error: string } {
  const scope = input.scope as ShareScope;
  if (scope !== "timeline" && scope !== "era") {
    return { ok: false, error: "scope must be 'timeline' or 'era'." };
  }
  let eraId: string | null = null;
  if (scope === "era") {
    eraId = typeof input.eraId === "string" ? input.eraId : "";
    if (!eraId || !getOwnedEra(ownerId, eraId)) {
      return { ok: false, error: "A valid owned eraId is required for an era share." };
    }
  }

  const handle = typeof input.granteeHandle === "string" ? input.granteeHandle.trim() : "";
  const email = typeof input.inviteEmail === "string" ? input.inviteEmail.trim().toLowerCase() : "";
  let granteeUserId: string | null = null;
  let inviteEmail: string | null = null;
  if (handle) {
    const u = getUserByHandle(handle.replace(/^@/, ""));
    if (!u) return { ok: false, error: `No user with handle @${handle}.` };
    if (u.id === ownerId) return { ok: false, error: "You can't share with yourself." };
    granteeUserId = u.id;
  } else if (email) {
    inviteEmail = email;
  } else {
    return { ok: false, error: "Provide a grantee handle or invite email." };
  }

  const id = randomUUID();
  db.insert(shares)
    .values({ id, ownerUserId: ownerId, scope, eraId, granteeUserId, inviteEmail })
    .onConflictDoNothing()
    .run();
  return { ok: true, id };
}

export interface ShareView {
  id: string;
  scope: ShareScope;
  eraId: string | null;
  eraTitle: string | null;
  grantee: string; // handle or invite email
  pending: boolean; // emailed invite not yet claimed
}

export function listShares(ownerId: string): ShareView[] {
  const rows = db
    .select({
      id: shares.id,
      scope: shares.scope,
      eraId: shares.eraId,
      granteeUserId: shares.granteeUserId,
      inviteEmail: shares.inviteEmail,
      handle: users.handle,
      eraTitle: eras.title,
    })
    .from(shares)
    .leftJoin(users, eq(shares.granteeUserId, users.id))
    .leftJoin(eras, eq(shares.eraId, eras.id))
    .where(eq(shares.ownerUserId, ownerId))
    .all();
  return rows.map((r) => ({
    id: r.id,
    scope: r.scope,
    eraId: r.eraId,
    eraTitle: r.eraTitle,
    grantee: r.handle ? `@${r.handle}` : (r.inviteEmail ?? "unknown"),
    pending: !r.granteeUserId,
  }));
}

export function revokeShare(ownerId: string, id: string): boolean {
  const res = db
    .delete(shares)
    .where(and(eq(shares.id, id), eq(shares.ownerUserId, ownerId)))
    .run();
  return res.changes > 0;
}

/** On login, bind any email-invited shares to the now-known user id. */
export function claimInvites(user: UserRow): void {
  if (!user.email) return;
  db.update(shares)
    .set({ granteeUserId: user.id })
    .where(and(eq(shares.inviteEmail, user.email.toLowerCase()), isNull(shares.granteeUserId)))
    .run();
}
