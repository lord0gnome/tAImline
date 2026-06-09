import { type Component, createSignal, For, Show } from "solid-js";
import { formatByPrecision } from "~/lib/dates.ts";
import type { Precision } from "~/lib/dates.ts";
import CategoryInput from "./CategoryInput.tsx";
import DateField from "./DateField.tsx";
import { ERA_COLORS, type EraDTO, type PostDTO } from "./types.ts";

interface Props {
  era: EraDTO | null; // null = creating a new era
  defaultStart: string; // YYYY-MM-DD seed for new eras
  /** Start precision seed for new eras (e.g. "day" when double-clicked at a date). */
  defaultStartPrecision?: Precision;
  /** Existing categories across the timeline, for autocomplete. */
  categorySuggestions?: string[];
  /** Moments in this era (editing an existing era only). */
  posts?: PostDTO[];
  focused?: boolean;
  onAddMoment?: () => void;
  onOpenPost?: (p: PostDTO) => void;
  onToggleFocus?: () => void;
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
  const [startPrecision, setStartPrecision] = createSignal<Precision>(e?.startPrecision ?? props.defaultStartPrecision ?? "month");
  const [ongoing, setOngoing] = createSignal(e ? e.endDate === null : false);
  const [endDate, setEndDate] = createSignal(e?.endDate ?? props.defaultStart);
  const [endPrecision, setEndPrecision] = createSignal<Precision>(e?.endPrecision ?? "month");
  const [color, setColor] = createSignal<string>(e?.color ?? ERA_COLORS[0]);
  const [categories, setCategories] = createSignal<string[]>(e?.categories ?? []);
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
      categories: categories(),
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
            <DateField value={startDate()} precision={startPrecision()} required onChange={setStartDate} />
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
              <DateField value={endDate()} precision={endPrecision()} onChange={setEndDate} />
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
          Categories
          <CategoryInput value={categories()} suggestions={props.categorySuggestions} onChange={setCategories} />
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

        <Show when={e}>
          <div class="era-detail__moments">
            <div class="era-detail__moments-head">
              <strong>Moments</strong>
              <Show when={props.onAddMoment}>
                <button type="button" class="btn" onClick={() => props.onAddMoment?.()}>+ Add moment</button>
              </Show>
            </div>
            <For
              each={props.posts ?? []}
              fallback={<p class="muted" style={{ "font-size": "0.85rem" }}>No moments in this era yet.</p>}
            >
              {(p) => (
                <button type="button" class="era-detail__moment" onClick={() => props.onOpenPost?.(p)}>
                  <span class="era-detail__moment-date muted">
                    {formatByPrecision(p.eventDate, p.eventPrecision)}
                  </span>
                  <span class="era-detail__moment-title">{p.title}</span>
                </button>
              )}
            </For>
          </div>
        </Show>

        <div class="era-editor__actions">
          <button type="submit" class="btn btn--primary" disabled={busy()}>
            {e ? "Save" : "Create"}
          </button>
          <button type="button" class="btn" onClick={props.onCancel} disabled={busy()}>
            Cancel
          </button>
          <Show when={e && props.onToggleFocus}>
            <button type="button" class="btn" onClick={() => props.onToggleFocus?.()} disabled={busy()}>
              {props.focused ? "Unfocus" : "Focus"}
            </button>
          </Show>
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
