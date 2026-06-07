import type { APIRoute } from "astro";
import { devLoginEnabled, getOrCreateDevUser } from "~/auth/dev.ts";
import { createSession, generateSessionToken, setSessionCookie } from "~/auth/session.ts";

export const prerender = false;

// Local-only: sign in as the dev user. Disabled (404) unless DEV_LOGIN=1.
export const GET: APIRoute = ({ cookies, redirect }) => {
  if (!devLoginEnabled()) return new Response("Not found", { status: 404 });
  const user = getOrCreateDevUser();
  const token = generateSessionToken();
  createSession(token, user.id);
  setSessionCookie(cookies, token);
  return redirect("/app");
};
