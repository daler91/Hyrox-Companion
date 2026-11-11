import { Cell, Pie, PieChart, ResponsiveContainer } from "recharts";

export interface MacroDonutSlice {
  readonly name: string;
  readonly value: number;
  readonly fill: string;
}

/**
 * The recharts-drawn ring inside CalorieBreakdownRing. Kept in its own module
 * so CalorieBreakdownRing can load it lazily: it is the only recharts import
 * reachable from the Nutrition route, so as a static import it made the
 * Nutrition chunk depend on the whole `vendor-charts` chunk.
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
