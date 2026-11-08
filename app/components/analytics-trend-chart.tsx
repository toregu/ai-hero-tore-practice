import { Bar, BarChart, CartesianGrid, XAxis, YAxis } from "recharts";
import { LineChart as LineChartIcon } from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "~/components/ui/card";
import {
  ChartContainer,
  ChartTooltip,
  ChartTooltipContent,
  type ChartConfig,
} from "~/components/ui/chart";
import type { TrendBucket, TrendGranularity } from "~/services/analyticsTrendService";

// ─── Analytics Trend Chart ───
// Revenue and enrollments per bucket, drawn as two small charts that share the
// same buckets. They have different units, so they get separate axes rather
// than one dual-axis chart.

const chartConfig = {
  revenue: { label: "Gross revenue", color: "var(--chart-1)" },
  enrollments: { label: "New enrollments", color: "var(--chart-2)" },
} satisfies ChartConfig;

// Bucket starts are UTC dates; format them in UTC with a fixed locale so the
// server and client render the same labels.
function formatBucket(start: string, granularity: TrendGranularity, long = false) {
  const date = new Date(`${start}T00:00:00.000Z`);
  if (granularity === "month") {
    return date.toLocaleDateString("en-US", {
      month: "short",
      year: long ? "numeric" : "2-digit",
      timeZone: "UTC",
    });
  }
  const day = date.toLocaleDateString("en-US", {
    month: "short",
    day: "numeric",
    timeZone: "UTC",
  });
  return granularity === "week" && long ? `Week of ${day}` : day;
}

function formatDollars(cents: number) {
  return `$${(cents / 100).toLocaleString("en-US", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  })}`;
}

function formatDollarsShort(cents: number) {
  return `$${(cents / 100).toLocaleString("en-US", {
    notation: "compact",
    maximumFractionDigits: 1,
  })}`;
}

function TrendPanel({
  title,
  dataKey,
  buckets,
  granularity,
  formatValue,
  formatTick,
}: {
  title: string;
  dataKey: keyof typeof chartConfig;
  buckets: TrendBucket[];
  granularity: TrendGranularity;
  formatValue: (value: number) => string;
  formatTick: (value: number) => string;
}) {
  return (
    <div className="min-w-0">
      <h3 className="mb-2 text-sm font-medium text-muted-foreground">{title}</h3>
      <ChartContainer config={chartConfig} className="aspect-auto h-56 w-full">
        <BarChart data={buckets} margin={{ left: 0, right: 8, top: 4 }}>
          <CartesianGrid vertical={false} />
          <XAxis
            dataKey="start"
            tickLine={false}
            axisLine={false}
            tickMargin={8}
            minTickGap={16}
            tickFormatter={(start: string) => formatBucket(start, granularity)}
          />
          <YAxis
            tickLine={false}
            axisLine={false}
            width={48}
            allowDecimals={false}
            tickFormatter={formatTick}
          />
          <ChartTooltip
            cursor={false}
            content={
              <ChartTooltipContent
                labelFormatter={(_, payload) => {
                  const start = payload?.[0]?.payload?.start;
                  return typeof start === "string"
                    ? formatBucket(start, granularity, true)
                    : null;
                }}
                formatter={(value) => (
                  <div className="flex w-full justify-between gap-4">
                    <span className="text-muted-foreground">
                      {chartConfig[dataKey].label}
                    </span>
                    <span className="font-mono font-medium tabular-nums">
                      {formatValue(Number(value))}
                    </span>
                  </div>
                )}
              />
            }
          />
          <Bar dataKey={dataKey} fill={`var(--color-${dataKey})`} radius={3} />
        </BarChart>
      </ChartContainer>
    </div>
  );
}

const GRANULARITY_LABELS: Record<TrendGranularity, string> = {
  day: "Per day",
  week: "Per week (Mon–Sun)",
  month: "Per month",
};

export function AnalyticsTrendChart({
  granularity,
  buckets,
  rangeLabel,
}: {
  granularity: TrendGranularity;
  buckets: TrendBucket[];
  rangeLabel: string;
}) {
  const hasActivity = buckets.some((b) => b.revenue > 0 || b.enrollments > 0);

  return (
    <Card>
      <CardHeader>
        <CardTitle>Revenue and enrollments</CardTitle>
        <p className="text-xs text-muted-foreground">
          {rangeLabel} · {GRANULARITY_LABELS[granularity]} · UTC
        </p>
      </CardHeader>
      <CardContent>
        {hasActivity ? (
          <div className="grid gap-8 lg:grid-cols-2">
            <TrendPanel
              title="Gross revenue"
              dataKey="revenue"
              buckets={buckets}
              granularity={granularity}
              formatValue={formatDollars}
              formatTick={formatDollarsShort}
            />
            <TrendPanel
              title="New enrollments"
              dataKey="enrollments"
              buckets={buckets}
              granularity={granularity}
              formatValue={(n) => n.toLocaleString("en-US")}
              formatTick={(n) => n.toLocaleString("en-US")}
            />
          </div>
        ) : (
          <div className="flex flex-col items-center py-12 text-center">
            <LineChartIcon className="mb-3 size-10 text-muted-foreground/50" />
            <p className="font-medium">No sales or enrollments in this period</p>
            <p className="mt-1 text-sm text-muted-foreground">
              Try a longer time range, or check back once students sign up.
            </p>
          </div>
        )}
      </CardContent>
    </Card>
  );
}
