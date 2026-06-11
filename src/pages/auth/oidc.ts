import type { APIRoute } from "astro";
import {
  buildAuthUrl,
  discover,
  generateCodeVerifier,
  generateState,
  oidcRedirectUri,
} from "~/auth/oidc.ts";
import { getOidcConfig, oidcEnabled } from "~/lib/oidcConfig.ts";
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

export const GET: APIRoute = async ({ cookies, redirect, request, clientAddress }) => {
  if (!oidcEnabled()) {
    return new Response("OIDC sign-in is not configured.", { status: 503 });
  }
  if (!rateLimit(`auth:${clientKey(request, null, clientAddress)}`, 20, 60_000)) {
    return new Response("Too many requests, slow down.", { status: 429 });
  }

  const cfg = getOidcConfig()!;
  const state = generateState();
  const verifier = generateCodeVerifier();

  let url: string;
  try {
    const doc = await discover(cfg.issuer!);
    url = buildAuthUrl(doc, {
      clientId: cfg.clientId!,
      scopes: cfg.scopes,
      state,
      verifier,
      redirectUri: oidcRedirectUri(),
    });
  } catch {
    return new Response("OIDC discovery failed — check the issuer URL.", { status: 502 });
  }

  const secure = (process.env.PUBLIC_BASE_URL ?? "").startsWith("https");
  cookies.set("oidc_oauth_state", state, COOKIE_OPTS(secure));
  cookies.set("oidc_code_verifier", verifier, COOKIE_OPTS(secure));

  return redirect(url);
};
