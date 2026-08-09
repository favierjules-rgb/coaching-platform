import type {
  AdminStudentFeedback,
  ExerciseSubstituteOption,
  WorkoutSession,
} from "@/types";

import type { TypeAcces } from "@/lib/offline/schema";
import { dateMetier } from "@/lib/offline/seance-du-jour";

/**
 * HORS LIGNE — LE SNAPSHOT DE LA SÉANCE.
 *
 * ════════════════════════════════════════════════════════════════════════
 * AUCUN SECOND MODÈLE MÉTIER
 * ════════════════════════════════════════════════════════════════════════
 * `ContenuSnapshot` n'invente rien : il assemble les valeurs que l'écran
 * consomme DÉJÀ, dans leurs types existants. `session` est le `WorkoutSession`
 * rendu par `toEleveWorkoutSession` — celui-là même que la page passe à
 * `SessionFeedbackSection`, avec ses `blocks[]`, ses `exercises[]`, ses
 * `cardioBlocks[]`, ses prescriptions, son échauffement et ses notes.
 *
 * C'est une contrainte, pas une commodité. Deux modèles finissent toujours
 * par diverger, et ici la divergence serait invisible : l'élève verrait
 * hors ligne une séance légèrement différente de celle qu'il a préparée en
 * ligne, sans que rien ne signale l'écart. On stocke donc ce que l'écran
 * lit, tel qu'il le lit.
 *
 * ════════════════════════════════════════════════════════════════════════
 * UN CHARGEMENT PARTIEL N'ÉCRASE JAMAIS UN SNAPSHOT VALIDE
 * ════════════════════════════════════════════════════════════════════════
 * Le moment où le réseau se dégrade est exactement celui où le snapshot
 * devient vital. Si une requête sur trois échoue et qu'on écrit quand même,
 * on remplace une séance complète par une séance amputée — au pire instant
 * possible, et sans erreur visible.
 *
 * D'où `assemblerSnapshot` : chaque morceau arrive sous forme de
 * `PartCharge`, et il suffit d'UN échec pour que l'assemblage soit refusé.
 * L'appelant n'écrit alors rien, et le snapshot précédent — complet, peut-
 * être d'hier, mais entier — reste en place.
 *
 * ════════════════════════════════════════════════════════════════════════
 * CE QUI EST PRÉCHARGÉ, ET POURQUOI
 * ════════════════════════════════════════════════════════════════════════
 * `remplacants` porte les options de substitution admissibles, chargées
 * pendant qu'il y avait du réseau. Sans elles, le sélecteur de remplacement
 * serait vide en salle — c'est-à-dire inutile précisément là où un appareil
 * occupé oblige à changer d'exercice.
 *
 * `historique` sert aux repères « Dernières perfs » et au bilan de fin de
 * séance. Il n'est pas rechargé hors ligne : ce sont des repères, pas des
 * données de saisie.
 */

/* ════════════════════════════════════════════════════════════════════════
 * I. CE QUE CONTIENT LE SNAPSHOT
 * ════════════════════════════════════════════════════════════════════════ */

export interface ContenuSnapshot {
  /**
   * `students.id` figé au moment de la capture.
   *
   * C'est lui qui rend un retour composable hors ligne (voir
   * `lib/offline/identite.ts`) : la clé du dépôt est l'id Auth, mais le
   * payload attend l'id élève.
   */
  studentId: string;
  /** Le view model EXACT consommé par l'écran — jamais une reconstruction. */
  session: WorkoutSession;
  programId: string | null;
  programName: string | null;
  /** Le retour déjà enregistré pour cette séance, ou `null`. */
  feedbackExistant: AdminStudentFeedback | null;
  /** Historique de l'élève — repères « Dernières perfs » et bilan de fin de séance. */
  historique: AdminStudentFeedback[];
  /**
   * Options de remplacement admissibles, indexées par
   * `exercise_library_id` de l'exercice PRESCRIT.
   *
   * Le serveur les revalidera de toute façon : ce cache sert à faire
   * fonctionner le sélecteur, pas à trancher ce qui est autorisé.
   */
  remplacants: Record<string, ExerciseSubstituteOption[]>;
  /** Type d'accès — AFFICHAGE du menu uniquement (voir `schema.ts`). */
  accessType: TypeAcces | null;
}

/* ════════════════════════════════════════════════════════════════════════
 * II. L'ASSEMBLAGE, ET SON REFUS
 * ════════════════════════════════════════════════════════════════════════ */

/**
 * Un morceau du chargement en ligne : réussi, ou manquant AVEC sa raison.
 *
 * Le type force l'appelant à se prononcer. Un `T | null` aurait laissé
 * confondre « le serveur dit qu'il n'y a pas encore de retour » — une
 * réponse valide — avec « la requête a échoué » — qui doit tout arrêter.
 */
export type PartCharge<T> = { ok: true; valeur: T } | { ok: false; raison: string };

/** Raccourci de lecture pour les appelants. */
export function charge<T>(valeur: T): PartCharge<T> {
  return { ok: true, valeur };
}

export function manque<T>(raison: string): PartCharge<T> {
  return { ok: false, raison };
}

export type ResultatAssemblage =
  | { ok: true; contenu: ContenuSnapshot }
  /** `manques` liste CE QUI a échoué — pour le diagnostic, jamais pour l'élève. */
  | { ok: false; manques: string[] };

export interface EntreeAssemblage {
  studentId: PartCharge<string>;
  session: PartCharge<WorkoutSession>;
  programId: PartCharge<string | null>;
  programName: PartCharge<string | null>;
  feedbackExistant: PartCharge<AdminStudentFeedback | null>;
  historique: PartCharge<AdminStudentFeedback[]>;
  remplacants: PartCharge<Record<string, ExerciseSubstituteOption[]>>;
  accessType: PartCharge<TypeAcces | null>;
}

/**
 * Assemble le snapshot — ou refuse, en disant ce qui manque.
 *
 * Aucun morceau n'est facultatif. « Le remplacement est un détail, on peut
 * écrire sans » est exactement le raisonnement qui produit une séance
 * inutilisable en salle.
 */
export function assemblerSnapshot(entree: EntreeAssemblage): ResultatAssemblage {
  const manques: string[] = [];
  for (const [nom, part] of Object.entries(entree) as [string, PartCharge<unknown>][]) {
    if (!part.ok) manques.push(`${nom} : ${part.raison}`);
  }
  if (manques.length > 0) {
    return { ok: false, manques: manques.sort() };
  }

  // Toutes les parts sont `ok` — vérifié juste au-dessus.
  const valeur = <T,>(part: PartCharge<T>): T => (part as { ok: true; valeur: T }).valeur;

  const session = valeur(entree.session);
  const studentId = valeur(entree.studentId);
  if (studentId === "") {
    return { ok: false, manques: ["studentId : identité élève absente"] };
  }
  if (!session || typeof session.id !== "string" || session.id === "") {
    return { ok: false, manques: ["session : séance sans identifiant"] };
  }

  return {
    ok: true,
    contenu: {
      studentId,
      session,
      programId: valeur(entree.programId),
      programName: valeur(entree.programName),
      feedbackExistant: valeur(entree.feedbackExistant),
      historique: valeur(entree.historique),
      remplacants: valeur(entree.remplacants),
      accessType: valeur(entree.accessType),
    },
  };
}

/* ════════════════════════════════════════════════════════════════════════
 * III. LA RELECTURE — TROIS FAÇONS DE NE PAS SERVIR UN SNAPSHOT
 * ════════════════════════════════════════════════════════════════════════
 * Un snapshot présent ne suffit pas. Trois vérifications le précèdent, et
 * chacune correspond à une confusion qui coûterait une séance :
 *
 *   • `autre_compte`  — deux élèves sur le même téléphone ;
 *   • `autre_seance`  — l'URL désigne une séance, le snapshot une autre ;
 *   • `perimee`       — le snapshot est celui d'hier. L'application peut être
 *                       restée ouverte toute la nuit : minuit ne déclenche
 *                       aucun événement, seule une vérification À LA LECTURE
 *                       attrape ce cas.
 *
 * Aucune de ces situations n'efface quoi que ce soit. Un snapshot périmé
 * peut porter une opération en attente qui, elle, doit survivre.
 */

export type EtatSnapshot = "absent" | "autre_compte" | "autre_seance" | "perime" | "pret";

export interface SnapshotStocke {
  userId: string;
  businessDate: string;
  sessionId: string;
  payload: unknown;
}

export interface LectureSnapshot {
  etat: EtatSnapshot;
  /** Rempli UNIQUEMENT quand `etat === "pret"`. */
  contenu: ContenuSnapshot | null;
}

export function lireSnapshotPourSeance(
  snapshot: SnapshotStocke | null,
  attendu: { userId: string; sessionId: string; aujourdhui?: string },
): LectureSnapshot {
  const aujourdhui = attendu.aujourdhui ?? dateMetier();
  if (snapshot === null) {
    return { etat: "absent", contenu: null };
  }
  if (snapshot.userId !== attendu.userId) {
    return { etat: "autre_compte", contenu: null };
  }
  if (snapshot.sessionId !== attendu.sessionId) {
    return { etat: "autre_seance", contenu: null };
  }
  if (snapshot.businessDate !== aujourdhui) {
    return { etat: "perime", contenu: null };
  }
  const contenu = snapshot.payload as ContenuSnapshot | null;
  if (!contenu || typeof contenu !== "object" || typeof contenu.studentId !== "string") {
    // Un snapshot dont la forme n'est pas celle attendue est traité comme
    // absent : il n'est ni rendu, ni effacé (voir `idb.ts`).
    return { etat: "absent", contenu: null };
  }
  return { etat: "pret", contenu };
}

/**
 * La date métier à porter dans le retour — celle de la SÉANCE, jamais celle
 * de l'envoi.
 *
 * Une séance saisie dimanche en avion et synchronisée lundi matin reste une
 * séance de dimanche. Recalculer au moment du flush la déplacerait d'un
 * jour, silencieusement, dans l'historique de l'élève comme dans les
 * statistiques du coach.
 */
export function datePourRetour(
  brouillon: { businessDate: string } | null,
  snapshot: { businessDate: string } | null,
  aujourdhui: string = dateMetier(),
): string {
  return brouillon?.businessDate ?? snapshot?.businessDate ?? aujourdhui;
}
