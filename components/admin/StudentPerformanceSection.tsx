"use client";

import { useMemo, useState } from "react";

import { formaterChargeUtilisateur } from "@/lib/indicateurs-progression";
import {
  exercicesDeLHistorique,
  messageDeStagnation,
  performanceFigee,
  serieDeLExercice,
  stagnationEnCours,
  type PointPerformance,
} from "@/lib/performance-exercice";
import { buildWeightChartModel, DEFAULT_WEIGHT_LAYOUT } from "@/lib/weight-chart";
import type { AdminStudentFeedback } from "@/types";

/**
 * PROFIL ÉLÈVE — SECTION « PERFORMANCES ».
 *
 * ════════════════════════════════════════════════════════════════════════
 * CE QUI EST RÉUTILISÉ, ET CE QUI NE L'EST PAS
 * ════════════════════════════════════════════════════════════════════════
 * La GÉOMÉTRIE du graphique vient de `buildWeightChartModel`
 * (lib/weight-chart.ts) : domaine vertical qui ne part pas de zéro, marge
 * quand toutes les valeurs sont égales, quatre graduations, chemins SVG. Ce
 * module est pur et déjà testé — le réécrire aurait produit une seconde
 * géométrie à maintenir. Son vocabulaire dit « kg », ce qui tombe juste ici :
 * l'axe vertical EST une charge en kilogrammes.
 *
 * Le RENDU, en revanche, est propre à cette section : `WeightChart` porte des
 * libellés de poids corporel en dur (« Courbe d'évolution du poids »), et le
 * paramétrer aurait touché un composant monté sur trois écrans élèves pour un
 * besoin qui n'est pas le leur.
 *
 * Les DONNÉES ne coûtent aucune requête : `useSupabaseStudentDetail` charge
 * déjà tout l'historique d'entraînement de l'élève (`supabaseDetail.feedback`).
 *
 * ⚠️ AUCUNE AUTRE PARTIE DU PROFIL N'EST TOUCHÉE. Cette section s'ajoute à la
 * pile existante ; elle ne réorganise rien.
 *
 * ────────────────────────────────────────────────────────────────────────
 * ACCESSIBILITÉ — JAMAIS UNIQUEMENT LE GRAPHIQUE
 * ────────────────────────────────────────────────────────────────────────
 * Convention du dépôt (voir ProgressWeightSection, CaloriesWeekChart,
 * WeightChart) : la courbe est doublée d'un résumé textuel lisible par un
 * lecteur d'écran. Ici, une liste `sr-only` reprend chaque point.
 */
export function StudentPerformanceSection({
  feedback,
  studentId,
}: {
  feedback: AdminStudentFeedback[];
  studentId: string;
}) {
  const exercices = useMemo(() => exercicesDeLHistorique(feedback, studentId), [feedback, studentId]);
  const [cleChoisie, setCleChoisie] = useState<string | null>(null);
  const cle = cleChoisie ?? exercices[0]?.cle ?? null;
  const exercice = exercices.find((e) => e.cle === cle) ?? null;

  const points = useMemo(
    () => (cle ? serieDeLExercice(feedback, studentId, cle) : []),
    [feedback, studentId, cle],
  );
  const stagnation = useMemo(() => stagnationEnCours(points), [points]);

  if (exercices.length === 0) {
    return (
      <p className="text-sm text-muted-foreground">
        Aucune performance chiffrable enregistrée pour le moment. Une courbe apparaîtra dès qu&apos;une séance de
        musculation aura été validée avec des charges et des répétitions.
      </p>
    );
  }

  return (
    <div className="flex flex-col gap-4">
      <label className="flex flex-col gap-1.5 text-xs uppercase tracking-widest text-muted-foreground sm:max-w-md">
        Exercice
        <select
          value={cle ?? ""}
          onChange={(event) => setCleChoisie(event.target.value)}
          aria-label="Exercice dont afficher la progression"
          className="rounded-control border border-border bg-background px-3 py-2.5 text-sm normal-case tracking-normal text-foreground focus:border-primary focus:outline-none focus-visible:ring-2 focus-visible:ring-primary/30"
        >
          {exercices.map((option) => (
            <option key={option.cle} value={option.cle}>
              {option.nom} ({option.occurrences} séance{option.occurrences > 1 ? "s" : ""})
            </option>
          ))}
        </select>
      </label>

      {points.length === 0 ? (
        <p className="text-sm text-muted-foreground">
          Aucune performance chiffrable pour cet exercice : les charges doivent être constantes sur les séries d&apos;une
          même séance pour qu&apos;un point soit tracé.
        </p>
      ) : (
        <CourbeDePerformance nom={exercice?.nom ?? "Exercice"} points={points} />
      )}

      {/* ZONE D'INFORMATION DE STAGNATION — sous le graphique, jamais dedans. */}
      {stagnation && (
        <p
          role="status"
          className="rounded-card border border-amber-500/40 bg-amber-500/5 px-4 py-3 text-sm text-amber-700 dark:text-amber-400"
        >
          {messageDeStagnation(exercice?.nom ?? "Cet exercice", stagnation)} — {performanceFigee(stagnation)} à chaque
          fois.
        </p>
      )}
    </div>
  );
}

/** Le tracé — géométrie empruntée à `buildWeightChartModel`. */
function CourbeDePerformance({ nom, points }: { nom: string; points: PointPerformance[] }) {
  const modele = useMemo(
    () =>
      buildWeightChartModel(
        points.map((point) => ({
          month: `S${point.occurrence.weekNumber} ${point.occurrence.day.slice(0, 3).toLowerCase()}`,
          kg: point.chargeKg,
        })),
      ),
    [points],
  );

  if (modele.isEmpty) return null;
  const { padLeft, padBottom } = DEFAULT_WEIGHT_LAYOUT;

  return (
    <div className="flex flex-col gap-2">
      <svg
        viewBox={`0 0 ${modele.width} ${modele.height}`}
        className="w-full"
        role="group"
        aria-label={`Courbe de charge de ${nom}, par semaine et par jour programmé`}
      >
        {modele.yTicks.map((tick) => (
          <g key={tick.value}>
            <line
              x1={modele.plot.left}
              x2={modele.plot.right}
              y1={tick.y}
              y2={tick.y}
              stroke="currentColor"
              strokeDasharray="3 4"
              className="text-border"
            />
            <text x={padLeft - 8} y={tick.y + 4} textAnchor="end" className="fill-muted-foreground text-[10px]">
              {tick.label}
            </text>
          </g>
        ))}
        {modele.linePath && (
          <path d={modele.linePath} fill="none" stroke="currentColor" strokeWidth={2} className="text-primary" />
        )}
        {modele.points.map((point, index) => (
          <g key={point.index}>
            <circle cx={point.x} cy={point.y} r={4} className="fill-primary" />
            {/* ⚠️ `point.kgLabel` VIENT DU MODÈLE DE COURBE, DONC DE LA CHARGE
                EFFECTIVE. On ne l'affiche pas : on réécrit la valeur dans
                l'unité de saisie, sinon « 24 kg / haltère » se lirait
                « 48,0 kg » sur le graphique. */}
            <text x={point.x} y={point.y - 10} textAnchor="middle" className="fill-foreground text-[10px]">
              {points[index]
                ? `${formaterChargeUtilisateur(points[index].chargeKg, points[index].unite)} × ${points[index].reps}`
                : point.kgLabel}
            </text>
            <text
              x={point.x}
              y={modele.height - padBottom + 14}
              textAnchor="middle"
              className="fill-muted-foreground text-[10px]"
            >
              {point.label}
            </text>
          </g>
        ))}
      </svg>
      {/* Jamais uniquement le graphique : le même contenu en texte. */}
      <ul className="sr-only">
        {points.map((point, index) => (
          <li key={`${point.occurrence.weekNumber}-${point.occurrence.day}-${index}`}>
            Semaine {point.occurrence.weekNumber}, {point.occurrence.day} :{" "}
            {formaterChargeUtilisateur(point.chargeKg, point.unite)} × {point.reps} répétitions
          </li>
        ))}
      </ul>
    </div>
  );
}
