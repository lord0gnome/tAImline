import type { APIRoute } from "astro";
import { getMediaById } from "~/lib/media.ts";
import { canViewMedia } from "~/lib/publicView.ts";
import { presignGet } from "~/storage/s3.ts";

export const prerender = false;

// Thumbnail variant; falls back to the original if no thumb was generated.
export const GET: APIRoute = async ({ locals, params }) => {
  const row = getMediaById(params.id!);
  if (!row) return new Response("Not found", { status: 404 });
  if (!canViewMedia(row, locals.user?.id ?? null)) {
    return new Response(locals.user ? "Forbidden" : "Unauthorized", {
      status: locals.user ? 403 : 401,
    });
  }
  const signed = await presignGet(row.thumbKey ?? row.storageKey);
  return new Response(null, {
    status: 302,
    headers: { location: signed, "cache-control": "private, max-age=300" },
  });
};
