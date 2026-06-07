import { type Component, createSignal, For, Show } from "solid-js";
import type { Precision } from "~/lib/dates.ts";
import { ERA_COLORS, type EraDTO } from "./types.ts";

interface Props {
  era: EraDTO | null; // null = creating a new era
  defaultStart: string; // YYYY-MM-DD seed for new eras
  onSaved: (era: EraDTO) => void;
  onDeleted: (id: string) => void;
  onCancel: () => void;
}

const PRECISIONS: Precision[] = ["day", "month", "year"];
const VISIBILITIES = ["inherit", "private", "gated", "unlisted", "public"] as const;

const EraEditor: Component<Props> = (props) => {
  const e = props.era;
  const [title, setTitle] = createSignal(e?.title ?? "");
  const [description, setDescription] = createSignal(e?.descriptionMd ?? "");
  const [startDate, setStartDate] = createSignal(e?.startDate ?? props.defaultStart);
  const [startPrecision, setStartPrecision] = createSignal<Precision>(e?.startPrecision ?? "month");
  const [ongoing, setOngoing] = createSignal(e ? e.endDate === null : false);
  const [endDate, setEndDate] = createSignal(e?.endDate ?? props.defaultStart);
  const [endPrecision, setEndPrecision] = createSignal<Precision>(e?.endPrecision ?? "month");
  const [color, setColor] = createSignal<string>(e?.color ?? ERA_COLORS[0]);
  const [category, setCategory] = createSignal(e?.category ?? "");
  const [visibility, setVisibility] = createSignal<string>(e?.visibility ?? "inherit");

  const [busy, setBusy] = createSignal(false);
  const [error, setError] = createSignal<string | null>(null);

  async function save(ev: Event) {
    ev.preventDefault();
    setBusy(true);
    setError(null);
    const body = {
      title: title(),
      descriptionMd: description(),
      startDate: startDate(),
      startPrecision: startPrecision(),
      endDate: ongoing() ? null : endDate(),
      endPrecision: ongoing() ? null : endPrecision(),
      color: color(),
      category: category(),
      visibility: visibility(),
    };
    const res = await fetch(e ? `/api/eras/${e.id}` : "/api/eras", {
      method: e ? "PATCH" : "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(body),
    });
    setBusy(false);
    if (!res.ok) {
      const data = await res.json().catch(() => ({}));
      setError(data.error ?? "Could not save the era.");
      return;
    }
    const data = await res.json();
    props.onSaved(data.era);
  }

  async function remove() {
    if (!e) return;
    if (!confirm(`Delete "${e.title}"? This cannot be undone.`)) return;
    setBusy(true);
    const res = await fetch(`/api/eras/${e.id}`, { method: "DELETE" });
    setBusy(false);
    if (res.ok) props.onDeleted(e.id);
    else setError("Could not delete the era.");
  }

  return (
    <aside class="era-editor">
      <form onSubmit={save}>
        <h2>{e ? "Edit era" : "New era"}</h2>

        <label>
          Title
          <input type="text" value={title()} required onInput={(ev) => setTitle(ev.currentTarget.value)} />
        </label>

        <div class="era-editor__row">
          <label>
            Start
            <input type="date" value={startDate()} required onInput={(ev) => setStartDate(ev.currentTarget.value)} />
          </label>
          <label>
            Precision
            <select value={startPrecision()} onChange={(ev) => setStartPrecision(ev.currentTarget.value as Precision)}>
              <For each={PRECISIONS}>{(p) => <option value={p}>{p}</option>}</For>
            </select>
          </label>
        </div>

        <label class="era-editor__check">
          <input type="checkbox" checked={ongoing()} onChange={(ev) => setOngoing(ev.currentTarget.checked)} />
          Ongoing (no end date)
        </label>

        <Show when={!ongoing()}>
          <div class="era-editor__row">
            <label>
              End
              <input type="date" value={endDate()} onInput={(ev) => setEndDate(ev.currentTarget.value)} />
            </label>
            <label>
              Precision
              <select value={endPrecision()} onChange={(ev) => setEndPrecision(ev.currentTarget.value as Precision)}>
                <For each={PRECISIONS}>{(p) => <option value={p}>{p}</option>}</For>
              </select>
            </label>
          </div>
        </Show>

        <label>
          Color
          <div class="era-editor__swatches">
            <For each={ERA_COLORS}>
              {(c) => (
                <button
                  type="button"
                  class="swatch"
                  classList={{ "swatch--on": color() === c }}
                  style={{ background: c }}
                  aria-label={c}
                  onClick={() => setColor(c)}
                />
              )}
            </For>
          </div>
        </label>

        <label>
          Category
          <input type="text" value={category()} placeholder="e.g. Career, Travel" onInput={(ev) => setCategory(ev.currentTarget.value)} />
        </label>

        <label>
          Visibility
          <select value={visibility()} onChange={(ev) => setVisibility(ev.currentTarget.value)}>
            <For each={VISIBILITIES}>{(v) => <option value={v}>{v}</option>}</For>
          </select>
        </label>

        <label>
          Description (markdown)
          <textarea rows={5} value={description()} onInput={(ev) => setDescription(ev.currentTarget.value)} />
        </label>

        <Show when={error()}>
          <p class="era-editor__error">{error()}</p>
        </Show>

        <div class="era-editor__actions">
          <button type="submit" class="btn btn--primary" disabled={busy()}>
            {e ? "Save" : "Create"}
          </button>
          <button type="button" class="btn" onClick={props.onCancel} disabled={busy()}>
            Cancel
          </button>
          <Show when={e}>
            <button type="button" class="btn era-editor__delete" onClick={remove} disabled={busy()}>
              Delete
            </button>
          </Show>
        </div>
      </form>
    </aside>
  );
};

export default EraEditor;
