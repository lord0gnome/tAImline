import { Google } from "arctic";

/** Google profile claims we care about, read from the OIDC id token. */
export interface GoogleClaims {
  sub: string;
  email?: string;
  emailVerified?: boolean;
  name?: string;
  picture?: string;
}

export const GOOGLE_SCOPES = ["openid", "profile", "email"];

function baseUrl(): string {
  return process.env.PUBLIC_BASE_URL ?? "http://localhost:4321";
}

export function googleConfigured(): boolean {
  return Boolean(process.env.GOOGLE_CLIENT_ID && process.env.GOOGLE_CLIENT_SECRET);
}

export function getGoogle(): Google {
  const clientId = process.env.GOOGLE_CLIENT_ID;
  const clientSecret = process.env.GOOGLE_CLIENT_SECRET;
  if (!clientId || !clientSecret) {
    throw new Error("Google OAuth is not configured (GOOGLE_CLIENT_ID/SECRET)");
  }
  return new Google(clientId, clientSecret, `${baseUrl()}/auth/google/callback`);
}

/**
 * Decode (without re-verifying) the OIDC id token. Safe here because the token
 * came straight from Google's token endpoint over TLS in the code exchange.
 */
export function decodeIdToken(idToken: string): GoogleClaims {
  const part = idToken.split(".")[1];
  if (!part) throw new Error("Malformed id token");
  const payload = JSON.parse(Buffer.from(part, "base64url").toString("utf8"));
  return {
    sub: String(payload.sub),
    email: payload.email,
    emailVerified: payload.email_verified,
    name: payload.name,
    picture: payload.picture,
  };
}
