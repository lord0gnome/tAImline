import { createSignal } from "solid-js";

/**
 * Placeholder island that proves Solid hydration works end-to-end in M0.
 * Replaced by the real zoomable timeline in M2.
 */
export default function TimelinePlaceholder() {
  const [zoom, setZoom] = createSignal(1);

  return (
    <div
      style={{
        border: "1px dashed var(--border)",
        "border-radius": "var(--radius)",
        padding: "1.5rem",
        background: "var(--surface-2)",
      }}
    >
      <p class="muted" style={{ margin: "0 0 0.75rem" }}>
        Timeline island (placeholder) — zoom level {zoom().toFixed(1)}×
      </p>
      <div style={{ display: "flex", gap: "0.5rem" }}>
        <button
          class="btn"
          onClick={() => setZoom((z) => Math.max(0.5, z - 0.5))}
        >
          −
        </button>
        <button class="btn" onClick={() => setZoom((z) => z + 0.5)}>
          +
        </button>
      </div>
    </div>
  );
}
