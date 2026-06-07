import { eq, inArray, or } from "drizzle-orm";
import { db } from "~/db/client.ts";
import { eras as erasTable, media, users } from "~/db/schema.ts";
import {
  canViewEra,
  canViewPost,
  resolveEraVisibility,
  type ViewerGrants,
} from "~/lib/authz.ts";
import { getEraBySlug, getOwnedEra, listErasForUser, toEraDTO } from "~/lib/eras.ts";
import { listMediaByPost, type MediaDTO } from "~/lib/media.ts";
import { getOwnedPost, getPostBySlug, listPostsForUser, toPostDTO } from "~/lib/posts.ts";
import { getUserById, getViewerGrants } from "~/lib/shares.ts";
import type { EraDTO, PostDTO } from "~/timeline/types.ts";

type UserRow = typeof users.$inferSelect;

/** Effective visibility per era id, for resolving inherited post visibility. */
function eraEffMap(owner: UserRow, eras: EraDTO[]): Map<string, ReturnType<typeof resolveEraVisibility>> {
  return new Map(eras.map((e) => [e.id, resolveEraVisibility(e.visibility, owner.defaultVisibility)]));
}

/** All eras + posts of `owner` that `viewerId` is allowed to see. */
export function viewableTimeline(
  owner: UserRow,
  viewerId: string | null,
): { eras: EraDTO[]; posts: PostDTO[]; grants: ViewerGrants } {
  const grants = getViewerGrants(owner.id, viewerId);
  const allEras = listErasForUser(owner.id);
  const eff = eraEffMap(owner, allEras);
  const eras = allEras.filter((e) => canViewEra(e, owner.defaultVisibility, grants));
  const posts = listPostsForUser(owner.id).filter((p) =>
    canViewPost(p, p.eraId ? eff.get(p.eraId) ?? null : null, owner.defaultVisibility, grants),
  );
  return { eras, posts, grants };
}

/** A single era (by slug) + its viewable posts, or null if not allowed. */
export function viewableEra(
  owner: UserRow,
  slug: string,
  viewerId: string | null,
): { era: EraDTO; posts: PostDTO[] } | null {
  const row = getEraBySlug(owner.id, slug);
  if (!row) return null;
  const grants = getViewerGrants(owner.id, viewerId);
  const era = toEraDTO(row);
  if (!canViewEra(era, owner.defaultVisibility, grants)) return null;
  const eff = resolveEraVisibility(era.visibility, owner.defaultVisibility);
  const posts = listPostsForUser(owner.id).filter(
    (p) => p.eraId === era.id && canViewPost(p, eff, owner.defaultVisibility, grants),
  );
  return { era, posts };
}

/** A single post (by slug) + its media, or null if not allowed. */
export function viewablePost(
  owner: UserRow,
  slug: string,
  viewerId: string | null,
): { post: PostDTO; media: MediaDTO[] } | null {
  const row = getPostBySlug(owner.id, slug);
  if (!row) return null;
  const grants = getViewerGrants(owner.id, viewerId);
  const post = toPostDTO(row);
  const eraEff = post.eraId
    ? resolveEraVisibility(
        listErasForUser(owner.id).find((e) => e.id === post.eraId)?.visibility ?? "inherit",
        owner.defaultVisibility,
      )
    : null;
  if (!canViewPost(post, eraEff, owner.defaultVisibility, grants)) return null;
  return { post, media: listMediaByPost(owner.id, post.id) };
}

/** Can `viewerId` see this media, based on its post/era visibility? */
export function canViewMedia(row: typeof media.$inferSelect, viewerId: string | null): boolean {
  const owner = getUserById(row.userId);
  if (!owner) return false;
  const grants = getViewerGrants(owner.id, viewerId);

  if (row.postId) {
    const post = getOwnedPost(owner.id, row.postId);
    if (!post) return grants.isOwner;
    const eraEff = post.eraId
      ? resolveEraVisibility(getOwnedEra(owner.id, post.eraId)?.visibility ?? "inherit", owner.defaultVisibility)
      : null;
    return canViewPost(post, eraEff, owner.defaultVisibility, grants);
  }
  if (row.eraId) {
    const era = getOwnedEra(owner.id, row.eraId);
    if (!era) return grants.isOwner;
    return canViewEra(era, owner.defaultVisibility, grants);
  }
  return grants.isOwner; // standalone media → owner only
}

export interface PublicProfile {
  handle: string;
  displayName: string;
  avatarUrl: string | null;
  bio: string | null;
}

/** Profiles discoverable on the explore page: public default, or any public/
 *  unlisted era. (Unlisted timelines aren't listed unless they opt their
 *  default to public; individual unlisted eras surface their owner here.) */
export function listPublicProfiles(limit = 60): PublicProfile[] {
  const withPublicEra = db
    .selectDistinct({ id: erasTable.userId })
    .from(erasTable)
    .where(or(eq(erasTable.visibility, "public"), eq(erasTable.visibility, "unlisted")))
    .all()
    .map((r) => r.id);

  const rows = db
    .select({
      handle: users.handle,
      displayName: users.displayName,
      avatarUrl: users.avatarUrl,
      bio: users.bio,
    })
    .from(users)
    .where(
      withPublicEra.length
        ? or(eq(users.defaultVisibility, "public"), inArray(users.id, withPublicEra))
        : eq(users.defaultVisibility, "public"),
    )
    .limit(limit)
    .all();
  return rows;
}
