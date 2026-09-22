/**
 * LA PROGRESSION AUTOMATIQUE — fonctions PURES.
 *
 * ════════════════════════════════════════════════════════════════════════
 * CE QUE CE MODULE DÉCIDE, ET CE QU'IL REFUSE DE DEVINER
 * ════════════════════════════════════════════════════════════════════════
 * Il prend une RÉFÉRENCE (charge constante + moyenne arrondie des
 * répétitions, voir `lib/reference-progression.ts`), une PLAGE prescrite et un
 * GROUPE MUSCULAIRE, et il rend la prochaine cible — ou un refus NOMMÉ.
 *
 * ⚠️ UN REFUS N'EST PAS UNE PANNE. Chaque situation non tranchée par une
 * règle produit rend `{ ok: false, motif }` plutôt qu'une valeur inventée.
 * L'écran n'affiche alors aucune recommandation, ce qui est exactement le
 * comportement voulu : mieux vaut pas de conseil qu'un mauvais conseil.
 *
 * ════════════════════════════════════════════════════════════════════════
 * LES QUATRE CAS, TELS QU'ÉNONCÉS
 * ════════════════════════════════════════════════════════════════════════
 * Plage 8–13, moyenne arrondie de la séance de référence :
 *
 *   · DANS LA PLAGE (8 ≤ moyenne < 13)  → même charge, +1 répétition.
 *       10 kg × 10  →  10 kg × 11
 *   · BORNE HAUTE ATTEINTE (moyenne = 13) → charge augmentée, retour borne basse.
 *       10 kg × 13  →  12,5 kg × 8   (grand groupe)
 *   · AU-DESSUS DE LA BORNE (moyenne > 13) → IDENTIQUE au cas précédent.
 *       10 kg × 14  →  12,5 kg × 8
 *       10 kg × 18  →  12,5 kg × 8   ← le dépassement ne change RIEN
 *   · SOUS LA BORNE BASSE (moyenne < 8) → charge − 1 kg, retour borne basse.
 *       10 kg × 5 (plage 6–10)  →  9 kg × 6
 *
 * ⚠️ LA BAISSE EST DE 1 kg POUR TOUS LES GROUPES, sans exception. C'est une
 * règle universelle, et elle ne se dérive pas de l'incrément de montée.
 *
 * ════════════════════════════════════════════════════════════════════════
 * LES INCRÉMENTS, ET LES TROIS GROUPES QUI N'EN ONT PAS
 * ════════════════════════════════════════════════════════════════════════
 * `MuscleGroup` (types/index.ts) compte QUINZE valeurs. La règle produit en
 * couvre douze — ce sont exactement les douze présentes en production :
 *
 *   +2,5 kg  dos · quadriceps · ischios · fessiers          1 456 exercices
 *   +2 kg    pectoraux                                        401 exercices
 *   +1 kg    biceps · mollets · triceps · épaules ·
 *            abdos · lombaires · autre                      1 344 exercices
 *
 * ⚠️ `avant-bras`, `cardio` ET `full-body` N'ONT AUCUN INCRÉMENT DÉFINI. Ils
 * sont absents des données actuelles mais le type les autorise. Leur donner
 * un incrément « au jugé » serait inventer une règle métier : ils rendent
 * donc `groupe-non-tarife`, et aucune recommandation n'est affichée. À
 * trancher avec le coach avant qu'un exercice ne les utilise.
 */
import type { MuscleGroup } from "@/types";

import type { PlageReps } from "@/lib/reference-progression";

/** Incrément de charge à la montée, en kg, par groupe musculaire. */
const INCREMENT_PAR_GROUPE: Partial<Record<MuscleGroup, number>> = {
  // Groupes principaux.
  dos: 2.5,
  quadriceps: 2.5,
  ischios: 2.5,
  fessiers: 2.5,
  // Pectoraux : leur propre palier.
  pectoraux: 2,
  // Petits groupes.
  biceps: 1,
  mollets: 1,
  triceps: 1,
  "épaules": 1,
  abdos: 1,
  lombaires: 1,
  autre: 1,
  // avant-bras, cardio, full-body : VOLONTAIREMENT ABSENTS. Voir l'en-tête.
};

/** Baisse appliquée sous la borne basse — la même pour tous les groupes. */
export const BAISSE_KG = 1;

/**
 * Plancher de charge, en kg.
 *
 * ⚠️ LA BAISSE S'APPLIQUE MÊME SUR UNE CHARGE BASSE (règle posée), mais elle
 * ne peut pas franchir ce plancher : recommander 0 kg ou une charge négative
 * ne serait plus un conseil, ce serait un bug affiché à l'élève.
 */
export const PLANCHER_KG = 0.5;

export type MotifSansRecommandation =
  /** L'exercice a la progression automatique désactivée (bouton OFF). */
  | "progression-desactivee"
  /** Le groupe musculaire n'a pas d'incrément défini par la règle produit. */
  | "groupe-non-tarife"
  /** Aucune référence exploitable (pas d'occurrence N-1, charge variable…). */
  | "aucune-reference";

/** Pourquoi la prochaine cible a été calculée ainsi — utile à l'affichage et aux tests. */
export type MotifRecommandation =
  /** Dans la plage : même charge, une répétition de plus. */
  | "dans-la-plage"
  /** Borne haute atteinte : charge augmentée, retour borne basse. */
  | "borne-haute-atteinte"
  /** Au-dessus de la borne haute : même traitement que la borne atteinte. */
  | "au-dessus-de-la-borne"
  /** Sous la borne basse : charge baissée de 1 kg, retour borne basse. */
  | "sous-la-borne-basse";

export interface Recommandation {
  readonly chargeKg: number;
  readonly reps: number;
  readonly motif: MotifRecommandation;
  /** `true` quand la charge recommandée diffère de la charge de référence. */
  readonly chargeModifiee: boolean;
}

export type RecommandationLue =
  | { readonly ok: true; readonly recommandation: Recommandation }
  | { readonly ok: false; readonly motif: MotifSansRecommandation };

/**
 * Charge normalisée à UNE décimale.
 *
 * ⚠️ AUCUN ARRONDI AU PAS DE MATÉRIEL (règle posée) : 12 + 2,5 rend 14,5 et
 * non 15. La seule normalisation est la décimale, pour qu'une addition
 * flottante ne produise pas « 14,499999999999998 ».
 */
export function normaliserChargeKg(kg: number): number {
  return Math.round(kg * 10) / 10;
}

/** L'incrément de montée d'un groupe, ou `null` si la règle ne le couvre pas. */
export function incrementDeMontee(groupe: MuscleGroup): number | null {
  return INCREMENT_PAR_GROUPE[groupe] ?? null;
}

export interface EntreeRecommandation {
  /** Bouton ON/OFF de l'exercice. `false` → aucune recommandation, sans calcul. */
  readonly progressionActive: boolean;
  readonly groupe: MuscleGroup;
  readonly plage: PlageReps;
  /** Référence issue de l'occurrence N-1 : charge constante + moyenne arrondie. */
  readonly reference: { readonly chargeKg: number; readonly reps: number } | null;
}

/**
 * La prochaine cible pour un exercice, d'après la séance de référence.
 *
 * L'ordre des gardes n'est pas cosmétique : le bouton OFF court-circuite tout
 * le reste, y compris la recherche d'un incrément, pour qu'un exercice
 * désactivé ne puisse jamais produire de trace de calcul.
 */
export function recommanderProchaineCible(entree: EntreeRecommandation): RecommandationLue {
  if (!entree.progressionActive) return { ok: false, motif: "progression-desactivee" };
  if (!entree.reference) return { ok: false, motif: "aucune-reference" };

  const increment = incrementDeMontee(entree.groupe);
  if (increment === null) return { ok: false, motif: "groupe-non-tarife" };

  const { chargeKg, reps } = entree.reference;
  const { min, max } = entree.plage;

  // SOUS LA BORNE BASSE — baisse universelle de 1 kg, plancher compris.
  if (reps < min) {
    const baissee = normaliserChargeKg(Math.max(PLANCHER_KG, chargeKg - BAISSE_KG));
    return {
      ok: true,
      recommandation: {
        chargeKg: baissee,
        reps: min,
        motif: "sous-la-borne-basse",
        chargeModifiee: baissee !== normaliserChargeKg(chargeKg),
      },
    };
  }

  // BORNE HAUTE ATTEINTE OU DÉPASSÉE — même traitement, le dépassement ne
  // change pas l'incrément (« 10 kg × 14 » et « 10 kg × 18 » donnent la même
  // recommandation).
  if (reps >= max) {
    return {
      ok: true,
      recommandation: {
        chargeKg: normaliserChargeKg(chargeKg + increment),
        reps: min,
        motif: reps === max ? "borne-haute-atteinte" : "au-dessus-de-la-borne",
        chargeModifiee: true,
      },
    };
  }

  // DANS LA PLAGE — même charge, une répétition de plus.
  return {
    ok: true,
    recommandation: {
      chargeKg: normaliserChargeKg(chargeKg),
      reps: reps + 1,
      motif: "dans-la-plage",
      chargeModifiee: false,
    },
  };
}

/* ─── Première performance, sans historique ─── */

export interface EntreePremiereSerie {
  readonly progressionActive: boolean;
  readonly groupe: MuscleGroup;
  readonly plage: PlageReps;
  /** Charge de la série que l'élève vient de saisir, en kg. */
  readonly chargeKg: number;
  /** Répétitions de cette même série. */
  readonly reps: number;
}

/**
 * Conseil de charge quand il n'existe AUCUN historique et que la première
 * série DÉPASSE la borne haute.
 *
 * ⚠️ STRICTEMENT AU-DESSUS DE LA BORNE. C'est la seule situation pour
 * laquelle une règle a été posée en l'absence d'historique. Atteindre
 * exactement la borne haute sur une première série ne déclenche RIEN : aucune
 * règle ne le prévoit, et l'inventer reviendrait à décider à la place du
 * coach.
 *
 * Le dépassement ne change pas l'incrément : 15 répétitions ou 18 sur une
 * plage 8–13 donnent la même charge conseillée.
 */
export function conseilPremiereSerie(entree: EntreePremiereSerie): RecommandationLue {
  if (!entree.progressionActive) return { ok: false, motif: "progression-desactivee" };
  if (entree.reps <= entree.plage.max) return { ok: false, motif: "aucune-reference" };

  const increment = incrementDeMontee(entree.groupe);
  if (increment === null) return { ok: false, motif: "groupe-non-tarife" };

  return {
    ok: true,
    recommandation: {
      chargeKg: normaliserChargeKg(entree.chargeKg + increment),
      reps: entree.plage.min,
      motif: "au-dessus-de-la-borne",
      chargeModifiee: true,
    },
  };
}
