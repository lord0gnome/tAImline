import type { APIRoute } from "astro";
import { json, jsonError, readJson } from "~/lib/http.ts";
import { rateLimit } from "~/lib/ratelimit.ts";
import { createShare, listShares, type ShareInput } from "~/lib/shares.ts";

export const prerender = false;

export const GET: APIRoute = ({ locals }) => {
  if (!locals.user) return jsonError("Not authenticated.", 401);
  return json({ shares: listShares(locals.user.id) });
};

export const POST: APIRoute = async ({ locals, request }) => {
  if (!locals.user) return jsonError("Not authenticated.", 401);
  if (!rateLimit(`shares:u:${locals.user.id}`, 30, 60_000)) {
    return jsonError("Too many requests, slow down.", 429);
  }
  const result = createShare(locals.user.id, await readJson<ShareInput>(request));
  if (!result.ok) return jsonError(result.error, 422);
  return json({ id: result.id }, 201);
};
