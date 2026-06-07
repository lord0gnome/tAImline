import type { APIRoute } from "astro";
import { getOwnedMedia } from "~/lib/media.ts";
import { presignGet } from "~/storage/s3.ts";

export const prerender = false;

// Authz-checked redirect to a short-lived signed object URL. Owner-only for now;
// M5 (canView) extends this to public/gated/shared viewers. The browser follows
// the 302 and can issue range requests straight to the bucket (video seeking).
export const GET: APIRoute = async ({ locals, params }) => {
  if (!locals.user) return new Response("Unauthorized", { status: 401 });
  const row = getOwnedMedia(locals.user.id, params.id!);
  if (!row) return new Response("Not found", { status: 404 });
  const signed = await presignGet(row.storageKey);
  return new Response(null, {
    status: 302,
    headers: { location: signed, "cache-control": "private, max-age=300" },
  });
};
