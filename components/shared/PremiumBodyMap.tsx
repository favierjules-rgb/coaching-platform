"use client";

import { useState } from "react";
import Image from "next/image";

import { MUSCLE_HEAT_FILL, type BodyZone, type MuscleHeatLevel, type MuscleHeatmap } from "@/lib/muscle-heatmap";
import {
  ANATOMY_ASSETS,
  ANATOMY_SIZES,
  BACK_ZONES,
  FRONT_ZONES,
  type ZonePaths,
} from "@/lib/muscle-overlays";

/**
 * Schéma anatomique PREMIUM : image musculaire réaliste (assets locaux
 * détourés + désaturés en CSS) surmontée d'un calque SVG transparent dont les
 * CONTOURS (paths dessinés par le coach) sont coloriés en rouge selon
 * l'intensité calculée par calculateMuscleHeatmap. Aucune 3D, aucune iframe,
 * aucune ressource distante. Deux calques SVG superposés : un calque VISUEL
 * flou (chaleur, non interactif) et un calque d'INTERACTION net
 * (survol/focus/tap + aria-label), pour un rendu doux sans perdre la précision
 * des cibles.
 */

/** Niveau 0 = aucune surcouche (le muscle garde sa teinte neutre) ; 1..4 = rouge croissant. */
function heatFill(level: MuscleHeatLevel): string {
  return level === 0 ? "transparent" : MUSCLE_HEAT_FILL[level];
}

interface FigureProps {
  view: "front" | "back";
  overlays: ZonePaths[];
  size: { width: number; height: number };
  src: string;
  alt: string;
  caption: string;
  heatmap: MuscleHeatmap;
  active: BodyZone | null;
  onActivate: (zone: BodyZone | null) => void;
}

function Figure({ view, overlays, size, src, alt, caption, heatmap, active, onActivate }: FigureProps) {
  const { width, height } = size;
  return (
    <figure className="flex flex-col items-center gap-2">
      <div
        className="relative w-full overflow-hidden rounded-card border border-border bg-[#f2f1ee] shadow-soft"
        style={{ aspectRatio: `${width} / ${height}` }}
      >
        <Image
          src={src}
          alt={alt}
          fill
          sizes="(max-width: 768px) 80vw, 300px"
          className="anatomy-desat select-none object-contain"
          draggable={false}
        />

        {/* Calque VISUEL : chaleur floutée, non interactif. */}
        <svg
          viewBox={`0 0 ${width} ${height}`}
          className="pointer-events-none absolute inset-0 h-full w-full"
          style={{ filter: "blur(4px)" }}
          aria-hidden="true"
        >
          {overlays.map((o) => {
            const fill = heatFill(heatmap.zones[o.zone].level);
            return (
              <g key={o.zone}>
                {o.paths.map((d, i) => (
                  <path key={i} d={d} fill={fill} className="muscle-zone" />
                ))}
              </g>
            );
          })}
        </svg>

        {/* Calque INTERACTION : cibles nettes, focusables, annoncées. */}
        <svg
          viewBox={`0 0 ${width} ${height}`}
          className="absolute inset-0 h-full w-full"
          role="group"
          aria-label={`Zones musculaires — vue ${view === "front" ? "de face" : "de dos"}`}
        >
          {overlays.map((o) => {
            const z = heatmap.zones[o.zone];
            const pct = Math.round(z.share * 100);
            const label = `${z.label} : ${z.sets} série${z.sets > 1 ? "s" : ""}${
              z.sets > 0 ? `, ${pct} % du volume` : ""
            }`;
            const isActive = active === o.zone;
            return (
              <g
                key={o.zone}
                tabIndex={0}
                role="button"
                aria-label={label}
                onMouseEnter={() => onActivate(o.zone)}
                onMouseLeave={() => onActivate(null)}
                onFocus={() => onActivate(o.zone)}
                onBlur={() => onActivate(null)}
                onClick={() => onActivate(isActive ? null : o.zone)}
                style={{ outline: "none", cursor: "pointer" }}
              >
                {o.paths.map((d, i) => (
                  <path
                    key={i}
                    d={d}
                    fill="rgb(255 255 255 / 0.001)"
                    stroke={isActive ? "var(--foreground)" : "transparent"}
                    strokeWidth={isActive ? 2 : 0}
                    className="muscle-zone"
                    style={{ pointerEvents: "all" }}
                  />
                ))}
              </g>
            );
          })}
        </svg>
      </div>
      <figcaption className="text-[10px] uppercase tracking-widest text-muted-foreground">{caption}</figcaption>
    </figure>
  );
}

export function PremiumBodyMap({ heatmap }: { heatmap: MuscleHeatmap }) {
  const [active, setActive] = useState<BodyZone | null>(null);
  const activeZone = active ? heatmap.zones[active] : null;

  return (
    <div className="flex flex-col items-center gap-3">
      <div className="grid w-full grid-cols-1 justify-items-center gap-3 sm:grid-cols-2">
        <div className="w-full max-w-[200px]">
          <Figure
            view="front"
            overlays={FRONT_ZONES}
            size={ANATOMY_SIZES.front}
            src={ANATOMY_ASSETS.front}
            alt="Anatomie musculaire du corps humain, vue de face"
            caption="Face"
            heatmap={heatmap}
            active={active}
            onActivate={setActive}
          />
        </div>
        <div className="w-full max-w-[200px]">
          <Figure
            view="back"
            overlays={BACK_ZONES}
            size={ANATOMY_SIZES.back}
            src={ANATOMY_ASSETS.back}
            alt="Anatomie musculaire du corps humain, vue de dos"
            caption="Dos"
            heatmap={heatmap}
            active={active}
            onActivate={setActive}
          />
        </div>
      </div>

      <p aria-live="polite" className="min-h-[1.25rem] text-center text-xs text-muted-foreground">
        {activeZone ? (
          <span className="text-foreground">
            {activeZone.label} · {activeZone.sets} série{activeZone.sets > 1 ? "s" : ""}
            {activeZone.sets > 0 ? ` · ${Math.round(activeZone.share * 100)} % du volume` : ""}
          </span>
        ) : (
          "Survole, tabule ou touche une zone pour le détail."
        )}
      </p>
    </div>
  );
}
