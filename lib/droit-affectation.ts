/**
 * LE DROIT D'ÉCRIRE SUR L'ENTRAÎNEMENT, VU DE L'INTERFACE.
 *
 * ════════════════════════════════════════════════════════════════════════
 * CE QUE CE MODULE N'EST PAS
 * ════════════════════════════════════════════════════════════════════════
 * Ce n'est PAS une garde de sécurité. L'autorité reste entière côté serveur :
 * la RLS, `lib/api/authz.ts`, et la garde de `provision_program_copy`
 * (migration 20261011130000) refusent indépendamment de ce que cette
 * fonction rend. Un collaborateur qui contournerait l'interface — console,
 * requête forgée, état React modifié — est refusé en base exactement comme
 * avant, et la suite `affectation-refus-autorisation` le mesure.
 *
 * Ce module ne sert qu'à ÉVITER UNE IMPASSE : jusqu'ici, un collaborateur en
 * `entrainement / lecture` voyait « Assigner », cochait des élèves, cliquait
 * « Terminer », et ne découvrait le refus qu'à ce moment. Le refus était
 * correct ; le parcours était inutilement cruel.
 *
 * ════════════════════════════════════════════════════════════════════════
 * LE DOUTE PROFITE À L'ACTION, PAS AU VERROU
 * ════════════════════════════════════════════════════════════════════════
 * ⚠️ C'EST L'INVERSE DU FAIL-CLOSED, ET C'EST VOLONTAIRE. Une garde de
 * sécurité doit refuser quand elle ne sait pas. Un indice d'interface, non :
 * griser « Assigner » parce qu'une RPC a mis trop longtemps à répondre, ou
 * parce que les migrations P13-B ne sont pas encore appliquées sur cet
 * environnement, bloquerait un coach parfaitement autorisé sans rien
 * protéger — la base, elle, l'aurait laissé passer.
 *
 * On ne grise donc QUE sur un signal POSITIF : le rôle est lu, il vaut
 * `collaborateur`, l'ensemble des catégories en écriture est lu, et
 * `entrainement` n'y figure pas. Tout le reste — chargement en cours, rôle
 * inconnu, mécanisme absent — rend `"inconnue"`, soit le comportement
 * d'avant ce lot, à l'identique. C'est aussi le contrat documenté de
 * `useStaffContext` : `null` signifie « inconnu », jamais « refusé ».
 */

import type { CategorieDroit, CoachRole } from "@/types";

export type DroitEcritureProgrammes =
  /** L'écriture est acquise — ou rien ne permet d'affirmer le contraire. */
  | "autorisee"
  /**
   * Mesuré : cet appelant est collaborateur et n'a PAS `entrainement` en
   * écriture. Assigner un programme échouera à coup sûr côté serveur.
   */
  | "lecture_seule"
  /** Pas de signal exploitable. L'interface se comporte comme avant P13-B. */
  | "inconnue";

export interface ContexteDroitAffectation {
  /** Lecture des droits encore en cours. */
  readonly chargement: boolean;
  /** `profiles.role === "admin"` — jamais contraint par une catégorie. */
  readonly estAdmin: boolean;
  /** `coaches.role`, ou `null` si inconnu. */
  readonly role: CoachRole | null;
  /** `public.categories_ecriture()` — les quatre catégories pour un admin ou un assistant. */
  readonly categoriesEcriture: readonly CategorieDroit[];
  /** Les fonctions du modèle P13-B sont introuvables (migrations non appliquées). */
  readonly mecanismeIndisponible: boolean;
}

/**
 * Peut-on proposer d'assigner un PROGRAMME ?
 *
 * L'ordre des tests est le raisonnement :
 *   1. rien n'est encore su → on ne grise pas (pas de clignotement, pas de
 *      blocage d'un coach autorisé pendant la lecture) ;
 *   2. le mécanisme n'existe pas sur cet environnement → comportement d'avant ;
 *   3. l'administrateur réel passe toujours ;
 *   4. le rôle n'est pas lu → inconnu, donc on ne grise pas ;
 *   5. `admin` / `assistant` → autorisés (la fonction SQL leur rend les
 *      quatre catégories ; on ne redéduit pas ici une règle métier) ;
 *   6. `collaborateur` → c'est le SEUL cas où l'on grise, et seulement si
 *      `entrainement` est absent de ses catégories en écriture.
 */
export function droitEcritureProgrammes(contexte: ContexteDroitAffectation): DroitEcritureProgrammes {
  if (contexte.chargement) return "inconnue";
  if (contexte.mecanismeIndisponible) return "inconnue";
  if (contexte.estAdmin) return "autorisee";
  if (contexte.role === null) return "inconnue";
  if (contexte.role === "admin" || contexte.role === "assistant") return "autorisee";
  return contexte.categoriesEcriture.includes("entrainement") ? "autorisee" : "lecture_seule";
}

/**
 * Le message affiché quand l'action est grisée — source unique, deux modales.
 *
 * Il nomme la permission qui manque (`entraînement`, niveau écriture) et à
 * qui la demander. Il ne nomme ni élève, ni programme, ni code d'erreur :
 * voir `lib/assignment-refus.ts`, même règle.
 */
export const MESSAGE_LECTURE_SEULE_PROGRAMMES =
  "Accès en lecture seule sur l'entraînement : l'écriture est nécessaire pour assigner un programme. " +
  "Demande cette permission à un administrateur.";
