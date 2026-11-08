import { Link, isRouteErrorResponse } from "react-router";
import { AlertTriangle, Minus, TrendingDown, TrendingUp } from "lucide-react";
import {
  ANALYTICS_RANGES,
  type AnalyticsRange,
  type RangedMetric,
} from "~/services/analyticsService";
import { Button } from "~/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "~/components/ui/card";
import { cn, formatPrice } from "~/lib/utils";

// ─── Analytics building blocks ───
// Shared by the instructor analytics overview and the course analytics page.

export const RANGE_LABELS: Record<AnalyticsRange, string> = {
  "7d": "Last 7 days",
  "30d": "Last 30 days",
  "90d": "Last 90 days",
  all: "All time",
};

export function formatRevenue(cents: number) {
  // formatPrice renders 0 as "Free", which reads wrong for earnings.
  return cents === 0 ? "$0.00" : formatPrice(cents);
}

export function formatPercent(fraction: number | null) {
  return fraction === null ? "—" : `${Math.round(fraction * 100)}%`;
}

export function ChangeBadge({ metric }: { metric: RangedMetric }) {
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

export function Tile({
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

export function RatingValue({ rating }: { rating: number | null }) {
  if (rating === null) {
    return (
      <span className="text-base font-normal text-muted-foreground">
        No ratings yet
      </span>
    );
  }
  return <>{`${rating.toFixed(1)} / 5`}</>;
}

export function RangeSelector({ current }: { current: AnalyticsRange }) {
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

export function AnalyticsError({ error }: { error: unknown }) {
  let title = "Something went wrong";
  let message = "An unexpected error occurred while loading your analytics.";

  if (isRouteErrorResponse(error)) {
    if (error.status === 401) {
      title = "Sign in required";
    } else if (error.status === 403) {
      title = "Access denied";
    } else if (error.status === 404) {
      title = "Not found";
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
