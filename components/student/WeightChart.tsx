import type { WeightEntry } from "@/types";

const WIDTH = 480;
const HEIGHT = 160;
const PADDING = 12;

export function WeightChart({ data }: { data: WeightEntry[] }) {
  const values = data.map((entry) => entry.kg);
  const min = Math.min(...values);
  const max = Math.max(...values);
  const range = max - min || 1;

  const points = data.map((entry, index) => {
    const x =
      PADDING + (index / (data.length - 1)) * (WIDTH - PADDING * 2);
    const y =
      HEIGHT - PADDING - ((entry.kg - min) / range) * (HEIGHT - PADDING * 2);
    return { x, y };
  });

  const linePath = points
    .map((point, index) => `${index === 0 ? "M" : "L"}${point.x},${point.y}`)
    .join(" ");
  const areaPath = `${linePath} L${points[points.length - 1].x},${HEIGHT} L${points[0].x},${HEIGHT} Z`;

  return (
    <div>
      <svg
        viewBox={`0 0 ${WIDTH} ${HEIGHT}`}
        className="w-full"
        preserveAspectRatio="none"
      >
        <defs>
          <linearGradient id="weightGradient" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor="#d62828" stopOpacity="0.35" />
            <stop offset="100%" stopColor="#d62828" stopOpacity="0" />
          </linearGradient>
        </defs>
        <path d={areaPath} fill="url(#weightGradient)" />
        <path d={linePath} fill="none" stroke="#d62828" strokeWidth={2} />
        {points.map((point) => (
          <circle key={point.x} cx={point.x} cy={point.y} r={3} fill="#d62828" />
        ))}
      </svg>
      <div className="mt-2 flex justify-between text-xs text-muted-foreground">
        {data.map((entry) => (
          <span key={entry.month}>{entry.month}</span>
        ))}
      </div>
    </div>
  );
}
