import { asc, eq, sql } from "drizzle-orm";
import { db } from "~/db";
import { lessons, modules, quizAttempts, quizzes } from "~/db/schema";
import { LOW_PASS_RATE } from "~/lib/analytics";

// ─── Quiz Stats Service ───
// All-time pass rate and attempts per quiz in a course, in course order.
// Callers check course ownership first (see getCourseAnalytics).


export function getQuizStats(courseId: number) {
  const rows = db
    .select({
      quizId: quizzes.id,
      quizTitle: quizzes.title,
      lessonId: lessons.id,
      lessonTitle: lessons.title,
      totalAttempts: sql<number>`count(${quizAttempts.id})`,
      attemptingStudents: sql<number>`count(distinct ${quizAttempts.userId})`,
      passingStudents: sql<number>`count(distinct case when ${quizAttempts.passed} then ${quizAttempts.userId} end)`,
    })
    .from(quizzes)
    .innerJoin(lessons, eq(quizzes.lessonId, lessons.id))
    .innerJoin(modules, eq(lessons.moduleId, modules.id))
    .leftJoin(quizAttempts, eq(quizAttempts.quizId, quizzes.id))
    .where(eq(modules.courseId, courseId))
    .groupBy(quizzes.id)
    .orderBy(asc(modules.position), asc(lessons.position), asc(quizzes.id))
    .all();

  return rows.map(({ passingStudents, ...row }) => {
    // No attempts → no rate; the page shows an empty state instead of 0%.
    const attempted = row.attemptingStudents > 0;
    const passRate = attempted
      ? passingStudents / row.attemptingStudents
      : null;
    return {
      ...row,
      passRate,
      averageAttempts: attempted
        ? row.totalAttempts / row.attemptingStudents
        : null,
      isLowPassRate: passRate !== null && passRate < LOW_PASS_RATE,
    };
  });
}

export type QuizStatsRow = ReturnType<typeof getQuizStats>[number];
