import {
  Bar,
  BarChart,
  CartesianGrid,
  Cell,
  LabelList,
  XAxis,
  YAxis,
} from "recharts";
import { TrendingDown } from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "~/components/ui/card";
import {
  ChartContainer,
  ChartTooltip,
  ChartTooltipContent,
  type ChartConfig,
} from "~/components/ui/chart";
import type { LessonFunnelStep } from "~/services/lessonFunnelService";

// ─── Lesson Funnel Chart ───
// One horizontal bar per lesson, in course order, with a header row per module.
// The three biggest drops are drawn in the alert colour and also carry an icon
// and a text label, so they don't rely on colour alone.

const chartConfig = {
  completedPercent: { label: "Completed", color: "var(--chart-2)" },
  topDrop: { label: "Biggest drop", color: "var(--destructive)" },
} satisfies ChartConfig;

const ROW_HEIGHT = 32;

type ChartRow = { key: string; label: string; dropLabel: string } & (
  | { kind: "module"; completedPercent: null }
  | ({ kind: "lesson" } & LessonFunnelStep)
);

function toChartRows(steps: LessonFunnelStep[]): ChartRow[] {
  const rows: ChartRow[] = [];
  let currentModule: number | null = null;
  for (const step of steps) {
    if (step.moduleId !== currentModule) {
      currentModule = step.moduleId;
      rows.push({
        kind: "module",
        key: `module-${step.moduleId}`,
        label: step.moduleTitle,
        dropLabel: "",
        completedPercent: null,
      });
    }
    rows.push({
      kind: "lesson",
      key: `lesson-${step.lessonId}`,
      label: step.lessonTitle,
      // Direct label on the flagged bars only.
      dropLabel:
        step.isTopDrop && step.drop !== null
          ? `▼ ${formatPoints(step.drop)}`
          : "",
      ...step,
    });
  }
  return rows;
}

function truncate(text: string, max = 28) {
  return text.length > max ? `${text.slice(0, max - 1)}…` : text;
}

function formatPoints(points: number) {
  return `${Math.round(points)} pts`;
}

export function LessonFunnelChart({ steps }: { steps: LessonFunnelStep[] }) {
  const rows = toChartRows(steps);
  const topDrops = steps.filter((s) => s.isTopDrop);

  return (
    <Card>
      <CardHeader>
        <CardTitle>Lesson funnel</CardTitle>
        <p className="text-xs text-muted-foreground">
          All-time · Share of enrolled students who completed each lesson
        </p>
      </CardHeader>
      <CardContent className="space-y-4">
        {steps.length === 0 ? (
          <p className="py-8 text-center text-sm text-muted-foreground">
            This course has no lessons yet.
          </p>
        ) : (
          <>
            <ChartContainer
              config={chartConfig}
              className="aspect-auto w-full"
              style={{ height: rows.length * ROW_HEIGHT + 32 }}
            >
              <BarChart
                data={rows}
                layout="vertical"
                margin={{ left: 0, right: 72, top: 4, bottom: 4 }}
                barCategoryGap={6}
              >
                <CartesianGrid horizontal={false} />
                <XAxis
                  type="number"
                  domain={[0, 100]}
                  ticks={[0, 25, 50, 75, 100]}
                  tickFormatter={(v: number) => `${v}%`}
                  tickLine={false}
                  axisLine={false}
                />
                <YAxis
                  type="category"
                  dataKey="key"
                  width={200}
                  tickLine={false}
                  axisLine={false}
                  interval={0}
                  tick={({ x, y, payload, index }) => {
                    const row =
                      rows[index ?? 0] ??
                      rows.find((r) => r.key === payload.value);
                    const isModule = row?.kind === "module";
                    return (
                      <text
                        x={isModule ? 4 : Number(x) - 4}
                        y={y}
                        dy={4}
                        textAnchor={isModule ? "start" : "end"}
                        className={
                          isModule
                            ? "fill-foreground text-xs font-semibold"
                            : "fill-muted-foreground text-xs"
                        }
                      >
                        {truncate(row?.label ?? "")}
                      </text>
                    );
                  }}
                />
                <ChartTooltip
                  cursor={false}
                  content={
                    <ChartTooltipContent
                      hideIndicator
                      labelFormatter={(_, payload) => {
                        const row = payload?.[0]?.payload as
                          ChartRow | undefined;
                        return row?.kind === "lesson"
                          ? `${row.moduleTitle} · ${row.lessonTitle}`
                          : null;
                      }}
                      formatter={(_, __, item) => {
                        const row = item.payload as ChartRow;
                        if (row.kind !== "lesson") return null;
                        return (
                          <div className="grid w-full gap-1">
                            <div className="flex justify-between gap-4">
                              <span className="text-muted-foreground">
                                Completed
                              </span>
                              <span className="font-mono font-medium tabular-nums">
                                {Math.round(row.completedPercent ?? 0)}% (
                                {row.completed})
                              </span>
                            </div>
                            {row.drop !== null && (
                              <div className="flex justify-between gap-4">
                                <span className="text-muted-foreground">
                                  vs previous lesson
                                </span>
                                <span className="font-mono font-medium tabular-nums">
                                  {row.drop > 0 ? "−" : "+"}
                                  {formatPoints(Math.abs(row.drop))}
                                </span>
                              </div>
                            )}
                          </div>
                        );
                      }}
                    />
                  }
                />
                <Bar
                  dataKey="completedPercent"
                  radius={4}
                  maxBarSize={18}
                  isAnimationActive={false}
                >
                  {rows.map((row) => (
                    <Cell
                      key={row.key}
                      fill={
                        row.kind === "lesson" && row.isTopDrop
                          ? "var(--color-topDrop)"
                          : "var(--color-completedPercent)"
                      }
                    />
                  ))}
                  <LabelList
                    dataKey="dropLabel"
                    position="right"
                    className="fill-foreground text-xs"
                  />
                </Bar>
              </BarChart>
            </ChartContainer>

            {topDrops.length > 0 && (
              <div className="rounded-lg border p-3">
                <h3 className="mb-2 flex items-center gap-2 text-sm font-medium">
                  <TrendingDown className="size-4 text-destructive" />
                  Biggest drops — look at these lessons first
                </h3>
                <ol className="space-y-1 text-sm">
                  {[...topDrops]
                    .sort((a, b) => (b.drop ?? 0) - (a.drop ?? 0))
                    .map((step) => (
                      <li
                        key={step.lessonId}
                        className="flex justify-between gap-4"
                      >
                        <span>
                          <span className="text-muted-foreground">
                            {step.moduleTitle} ·{" "}
                          </span>
                          {step.lessonTitle}
                        </span>
                        <span className="tabular-nums text-muted-foreground">
                          −{formatPoints(step.drop ?? 0)}
                        </span>
                      </li>
                    ))}
                </ol>
              </div>
            )}
          </>
        )}
      </CardContent>
    </Card>
  );
}
