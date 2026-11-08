import { and, asc, count, eq, inArray, sql } from "drizzle-orm";
import { db } from "~/db";
import {
  enrollments,
  lessonProgress,
  lessons,
  LessonProgressStatus,
  modules,
} from "~/db/schema";

// ─── Lesson Funnel Service ───
// All-time share of a course's enrolled students who completed each lesson, in
// course order. Callers check course ownership first (see getCourseAnalytics).

const TOP_DROP_COUNT = 3;

export type LessonFunnelStep = ReturnType<typeof getLessonFunnel>[number];

export function getLessonFunnel(courseId: number) {
  const totalEnrollments =
    db
      .select({ value: count() })
      .from(enrollments)
      .where(eq(enrollments.courseId, courseId))
      .get()?.value ?? 0;

  // Only enrolled students count, so a lesson can't exceed 100%.
  const enrolledStudents = db
    .select({ userId: enrollments.userId })
    .from(enrollments)
    .where(eq(enrollments.courseId, courseId));
  const completed = sql<number>`count(distinct ${lessonProgress.userId})`;

  const rows = db
    .select({
      lessonId: lessons.id,
      lessonTitle: lessons.title,
      moduleId: modules.id,
      moduleTitle: modules.title,
      completed,
    })
    .from(lessons)
    .innerJoin(modules, eq(lessons.moduleId, modules.id))
    .leftJoin(
      lessonProgress,
      and(
        eq(lessonProgress.lessonId, lessons.id),
        eq(lessonProgress.status, LessonProgressStatus.Completed),
        inArray(lessonProgress.userId, enrolledStudents)
      )
    )
    .where(eq(modules.courseId, courseId))
    .groupBy(lessons.id)
    .orderBy(asc(modules.position), asc(lessons.position))
    .all();

  // No enrollments → no meaningful percentage; the page shows an empty state.
  const percents = rows.map((row) =>
    totalEnrollments === 0 ? null : (row.completed / totalEnrollments) * 100
  );

  const drops = percents.map((p, i) => {
    const previous = percents[i - 1];
    return i === 0 || p === null || previous === null ? null : previous - p;
  });

  const topDrops = new Set(
    drops
      .map((drop, i) => ({ drop, i }))
      .filter(
        (d): d is { drop: number; i: number } => d.drop !== null && d.drop > 0
      )
      .sort((a, b) => b.drop - a.drop)
      .slice(0, TOP_DROP_COUNT)
      .map((d) => d.i)
  );

  return rows.map((row, i) => ({
    ...row,
    completedPercent: percents[i],
    /** Percentage points lost since the previous lesson; null for the first. */
    drop: drops[i],
    isTopDrop: topDrops.has(i),
  }));
}
