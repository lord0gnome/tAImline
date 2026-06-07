import type { EraVisibility, Precision } from "~/db/schema.ts";

/** Era shape sent to / received from the client (no internal timestamps). */
export interface EraDTO {
  id: string;
  title: string;
  slug: string;
  descriptionMd: string | null;
  startDate: string;
  startPrecision: Precision;
  endDate: string | null;
  endPrecision: Precision | null;
  color: string | null;
  category: string | null;
  visibility: EraVisibility;
}

/** Response of GET /api/timeline. Posts arrive in M3. */
export interface TimelineData {
  eras: EraDTO[];
}

/** Curated palette offered in the era editor. */
export const ERA_COLORS = [
  "#c0563a", "#d98324", "#caa23a", "#5a8a52",
  "#3f8a8a", "#4a6fa5", "#7a5aa5", "#a5527a",
] as const;
