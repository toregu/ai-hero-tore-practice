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
import { getLessonFunnel } from "./lessonFunnelService";

let studentCounter = 0;

function student() {
  studentCounter += 1;
  const email = `student-${studentCounter}@example.com`;
  return testDb
    .insert(schema.users)
    .values({ name: email, email, role: schema.UserRole.Student })
    .returning()
    .get();
}

/** Enrolls `count` fresh students in the course and returns them. */
function enrollStudents(courseId: number, count: number) {
  return Array.from({ length: count }, () => {
    const s = student();
    testDb
      .insert(schema.enrollments)
      .values({
        userId: s.id,
        courseId,
        enrolledAt: "2026-01-01T00:00:00.000Z",
      })
      .run();
    return s;
  });
}

function addModule(courseId: number, title: string, position: number) {
  return testDb
    .insert(schema.modules)
    .values({ courseId, title, position })
    .returning()
    .get();
}

function addLesson(moduleId: number, title: string, position: number) {
  return testDb
    .insert(schema.lessons)
    .values({ moduleId, title, position })
    .returning()
    .get();
}

function progress(
  userId: number,
  lessonId: number,
  status = schema.LessonProgressStatus.Completed
) {
  testDb
    .insert(schema.lessonProgress)
    .values({
      userId,
      lessonId,
      status,
      completedAt:
        status === schema.LessonProgressStatus.Completed
          ? "2026-01-02T00:00:00.000Z"
          : null,
    })
    .run();
}

/** Marks the first `count` students as having completed the lesson. */
function complete(students: { id: number }[], lessonId: number, count: number) {
  students.slice(0, count).forEach((s) => progress(s.id, lessonId));
}

describe("getLessonFunnel", () => {
  beforeEach(() => {
    testDb = createTestDb();
    base = seedBaseData(testDb);
  });

  it("lists every lesson by module position then lesson position, with completed ÷ enrollments", () => {
    // Inserted out of order so ids don't match course order.
    const second = addModule(base.course.id, "Second module", 2);
    const first = addModule(base.course.id, "First module", 1);
    const s2l1 = addLesson(second.id, "S2 L1", 1);
    const f1l2 = addLesson(first.id, "F1 L2", 2);
    const f1l1 = addLesson(first.id, "F1 L1", 1);

    const students = enrollStudents(base.course.id, 4);
    complete(students, f1l1.id, 4);
    complete(students, f1l2.id, 3);
    complete(students, s2l1.id, 1);
    // In-progress rows don't count as completions.
    progress(students[3].id, s2l1.id, schema.LessonProgressStatus.InProgress);

    const funnel = getLessonFunnel(base.course.id);

    expect(
      funnel.map((l) => [l.moduleTitle, l.lessonTitle, l.completedPercent])
    ).toEqual([
      ["First module", "F1 L1", 100],
      ["First module", "F1 L2", 75],
      ["Second module", "S2 L1", 25],
    ]);
  });

  it("shows each lesson's real % when completed out of order, and measures drops across modules", () => {
    const first = addModule(base.course.id, "First module", 1);
    const second = addModule(base.course.id, "Second module", 2);
    const a = addLesson(first.id, "A", 1);
    const b = addLesson(first.id, "B", 2);
    const c = addLesson(second.id, "C", 1);

    const students = enrollStudents(base.course.id, 10);
    complete(students, a.id, 5);
    // Students skipped ahead: B has more completions than A.
    complete(students, b.id, 8);
    complete(students, c.id, 2);

    const funnel = getLessonFunnel(base.course.id);

    expect(
      funnel.map((l) => [l.lessonTitle, l.completedPercent, l.drop])
    ).toEqual([
      ["A", 50, null],
      ["B", 80, -30],
      ["C", 20, 60],
    ]);
  });

  it("flags exactly the three largest positive drops", () => {
    const mod = addModule(base.course.id, "Only module", 1);
    const students = enrollStudents(base.course.id, 10);
    // Completions per lesson → drops of 1, 3, -2, 2, 4 lessons (×10 points).
    const counts = [10, 9, 6, 8, 6, 2];
    counts.forEach((n, i) => {
      const lesson = addLesson(mod.id, `L${i + 1}`, i + 1);
      complete(students, lesson.id, n);
    });

    const funnel = getLessonFunnel(base.course.id);

    expect(funnel.filter((l) => l.isTopDrop).map((l) => l.lessonTitle)).toEqual(
      ["L3", "L5", "L6"]
    );
  });

  it("flags only positive drops when fewer than three lessons lose students", () => {
    const mod = addModule(base.course.id, "Only module", 1);
    const students = enrollStudents(base.course.id, 4);
    [2, 3, 4, 1].forEach((n, i) => {
      const lesson = addLesson(mod.id, `L${i + 1}`, i + 1);
      complete(students, lesson.id, n);
    });

    const funnel = getLessonFunnel(base.course.id);

    expect(funnel.filter((l) => l.isTopDrop).map((l) => l.lessonTitle)).toEqual(
      ["L4"]
    );
  });

  it("has no percentages or flags when the course has no enrollments", () => {
    const mod = addModule(base.course.id, "Only module", 1);
    addLesson(mod.id, "L1", 1);
    addLesson(mod.id, "L2", 2);

    const funnel = getLessonFunnel(base.course.id);

    expect(
      funnel.map((l) => [
        l.lessonTitle,
        l.completedPercent,
        l.drop,
        l.isTopDrop,
      ])
    ).toEqual([
      ["L1", null, null, false],
      ["L2", null, null, false],
    ]);
  });

  it("only counts completions by students enrolled in the course, so it never exceeds 100%", () => {
    const lesson = addLesson(addModule(base.course.id, "Only module", 1).id, "L1", 1);
    const enrolled = enrollStudents(base.course.id, 2);
    complete(enrolled, lesson.id, 2);
    progress(student().id, lesson.id); // completed without an enrollment

    expect(getLessonFunnel(base.course.id).map((l) => [l.completed, l.completedPercent])).toEqual([
      [2, 100],
    ]);
  });

  it("ignores lessons and enrollments from other courses", () => {
    const other = testDb
      .insert(schema.courses)
      .values({
        title: "Other",
        slug: "other",
        description: "d",
        salesCopy: "s",
        instructorId: base.instructor.id,
        categoryId: base.category.id,
        status: schema.CourseStatus.Published,
      })
      .returning()
      .get();
    const otherLesson = addLesson(
      addModule(other.id, "Other module", 1).id,
      "Other L1",
      1
    );
    const otherStudents = enrollStudents(other.id, 3);
    complete(otherStudents, otherLesson.id, 3);

    const lesson = addLesson(
      addModule(base.course.id, "Mine", 1).id,
      "Mine L1",
      1
    );
    const students = enrollStudents(base.course.id, 2);
    complete(students, lesson.id, 1);

    expect(
      getLessonFunnel(base.course.id).map((l) => [
        l.lessonTitle,
        l.completedPercent,
      ])
    ).toEqual([["Mine L1", 50]]);
  });
});
