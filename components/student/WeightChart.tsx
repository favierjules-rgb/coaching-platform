import type { WeightEntry } from "@/types";

const WIDTH = 480;
const HEIGHT = 160;
const PADDING = 12;

export function WeightChart({ data }: { data: WeightEntry[] }) {
  if (data.length === 0) {
    return <p className="text-sm text-muted-foreground">Aucune donnée de poids pour le moment.</p>;
  }

  const values = data.map((entry) => entry.kg);
  const min = Math.min(...values);
  const max = Math.max(...values);
  const range = max - min || 1;

  const points = data.map((entry, index) => {
    const x =
      data.length > 1
        ? PADDING + (index / (data.length - 1)) * (WIDTH - PADDING * 2)
        : WIDTH / 2;
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
            <stop offset="0%" stopColor="var(--primary)" stopOpacity="0.35" />
            <stop offset="100%" stopColor="var(--primary)" stopOpacity="0" />
          </linearGradient>
        </defs>
        <path d={areaPath} fill="url(#weightGradient)" />
        <path d={linePath} fill="none" stroke="var(--primary)" strokeWidth={2} />
        {points.map((point, index) => (
          <circle key={`${point.x}-${index}`} cx={point.x} cy={point.y} r={3} fill="var(--primary)" />
        ))}
      </svg>
      <div className="mt-2 flex justify-between text-xs text-muted-foreground">
        {data.map((entry, index) => (
          // `entry.month` (ex. "06/07") n'est qu'un libellé d'affichage : deux
          // relevés du même jour (ex. migration initiale + mise à jour coach
          // le jour même) partagent le même libellé, donc l'index est
          // nécessaire pour garantir une clé unique.
          <span key={`${entry.month}-${index}`}>{entry.month}</span>
        ))}
      </div>
    </div>
  );
}
