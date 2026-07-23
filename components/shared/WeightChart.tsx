"use client";

import { useId, useState } from "react";

import { buildWeightChartModel } from "@/lib/weight-chart";
import type { WeightEntry } from "@/types";

/**
 * Courbe d'évolution du poids — composant UNIQUE partagé (dashboard élève,
 * progression élève, détail admin). Affiche un axe vertical gradué en kg, la
 * VALEUR de chaque point directement sur le graphe, et un tooltip date + poids
 * au survol/focus. Géométrie calculée par lib/weight-chart.ts (domaine avec
 * marge, jamais forcé à zéro ; cas limites gérés). Aucune animation de tracé
 * (donnée qu'on lit) ; le tooltip est un simple fondu, coupé sous
 * prefers-reduced-motion.
 */
export function WeightChart({ data }: { data: WeightEntry[] }) {
  const uid = useId().replace(/[:]/g, "");
  const [active, setActive] = useState<number | null>(null);
  const model = buildWeightChartModel(data ?? []);

  if (model.isEmpty) {
    return <p className="text-sm text-muted-foreground">Aucune donnée de poids pour le moment.</p>;
  }

  const { width, height, plot, points, yTicks, linePath, areaPath } = model;
  const activePoint = active !== null ? points[active] : null;

  return (
    <div className="relative w-full">
      <svg
        viewBox={`0 0 ${width} ${height}`}
        className="w-full"
        style={{ height: "auto" }}
        role="group"
        aria-label="Courbe d'évolution du poids"
      >
        <defs>
          <linearGradient id={`weight-grad-${uid}`} x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor="var(--primary)" stopOpacity="0.18" />
            <stop offset="100%" stopColor="var(--primary)" stopOpacity="0" />
          </linearGradient>
        </defs>

        {/* Graduations horizontales + étiquettes kg */}
        {yTicks.map((t, i) => (
          <g key={i}>
            <line
              x1={plot.left}
              y1={t.y}
              x2={plot.right}
              y2={t.y}
              stroke="var(--border)"
              strokeWidth={1}
              strokeDasharray={i === yTicks.length - 1 ? undefined : "3 4"}
            />
            <text
              x={plot.left - 8}
              y={t.y}
              textAnchor="end"
              dominantBaseline="middle"
              className="fill-muted-foreground"
              style={{ fontSize: 11, fontVariantNumeric: "tabular-nums" }}
            >
              {t.label}
            </text>
          </g>
        ))}

        {/* Aire + ligne */}
        {areaPath && <path d={areaPath} fill={`url(#weight-grad-${uid})`} />}
        {linePath && <path d={linePath} fill="none" stroke="var(--primary)" strokeWidth={2} strokeLinejoin="round" />}

        {/* Étiquettes de date (axe X) + valeur kg sur chaque point */}
        {points.map((p) => (
          <g key={`lbl-${p.index}`} aria-hidden="true">
            <text
              x={p.x}
              y={p.y - 11}
              textAnchor="middle"
              className="fill-foreground"
              style={{ fontSize: 11, fontWeight: 600, fontVariantNumeric: "tabular-nums" }}
            >
              {p.kgLabel}
            </text>
            <text
              x={p.x}
              y={plot.bottom + 16}
              textAnchor="middle"
              className="fill-muted-foreground"
              style={{ fontSize: 10 }}
            >
              {p.label}
            </text>
          </g>
        ))}

        {/* Points + cibles interactives (survol / focus clavier / tap) */}
        {points.map((p) => {
          const isActive = active === p.index;
          return (
            <g
              key={`pt-${p.index}`}
              tabIndex={0}
              role="button"
              aria-label={`${p.label} : ${p.kgLabel} kg`}
              onMouseEnter={() => setActive(p.index)}
              onMouseLeave={() => setActive((c) => (c === p.index ? null : c))}
              onFocus={() => setActive(p.index)}
              onBlur={() => setActive((c) => (c === p.index ? null : c))}
              style={{ outline: "none", cursor: "pointer" }}
            >
              {isActive && <circle cx={p.x} cy={p.y} r={7} fill="var(--primary)" fillOpacity={0.18} />}
              <circle cx={p.x} cy={p.y} r={isActive ? 4.5 : 3.5} fill="var(--primary)" className="weight-point" />
              <circle cx={p.x} cy={p.y} r={14} fill="transparent" style={{ pointerEvents: "all" }} />
            </g>
          );
        })}
      </svg>

      {/* Tooltip HTML positionné sur le point actif (date + poids). */}
      {activePoint && (
        <div
          className="weight-tooltip pointer-events-none absolute z-10 whitespace-nowrap rounded-control border border-border bg-surface-elevated px-2.5 py-1.5 text-xs shadow-soft"
          style={{ left: `${(activePoint.x / width) * 100}%`, top: `${(activePoint.y / height) * 100}%` }}
        >
          <span className="font-semibold text-foreground" style={{ fontVariantNumeric: "tabular-nums" }}>
            {activePoint.kgLabel} kg
          </span>
          <span className="ml-1.5 text-muted-foreground">{activePoint.label}</span>
        </div>
      )}

      {/* Représentation textuelle accessible (donnée lisible sans survol). */}
      <ul className="sr-only">
        {points.map((p) => (
          <li key={`sr-${p.index}`}>
            {p.label} : {p.kgLabel} kg
          </li>
        ))}
      </ul>
    </div>
  );
}
