import type { APIRoute } from "astro";
import { deleteSessionCookie, invalidateSession } from "~/auth/session.ts";

export const prerender = false;

export const POST: APIRoute = ({ locals, cookies, redirect }) => {
  if (locals.sessionId) {
    invalidateSession(locals.sessionId);
  }
  deleteSessionCookie(cookies);
  return redirect("/");
};
