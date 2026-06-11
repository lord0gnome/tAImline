import { createHash, randomBytes } from "node:crypto";

/** Identity claims we read from a generic OIDC provider. */
export interface OidcClaims {
  sub: string;
  email?: string;
  emailVerified?: boolean;
  name?: string;
  preferredUsername?: string;
  picture?: string;
}

interface Discovery {
  authorization_endpoint: string;
  token_endpoint: string;
  userinfo_endpoint?: string;
  issuer: string;
}

export function baseUrl(): string {
  return process.env.PUBLIC_BASE_URL ?? "http://localhost:4321";
}

export function oidcRedirectUri(): string {
  return `${baseUrl()}/auth/oidc/callback`;
}

// --- PKCE / state helpers ---------------------------------------------------
const b64url = (b: Buffer) => b.toString("base64url");
export const generateState = () => b64url(randomBytes(32));
export const generateCodeVerifier = () => b64url(randomBytes(32));
export const codeChallenge = (verifier: string) =>
  b64url(createHash("sha256").update(verifier).digest());

// --- discovery (cached briefly to avoid a round-trip on every sign-in) ------
const discoveryCache = new Map<string, { doc: Discovery; at: number }>();
const DISCOVERY_TTL = 10 * 60_000;

export async function discover(issuer: string): Promise<Discovery> {
  const key = issuer.replace(/\/+$/, "");
  const hit = discoveryCache.get(key);
  if (hit && Date.now() - hit.at < DISCOVERY_TTL) return hit.doc;

  const res = await fetch(`${key}/.well-known/openid-configuration`, {
    headers: { accept: "application/json" },
  });
  if (!res.ok) throw new Error(`OIDC discovery failed (${res.status}) for ${key}`);
  const doc = (await res.json()) as Discovery;
  if (!doc.authorization_endpoint || !doc.token_endpoint) {
    throw new Error("OIDC discovery document is missing required endpoints.");
  }
  discoveryCache.set(key, { doc, at: Date.now() });
  return doc;
}

export function buildAuthUrl(
  doc: Discovery,
  opts: { clientId: string; scopes: string; state: string; verifier: string; redirectUri: string },
): string {
  const u = new URL(doc.authorization_endpoint);
  u.searchParams.set("response_type", "code");
  u.searchParams.set("client_id", opts.clientId);
  u.searchParams.set("redirect_uri", opts.redirectUri);
  u.searchParams.set("scope", opts.scopes);
  u.searchParams.set("state", opts.state);
  u.searchParams.set("code_challenge", codeChallenge(opts.verifier));
  u.searchParams.set("code_challenge_method", "S256");
  return u.toString();
}

interface TokenResponse {
  id_token?: string;
  access_token?: string;
}

/** Exchange the authorization code for tokens (client_secret_post + PKCE). */
async function exchangeCode(
  doc: Discovery,
  opts: { clientId: string; clientSecret: string; code: string; verifier: string; redirectUri: string },
): Promise<TokenResponse> {
  const body = new URLSearchParams({
    grant_type: "authorization_code",
    code: opts.code,
    redirect_uri: opts.redirectUri,
    client_id: opts.clientId,
    client_secret: opts.clientSecret,
    code_verifier: opts.verifier,
  });
  const res = await fetch(doc.token_endpoint, {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded", accept: "application/json" },
    body,
  });
  if (!res.ok) {
    const detail = await res.text().catch(() => "");
    throw new Error(`token exchange failed (${res.status})${detail ? `: ${detail.slice(0, 200)}` : ""}`);
  }
  return (await res.json()) as TokenResponse;
}

/** Decode (without re-verifying) an OIDC id token — safe because it came
 *  straight from the provider's token endpoint over TLS in the code exchange. */
function decodeIdToken(idToken: string): Partial<OidcClaims> {
  const part = idToken.split(".")[1];
  if (!part) throw new Error("Malformed id token");
  const payload = JSON.parse(Buffer.from(part, "base64url").toString("utf8"));
  return {
    sub: payload.sub != null ? String(payload.sub) : undefined,
    email: payload.email,
    emailVerified: payload.email_verified,
    name: payload.name,
    preferredUsername: payload.preferred_username,
    picture: payload.picture,
  };
}

async function fetchUserinfo(doc: Discovery, accessToken: string): Promise<Partial<OidcClaims>> {
  if (!doc.userinfo_endpoint) return {};
  try {
    const res = await fetch(doc.userinfo_endpoint, {
      headers: { authorization: `Bearer ${accessToken}`, accept: "application/json" },
    });
    if (!res.ok) return {};
    const p = (await res.json()) as Record<string, unknown>;
    return {
      sub: p.sub != null ? String(p.sub) : undefined,
      email: typeof p.email === "string" ? p.email : undefined,
      emailVerified: typeof p.email_verified === "boolean" ? p.email_verified : undefined,
      name: typeof p.name === "string" ? p.name : undefined,
      preferredUsername: typeof p.preferred_username === "string" ? p.preferred_username : undefined,
      picture: typeof p.picture === "string" ? p.picture : undefined,
    };
  } catch {
    return {};
  }
}

/**
 * Complete the code exchange and resolve a normalized claims object. Falls back
 * to the userinfo endpoint when the id token omits email/name.
 */
export async function completeOidcLogin(
  doc: Discovery,
  opts: { clientId: string; clientSecret: string; code: string; verifier: string; redirectUri: string },
): Promise<OidcClaims> {
  const tokens = await exchangeCode(doc, opts);
  if (!tokens.id_token) throw new Error("No id_token in token response.");
  let claims = decodeIdToken(tokens.id_token);

  if ((!claims.email || !claims.name) && tokens.access_token) {
    const info = await fetchUserinfo(doc, tokens.access_token);
    claims = { ...info, ...claims }; // id_token wins on conflicts
    if (!claims.email && info.email) claims.email = info.email;
    if (!claims.name && info.name) claims.name = info.name;
  }

  if (!claims.sub) throw new Error("OIDC claims missing 'sub'.");
  return claims as OidcClaims;
}
