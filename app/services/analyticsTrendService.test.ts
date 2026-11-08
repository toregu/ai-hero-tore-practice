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
import { getInstructorTrend } from "./analyticsTrendService";

// A Monday, midday UTC.
const NOW = new Date("2026-06-15T12:00:00.000Z");

function purchase(courseId: number, amountPaid: number, createdAt: string) {
  testDb
    .insert(schema.purchases)
    .values({ userId: base.user.id, courseId, amountPaid, createdAt })
    .run();
}

let counter = 0;

/** Enrolls a fresh student, since a student can enroll in a course only once. */
function enroll(courseId: number, enrolledAt: string) {
  counter += 1;
  const email = `student-${counter}@example.com`;
  const student = testDb
    .insert(schema.users)
    .values({ name: email, email, role: schema.UserRole.Student })
    .returning()
    .get();
  testDb
    .insert(schema.enrollments)
    .values({ userId: student.id, courseId, enrolledAt })
    .run();
}

function course(instructorId: number, status: schema.CourseStatus) {
  counter += 1;
  return testDb
    .insert(schema.courses)
    .values({
      title: `Course ${counter}`,
      slug: `course-${counter}`,
      description: "A course",
      salesCopy: "Sales copy",
      instructorId,
      categoryId: base.category.id,
      status,
    })
    .returning()
    .get();
}

describe("getInstructorTrend", () => {
  beforeEach(() => {
    testDb = createTestDb();
    base = seedBaseData(testDb);
  });

  describe("7d", () => {
    it("returns one zero-filled UTC day per bucket across the range", () => {
      purchase(base.course.id, 500, "2026-06-10T09:00:00.000Z");
      enroll(base.course.id, "2026-06-10T09:00:00.000Z");

      const trend = getInstructorTrend(base.instructor.id, "7d", NOW);

      expect(trend.granularity).toBe("day");
      expect(trend.buckets).toEqual([
        { start: "2026-06-08", revenue: 0, enrollments: 0 },
        { start: "2026-06-09", revenue: 0, enrollments: 0 },
        { start: "2026-06-10", revenue: 500, enrollments: 1 },
        { start: "2026-06-11", revenue: 0, enrollments: 0 },
        { start: "2026-06-12", revenue: 0, enrollments: 0 },
        { start: "2026-06-13", revenue: 0, enrollments: 0 },
        { start: "2026-06-14", revenue: 0, enrollments: 0 },
        { start: "2026-06-15", revenue: 0, enrollments: 0 },
      ]);
    });

    it("splits days at UTC midnight and follows the tiles' window edge", () => {
      purchase(base.course.id, 1, "2026-06-10T23:59:59.999Z");
      purchase(base.course.id, 2, "2026-06-11T00:00:00.000Z");
      // The window starts exactly 7 days before now: 2026-06-08T12:00Z.
      purchase(base.course.id, 40, "2026-06-08T11:59:59.999Z");
      purchase(base.course.id, 80, "2026-06-08T12:00:00.000Z");

      const { buckets } = getInstructorTrend(base.instructor.id, "7d", NOW);
      const revenue = Object.fromEntries(buckets.map((b) => [b.start, b.revenue]));

      expect(revenue["2026-06-08"]).toBe(80);
      expect(revenue["2026-06-10"]).toBe(1);
      expect(revenue["2026-06-11"]).toBe(2);
    });

    it("counts only the instructor's published and archived courses", () => {
      const archived = course(base.instructor.id, schema.CourseStatus.Archived);
      const draft = course(base.instructor.id, schema.CourseStatus.Draft);
      const other = testDb
        .insert(schema.users)
        .values({ name: "Other", email: "other@example.com", role: schema.UserRole.Instructor })
        .returning()
        .get();
      const theirs = course(other.id, schema.CourseStatus.Published);
      const at = "2026-06-14T10:00:00.000Z";
      for (const c of [base.course, archived, draft, theirs]) {
        purchase(c.id, 100, at);
        enroll(c.id, at);
      }

      const { buckets } = getInstructorTrend(base.instructor.id, "7d", NOW);

      expect(buckets.find((b) => b.start === "2026-06-14")).toEqual({
        start: "2026-06-14",
        revenue: 200,
        enrollments: 2,
      });
    });
  });

  describe("30d", () => {
    it("buckets by UTC day from the window start through today", () => {
      const trend = getInstructorTrend(base.instructor.id, "30d", NOW);

      expect(trend.granularity).toBe("day");
      expect(trend.buckets).toHaveLength(31);
      expect(trend.buckets[0].start).toBe("2026-05-16");
      expect(trend.buckets.at(-1)!.start).toBe("2026-06-15");
      expect(trend.buckets.every((b) => b.revenue === 0 && b.enrollments === 0)).toBe(true);
    });
  });

  describe("90d", () => {
    it("buckets by ISO week, each starting on a Monday in UTC, zero-filled", () => {
      // Sunday 23:59Z closes the week of Mon 2026-06-01; Monday 00:00Z opens the next.
      purchase(base.course.id, 300, "2026-06-07T23:59:59.999Z");
      enroll(base.course.id, "2026-06-02T08:00:00.000Z");
      purchase(base.course.id, 700, "2026-06-08T00:00:00.000Z");

      const trend = getInstructorTrend(base.instructor.id, "90d", NOW);

      expect(trend.granularity).toBe("week");
      // Window starts 2026-03-17 (a Tuesday), so the first week is Mon 2026-03-16.
      expect(trend.buckets[0]).toEqual({ start: "2026-03-16", revenue: 0, enrollments: 0 });
      expect(trend.buckets.slice(-3)).toEqual([
        { start: "2026-06-01", revenue: 300, enrollments: 1 },
        { start: "2026-06-08", revenue: 700, enrollments: 0 },
        { start: "2026-06-15", revenue: 0, enrollments: 0 },
      ]);
      expect(trend.buckets).toHaveLength(14);
    });
  });

  describe("all", () => {
    it("buckets by UTC month from the first activity through this month, zero-filled", () => {
      enroll(base.course.id, "2025-11-30T23:59:59.999Z");
      purchase(base.course.id, 900, "2025-12-01T00:00:00.000Z");
      purchase(base.course.id, 100, "2026-03-31T23:00:00.000Z");
      purchase(base.course.id, 50, "2026-06-15T11:00:00.000Z");

      const trend = getInstructorTrend(base.instructor.id, "all", NOW);

      expect(trend.granularity).toBe("month");
      expect(trend.buckets).toEqual([
        { start: "2025-11-01", revenue: 0, enrollments: 1 },
        { start: "2025-12-01", revenue: 900, enrollments: 0 },
        { start: "2026-01-01", revenue: 0, enrollments: 0 },
        { start: "2026-02-01", revenue: 0, enrollments: 0 },
        { start: "2026-03-01", revenue: 100, enrollments: 0 },
        { start: "2026-04-01", revenue: 0, enrollments: 0 },
        { start: "2026-05-01", revenue: 0, enrollments: 0 },
        { start: "2026-06-01", revenue: 50, enrollments: 0 },
      ]);
    });

    it("has no buckets when there has never been any activity", () => {
      const trend = getInstructorTrend(base.instructor.id, "all", NOW);

      expect(trend.buckets).toEqual([]);
    });
  });
});
