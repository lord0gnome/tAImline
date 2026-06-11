import type { APIRoute } from "astro";
import { json, jsonError, readJson } from "~/lib/http.ts";
import { getPublicOidcConfig, updateOidcConfig } from "~/lib/oidcConfig.ts";

export const prerender = false;

/** Admin-only: both handlers require an authenticated admin (email ∈ ADMIN_EMAILS). */
function requireAdmin(locals: App.Locals): Response | null {
  if (!locals.user) return jsonError("Not authenticated.", 401);
  if (!locals.isAdmin) return jsonError("Admin access required.", 403);
  return null;
}

export const GET: APIRoute = ({ locals }) => {
  const denied = requireAdmin(locals);
  if (denied) return denied;
  return json({ config: getPublicOidcConfig() });
};

export const PUT: APIRoute = async ({ locals, request }) => {
  const denied = requireAdmin(locals);
  if (denied) return denied;
  const result = updateOidcConfig(await readJson(request));
  if (!result.ok) return jsonError(result.error);
  return json({ config: result.config });
};
