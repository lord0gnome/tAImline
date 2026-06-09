import { type Component, For, Show } from "solid-js";
import { formatByPrecision, formatSpan } from "~/lib/dates.ts";
import type { EraDTO, PostDTO } from "./types.ts";

interface Props {
  era: EraDTO;
  posts: PostDTO[]; // posts belonging to this era
  focused: boolean;
  readOnly?: boolean;
  onEdit: () => void;
  onAddMoment: () => void;
  onOpenPost: (p: PostDTO) => void;
  onToggleFocus: () => void;
  onClose: () => void;
}

const EraDetail: Component<Props> = (props) => {
  return (
    <aside class="era-editor era-detail">
      <div class="era-detail__head">
        <span class="era-detail__swatch" style={{ background: props.era.color ?? "var(--accent)" }} />
        <div>
          <h2 style={{ margin: 0 }}>{props.era.title}</h2>
          <p class="muted" style={{ margin: "0.15rem 0 0" }}>
            {formatSpan(
              props.era.startDate,
              props.era.startPrecision,
              props.era.endDate,
              props.era.endPrecision,
            )}
          </p>
          <Show when={props.era.categories.length}>
            <div class="cat-chips">
              <For each={props.era.categories}>{(c) => <span class="cat-chip cat-chip--static">{c}</span>}</For>
            </div>
          </Show>
        </div>
      </div>

      <Show when={props.era.descriptionHtml}>
        <div class="era-detail__body" innerHTML={props.era.descriptionHtml ?? ""} />
      </Show>

      <div class="era-detail__moments">
        <div class="era-detail__moments-head">
          <strong>Moments</strong>
          <Show when={!props.readOnly}>
            <button class="btn" onClick={props.onAddMoment}>+ Add moment</button>
          </Show>
        </div>
        <For
          each={props.posts}
          fallback={<p class="muted" style={{ "font-size": "0.85rem" }}>No moments in this era yet.</p>}
        >
          {(p) => (
            <button class="era-detail__moment" onClick={() => props.onOpenPost(p)}>
              <span class="era-detail__moment-date muted">
                {formatByPrecision(p.eventDate, p.eventPrecision)}
              </span>
              <span class="era-detail__moment-title">{p.title}</span>
            </button>
          )}
        </For>
      </div>

      <div class="era-editor__actions">
        <button class="btn btn--primary" onClick={props.onToggleFocus}>
          {props.focused ? "Remove from focus" : "Focus this era"}
        </button>
        <Show when={!props.readOnly}>
          <button class="btn" onClick={props.onEdit}>Edit</button>
        </Show>
        <button class="btn" onClick={props.onClose} style={{ "margin-left": "auto" }}>Close</button>
      </div>
    </aside>
  );
};

export default EraDetail;
