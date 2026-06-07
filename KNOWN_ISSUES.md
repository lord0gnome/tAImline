# Known issues

## BUG-1 — Logout POST rejected: "Cross-site POST form submissions are forbidden"

**Symptom:** clicking **Sign out** (POST `/logout`) returns Astro's CSRF error
*"Cross-site POST form submissions are forbidden"* when running behind the
nginx-ingress on `https://taimline.morill.es`.

**Likely cause:** Astro 6's default `security.checkOrigin` compares the request
`Origin` header against the host; behind the TLS-terminating reverse proxy the
forwarded `Origin`/`Host` don't line up, so the same-site POST is treated as
cross-site.

**Candidate fixes (not yet applied):**
- Ensure the ingress forwards the original `Host`/`Origin` (it already sets
  `use-forwarded-headers`); verify what Astro actually sees.
- Or disable Astro's built-in check (`security: { checkOrigin: false }`) and add
  our own CSRF token to the logout form.
- Or make logout a same-origin `fetch()` POST with appropriate headers.

Status: deferred (noted 2026-06-07). Login/session flow otherwise works.
