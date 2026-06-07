import { type Component, createSignal, For, onMount, Show } from "solid-js";

interface TokenInfo {
  id: string;
  name: string;
  prefix: string;
  createdAt: number;
  lastUsedAt: number | null;
}

const fmt = (epoch: number | null) =>
  epoch ? new Date(epoch * 1000).toLocaleDateString() : "never";

const TokenManager: Component = () => {
  const [tokens, setTokens] = createSignal<TokenInfo[]>([]);
  const [name, setName] = createSignal("");
  const [fresh, setFresh] = createSignal<string | null>(null);
  const [busy, setBusy] = createSignal(false);

  async function refresh() {
    const res = await fetch("/api/tokens");
    if (res.ok) setTokens((await res.json()).tokens);
  }
  onMount(refresh);

  async function create(ev: Event) {
    ev.preventDefault();
    setBusy(true);
    const res = await fetch("/api/tokens", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ name: name() }),
    });
    setBusy(false);
    if (res.ok) {
      const data = await res.json();
      setFresh(data.token);
      setName("");
      void refresh();
    }
  }

  async function revoke(id: string) {
    if (!confirm("Revoke this token? Clients using it will stop working.")) return;
    const res = await fetch(`/api/tokens/${id}`, { method: "DELETE" });
    if (res.ok) void refresh();
  }

  return (
    <div>
      <form class="tok__create" onSubmit={create}>
        <input
          type="text"
          placeholder="Token name (e.g. Claude Desktop)"
          value={name()}
          onInput={(e) => setName(e.currentTarget.value)}
        />
        <button class="btn btn--primary" type="submit" disabled={busy()}>
          Create token
        </button>
      </form>

      <Show when={fresh()}>
        <div class="tok__fresh card">
          <strong>Copy this token now — it won't be shown again:</strong>
          <code class="tok__value">{fresh()}</code>
          <button class="btn" onClick={() => navigator.clipboard?.writeText(fresh()!)}>
            Copy
          </button>
        </div>
      </Show>

      <table class="tok__table">
        <thead>
          <tr>
            <th>Name</th>
            <th>Prefix</th>
            <th>Created</th>
            <th>Last used</th>
            <th />
          </tr>
        </thead>
        <tbody>
          <For each={tokens()} fallback={<tr><td colspan="5" class="muted">No tokens yet.</td></tr>}>
            {(t) => (
              <tr>
                <td>{t.name}</td>
                <td><code>{t.prefix}</code></td>
                <td>{fmt(t.createdAt)}</td>
                <td>{fmt(t.lastUsedAt)}</td>
                <td>
                  <button class="btn tok__revoke" onClick={() => revoke(t.id)}>
                    Revoke
                  </button>
                </td>
              </tr>
            )}
          </For>
        </tbody>
      </table>
    </div>
  );
};

export default TokenManager;
