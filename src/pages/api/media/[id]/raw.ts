import type { APIRoute } from "astro";
import { getMediaById } from "~/lib/media.ts";
import { canViewMedia } from "~/lib/publicView.ts";
import { presignGet } from "~/storage/s3.ts";

export const prerender = false;

// Authz-checked redirect to a short-lived signed object URL. Honors canView
// (owner / public / unlisted / gated) via the media's post/era visibility.
// The browser follows the 302 and can issue range requests (video seeking).
export const GET: APIRoute = async ({ locals, params }) => {
  const row = getMediaById(params.id!);
  if (!row) return new Response("Not found", { status: 404 });
  if (!canViewMedia(row, locals.user?.id ?? null)) {
    return new Response(locals.user ? "Forbidden" : "Unauthorized", {
      status: locals.user ? 403 : 401,
    });
  }
  const signed = await presignGet(row.storageKey);
  return new Response(null, {
    status: 302,
    headers: { location: signed, "cache-control": "private, max-age=300" },
  });
};
