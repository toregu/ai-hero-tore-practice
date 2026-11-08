import { and, eq, sql } from "drizzle-orm";
import { db } from "~/db";
import { courses, enrollments, purchases } from "~/db/schema";
import {
  inWindow,
  ownedIncludedCourses,
  windowsFor,
  type AnalyticsRange,
} from "~/services/analyticsService";

// ─── Analytics Trend Service ───
// Revenue and enrollments per UTC bucket for the instructor analytics chart.
// Covers the same window and courses as the overview tiles, so the buckets add
// up to the tile totals.

export type TrendBucket = {
  /** UTC date the bucket starts on, as YYYY-MM-DD. */
  start: string;
  /** Gross revenue in cents. */
  revenue: number;
  enrollments: number;
};

export type TrendGranularity = "day" | "week" | "month";

const GRANULARITY: Record<AnalyticsRange, TrendGranularity> = {
  "7d": "day",
  "30d": "day",
  "90d": "week",
  all: "month",
};

const DAY_MS = 24 * 60 * 60 * 1000;

function dayKey(date: Date) {
  return date.toISOString().slice(0, 10);
}

/** Start of the UTC bucket containing `date`. ISO weeks start on Monday. */
function bucketStart(date: Date, granularity: TrendGranularity) {
  if (granularity === "month") {
    return new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), 1));
  }
  const day = new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate()));
  if (granularity === "day") return day;
  const daysSinceMonday = (day.getUTCDay() + 6) % 7;
  return new Date(day.getTime() - daysSinceMonday * DAY_MS);
}

function nextBucket(start: Date, granularity: TrendGranularity) {
  if (granularity === "month") {
    return new Date(Date.UTC(start.getUTCFullYear(), start.getUTCMonth() + 1, 1));
  }
  return new Date(start.getTime() + (granularity === "week" ? 7 : 1) * DAY_MS);
}

export function getInstructorTrend(
  instructorId: number,
  range: AnalyticsRange,
  now: Date = new Date()
) {
  const granularity = GRANULARITY[range];
  const window = windowsFor(range, now).current;
  const day = sql<string>`substr(${purchases.createdAt}, 1, 10)`;

  const revenueByDay = db
    .select({ day, total: sql<number>`sum(${purchases.amountPaid})` })
    .from(purchases)
    .innerJoin(courses, eq(purchases.courseId, courses.id))
    .where(and(ownedIncludedCourses(instructorId), inWindow(purchases.createdAt, window)))
    .groupBy(day)
    .all();

  const enrolledDay = sql<string>`substr(${enrollments.enrolledAt}, 1, 10)`;
  const enrollmentsByDay = db
    .select({ day: enrolledDay, count: sql<number>`count(*)` })
    .from(enrollments)
    .innerJoin(courses, eq(enrollments.courseId, courses.id))
    .where(and(ownedIncludedCourses(instructorId), inWindow(enrollments.enrolledAt, window)))
    .groupBy(enrolledDay)
    .all();

  // All time has no window start, so the chart begins at the first activity.
  const firstDay = [...revenueByDay, ...enrollmentsByDay]
    .map((row) => row.day)
    .sort()[0];
  const from = window.from ?? (firstDay ? `${firstDay}T00:00:00.000Z` : null);
  if (!from) return { granularity, buckets: [] as TrendBucket[] };

  const buckets = new Map<string, TrendBucket>();
  const last = bucketStart(now, granularity);
  for (
    let cursor = bucketStart(new Date(from), granularity);
    cursor <= last;
    cursor = nextBucket(cursor, granularity)
  ) {
    const start = dayKey(cursor);
    buckets.set(start, { start, revenue: 0, enrollments: 0 });
  }

  const bucketFor = (day: string) =>
    buckets.get(dayKey(bucketStart(new Date(`${day}T00:00:00.000Z`), granularity)))!;
  for (const row of revenueByDay) bucketFor(row.day).revenue += row.total;
  for (const row of enrollmentsByDay) bucketFor(row.day).enrollments += row.count;

  return { granularity, buckets: [...buckets.values()] };
}
