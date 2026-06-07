import type { EraVisibility, Visibility } from "~/db/schema.ts";

// Single source of truth for "who can see what". Pure functions take a
// pre-resolved ViewerGrants so callers can fetch grants once and avoid N+1.

export interface ViewerGrants {
  /** Viewer is the owner of the content. */
  isOwner: boolean;
  /** Viewer holds a timeline-scoped gated grant (covers everything). */
  timelineGrant: boolean;
  /** Era ids the viewer holds an era-scoped gated grant for. */
  eraGrants: Set<string>;
}

export const NO_GRANTS: ViewerGrants = {
  isOwner: false,
  timelineGrant: false,
  eraGrants: new Set(),
};

/** Era `inherit` resolves to the owner's default visibility. */
export function resolveEraVisibility(
  eraVisibility: EraVisibility,
  ownerDefault: Visibility,
): Visibility {
  return eraVisibility === "inherit" ? ownerDefault : eraVisibility;
}

/** Post `inherit` resolves to its era's effective visibility, else owner default. */
export function resolvePostVisibility(
  postVisibility: EraVisibility,
  eraEffective: Visibility | null,
  ownerDefault: Visibility,
): Visibility {
  if (postVisibility !== "inherit") return postVisibility;
  return eraEffective ?? ownerDefault;
}

/**
 * Core decision: can the viewer (described by `grants`) see content with the
 * given effective `visibility`? `eraIdForGrant` is the era an era-scoped grant
 * would apply to (the era's own id, or a post's eraId), or null.
 */
export function canSee(
  visibility: Visibility,
  eraIdForGrant: string | null,
  grants: ViewerGrants,
): boolean {
  if (grants.isOwner) return true;
  if (visibility === "public" || visibility === "unlisted") return true;
  if (visibility === "private") return false;
  // gated: needs a timeline grant, or an era grant matching this era.
  return grants.timelineGrant || (eraIdForGrant !== null && grants.eraGrants.has(eraIdForGrant));
}

export function canViewEra(
  era: { id: string; visibility: EraVisibility },
  ownerDefault: Visibility,
  grants: ViewerGrants,
): boolean {
  return canSee(resolveEraVisibility(era.visibility, ownerDefault), era.id, grants);
}

export function canViewPost(
  post: { eraId: string | null; visibility: EraVisibility },
  eraEffective: Visibility | null,
  ownerDefault: Visibility,
  grants: ViewerGrants,
): boolean {
  return canSee(
    resolvePostVisibility(post.visibility, eraEffective, ownerDefault),
    post.eraId,
    grants,
  );
}
