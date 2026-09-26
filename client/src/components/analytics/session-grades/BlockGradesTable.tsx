import type { SessionGradeBlock } from "@shared/schema";

import { CHART_CARD_CLASS } from "../chartConstants";
import { formatShare, intentOnTarget, phaseLabel } from "./gradeChartData";

function weeksLabel(block: SessionGradeBlock): string {
  return block.firstWeek === block.lastWeek ? `Week ${block.firstWeek}` : `Weeks ${block.firstWeek}–${block.lastWeek}`;
}

function shareCell(part: number, whole: number): string {
  return whole > 0 ? `${part} of ${whole} (${formatShare(part, whole)})` : "—";
}

/**
 * The plan's training blocks side by side: did easy runs stay easy and
 * threshold runs hold, block by block. Doubles as the text view of the chart.
 */
export function BlockGradesTable({ blocks }: Readonly<{ blocks: SessionGradeBlock[] }>) {
  return (
    <div className={CHART_CARD_CLASS}>
      <p className="text-sm font-semibold">By training block</p>
      <div className="overflow-x-auto">
        <table className="w-full text-sm" data-testid="table-session-grades-blocks">
          <caption className="sr-only">Session grades by training block</caption>
          <thead>
            <tr className="border-b text-left text-xs text-muted-foreground">
              <th scope="col" className="py-2 pr-3 font-medium">Block</th>
              <th scope="col" className="py-2 pr-3 font-medium">Phase</th>
              <th scope="col" className="py-2 pr-3 font-medium">Easy stayed easy</th>
              <th scope="col" className="py-2 pr-3 font-medium">Threshold held</th>
              <th scope="col" className="py-2 pr-3 font-medium">Drifted harder</th>
              <th scope="col" className="py-2 font-medium">Easy too hard</th>
            </tr>
          </thead>
          <tbody>
            {blocks.map((block) => {
              const easy = intentOnTarget(block.counts, "easy");
              const threshold = intentOnTarget(block.counts, "threshold");
              const phases = block.phases.map(phaseLabel).filter(Boolean).join(", ");
              return (
                <tr key={block.block} className="border-b last:border-b-0" data-testid={`row-session-grades-block-${block.block}`}>
                  <th scope="row" className="py-2 pr-3 text-left font-medium">
                    {`Block ${block.block}`}
                    <span className="block text-xs font-normal text-muted-foreground">
                      {weeksLabel(block)}
                      {block.includesDeload ? " · deload" : ""}
                    </span>
                  </th>
                  <td className="py-2 pr-3 text-muted-foreground">{phases || "—"}</td>
                  <td className="py-2 pr-3 tabular-nums">{shareCell(easy.onTarget, easy.graded)}</td>
                  <td className="py-2 pr-3 tabular-nums">{shareCell(threshold.onTarget, threshold.graded)}</td>
                  <td className="py-2 pr-3 tabular-nums">{block.counts.driftedHarder}</td>
                  <td className="py-2 tabular-nums">{block.counts.easyTooHard}</td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </div>
  );
}
