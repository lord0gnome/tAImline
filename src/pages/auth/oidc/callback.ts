import type { APIRoute } from "astro";
import { upsertOidcUser } from "~/auth/account.ts";
import { completeOidcLogin, discover, oidcRedirectUri } from "~/auth/oidc.ts";
import { createSession, generateSessionToken, setSessionCookie } from "~/auth/session.ts";
import { getOidcConfig, oidcEnabled } from "~/lib/oidcConfig.ts";

export const prerender = false;

export const GET: APIRoute = async ({ url, cookies, redirect }) => {
  const code = url.searchParams.get("code");
  const state = url.searchParams.get("state");
  const storedState = cookies.get("oidc_oauth_state")?.value ?? null;
  const verifier = cookies.get("oidc_code_verifier")?.value ?? null;

  // Clear the transient flow cookies regardless of outcome.
  cookies.delete("oidc_oauth_state", { path: "/" });
  cookies.delete("oidc_code_verifier", { path: "/" });

  if (!oidcEnabled()) {
    return new Response("OIDC sign-in is not configured.", { status: 503 });
  }
  if (!code || !state || !storedState || !verifier || state !== storedState) {
    return new Response("Invalid OAuth state.", { status: 400 });
  }

  const cfg = getOidcConfig()!;
  let claims;
  try {
    const doc = await discover(cfg.issuer!);
    claims = await completeOidcLogin(doc, {
      clientId: cfg.clientId!,
      clientSecret: cfg.clientSecret!,
      code,
      verifier,
      redirectUri: oidcRedirectUri(),
    });
  } catch {
    return new Response("OIDC sign-in failed.", { status: 400 });
  }

  const user = upsertOidcUser(claims);
  const token = generateSessionToken();
  createSession(token, user.id);
  setSessionCookie(cookies, token);

  return redirect("/app");
};
