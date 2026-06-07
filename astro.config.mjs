// @ts-check
import { defineConfig } from "astro/config";
import node from "@astrojs/node";
import solid from "@astrojs/solid-js";

// https://astro.build/config
export default defineConfig({
  output: "server",
  adapter: node({ mode: "standalone" }),
  integrations: [solid()],
  security: {
    // Disabled deliberately: the app runs behind a TLS-terminating ingress, so
    // the server sees scheme http while browsers send an https Origin — the
    // built-in check then rejects same-site POST/DELETE as "cross-site"
    // (BUG-1 logout, BUG-2 era delete). CSRF is instead covered by SameSite=Lax
    // session/OAuth cookies (browsers don't attach them to cross-site state-
    // changing requests) and there are no state-changing GET endpoints. API
    // tokens (bearer) are not cookie-based and so are inherently CSRF-immune.
    checkOrigin: false,
  },
  server: {
    port: Number(process.env.PORT ?? 4321),
    host: true,
  },
});
