import type { APIRoute } from "astro";
import { createPost, listPostsForUser, parsePost } from "~/lib/posts.ts";
import { json, jsonError, readJson } from "~/lib/http.ts";

export const prerender = false;

export const GET: APIRoute = ({ locals }) => {
  if (!locals.user) return jsonError("Not authenticated.", 401);
  return json({ posts: listPostsForUser(locals.user.id) });
};

export const POST: APIRoute = async ({ locals, request }) => {
  if (!locals.user) return jsonError("Not authenticated.", 401);
  const parsed = parsePost(await readJson(request));
  if (!parsed.ok) return jsonError(parsed.error, 422);
  const result = createPost(locals.user.id, parsed.value);
  if (!result.ok) return jsonError(result.error, 422);
  return json({ post: result.post }, 201);
};
