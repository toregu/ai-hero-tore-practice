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
import { getInstructorOverview, parseAnalyticsRange } from "./analyticsService";

const NOW = new Date("2026-06-15T12:00:00.000Z");

function daysBeforeNow(days: number) {
  return new Date(NOW.getTime() - days * 24 * 60 * 60 * 1000).toISOString();
}

function purchase(courseId: number, amountPaid: number, createdAt: string) {
  return testDb
    .insert(schema.purchases)
    .values({ userId: base.user.id, courseId, amountPaid, createdAt })
    .returning()
    .get();
}

let studentCounter = 0;

/** Enrolls a fresh student, since a student can enroll in a course only once. */
function enroll(courseId: number, enrolledAt: string, completedAt?: string) {
  studentCounter += 1;
  const student = user(`student-${studentCounter}@example.com`);
  return testDb
    .insert(schema.enrollments)
    .values({ userId: student.id, courseId, enrolledAt, completedAt })
    .returning()
    .get();
}

function rate(courseId: number, rating: number, createdAt: string) {
  studentCounter += 1;
  const student = user(`rater-${studentCounter}@example.com`);
  testDb
    .insert(schema.courseRatings)
    .values({ userId: student.id, courseId, rating, createdAt, updatedAt: createdAt })
    .run();
}

function lesson(courseId: number) {
  const mod = testDb
    .insert(schema.modules)
    .values({ courseId, title: "Module", position: 1 })
    .returning()
    .get();
  return testDb
    .insert(schema.lessons)
    .values({ moduleId: mod.id, title: "Lesson", position: 1 })
    .returning()
    .get();
}

function comment(lessonId: number, userId: number, parentId?: number) {
  return testDb
    .insert(schema.comments)
    .values({ lessonId, userId, parentId, body: "Question?" })
    .returning()
    .get();
}

let slugCounter = 0;

function user(email: string, role = schema.UserRole.Student) {
  return testDb
    .insert(schema.users)
    .values({ name: email, email, role })
    .returning()
    .get();
}

function course(instructorId: number, status: schema.CourseStatus) {
  slugCounter += 1;
  return testDb
    .insert(schema.courses)
    .values({
      title: `Course ${slugCounter}`,
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

describe("analyticsService", () => {
  beforeEach(() => {
    testDb = createTestDb();
    base = seedBaseData(testDb);
  });

  describe("getInstructorOverview — revenue", () => {
    it("sums gross revenue for purchases in the range", () => {
      purchase(base.course.id, 4999, daysBeforeNow(2));
      purchase(base.course.id, 2500, daysBeforeNow(20));

      const overview = getInstructorOverview(base.instructor.id, "30d", NOW);

      expect(overview.revenue.value).toBe(7499);
    });

    it("includes the range's start boundary and excludes anything older", () => {
      purchase(base.course.id, 100, daysBeforeNow(30));
      purchase(base.course.id, 200, daysBeforeNow(30.01));

      const overview = getInstructorOverview(base.instructor.id, "30d", NOW);

      expect(overview.revenue.value).toBe(100);
    });

    it("counts every purchase when the range is all time", () => {
      purchase(base.course.id, 100, daysBeforeNow(2));
      purchase(base.course.id, 200, daysBeforeNow(400));

      const overview = getInstructorOverview(base.instructor.id, "all", NOW);

      expect(overview.revenue.value).toBe(300);
    });

    it("includes archived courses but excludes drafts and other instructors' courses", () => {
      const archived = course(base.instructor.id, schema.CourseStatus.Archived);
      const draft = course(base.instructor.id, schema.CourseStatus.Draft);
      const otherInstructor = user("other@example.com", schema.UserRole.Instructor);
      const theirs = course(otherInstructor.id, schema.CourseStatus.Published);

      purchase(base.course.id, 1000, daysBeforeNow(1));
      purchase(archived.id, 300, daysBeforeNow(1));
      purchase(draft.id, 50, daysBeforeNow(1));
      purchase(theirs.id, 7000, daysBeforeNow(1));

      const overview = getInstructorOverview(base.instructor.id, "30d", NOW);

      expect(overview.revenue.value).toBe(1300);
    });

    it("counts a team purchase once at its full amount, even with unredeemed coupons", () => {
      const team = testDb.insert(schema.teams).values({}).returning().get();
      const teamPurchase = purchase(base.course.id, 5 * 4999, daysBeforeNow(3));
      testDb
        .insert(schema.coupons)
        .values(
          ["A", "B", "C", "D", "E"].map((code) => ({
            teamId: team.id,
            courseId: base.course.id,
            code,
            purchaseId: teamPurchase.id,
          }))
        )
        .run();

      const overview = getInstructorOverview(base.instructor.id, "7d", NOW);

      expect(overview.revenue.value).toBe(24995);
    });
  });

  describe("getInstructorOverview — enrollments", () => {
    it("counts enrollments in the range on included courses only", () => {
      const draft = course(base.instructor.id, schema.CourseStatus.Draft);
      enroll(base.course.id, daysBeforeNow(1));
      enroll(base.course.id, daysBeforeNow(6));
      enroll(base.course.id, daysBeforeNow(8));
      enroll(draft.id, daysBeforeNow(1));

      const overview = getInstructorOverview(base.instructor.id, "7d", NOW);

      expect(overview.enrollments.value).toBe(2);
    });
  });

  describe("getInstructorOverview — completion rate", () => {
    it("divides completed enrollments by all enrollments, all-time, including students with no activity", () => {
      const archived = course(base.instructor.id, schema.CourseStatus.Archived);
      const draft = course(base.instructor.id, schema.CourseStatus.Draft);
      // Completed long before the 7d range — completion rate ignores the range.
      enroll(base.course.id, daysBeforeNow(200), daysBeforeNow(150));
      enroll(archived.id, daysBeforeNow(100), daysBeforeNow(90));
      // Two enrolled students who never opened a lesson.
      enroll(base.course.id, daysBeforeNow(50));
      enroll(base.course.id, daysBeforeNow(3));
      // Draft enrollments don't count.
      enroll(draft.id, daysBeforeNow(3), daysBeforeNow(2));

      const overview = getInstructorOverview(base.instructor.id, "7d", NOW);

      expect(overview.completionRate).toBe(0.5);
    });

    it("is null when there are no enrollments", () => {
      const overview = getInstructorOverview(base.instructor.id, "30d", NOW);

      expect(overview.completionRate).toBeNull();
    });
  });

  describe("getInstructorOverview — average rating", () => {
    it("averages ratings across the instructor's included courses, all-time", () => {
      const archived = course(base.instructor.id, schema.CourseStatus.Archived);
      const otherInstructor = user("other@example.com", schema.UserRole.Instructor);
      const theirs = course(otherInstructor.id, schema.CourseStatus.Published);
      rate(base.course.id, 5, daysBeforeNow(300));
      rate(base.course.id, 4, daysBeforeNow(1));
      rate(archived.id, 3, daysBeforeNow(1));
      rate(theirs.id, 1, daysBeforeNow(1));

      const overview = getInstructorOverview(base.instructor.id, "7d", NOW);

      expect(overview.averageRating).toBe(4);
    });

    it("is null when there are no ratings", () => {
      const overview = getInstructorOverview(base.instructor.id, "30d", NOW);

      expect(overview.averageRating).toBeNull();
    });
  });

  describe("getInstructorOverview — unanswered questions", () => {
    it("counts the instructor's questions still waiting on an answer", () => {
      const otherInstructor = user("other@example.com", schema.UserRole.Instructor);
      const theirs = course(otherInstructor.id, schema.CourseStatus.Published);
      const myLesson = lesson(base.course.id);
      const theirLesson = lesson(theirs.id);

      comment(myLesson.id, base.user.id); // waiting
      const answered = comment(myLesson.id, base.user.id);
      comment(myLesson.id, base.instructor.id, answered.id); // instructor replied
      comment(theirLesson.id, base.user.id); // someone else's queue

      const overview = getInstructorOverview(base.instructor.id, "30d", NOW);

      expect(overview.unansweredQuestions).toBe(1);
    });
  });

  describe("getInstructorOverview — included courses", () => {
    it("counts only published and archived courses, so the page can show an empty state", () => {
      course(base.instructor.id, schema.CourseStatus.Archived);
      course(base.instructor.id, schema.CourseStatus.Draft);

      const overview = getInstructorOverview(base.instructor.id, "30d", NOW);

      expect(overview.courseCount).toBe(2);
    });

    it("is zero for an instructor with only drafts", () => {
      const newcomer = user("new@example.com", schema.UserRole.Instructor);
      course(newcomer.id, schema.CourseStatus.Draft);

      const overview = getInstructorOverview(newcomer.id, "30d", NOW);

      expect(overview.courseCount).toBe(0);
    });
  });

  describe("getInstructorOverview — change vs previous period", () => {
    it("compares against the equal-length window immediately before the range", () => {
      // Current 7d window: 300 revenue, 2 enrollments.
      purchase(base.course.id, 100, daysBeforeNow(1));
      purchase(base.course.id, 200, daysBeforeNow(5));
      enroll(base.course.id, daysBeforeNow(1));
      enroll(base.course.id, daysBeforeNow(5));
      // Previous 7d window (7–14 days ago): 200 revenue, 4 enrollments.
      purchase(base.course.id, 200, daysBeforeNow(10));
      for (const days of [8, 9, 12, 13]) enroll(base.course.id, daysBeforeNow(days));
      // Older than both windows — ignored.
      purchase(base.course.id, 9999, daysBeforeNow(15));

      const overview = getInstructorOverview(base.instructor.id, "7d", NOW);

      expect(overview.revenue.changePercent).toBe(50);
      expect(overview.enrollments.changePercent).toBe(-50);
    });

    it("has no % change when the previous period was zero", () => {
      purchase(base.course.id, 100, daysBeforeNow(1));
      enroll(base.course.id, daysBeforeNow(1));

      const overview = getInstructorOverview(base.instructor.id, "30d", NOW);

      expect(overview.revenue.changePercent).toBeNull();
      expect(overview.enrollments.changePercent).toBeNull();
    });

    it("has no % change for all time", () => {
      purchase(base.course.id, 100, daysBeforeNow(1));
      purchase(base.course.id, 100, daysBeforeNow(200));

      const overview = getInstructorOverview(base.instructor.id, "all", NOW);

      expect(overview.revenue.changePercent).toBeNull();
      expect(overview.enrollments.changePercent).toBeNull();
    });
  });

  describe("parseAnalyticsRange", () => {
    it("accepts each supported range", () => {
      expect(["7d", "30d", "90d", "all"].map(parseAnalyticsRange)).toEqual([
        "7d",
        "30d",
        "90d",
        "all",
      ]);
    });

    it("defaults to the last 30 days when missing or invalid", () => {
      expect(parseAnalyticsRange(null)).toBe("30d");
      expect(parseAnalyticsRange("14d")).toBe("30d");
    });
  });
});
