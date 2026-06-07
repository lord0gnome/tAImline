import type { APIRoute } from "astro";
import { deleteEra, getOwnedEra, parseEra, updateEra } from "~/lib/eras.ts";
import { json, jsonError, readJson } from "~/lib/http.ts";

export const prerender = false;

export const PATCH: APIRoute = async ({ locals, params, request }) => {
  if (!locals.user) return jsonError("Not authenticated.", 401);
  const existing = getOwnedEra(locals.user.id, params.id!);
  if (!existing) return jsonError("Era not found.", 404);

  const parsed = parseEra(await readJson(request));
  if (!parsed.ok) return jsonError(parsed.error, 422);
  return json({ era: updateEra(existing, parsed.value) });
};

export const DELETE: APIRoute = ({ locals, params }) => {
  if (!locals.user) return jsonError("Not authenticated.", 401);
  const existing = getOwnedEra(locals.user.id, params.id!);
  if (!existing) return jsonError("Era not found.", 404);
  deleteEra(existing.id);
  return json({ ok: true });
};
