import {
  type Component,
  createMemo,
  createSignal,
  For,
  onCleanup,
  onMount,
  Show,
} from "solid-js";
import { formatSpan, MS_DAY, msToISO, toMs } from "~/lib/dates.ts";
import EraEditor from "./EraEditor.tsx";
import { packLanes } from "./layout.ts";
import { generateTicks } from "./ruler.ts";
import { dateToX, fitRange, type Viewport, visibleRange, xToDate, zoomAt } from "./scale.ts";
import type { EraDTO } from "./types.ts";

interface Props {
  birthDate: string | null;
}

const RULER_H = 34;
const LANE_H = 46;
const LANE_GAP = 8;
const MIN_BAR_PX = 8;
const PX_PER_MS_MIN = 5 / (3650 * MS_DAY); // ~5px per decade (max zoom-out)
const PX_PER_MS_MAX = 200 / MS_DAY; // 200px per day (max zoom-in)

const clampZoom = (v: number) => Math.min(PX_PER_MS_MAX, Math.max(PX_PER_MS_MIN, v));

const Timeline: Component<Props> = (props) => {
  const [eras, setEras] = createSignal<EraDTO[]>([]);
  const [vp, setVp] = createSignal<Viewport>({ originMs: Date.now(), pxPerMs: 1 });
  const [width, setWidth] = createSignal(800);
  const [editing, setEditing] = createSignal<EraDTO | "new" | null>(null);
  const [loaded, setLoaded] = createSignal(false);

  let containerRef: HTMLDivElement | undefined;
  const nowMs = Date.now();

  const endMsOf = (e: EraDTO) => (e.endDate ? toMs(e.endDate) : nowMs);

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
    const res = await fetch("/api/eras");
    const data = res.ok ? await res.json() : { eras: [] };
    const list: EraDTO[] = data.eras ?? [];
    setEras(list);
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

  // Lane assignment over all eras (ongoing eras end "now").
  const lanes = createMemo(() =>
    packLanes(eras().map((e) => ({ id: e.id, startMs: toMs(e.startDate), endMs: endMsOf(e) }))),
  );

  const ticks = createMemo(() => {
    const { from, to } = visibleRange(vp(), width());
    return generateTicks(from, to, vp().pxPerMs);
  });

  // Virtualized set of eras whose bar intersects the viewport.
  const visibleEras = createMemo(() => {
    const w = width();
    const v = vp();
    return eras().filter((e) => {
      const x1 = dateToX(toMs(e.startDate), v);
      const x2 = dateToX(endMsOf(e), v);
      return x2 >= -50 && x1 <= w + 50;
    });
  });

  const contentHeight = () => RULER_H + lanes().laneCount * (LANE_H + LANE_GAP) + LANE_GAP;

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
    setEditing(null);
  }
  function onDeleted(id: string) {
    setEras((prev) => prev.filter((e) => e.id !== id));
    setEditing(null);
  }

  const todayX = () => dateToX(nowMs, vp());

  return (
    <div class="tl">
      <div class="tl__toolbar">
        <button class="btn btn--primary" onClick={() => setEditing("new")}>
          + New era
        </button>
        <button class="btn" onClick={() => setVp(frame(eras(), width()))}>
          Fit all
        </button>
        <span class="tl__hint muted">drag to pan · scroll to zoom</span>
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
                onPointerDown={(ev) => ev.stopPropagation()}
                onClick={() => setEditing(e)}
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

        <Show when={loaded() && eras().length === 0}>
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
    </div>
  );
};

export default Timeline;
