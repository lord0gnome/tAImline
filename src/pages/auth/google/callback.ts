import type { APIRoute } from "astro";
import { OAuth2RequestError } from "arctic";
import { upsertGoogleUser } from "~/auth/account.ts";
import { decodeIdToken, getGoogle } from "~/auth/google.ts";
import { createSession, generateSessionToken, setSessionCookie } from "~/auth/session.ts";

export const prerender = false;

export const GET: APIRoute = async ({ url, cookies, redirect }) => {
  const code = url.searchParams.get("code");
  const state = url.searchParams.get("state");
  const storedState = cookies.get("google_oauth_state")?.value ?? null;
  const codeVerifier = cookies.get("google_code_verifier")?.value ?? null;

  // Clear the transient flow cookies regardless of outcome.
  cookies.delete("google_oauth_state", { path: "/" });
  cookies.delete("google_code_verifier", { path: "/" });

  if (!code || !state || !storedState || !codeVerifier || state !== storedState) {
    return new Response("Invalid OAuth state.", { status: 400 });
  }

  let claims;
  try {
    const tokens = await getGoogle().validateAuthorizationCode(code, codeVerifier);
    claims = decodeIdToken(tokens.idToken());
  } catch (e) {
    const detail = e instanceof OAuth2RequestError ? e.code : "exchange_failed";
    return new Response(`Google sign-in failed (${detail}).`, { status: 400 });
  }

  const user = upsertGoogleUser(claims);
  const token = generateSessionToken();
  createSession(token, user.id);
  setSessionCookie(cookies, token);

  return redirect("/app");
};
