"use client";

import { useMemo, useState } from "react";
import { Eye, EyeOff } from "lucide-react";

import { Field } from "@/components/admin/AdminFormFields";
import { computeCaloriesFromGrams } from "@/lib/nutrition/macro-targets";
import { toPreviewRecipe, type RecipeFormState } from "@/lib/nutrition/recipe-form";
import { describeRecipeFit } from "@/lib/nutrition/recipe-matching";
import { solveRecipe } from "@/lib/nutrition/recipe-solver";

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

const NBSP = " ";

function arrondir(valeur: number): string {
  return String(Math.round(valeur));
}

export function RecipeAdaptivePreview({ state }: { state: RecipeFormState }) {
  const [ouvert, setOuvert] = useState(false);
  const [protéines, setProtéines] = useState("40");
  const [glucides, setGlucides] = useState("80");
  const [lipides, setLipides] = useState("20");

  const cible = useMemo(() => {
    const lire = (t: string) => {
      const n = Number(t.trim().replace(",", "."));
      return Number.isFinite(n) && n >= 0 ? n : 0;
    };
    return { proteinGrams: lire(protéines), carbGrams: lire(glucides), fatGrams: lire(lipides) };
  }, [protéines, glucides, lipides]);

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
    () => (ouvert && state.ingredients.length > 0 ? solveRecipe(toPreviewRecipe(state), { target: cible }) : null),
    [ouvert, state, cible],
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
          <p className="text-xs text-muted-foreground">
            Soit {arrondir(caloriesCible)}{NBSP}kcal visées (4{NBSP}/{NBSP}4{NBSP}/{NBSP}9).
          </p>

          {!solution && (
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

              <div className="overflow-x-auto">
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
                        <td className="py-2 pr-3 text-foreground">
                          {ing.unitLabel ??
                            (ing.eggCount !== null
                              ? `${ing.eggCount} œuf${ing.eggCount > 1 ? "s" : ""}`
                              : `${ing.displayGrams}${NBSP}g`)}
                        </td>
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
