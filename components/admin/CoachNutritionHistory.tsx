"use client";

import { useMemo, useState } from "react";

import { DailyNutritionProgress } from "@/components/student/DailyNutritionProgress";
import { NutritionDayCarousel } from "@/components/student/NutritionDayCarousel";
import { NutritionWeekNav } from "@/components/student/NutritionWeekNav";
import { useHistoriqueEleve } from "@/hooks/useHistoriqueEleve";
import { NBSP, formatDecimalFr, formatIntegerFr } from "@/lib/nutrition/basis-points";
import {
  CONSUMED_UNIT_LABELS_FR,
  type ConsumedEntry,
  type ConsumedMeal,
  entryKcal,
  formatHeureFr,
  orderedConsumedMeals,
  totalsForDay,
  totalsForMeal,
} from "@/lib/nutrition/consumed";
import {
  type Semaine,
  decalerSemaine,
  libelleSemaine,
  resumeSemaine,
  semaineContenant,
} from "@/lib/nutrition/historique";
import { WEEKDAY_LABELS_FR, WEEKDAY_KEYS } from "@/lib/nutrition/weekdays";

/**
 * L'HISTORIQUE ALIMENTAIRE D'UN ÉLÈVE, VU PAR SON COACH (ALIMENTS A5.8).
 *
 * ────────────────────────────────────────────────────────────────────────────
 * MÊME ARITHMÉTIQUE QUE L'ÉCRAN ÉLÈVE — PAS UNE SECONDE IMPLÉMENTATION
 * ────────────────────────────────────────────────────────────────────────────
 * Les semaines, les résumés, les totaux et la géométrie viennent des MÊMES
 * modules qu'A5.7 : `lib/nutrition/historique.ts`, `NutritionWeekNav`,
 * `NutritionDayCarousel`, `DailyNutritionProgress`. Rien n'est recalculé ici.
 * Deux écrans qui additionnent séparément finissent toujours par afficher deux
 * chiffres différents pour la même journée, et c'est le coach qui découvre
 * l'écart devant son athlète.
 *
 * ────────────────────────────────────────────────────────────────────────────
 * CE QUI N'EST PAS RÉUTILISÉ, ET POURQUOI
 * ────────────────────────────────────────────────────────────────────────────
 * `ConsumedMealSection` et `ConsumedFoodBar` sont EXCLUS. Ce ne sont pas des
 * blocs d'affichage : `ConsumedFoodBar` est un `<button>` dont le libellé
 * d'accessibilité dit « modifier », et `ConsumedMealSection` exige sept
 * fonctions d'écriture. Les brancher ici demanderait de fournir des rappels
 * factices — donc d'afficher au coach des commandes qui ne font rien.
 *
 * Le rendu des repas est donc écrit à neuf, en `<li>` et non en `<button>`.
 * Ce qu'il duplique est du balisage ; ce qu'il partage est le CALCUL.
 *
 * ────────────────────────────────────────────────────────────────────────────
 * LECTURE SEULE, PAR CONSTRUCTION
 * ────────────────────────────────────────────────────────────────────────────
 * ⚠️ Ce composant n'a aucun client Supabase, aucune RPC, aucun rappel
 * d'écriture, et son hook (`useHistoriqueEleve`) n'en expose aucun. Il n'y a
 * rien à appeler — et la base refuserait de toute façon, l'écriture directe
 * ayant été retirée à `authenticated` en A2.
 *
 * ────────────────────────────────────────────────────────────────────────────
 * AUCUN OBJECTIF AFFICHÉ, ET C'EST DÉLIBÉRÉ
 * ────────────────────────────────────────────────────────────────────────────
 * L'anneau montre le CONSOMMÉ sans cible. Cet écran répond à « qu'a-t-il
 * réellement mangé », pas à « a-t-il tenu son objectif » — auquel le bloc
 * « Suivi nutrition » de la fiche répond déjà. Afficher ici une cible
 * supposerait de reconstruire les sept profils du plan, donc de réintroduire la
 * prescription dans un écran d'historique : exactement ce que le contrat
 * interdit.
 */

export function CoachNutritionHistory({
  studentId,
  nomEleve,
  aujourdHui,
  actif = true,
}: {
  /** `students.id`. L'élève est NOMMÉ — jamais deviné depuis la session. */
  studentId: string;
  nomEleve: string;
  /** La date du jour, INJECTÉE : jamais lue depuis l'horloge pendant le rendu. */
  aujourdHui: string;
  actif?: boolean;
}) {
  // ⚠️ LA SEMAINE EST UN ÉTAT, L'ÉLÈVE EST UNE PROP. C'est ce qui fait que
  // changer de semaine ne peut pas changer d'élève : `setSemaine` ne touche pas
  // à `studentId`, et `studentId` ne vient pas d'ici.
  const [semaine, setSemaine] = useState<Semaine>(
    () => semaineContenant(aujourdHui) ?? { debut: "", fin: "", dates: [] },
  );

  const historique = useHistoriqueEleve(studentId, semaine.dates, actif);

  const résumé = useMemo(
    () => resumeSemaine(historique.meals, semaine),
    [historique.meals, semaine],
  );

  const semaineCourante = semaineContenant(aujourdHui);

  return (
    <section aria-label={`Historique alimentaire de ${nomEleve}`} className="flex flex-col gap-3">
      <NutritionWeekNav
        libellé={libelleSemaine(semaine)}
        resume={historique.loading ? null : résumé}
        estSemaineCourante={semaine.debut === semaineCourante?.debut}
        onPrecedente={() => setSemaine((s) => decalerSemaine(s, -1))}
        onSuivante={() => setSemaine((s) => decalerSemaine(s, 1))}
      />

      {historique.error !== null && (
        <p className="rounded-panel border border-destructive/40 bg-destructive/5 px-3 py-2 text-sm text-destructive">
          {historique.error}
        </p>
      )}

      {historique.loading ? (
        <p className="px-1 text-sm text-muted-foreground">Chargement de la semaine…</p>
      ) : (
        <NutritionDayCarousel
          dates={semaine.dates}
          libellés={WEEKDAY_KEYS.map((j) => WEEKDAY_LABELS_FR[j])}
          aujourdHui={aujourdHui}
          rendreJour={(index) => (
            <JourConsomme
              date={semaine.dates[index] ?? ""}
              repas={historique.meals.filter((r) => r.consumedOn === semaine.dates[index])}
            />
          )}
        />
      )}
    </section>
  );
}

/**
 * Une journée : le résumé visuel d'A5.6, puis les repas réellement mangés.
 *
 * EXPORTÉ POUR LES TESTS — même convention que `CalorieRing` et
 * `MacroProgressBar` en A5.6. Le rendu d'une journée se vérifie alors
 * directement, sans avoir à monter le hook ni à simuler Supabase.
 */
export function JourConsomme({ date, repas }: { date: string; repas: readonly ConsumedMeal[] }) {
  const ordonnés = orderedConsumedMeals(repas);
  // ⚠️ « AUCUNE SAISIE » N'EST PAS « ZÉRO MANGÉ ». Même règle qu'en A5.7, et
  // pour la même raison : reprocher un 0 kcal à un élève qui n'a rien noté est
  // une erreur de fait, et le coach la lirait comme un manquement.
  const aucuneSaisie = ordonnés.every((r) => r.entries.length === 0);

  return (
    <div className="flex flex-col gap-3">
      <DailyNutritionProgress objectif={null} consommé={totalsForDay(repas)} />

      {aucuneSaisie ? (
        <p className="rounded-panel border border-dashed border-border px-4 py-6 text-center text-sm text-muted-foreground">
          Aucune consommation enregistrée ce jour-là.
        </p>
      ) : (
        <ul className="flex flex-col gap-3">
          {ordonnés
            .filter((r) => r.entries.length > 0)
            .map((r) => (
              <RepasConsomme key={r.id} repas={r} />
            ))}
        </ul>
      )}
      <p className="sr-only">{date}</p>
    </div>
  );
}

export function RepasConsomme({ repas }: { repas: ConsumedMeal }) {
  const totaux = totalsForMeal(repas);
  return (
    <li className="overflow-hidden rounded-panel border border-border bg-card">
      <div className="flex flex-wrap items-baseline justify-between gap-2 border-b border-border bg-surface-soft px-3 py-2">
        <span className="text-xs font-bold uppercase tracking-widest text-foreground">
          {repas.label}
        </span>
        <span className="text-xs font-bold tabular-nums text-foreground">
          {formatIntegerFr(Math.round(totaux.kcal))}
          {NBSP}kcal
        </span>
      </div>
      <ul className="flex flex-col divide-y divide-border">
        {repas.entries.map((e) => (
          <AlimentConsomme key={e.id} entrée={e} />
        ))}
      </ul>
    </li>
  );
}

/**
 * Un aliment consommé — un `<li>`, JAMAIS un `<button>`.
 *
 * ⚠️ La version élève (`ConsumedFoodBar`) est cliquable et s'annonce
 * « modifier ». Ici, rien n'est cliquable : le coach lit. C'est la raison pour
 * laquelle ce balisage n'est pas partagé.
 */
export function AlimentConsomme({ entrée }: { entrée: ConsumedEntry }) {
  const heure = formatHeureFr(entrée.createdAt);
  // L'unité HISTORIQUE, telle quelle. `g` reste `g`, `ml` reste `ml` : aucune
  // conversion, ici pas plus qu'ailleurs.
  const quantité = `${formatDecimalFr(entrée.quantity, entrée.quantity % 1 === 0 ? 0 : 1)}${NBSP}${
    CONSUMED_UNIT_LABELS_FR[entrée.unit]
  }`;

  return (
    <li className="flex items-baseline justify-between gap-3 px-3 py-2">
      <span className="min-w-0 flex-1">
        <span className="block truncate text-sm font-semibold text-foreground">{entrée.label}</span>
        <span className="text-xs text-muted-foreground">
          {quantité}
          {heure !== "" && ` · ${heure}`}
          {entrée.sourceType === "free" && " · saisi à la main"}
        </span>
      </span>
      <span className="flex-shrink-0 text-sm font-bold tabular-nums text-foreground">
        {formatIntegerFr(entryKcal(entrée))}
        {NBSP}kcal
      </span>
    </li>
  );
}
