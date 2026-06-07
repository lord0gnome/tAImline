import { type Component, createSignal } from "solid-js";

interface Props {
  handle: string;
  displayName: string;
  bio: string | null;
  birthDate: string | null;
  defaultVisibility: string;
}

const VIS = ["private", "gated", "unlisted", "public"] as const;

const ProfileSettings: Component<Props> = (props) => {
  const [handle, setHandle] = createSignal(props.handle);
  const [displayName, setDisplayName] = createSignal(props.displayName);
  const [bio, setBio] = createSignal(props.bio ?? "");
  const [birthDate, setBirthDate] = createSignal(props.birthDate ?? "");
  const [vis, setVis] = createSignal(props.defaultVisibility);
  const [status, setStatus] = createSignal<string | null>(null);
  const [busy, setBusy] = createSignal(false);

  async function save(ev: Event) {
    ev.preventDefault();
    setBusy(true);
    setStatus(null);
    const res = await fetch("/api/profile", {
      method: "PATCH",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        handle: handle(),
        displayName: displayName(),
        bio: bio(),
        birthDate: birthDate() || null,
        defaultVisibility: vis(),
      }),
    });
    setBusy(false);
    if (res.ok) setStatus("Saved.");
    else setStatus((await res.json().catch(() => ({}))).error ?? "Could not save.");
  }

  return (
    <form class="era-editor" style={{ padding: 0, border: 0, width: "auto", "box-shadow": "none" }} onSubmit={save}>
      <div class="era-editor__row">
        <label>Display name<input type="text" value={displayName()} onInput={(e) => setDisplayName(e.currentTarget.value)} /></label>
        <label>Handle<input type="text" value={handle()} onInput={(e) => setHandle(e.currentTarget.value)} /></label>
      </div>
      <div class="era-editor__row">
        <label>Birth date (timeline anchor)<input type="date" value={birthDate()} onInput={(e) => setBirthDate(e.currentTarget.value)} /></label>
        <label>
          Default visibility
          <select value={vis()} onChange={(e) => setVis(e.currentTarget.value)}>
            {VIS.map((v) => <option value={v}>{v}</option>)}
          </select>
        </label>
      </div>
      <label>Bio<textarea rows={3} value={bio()} onInput={(e) => setBio(e.currentTarget.value)} /></label>
      <div class="era-editor__actions">
        <button class="btn btn--primary" type="submit" disabled={busy()}>Save profile</button>
        {status() && <span class="muted" style={{ "align-self": "center" }}>{status()}</span>}
      </div>
    </form>
  );
};

export default ProfileSettings;
