"use client";

import { useMemo, useState } from "react";
import { ArrowLeft, ChefHat } from "lucide-react";

import { NBSP, formatIntegerFr } from "@/lib/nutrition/basis-points";
import { MEAL_SLOT_LABELS_FR, type MealSlotKey } from "@/lib/nutrition/meal-distribution";
import {
  enabledSlotsForDay,
  orderedDays,
  recipesForSlot,
  slotTargetForDay,
  type PlanV2Week,
} from "@/lib/nutrition/plan-v2-week";
import { describeRecipeFit } from "@/lib/nutrition/recipe-matching";
import { formatSolvedIngredientQuantity } from "@/lib/nutrition/recipe-quantity";
import { describeTag } from "@/lib/nutrition/recipe-labels";
import type { RecipeWithTags } from "@/lib/nutrition/recipe-rows";
import { solveRecipe } from "@/lib/nutrition/recipe-solver";
import { WEEKDAY_LABELS_FR, WEEKDAY_SHORT_LABELS_FR, type WeekdayKey } from "@/lib/nutrition/weekdays";

/**
 * OUTIL 2 vu par l'élève — la bibliothèque de recettes de SON coach, adaptée
 * aux objectifs du jour et du créneau choisis.
 *
 * PARCOURS : jour → créneau → recette → détail adaptatif, avec retour à
 * chaque étape.
 *
 * CHAÎNE DE CALCUL, sans le moindre raccourci :
 *   jour → profil v2 du jour → calories et macros du jour →
 *   cibles par créneau → cible du créneau → solveRecipe → quantités.
 * Tout passe par `slotTargetForDay`, qui délègue à
 * `buildRecipeTargetForMealSlot`, qui délègue à `computeDailyMacroTargets` et
 * `computeMealDistribution`. Aucune formule 4 / 4 / 9 n'est réécrite ici, et
 * il n'existe qu'un seul solveur.
 *
 * AUCUNE PERSISTANCE. Ce composant ne reçoit aucun callback d'écriture,
 * n'importe rien de `lib/supabase`, et n'expose ni « Enregistrer », ni
 * « Appliquer », ni « Ajouter au plan », ni « Marquer comme consommé ». Le
 * choix de recette vit dans l'état React : un rechargement le remet à zéro,
 * ce qui est le comportement voulu.
 */
export function StudentAdaptiveRecipes({
  week,
  recipes,
}: {
  week: PlanV2Week;
  recipes: readonly RecipeWithTags[];
}) {
  const jours = useMemo(() => orderedDays(week.days), [week]);
  const [jourChoisi, setJourChoisi] = useState<WeekdayKey | null>(jours[0]?.day ?? null);
  const [créneauChoisi, setCréneauChoisi] = useState<MealSlotKey | null>(null);
  const [recetteChoisie, setRecetteChoisie] = useState<string | null>(null);

  const jour = jours.find((j) => j.day === jourChoisi) ?? null;
  const créneaux = useMemo(() => (jour ? enabledSlotsForDay(week, jour) : []), [week, jour]);

  const cible = useMemo(
    () => (jour && créneauChoisi ? slotTargetForDay(week, jour, créneauChoisi) : null),
    [week, jour, créneauChoisi],
  );

  const proposées = useMemo(
    () => (créneauChoisi ? recipesForSlot(recipes, créneauChoisi) : []),
    [recipes, créneauChoisi],
  );

  const recette = proposées.find((r) => r.recipe.id === recetteChoisie) ?? null;

  // La résolution ne part QUE si la cible est exploitable. Un profil sans
  // calories ou un créneau désactivé ne produit pas une cible à zéro : il
  // produit un refus, affiché tel quel.
  const solution = useMemo(
    () => (recette && cible?.ok ? solveRecipe(recette.recipe, { target: cible.target }) : null),
    [recette, cible],
  );
  const verdict = useMemo(() => (solution ? describeRecipeFit(solution) : null), [solution]);

  function choisirJour(cle: WeekdayKey) {
    setJourChoisi(cle);
    setCréneauChoisi(null);
    setRecetteChoisie(null);
  }
  function choisirCréneau(slot: MealSlotKey) {
    setCréneauChoisi(slot);
    setRecetteChoisie(null);
  }

  if (jours.length === 0) {
    return (
      <p className="rounded-panel border border-dashed border-border px-4 py-6 text-center text-sm text-muted-foreground">
        Ce plan n&apos;a pas encore de semaine : les recettes adaptatives ont besoin des objectifs
        d&apos;un jour pour calculer les quantités.
      </p>
    );
  }

  return (
    <div className="flex flex-col gap-5">
      {/* Étape 1 — le jour. Les sept jours tiennent sur une ligne dès 320 px
          grâce aux libellés courts, et se replient sinon. */}
      <div>
        <p className="mb-2 text-xs uppercase tracking-wide text-muted-foreground">Jour</p>
        <div className="flex flex-wrap gap-2">
          {jours.map((j) => {
            const actif = j.day === jourChoisi;
            return (
              <button
                key={j.id}
                type="button"
                onClick={() => choisirJour(j.day)}
                aria-pressed={actif}
                className={`pressable min-h-11 rounded-control border px-3 text-xs font-bold uppercase tracking-widest transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/40 ${
                  actif
                    ? "border-primary bg-primary text-primary-foreground"
                    : "border-border text-muted-foreground hover:border-primary hover:text-primary"
                }`}
              >
                <span className="sm:hidden">{WEEKDAY_SHORT_LABELS_FR[j.day]}</span>
                <span className="hidden sm:inline">{WEEKDAY_LABELS_FR[j.day]}</span>
              </button>
            );
          })}
        </div>
      </div>

      {/* Étape 2 — le créneau. Seuls les créneaux ACTIVÉS du profil du jour. */}
      <div>
        <p className="mb-2 text-xs uppercase tracking-wide text-muted-foreground">Créneau</p>
        {créneaux.length === 0 ? (
          <p className="text-sm text-muted-foreground">
            Aucun créneau n&apos;est activé pour ce jour. Demande à ton coach d&apos;en activer un.
          </p>
        ) : (
          <div className="flex flex-wrap gap-2">
            {créneaux.map((slot) => {
              const actif = slot === créneauChoisi;
              return (
                <button
                  key={slot}
                  type="button"
                  onClick={() => choisirCréneau(slot)}
                  aria-pressed={actif}
                  className={`pressable min-h-11 rounded-control border px-3 text-xs uppercase tracking-widest transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/40 ${
                    actif
                      ? "border-primary bg-primary text-primary-foreground"
                      : "border-border text-muted-foreground hover:border-primary hover:text-primary"
                  }`}
                >
                  {MEAL_SLOT_LABELS_FR[slot]}
                </button>
              );
            })}
          </div>
        )}
      </div>

      {/* La cible du créneau, dès qu'elle est connue. */}
      {créneauChoisi && cible && !cible.ok && (
        <p
          className="rounded-panel border border-warning/40 bg-warning/10 px-4 py-3 text-sm text-warning"
          role="status"
        >
          {cible.reason === "no_calories"
            ? "Les objectifs de ce jour ne sont pas encore renseignés par ton coach."
            : cible.reason === "slot_disabled"
              ? "Ce créneau est désactivé pour ce jour."
              : "Ce créneau n'est pas configuré pour ce jour."}
        </p>
      )}

      {créneauChoisi && cible?.ok && (
        <dl className="grid grid-cols-2 gap-3 text-sm sm:grid-cols-4">
          {(
            [
              ["Calories visées", `${formatIntegerFr(cible.calories)}${NBSP}kcal`],
              ["Protéines", `${formatIntegerFr(cible.target.proteinGrams)}${NBSP}g`],
              ["Glucides", `${formatIntegerFr(cible.target.carbGrams)}${NBSP}g`],
              ["Lipides", `${formatIntegerFr(cible.target.fatGrams)}${NBSP}g`],
            ] as const
          ).map(([libellé, valeur]) => (
            <div
              key={libellé}
              className="rounded-panel border border-border bg-surface-soft/50 px-3 py-2"
            >
              <dt className="text-xs uppercase tracking-wide text-muted-foreground">{libellé}</dt>
              <dd className="text-foreground">{valeur}</dd>
            </div>
          ))}
        </dl>
      )}

      {/* Étape 3 — la liste, ou étape 4 — le détail. */}
      {créneauChoisi && cible?.ok && !recette && (
        <div>
          <p className="mb-2 text-xs uppercase tracking-wide text-muted-foreground">
            Recettes proposées
          </p>
          {proposées.length === 0 ? (
            <p className="rounded-panel border border-dashed border-border px-4 py-6 text-center text-sm text-muted-foreground">
              Aucune recette disponible pour ce créneau. Ton coach en ajoutera peut-être bientôt.
            </p>
          ) : (
            <ul className="grid grid-cols-1 gap-3 sm:grid-cols-2">
              {proposées.map((r) => (
                <li key={r.recipe.id}>
                  <button
                    type="button"
                    onClick={() => setRecetteChoisie(r.recipe.id)}
                    className="pressable flex min-h-11 w-full flex-col items-start gap-1 rounded-panel border border-border bg-card p-4 text-left shadow-soft transition-colors hover:border-primary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/40"
                  >
                    <span className="flex items-center gap-2 text-sm font-bold text-foreground">
                      <ChefHat size={14} className="flex-shrink-0 text-muted-foreground" />
                      {r.recipe.name}
                    </span>
                    {r.description && (
                      <span className="line-clamp-2 text-xs text-muted-foreground">
                        {r.description}
                      </span>
                    )}
                    <span className="text-[11px] uppercase tracking-wide text-muted-foreground">
                      {r.slotKey === null
                        ? "Toutes les occasions"
                        : MEAL_SLOT_LABELS_FR[r.slotKey]}
                      {" · "}
                      {r.recipe.ingredients.length} ingrédient
                      {r.recipe.ingredients.length > 1 ? "s" : ""}
                    </span>
                    {r.tags.length > 0 && (
                      <span className="flex flex-wrap gap-1">
                        {r.tags.slice(0, 3).map((t) => (
                          <span
                            key={`${t.kind}-${t.value}`}
                            className="rounded-full border border-border px-2 py-0.5 text-[10px] uppercase tracking-wide text-muted-foreground"
                          >
                            {describeTag(t.kind, t.value)}
                          </span>
                        ))}
                      </span>
                    )}
                  </button>
                </li>
              ))}
            </ul>
          )}
        </div>
      )}

      {recette && solution && verdict && cible?.ok && (
        <div className="flex flex-col gap-4">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <h3 className="font-heading text-base font-bold uppercase text-foreground">
              {recette.recipe.name}
            </h3>
            <button
              type="button"
              onClick={() => setRecetteChoisie(null)}
              className="pressable flex min-h-11 items-center gap-2 rounded-control border border-border px-4 text-xs uppercase tracking-widest text-muted-foreground transition-colors hover:border-primary hover:text-primary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/40"
            >
              <ArrowLeft size={14} />
              Retour aux recettes
            </button>
          </div>

          <p
            className={`rounded-panel border px-4 py-3 text-sm ${
              verdict.status === "exact"
                ? "border-success/40 bg-success/10 text-success"
                : verdict.status === "approximate"
                  ? "border-warning/40 bg-warning/10 text-warning"
                  : "border-destructive/40 bg-destructive/10 text-destructive"
            }`}
            role="status"
          >
            {verdict.summary}
          </p>

          {verdict.status === "impossible" && (
            <p className="text-xs leading-relaxed text-muted-foreground">
              Les quantités ci-dessous sont celles qui approchent le plus la cible, mais elles ne
              l&apos;atteignent pas : ne les prends pas pour une prescription. Choisis plutôt une
              autre recette, ou parles-en à ton coach.
            </p>
          )}

          {/* Téléphone : une carte par ingrédient. Tablette et ordinateur :
              le tableau, dans une zone défilante atteignable au clavier. */}
          <ul className="flex flex-col gap-2 md:hidden">
            {solution.ingredients.map((ing) => (
              <li
                key={ing.ingredientId}
                className="rounded-panel border border-border bg-surface-soft/50 px-4 py-3"
              >
                <div className="flex flex-wrap items-baseline justify-between gap-2">
                  <span className="text-sm text-foreground">
                    {ing.name}
                    {ing.boundHit && (
                      <span className="ml-2 rounded-full border border-warning/50 px-2 py-0.5 text-[10px] uppercase tracking-widest text-warning">
                        {ing.boundHit === "max" ? "plafond" : "plancher"}
                      </span>
                    )}
                  </span>
                  <span className="text-sm font-bold text-foreground">
                    {formatSolvedIngredientQuantity(ing)}
                  </span>
                </div>
                <p className="mt-1 text-xs text-muted-foreground">
                  P{NBSP}
                  {formatIntegerFr(ing.proteinGrams)} · G{NBSP}
                  {formatIntegerFr(ing.carbGrams)} · L{NBSP}
                  {formatIntegerFr(ing.fatGrams)} · {formatIntegerFr(ing.calories)}
                  {NBSP}kcal
                </p>
              </li>
            ))}
          </ul>

          <div
            className="hidden overflow-x-auto md:block"
            tabIndex={0}
            role="region"
            aria-label="Détail des quantités adaptées"
          >
            <table className="w-full min-w-[520px] text-left text-sm">
              <thead>
                <tr className="border-b border-border text-xs uppercase tracking-wide text-muted-foreground">
                  <th scope="col" className="py-2 pr-3 font-normal">Ingrédient</th>
                  <th scope="col" className="py-2 pr-3 font-normal">Quantité</th>
                  <th scope="col" className="py-2 pr-3 font-normal">Prot.</th>
                  <th scope="col" className="py-2 pr-3 font-normal">Gluc.</th>
                  <th scope="col" className="py-2 pr-3 font-normal">Lip.</th>
                  <th scope="col" className="py-2 font-normal">Kcal</th>
                </tr>
              </thead>
              <tbody>
                {solution.ingredients.map((ing) => (
                  <tr key={ing.ingredientId} className="border-b border-border/60 last:border-0">
                    <td className="py-2 pr-3 text-foreground">
                      {ing.name}
                      {ing.boundHit && (
                        <span className="ml-2 rounded-full border border-warning/50 px-2 py-0.5 text-[10px] uppercase tracking-widest text-warning">
                          {ing.boundHit === "max" ? "plafond" : "plancher"}
                        </span>
                      )}
                    </td>
                    <td className="py-2 pr-3 text-foreground">
                      {formatSolvedIngredientQuantity(ing)}
                    </td>
                    <td className="py-2 pr-3 text-muted-foreground">{formatIntegerFr(ing.proteinGrams)}</td>
                    <td className="py-2 pr-3 text-muted-foreground">{formatIntegerFr(ing.carbGrams)}</td>
                    <td className="py-2 pr-3 text-muted-foreground">{formatIntegerFr(ing.fatGrams)}</td>
                    <td className="py-2 text-muted-foreground">{formatIntegerFr(ing.calories)}</td>
                  </tr>
                ))}
              </tbody>
              <tfoot>
                <tr className="border-t border-border font-bold text-foreground">
                  <td className="py-2 pr-3">Total</td>
                  <td className="py-2 pr-3">—</td>
                  <td className="py-2 pr-3">{formatIntegerFr(solution.totals.proteinGrams)}</td>
                  <td className="py-2 pr-3">{formatIntegerFr(solution.totals.carbGrams)}</td>
                  <td className="py-2 pr-3">{formatIntegerFr(solution.totals.fatGrams)}</td>
                  <td className="py-2">{formatIntegerFr(solution.totals.calories)}</td>
                </tr>
              </tfoot>
            </table>
          </div>

          <dl className="grid grid-cols-2 gap-3 text-sm sm:grid-cols-4">
            {(
              [
                ["Écart protéines", solution.deltas.proteinGrams],
                ["Écart glucides", solution.deltas.carbGrams],
                ["Écart lipides", solution.deltas.fatGrams],
                ["Écart calories", solution.totals.calories - cible.calories],
              ] as const
            ).map(([libellé, valeur]) => (
              <div
                key={libellé}
                className="rounded-panel border border-border bg-surface-soft/50 px-3 py-2"
              >
                <dt className="text-xs uppercase tracking-wide text-muted-foreground">{libellé}</dt>
                <dd className="text-foreground">
                  {Math.round(valeur) > 0 ? "+" : ""}
                  {formatIntegerFr(valeur)}
                </dd>
              </div>
            ))}
          </dl>

          {solution.warnings.length > 0 && (
            <ul className="flex list-disc flex-col gap-1 rounded-panel border border-warning/40 bg-warning/10 px-6 py-3 text-xs text-warning">
              {solution.warnings.map((w, index) => (
                <li key={`${w.code}-${index}`}>{w.message}</li>
              ))}
            </ul>
          )}

          {recette.tags.length > 0 && (
            <div className="flex flex-wrap gap-1">
              {recette.tags.map((t) => (
                <span
                  key={`${t.kind}-${t.value}`}
                  className="rounded-full border border-border px-2 py-0.5 text-[10px] uppercase tracking-wide text-muted-foreground"
                >
                  {describeTag(t.kind, t.value)}
                </span>
              ))}
            </div>
          )}

          <div className="flex flex-wrap gap-3">
            <button
              type="button"
              onClick={() => setRecetteChoisie(null)}
              className="pressable flex min-h-11 items-center gap-2 rounded-control border border-border px-4 text-xs uppercase tracking-widest text-muted-foreground transition-colors hover:border-primary hover:text-primary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/40"
            >
              Retour aux recettes
            </button>
            <button
              type="button"
              onClick={() => {
                setCréneauChoisi(null);
                setRecetteChoisie(null);
              }}
              className="pressable flex min-h-11 items-center gap-2 rounded-control border border-border px-4 text-xs uppercase tracking-widest text-muted-foreground transition-colors hover:border-primary hover:text-primary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/40"
            >
              Changer de créneau
            </button>
            <button
              type="button"
              onClick={() => {
                setJourChoisi(jours[0]?.day ?? null);
                setCréneauChoisi(null);
                setRecetteChoisie(null);
              }}
              className="pressable flex min-h-11 items-center gap-2 rounded-control border border-border px-4 text-xs uppercase tracking-widest text-muted-foreground transition-colors hover:border-primary hover:text-primary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/40"
            >
              Changer de jour
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
