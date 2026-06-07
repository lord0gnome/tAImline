import type { APIRoute } from "astro";
import { json, jsonError, readJson } from "~/lib/http.ts";
import { listMediaByPost, registerMedia, type RegisterMediaInput } from "~/lib/media.ts";

export const prerender = false;

export const GET: APIRoute = ({ locals, url }) => {
  if (!locals.user) return jsonError("Not authenticated.", 401);
  const postId = url.searchParams.get("postId");
  if (!postId) return jsonError("postId is required.", 400);
  return json({ media: listMediaByPost(locals.user.id, postId) });
};

export const POST: APIRoute = async ({ locals, request }) => {
  if (!locals.user) return jsonError("Not authenticated.", 401);
  const body = await readJson<RegisterMediaInput>(request);
  const result = registerMedia(locals.user.id, body);
  if (!result.ok) return jsonError(result.error, 422);
  return json({ media: result.media }, 201);
};
