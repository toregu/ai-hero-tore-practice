import { and, eq, gte, inArray, lt, sql } from "drizzle-orm";
import { db } from "~/db";
import type { SQLiteColumn } from "drizzle-orm/sqlite-core";
import {
  CourseStatus,
  courseRatings,
  courses,
  enrollments,
  purchases,
} from "~/db/schema";
import { getUnansweredQuestions } from "~/services/commentService";

// ─── Analytics Service ───
// Read-only aggregation for the instructor analytics dashboard.
// Uses positional parameters (project convention).

export const ANALYTICS_RANGES = ["7d", "30d", "90d", "all"] as const;
export type AnalyticsRange = (typeof ANALYTICS_RANGES)[number];
export const DEFAULT_ANALYTICS_RANGE: AnalyticsRange = "30d";

/** Narrows a raw range value to a supported range. Anything unrecognised falls back to the default. */
export function parseAnalyticsRange(value: string | null): AnalyticsRange {
  return ANALYTICS_RANGES.find((range) => range === value) ?? DEFAULT_ANALYTICS_RANGE;
}

// Drafts can't have students, so they're left out. Archived courses stay in so
// their historical earnings and outcomes remain visible.
const INCLUDED_STATUSES = [CourseStatus.Published, CourseStatus.Archived];

function ownedIncludedCourses(instructorId: number) {
  return and(
    eq(courses.instructorId, instructorId),
    inArray(courses.status, INCLUDED_STATUSES)
  );
}

const DAY_MS = 24 * 60 * 60 * 1000;

const RANGE_DAYS: Record<AnalyticsRange, number | null> = {
  "7d": 7,
  "30d": 30,
  "90d": 90,
  all: null,
};

type Window = { from: string | null; to: string };

/** The selected range, and the equal-length window just before it (none for all time). */
function windowsFor(range: AnalyticsRange, now: Date) {
  const days = RANGE_DAYS[range];
  const to = now.toISOString();
  if (days === null) {
    return { current: { from: null, to } as Window, previous: null };
  }
  const from = new Date(now.getTime() - days * DAY_MS).toISOString();
  const previousFrom = new Date(now.getTime() - 2 * days * DAY_MS).toISOString();
  return {
    current: { from, to } as Window,
    previous: { from: previousFrom, to: from } as Window,
  };
}

function inWindow(column: SQLiteColumn, window: Window) {
  return and(
    lt(column, window.to),
    window.from ? gte(column, window.from) : undefined
  );
}

function sumRevenue(instructorId: number, window: Window) {
  const row = db
    .select({ total: sql<number>`coalesce(sum(${purchases.amountPaid}), 0)` })
    .from(purchases)
    .innerJoin(courses, eq(purchases.courseId, courses.id))
    .where(
      and(ownedIncludedCourses(instructorId), inWindow(purchases.createdAt, window))
    )
    .get();

  return row?.total ?? 0;
}

function countEnrollments(instructorId: number, window: Window) {
  const row = db
    .select({ count: sql<number>`count(*)` })
    .from(enrollments)
    .innerJoin(courses, eq(enrollments.courseId, courses.id))
    .where(
      and(ownedIncludedCourses(instructorId), inWindow(enrollments.enrolledAt, window))
    )
    .get();

  return row?.count ?? 0;
}

export type RangedMetric = {
  value: number;
  /** % change vs the previous period; null for all time or when the previous period was zero. */
  changePercent: number | null;
};

function rangedMetric(
  measure: (window: Window) => number,
  windows: ReturnType<typeof windowsFor>
): RangedMetric {
  const value = measure(windows.current);
  if (!windows.previous) return { value, changePercent: null };

  const previous = measure(windows.previous);
  if (previous === 0) return { value, changePercent: null };

  return { value, changePercent: ((value - previous) / previous) * 100 };
}

/** Completed enrollments ÷ all enrollments, all-time. Null when nobody has enrolled. */
function completionRate(instructorId: number): number | null {
  const row = db
    .select({
      total: sql<number>`count(*)`,
      completed: sql<number>`count(${enrollments.completedAt})`,
    })
    .from(enrollments)
    .innerJoin(courses, eq(enrollments.courseId, courses.id))
    .where(ownedIncludedCourses(instructorId))
    .get();

  if (!row || row.total === 0) return null;
  return row.completed / row.total;
}

/** Mean star rating, all-time. Null when nobody has rated. */
function averageRating(instructorId: number): number | null {
  const row = db
    .select({ average: sql<number | null>`avg(${courseRatings.rating})` })
    .from(courseRatings)
    .innerJoin(courses, eq(courseRatings.courseId, courses.id))
    .where(ownedIncludedCourses(instructorId))
    .get();

  return row?.average ?? null;
}

function countIncludedCourses(instructorId: number) {
  const row = db
    .select({ count: sql<number>`count(*)` })
    .from(courses)
    .where(ownedIncludedCourses(instructorId))
    .get();

  return row?.count ?? 0;
}

export function getInstructorOverview(
  instructorId: number,
  range: AnalyticsRange,
  now: Date = new Date()
) {
  const windows = windowsFor(range, now);

  return {
    courseCount: countIncludedCourses(instructorId),
    revenue: rangedMetric((w) => sumRevenue(instructorId, w), windows),
    enrollments: rangedMetric((w) => countEnrollments(instructorId, w), windows),
    completionRate: completionRate(instructorId),
    averageRating: averageRating(instructorId),
    unansweredQuestions: getUnansweredQuestions(instructorId).length,
  };
}
