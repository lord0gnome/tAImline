import type { APIRoute } from "astro";
import { revokeApiToken } from "~/auth/tokens.ts";
import { json, jsonError } from "~/lib/http.ts";

export const prerender = false;

export const DELETE: APIRoute = ({ locals, params }) => {
  if (!locals.user) return jsonError("Not authenticated.", 401);
  const ok = revokeApiToken(locals.user.id, params.id!);
  if (!ok) return jsonError("Token not found.", 404);
  return json({ ok: true });
};
