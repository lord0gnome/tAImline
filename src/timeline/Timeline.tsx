import {
  type Component,
  createMemo,
  createSignal,
  For,
  onCleanup,
  onMount,
  Show,
} from "solid-js";
import { formatByPrecision, formatSpan, MS_DAY, msToISO, toMs } from "~/lib/dates.ts";
import EraEditor from "./EraEditor.tsx";
import EraDetail from "./EraDetail.tsx";
import PostEditor from "./PostEditor.tsx";
import { packLanes } from "./layout.ts";
import { generateTicks } from "./ruler.ts";
import { dateToX, fitRange, type Viewport, visibleRange, xToDate, zoomAt } from "./scale.ts";
import type { EraDTO, PostDTO } from "./types.ts";

interface Props {
  birthDate: string | null;
  storageEnabled: boolean;
}

const RULER_H = 34;
const LANE_H = 46;
const LANE_GAP = 8;
const MIN_BAR_PX = 8;
const POST_ROW_H = 30; // free-floating posts strip at the bottom
const PX_PER_MS_MIN = 5 / (3650 * MS_DAY); // ~5px per decade (max zoom-out)
const PX_PER_MS_MAX = 200 / MS_DAY; // 200px per day (max zoom-in)

const clampZoom = (v: number) => Math.min(PX_PER_MS_MAX, Math.max(PX_PER_MS_MIN, v));

const Timeline: Component<Props> = (props) => {
  const [eras, setEras] = createSignal<EraDTO[]>([]);
  const [posts, setPosts] = createSignal<PostDTO[]>([]);
  const [vp, setVp] = createSignal<Viewport>({ originMs: Date.now(), pxPerMs: 1 });
  const [width, setWidth] = createSignal(800);
  const [editing, setEditing] = createSignal<EraDTO | "new" | null>(null);
  const [editingPost, setEditingPost] = createSignal<PostDTO | "new" | null>(null);
  const [detailEra, setDetailEra] = createSignal<EraDTO | null>(null);
  const [newPostEraId, setNewPostEraId] = createSignal<string | null>(null);
  const [focus, setFocus] = createSignal<Set<string>>(new Set());
  const [loaded, setLoaded] = createSignal(false);

  let containerRef: HTMLDivElement | undefined;
  const nowMs = Date.now();

  const endMsOf = (e: EraDTO) => (e.endDate ? toMs(e.endDate) : nowMs);
  const overlaps = (a: EraDTO, b: EraDTO) =>
    toMs(a.startDate) < endMsOf(b) && toMs(b.startDate) < endMsOf(a);

  // Focus/solo view: show the focused eras plus any era overlapping them
  // (context), so overlapping chapters read together.
  function computeShown(list: EraDTO[], f: Set<string>): EraDTO[] {
    if (f.size === 0) return list;
    const focused = list.filter((e) => f.has(e.id));
    return list.filter((e) => f.has(e.id) || focused.some((g) => overlaps(e, g)));
  }

  // Initial framing: span all eras (or birth→now, or last ~30y) with padding.
  function frame(list: EraDTO[], w: number): Viewport {
    let from: number;
    let to: number;
    if (list.length > 0) {
      from = Math.min(...list.map((e) => toMs(e.startDate)));
      to = Math.max(...list.map(endMsOf));
    } else if (props.birthDate) {
      from = toMs(props.birthDate);
      to = nowMs;
    } else {
      to = nowMs;
      from = nowMs - 30 * 365 * MS_DAY;
    }
    const fitted = fitRange(from, to, w, 0.06);
    return { ...fitted, pxPerMs: clampZoom(fitted.pxPerMs) };
  }

  async function load() {
    const res = await fetch("/api/timeline");
    const data = res.ok ? await res.json() : { eras: [], posts: [] };
    const list: EraDTO[] = data.eras ?? [];
    setEras(list);
    setPosts(data.posts ?? []);
    if (!loaded()) setVp(frame(list, width()));
    setLoaded(true);
  }

  onMount(() => {
    if (containerRef) setWidth(containerRef.clientWidth);
    const onResize = () => containerRef && setWidth(containerRef.clientWidth);
    window.addEventListener("resize", onResize);
    onCleanup(() => window.removeEventListener("resize", onResize));
    void load();
  });

  // Eras/posts currently on screen (all, or the focused subset).
  const shownEras = createMemo(() => computeShown(eras(), focus()));
  const shownPosts = createMemo(() => {
    if (focus().size === 0) return posts();
    const ids = new Set(shownEras().map((e) => e.id));
    return posts().filter((p) => p.eraId && ids.has(p.eraId));
  });

  // Lane assignment over the shown eras (ongoing eras end "now").
  const lanes = createMemo(() =>
    packLanes(shownEras().map((e) => ({ id: e.id, startMs: toMs(e.startDate), endMs: endMsOf(e) }))),
  );

  const ticks = createMemo(() => {
    const { from, to } = visibleRange(vp(), width());
    return generateTicks(from, to, vp().pxPerMs);
  });

  // Virtualized set of eras whose bar intersects the viewport.
  const visibleEras = createMemo(() => {
    const w = width();
    const v = vp();
    return shownEras().filter((e) => {
      const x1 = dateToX(toMs(e.startDate), v);
      const x2 = dateToX(endMsOf(e), v);
      return x2 >= -50 && x1 <= w + 50;
    });
  });

  const laneTop = (eraId: string) =>
    RULER_H + LANE_GAP + lanes().lanes[eraId] * (LANE_H + LANE_GAP);
  const lanesBottom = () => RULER_H + lanes().laneCount * (LANE_H + LANE_GAP) + LANE_GAP;

  // A post is "free-floating" if it has no era or its era isn't on the timeline.
  const isFree = (p: PostDTO) => !p.eraId || lanes().lanes[p.eraId] === undefined;
  const hasFreePosts = () => shownPosts().some(isFree);

  const contentHeight = () => lanesBottom() + (hasFreePosts() ? POST_ROW_H : 0);

  // Marker vertical position: a pin atop its era's bar, or the free strip.
  const postTop = (p: PostDTO) => (isFree(p) ? lanesBottom() + 4 : laneTop(p.eraId!) + 4);

  // Virtualized set of posts whose marker is within the viewport.
  const visiblePosts = createMemo(() => {
    const w = width();
    const v = vp();
    return shownPosts().filter((p) => {
      const x = dateToX(toMs(p.eventDate), v);
      return x >= -20 && x <= w + 20;
    });
  });

  // ---- focus controls ---------------------------------------------------
  function applyFocus(f: Set<string>) {
    setFocus(f);
    const shown = computeShown(eras(), f);
    setVp(frame(shown.length ? shown : eras(), width()));
  }
  function toggleFocus(id: string) {
    const f = new Set(focus());
    f.has(id) ? f.delete(id) : f.add(id);
    applyFocus(f);
  }
  const focusedEras = () => eras().filter((e) => focus().has(e.id));

  // ---- interaction: wheel zoom + drag pan -------------------------------
  function onWheel(ev: WheelEvent) {
    ev.preventDefault();
    const rect = containerRef!.getBoundingClientRect();
    const anchorX = ev.clientX - rect.left;
    const factor = Math.exp(-ev.deltaY * 0.0015); // smooth, cursor-anchored
    const v = vp();
    const next = zoomAt(v, anchorX, factor);
    setVp({ ...next, pxPerMs: clampZoom(next.pxPerMs) });
  }

  let dragging = false;
  let lastX = 0;
  function onPointerDown(ev: PointerEvent) {
    dragging = true;
    lastX = ev.clientX;
    (ev.currentTarget as HTMLElement).setPointerCapture(ev.pointerId);
  }
  function onPointerMove(ev: PointerEvent) {
    if (!dragging) return;
    const dx = ev.clientX - lastX;
    lastX = ev.clientX;
    const v = vp();
    setVp({ ...v, originMs: v.originMs - dx / v.pxPerMs });
  }
  function onPointerUp(ev: PointerEvent) {
    dragging = false;
    (ev.currentTarget as HTMLElement).releasePointerCapture?.(ev.pointerId);
  }

  // ---- editor wiring ----------------------------------------------------
  const defaultStart = () => msToISO(Math.round(xToDate(width() / 2, vp())));

  function onSaved(saved: EraDTO) {
    setEras((prev) => {
      const i = prev.findIndex((e) => e.id === saved.id);
      if (i === -1) return [...prev, saved];
      const copy = [...prev];
      copy[i] = saved;
      return copy;
    });
    if (detailEra()?.id === saved.id) setDetailEra(saved);
    setEditing(null);
  }
  function onDeleted(id: string) {
    setEras((prev) => prev.filter((e) => e.id !== id));
    // Detach posts whose era was removed so they fall to the free strip.
    setPosts((prev) => prev.map((p) => (p.eraId === id ? { ...p, eraId: null } : p)));
    if (focus().has(id)) {
      const f = new Set(focus());
      f.delete(id);
      setFocus(f);
    }
    if (detailEra()?.id === id) setDetailEra(null);
    setEditing(null);
  }

  // Open a fresh moment editor pre-attached to an era.
  function addMomentTo(eraId: string | null) {
    setNewPostEraId(eraId);
    setDetailEra(null);
    setEditingPost("new");
  }
  const postsInEra = (eraId: string) => posts().filter((p) => p.eraId === eraId);

  function onSavedPost(saved: PostDTO) {
    setPosts((prev) => {
      const i = prev.findIndex((p) => p.id === saved.id);
      if (i === -1) return [...prev, saved];
      const copy = [...prev];
      copy[i] = saved;
      return copy;
    });
    setEditingPost(null);
  }
  function onDeletedPost(id: string) {
    setPosts((prev) => prev.filter((p) => p.id !== id));
    setEditingPost(null);
  }

  const todayX = () => dateToX(nowMs, vp());

  return (
    <div class="tl">
      <div class="tl__toolbar">
        <button class="btn btn--primary" onClick={() => setEditing("new")}>
          + New era
        </button>
        <button class="btn" onClick={() => addMomentTo(null)}>
          + New moment
        </button>
        <button class="btn" onClick={() => setVp(frame(shownEras(), width()))}>
          Fit
        </button>
        <Show
          when={focus().size > 0}
          fallback={<span class="tl__hint muted">drag to pan · scroll to zoom · click an era to focus</span>}
        >
          <span class="tl__focus">
            <span class="muted">Focusing:</span>
            <For each={focusedEras()}>
              {(e) => (
                <button class="tl__chip" onClick={() => toggleFocus(e.id)} title="Remove from focus">
                  {e.title} ✕
                </button>
              )}
            </For>
            <button class="btn" onClick={() => applyFocus(new Set())}>Show all</button>
          </span>
        </Show>
      </div>

      <div
        class="tl__canvas"
        ref={containerRef}
        style={{ height: `${contentHeight()}px` }}
        onWheel={onWheel}
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={onPointerUp}
        onPointerLeave={onPointerUp}
      >
        {/* ruler */}
        <div class="tl__ruler" style={{ height: `${RULER_H}px` }}>
          <For each={ticks()}>
            {(t) => (
              <div class="tl__tick" style={{ transform: `translateX(${dateToX(t.ms, vp())}px)` }}>
                <span>{t.label}</span>
              </div>
            )}
          </For>
        </div>

        {/* today marker */}
        <Show when={todayX() >= 0 && todayX() <= width()}>
          <div class="tl__today" style={{ transform: `translateX(${todayX()}px)`, top: `${RULER_H}px` }} />
        </Show>

        {/* era bars */}
        <For each={visibleEras()}>
          {(e) => {
            const startX = () => dateToX(toMs(e.startDate), vp());
            const w = () => Math.max(MIN_BAR_PX, dateToX(endMsOf(e), vp()) - startX());
            const top = () => RULER_H + LANE_GAP + lanes().lanes[e.id] * (LANE_H + LANE_GAP);
            return (
              <button
                class="tl__era"
                style={{
                  transform: `translateX(${startX()}px)`,
                  top: `${top()}px`,
                  width: `${w()}px`,
                  height: `${LANE_H}px`,
                  "--era-color": e.color ?? "var(--accent)",
                }}
                classList={{ "tl__era--focused": focus().has(e.id) }}
                onPointerDown={(ev) => ev.stopPropagation()}
                onClick={() => setDetailEra(e)}
                title={`${e.title} (${formatSpan(e.startDate, e.startPrecision, e.endDate, e.endPrecision)})`}
              >
                <span class="tl__era-title">{e.title}</span>
                <span class="tl__era-span">
                  {formatSpan(e.startDate, e.startPrecision, e.endDate, e.endPrecision)}
                </span>
              </button>
            );
          }}
        </For>

        {/* post markers */}
        <For each={visiblePosts()}>
          {(p) => (
            <button
              class="tl__marker"
              style={{
                transform: `translateX(${dateToX(toMs(p.eventDate), vp())}px)`,
                top: `${postTop(p)}px`,
              }}
              onPointerDown={(ev) => ev.stopPropagation()}
              onClick={() => setEditingPost(p)}
              title={`${p.title} — ${formatByPrecision(p.eventDate, p.eventPrecision)}`}
            >
              <span class="tl__marker-dot" />
              <span class="tl__marker-label">{p.title}</span>
            </button>
          )}
        </For>

        <Show when={loaded() && eras().length === 0 && posts().length === 0}>
          <p class="tl__empty muted">No eras yet — add the first chapter of your life.</p>
        </Show>
      </div>

      <Show when={editing()}>
        <div class="tl__drawer-backdrop" onClick={() => setEditing(null)}>
          <div onClick={(ev) => ev.stopPropagation()}>
            <EraEditor
              era={editing() === "new" ? null : (editing() as EraDTO)}
              defaultStart={defaultStart()}
              onSaved={onSaved}
              onDeleted={onDeleted}
              onCancel={() => setEditing(null)}
            />
          </div>
        </div>
      </Show>

      <Show when={editingPost()}>
        <div class="tl__drawer-backdrop" onClick={() => setEditingPost(null)}>
          <div onClick={(ev) => ev.stopPropagation()}>
            <PostEditor
              post={editingPost() === "new" ? null : (editingPost() as PostDTO)}
              eras={eras()}
              defaultEraId={newPostEraId()}
              defaultDate={defaultStart()}
              storageEnabled={props.storageEnabled}
              onSaved={onSavedPost}
              onDeleted={onDeletedPost}
              onCancel={() => setEditingPost(null)}
            />
          </div>
        </div>
      </Show>

      <Show when={detailEra()}>
        {(era) => (
          <div class="tl__drawer-backdrop" onClick={() => setDetailEra(null)}>
            <div onClick={(ev) => ev.stopPropagation()}>
              <EraDetail
                era={era()}
                posts={postsInEra(era().id)}
                focused={focus().has(era().id)}
                onEdit={() => {
                  setDetailEra(null);
                  setEditing(era());
                }}
                onAddMoment={() => addMomentTo(era().id)}
                onOpenPost={(p) => {
                  setDetailEra(null);
                  setEditingPost(p);
                }}
                onToggleFocus={() => {
                  toggleFocus(era().id);
                  setDetailEra(null);
                }}
                onClose={() => setDetailEra(null)}
              />
            </div>
          </div>
        )}
      </Show>
    </div>
  );
};

export default Timeline;
