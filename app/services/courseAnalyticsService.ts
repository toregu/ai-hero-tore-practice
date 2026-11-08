import { and, asc, eq } from "drizzle-orm";
import { db } from "~/db";
import { courses } from "~/db/schema";
import {
  averageRating,
  completionRate,
  countEnrollments,
  ownedIncludedCourses,
  rangedMetric,
  sumRevenue,
  windowsFor,
  type AnalyticsRange,
} from "~/services/analyticsService";

// ─── Course Analytics Service ───
// Per-course figures for the instructor analytics pages. Metric definitions
// come from analyticsService, scoped down to a single course.

function courseScope(instructorId: number, courseId: number) {
  return and(ownedIncludedCourses(instructorId), eq(courses.id, courseId));
}

/**
 * One row per published or archived course the instructor owns, by title.
 * Revenue and enrollments follow the range; completion and rating are all-time.
 */
export function getCourseComparison(
  instructorId: number,
  range: AnalyticsRange,
  now: Date = new Date()
) {
  const current = windowsFor(range, now).current;
  const owned = db
    .select({ id: courses.id, title: courses.title, status: courses.status })
    .from(courses)
    .where(ownedIncludedCourses(instructorId))
    .orderBy(asc(courses.title))
    .all();

  return owned.map((course) => {
    const scope = courseScope(instructorId, course.id);
    return {
      courseId: course.id,
      title: course.title,
      status: course.status,
      revenue: sumRevenue(scope, current),
      enrollments: countEnrollments(scope, current),
      completionRate: completionRate(scope),
      averageRating: averageRating(scope),
    };
  });
}

export type CourseComparisonRow = ReturnType<typeof getCourseComparison>[number];

export function getCourseAnalytics(
  instructorId: number,
  courseId: number,
  range: AnalyticsRange,
  now: Date = new Date()
) {
  const scope = courseScope(instructorId, courseId);
  const course = db
    .select({ id: courses.id, title: courses.title })
    .from(courses)
    .where(scope)
    .get();

  if (!course) return null;

  const windows = windowsFor(range, now);
  return {
    course,
    revenue: rangedMetric((w) => sumRevenue(scope, w), windows),
    enrollments: rangedMetric((w) => countEnrollments(scope, w), windows),
    totalEnrollments: countEnrollments(scope, windowsFor("all", now).current),
    completionRate: completionRate(scope),
    averageRating: averageRating(scope),
  };
}
