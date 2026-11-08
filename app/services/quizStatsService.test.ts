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
import { getQuizStats } from "./quizStatsService";

let studentCounter = 0;

function students(count: number) {
  return Array.from({ length: count }, () => {
    studentCounter += 1;
    const email = `student-${studentCounter}@example.com`;
    return testDb
      .insert(schema.users)
      .values({ name: email, email, role: schema.UserRole.Student })
      .returning()
      .get();
  });
}

function addModule(courseId: number, position: number) {
  return testDb
    .insert(schema.modules)
    .values({ courseId, title: `Module ${position}`, position })
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

function addQuiz(lessonId: number, title: string) {
  return testDb
    .insert(schema.quizzes)
    .values({ lessonId, title, passingScore: 0.7 })
    .returning()
    .get();
}

/** Records attempts in order; `true` is a pass, `false` a fail. */
function attempts(userId: number, quizId: number, results: boolean[]) {
  results.forEach((passed) => {
    testDb
      .insert(schema.quizAttempts)
      .values({ userId, quizId, passed, score: passed ? 0.9 : 0.3 })
      .run();
  });
}

describe("getQuizStats", () => {
  beforeEach(() => {
    testDb = createTestDb();
    base = seedBaseData(testDb);
  });

  it("counts a student who eventually passed once, and averages attempts per attempting student", () => {
    const lesson = addLesson(addModule(base.course.id, 1).id, "Intro", 1);
    const quiz = addQuiz(lesson.id, "Intro quiz");
    const [a, b, c, d] = students(4);
    attempts(a.id, quiz.id, [false, false, true]); // passed on third try
    attempts(b.id, quiz.id, [true, true]); // passed twice: still one student
    attempts(c.id, quiz.id, [false]); // never passed
    attempts(d.id, quiz.id, [false, false]); // never passed

    const [stats] = getQuizStats(base.course.id);

    expect(stats).toMatchObject({
      quizTitle: "Intro quiz",
      lessonTitle: "Intro",
      attemptingStudents: 4,
      totalAttempts: 8,
      passRate: 0.5,
      averageAttempts: 2,
    });
  });

  it("lists quizzes with no attempts with empty stats rather than 0%", () => {
    const lesson = addLesson(addModule(base.course.id, 1).id, "Intro", 1);
    addQuiz(lesson.id, "Untouched quiz");

    const [stats] = getQuizStats(base.course.id);

    expect(stats).toMatchObject({
      quizTitle: "Untouched quiz",
      attemptingStudents: 0,
      totalAttempts: 0,
      passRate: null,
      averageAttempts: null,
      isLowPassRate: false,
    });
  });

  it("flags quizzes with a pass rate below 60%, but not at exactly 60%", () => {
    const mod = addModule(base.course.id, 1);
    const atThreshold = addQuiz(addLesson(mod.id, "L1", 1).id, "Three of five");
    const below = addQuiz(addLesson(mod.id, "L2", 2).id, "Two of five");
    const people = students(5);
    people.forEach((s, i) => {
      attempts(s.id, atThreshold.id, [i < 3]);
      attempts(s.id, below.id, [i < 2]);
    });

    const stats = getQuizStats(base.course.id);

    expect(
      stats.map((q) => [q.quizTitle, q.passRate, q.isLowPassRate])
    ).toEqual([
      ["Three of five", 0.6, false],
      ["Two of five", 0.4, true],
    ]);
  });

  it("lists quizzes in course order and leaves out other courses' quizzes", () => {
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
    addQuiz(
      addLesson(addModule(other.id, 1).id, "Other lesson", 1).id,
      "Other quiz"
    );

    const second = addModule(base.course.id, 2);
    const first = addModule(base.course.id, 1);
    addQuiz(addLesson(second.id, "Later", 1).id, "Later quiz");
    addQuiz(addLesson(first.id, "Earlier", 1).id, "Earlier quiz");

    expect(getQuizStats(base.course.id).map((q) => q.quizTitle)).toEqual([
      "Earlier quiz",
      "Later quiz",
    ]);
  });
});
