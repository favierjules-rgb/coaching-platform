"use client";

import { useMemo, useState } from "react";
import { Eye, EyeOff } from "lucide-react";

import { Field } from "@/components/admin/AdminFormFields";
import { NBSP, formatIntegerFr } from "@/lib/nutrition/basis-points";
import { computeCaloriesFromGrams } from "@/lib/nutrition/macro-targets";
import { toPreviewRecipe, type RecipeFormState } from "@/lib/nutrition/recipe-form";
import { describeRecipeFit } from "@/lib/nutrition/recipe-matching";
import { solveRecipe, type SolvedIngredient } from "@/lib/nutrition/recipe-solver";

/**
 * APERÇU ADAPTATIF — entièrement en LECTURE SEULE.
 *
 * QUATRE BARRIÈRES, toutes vérifiées par test :
 *   1. aucune quantité adaptée n'est injectée dans le formulaire : ce
 *      composant ne reçoit AUCUN callback de modification, il n'a donc aucun
 *      moyen d'écrire dans l'état source ;
 *   2. aucun bouton « appliquer les quantités calculées » n'existe ;
 *   3. aucune écriture Supabase : ce fichier n'importe rien de `lib/supabase` ;
 *   4. `toPreviewRecipe` construit une COPIE en mémoire ; fermer puis rouvrir
 *      l'aperçu laisse la recette canonique strictement identique.
 *
 * `RecipeSolution` ne quitte jamais ce composant, et n'est jamais envoyée à
 * la RPC de sauvegarde.
 */

/**
 * Formatage français, repris de `basis-points` : mêmes séparateurs de
 * milliers insécables que le constructeur de plans v2, dans la même section
 * de l'administration. `NBSP` vient de la même source.
 */
const arrondir = formatIntegerFr;

/**
 * Quantité affichée d'un ingrédient résolu — unité, nombre d'œufs, ou grammes.
 * Une seule définition, partagée par la vue carte et la vue tableau : deux
 * copies finiraient par diverger.
 */
function quantite(ing: SolvedIngredient): string {
  if (ing.unitLabel) return ing.unitLabel;
  if (ing.eggCount !== null) return `${ing.eggCount} œuf${ing.eggCount > 1 ? "s" : ""}`;
  return `${ing.displayGrams}${NBSP}g`;
}

/** `null` = saisie inexploitable. Jamais 0 par défaut : ce serait un mensonge. */
function lireCible(texte: string): number | null {
  const nettoye = texte.trim().replace(",", ".");
  if (nettoye === "") return null;
  const n = Number(nettoye);
  return Number.isFinite(n) && n >= 0 ? n : null;
}

export function RecipeAdaptivePreview({ state }: { state: RecipeFormState }) {
  const [ouvert, setOuvert] = useState(false);
  const [protéines, setProtéines] = useState("40");
  const [glucides, setGlucides] = useState("80");
  const [lipides, setLipides] = useState("20");

  // Une saisie négative ou illisible était silencieusement ramenée à 0 : la
  // simulation annonçait alors « exact » sur une cible de 0 g, sans le moindre
  // message. On la signale, et on ne résout pas.
  const cibleValide =
    lireCible(protéines) !== null && lireCible(glucides) !== null && lireCible(lipides) !== null;

  const cible = useMemo(
    () => ({
      proteinGrams: lireCible(protéines) ?? 0,
      carbGrams: lireCible(glucides) ?? 0,
      fatGrams: lireCible(lipides) ?? 0,
    }),
    [protéines, glucides, lipides],
  );

  const caloriesCible = useMemo(
    () =>
      computeCaloriesFromGrams({
        proteinGrams: cible.proteinGrams,
        carbGrams: cible.carbGrams,
        fatGrams: cible.fatGrams,
      }).totalCalories,
    [cible],
  );

  // La résolution travaille sur une COPIE construite à la volée. L'état du
  // formulaire n'est jamais touché — `toPreviewRecipe` ne mute rien.
  const solution = useMemo(
    () =>
      ouvert && cibleValide && state.ingredients.length > 0
        ? solveRecipe(toPreviewRecipe(state), { target: cible })
        : null,
    [ouvert, cibleValide, state, cible],
  );
  const fit = useMemo(() => (solution ? describeRecipeFit(solution) : null), [solution]);

  return (
    <div className="rounded-card border border-border bg-card p-4 shadow-soft sm:p-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h3 className="font-heading text-base font-bold uppercase text-foreground">Aperçu adaptatif</h3>
          <p className="mt-1 text-xs text-muted-foreground">
            Simulation en lecture seule. Rien n&apos;est enregistré, et la recette n&apos;est jamais modifiée.
          </p>
        </div>
        <button
          type="button"
          onClick={() => setOuvert((v) => !v)}
          aria-expanded={ouvert}
          className="pressable flex min-h-[44px] items-center gap-2 rounded-control border border-border px-4 py-2 text-xs font-bold uppercase tracking-widest text-muted-foreground transition-colors hover:border-primary hover:text-primary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/40"
        >
          {ouvert ? <EyeOff size={14} /> : <Eye size={14} />}
          {ouvert ? "Masquer" : "Prévisualiser"}
        </button>
      </div>

      {ouvert && (
        <div className="mt-4 flex flex-col gap-4">
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
            <Field label="Cible protéines (g)" value={protéines} onChange={setProtéines} type="number" step="1" />
            <Field label="Cible glucides (g)" value={glucides} onChange={setGlucides} type="number" step="1" />
            <Field label="Cible lipides (g)" value={lipides} onChange={setLipides} type="number" step="1" />
          </div>
          {cibleValide ? (
            <p className="text-xs text-muted-foreground">
              Soit {arrondir(caloriesCible)}{NBSP}kcal visées (4{NBSP}/{NBSP}4{NBSP}/{NBSP}9).
            </p>
          ) : (
            <p
              className="rounded-panel border border-warning/40 bg-warning/10 px-4 py-3 text-sm text-warning"
              role="alert"
            >
              Renseigne les trois cibles en grammes, positives ou nulles, pour lancer la simulation.
            </p>
          )}

          {cibleValide && !solution && (
            <p className="text-sm text-muted-foreground">
              Ajoute au moins un ingrédient pour voir l&apos;adaptation.
            </p>
          )}

          {solution && fit && (
            <>
              <p
                className={`rounded-panel border px-4 py-3 text-sm ${
                  fit.status === "exact"
                    ? "border-success/40 bg-success/10 text-success"
                    : fit.status === "approximate"
                      ? "border-warning/40 bg-warning/10 text-warning"
                      : "border-destructive/40 bg-destructive/10 text-destructive"
                }`}
                role="status"
              >
                {fit.summary}
              </p>
              {/* Sans cette phrase, « ne peut pas atteindre la cible » et
                  « cette recette est exploitable », affichés à quelques
                  centimètres l'un de l'autre, se lisent comme une
                  contradiction. Ce sont deux questions différentes. */}
              <p className="-mt-2 text-xs text-muted-foreground">
                Ce verdict porte sur la cible saisie ci-dessus, pas sur la validité de la recette :
                une recette parfaitement formée peut ne pas atteindre une cible donnée.
              </p>

              {/* Téléphone : une carte par ingrédient — aucun défilement
                  horizontal, comme le constructeur de plans v2. */}
              <ul className="flex flex-col gap-3 md:hidden">
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
                      <span className="text-sm font-bold text-foreground">{quantite(ing)}</span>
                    </div>
                    <p className="mt-1 text-xs text-muted-foreground">
                      P{NBSP}{arrondir(ing.proteinGrams)}
                      {" · "}G{NBSP}{arrondir(ing.carbGrams)}
                      {" · "}L{NBSP}{arrondir(ing.fatGrams)}
                      {" · "}{arrondir(ing.calories)}{NBSP}kcal
                    </p>
                  </li>
                ))}
                <li className="rounded-panel border border-border-strong bg-surface-soft px-4 py-3">
                  <div className="flex flex-wrap items-baseline justify-between gap-2">
                    <span className="text-sm font-bold uppercase tracking-wide text-foreground">Total</span>
                    <span className="text-sm font-bold text-foreground">
                      {arrondir(solution.totals.calories)}{NBSP}kcal
                    </span>
                  </div>
                  <p className="mt-1 text-xs text-muted-foreground">
                    P{NBSP}{arrondir(solution.totals.proteinGrams)}
                    {" · "}G{NBSP}{arrondir(solution.totals.carbGrams)}
                    {" · "}L{NBSP}{arrondir(solution.totals.fatGrams)}
                  </p>
                </li>
              </ul>

              {/* Tablette et ordinateur : le tableau. `tabIndex` rend la zone
                  défilante atteignable au clavier (WCAG 2.1.1). */}
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
                      <th scope="col" className="py-2 pr-3 font-normal">Quantité adaptée</th>
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
                        <td className="py-2 pr-3 text-foreground">{quantite(ing)}</td>
                        <td className="py-2 pr-3 text-muted-foreground">{arrondir(ing.proteinGrams)}</td>
                        <td className="py-2 pr-3 text-muted-foreground">{arrondir(ing.carbGrams)}</td>
                        <td className="py-2 pr-3 text-muted-foreground">{arrondir(ing.fatGrams)}</td>
                        <td className="py-2 text-muted-foreground">{arrondir(ing.calories)}</td>
                      </tr>
                    ))}
                  </tbody>
                  <tfoot>
                    <tr className="border-t border-border font-bold text-foreground">
                      <td className="py-2 pr-3">Total</td>
                      <td className="py-2 pr-3">—</td>
                      <td className="py-2 pr-3">{arrondir(solution.totals.proteinGrams)}</td>
                      <td className="py-2 pr-3">{arrondir(solution.totals.carbGrams)}</td>
                      <td className="py-2 pr-3">{arrondir(solution.totals.fatGrams)}</td>
                      <td className="py-2">{arrondir(solution.totals.calories)}</td>
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
                    ["Écart calories", solution.totals.calories - caloriesCible],
                  ] as const
                ).map(([libellé, valeur]) => (
                  <div key={libellé} className="rounded-panel border border-border bg-surface-soft/50 px-3 py-2">
                    <dt className="text-xs uppercase tracking-wide text-muted-foreground">{libellé}</dt>
                    <dd className="text-foreground">
                      {Math.round(valeur) > 0 ? "+" : ""}
                      {arrondir(valeur)}
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
            </>
          )}
        </div>
      )}
    </div>
  );
}
