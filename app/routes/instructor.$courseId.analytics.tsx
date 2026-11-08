import { Link, data } from "react-router";
import type { Route } from "./+types/instructor.$courseId.analytics";
import { requireInstructor } from "~/lib/access.server";
import { parseAnalyticsRange } from "~/services/analyticsService";
import { getCourseAnalytics } from "~/services/courseAnalyticsService";
import { getLessonFunnel } from "~/services/lessonFunnelService";
import { getQuizStats } from "~/services/quizStatsService";
import { LessonFunnelChart } from "~/components/lesson-funnel-chart";
import { QuizStatsTable } from "~/components/quiz-stats-table";
import { Button } from "~/components/ui/button";
import { Card, CardContent } from "~/components/ui/card";
import { Skeleton } from "~/components/ui/skeleton";
import { BarChart3 } from "lucide-react";
import {
  AnalyticsError,
  ChangeBadge,
  RANGE_LABELS,
  RangeSelector,
  RatingValue,
  Tile,
  formatPercent,
  formatRevenue,
} from "~/components/analytics";

// ─── Course Analytics ───
// Headline numbers for one of the signed-in instructor's published or archived
// courses. A course they don't own, a draft, or a missing course is a 404.

export function meta({ loaderData }: Route.MetaArgs) {
  const title = loaderData?.analytics.course.title;
  return [{ title: title ? `${title} analytics — Cadence` : "Course analytics — Cadence" }];
}

export async function loader({ params, request }: Route.LoaderArgs) {
  const { userId } = await requireInstructor(request);
  const range = parseAnalyticsRange(new URL(request.url).searchParams.get("range"));

  const courseId = Number(params.courseId);
  const analytics = Number.isInteger(courseId)
    ? getCourseAnalytics(userId, courseId, range)
    : null;

  if (!analytics) {
    throw data("Course not found.", { status: 404 });
  }

  // Ownership is established above. The funnel and quiz stats are all-time and
  // only shown once the course has enrollments.
  const hasData = analytics.totalEnrollments > 0;
  return {
    range,
    analytics,
    funnel: hasData ? getLessonFunnel(courseId) : [],
    quizzes: hasData ? getQuizStats(courseId) : [],
  };
}

export function HydrateFallback() {
  return (
    <div className="mx-auto max-w-7xl p-6 lg:p-8">
      <Skeleton className="mb-8 h-9 w-64" />
      <div className="grid gap-6 sm:grid-cols-2 lg:grid-cols-4">
        {Array.from({ length: 4 }).map((_, i) => (
          <Skeleton key={i} className="h-36 rounded-xl" />
        ))}
      </div>
    </div>
  );
}

export default function CourseAnalytics({ loaderData }: Route.ComponentProps) {
  const { range, analytics, funnel, quizzes } = loaderData;
  const { course } = analytics;
  const rangeLabel = RANGE_LABELS[range];
  const hasData = analytics.totalEnrollments > 0;

  return (
    <div className="mx-auto max-w-7xl p-6 lg:p-8">
      <nav className="mb-6 text-sm text-muted-foreground">
        <Link to="/instructor" className="hover:text-foreground">
          My Courses
        </Link>
        <span className="mx-2">/</span>
        <Link to={`/instructor/analytics?range=${range}`} className="hover:text-foreground">
          Analytics
        </Link>
        <span className="mx-2">/</span>
        <span className="text-foreground">{course.title}</span>
      </nav>

      <div className="mb-8 flex flex-wrap items-end justify-between gap-4">
        <div>
          <h1 className="text-3xl font-bold">{course.title}</h1>
          <p className="mt-1 text-muted-foreground">
            Course analytics ·{" "}
            <Link to={`/instructor/${course.id}`} className="hover:text-foreground hover:underline">
              Edit course
            </Link>
          </p>
        </div>
        {hasData && <RangeSelector current={range} />}
      </div>

      {!hasData ? (
        <Card>
          <CardContent className="flex flex-col items-center py-16 text-center">
            <BarChart3 className="mb-4 size-12 text-muted-foreground/50" />
            <h2 className="text-lg font-medium">No data yet</h2>
            <p className="mt-1 text-sm text-muted-foreground">
              Analytics appear once students enroll in this course.
            </p>
            <Link to="/instructor/analytics" className="mt-4">
              <Button variant="outline">Back to Analytics</Button>
            </Link>
          </CardContent>
        </Card>
      ) : (
        <div className="space-y-6">
          <div className="grid gap-6 sm:grid-cols-2 lg:grid-cols-4">
            <Tile
              title="Gross revenue"
              scope={`${rangeLabel} · before fees`}
              value={formatRevenue(analytics.revenue.value)}
              footer={<ChangeBadge metric={analytics.revenue} />}
            />
            <Tile
              title="New enrollments"
              scope={rangeLabel}
              value={analytics.enrollments.value}
              footer={<ChangeBadge metric={analytics.enrollments} />}
            />
            <Tile
              title="Completion rate"
              scope="All-time"
              value={formatPercent(analytics.completionRate)}
            />
            <Tile
              title="Average rating"
              scope="All-time"
              value={<RatingValue rating={analytics.averageRating} />}
            />
          </div>
          <LessonFunnelChart steps={funnel} />
          <QuizStatsTable rows={quizzes} />
        </div>
      )}
    </div>
  );
}

export function ErrorBoundary({ error }: Route.ErrorBoundaryProps) {
  return <AnalyticsError error={error} />;
}
