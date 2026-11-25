/**
 * Tour de rôle des coachs HTS — fonctions PURES, utilisables côté navigateur
 * comme côté serveur. Le compteur lui-même vit dans `lib/contact-nfc/tour.ts`
 * (serveur uniquement).
 *
 * Le compteur est un entier qui ne fait que croître ; le coach dont c'est le
 * tour est `COACHS_HTS[compteur % nombre de coachs]`. Compteur 0 → Jules,
 * 1 → Yoann, 2 → Jules…
 */
import { COACHS_HTS, type CoachHts, type IdentifiantCoachHts } from "@/lib/contact-nfc/config";

export const NOMBRE_COACHS_HTS = COACHS_HTS.length;

/** Coach servi quand le tour est inconnu (compteur injoignable, page sans JavaScript). */
export const COACH_PAR_DEFAUT: CoachHts = COACHS_HTS[0];

/** Identifiants, dans l'ordre du tour — liste fermée pour la validation (`z.enum`). */
export const IDENTIFIANTS_COACHS_HTS = COACHS_HTS.map((coach) => coach.identifiant) as [
  IdentifiantCoachHts,
  ...IdentifiantCoachHts[],
];

export function estIdentifiantCoachHts(valeur: unknown): valeur is IdentifiantCoachHts {
  return typeof valeur === "string" && (IDENTIFIANTS_COACHS_HTS as string[]).includes(valeur);
}

export function coachParIdentifiant(identifiant: IdentifiantCoachHts): CoachHts {
  const coach = COACHS_HTS.find((candidat) => candidat.identifiant === identifiant);
  if (!coach) throw new Error(`Coach HTS inconnu : « ${identifiant} ».`);
  return coach;
}

/** Rang du coach dans le tour (0 pour Jules, 1 pour Yoann). */
export function rangDuCoach(identifiant: IdentifiantCoachHts): number {
  return COACHS_HTS.findIndex((coach) => coach.identifiant === identifiant);
}

/**
 * Coach dont c'est le tour pour une valeur du compteur.
 * ⚠️ Refuse tout ce qui n'est pas un entier positif ou nul : une valeur
 * corrompue ne doit pas désigner un coach au hasard.
 */
export function coachDuCompteur(compteur: number): CoachHts {
  if (!Number.isSafeInteger(compteur) || compteur < 0) {
    throw new Error(`Compteur de tour invalide : ${compteur}.`);
  }
  return COACHS_HTS[compteur % NOMBRE_COACHS_HTS];
}

/** Coach qui suit `identifiant` dans le tour (après Yoann, on revient à Jules). */
export function coachSuivant(identifiant: IdentifiantCoachHts): CoachHts {
  return COACHS_HTS[(rangDuCoach(identifiant) + 1) % NOMBRE_COACHS_HTS];
}
