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
import { creerValidateurEnSerie } from "@/lib/nutrition/validation-en-serie";
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
      // ⚠️ N1.7 — UN REPAS ENTIÈREMENT ÉCARTÉ N'A AUCUN ITEM ET EXISTE QUAND
      // MÊME. Sauter sur `items` seul le faisait disparaître de la carte des
      // compositions, donc réapparaître « à valider ».
      if (repas.items.length === 0 && repas.ignorees.length === 0) continue;
      const items: ChoixPersiste[] = repas.items.map((item) => ({
        slotId: item.choiceSlotId,
        catalogFoodId: item.catalogFoodId,
        productId: item.productId,
        quantity: item.quantity,
        unit: item.unit,
      }));
      carte.set(`${repas.mealId}|${repas.plannedOn}`, {
        items,
        consomme: repas.consomme,
        ignorees: repas.ignorees,
      });
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
          // COURSES — le rayon se déduit de ce code, hydraté à la lecture.
          codeCiqual: item.codeCiqual,
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

  /*
   * ════════════════════════════════════════════════════════════════════════
   * LE VERROU D'ÉCRITURE — DANS LE VALIDATEUR, PAS DANS UN ÉTAT REACT
   * ════════════════════════════════════════════════════════════════════════
   * ⚠️ `enCours` NE PROTÈGE RIEN CONTRE UN DOUBLE CLIC, ET C'ÉTAIT LA CAUSE
   * PRINCIPALE DES VALIDATIONS INTERMITTENTES.
   *
   * C'est un état React : il désactive le bouton AU RENDU SUIVANT. Entre le
   * premier clic et ce rendu, un second clic — ou le double événement qu'un
   * navigateur mobile émet parfois sur un appui — passait sans obstacle. Deux
   * validations de semaine partaient alors en parallèle : quarante-deux appels
   * RPC au lieu de vingt-et-un, le `finally` de la première réactivant le
   * bouton pendant que la seconde tournait encore, et deux relectures qui se
   * couraient. L'élève voyait tantôt ses repas validés, tantôt l'écran d'avant.
   *
   * Le verrou vit désormais dans `creerValidateurEnSerie` : une variable de
   * clôture, lue et écrite synchroniquement, donc visible du second appel dans
   * le même tour de boucle d'événements. `enCours` reste, mais pour ce qu'il
   * sait faire : désactiver le bouton et afficher « Validation… ».
   */

  /**
   * Relit la période et ATTEND la réponse.
   *
   * ⚠️ POURQUOI ATTENDRE, ALORS QUE `setRafraichissement` SUFFISAIT. Parce que
   * l'appelant avance d'écran sur le résultat de la validation : il doit
   * pouvoir le faire en sachant que ce qui est affiché vient de la BASE, et
   * non du rapport d'écriture. L'énoncé le dit : « après succès, l'état
   * affiché doit correspondre aux données réellement enregistrées ».
   */
  const relire = useCallback(async () => {
    await charger();
  }, [charger]);

  /**
   * Valide une semaine entière — repas par repas, SANS transaction globale.
   *
   * ⚠️ LA BOUCLE N'EST PLUS ÉCRITE ICI. Elle vit dans
   * `lib/nutrition/validation-en-serie.ts`, avec le verrou, l'ordre
   * relecture → déverrouillage, et le rapport. Tant qu'elle était dans ce
   * hook, aucun test Node ne pouvait la faire tourner : ni le double clic, ni
   * la réponse lente, ni l'erreur réseau, ni la nouvelle tentative — c'est-à-
   * dire précisément les cas où elle se trompait.
   *
   * Ce qui reste ici est ce qui appartient à React : l'état d'affichage.
   */
  /*
   * ⚠️ CONSTRUIT UNE SEULE FOIS, ET SANS AUCUNE DÉPENDANCE D'ÉCRAN. Il ne
   * porte que le verrou et la traduction des refus. Ce qui dépend de la
   * période affichée — écrire, relire — lui est passé AU MOMENT DU GESTE :
   * capturé ici, `relire` relirait la semaine d'il y a trois écrans.
   */
  const validateur = useMemo(
    () => creerValidateurEnSerie<RepasAValider>({ traduireErreur: messageDeRefus }),
    [],
  );

  /** Les dépendances effectives, reconstruites à chaque geste. */
  const dependances = useCallback(
    () => ({
      ecrire: async (entree: RepasAValider) => {
        const supabase = createSupabaseBrowserClient();
        if (!supabase) throw new Error("CONNEXION_INDISPONIBLE");
        await validerChoixRepas(
          supabase,
          entree.repas.mealId,
          entree.repas.date,
          identitesDeChoix(entree.repas.occurrences, entree.items),
        );
      },
      relire,
      surChangementDEtat: setEnCours,
    }),
    [relire],
  );

  const validerSemaine = useCallback<EtatListeDeCourses["validerSemaine"]>(
    async (entrees) => {
      setErreur(null);
      const rapport = await validateur.valider(
        entrees.map((entree) => ({
          cle: entree.repas.cle,
          libelle: entree.libelle,
          charge: entree,
        })),
        dependances(),
      );
      /*
       * ⚠️ L'ERREUR GLOBALE EST POSÉE QUAND RIEN N'EST PASSÉ. Le rapport
       * détaillé vit dans l'écran de proposition ; l'écran des repas, lui, ne
       * lit que `erreur`. Sans cette ligne, une semaine entièrement refusée ne
       * disait rien du tout sur cet écran-là.
       *
       * ⚠️ SAUF SI L'APPEL A ÉTÉ REFUSÉ POUR CAUSE D'ÉCRITURE EN COURS : rien
       * n'a été tenté, il n'y a donc rien à corriger ni à signaler comme une
       * panne.
       */
      if (!rapport.refuseCarEnCours && rapport.valides === 0 && rapport.echecs.length > 0) {
        setErreur(rapport.echecs[0]!.message);
      }
      return {
        valides: rapport.valides,
        echecs: rapport.echecs,
        complet: rapport.complet,
      };
    },
    [validateur, dependances],
  );

  /*
   * ⚠️ UN REPAS SEUL PASSE PAR LE MÊME VALIDATEUR, DONC PAR LE MÊME VERROU.
   *
   * Deux boutons, deux chemins, et jusqu'ici un seul drapeau d'état que le
   * premier `finally` éteignait pour tout le monde : valider un repas pendant
   * une validation de semaine était possible. Une série d'UN élément, c'est la
   * même garantie sans second mécanisme à maintenir.
   */
  const validerRepas = useCallback<EtatListeDeCourses["validerRepas"]>(
    async (repasCible, items) => {
      setErreur(null);
      const rapport = await validateur.valider(
        [
          {
            cle: repasCible.cle,
            libelle: repasCible.cle,
            charge: { repas: repasCible, libelle: repasCible.cle, items },
          },
        ],
        dependances(),
      );
      if (rapport.refuseCarEnCours) return false;
      if (rapport.echecs.length > 0) {
        // ⚠️ LE MOTIF DE LA BASE EST AFFICHÉ, PAS AVALÉ. `REPAS_DEJA_CONSOMME`
        // (verrou C0.1) doit se lire à l'écran : sans lui, l'élève réessaierait
        // indéfiniment un geste que la base refuse pour une bonne raison.
        setErreur(rapport.echecs[0]!.message);
        return false;
      }
      return rapport.valides === 1;
    },
    [validateur, dependances],
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
  /*
   * ⚠️ LA PANNE DE CONNEXION A SON PROPRE MESSAGE, ET IL DIT CE QUI RESTE.
   * Le message générique (« vérifie ta connexion ») laissait croire que les
   * choix pouvaient avoir été perdus. Ils ne le sont pas : rien n'a été
   * envoyé, la sélection est toujours à l'écran, et une nouvelle tentative
   * suffit. L'énoncé demande des erreurs clairement identifiées — celle-ci
   * est la plus fréquente.
   */
  if (texte.includes("CONNEXION_INDISPONIBLE")) {
    return "Connexion indisponible : rien n'a été envoyé. Tes choix sont conservés, réessaie.";
  }
  if (texte.includes("REPAS_DEJA_CONSOMME")) {
    return "Ce repas a déjà été enregistré comme consommé : sa composition ne peut plus être modifiée.";
  }
  if (texte.includes("IDENTITE_INVALIDE")) {
    return "Un aliment choisi n'appartient plus aux options de ce repas. Recharge la page puis réessaie.";
  }
  return "La validation a échoué. Réessaie, ou vérifie ta connexion.";
}
