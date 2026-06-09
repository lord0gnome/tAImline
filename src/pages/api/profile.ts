import type { APIRoute } from "astro";
import { json, jsonError, readJson } from "~/lib/http.ts";
import { updateProfile } from "~/lib/profile.ts";

export const prerender = false;

export const PATCH: APIRoute = async ({ locals, request }) => {
  if (!locals.user) return jsonError("Not authenticated.", 401);
  const result = updateProfile(locals.user.id, await readJson(request));
  if (!result.ok) return jsonError(result.error, result.status);
  return json({ profile: result.profile });
};
