import type { APIRoute } from "astro";
import { json, jsonError } from "~/lib/http.ts";
import { revokeShare } from "~/lib/shares.ts";

export const prerender = false;

export const DELETE: APIRoute = ({ locals, params }) => {
  if (!locals.user) return jsonError("Not authenticated.", 401);
  if (!revokeShare(locals.user.id, params.id!)) return jsonError("Share not found.", 404);
  return json({ ok: true });
};
