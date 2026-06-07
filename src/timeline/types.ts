import type { EraVisibility, Precision } from "~/db/schema.ts";

/** Era shape sent to / received from the client (no internal timestamps). */
export interface EraDTO {
  id: string;
  title: string;
  slug: string;
  descriptionMd: string | null;
  descriptionHtml: string | null;
  startDate: string;
  startPrecision: Precision;
  endDate: string | null;
  endPrecision: Precision | null;
  color: string | null;
  category: string | null;
  lane: number | null;
  visibility: EraVisibility;
}

/** A moment pinned to a date, optionally attached to an era. */
export interface PostDTO {
  id: string;
  eraId: string | null;
  title: string;
  slug: string;
  bodyMd: string | null;
  bodyHtml: string | null;
  eventDate: string;
  eventPrecision: Precision;
  eventEndDate: string | null;
  visibility: EraVisibility;
}

/** Response of GET /api/timeline. */
export interface TimelineData {
  eras: EraDTO[];
  posts: PostDTO[];
}

/** Curated palette offered in the era editor. */
export const ERA_COLORS = [
  "#c0563a", "#d98324", "#caa23a", "#5a8a52",
  "#3f8a8a", "#4a6fa5", "#7a5aa5", "#a5527a",
] as const;
