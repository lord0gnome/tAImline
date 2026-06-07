import type { APIRoute } from "astro";
import { generateCodeVerifier, generateState } from "arctic";
import { GOOGLE_SCOPES, getGoogle, googleConfigured } from "~/auth/google.ts";
import { clientKey, rateLimit } from "~/lib/ratelimit.ts";

export const prerender = false;

const COOKIE_OPTS = (secure: boolean) =>
  ({
    httpOnly: true,
    sameSite: "lax",
    secure,
    path: "/",
    maxAge: 600, // 10 minutes to complete the round-trip
  }) as const;

export const GET: APIRoute = ({ cookies, redirect, request, clientAddress }) => {
  if (!googleConfigured()) {
    return new Response("Google sign-in is not configured.", { status: 503 });
  }
  if (!rateLimit(`auth:${clientKey(request, null, clientAddress)}`, 20, 60_000)) {
    return new Response("Too many requests, slow down.", { status: 429 });
  }

  const state = generateState();
  const codeVerifier = generateCodeVerifier();
  const url = getGoogle().createAuthorizationURL(state, codeVerifier, GOOGLE_SCOPES);

  const secure = (process.env.PUBLIC_BASE_URL ?? "").startsWith("https");
  cookies.set("google_oauth_state", state, COOKIE_OPTS(secure));
  cookies.set("google_code_verifier", codeVerifier, COOKIE_OPTS(secure));

  return redirect(url.toString());
};
