import { type Component, createSignal, For, onMount, Show } from "solid-js";

interface ShareView {
  id: string;
  scope: "timeline" | "era";
  eraId: string | null;
  eraTitle: string | null;
  grantee: string;
  pending: boolean;
}
interface EraOpt {
  id: string;
  title: string;
}

const ShareManager: Component = () => {
  const [shares, setShares] = createSignal<ShareView[]>([]);
  const [eras, setEras] = createSignal<EraOpt[]>([]);
  const [scope, setScope] = createSignal<"timeline" | "era">("timeline");
  const [eraId, setEraId] = createSignal("");
  const [grantee, setGrantee] = createSignal("");
  const [error, setError] = createSignal<string | null>(null);
  const [busy, setBusy] = createSignal(false);

  async function refresh() {
    const r = await fetch("/api/shares");
    if (r.ok) setShares((await r.json()).shares);
  }
  onMount(async () => {
    await refresh();
    const r = await fetch("/api/eras");
    if (r.ok) setEras((await r.json()).eras.map((e: EraOpt) => ({ id: e.id, title: e.title })));
  });

  async function add(ev: Event) {
    ev.preventDefault();
    setBusy(true);
    setError(null);
    const g = grantee().trim();
    const payload: Record<string, unknown> = { scope: scope() };
    if (scope() === "era") payload.eraId = eraId();
    if (g.includes("@") && !g.startsWith("@")) payload.inviteEmail = g;
    else payload.granteeHandle = g;
    const res = await fetch("/api/shares", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(payload),
    });
    setBusy(false);
    if (res.ok) {
      setGrantee("");
      void refresh();
    } else {
      setError((await res.json().catch(() => ({}))).error ?? "Could not share.");
    }
  }

  async function revoke(id: string) {
    const res = await fetch(`/api/shares/${id}`, { method: "DELETE" });
    if (res.ok) void refresh();
  }

  return (
    <div>
      <form class="share__form" onSubmit={add}>
        <select value={scope()} onChange={(e) => setScope(e.currentTarget.value as "timeline" | "era")}>
          <option value="timeline">Whole timeline</option>
          <option value="era">A single era</option>
        </select>
        <Show when={scope() === "era"}>
          <select value={eraId()} onChange={(e) => setEraId(e.currentTarget.value)}>
            <option value="">— pick era —</option>
            <For each={eras()}>{(e) => <option value={e.id}>{e.title}</option>}</For>
          </select>
        </Show>
        <input
          type="text"
          placeholder="@handle or email"
          value={grantee()}
          onInput={(e) => setGrantee(e.currentTarget.value)}
        />
        <button class="btn btn--primary" type="submit" disabled={busy()}>Share</button>
      </form>
      <Show when={error()}><p class="era-editor__error">{error()}</p></Show>

      <table class="tok__table">
        <thead><tr><th>Who</th><th>Scope</th><th /></tr></thead>
        <tbody>
          <For each={shares()} fallback={<tr><td colspan="3" class="muted">No shares yet.</td></tr>}>
            {(s) => (
              <tr>
                <td>{s.grantee}{s.pending && <span class="muted"> (pending)</span>}</td>
                <td>{s.scope === "timeline" ? "Whole timeline" : `Era: ${s.eraTitle ?? "?"}`}</td>
                <td><button class="btn tok__revoke" onClick={() => revoke(s.id)}>Revoke</button></td>
              </tr>
            )}
          </For>
        </tbody>
      </table>
    </div>
  );
};

export default ShareManager;
