"use client";

import { useEffect, useMemo, useState } from "react";

import { useHistoriqueEleve } from "@/hooks/useHistoriqueEleve";
import { useSupabaseNutritionWeek } from "@/hooks/useSupabaseNutritionWeek";
import { getCurrentWeekDates, type DailyNutritionLog, type NutritionDailyTarget } from "@/lib/nutrition-weekly";
import { journeeRemplie, journeesDuJournal } from "@/lib/nutrition/statut-journee";
import { createSupabaseBrowserClient } from "@/lib/supabase/browser";
import { getLatestNutritionLog } from "@/lib/supabase/nutrition-logs";
import { Loader } from "@/components/ui/Loader";

interface NutritionWeekSummaryCardProps {
  studentId: string;
  planId: string;
  target: NutritionDailyTarget;
}

function formatKcal(value: number): string {
  return Math.round(value).toLocaleString("fr-FR");
}

/**
 * RÉSUMÉ LECTURE SEULE DU SUIVI NUTRITION HEBDOMADAIRE — /admin/eleves/[studentId].
 *
 * ════════════════════════════════════════════════════════════════════════
 * DEUX SOURCES, ET CHACUNE RÉPOND À UNE QUESTION DIFFÉRENTE (P7)
 * ════════════════════════════════════════════════════════════════════════
 * · CE QUI ÉTAIT PRESCRIT — `useSupabaseNutritionWeek`, qui compose les sept
 *   objectifs du plan (`NutritionDailyTarget.perDay`) en un objectif
 *   hebdomadaire. C'est le calcul pur de `lib/nutrition-weekly.ts`, inchangé.
 * · CE QUI A ÉTÉ MANGÉ — le JOURNAL (`consumed_meals` / `meal_entries`), lu
 *   par `useHistoriqueEleve` et dérivé par `journeesDuJournal`.
 *
 * ⚠️ POURQUOI LE CONSOMMÉ A CHANGÉ DE SOURCE. Il venait de
 * `adjustment.calories.consumed`, c'est-à-dire de `nutrition_daily_logs` —
 * 9 lignes en production, dernière écriture le 22/08/2026, plus aucun chemin
 * d'écriture. La carte annonçait donc « 0 kcal · 0 / 7 jours » à des élèves
 * ayant déclaré leurs repas la veille. L'objectif, lui, n'a jamais dépendu de
 * cette table : il reste là où il était.
 *
 * ⚠️ LA MÊME DÉRIVATION QUE L'ÉLÈVE, PAS UNE SECONDE. `journeesDuJournal` est
 * le module que lit aussi `lib/supabase/progress.ts`, donc l'écran de
 * progression de l'élève. Deux additions séparées finiraient par afficher
 * deux chiffres pour la même semaine, et c'est le coach qui découvrirait
 * l'écart devant son athlète.
 *
 * ⚠️ LECTURE SEULE PAR CONSTRUCTION. `useHistoriqueEleve` n'expose aucune
 * fonction d'écriture, et la base refuserait de toute façon : l'écriture
 * directe sur `consumed_meals` / `meal_entries` a été retirée au rôle
 * `authenticated` (migration 20260901090000).
 */
export function NutritionWeekSummaryCard({ studentId, planId, target }: NutritionWeekSummaryCardProps) {
  const { loading, adjustment } = useSupabaseNutritionWeek(studentId, planId, target);
  const semaine = useMemo(() => getCurrentWeekDates(), []);
  const journal = useHistoriqueEleve(studentId, semaine, true);
  const journees = useMemo(
    () => journeesDuJournal(journal.meals, semaine),
    [journal.meals, semaine],
  );

  /*
   * L'HISTORIQUE D'AVANT LE JOURNAL. Conservé — et affiché seulement en
   * dernier recours : une fiche dont la semaine courante est vide mais qui
   * porte un log d'août doit continuer à le dire, sinon le coach croit que
   * l'élève n'a jamais rien rempli.
   */
  const [latestLog, setLatestLog] = useState<DailyNutritionLog | null>(null);
  const [latestLoaded, setLatestLoaded] = useState(false);

  useEffect(() => {
    let cancelled = false;
    async function load() {
      const supabase = createSupabaseBrowserClient();
      if (!supabase) {
        if (!cancelled) setLatestLoaded(true);
        return;
      }
      const log = await getLatestNutritionLog(supabase, studentId);
      if (!cancelled) {
        setLatestLog(log);
        setLatestLoaded(true);
      }
    }
    void load();
    return () => {
      cancelled = true;
    };
  }, [studentId]);

  /*
   * ⚠️ AUCUN CHIFFRE AVANT QUE LES DEUX LECTURES AIENT RÉPONDU. Rendre la
   * grille pendant le chargement du journal afficherait « 0 kcal · 0 / 7 »,
   * que le coach lirait comme une semaine vide — exactement le défaut que ce
   * lot corrige, reproduit pendant une seconde.
   */
  if (loading || journal.loading || !adjustment) {
    return <Loader libelle="Chargement…" variante="ligne" />;
  }

  const { calories } = adjustment;
  const joursRemplis = journees.filter(journeeRemplie).length;
  const consomme = journees.reduce((total, journee) => total + journee.totaux.kcal, 0);
  // L'écart se mesure contre ce qui était prescrit SUR LES JOURS RENSEIGNÉS,
  // jamais sur sept : une semaine remplie à moitié n'est pas en déficit.
  const varianceSoFar = consomme - target.calories * joursRemplis;
  const derniereDuJournal = journees.filter(journeeRemplie).at(-1)?.date ?? null;

  return (
    <div className="flex flex-col gap-4">
      <div className="grid grid-cols-2 gap-4">
        <div>
          <span className="block text-xs uppercase tracking-wide text-muted-foreground">Objectif semaine</span>
          <span className="font-heading text-lg font-bold text-foreground">{formatKcal(calories.weeklyTarget)} kcal</span>
        </div>
        <div>
          <span className="block text-xs uppercase tracking-wide text-muted-foreground">Consommé cette semaine</span>
          <span className="font-heading text-lg font-bold text-foreground">{formatKcal(consomme)} kcal</span>
        </div>
        <div>
          <span className="block text-xs uppercase tracking-wide text-muted-foreground">Écart</span>
          <span className={`font-heading text-lg font-bold ${varianceSoFar > 0 ? "text-warning" : varianceSoFar < 0 ? "text-primary" : "text-foreground"}`}>
            {varianceSoFar > 0 ? "+" : ""}
            {formatKcal(varianceSoFar)} kcal
          </span>
        </div>
        <div>
          <span className="block text-xs uppercase tracking-wide text-muted-foreground">Jours remplis</span>
          <span className="font-heading text-lg font-bold text-foreground">{joursRemplis} / 7</span>
        </div>
      </div>

      {/* Une lecture en échec se DIT. Zéro kcal et « le serveur n'a pas
          répondu » ne veulent pas dire la même chose. */}
      {journal.error && (
        <p className="text-xs text-destructive" role="alert">
          {journal.error}
        </p>
      )}

      <div className="border-t border-border pt-3">
        <span className="block text-xs uppercase tracking-wide text-muted-foreground">
          Dernière journée renseignée
        </span>
        {derniereDuJournal ? (
          <span className="text-sm text-foreground">
            {new Date(derniereDuJournal).toLocaleDateString("fr-FR")} ·{" "}
            {formatKcal(journees.find((j) => j.date === derniereDuJournal)?.totaux.kcal ?? 0)} kcal
          </span>
        ) : !latestLoaded ? (
          <Loader libelle="Chargement…" variante="ligne" />
        ) : latestLog ? (
          <span className="text-sm text-foreground">
            {new Date(latestLog.logDate).toLocaleDateString("fr-FR")} · {latestLog.calories ?? "—"} kcal
          </span>
        ) : (
          <span className="text-sm text-muted-foreground">Aucune journée renseignée.</span>
        )}
      </div>
    </div>
  );
}
