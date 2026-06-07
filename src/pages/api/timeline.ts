import type { APIRoute } from "astro";
import { isValidISODate } from "~/lib/dates.ts";
import { listErasForUser } from "~/lib/eras.ts";
import { json, jsonError } from "~/lib/http.ts";
import type { TimelineData } from "~/timeline/types.ts";

export const prerender = false;

/**
 * Windowed timeline data for the signed-in user (edit mode). `from`/`to` are
 * optional YYYY-MM-DD bounds; when present only eras overlapping the window are
 * returned. Posts (clustered when zoomed out) arrive in M3.
 */
export const GET: APIRoute = ({ locals, url }) => {
  if (!locals.user) return jsonError("Not authenticated.", 401);

  const from = url.searchParams.get("from");
  const to = url.searchParams.get("to");

  let range: { from: string; to: string } | undefined;
  if (from || to) {
    if (!from || !to || !isValidISODate(from) || !isValidISODate(to)) {
      return jsonError("from and to must both be valid YYYY-MM-DD dates.", 400);
    }
    range = { from, to };
  }

  const data: TimelineData = { eras: listErasForUser(locals.user.id, range) };
  return json(data);
};
