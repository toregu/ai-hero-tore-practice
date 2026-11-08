import { AlertTriangle } from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "~/components/ui/card";
import { formatPercent } from "~/components/analytics";
import { LOW_PASS_RATE } from "~/lib/analytics";
import type { QuizStatsRow } from "~/services/quizStatsService";

// ─── Quiz stats table ───
// One row per quiz in the course. Pass rate counts students who eventually
// passed; quizzes below the threshold are flagged with an icon and label.

export function QuizStatsTable({ rows }: { rows: QuizStatsRow[] }) {
  return (
    <Card>
      <CardHeader>
        <CardTitle>Quizzes</CardTitle>
        <p className="text-xs text-muted-foreground">
          All-time · Pass rate = students who passed at least once ÷ students
          who attempted
        </p>
      </CardHeader>
      <CardContent className="overflow-x-auto">
        {rows.length === 0 ? (
          <p className="py-8 text-center text-sm text-muted-foreground">
            This course has no quizzes.
          </p>
        ) : (
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b text-left text-muted-foreground">
                <th className="py-2 pr-4 font-medium">Quiz</th>
                <th className="px-4 py-2 text-right font-medium">Students</th>
                <th className="px-4 py-2 text-right font-medium">Pass rate</th>
                <th className="py-2 pl-4 text-right font-medium">
                  Avg. attempts
                </th>
              </tr>
            </thead>
            <tbody>
              {rows.map((row) => (
                <tr key={row.quizId} className="border-b last:border-0">
                  <td className="py-3 pr-4">
                    <div className="font-medium">{row.quizTitle}</div>
                    <div className="text-xs text-muted-foreground">
                      {row.lessonTitle}
                    </div>
                  </td>
                  {row.attemptingStudents === 0 ? (
                    <td
                      colSpan={3}
                      className="py-3 pl-4 text-right text-muted-foreground"
                    >
                      No attempts yet
                    </td>
                  ) : (
                    <>
                      <td className="px-4 py-3 text-right tabular-nums">
                        {row.attemptingStudents}
                      </td>
                      <td className="px-4 py-3 text-right tabular-nums">
                        {row.isLowPassRate ? (
                          <span className="inline-flex items-center gap-1 font-medium text-destructive">
                            <AlertTriangle className="size-3.5" />
                            {formatPercent(row.passRate)}
                            <span className="sr-only">
                              (below {formatPercent(LOW_PASS_RATE)})
                            </span>
                          </span>
                        ) : (
                          formatPercent(row.passRate)
                        )}
                      </td>
                      <td className="py-3 pl-4 text-right tabular-nums">
                        {row.averageAttempts?.toFixed(1)}
                      </td>
                    </>
                  )}
                </tr>
              ))}
            </tbody>
          </table>
        )}
        {rows.some((r) => r.isLowPassRate) && (
          <p className="mt-3 flex items-center gap-1 text-xs text-muted-foreground">
            <AlertTriangle className="size-3.5 text-destructive" />
            Pass rate below {formatPercent(LOW_PASS_RATE)} — students are
            struggling with this quiz.
          </p>
        )}
      </CardContent>
    </Card>
  );
}
