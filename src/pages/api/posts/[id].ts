import type { APIRoute } from "astro";
import { deletePost, getOwnedPost, parsePost, updatePost } from "~/lib/posts.ts";
import { json, jsonError, readJson } from "~/lib/http.ts";

export const prerender = false;

export const PATCH: APIRoute = async ({ locals, params, request }) => {
  if (!locals.user) return jsonError("Not authenticated.", 401);
  const existing = getOwnedPost(locals.user.id, params.id!);
  if (!existing) return jsonError("Post not found.", 404);

  const parsed = parsePost(await readJson(request));
  if (!parsed.ok) return jsonError(parsed.error, 422);
  const result = updatePost(existing, parsed.value);
  if (!result.ok) return jsonError(result.error, 422);
  return json({ post: result.post });
};

export const DELETE: APIRoute = ({ locals, params }) => {
  if (!locals.user) return jsonError("Not authenticated.", 401);
  const existing = getOwnedPost(locals.user.id, params.id!);
  if (!existing) return jsonError("Post not found.", 404);
  deletePost(existing.id);
  return json({ ok: true });
};
