// ─── Analytics constants ───
// Client-safe values shared by the analytics services and UI. Kept out of the
// services so components can import them without pulling the database into
// the browser bundle.

export const ANALYTICS_RANGES = ["7d", "30d", "90d", "all"] as const;
export type AnalyticsRange = (typeof ANALYTICS_RANGES)[number];
export const DEFAULT_ANALYTICS_RANGE: AnalyticsRange = "30d";

/** Quizzes whose pass rate falls below this fraction are flagged. */
export const LOW_PASS_RATE = 0.6;
