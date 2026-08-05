"use client";

import { AlertTriangle, CheckCircle2 } from "lucide-react";

import type { RecipeFormIssue } from "@/lib/nutrition/recipe-form";
import { describeBlockingIssue } from "@/lib/nutrition/recipe-labels";

/**
 * Récapitulatif de validation d'une recette.
 *
 * DEUX SOURCES, CLAIREMENT DISTINGUÉES :
 *   - `issues` — validation LOCALE (TypeScript), retour immédiat pendant la
 *     saisie ;
 *   - `blockingIssue` — verdict de `nutrition_recipe_blocking_issue`, rendu
 *     par la base. C'est LUI qui décide de l'activation.
 *
 * On ne prétend jamais qu'une recette est activable : on dit qu'elle est
 * exploitable « d'après la base » ou qu'il reste des points à compléter.
 */
export function RecipeValidationSummary({
  issues,
  blockingIssue,
  saveError,
}: {
  issues: readonly RecipeFormIssue[];
  blockingIssue?: string | null;
  saveError?: string | null;
}) {
  const messageBase = describeBlockingIssue(blockingIssue);
  const rienÀSignaler = issues.length === 0 && !messageBase && !saveError;

  if (rienÀSignaler) {
    return (
      <div
        className="flex items-start gap-3 rounded-panel border border-success/40 bg-success/10 px-4 py-3 text-sm text-success"
        role="status"
      >
        <CheckCircle2 size={18} className="mt-0.5 flex-shrink-0" />
        <span>Cette recette est exploitable : elle peut être activée.</span>
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-3">
      {saveError && (
        <p
          className="rounded-panel border border-destructive/40 bg-destructive/10 px-4 py-3 text-sm text-destructive"
          role="alert"
        >
          {saveError}
        </p>
      )}

      {messageBase && (
        <div
          className="flex items-start gap-3 rounded-panel border border-warning/40 bg-warning/10 px-4 py-3 text-sm text-warning"
          role="status"
        >
          <AlertTriangle size={18} className="mt-0.5 flex-shrink-0" />
          <span>
            <span className="font-bold uppercase tracking-widest">Vérifié par la base</span>
            {" — "}
            {messageBase}
          </span>
        </div>
      )}

      {issues.length > 0 && (
        <div className="rounded-panel border border-warning/40 bg-warning/10 px-4 py-3 text-sm text-warning">
          <p className="mb-2 flex items-center gap-2 font-bold uppercase tracking-widest">
            <AlertTriangle size={16} />
            {issues.length} point{issues.length > 1 ? "s" : ""} à compléter
          </p>
          <ul className="flex list-disc flex-col gap-1 pl-5">
            {issues.map((issue, index) => (
              <li key={`${issue.code}-${issue.ingredientId ?? "recette"}-${index}`}>{issue.message}</li>
            ))}
          </ul>
        </div>
      )}
    </div>
  );
}
