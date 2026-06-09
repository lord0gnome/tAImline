import { eq, sql } from "drizzle-orm";
import { db } from "~/db/client.ts";
import { eras, posts } from "~/db/schema.ts";

/**
 * A cheap, opaque fingerprint of a user's timeline used to detect changes for
 * live updates (SSE). It combines row counts with the max `updatedAt` of eras
 * and posts: counts catch deletes (which bump no timestamp), while max
 * `updatedAt` catches inserts, edits and lane drags. Two indexed aggregate
 * queries — safe to poll on a tight interval.
 */
export function timelineVersion(userId: string): string {
  const e = db
    .select({
      n: sql<number>`count(*)`,
      m: sql<number>`coalesce(max(${eras.updatedAt}), 0)`,
    })
    .from(eras)
    .where(eq(eras.userId, userId))
    .get()!;
  const p = db
    .select({
      n: sql<number>`count(*)`,
      m: sql<number>`coalesce(max(${posts.updatedAt}), 0)`,
    })
    .from(posts)
    .where(eq(posts.userId, userId))
    .get()!;
  return `${e.n}.${e.m}-${p.n}.${p.m}`;
}
