import { Cell, Pie, PieChart, ResponsiveContainer } from "recharts";

export interface MacroDonutSlice {
  readonly name: string;
  readonly value: number;
  readonly fill: string;
}

/**
 * The recharts half of CalorieBreakdownRing, in its own module so recharts
 * (the ~411 kB / ~115 kB gzip `vendor-charts` chunk) loads with the first
 * opened Log Food dialog rather than with the Nutrition page.
 */
export default function MacroDonut({ data }: { readonly data: readonly MacroDonutSlice[] }) {
  return (
    <ResponsiveContainer width="100%" height="100%">
      <PieChart>
        <Pie
          data={[...data]}
          cx="50%"
          cy="50%"
          innerRadius={48}
          outerRadius={64}
          paddingAngle={data.length > 1 ? 2 : 0}
          dataKey="value"
          stroke="none"
          isAnimationActive={false}
        >
          {data.map((d) => (
            <Cell key={d.name} fill={d.fill} />
          ))}
        </Pie>
      </PieChart>
    </ResponsiveContainer>
  );
}
