/**
 * Modèle PUR de la courbe de poids (chantier expérience élève, Lot C). Aucune
 * dépendance React/Supabase : calcule la géométrie (domaine vertical avec
 * marge, positions des points, graduations kg, chemins ligne/aire) à partir de
 * l'historique de pesées, pour un composant partagé admin/élève.
 *
 * Règles :
 * - le domaine vertical ne commence PAS forcément à 0 : on cadre autour du
 *   min/max avec une marge, pour que de petites variations restent visibles,
 *   sans jamais modifier les valeurs réelles ;
 * - les pesées à valeur non finie (NaN, absente) sont ignorées, jamais
 *   affichées ;
 * - 0 / 1 / 2 / n points, valeurs identiques et micro-variations sont gérés
 *   sans division par zéro ni point collé en bas.
 */

export interface WeightPointInput {
  /** Libellé de date affiché (ex. "17/07"). */
  month: string;
  kg: number;
}

export interface WeightChartPoint {
  index: number;
  kg: number;
  label: string;
  kgLabel: string;
  x: number;
  y: number;
}

export interface WeightYTick {
  value: number;
  label: string;
  y: number;
}

export interface WeightChartLayout {
  width: number;
  height: number;
  padTop: number;
  padRight: number;
  padBottom: number;
  padLeft: number;
}

export interface WeightChartModel {
  isEmpty: boolean;
  points: WeightChartPoint[];
  yTicks: WeightYTick[];
  linePath: string;
  areaPath: string;
  domain: { min: number; max: number };
  plot: { left: number; right: number; top: number; bottom: number };
  width: number;
  height: number;
}

export const DEFAULT_WEIGHT_LAYOUT: WeightChartLayout = {
  width: 640,
  height: 260,
  padTop: 34,
  padRight: 18,
  padBottom: 30,
  padLeft: 46,
};

/** Formate un poids en kg à la française, 1 décimale max, sans ".0" superflu (72 -> "72", 72.4 -> "72,4"). */
export function formatKg(value: number): string {
  if (!Number.isFinite(value)) return "—";
  return new Intl.NumberFormat("fr-FR", { maximumFractionDigits: 1 }).format(Math.round(value * 10) / 10);
}

function round1(v: number): number {
  return Math.round(v * 10) / 10;
}

/**
 * Construit le modèle géométrique de la courbe. `data` est pris dans l'ordre
 * fourni (le loader Supabase ordonne déjà chronologiquement) ; l'axe X est un
 * simple index régulier, robuste à toute donnée non triée (aucun plantage).
 */
export function buildWeightChartModel(
  data: readonly WeightPointInput[],
  layout: WeightChartLayout = DEFAULT_WEIGHT_LAYOUT,
): WeightChartModel {
  const { width, height, padTop, padRight, padBottom, padLeft } = layout;
  const plot = { left: padLeft, right: width - padRight, top: padTop, bottom: height - padBottom };
  const plotW = plot.right - plot.left;
  const plotH = plot.bottom - plot.top;

  const valid = data.filter((d) => Number.isFinite(d.kg));
  if (valid.length === 0) {
    return { isEmpty: true, points: [], yTicks: [], linePath: "", areaPath: "", domain: { min: 0, max: 0 }, plot, width, height };
  }

  const values = valid.map((d) => d.kg);
  const min = Math.min(...values);
  const max = Math.max(...values);
  const range = max - min;
  // Marge : ±1 kg si toutes les pesées sont identiques (courbe centrée, pas
  // collée), sinon 20 % de l'amplitude avec un plancher de 0,3 kg pour qu'une
  // micro-variation reste lisible.
  const pad = range === 0 ? 1 : Math.max(0.3, range * 0.2);
  const domainMin = min - pad;
  const domainMax = max + pad;
  const span = domainMax - domainMin;

  const yForKg = (kg: number) => plot.bottom - ((kg - domainMin) / span) * plotH;
  const xForIndex = (i: number) =>
    valid.length === 1 ? (plot.left + plot.right) / 2 : plot.left + (i / (valid.length - 1)) * plotW;

  const points: WeightChartPoint[] = valid.map((d, i) => ({
    index: i,
    kg: d.kg,
    label: d.month,
    kgLabel: formatKg(d.kg),
    x: xForIndex(i),
    y: yForKg(d.kg),
  }));

  const TICKS = 4;
  const yTicks: WeightYTick[] = Array.from({ length: TICKS }, (_, k) => {
    const value = domainMax - (span * k) / (TICKS - 1);
    return { value: round1(value), label: formatKg(value), y: yForKg(value) };
  });

  const linePath =
    points.length >= 2
      ? points.map((p, i) => `${i === 0 ? "M" : "L"}${p.x.toFixed(1)},${p.y.toFixed(1)}`).join(" ")
      : "";
  const areaPath =
    points.length >= 2
      ? `${linePath} L${points[points.length - 1].x.toFixed(1)},${plot.bottom} L${points[0].x.toFixed(1)},${plot.bottom} Z`
      : "";

  return { isEmpty: false, points, yTicks, linePath, areaPath, domain: { min: domainMin, max: domainMax }, plot, width, height };
}
