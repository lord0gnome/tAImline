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
  storageEnabled?: boolean;
  /** Fill the viewport height (the app's primary, full-screen timeline). */
  fill?: boolean;
  /** Read-only public view: no editing, data passed in, markers link out. */
  readOnly?: boolean;
  ownerHandle?: string;
  initialEras?: EraDTO[];
  initialPosts?: PostDTO[];
}

const RULER_H = 34;
const LANE_H = 16;
const LANE_GAP = 1;
const MIN_BAR_PX = 4;
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
  const [availH, setAvailH] = createSignal(480);
  const [hover, setHover] = createSignal<{ post: PostDTO; x: number; y: number } | null>(null);
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
    if (!loaded()) setViewportNow(frame(list, width()));
    setLoaded(true);
  }

  function measure() {
    if (!containerRef) return;
    setWidth(containerRef.clientWidth);
    // Available height from the canvas top to the viewport bottom (minus margin).
    setAvailH(Math.max(280, window.innerHeight - containerRef.getBoundingClientRect().top - 16));
  }

  onMount(() => {
    measure();
    const onResize = () => measure();
    window.addEventListener("resize", onResize);
    onCleanup(() => window.removeEventListener("resize", onResize));
    if (props.readOnly) {
      // Public view: data is provided; no API fetch.
      setEras(props.initialEras ?? []);
      setPosts(props.initialPosts ?? []);
      setViewportNow(frame(props.initialEras ?? [], width()));
      setLoaded(true);
    } else {
      void load();
    }
  });

  function openPost(p: PostDTO) {
    if (props.readOnly) {
      if (props.ownerHandle) location.href = `/u/${props.ownerHandle}/post/${p.slug}`;
    } else {
      setEditingPost(p);
    }
  }

  // Eras/posts currently on screen (all, or the focused subset).
  const shownEras = createMemo(() => computeShown(eras(), focus()));
  const shownPosts = createMemo(() => {
    if (focus().size === 0) return posts();
    const ids = new Set(shownEras().map((e) => e.id));
    return posts().filter((p) => p.eraId && ids.has(p.eraId));
  });

  // Lane assignment over the shown eras (ongoing eras end "now"), honoring any
  // manual lane preference set by dragging.
  const lanes = createMemo(() =>
    packLanes(
      shownEras().map((e) => ({ id: e.id, startMs: toMs(e.startDate), endMs: endMsOf(e), lane: e.lane })),
    ),
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
  // In fill mode the canvas reaches the viewport bottom (grows if lanes exceed it).
  const canvasHeight = () => (props.fill ? Math.max(contentHeight(), availH()) : contentHeight());

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
    tweenTo(frame(shown.length ? shown : eras(), width()));
  }
  function toggleFocus(id: string) {
    const f = new Set(focus());
    f.has(id) ? f.delete(id) : f.add(id);
    applyFocus(f);
  }
  const focusedEras = () => eras().filter((e) => focus().has(e.id));

  // ---- smooth viewport: ease the displayed viewport toward a target -----
  let target: Viewport = vp();
  let rafId = 0;
  const reduceMotion = () =>
    typeof matchMedia !== "undefined" && matchMedia("(prefers-reduced-motion: reduce)").matches;
  const clampVp = (v: Viewport): Viewport => ({ ...v, pxPerMs: clampZoom(v.pxPerMs) });

  function stepTween() {
    const cur = vp();
    const k = 0.22; // per-frame easing toward target
    const o = cur.originMs + (target.originMs - cur.originMs) * k;
    const logCur = Math.log(cur.pxPerMs);
    const p = Math.exp(logCur + (Math.log(target.pxPerMs) - logCur) * k);
    const offByPx = Math.abs((target.originMs - o) * cur.pxPerMs);
    if (offByPx < 0.5 && Math.abs(target.pxPerMs / p - 1) < 0.002) {
      setVp(target);
      rafId = 0;
      return;
    }
    setVp({ originMs: o, pxPerMs: p });
    rafId = requestAnimationFrame(stepTween);
  }

  /** Ease toward a viewport (smooth). Used by zoom/pan-wheel/keyboard/fit/focus. */
  function tweenTo(v: Viewport) {
    target = clampVp(v);
    if (reduceMotion()) {
      setVp(target);
      return;
    }
    if (!rafId) rafId = requestAnimationFrame(stepTween);
  }

  /** Jump immediately (drag, pinch, initial framing) — no easing. */
  function setViewportNow(v: Viewport) {
    cancelAnimationFrame(rafId);
    rafId = 0;
    target = clampVp(v);
    setVp(target);
  }
  onCleanup(() => cancelAnimationFrame(rafId));

  // ---- interaction: wheel ----------------------------------------------
  // Plain wheel scrolls the page (vertical). Ctrl/⌘+wheel zooms (cursor-
  // anchored), Shift+wheel pans through time — both smoothed via tweenTo.
  function onWheel(ev: WheelEvent) {
    if (ev.ctrlKey || ev.metaKey) {
      ev.preventDefault();
      const rect = containerRef!.getBoundingClientRect();
      const anchorX = ev.clientX - rect.left;
      tweenTo(zoomAt(target, anchorX, Math.exp(-ev.deltaY * 0.002)));
    } else if (ev.shiftKey) {
      ev.preventDefault();
      const d = ev.deltaY || ev.deltaX;
      tweenTo({ ...target, originMs: target.originMs + d / target.pxPerMs });
    }
    // else: let the browser scroll vertically.
  }

  // Multi-pointer tracking: 1 pointer pans, 2 pointers pinch-zoom (touch).
  const pointers = new Map<number, number>(); // id -> clientX
  let lastX = 0;
  let pinchDist = 0;

  const dist = () => {
    const xs = [...pointers.values()];
    return Math.abs(xs[0] - xs[1]);
  };
  function onPointerDown(ev: PointerEvent) {
    cancelAnimationFrame(rafId); // stop any tween when the user grabs the canvas
    rafId = 0;
    target = vp();
    pointers.set(ev.pointerId, ev.clientX);
    (ev.currentTarget as HTMLElement).setPointerCapture(ev.pointerId);
    if (pointers.size === 1) lastX = ev.clientX;
    else if (pointers.size === 2) pinchDist = dist();
  }
  function onPointerMove(ev: PointerEvent) {
    if (!pointers.has(ev.pointerId)) return;
    pointers.set(ev.pointerId, ev.clientX);
    const rect = containerRef!.getBoundingClientRect();
    if (pointers.size >= 2) {
      const d = dist();
      if (pinchDist > 0 && d > 0) {
        const xs = [...pointers.values()];
        const midX = (xs[0] + xs[1]) / 2 - rect.left;
        setViewportNow(zoomAt(vp(), midX, d / pinchDist)); // pinch is 1:1
      }
      pinchDist = d;
    } else {
      const dx = ev.clientX - lastX;
      lastX = ev.clientX;
      const v = vp();
      setViewportNow({ ...v, originMs: v.originMs - dx / v.pxPerMs }); // drag is 1:1
    }
  }
  function onPointerUp(ev: PointerEvent) {
    pointers.delete(ev.pointerId);
    (ev.currentTarget as HTMLElement).releasePointerCapture?.(ev.pointerId);
    pinchDist = 0;
    const rest = [...pointers.values()];
    if (rest.length === 1) lastX = rest[0]; // avoid a jump when lifting one finger
  }

  // Keyboard: arrows pan, +/- zoom (anchored at center), Home fits.
  function onKeyDown(ev: KeyboardEvent) {
    const w = width();
    const panStep = w * 0.2;
    switch (ev.key) {
      case "ArrowLeft":
        tweenTo({ ...target, originMs: target.originMs - panStep / target.pxPerMs });
        break;
      case "ArrowRight":
        tweenTo({ ...target, originMs: target.originMs + panStep / target.pxPerMs });
        break;
      case "+":
      case "=":
        tweenTo(zoomAt(target, w / 2, 1.4));
        break;
      case "-":
        tweenTo(zoomAt(target, w / 2, 1 / 1.4));
        break;
      case "Home":
        tweenTo(frame(shownEras(), w));
        break;
      default:
        return;
    }
    ev.preventDefault();
  }

  // ---- vertical drag to re-lane an era ----------------------------------
  const [dragLane, setDragLane] = createSignal<{ id: string; y: number } | null>(null);
  let dragId: string | null = null;
  let dragStartY = 0;
  let dragMoved = false;
  let canvasTop = 0;
  let suppressClickId: string | null = null;

  function eraPointerDown(ev: PointerEvent, e: EraDTO) {
    ev.stopPropagation(); // don't pan the canvas
    if (props.readOnly) return;
    canvasTop = containerRef!.getBoundingClientRect().top;
    dragId = e.id;
    dragStartY = ev.clientY;
    dragMoved = false;
    (ev.currentTarget as HTMLElement).setPointerCapture(ev.pointerId);
  }
  function eraPointerMove(ev: PointerEvent) {
    if (dragId === null) return;
    if (!dragMoved && Math.abs(ev.clientY - dragStartY) < 5) return;
    dragMoved = true;
    setDragLane({ id: dragId, y: ev.clientY - canvasTop });
  }
  function eraPointerUp(ev: PointerEvent, e: EraDTO) {
    if (dragId === null) return;
    const moved = dragMoved;
    const y = ev.clientY - canvasTop;
    (ev.currentTarget as HTMLElement).releasePointerCapture?.(ev.pointerId);
    dragId = null;
    setDragLane(null);
    if (moved) {
      suppressClickId = e.id; // the click that follows shouldn't open the drawer
      const target = Math.round((y - RULER_H - LANE_GAP) / (LANE_H + LANE_GAP));
      const clamped = Math.max(0, Math.min(target, lanes().laneCount));
      if (clamped !== lanes().lanes[e.id]) void persistLane(e, clamped);
    }
  }
  function eraClick(e: EraDTO) {
    if (suppressClickId === e.id) {
      suppressClickId = null;
      return;
    }
    setDetailEra(e);
  }
  async function persistLane(e: EraDTO, lane: number) {
    setEras((prev) => prev.map((x) => (x.id === e.id ? { ...x, lane } : x))); // optimistic
    await fetch(`/api/eras/${e.id}/lane`, {
      method: "PUT",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ lane }),
    });
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
    <div class="tl" classList={{ "tl--fill": props.fill }}>
      <div class="tl__toolbar">
        <Show when={!props.readOnly}>
          <button class="btn btn--primary" onClick={() => setEditing("new")}>
            + New era
          </button>
          <button class="btn" onClick={() => addMomentTo(null)}>
            + New moment
          </button>
        </Show>
        <button class="btn" onClick={() => tweenTo(frame(shownEras(), width()))}>
          Fit
        </button>
        <Show
          when={focus().size > 0}
          fallback={<span class="tl__hint muted">drag to pan · scroll to move · ⌘/Ctrl+scroll to zoom</span>}
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
        style={{ height: `${canvasHeight()}px` }}
        tabindex="0"
        role="group"
        aria-label="Life timeline. Arrow keys pan, plus and minus zoom, Home fits all."
        onWheel={onWheel}
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={onPointerUp}
        onPointerLeave={onPointerUp}
        onKeyDown={onKeyDown}
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
            const dragging = () => dragLane()?.id === e.id;
            const top = () =>
              dragging()
                ? dragLane()!.y - LANE_H / 2
                : RULER_H + LANE_GAP + lanes().lanes[e.id] * (LANE_H + LANE_GAP);
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
                classList={{ "tl__era--focused": focus().has(e.id), "tl__era--dragging": dragging() }}
                onPointerDown={(ev) => eraPointerDown(ev, e)}
                onPointerMove={eraPointerMove}
                onPointerUp={(ev) => eraPointerUp(ev, e)}
                onClick={() => eraClick(e)}
                aria-label={`Era: ${e.title}, ${formatSpan(e.startDate, e.startPrecision, e.endDate, e.endPrecision)}`}
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
              onClick={() => openPost(p)}
              onMouseEnter={(ev) => setHover({ post: p, x: ev.clientX, y: ev.clientY })}
              onMouseMove={(ev) => setHover({ post: p, x: ev.clientX, y: ev.clientY })}
              onMouseLeave={() => setHover(null)}
              aria-label={`Moment: ${p.title}, ${formatByPrecision(p.eventDate, p.eventPrecision)}`}
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

      {/* hover preview of a moment's rendered markdown */}
      <Show when={hover()}>
        {(h) => (
          <div
            class="tl__popup"
            style={{
              left: `${Math.min(h().x + 16, (typeof window !== "undefined" ? window.innerWidth : 1200) - 332)}px`,
              top: `${Math.min(h().y + 16, (typeof window !== "undefined" ? window.innerHeight : 800) - 280)}px`,
            }}
          >
            <div class="tl__popup-title">{h().post.title}</div>
            <div class="tl__popup-date">
              {formatByPrecision(h().post.eventDate, h().post.eventPrecision)}
            </div>
            <Show
              when={h().post.bodyHtml}
              fallback={<p class="tl__popup-empty">No description yet.</p>}
            >
              <div class="tl__popup-body" innerHTML={h().post.bodyHtml ?? ""} />
            </Show>
          </div>
        )}
      </Show>

      <Show when={editing()}>
        <div class="tl__modal-backdrop" onClick={() => setEditing(null)}>
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
        <div class="tl__modal-backdrop" onClick={() => setEditingPost(null)}>
          <div onClick={(ev) => ev.stopPropagation()}>
            <PostEditor
              post={editingPost() === "new" ? null : (editingPost() as PostDTO)}
              eras={eras()}
              defaultEraId={newPostEraId()}
              defaultDate={defaultStart()}
              storageEnabled={props.storageEnabled ?? false}
              onSaved={onSavedPost}
              onDeleted={onDeletedPost}
              onCancel={() => setEditingPost(null)}
            />
          </div>
        </div>
      </Show>

      <Show when={detailEra()}>
        {(era) => {
          // Capture the value once: handlers must not call the Show accessor
          // after setDetailEra(null) unmounts this branch.
          const e = era();
          return (
            <div class="tl__drawer-backdrop" onClick={() => setDetailEra(null)}>
              <div onClick={(ev) => ev.stopPropagation()}>
                <EraDetail
                  era={e}
                  posts={postsInEra(e.id)}
                  focused={focus().has(e.id)}
                  readOnly={props.readOnly ?? false}
                  onEdit={() => {
                    setEditing(e);
                    setDetailEra(null);
                  }}
                  onAddMoment={() => addMomentTo(e.id)}
                  onOpenPost={(p) => {
                    setDetailEra(null);
                    openPost(p);
                  }}
                  onToggleFocus={() => {
                    setDetailEra(null);
                    toggleFocus(e.id);
                  }}
                  onClose={() => setDetailEra(null)}
                />
              </div>
            </div>
          );
        }}
      </Show>
    </div>
  );
};

export default Timeline;
