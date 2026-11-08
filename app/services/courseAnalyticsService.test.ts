import { describe, it, expect, beforeEach, vi } from "vitest";
import { createTestDb, seedBaseData } from "~/test/setup";
import * as schema from "~/db/schema";

let testDb: ReturnType<typeof createTestDb>;
let base: ReturnType<typeof seedBaseData>;

vi.mock("~/db", () => ({
  get db() {
    return testDb;
  },
}));

// Import after mock so the module picks up our test db
import { getCourseAnalytics, getCourseComparison } from "./courseAnalyticsService";

const NOW = new Date("2026-06-15T12:00:00.000Z");

function daysBeforeNow(days: number) {
  return new Date(NOW.getTime() - days * 24 * 60 * 60 * 1000).toISOString();
}

function purchase(courseId: number, amountPaid: number, createdAt: string) {
  testDb
    .insert(schema.purchases)
    .values({ userId: base.user.id, courseId, amountPaid, createdAt })
    .run();
}

let studentCounter = 0;

/** Enrolls a fresh student, since a student can enroll in a course only once. */
function enroll(courseId: number, enrolledAt: string, completedAt?: string) {
  studentCounter += 1;
  const student = user(`student-${studentCounter}@example.com`);
  testDb
    .insert(schema.enrollments)
    .values({ userId: student.id, courseId, enrolledAt, completedAt })
    .run();
}

function rate(courseId: number, rating: number, createdAt: string) {
  studentCounter += 1;
  const student = user(`rater-${studentCounter}@example.com`);
  testDb
    .insert(schema.courseRatings)
    .values({ userId: student.id, courseId, rating, createdAt, updatedAt: createdAt })
    .run();
}

function user(email: string, role = schema.UserRole.Student) {
  return testDb
    .insert(schema.users)
    .values({ name: email, email, role })
    .returning()
    .get();
}

let slugCounter = 0;

function course(instructorId: number, status: schema.CourseStatus, title?: string) {
  slugCounter += 1;
  return testDb
    .insert(schema.courses)
    .values({
      title: title ?? `Course ${slugCounter}`,
      slug: `course-${slugCounter}`,
      description: "A course",
      salesCopy: "Sales copy",
      instructorId,
      categoryId: base.category.id,
      status,
    })
    .returning()
    .get();
}

describe("courseAnalyticsService", () => {
  beforeEach(() => {
    testDb = createTestDb();
    base = seedBaseData(testDb);
  });

  describe("getCourseComparison", () => {
    it("lists each published and archived course with its own figures, leaving out drafts and other instructors' courses", () => {
      const archived = course(base.instructor.id, schema.CourseStatus.Archived, "Archived Course");
      const draft = course(base.instructor.id, schema.CourseStatus.Draft, "Draft Course");
      const other = user("other@example.com", schema.UserRole.Instructor);
      course(other.id, schema.CourseStatus.Published, "Their Course");

      purchase(base.course.id, 1000, daysBeforeNow(1));
      purchase(base.course.id, 500, daysBeforeNow(3));
      enroll(base.course.id, daysBeforeNow(1), daysBeforeNow(1));
      enroll(base.course.id, daysBeforeNow(2));
      rate(base.course.id, 4, daysBeforeNow(1));
      purchase(archived.id, 200, daysBeforeNow(5));
      enroll(archived.id, daysBeforeNow(5), daysBeforeNow(4));
      rate(archived.id, 2, daysBeforeNow(5));
      purchase(draft.id, 50, daysBeforeNow(1));

      const rows = getCourseComparison(base.instructor.id, "30d", NOW);

      expect(rows).toEqual([
        {
          courseId: archived.id,
          title: "Archived Course",
          status: schema.CourseStatus.Archived,
          revenue: 200,
          enrollments: 1,
          completionRate: 1,
          averageRating: 2,
        },
        {
          courseId: base.course.id,
          title: "Test Course",
          status: schema.CourseStatus.Published,
          revenue: 1500,
          enrollments: 2,
          completionRate: 0.5,
          averageRating: 4,
        },
      ]);
    });
  });

  describe("getCourseComparison — range", () => {
    it("scopes revenue and enrollments to the range but keeps completion and rating all-time", () => {
      purchase(base.course.id, 100, daysBeforeNow(2));
      purchase(base.course.id, 900, daysBeforeNow(60));
      enroll(base.course.id, daysBeforeNow(2));
      enroll(base.course.id, daysBeforeNow(60), daysBeforeNow(50));
      rate(base.course.id, 5, daysBeforeNow(60));

      const [last7] = getCourseComparison(base.instructor.id, "7d", NOW);
      const [allTime] = getCourseComparison(base.instructor.id, "all", NOW);

      expect(last7).toMatchObject({ revenue: 100, enrollments: 1, completionRate: 0.5, averageRating: 5 });
      expect(allTime).toMatchObject({ revenue: 1000, enrollments: 2, completionRate: 0.5, averageRating: 5 });
    });

    it("shows zero revenue and enrollments and no completion or rating for a course with no activity", () => {
      expect(getCourseComparison(base.instructor.id, "30d", NOW)).toEqual([
        expect.objectContaining({
          courseId: base.course.id,
          revenue: 0,
          enrollments: 0,
          completionRate: null,
          averageRating: null,
        }),
      ]);
    });

    it("is empty for an instructor with only drafts", () => {
      const newcomer = user("new@example.com", schema.UserRole.Instructor);
      course(newcomer.id, schema.CourseStatus.Draft);

      expect(getCourseComparison(newcomer.id, "30d", NOW)).toEqual([]);
    });
  });

  describe("getCourseAnalytics — access", () => {
    it("returns nothing for another instructor's course", () => {
      const other = user("other@example.com", schema.UserRole.Instructor);
      const theirs = course(other.id, schema.CourseStatus.Published);
      purchase(theirs.id, 1000, daysBeforeNow(1));

      expect(getCourseAnalytics(base.instructor.id, theirs.id, "30d", NOW)).toBeNull();
    });

    it("returns nothing for a course that doesn't exist", () => {
      expect(getCourseAnalytics(base.instructor.id, 99999, "30d", NOW)).toBeNull();
    });

    it("returns nothing for the instructor's own draft, which analytics leave out", () => {
      const draft = course(base.instructor.id, schema.CourseStatus.Draft);

      expect(getCourseAnalytics(base.instructor.id, draft.id, "30d", NOW)).toBeNull();
    });

    it("covers the instructor's archived courses", () => {
      const archived = course(base.instructor.id, schema.CourseStatus.Archived);

      expect(getCourseAnalytics(base.instructor.id, archived.id, "30d", NOW)).not.toBeNull();
    });
  });

  describe("getCourseAnalytics — change vs previous period", () => {
    it("compares this course's revenue and enrollments with the previous window", () => {
      purchase(base.course.id, 300, daysBeforeNow(1));
      enroll(base.course.id, daysBeforeNow(1));
      enroll(base.course.id, daysBeforeNow(2));
      purchase(base.course.id, 200, daysBeforeNow(10));
      for (const days of [8, 9, 12, 13]) enroll(base.course.id, daysBeforeNow(days));

      const analytics = getCourseAnalytics(base.instructor.id, base.course.id, "7d", NOW);

      expect(analytics?.revenue.changePercent).toBe(50);
      expect(analytics?.enrollments.changePercent).toBe(-50);
    });

    it("has no % change for all time", () => {
      purchase(base.course.id, 300, daysBeforeNow(1));

      const analytics = getCourseAnalytics(base.instructor.id, base.course.id, "all", NOW);

      expect(analytics?.revenue.changePercent).toBeNull();
    });
  });

  describe("getCourseAnalytics — no data", () => {
    it("reports zero enrollments and empty all-time figures for a course nobody has joined", () => {
      const analytics = getCourseAnalytics(base.instructor.id, base.course.id, "30d", NOW);

      expect(analytics).toMatchObject({
        revenue: { value: 0, changePercent: null },
        enrollments: { value: 0, changePercent: null },
        totalEnrollments: 0,
        completionRate: null,
        averageRating: null,
      });
    });
  });

  describe("getCourseAnalytics — figures", () => {
    it("counts only this course; revenue and enrollments follow the range, completion and rating are all-time", () => {
      const sibling = course(base.instructor.id, schema.CourseStatus.Published);

      // In the 7d range
      purchase(base.course.id, 1000, daysBeforeNow(1));
      enroll(base.course.id, daysBeforeNow(2));
      // Before the range — excluded from revenue/enrollments, still counted all-time
      purchase(base.course.id, 5000, daysBeforeNow(100));
      enroll(base.course.id, daysBeforeNow(100), daysBeforeNow(90));
      enroll(base.course.id, daysBeforeNow(200), daysBeforeNow(150));
      enroll(base.course.id, daysBeforeNow(300));
      rate(base.course.id, 5, daysBeforeNow(300));
      rate(base.course.id, 3, daysBeforeNow(1));
      // The instructor's other course — never counted here
      purchase(sibling.id, 9999, daysBeforeNow(1));
      enroll(sibling.id, daysBeforeNow(1), daysBeforeNow(1));
      rate(sibling.id, 1, daysBeforeNow(1));

      const analytics = getCourseAnalytics(base.instructor.id, base.course.id, "7d", NOW);

      expect(analytics).toMatchObject({
        course: { id: base.course.id, title: "Test Course" },
        revenue: { value: 1000 },
        enrollments: { value: 1 },
        totalEnrollments: 4,
        completionRate: 0.5,
        averageRating: 4,
      });
    });
  });
});
