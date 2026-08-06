"use client";

import { NotebookPen } from "lucide-react";

import { NBSP, formatIntegerFr } from "@/lib/nutrition/basis-points";
import { MEAL_SLOT_LABELS_FR } from "@/lib/nutrition/meal-distribution";
import {
  dailyTargetsForDay,
  orderedDays,
  type PlanV2Week,
} from "@/lib/nutrition/plan-v2-week";
import { WEEKDAY_LABELS_FR } from "@/lib/nutrition/weekdays";

/**
 * OUTIL 3 vu par l'élève — la semaine PRESCRITE par le coach, en LECTURE
 * SEULE.
 *
 * Aucun champ de saisie, aucun bouton d'écriture, aucun appel Supabase : ce
 * composant ne reçoit que des données et n'expose aucun callback de
 * modification. Ce qu'il affiche vient de `nutrition_days` et `meals`, que le
 * coach remplit depuis le constructeur.
 *
 * Il n'utilise PAS `solveRecipe` : une prescription manuelle est ce que le
 * coach a écrit, pas un calcul. Les deux outils cohabitent sans se mélanger.
 *
 * Mise en page : une carte par jour, empilées sur téléphone, deux colonnes à
 * partir de `lg` — le motif de l'espace élève, jamais un tableau.
 */
export function StudentPrescribedWeek({ week }: { week: PlanV2Week }) {
  const jours = orderedDays(week.days);

  if (jours.length === 0) {
    return (
      <p className="rounded-panel border border-dashed border-border px-4 py-6 text-center text-sm text-muted-foreground">
        Ton coach n&apos;a pas encore construit la semaine de ce plan.
      </p>
    );
  }

  return (
    <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
      {jours.map((jour) => {
        const cibles = dailyTargetsForDay(week, jour);
        return (
          <section
            key={jour.id}
            className="overflow-hidden rounded-panel border border-border bg-card shadow-soft"
          >
            <header className="border-b border-border bg-surface-soft px-4 py-3">
              <div className="flex flex-wrap items-baseline justify-between gap-2">
                <h3 className="text-xs font-bold uppercase tracking-widest text-foreground">
                  {WEEKDAY_LABELS_FR[jour.day]}
                </h3>
                {cibles && (
                  <span className="text-xs text-muted-foreground">
                    {formatIntegerFr(cibles.calories.totalCalories)}
                    {NBSP}kcal
                  </span>
                )}
              </div>
              {cibles && (
                <p className="mt-1 text-[11px] uppercase tracking-wide text-muted-foreground">
                  P{NBSP}
                  {formatIntegerFr(cibles.grams.proteinGrams)}
                  {NBSP}g · G{NBSP}
                  {formatIntegerFr(cibles.grams.carbGrams)}
                  {NBSP}g · L{NBSP}
                  {formatIntegerFr(cibles.grams.fatGrams)}
                  {NBSP}g
                </p>
              )}
            </header>

            <div className="flex flex-col gap-3 p-4">
              {jour.meals.length === 0 ? (
                <p className="text-sm text-muted-foreground">
                  Aucun repas prescrit ce jour-là.
                </p>
              ) : (
                jour.meals.map((repas) => (
                  <article
                    key={repas.id}
                    className="rounded-panel border border-border bg-surface-soft/40 p-4"
                  >
                    <div className="flex flex-wrap items-baseline justify-between gap-2">
                      <span className="text-xs uppercase tracking-wide text-muted-foreground">
                        {MEAL_SLOT_LABELS_FR[repas.slot]}
                      </span>
                      {/* Les kcal et les macros d'un repas ne sont plus saisies
                          par le coach : elles sont définies au niveau du JOUR.
                          On n'affiche donc ces valeurs que pour un repas
                          enregistré avant ce changement, qui les porte encore —
                          jamais une série de zéros. */}
                      {repas.calories > 0 && (
                        <span className="text-sm font-bold text-foreground">
                          {formatIntegerFr(repas.calories)}
                          {NBSP}kcal
                        </span>
                      )}
                    </div>

                    {repas.name && (
                      <h4 className="mt-1 text-sm font-bold text-foreground">{repas.name}</h4>
                    )}

                    {repas.items.length > 0 && (
                      <ul className="mt-2 flex flex-col gap-1 text-sm text-foreground">
                        {repas.items.map((aliment, index) => (
                          <li key={`${repas.id}-${index}`} className="flex flex-wrap gap-x-2">
                            <span>{aliment.name}</span>
                            {aliment.quantity && (
                              <span className="text-muted-foreground">{aliment.quantity}</span>
                            )}
                          </li>
                        ))}
                      </ul>
                    )}

                    {repas.protein + repas.carbs + repas.fat > 0 && (
                      <p className="mt-2 text-xs text-muted-foreground">
                        P{NBSP}
                        {formatIntegerFr(repas.protein)}
                        {NBSP}g · G{NBSP}
                        {formatIntegerFr(repas.carbs)}
                        {NBSP}g · L{NBSP}
                        {formatIntegerFr(repas.fat)}
                        {NBSP}g
                      </p>
                    )}

                    {repas.coachNotes && (
                      <p className="mt-3 flex items-start gap-2 rounded-control border border-border bg-card px-3 py-2 text-xs italic leading-relaxed text-muted-foreground">
                        <NotebookPen size={14} className="mt-0.5 flex-shrink-0" />
                        <span>{repas.coachNotes}</span>
                      </p>
                    )}
                  </article>
                ))
              )}
            </div>
          </section>
        );
      })}
    </div>
  );
}
