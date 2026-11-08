import { Link } from "react-router";
import type { AnalyticsRange } from "~/services/analyticsService";
import type { CourseComparisonRow } from "~/services/courseAnalyticsService";
import { CourseStatus } from "~/db/schema";
import { Card, CardContent, CardHeader, CardTitle } from "~/components/ui/card";
import { RANGE_LABELS, formatPercent, formatRevenue } from "~/components/analytics";

// ─── Course comparison table ───
// One row per published or archived course, each linking to its analytics page.
// Column headers say which figures follow the range and which are all-time.

export function CourseComparisonTable({
  rows,
  range,
}: {
  rows: CourseComparisonRow[];
  range: AnalyticsRange;
}) {
  const rangeLabel = RANGE_LABELS[range];

  return (
    <Card>
      <CardHeader>
        <CardTitle>Your courses</CardTitle>
      </CardHeader>
      <CardContent className="overflow-x-auto">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b text-left text-muted-foreground">
              <th className="py-2 pr-4 font-medium">Course</th>
              <th className="px-4 py-2 text-right font-medium">
                Revenue
                <span className="block text-xs font-normal">{rangeLabel}</span>
              </th>
              <th className="px-4 py-2 text-right font-medium">
                Enrollments
                <span className="block text-xs font-normal">{rangeLabel}</span>
              </th>
              <th className="px-4 py-2 text-right font-medium">
                Completion
                <span className="block text-xs font-normal">All-time</span>
              </th>
              <th className="py-2 pl-4 text-right font-medium">
                Avg. rating
                <span className="block text-xs font-normal">All-time</span>
              </th>
            </tr>
          </thead>
          <tbody>
            {rows.map((row) => (
              <tr key={row.courseId} className="border-b last:border-0">
                <td className="py-3 pr-4">
                  <Link
                    to={`/instructor/${row.courseId}/analytics?range=${range}`}
                    className="font-medium hover:text-primary hover:underline"
                  >
                    {row.title}
                  </Link>
                  {row.status === CourseStatus.Archived && (
                    <span className="ml-2 text-xs text-muted-foreground">Archived</span>
                  )}
                </td>
                <td className="px-4 py-3 text-right tabular-nums">
                  {formatRevenue(row.revenue)}
                </td>
                <td className="px-4 py-3 text-right tabular-nums">{row.enrollments}</td>
                <td className="px-4 py-3 text-right tabular-nums">
                  {formatPercent(row.completionRate)}
                </td>
                <td className="py-3 pl-4 text-right tabular-nums">
                  {row.averageRating === null ? (
                    <span className="text-muted-foreground">No ratings</span>
                  ) : (
                    `${row.averageRating.toFixed(1)} / 5`
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </CardContent>
    </Card>
  );
}
