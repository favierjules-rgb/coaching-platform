"use client";

import { useMemo } from "react";
import { Activity } from "lucide-react";

import { PremiumBodyMap } from "@/components/shared/PremiumBodyMap";
import {
  calculateMuscleHeatmap,
  MUSCLE_HEAT_FILL,
  MUSCLE_HEAT_THRESHOLDS,
} from "@/lib/muscle-heatmap";
import type { TrainingBlock } from "@/types";

/**
 * Analyse « intensité musculaire » côté élève : schéma du corps colorié +
 * légende + liste textuelle, à partir de la source canonique `blocks[]`
 * (jamais `session.exercises[]`). Réutilisable pour une séance (ses blocs) ou
 * une semaine/programme (blocs concaténés de toutes les séances).
 */
export function MuscleHeatmapSection({
  blocks,
  title = "Intensité musculaire",
}: {
  blocks: readonly TrainingBlock[];
  title?: string;
}) {
  const heatmap = useMemo(() => calculateMuscleHeatmap(blocks), [blocks]);
  const hasData = heatmap.totalSets > 0 || heatmap.otherSets > 0;

  return (
    <section className="rounded-card border border-border bg-card p-6 shadow-soft">
      <h2 className="mb-4 flex items-center gap-2 font-heading text-sm font-bold uppercase text-foreground">
        <Activity size={16} className="text-primary" />
        {title}
      </h2>

      {!hasData ? (
        <p className="text-sm text-muted-foreground">
          Aucun exercice de musculation à analyser pour le moment.
        </p>
      ) : (
        <div className="grid gap-6 md:grid-cols-[minmax(0,1fr)_minmax(0,1.1fr)] md:items-start">
          <PremiumBodyMap heatmap={heatmap} />

          <div className="flex flex-col gap-4">
            {/* Légende — l'intensité est aussi donnée par le texte, jamais que par la couleur. */}
            <div>
              <h3 className="mb-2 text-[10px] uppercase tracking-widest text-muted-foreground">Intensité</h3>
              <ul className="flex flex-wrap gap-x-4 gap-y-1.5">
                {MUSCLE_HEAT_THRESHOLDS.map((t) => (
                  <li key={t.level} className="flex items-center gap-1.5 text-xs text-muted-foreground">
                    <span
                      className="inline-block h-3 w-3 flex-shrink-0 rounded-[4px] border border-border"
                      style={{ background: MUSCLE_HEAT_FILL[t.level] }}
                      aria-hidden="true"
                    />
                    {t.label}
                  </li>
                ))}
              </ul>
            </div>

            {/* Liste textuelle des zones travaillées (accessible sans couleur). */}
            <div>
              <h3 className="mb-2 text-[10px] uppercase tracking-widest text-muted-foreground">
                Séries par groupe musculaire
              </h3>
              {heatmap.worked.length > 0 ? (
                <ul className="flex flex-col gap-1.5">
                  {heatmap.worked.map((zone) => (
                    <li key={zone.zone} className="flex items-center justify-between gap-3 text-sm">
                      <span className="flex items-center gap-2 text-foreground">
                        <span
                          className="inline-block h-2.5 w-2.5 flex-shrink-0 rounded-full"
                          style={{ background: MUSCLE_HEAT_FILL[zone.level] }}
                          aria-hidden="true"
                        />
                        {zone.label}
                      </span>
                      <span className="text-muted-foreground">
                        {zone.sets} série{zone.sets > 1 ? "s" : ""} · {Math.round(zone.share * 100)} %
                      </span>
                    </li>
                  ))}
                </ul>
              ) : (
                <p className="text-sm text-muted-foreground">Aucun groupe localisé sur le schéma.</p>
              )}
              {heatmap.otherSets > 0 && (
                <p className="mt-2 text-xs text-muted-foreground">
                  Autres / non localisés : {heatmap.otherSets} série{heatmap.otherSets > 1 ? "s" : ""}{" "}
                  (groupe non renseigné, full-body…).
                </p>
              )}
            </div>
          </div>
        </div>
      )}
    </section>
  );
}
