"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";

import {
  agregerListeDeCourses,
  type ItemPourAgregation,
  type LigneDeCourses,
} from "@/lib/nutrition/liste-de-courses";
import type { ChoixPersiste } from "@/lib/nutrition/meal-choice-selection";
import type { PeriodeCourses } from "@/lib/nutrition/periode-courses";
import type { PlanV2Week } from "@/lib/nutrition/plan-v2-week";
import {
  couleursParOccurrence,
  identitesDeChoix,
  repasAComposer,
  repasDeLaPeriode,
  type CompositionConnue,
  type RepasDeLaPeriode,
} from "@/lib/nutrition/repas-de-la-periode";
import { createSupabaseBrowserClient } from "@/lib/supabase/browser";
import { validerChoixRepas } from "@/lib/supabase/consumed-meals";
import { lireRepasPlanifiesSurPeriode, type RepasPlanifie } from "@/lib/supabase/repas-planifies";

/**
 * COURSES C1 — L'ORCHESTRATION : LIRE, CROISER, AGRÉGER.
 *
 * ⚠️ UNE SEULE ÉCRITURE POSSIBLE DEPUIS CE HOOK, ET C'EST CELLE DE C0 :
 * `validerChoixRepas` → `enregistrer_repas_planifie`. Aucune table de liste de
 * courses n'est écrite, aucun état de cochage n'est persisté, aucune migration
 * n'accompagne ce lot. C1 est `SELECT → hydrate → aggregate → render`, plus le
 * geste C0 déjà existant pour compléter un repas manquant sans quitter l'écran.
 *
 * ⚠️ LA LISTE NE SE CALCULE QUE SUR LE PLANIFIÉ. `lignes` dérive
 * exclusivement de `planned_meal_items` : un repas non validé n'y contribue
 * rien, pas même une estimation.
 */

/** Le sort d'UN repas dans une validation de semaine. */
export interface EchecDeRepas {
  readonly cle: string;
  /** « Lundi 17 août · Petit déjeuner » — de quoi retrouver le repas. */
  readonly libelle: string;
  readonly message: string;
}

/**
 * COURSES C1.1 — LE RÉSULTAT D'UNE VALIDATION DE SEMAINE.
 *
 * ⚠️ IL N'EXISTE AUCUNE TRANSACTION ENTRE REPAS, ET ON NE FAIT PAS SEMBLANT.
 * Chaque repas est validé par SON appel à `enregistrer_repas_planifie`, qui
 * est atomique POUR CE REPAS et pour lui seul. Vingt et un repas, ce sont
 * vingt et un allers-retours indépendants : si le douzième échoue, les onze
 * premiers restent écrits. Inventer une transaction côté client — annuler les
 * onze premiers, par exemple — serait une fausse atomicité qui échouerait à
 * son tour au premier réseau coupé.
 *
 * On ne la simule donc pas : on RAPPORTE exactement ce qui s'est passé.
 */
export interface ResultatValidationSemaine {
  readonly valides: number;
  readonly echecs: readonly EchecDeRepas[];
  /** `true` si et seulement si TOUT est passé. Jamais un faux succès. */
  readonly complet: boolean;
}

export interface RepasAValider {
  readonly repas: RepasDeLaPeriode;
  readonly libelle: string;
  readonly items: readonly ItemDeValidation[];
}

interface ItemDeValidation {
  readonly slotId: string;
  readonly optionId: string;
  readonly quantity: number;
  readonly unit: "g" | "ml";
}

export interface EtatListeDeCourses {
  readonly chargement: boolean;
  /** `false` si une lecture a échoué. « Rien lu » n'est PAS « rien de prévu ». */
  readonly ok: boolean;
  readonly repas: readonly RepasDeLaPeriode[];
  readonly aComposer: readonly RepasDeLaPeriode[];
  readonly lignes: readonly LigneDeCourses[];
  readonly enCours: boolean;
  readonly erreur: string | null;
  readonly recharger: () => void;
  readonly validerRepas: (
    repas: RepasDeLaPeriode,
    items: readonly ItemDeValidation[],
  ) => Promise<boolean>;
  /** COURSES C1.1 — valide plusieurs repas, un par un, et dit ce qui a marché. */
  readonly validerSemaine: (entrees: readonly RepasAValider[]) => Promise<ResultatValidationSemaine>;
}

export function useListeDeCourses(
  week: PlanV2Week | null,
  periode: PeriodeCourses | null,
  actif: boolean,
): EtatListeDeCourses {
  const [planifies, setPlanifies] = useState<readonly RepasPlanifie[]>([]);
  const [ok, setOk] = useState(true);
  const [chargement, setChargement] = useState(false);
  const [enCours, setEnCours] = useState(false);
  const [erreur, setErreur] = useState<string | null>(null);
  const [rafraichissement, setRafraichissement] = useState(0);

  const debut = periode?.debut ?? "";
  const fin = periode?.fin ?? "";

  // ⚠️ MÊME FORME QUE `useConsumedMeals` : le corps de l'effet n'appelle QUE
  // `charger`, et tout l'état se pose à l'intérieur, après l'attente. Un
  // `setState` synchrone dans un effet déclenche des rendus en cascade.
  //
  // Le compteur de requête écarte les réponses périmées : changer 7 jours → 2
  // pendant qu'une lecture est en vol ne doit pas laisser la longue réponse
  // écraser la courte.
  const requete = useRef(0);

  const charger = useCallback(async () => {
    const numero = ++requete.current;
    if (!actif || debut === "" || fin === "") {
      setPlanifies([]);
      setChargement(false);
      return;
    }
    const supabase = createSupabaseBrowserClient();
    if (!supabase) {
      setOk(false);
      setChargement(false);
      return;
    }
    setChargement(true);
    const lecture = await lireRepasPlanifiesSurPeriode(supabase, debut, fin);
    if (numero !== requete.current) return;
    setOk(lecture.ok);
    setPlanifies(lecture.repas);
    setChargement(false);
  }, [actif, debut, fin]);

  useEffect(() => {
    let annule = false;
    async function lire() {
      if (annule) return;
      await charger();
    }
    void lire();
    return () => {
      annule = true;
    };
  }, [charger, rafraichissement]);

  /** `${mealId}|${date}` → composition connue. La même clé que C0. */
  const compositions = useMemo(() => {
    const carte = new Map<string, CompositionConnue>();
    for (const repas of planifies) {
      if (repas.items.length === 0) continue;
      const items: ChoixPersiste[] = repas.items.map((item) => ({
        slotId: item.choiceSlotId,
        catalogFoodId: item.catalogFoodId,
        productId: item.productId,
        quantity: item.quantity,
        unit: item.unit,
      }));
      carte.set(`${repas.mealId}|${repas.plannedOn}`, { items, consomme: repas.consomme });
    }
    return carte;
  }, [planifies]);

  const repas = useMemo(
    () => repasDeLaPeriode(week, periode, compositions),
    [week, periode, compositions],
  );

  const aComposer = useMemo(() => repasAComposer(repas), [repas]);

  const lignes = useMemo(() => {
    const couleurs = couleursParOccurrence(week);
    // ⚠️ ON N'AGRÈGE QUE LES REPAS DE LA PÉRIODE COURANTE. Un `planned_meal`
    // lu hors bornes ne peut pas exister (la requête est bornée), mais un
    // repas d'un AUTRE plan tomberait sinon dans la liste : on ne garde que
    // les clés que le croisement plan × période a produites.
    const clesRetenues = new Set(repas.map((r) => r.cle));
    const items: ItemPourAgregation[] = [];
    for (const repasPlanifie of planifies) {
      if (!clesRetenues.has(`${repasPlanifie.mealId}|${repasPlanifie.plannedOn}`)) continue;
      for (const item of repasPlanifie.items) {
        items.push({
          identityType: item.identityType,
          identityId: item.identityId,
          quantity: item.quantity,
          unit: item.unit,
          displayName: item.displayName,
          colorKey: couleurs.get(item.choiceSlotId) ?? null,
          plannedOn: item.plannedOn,
          mealId: item.mealId,
          plannedMealId: item.plannedMealId,
          choiceSlotId: item.choiceSlotId,
        });
      }
    }
    return agregerListeDeCourses(items);
  }, [planifies, repas, week]);

  const recharger = useCallback(() => setRafraichissement((n) => n + 1), []);

  const validerRepas = useCallback<EtatListeDeCourses["validerRepas"]>(
    async (repasCible, items) => {
      const supabase = createSupabaseBrowserClient();
      if (!supabase) return false;
      setEnCours(true);
      setErreur(null);
      try {
        await validerChoixRepas(
          supabase,
          repasCible.mealId,
          repasCible.date,
          identitesDeChoix(repasCible.occurrences, items),
        );
        setRafraichissement((n) => n + 1);
        return true;
      } catch (e) {
        // ⚠️ LE MOTIF DE LA BASE EST AFFICHÉ, PAS AVALÉ. `REPAS_DEJA_CONSOMME`
        // (verrou C0.1) doit se lire à l'écran : sans lui, l'élève réessaierait
        // indéfiniment un geste que la base refuse pour une bonne raison.
        setErreur(messageDeRefus(e));
        return false;
      } finally {
        setEnCours(false);
      }
    },
    [],
  );

  /**
   * Valide une semaine entière — repas par repas, SANS transaction globale.
   *
   * ⚠️ AUCUN REPAS N'EST LAISSÉ « NON TENTÉ ». Un échec au douzième n'arrête
   * pas les neuf suivants : l'élève doit savoir en UNE fois ce qui reste à
   * corriger, plutôt que de relancer et de découvrir un nouvel échec à chaque
   * tour.
   *
   * ⚠️ UNE SEULE RELECTURE, À LA FIN. Recharger après chaque repas ferait
   * vingt et une lectures inutiles et ferait clignoter l'écran.
   */
  const validerSemaine = useCallback<EtatListeDeCourses["validerSemaine"]>(
    async (entrees) => {
      const supabase = createSupabaseBrowserClient();
      if (!supabase) {
        return {
          valides: 0,
          complet: false,
          echecs: entrees.map((e) => ({
            cle: e.repas.cle,
            libelle: e.libelle,
            message: "Connexion indisponible.",
          })),
        };
      }
      setEnCours(true);
      setErreur(null);
      const echecs: EchecDeRepas[] = [];
      let valides = 0;
      try {
        for (const entree of entrees) {
          try {
            await validerChoixRepas(
              supabase,
              entree.repas.mealId,
              entree.repas.date,
              identitesDeChoix(entree.repas.occurrences, entree.items),
            );
            valides += 1;
          } catch (e) {
            echecs.push({
              cle: entree.repas.cle,
              libelle: entree.libelle,
              message: messageDeRefus(e),
            });
          }
        }
      } finally {
        setEnCours(false);
        setRafraichissement((n) => n + 1);
      }
      return { valides, echecs, complet: echecs.length === 0 && entrees.length > 0 };
    },
    [],
  );

  return {
    chargement,
    ok,
    repas,
    aComposer,
    lignes,
    enCours,
    erreur,
    recharger,
    validerRepas,
    validerSemaine,
  };
}

/** Traduit les refus connus de la RPC. Fonction PURE, testable sans Supabase. */
export function messageDeRefus(erreur: unknown): string {
  const texte = erreur instanceof Error ? erreur.message : String(erreur ?? "");
  if (texte.includes("REPAS_DEJA_CONSOMME")) {
    return "Ce repas a déjà été enregistré comme consommé : sa composition ne peut plus être modifiée.";
  }
  if (texte.includes("IDENTITE_INVALIDE")) {
    return "Un aliment choisi n'appartient plus aux options de ce repas. Recharge la page puis réessaie.";
  }
  return "La validation a échoué. Réessaie, ou vérifie ta connexion.";
}
