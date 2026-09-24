import { dayKeyLocal } from "@/lib/calendar-grid";
import { currentDate } from "@/lib/clock";
import { semaineContenant } from "@/lib/nutrition/historique";

/**
 * LE RAPPEL « À JOUR / À VÉRIFIER » — UN PENSE-BÊTE DE COACH, RIEN D'AUTRE.
 *
 * ════════════════════════════════════════════════════════════════════════
 * CE QU'IL N'EST PAS
 * ════════════════════════════════════════════════════════════════════════
 * Il ne modifie NI le programme, NI ses séances, NI la progression de l'élève,
 * NI aucune notification. C'est une marque que le coach pose sur sa propre
 * liste de vérification, et dont la seule conséquence est la couleur d'une
 * pastille. Aucune décision produit n'en dépend — c'est précisément pourquoi
 * elle n'est pas stockée sur `programs` : une écriture là-bas toucherait
 * `updated_at`, que le builder utilise pour détecter les modifications
 * concurrentes.
 *
 * ════════════════════════════════════════════════════════════════════════
 * LE RETOUR À « À VÉRIFIER » EST DÉRIVÉ, PAS PLANIFIÉ
 * ════════════════════════════════════════════════════════════════════════
 * On stocke la SEMAINE validée, pas un booléen. L'état se recalcule alors à
 * chaque lecture :
 *
 *     à jour  ⟺  semaine validée === semaine d'aujourd'hui
 *
 * Aucune tâche planifiée, aucun cron, rien à réveiller le lundi matin : le
 * lundi suivant, la comparaison devient fausse toute seule. Un booléen
 * `verifie` aurait exigé un balayage hebdomadaire — donc un planificateur de
 * plus, qui peut tomber en panne et laisser un « À JOUR » mensonger en place.
 *
 * ⚠️ LA SEMAINE EST CELLE DU LUNDI, ET C'EST LA CONVENTION DÉJÀ EN PLACE.
 * `semaineContenant` (lib/nutrition/historique.ts) est réutilisée telle quelle
 * plutôt que réécrite : deux conventions de début de semaine dans la même
 * application produiraient deux découpages qui se recouvrent mal, et personne
 * ne verrait la différence avant un dimanche.
 */

export type EtatVerification = "a-jour" | "a-verifier";

export const LIBELLES_VERIFICATION: Readonly<Record<EtatVerification, string>> = {
  "a-jour": "À jour",
  "a-verifier": "À vérifier",
};

/**
 * La clé d'une semaine : la date ISO de son LUNDI.
 *
 * `null` si la date est illisible — on ne devine pas une semaine à partir de
 * rien, et un appelant qui reçoit `null` affichera « À vérifier », l'état qui
 * ne prétend rien.
 */
export function cleDeSemaine(iso: string): string | null {
  return semaineContenant(iso)?.debut ?? null;
}

/**
 * L'état affiché, dérivé de la semaine validée et de la date du jour.
 *
 * `verifieePourLaSemaine` est la clé stockée en base (`verified_week`), ou
 * `null` si le coach n'a jamais validé ce programme.
 */
export function etatDeVerification(entree: {
  readonly verifieePourLaSemaine: string | null;
  readonly aujourdhui: string;
}): EtatVerification {
  const semaineCourante = cleDeSemaine(entree.aujourdhui);
  if (semaineCourante === null || entree.verifieePourLaSemaine === null) return "a-verifier";
  /*
   * ⚠️ ÉGALITÉ STRICTE, JAMAIS « POSTÉRIEUR OU ÉGAL ». Une validation datée
   * d'une semaine FUTURE (horloge décalée, saisie manuelle en base) ne doit pas
   * rendre le programme « à jour » pendant des semaines. Seule la semaine
   * courante compte, et une clé qui n'est pas celle d'aujourd'hui est périmée —
   * qu'elle soit passée ou future.
   */
  return entree.verifieePourLaSemaine === semaineCourante ? "a-jour" : "a-verifier";
}

/**
 * La date du jour en clé locale « YYYY-MM-DD ».
 *
 * ⚠️ `reference` EST INJECTABLE, et c'est ce qui rend le reset hebdomadaire
 * testable sans attendre lundi. `dayKeyLocal` est réutilisé plutôt que
 * réécrit : c'est déjà la convention de `lib/booking.ts` et du calendrier.
 */
export function dateDuJour(reference: Date = currentDate()): string {
  return dayKeyLocal(reference);
}

/** `true` quand un clic du coach doit POSER la validation (et non la retirer). */
export function bascule(etat: EtatVerification): EtatVerification {
  return etat === "a-jour" ? "a-verifier" : "a-jour";
}
