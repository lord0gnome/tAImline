import {
  type Component,
  createEffect,
  createMemo,
  createSignal,
  For,
  onCleanup,
  onMount,
  Show,
} from "solid-js";
import { formatByPrecision, formatSpan, MS_DAY, msToISO, type Precision, toMs } from "~/lib/dates.ts";
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
const LANE_GAP = 1;
const MIN_BAR_PX = 4;
const POST_ROW_H = 30; // free-floating posts strip at the bottom

// Era bar (lane) height is user-adjustable via a step slider, persisted locally.
const LANE_H_DEFAULT = 16;
const LANE_H_MIN = 12;
const LANE_H_MAX = 44;
const LANE_H_STEP = 4;
const LANE_H_KEY = "taimline-lane-h";
function loadLaneH(): number {
  try {
    const v = Number(localStorage.getItem(LANE_H_KEY));
    if (v >= LANE_H_MIN && v <= LANE_H_MAX) return v;
  } catch {
    /* no localStorage (SSR / private mode) */
  }
  return LANE_H_DEFAULT;
}
const PX_PER_MS_MIN = 5 / (3650 * MS_DAY); // ~5px per decade (max zoom-out)
const PX_PER_MS_MAX = 200 / MS_DAY; // 200px per day (max zoom-in)

const clampZoom = (v: number) => Math.min(PX_PER_MS_MAX, Math.max(PX_PER_MS_MIN, v));

/** Finest date precision the user can target at this zoom: a unit must be wide
 *  enough on screen to point at. Used for the cursor chip + dates created by
 *  double-clicking the canvas. */
function precisionForZoom(pxPerMs: number): Precision {
  const pxPerDay = pxPerMs * MS_DAY;
  if (pxPerDay >= 3) return "day"; // a day is ≥3px wide → pick a day
  if (pxPerDay * 30 >= 4) return "month"; // a month is ≥4px wide → pick a month
  return "year";
}

const Timeline: Component<Props> = (props) => {
  const [eras, setEras] = createSignal<EraDTO[]>([]);
  const [posts, setPosts] = createSignal<PostDTO[]>([]);
  const [vp, setVp] = createSignal<Viewport>({ originMs: Date.now(), pxPerMs: 1 });
  const [width, setWidth] = createSignal(800);
  const [laneH, setLaneH] = createSignal(loadLaneH()); // era bar height (px)
  const [editing, setEditing] = createSignal<EraDTO | "new" | null>(null);
  const [editingPost, setEditingPost] = createSignal<PostDTO | "new" | null>(null);
  const [detailEra, setDetailEra] = createSignal<EraDTO | null>(null);
  const [readingPost, setReadingPost] = createSignal<PostDTO | null>(null);
  const [newPostEraId, setNewPostEraId] = createSignal<string | null>(null);
  const [newPostDate, setNewPostDate] = createSignal<string | null>(null);
  const [newPostPrecision, setNewPostPrecision] = createSignal<Precision | null>(null);
  const [newEraStart, setNewEraStart] = createSignal<string | null>(null);
  // "edit" exposes click-to-edit etc.; "view" is a read preview (no accidental
  // edits). Public timelines (readOnly) are always viewing.
  const [mode, setMode] = createSignal<"edit" | "view">("edit");
  const [focus, setFocus] = createSignal<Set<string>>(new Set());
  // Category highlight: selected tags (lowercased) dim non-matching items.
  const [highlight, setHighlight] = createSignal<Set<string>>(new Set());
  const [availH, setAvailH] = createSignal(480);
  const [hover, setHover] = createSignal<{ post: PostDTO; x: number; y: number } | null>(null);
  // The date under the cursor, shown in a small chip while hovering.
  const [cursor, setCursor] = createSignal<{ x: number; y: number; iso: string } | null>(null);
  const [loaded, setLoaded] = createSignal(false);
  const [stale, setStale] = createSignal(false);
  const [freshEraIds, setFreshEraIds] = createSignal<Set<string>>(new Set());

  let containerRef: HTMLDivElement | undefined;
  const nowMs = Date.now();

  // Viewing = read preview (public, or the in-app "view" mode). Editable is the
  // inverse and gates every mutating interaction.
  const viewing = () => props.readOnly || mode() === "view";
  const editable = () => !viewing();
  // Pending single-click action, deferred so a double-click can cancel it.
  let eraClickTimer: ReturnType<typeof setTimeout> | undefined;

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
    const prev = new Set(eras().map((e) => e.id));
    const res = await fetch("/api/timeline");
    const data = res.ok ? await res.json() : { eras: [], posts: [] };
    const list: EraDTO[] = data.eras ?? [];
    // Detect eras that didn't exist before this fetch (SSE or initial load
    // after first save). Skip the very first load (prev is empty).
    if (prev.size > 0) {
      const added = list.filter((e) => !prev.has(e.id)).map((e) => e.id);
      if (added.length) markFresh(added);
    }
    setEras(list);
    setPosts(data.posts ?? []);
    if (!loaded()) setViewportNow(frame(list, width()));
    setLoaded(true);
  }

  /** Mark era IDs as "fresh" so they play the pop animation, then auto-clear. */
  function markFresh(ids: string[]) {
    setFreshEraIds((s) => { const n = new Set(s); ids.forEach((id) => n.add(id)); return n; });
    setTimeout(() => {
      setFreshEraIds((s) => { const n = new Set(s); ids.forEach((id) => n.delete(id)); return n; });
    }, 700);
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
    // Escape closes the top-most editor / drawer.
    const onEsc = (ev: KeyboardEvent) => {
      if (ev.key !== "Escape") return;
      if (editingPost()) setEditingPost(null);
      else if (editing()) setEditing(null);
      else if (readingPost()) setReadingPost(null);
      else if (detailEra()) setDetailEra(null);
      else return;
      ev.stopPropagation();
    };
    window.addEventListener("keydown", onEsc);
    onCleanup(() => {
      window.removeEventListener("resize", onResize);
      window.removeEventListener("keydown", onEsc);
    });
    if (props.readOnly) {
      // Public view: data is provided; no API fetch.
      setEras(props.initialEras ?? []);
      setPosts(props.initialPosts ?? []);
      setViewportNow(frame(props.initialEras ?? [], width()));
      setLoaded(true);
    } else {
      void load();

      // --- SSE live updates ------------------------------------------------
      // One long-lived EventSource per tab. The server polls a cheap
      // fingerprint every ~10s and only emits `change` when data actually
      // moved, so we refetch /api/timeline only when there's something new.
      const es = new EventSource("/api/timeline/stream");
      let initial = true; // skip the first event (current version on connect)
      es.addEventListener("change", () => {
        if (initial) { initial = false; return; }
        // Defer refetch while an editor/drawer is open to avoid disrupting
        // the user mid-edit; the stale flag is flushed by a createEffect.
        if (editing() || editingPost() || detailEra()) {
          setStale(true);
        } else {
          void load();
        }
      });
      onCleanup(() => es.close());
    }
  });

  // Flush any deferred SSE reload once every editor/drawer closes.
  createEffect(() => {
    if (stale() && !editing() && !editingPost() && !detailEra()) {
      setStale(false);
      void load();
    }
  });

  // Persist the chosen era-bar height.
  createEffect(() => {
    try {
      localStorage.setItem(LANE_H_KEY, String(laneH()));
    } catch {
      /* ignore */
    }
  });

  function openPost(p: PostDTO) {
    if (suppressTap) return; // tail end of a pinch — don't open
    if (props.readOnly) {
      if (props.ownerHandle) location.href = `/u/${props.ownerHandle}/post/${p.slug}`;
    } else if (mode() === "view") {
      setReadingPost(p);
    } else {
      setEditingPost(p);
    }
  }

  // Double-click an empty spot on the canvas → new era starting at that date.
  function onCanvasDblClick(ev: MouseEvent) {
    if (!editable() || !containerRef) return;
    const x = ev.clientX - containerRef.getBoundingClientRect().left;
    setNewEraStart(msToISO(Math.round(xToDate(x, vp()))));
    setEditing("new");
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
    RULER_H + LANE_GAP + lanes().lanes[eraId] * (laneH() + LANE_GAP);
  const lanesBottom = () => RULER_H + lanes().laneCount * (laneH() + LANE_GAP) + LANE_GAP;

  // A post is "free-floating" if it has no era or its era isn't on the timeline.
  const isFree = (p: PostDTO) => !p.eraId || lanes().lanes[p.eraId] === undefined;
  const hasFreePosts = () => shownPosts().some(isFree);

  const contentHeight = () => lanesBottom() + (hasFreePosts() ? POST_ROW_H : 0);
  // In fill mode the canvas reaches the viewport bottom (grows if lanes exceed it).
  const canvasHeight = () => (props.fill ? Math.max(contentHeight(), availH()) : contentHeight());

  // Virtualized set of posts whose marker is within the viewport.
  const visiblePosts = createMemo(() => {
    const w = width();
    const v = vp();
    return shownPosts().filter((p) => {
      const x = dateToX(toMs(p.eventDate), v);
      return x >= -20 && x <= w + 20;
    });
  });

  // ---- category highlight ----------------------------------------------
  // Distinct categories across eras + posts, canonical-cased, sorted.
  const allCategories = createMemo(() => {
    const map = new Map<string, string>(); // lowercase -> first-seen display
    const add = (cats: string[]) => {
      for (const c of cats) if (!map.has(c.toLowerCase())) map.set(c.toLowerCase(), c);
    };
    eras().forEach((e) => add(e.categories));
    posts().forEach((p) => add(p.categories));
    return [...map.values()].sort((a, b) => a.localeCompare(b));
  });

  const eraMatches = (e: EraDTO, h: Set<string>) =>
    h.size === 0 || e.categories.some((c) => h.has(c.toLowerCase()));
  // A post inherits its era's categories for highlighting, so tagging an era
  // also lights up its moments.
  const postMatches = (p: PostDTO, h: Set<string>) => {
    if (h.size === 0) return true;
    if (p.categories.some((c) => h.has(c.toLowerCase()))) return true;
    const e = p.eraId ? eras().find((x) => x.id === p.eraId) : undefined;
    return !!e && e.categories.some((c) => h.has(c.toLowerCase()));
  };

  function toggleHighlight(cat: string) {
    const key = cat.toLowerCase();
    const h = new Set(highlight());
    h.has(key) ? h.delete(key) : h.add(key);
    setHighlight(h);
  }

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
    if (ev.shiftKey) {
      ev.preventDefault();
      const d = ev.deltaY || ev.deltaX;
      tweenTo({ ...target, originMs: target.originMs + d / target.pxPerMs });
    } else {
      ev.preventDefault();
      const rect = containerRef!.getBoundingClientRect();
      const anchorX = ev.clientX - rect.left;
      tweenTo(zoomAt(target, anchorX, Math.exp(-ev.deltaY * 0.002)));
    }
    // else: let the browser scroll vertically.
  }

  // Multi-pointer tracking: 1 pointer pans, 2 pointers pinch-zoom (touch).
  // `pointers` collects every active pointer over the timeline regardless of
  // which element it started on, so a second finger can fold a finger resting
  // on an era/moment into a pinch instead of selecting it.
  const pointers = new Map<number, number>(); // id -> clientX
  const touchIds = new Set<number>();
  let lastX = 0;
  let pinchDist = 0;
  let pinchActive = false;
  let suppressTap = false; // swallow an era/moment tap that's really a pinch
  // The pointer that first grabbed an era/moment (didn't reach the canvas),
  // kept so a later second finger can seed the pinch with both positions.
  let itemPointerId: number | null = null;
  let itemPointerX = 0;

  const dist = () => {
    const xs = [...pointers.values()];
    return Math.abs(xs[0] - xs[1]);
  };

  /** Promote the current gesture to a two-finger pinch (called when a 2nd touch
   *  appears, from whichever element handled its pointerdown). */
  function beginPinch(ev: PointerEvent) {
    if (pinchActive) return;
    pinchActive = true;
    suppressTap = true;
    clearTimeout(eraClickTimer);
    dragId = null; // abort any in-progress era relane
    setDragLane(null);
    pointers.set(ev.pointerId, ev.clientX);
    if (itemPointerId !== null && !pointers.has(itemPointerId)) {
      pointers.set(itemPointerId, itemPointerX);
    }
    pinchDist = pointers.size >= 2 ? dist() : 0;
  }

  /** Apply a pinch from any pointer move while a pinch is active. */
  function pinchMove(ev: PointerEvent) {
    pointers.set(ev.pointerId, ev.clientX);
    if (pointers.size < 2 || !containerRef) return;
    const rect = containerRef.getBoundingClientRect();
    const xs = [...pointers.values()];
    const d = Math.abs(xs[0] - xs[1]);
    if (pinchDist > 0 && d > 0) {
      const midX = (xs[0] + xs[1]) / 2 - rect.left;
      setViewportNow(zoomAt(vp(), midX, d / pinchDist)); // pinch is 1:1
    }
    pinchDist = d;
  }

  /** Drop a lifted/cancelled pointer and tidy gesture state. */
  function releasePointer(ev: PointerEvent) {
    touchIds.delete(ev.pointerId);
    pointers.delete(ev.pointerId);
    pinchDist = 0;
    const rest = [...pointers.values()];
    if (rest.length === 1) lastX = rest[0]; // avoid a jump when lifting one finger
    if (touchIds.size < 2) pinchActive = false; // <2 fingers → pan can resume
    if (touchIds.size === 0) {
      itemPointerId = null;
      // keep tap suppressed briefly so the synthetic click after the last
      // finger lifts doesn't select an item.
      if (suppressTap) setTimeout(() => { suppressTap = false; }, 120);
    }
  }

  function onPointerDown(ev: PointerEvent) {
    cancelAnimationFrame(rafId); // stop any tween when the user grabs the canvas
    rafId = 0;
    target = vp();
    if (ev.pointerType === "touch") {
      touchIds.add(ev.pointerId);
      if (touchIds.size >= 2) { beginPinch(ev); return; }
    }
    pointers.set(ev.pointerId, ev.clientX);
    (ev.currentTarget as HTMLElement).setPointerCapture(ev.pointerId);
    if (pointers.size === 1) lastX = ev.clientX;
  }
  function onPointerMove(ev: PointerEvent) {
    // Track the day under the cursor for the date tooltip (mouse hover, no drag).
    if (ev.pointerType !== "touch" && containerRef) {
      const lx = ev.clientX - containerRef.getBoundingClientRect().left;
      setCursor({ x: ev.clientX, y: ev.clientY, iso: msToISO(Math.round(xToDate(lx, vp()))) });
    }
    if (pinchActive) { pinchMove(ev); return; }
    if (!pointers.has(ev.pointerId)) return;
    pointers.set(ev.pointerId, ev.clientX);
    const dx = ev.clientX - lastX;
    lastX = ev.clientX;
    const v = vp();
    setViewportNow({ ...v, originMs: v.originMs - dx / v.pxPerMs }); // drag is 1:1
  }
  function onPointerUp(ev: PointerEvent) {
    (ev.currentTarget as HTMLElement).releasePointerCapture?.(ev.pointerId);
    releasePointer(ev);
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
    clearTimeout(eraClickTimer); // cancel any pending single-click edit
    if (ev.pointerType === "touch") {
      touchIds.add(ev.pointerId);
      if (touchIds.size >= 2) { beginPinch(ev); return; } // 2nd finger → pinch, not select
    }
    ev.stopPropagation(); // single pointer on an era: don't pan the canvas
    itemPointerId = ev.pointerId; // let a later 2nd finger fold this into a pinch
    itemPointerX = ev.clientX;
    if (!editable()) return;
    canvasTop = containerRef!.getBoundingClientRect().top;
    dragId = e.id;
    dragStartY = ev.clientY;
    dragMoved = false;
    (ev.currentTarget as HTMLElement).setPointerCapture(ev.pointerId);
  }
  function eraPointerMove(ev: PointerEvent) {
    if (pinchActive) { pinchMove(ev); return; } // a 2nd finger turned this into a pinch
    if (dragId === null) return;
    if (!dragMoved && Math.abs(ev.clientY - dragStartY) < 5) return;
    dragMoved = true;
    setDragLane({ id: dragId, y: ev.clientY - canvasTop });
  }
  function eraPointerUp(ev: PointerEvent, e: EraDTO) {
    (ev.currentTarget as HTMLElement).releasePointerCapture?.(ev.pointerId);
    if (dragId !== null && dragMoved && !pinchActive) {
      const y = ev.clientY - canvasTop;
      suppressClickId = e.id; // the click that follows shouldn't open the editor
      const target = Math.round((y - RULER_H - LANE_GAP) / (laneH() + LANE_GAP));
      const clamped = Math.max(0, Math.min(target, lanes().laneCount));
      if (clamped !== lanes().lanes[e.id]) void persistLane(e, clamped);
    }
    dragId = null;
    setDragLane(null);
    releasePointer(ev);
  }
  function eraClick(e: EraDTO) {
    if (suppressTap) return; // tail end of a pinch — don't select
    if (suppressClickId === e.id) {
      suppressClickId = null;
      return;
    }
    // View mode: open the read drawer immediately. Edit mode: open the editor,
    // but defer so a double-click (→ add moment) can cancel it first.
    if (!editable()) {
      setDetailEra(e);
      return;
    }
    clearTimeout(eraClickTimer);
    eraClickTimer = setTimeout(() => setEditing(e), 240);
  }

  // A touch on a moment: track it so a 2nd finger pinches (instead of selecting
  // the moment), and otherwise keep it from panning the canvas.
  function momentPointerDown(ev: PointerEvent) {
    if (ev.pointerType === "touch") {
      touchIds.add(ev.pointerId);
      if (touchIds.size >= 2) { beginPinch(ev); return; }
    }
    ev.stopPropagation();
    itemPointerId = ev.pointerId;
    itemPointerX = ev.clientX;
  }

  // Double-click an era → new moment attached to it, dated where you clicked.
  function eraDblClick(ev: MouseEvent, e: EraDTO) {
    ev.stopPropagation();
    if (!editable() || !containerRef) return;
    clearTimeout(eraClickTimer);
    const x = ev.clientX - containerRef.getBoundingClientRect().left;
    addMomentTo(e.id, msToISO(Math.round(xToDate(x, vp()))), precisionForZoom(vp().pxPerMs));
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
    const isNew = !eras().some((e) => e.id === saved.id);
    setEras((prev) => {
      const i = prev.findIndex((e) => e.id === saved.id);
      if (i === -1) return [...prev, saved];
      const copy = [...prev];
      copy[i] = saved;
      return copy;
    });
    if (isNew) markFresh([saved.id]);
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

  // Open a fresh moment editor pre-attached to an era, optionally at a date
  // (with the precision that zoom level affords).
  function addMomentTo(eraId: string | null, date?: string, precision?: Precision) {
    setNewPostEraId(eraId);
    setNewPostDate(date ?? null);
    setNewPostPrecision(precision ?? null);
    setDetailEra(null);
    setEditing(null);
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
    <div class="tl" classList={{ "tl--fill": props.fill, "tl--edit": editable() }}>
      <div class="tl__toolbar">
        <Show when={!props.readOnly}>
          <div class="tl__mode" role="group" aria-label="Timeline mode">
            <button class="tl__mode-btn" classList={{ "tl__mode-btn--on": mode() === "edit" }} aria-pressed={mode() === "edit"} onClick={() => setMode("edit")}>
              Edit
            </button>
            <button class="tl__mode-btn" classList={{ "tl__mode-btn--on": mode() === "view" }} aria-pressed={mode() === "view"} onClick={() => setMode("view")}>
              View
            </button>
          </div>
        </Show>
        <Show when={editable()}>
          <button class="btn btn--primary" onClick={() => { setNewEraStart(null); setEditing("new"); }}>
            + New era
          </button>
          <button class="btn" onClick={() => addMomentTo(null)}>
            + New moment
          </button>
        </Show>
        <button class="btn" onClick={() => tweenTo(frame(shownEras(), width()))}>
          Fit
        </button>
        <label class="tl__rowh" title="Era row height">
          <span class="tl__rowh-icon" aria-hidden="true">⇕</span>
          <input
            type="range"
            min={LANE_H_MIN}
            max={LANE_H_MAX}
            step={LANE_H_STEP}
            value={laneH()}
            aria-label="Era row height"
            onInput={(ev) => setLaneH(Number(ev.currentTarget.value))}
          />
        </label>
        <Show
          when={focus().size > 0}
          fallback={
            <span class="tl__hint muted">
              {editable()
                ? "click to edit · double-click an era to add a moment · double-click empty space for a new era"
                : "drag to pan · scroll to move · ⌘/Ctrl+scroll to zoom"}
            </span>
          }
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

      <Show when={allCategories().length > 0}>
        <div class="tl__cats">
          <span class="muted tl__cats-label">Tags:</span>
          <For each={allCategories()}>
            {(c) => (
              <button
                type="button"
                class="tl__cat"
                classList={{ "tl__cat--on": highlight().has(c.toLowerCase()) }}
                onClick={() => toggleHighlight(c)}
                aria-pressed={highlight().has(c.toLowerCase())}
              >
                {c}
              </button>
            )}
          </For>
          <Show when={highlight().size > 0}>
            <button type="button" class="tl__cats-clear" onClick={() => setHighlight(new Set())}>
              clear
            </button>
          </Show>
        </div>
      </Show>

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
        onPointerCancel={onPointerUp}
        onPointerLeave={(ev) => { onPointerUp(ev); setCursor(null); }}
        onKeyDown={onKeyDown}
        onDblClick={onCanvasDblClick}
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
            const top = () => (dragging() ? dragLane()!.y - laneH() / 2 : laneTop(e.id));
            return (
              <button
                class="tl__era"
                style={{
                  transform: `translateX(${startX()}px)`,
                  top: `${top()}px`,
                  width: `${w()}px`,
                  height: `${laneH()}px`,
                  "--era-color": e.color ?? "var(--accent)",
                }}
                classList={{ "tl__era--focused": focus().has(e.id), "tl__era--dragging": dragging(), "tl__era--fresh": freshEraIds().has(e.id), "tl__era--dim": !eraMatches(e, highlight()) }}
                onPointerDown={(ev) => eraPointerDown(ev, e)}
                onPointerMove={eraPointerMove}
                onPointerUp={(ev) => eraPointerUp(ev, e)}
                onPointerCancel={(ev) => eraPointerUp(ev, e)}
                onClick={() => eraClick(e)}
                onDblClick={(ev) => eraDblClick(ev, e)}
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

        {/* moments: a 2px vertical line down the era at the moment's date */}
        <For each={visiblePosts()}>
          {(p) => {
            const free = () => isFree(p);
            const top = () => (free() ? lanesBottom() + 2 : laneTop(p.eraId!));
            const h = () => (free() ? 18 : laneH());
            const color = () =>
              free() ? "var(--accent)" : (eras().find((e) => e.id === p.eraId)?.color ?? "var(--accent)");
            return (
              <button
                class="tl__moment"
                classList={{ "tl__moment--dim": !postMatches(p, highlight()) }}
                style={{
                  transform: `translateX(${dateToX(toMs(p.eventDate), vp()) - 3}px)`,
                  top: `${top()}px`,
                  height: `${h()}px`,
                }}
                onPointerDown={momentPointerDown}
                onDblClick={(ev) => ev.stopPropagation()}
                onClick={() => openPost(p)}
                onMouseEnter={(ev) => setHover({ post: p, x: ev.clientX, y: ev.clientY })}
                onMouseMove={(ev) => setHover({ post: p, x: ev.clientX, y: ev.clientY })}
                onMouseLeave={() => setHover(null)}
                aria-label={`Moment: ${p.title}, ${formatByPrecision(p.eventDate, p.eventPrecision)}`}
              >
                <span class="tl__moment-line" style={{ background: color() }} />
              </button>
            );
          }}
        </For>

        <Show when={loaded() && eras().length === 0 && posts().length === 0}>
          <p class="tl__empty muted">No eras yet — add the first chapter of your life.</p>
        </Show>
      </div>

      {/* floating chip that follows the cursor and shows the date under it, at
          the finest precision this zoom allows. In edit mode it gains a "+" to
          cue double-click-to-add. Hidden while a moment preview is showing. */}
      <Show when={cursor() && !hover() && !editing() && !editingPost() && !detailEra() && !readingPost()}>
        <div
          class="tl__cursor-date"
          classList={{ "tl__cursor-date--add": editable() }}
          style={{
            left: `${Math.min(cursor()!.x + 14, (typeof window !== "undefined" ? window.innerWidth : 1200) - 120)}px`,
            top: `${cursor()!.y + 18}px`,
          }}
        >
          <Show when={editable()}>
            <span class="tl__cursor-date-plus">+</span>
          </Show>
          {formatByPrecision(cursor()!.iso, precisionForZoom(vp().pxPerMs))}
        </div>
      </Show>

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
              defaultStart={newEraStart() ?? defaultStart()}
              defaultStartPrecision={newEraStart() ? precisionForZoom(vp().pxPerMs) : "month"}
              categorySuggestions={allCategories()}
              posts={editing() && editing() !== "new" ? postsInEra((editing() as EraDTO).id) : []}
              focused={editing() !== "new" && focus().has((editing() as EraDTO)?.id)}
              onAddMoment={() => { const e = editing(); if (e && e !== "new") addMomentTo(e.id); }}
              onOpenPost={(p) => { setEditing(null); openPost(p); }}
              onToggleFocus={() => { const e = editing(); if (e && e !== "new") { setEditing(null); toggleFocus(e.id); } }}
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
              defaultDate={newPostDate() ?? defaultStart()}
              defaultPrecision={newPostPrecision() ?? "day"}
              categorySuggestions={allCategories()}
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

      {/* read-only moment preview (view mode) */}
      <Show when={readingPost()}>
        {(post) => {
          const p = post();
          return (
            <div class="tl__drawer-backdrop" onClick={() => setReadingPost(null)}>
              <div onClick={(ev) => ev.stopPropagation()}>
                <aside class="era-editor era-detail">
                  <h2 style={{ margin: 0 }}>{p.title}</h2>
                  <p class="muted" style={{ margin: "0.15rem 0 0" }}>
                    {formatByPrecision(p.eventDate, p.eventPrecision)}
                  </p>
                  <Show when={p.categories.length}>
                    <div class="cat-chips">
                      <For each={p.categories}>{(c) => <span class="cat-chip cat-chip--static">{c}</span>}</For>
                    </div>
                  </Show>
                  <Show
                    when={p.bodyHtml}
                    fallback={<p class="muted" style={{ "margin-top": "1rem" }}>No description yet.</p>}
                  >
                    <div class="era-detail__body" innerHTML={p.bodyHtml ?? ""} />
                  </Show>
                  <div class="era-editor__actions">
                    <Show when={!props.readOnly}>
                      <button class="btn btn--primary" onClick={() => { setReadingPost(null); setEditingPost(p); }}>
                        Edit
                      </button>
                    </Show>
                    <button class="btn" onClick={() => setReadingPost(null)} style={{ "margin-left": "auto" }}>
                      Close
                    </button>
                  </div>
                </aside>
              </div>
            </div>
          );
        }}
      </Show>
    </div>
  );
};

export default Timeline;
