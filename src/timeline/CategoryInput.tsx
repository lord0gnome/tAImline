import { type Component, createSignal, For, Show } from "solid-js";

interface Props {
  value: string[];
  /** Existing categories across the timeline, offered as autocomplete. */
  suggestions?: string[];
  onChange: (cats: string[]) => void;
}

const MAX_LEN = 40;

/**
 * Tag-style category editor: chips you can remove, plus a text field that
 * commits a tag on Enter or comma (and on blur). Dedupes case-insensitively.
 */
const CategoryInput: Component<Props> = (props) => {
  const [draft, setDraft] = createSignal("");

  const add = (raw: string) => {
    const tag = raw.trim().slice(0, MAX_LEN);
    if (!tag) return;
    const exists = props.value.some((c) => c.toLowerCase() === tag.toLowerCase());
    if (!exists) props.onChange([...props.value, tag]);
    setDraft("");
  };

  const remove = (i: number) => props.onChange(props.value.filter((_, j) => j !== i));

  const onKeyDown = (ev: KeyboardEvent) => {
    if (ev.key === "Enter" || ev.key === ",") {
      ev.preventDefault();
      add(draft());
    } else if (ev.key === "Backspace" && draft() === "" && props.value.length) {
      remove(props.value.length - 1);
    }
  };

  // Suggestions not already chosen.
  const available = () => {
    const chosen = new Set(props.value.map((c) => c.toLowerCase()));
    return (props.suggestions ?? []).filter((s) => !chosen.has(s.toLowerCase()));
  };

  return (
    <div class="cat-input">
      <div class="cat-input__chips">
        <For each={props.value}>
          {(c, i) => (
            <span class="cat-chip">
              {c}
              <button type="button" class="cat-chip__x" aria-label={`Remove ${c}`} onClick={() => remove(i())}>
                ✕
              </button>
            </span>
          )}
        </For>
        <input
          type="text"
          class="cat-input__field"
          value={draft()}
          list="cat-suggestions"
          placeholder={props.value.length ? "Add another…" : "e.g. Career, Travel"}
          onInput={(ev) => setDraft(ev.currentTarget.value)}
          onKeyDown={onKeyDown}
          onBlur={() => add(draft())}
        />
      </div>
      <Show when={available().length}>
        <datalist id="cat-suggestions">
          <For each={available()}>{(s) => <option value={s} />}</For>
        </datalist>
      </Show>
    </div>
  );
};

export default CategoryInput;
