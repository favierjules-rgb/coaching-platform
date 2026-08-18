"use client";

import { NBSP } from "@/lib/nutrition/basis-points";
import {
  type BudgetObserve,
  type ComparaisonBudget,
  formaterMontantMilli,
} from "@/lib/nutrition/budget-observe";

/**
 * COURSES C4.6 — LE MINIMUM OBSERVÉ, À L'ÉCRAN.
 *
 * ════════════════════════════════════════════════════════════════════════════
 * ⚠️ CE BLOC N'AFFICHE JAMAIS « BUDGET »
 * ════════════════════════════════════════════════════════════════════════════
 * Le nombre montré est le coût le plus bas que les relevés disponibles
 * permettent de calculer pour couvrir la liste, dans le magasin choisi. Ce
 * n'est ni un prix garanti, ni un prix d'aujourd'hui, ni ce que l'élève
 * dépensera : il achètera peut-être une autre marque, et ce sera plus cher.
 *
 * Trois libellés, trois situations, et aucun ne se déguise en l'autre :
 *
 *   COMPLET      « Minimum observé : 42,30 € »
 *   PARTIEL      « Minimum observé connu : 34,80 € » + « 8 / 10 articles »
 *   INDÉTERMINÉ  « Minimum observé indisponible »
 *
 * ⚠️ ZÉRO LIGNE RÉSOLUE N'AFFICHE JAMAIS « 0,00 € ». C'est la doctrine de C3,
 * reprise telle quelle : `aucuneEstimation` y garde déjà le zéro hors de
 * l'écran. « Les courses coûtent zéro » et « nous ne connaissons aucun coût »
 * sont deux phrases différentes, et une seule est vraie.
 *
 * ⚠️ ET AUCUN ÉCART GLOBAL SUR UNE COUVERTURE PARTIELLE. C'est le défaut D-4 de
 * C3 : « il te reste 6,60 € » était affirmé alors que cinq articles sur vingt
 * n'étaient pas comptés — arithmétiquement exact, pratiquement faux.
 */
export function BlocMinimumObserve({
  budget,
  comparaison,
  magasinChoisi,
  chargement,
  ok,
}: {
  readonly budget: BudgetObserve | null;
  readonly comparaison: ComparaisonBudget | null;
  readonly magasinChoisi: boolean;
  readonly chargement: boolean;
  readonly ok: boolean;
}) {
  const titre = (
    <h3 className="text-sm font-semibold tracking-wide text-muted-foreground">
      PRIX OBSERVÉS
    </h3>
  );

  const cadre = (contenu: React.ReactNode) => (
    <section
      className="flex flex-col gap-3 rounded-card border border-border bg-card p-4"
      aria-label="Minimum observé de la liste"
    >
      {titre}
      {contenu}
    </section>
  );

  if (chargement) {
    return cadre(
      <p className="text-sm text-muted-foreground" role="status">
        Lecture des relevés…
      </p>,
    );
  }

  // ⚠️ UNE PANNE N'EST PAS UNE ABSENCE. Le dire évite qu'un élève conclue
  // qu'aucun prix n'existe pour ses articles.
  if (!ok) {
    return cadre(
      <p className="text-sm text-warning" role="status">
        Minimum observé indisponible pour l&apos;instant : les relevés n&apos;ont pas pu être lus.
      </p>,
    );
  }

  if (!magasinChoisi) {
    return cadre(
      <p className="text-sm text-muted-foreground" role="status">
        Choisis un magasin pour voir le minimum observé de ta liste.
      </p>,
    );
  }

  if (budget === null || budget.lignesTotal === 0) {
    // Liste vide — exactement le « — » de C3, qui teste l'absence AVANT le
    // montant plutôt que d'afficher un zéro.
    return cadre(<p className="text-sm text-muted-foreground">—</p>);
  }

  if (budget.lignesResolues === 0) {
    return cadre(
      <>
        <p className="text-sm text-muted-foreground" role="status">
          Minimum observé indisponible.
        </p>
        <p className="text-xs text-muted-foreground">
          Aucun des {budget.lignesTotal} article{budget.lignesTotal > 1 ? "s" : ""} n&apos;a pu être
          chiffré à partir des relevés de ce magasin.
        </p>
      </>,
    );
  }

  const complet = budget.statut === "complet";

  return cadre(
    <>
      <dl className="flex flex-col gap-1 text-sm">
        <div className="flex items-baseline justify-between gap-3">
          <dt className="text-muted-foreground">
            {complet ? "Minimum observé" : "Minimum observé connu"}
          </dt>
          <dd className="font-semibold tabular-nums">
            {formaterMontantMilli(budget.totalConnuMilli)}
          </dd>
        </div>

        {/* ⚠️ L'ÉCART N'EXISTE QUE SI LA COUVERTURE EST COMPLÈTE. Sur une
            couverture partielle, `comparaison.disponible` est faux et l'écran
            le DIT, plutôt que de montrer une marge plus grande que la
            réalité. */}
        {comparaison?.disponible === true && comparaison.margeMilli !== null && (
          <div className="flex items-baseline justify-between gap-3">
            <dt className="text-muted-foreground">
              {comparaison.depassement ? "Dépassement du budget" : "Marge sur le budget"}
            </dt>
            <dd
              className={`font-semibold tabular-nums ${comparaison.depassement ? "text-warning" : "text-success"}`}
            >
              {formaterMontantMilli(Math.abs(comparaison.margeMilli))}
            </dd>
          </div>
        )}
      </dl>

      {!complet && (
        <p className="text-xs text-muted-foreground" role="status">
          {budget.lignesResolues}
          {NBSP}/{NBSP}
          {budget.lignesTotal} article{budget.lignesTotal > 1 ? "s" : ""} chiffré
          {budget.lignesResolues > 1 ? "s" : ""} — comparaison au budget indisponible tant que la
          liste n&apos;est pas complète.
        </p>
      )}

      {/* ⚠️ « OBSERVÉ », JAMAIS « ACTUEL ». Un relevé est un fait passé et daté ;
          promettre un prix du jour serait une promesse que personne ne tient. */}
      <p className="text-xs text-muted-foreground">
        Coût le plus bas calculable à partir des relevés Open Prices de ce magasin. Un relevé est un
        prix observé à une date, pas un prix garanti.
      </p>
    </>,
  );
}
