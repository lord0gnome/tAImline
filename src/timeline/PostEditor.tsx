import { type Component, createSignal, For, Show } from "solid-js";
import type { Precision } from "~/lib/dates.ts";
import type { EraDTO, PostDTO } from "./types.ts";

interface Props {
  post: PostDTO | null; // null = creating
  eras: EraDTO[];
  defaultEraId: string | null;
  defaultDate: string;
  onSaved: (post: PostDTO) => void;
  onDeleted: (id: string) => void;
  onCancel: () => void;
}

const PRECISIONS: Precision[] = ["day", "month", "year"];
const VISIBILITIES = ["inherit", "private", "gated", "unlisted", "public"] as const;

const PostEditor: Component<Props> = (props) => {
  const p = props.post;
  const [title, setTitle] = createSignal(p?.title ?? "");
  const [body, setBody] = createSignal(p?.bodyMd ?? "");
  const [eventDate, setEventDate] = createSignal(p?.eventDate ?? props.defaultDate);
  const [precision, setPrecision] = createSignal<Precision>(p?.eventPrecision ?? "day");
  const [eraId, setEraId] = createSignal<string>(p?.eraId ?? props.defaultEraId ?? "");
  const [visibility, setVisibility] = createSignal<string>(p?.visibility ?? "inherit");
  const [busy, setBusy] = createSignal(false);
  const [error, setError] = createSignal<string | null>(null);

  async function save(ev: Event) {
    ev.preventDefault();
    setBusy(true);
    setError(null);
    const body_ = {
      title: title(),
      bodyMd: body(),
      eraId: eraId() || null,
      eventDate: eventDate(),
      eventPrecision: precision(),
      visibility: visibility(),
    };
    const res = await fetch(p ? `/api/posts/${p.id}` : "/api/posts", {
      method: p ? "PATCH" : "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(body_),
    });
    setBusy(false);
    if (!res.ok) {
      setError((await res.json().catch(() => ({}))).error ?? "Could not save the moment.");
      return;
    }
    props.onSaved((await res.json()).post);
  }

  async function remove() {
    if (!p || !confirm(`Delete "${p.title}"?`)) return;
    setBusy(true);
    const res = await fetch(`/api/posts/${p.id}`, {
      method: "DELETE",
      headers: { "content-type": "application/json" },
    });
    setBusy(false);
    if (res.ok) props.onDeleted(p.id);
    else setError("Could not delete the moment.");
  }

  return (
    <aside class="era-editor">
      <form onSubmit={save}>
        <h2>{p ? "Edit moment" : "New moment"}</h2>

        <label>
          Title
          <input type="text" value={title()} required onInput={(e) => setTitle(e.currentTarget.value)} />
        </label>

        <div class="era-editor__row">
          <label>
            Date
            <input type="date" value={eventDate()} required onInput={(e) => setEventDate(e.currentTarget.value)} />
          </label>
          <label>
            Precision
            <select value={precision()} onChange={(e) => setPrecision(e.currentTarget.value as Precision)}>
              <For each={PRECISIONS}>{(pr) => <option value={pr}>{pr}</option>}</For>
            </select>
          </label>
        </div>

        <label>
          Era
          <select value={eraId()} onChange={(e) => setEraId(e.currentTarget.value)}>
            <option value="">— none (free-floating) —</option>
            <For each={props.eras}>{(e) => <option value={e.id}>{e.title}</option>}</For>
          </select>
        </label>

        <label>
          Visibility
          <select value={visibility()} onChange={(e) => setVisibility(e.currentTarget.value)}>
            <For each={VISIBILITIES}>{(v) => <option value={v}>{v}</option>}</For>
          </select>
        </label>

        <label>
          Story (markdown)
          <textarea rows={10} value={body()} onInput={(e) => setBody(e.currentTarget.value)} />
        </label>

        <Show when={error()}>
          <p class="era-editor__error">{error()}</p>
        </Show>

        <div class="era-editor__actions">
          <button type="submit" class="btn btn--primary" disabled={busy()}>
            {p ? "Save" : "Create"}
          </button>
          <button type="button" class="btn" onClick={props.onCancel} disabled={busy()}>
            Cancel
          </button>
          <Show when={p}>
            <button type="button" class="btn era-editor__delete" onClick={remove} disabled={busy()}>
              Delete
            </button>
          </Show>
        </div>
      </form>
    </aside>
  );
};

export default PostEditor;
