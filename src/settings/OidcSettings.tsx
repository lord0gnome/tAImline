import { type Component, createSignal, onMount, Show } from "solid-js";

interface PublicOidcConfig {
  enabled: boolean;
  label: string;
  issuer: string;
  clientId: string;
  scopes: string;
  hasSecret: boolean;
}

interface Props {
  /** Public base URL, to display the redirect URI the IdP must allow. */
  redirectUri: string;
}

const OidcSettings: Component<Props> = (props) => {
  const [enabled, setEnabled] = createSignal(false);
  const [label, setLabel] = createSignal("OIDC");
  const [issuer, setIssuer] = createSignal("");
  const [clientId, setClientId] = createSignal("");
  const [scopes, setScopes] = createSignal("openid profile email");
  const [secret, setSecret] = createSignal(""); // blank = keep existing
  const [hasSecret, setHasSecret] = createSignal(false);
  const [loaded, setLoaded] = createSignal(false);
  const [status, setStatus] = createSignal<string | null>(null);
  const [busy, setBusy] = createSignal(false);

  function apply(c: PublicOidcConfig) {
    setEnabled(c.enabled);
    setLabel(c.label);
    setIssuer(c.issuer);
    setClientId(c.clientId);
    setScopes(c.scopes);
    setHasSecret(c.hasSecret);
    setSecret("");
  }

  onMount(async () => {
    const res = await fetch("/api/admin/oidc");
    if (res.ok) apply((await res.json()).config);
    setLoaded(true);
  });

  async function save(ev: Event) {
    ev.preventDefault();
    setBusy(true);
    setStatus(null);
    const body: Record<string, unknown> = {
      enabled: enabled(),
      label: label(),
      issuer: issuer(),
      clientId: clientId(),
      scopes: scopes(),
    };
    if (secret()) body.clientSecret = secret(); // only send when changing it
    const res = await fetch("/api/admin/oidc", {
      method: "PUT",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(body),
    });
    setBusy(false);
    if (res.ok) {
      apply((await res.json()).config);
      setStatus("Saved.");
    } else {
      setStatus((await res.json().catch(() => ({}))).error ?? "Could not save.");
    }
  }

  return (
    <form
      class="era-editor"
      style={{ padding: 0, border: 0, width: "auto", "box-shadow": "none" }}
      onSubmit={save}
    >
      <p class="muted" style={{ "font-size": "0.85rem", margin: "0 0 0.5rem" }}>
        Redirect URI to register with your IdP:{" "}
        <code>{props.redirectUri}</code>
      </p>

      <label class="era-editor__check">
        <input type="checkbox" checked={enabled()} onChange={(e) => setEnabled(e.currentTarget.checked)} />
        Enable OIDC sign-in
      </label>

      <div class="era-editor__row">
        <label>
          Button label
          <input type="text" value={label()} placeholder="Authentik" onInput={(e) => setLabel(e.currentTarget.value)} />
        </label>
        <label>
          Scopes
          <input type="text" value={scopes()} onInput={(e) => setScopes(e.currentTarget.value)} />
        </label>
      </div>

      <label>
        Issuer URL
        <input
          type="url"
          value={issuer()}
          placeholder="https://id.example.com/application/o/taimline/"
          onInput={(e) => setIssuer(e.currentTarget.value)}
        />
      </label>

      <label>
        Client ID
        <input type="text" value={clientId()} onInput={(e) => setClientId(e.currentTarget.value)} />
      </label>

      <label>
        Client secret
        <input
          type="password"
          value={secret()}
          placeholder={hasSecret() ? "•••••••• (leave blank to keep)" : "client secret"}
          autocomplete="off"
          onInput={(e) => setSecret(e.currentTarget.value)}
        />
      </label>

      <div class="era-editor__actions">
        <button class="btn btn--primary" type="submit" disabled={busy() || !loaded()}>
          Save OIDC settings
        </button>
        <Show when={status()}>
          <span class="muted" style={{ "align-self": "center" }}>{status()}</span>
        </Show>
      </div>
    </form>
  );
};

export default OidcSettings;
