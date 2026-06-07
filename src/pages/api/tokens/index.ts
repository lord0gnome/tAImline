import type { APIRoute } from "astro";
import { createApiToken, listApiTokens } from "~/auth/tokens.ts";
import { json, jsonError, readJson } from "~/lib/http.ts";

export const prerender = false;

export const GET: APIRoute = ({ locals }) => {
  if (!locals.user) return jsonError("Not authenticated.", 401);
  return json({ tokens: listApiTokens(locals.user.id) });
};

export const POST: APIRoute = async ({ locals, request }) => {
  if (!locals.user) return jsonError("Not authenticated.", 401);
  const body = await readJson<{ name?: string }>(request);
  const name = typeof body.name === "string" ? body.name : "";
  const created = createApiToken(locals.user.id, name);
  // `token` is returned exactly once; only the hash is stored.
  return json({ token: created.token, tokenInfo: created.row }, 201);
};
