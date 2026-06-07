// Greedy lane packing for overlapping eras. Each era gets the first lane whose
// previous era ends at or before this one starts; otherwise a new lane opens.
// Pure + deterministic → unit tested.

export interface LaneItem {
  id: string;
  startMs: number;
  /** Exclusive end. Ongoing eras pass a sentinel end (e.g. "now"). */
  endMs: number;
}

export interface LaneResult {
  /** id → lane index (0-based, top lane = 0). */
  lanes: Record<string, number>;
  laneCount: number;
}

export function packLanes(items: LaneItem[]): LaneResult {
  // Sort by start, then by end, then id for a stable, predictable packing.
  const sorted = [...items].sort(
    (a, b) => a.startMs - b.startMs || a.endMs - b.endMs || (a.id < b.id ? -1 : 1),
  );

  const laneEnds: number[] = [];
  const lanes: Record<string, number> = {};

  for (const item of sorted) {
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
