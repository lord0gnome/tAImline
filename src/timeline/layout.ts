// Greedy lane packing for overlapping eras. Each era gets the first lane whose
// previous era ends at or before this one starts; otherwise a new lane opens.
// Pure + deterministic → unit tested.

export interface LaneItem {
  id: string;
  startMs: number;
  /** Exclusive end. Ongoing eras pass a sentinel end (e.g. "now"). */
  endMs: number;
  /** Manual lane preference (from dragging); honored if free, else auto. */
  lane?: number | null;
}

export interface LaneResult {
  /** id → lane index (0-based, top lane = 0). */
  lanes: Record<string, number>;
  laneCount: number;
}

/**
 * Greedy lane packing with optional manual hints. Hinted items claim their
 * preferred lane first (when free); everything else is auto-packed into the
 * remaining gaps. With no hints this is the plain greedy algorithm.
 */
export function packLanes(items: LaneItem[]): LaneResult {
  // Sort by start, then by end, then id for a stable, predictable packing.
  const sorted = [...items].sort(
    (a, b) => a.startMs - b.startMs || a.endMs - b.endMs || (a.id < b.id ? -1 : 1),
  );

  const laneEnds: number[] = []; // -Infinity = an open (unused) lane
  const lanes: Record<string, number> = {};

  // Pass 1: honor manual lane hints when the slot is free at the item's start.
  for (const item of sorted) {
    if (item.lane == null || item.lane < 0) continue;
    const want = Math.min(item.lane, sorted.length - 1);
    while (laneEnds.length <= want) laneEnds.push(-Infinity);
    if (laneEnds[want] <= item.startMs) {
      lanes[item.id] = want;
      laneEnds[want] = item.endMs;
    }
  }

  // Pass 2: auto-pack the rest into the first free lane.
  for (const item of sorted) {
    if (lanes[item.id] !== undefined) continue;
    let placed = false;
    for (let i = 0; i < laneEnds.length; i++) {
      if (laneEnds[i] <= item.startMs) {
        lanes[item.id] = i;
        laneEnds[i] = item.endMs;
        placed = true;
        break;
      }
    }
    if (!placed) {
      lanes[item.id] = laneEnds.length;
      laneEnds.push(item.endMs);
    }
  }

  return { lanes, laneCount: laneEnds.length };
}
