import { Link, isRouteErrorResponse } from "react-router";
import type { Route } from "./+types/instructor.analytics";
import { requireInstructor } from "~/lib/access.server";
import {
  ANALYTICS_RANGES,
  getInstructorOverview,
  parseAnalyticsRange,
  type AnalyticsRange,
  type RangedMetric,
} from "~/services/analyticsService";
import { Button } from "~/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "~/components/ui/card";
import { Skeleton } from "~/components/ui/skeleton";
import { AlertTriangle, BarChart3, Minus, TrendingDown, TrendingUp } from "lucide-react";
import { cn, formatPrice } from "~/lib/utils";

// ─── Instructor Analytics Overview ───
// Headline numbers across all of the signed-in instructor's published and
// archived courses. Every tile says whether it follows the range selector or is
// all-time, so nobody misreads a lifetime number as last month's.

const RANGE_LABELS: Record<AnalyticsRange, string> = {
  "7d": "Last 7 days",
  "30d": "Last 30 days",
  "90d": "Last 90 days",
  all: "All time",
};

export function meta() {
  return [{ title: "Analytics — Cadence" }];
}

export async function loader({ request }: Route.LoaderArgs) {
  const { userId } = await requireInstructor(request);
  const range = parseAnalyticsRange(new URL(request.url).searchParams.get("range"));

  return { range, overview: getInstructorOverview(userId, range) };
}

function formatRevenue(cents: number) {
  // formatPrice renders 0 as "Free", which reads wrong for earnings.
  return cents === 0 ? "$0.00" : formatPrice(cents);
}

function formatPercent(fraction: number | null) {
  return fraction === null ? "—" : `${Math.round(fraction * 100)}%`;
}

function ChangeBadge({ metric }: { metric: RangedMetric }) {
  if (metric.changePercent === null) return null;

  const rounded = Math.round(metric.changePercent);
  const Icon = rounded > 0 ? TrendingUp : rounded < 0 ? TrendingDown : Minus;

  return (
    <span
      className={cn(
        "inline-flex items-center gap-1 text-xs font-medium",
        rounded > 0 && "text-green-700 dark:text-green-400",
        rounded < 0 && "text-red-700 dark:text-red-400",
        rounded === 0 && "text-muted-foreground"
      )}
    >
      <Icon className="size-3.5" />
      {rounded > 0 ? "+" : ""}
      {rounded}% vs previous period
    </span>
  );
}

function Tile({
  title,
  scope,
  value,
  footer,
}: {
  title: string;
  scope: string;
  value: React.ReactNode;
  footer?: React.ReactNode;
}) {
  return (
    <Card className="gap-2">
      <CardHeader>
        <CardTitle className="text-sm font-medium text-muted-foreground">
          {title}
        </CardTitle>
        <p className="text-xs text-muted-foreground">{scope}</p>
      </CardHeader>
      <CardContent className="space-y-1">
        <div className="text-3xl font-bold tabular-nums">{value}</div>
        {footer}
      </CardContent>
    </Card>
  );
}

function RangeSelector({ current }: { current: AnalyticsRange }) {
  return (
    <div className="inline-flex rounded-lg border p-1" role="group" aria-label="Time range">
      {ANALYTICS_RANGES.map((range) => (
        <Link
          key={range}
          to={`?range=${range}`}
          preventScrollReset
          aria-current={range === current ? "true" : undefined}
          className={cn(
            "rounded-md px-3 py-1.5 text-sm font-medium transition-colors",
            range === current
              ? "bg-primary text-primary-foreground"
              : "text-muted-foreground hover:bg-accent hover:text-accent-foreground"
          )}
        >
          {RANGE_LABELS[range]}
        </Link>
      ))}
    </div>
  );
}

export function HydrateFallback() {
  return (
    <div className="mx-auto max-w-7xl p-6 lg:p-8">
      <Skeleton className="mb-8 h-9 w-48" />
      <div className="grid gap-6 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-5">
        {Array.from({ length: 5 }).map((_, i) => (
          <Skeleton key={i} className="h-36 rounded-xl" />
        ))}
      </div>
    </div>
  );
}

export default function InstructorAnalytics({ loaderData }: Route.ComponentProps) {
  const { range, overview } = loaderData;
  const rangeLabel = RANGE_LABELS[range];

  return (
    <div className="mx-auto max-w-7xl p-6 lg:p-8">
      <nav className="mb-6 text-sm text-muted-foreground">
        <Link to="/" className="hover:text-foreground">
          Home
        </Link>
        <span className="mx-2">/</span>
        <Link to="/instructor" className="hover:text-foreground">
          My Courses
        </Link>
        <span className="mx-2">/</span>
        <span className="text-foreground">Analytics</span>
      </nav>

      <div className="mb-8 flex flex-wrap items-end justify-between gap-4">
        <div>
          <h1 className="text-3xl font-bold">Analytics</h1>
          <p className="mt-1 text-muted-foreground">
            How your published and archived courses are doing
          </p>
        </div>
        {overview.courseCount > 0 && <RangeSelector current={range} />}
      </div>

      {overview.courseCount === 0 ? (
        <Card>
          <CardContent className="flex flex-col items-center py-16 text-center">
            <BarChart3 className="mb-4 size-12 text-muted-foreground/50" />
            <h2 className="text-lg font-medium">No data yet</h2>
            <p className="mt-1 text-sm text-muted-foreground">
              Analytics appear once you publish a course.
            </p>
            <Link to="/instructor" className="mt-4">
              <Button variant="outline">Go to My Courses</Button>
            </Link>
          </CardContent>
        </Card>
      ) : (
        <div className="grid gap-6 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-5">
          <Tile
            title="Gross revenue"
            scope={`${rangeLabel} · before fees`}
            value={formatRevenue(overview.revenue.value)}
            footer={<ChangeBadge metric={overview.revenue} />}
          />
          <Tile
            title="New enrollments"
            scope={rangeLabel}
            value={overview.enrollments.value}
            footer={<ChangeBadge metric={overview.enrollments} />}
          />
          <Tile
            title="Completion rate"
            scope="All-time"
            value={formatPercent(overview.completionRate)}
          />
          <Tile
            title="Average rating"
            scope="All-time"
            value={
              overview.averageRating === null ? (
                <span className="text-base font-normal text-muted-foreground">
                  No ratings yet
                </span>
              ) : (
                `${overview.averageRating.toFixed(1)} / 5`
              )
            }
          />
          <Tile
            title="Unanswered questions"
            scope="Right now"
            value={overview.unansweredQuestions}
            footer={
              <Link
                to="/instructor/questions"
                className="text-xs font-medium text-primary hover:underline"
              >
                Open questions queue →
              </Link>
            }
          />
        </div>
      )}
    </div>
  );
}

export function ErrorBoundary({ error }: Route.ErrorBoundaryProps) {
  let title = "Something went wrong";
  let message = "An unexpected error occurred while loading your analytics.";

  if (isRouteErrorResponse(error)) {
    if (error.status === 401) {
      title = "Sign in required";
    } else if (error.status === 403) {
      title = "Access denied";
    } else {
      title = `Error ${error.status}`;
    }
    message = typeof error.data === "string" ? error.data : error.statusText;
  }

  return (
    <div className="flex min-h-[50vh] items-center justify-center p-6">
      <div className="text-center">
        <AlertTriangle className="mx-auto mb-4 size-12 text-muted-foreground" />
        <h1 className="mb-2 text-2xl font-bold">{title}</h1>
        <p className="mb-6 text-muted-foreground">{message}</p>
        <Link to="/">
          <Button>Go Home</Button>
        </Link>
      </div>
    </div>
  );
}
