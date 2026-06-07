import type { APIRoute } from "astro";
import { getOwnedEra, setEraLane } from "~/lib/eras.ts";
import { json, jsonError, readJson } from "~/lib/http.ts";

export const prerender = false;

// Persist a manual lane preference from a vertical drag. Separate from the full
// era PATCH so a drag doesn't need to round-trip every field.
export const PUT: APIRoute = async ({ locals, params, request }) => {
  if (!locals.user) return jsonError("Not authenticated.", 401);
  const existing = getOwnedEra(locals.user.id, params.id!);
  if (!existing) return jsonError("Era not found.", 404);

  const body = await readJson<{ lane?: unknown }>(request);
  const lane =
    body.lane === null ? null : typeof body.lane === "number" ? Math.max(0, Math.trunc(body.lane)) : null;
  return json({ era: setEraLane(existing, lane) });
};
