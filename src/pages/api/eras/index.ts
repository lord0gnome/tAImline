import type { APIRoute } from "astro";
import { createEra, listErasForUser, parseEra } from "~/lib/eras.ts";
import { json, jsonError, readJson } from "~/lib/http.ts";

export const prerender = false;

export const GET: APIRoute = ({ locals }) => {
  if (!locals.user) return jsonError("Not authenticated.", 401);
  return json({ eras: listErasForUser(locals.user.id) });
};

export const POST: APIRoute = async ({ locals, request }) => {
  if (!locals.user) return jsonError("Not authenticated.", 401);
  const parsed = parseEra(await readJson(request));
  if (!parsed.ok) return jsonError(parsed.error, 422);
  return json({ era: createEra(locals.user.id, parsed.value) }, 201);
};
