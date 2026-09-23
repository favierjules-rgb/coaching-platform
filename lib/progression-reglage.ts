/**
 * LE RÉGLAGE « PROGRESSION AUTOMATIQUE » — GLOBAL À UN EXERCICE DANS UN
 * PROGRAMME.
 *
 * ════════════════════════════════════════════════════════════════════════
 * « GLOBAL » N'EST PAS UNE SYNCHRONISATION, C'EST UNE ABSENCE DE CHOIX
 * ════════════════════════════════════════════════════════════════════════
 * Il n'existe pas de réglage par semaine que du code viendrait harmoniser :
 * il n'existe QU'UNE clé, `(programme, identité d'exercice)`, sans aucune
 * composante de semaine, de séance ou de bloc. Toutes les occurrences d'un
 * même exercice — semaine 1, semaine 5, deux fois dans la même semaine —
 * calculent donc la MÊME clé et lisent la MÊME valeur. Basculer le bouton
 * sur n'importe quelle occurrence les bascule toutes, parce qu'il n'y a
 * qu'une valeur à basculer.
 *
 * ⚠️ NE JAMAIS AJOUTER `weekNumber`, `sessionId` NI `blockId` À CETTE CLÉ.
 * Ce serait rétablir exactement le réglage par semaine que la règle exclut,
 * et aucune synchronisation applicative ne le rattraperait durablement :
 * `save_training_session_blocks` supprime les lignes d'exercices absentes du
 * payload à chaque sauvegarde, et `duplicateBlock` régénère leurs
 * identifiants à chaque duplication de semaine.
 *
 * ────────────────────────────────────────────────────────────────────────
 * DEUX IDENTITÉS, DANS CET ORDRE
 * ────────────────────────────────────────────────────────────────────────
 * `exercise_library_id` d'abord : c'est l'identité stable, elle survit à un
 * renommage de l'exercice dans le programme. Le nom normalisé ensuite, pour
 * les exercices saisis en texte libre — qui n'ont pas de fiche de banque et
 * dont la colonne est donc NULL. C'est la même hiérarchie que
 * `findPreviousPerformance` applique déjà pour reconnaître un exercice ; en
 * inventer une autre ici ferait diverger « le même exercice » selon la
 * question posée.
 *
 * ⚠️ ABSENCE DE LIGNE = OFF. Décision explicite : aucun programme existant
 * ne change de comportement, et aucune recommandation n'apparaît à un élève
 * avant qu'un coach ne l'ait activée. Ce module ne connaît donc qu'un seul
 * défaut, et il est écrit une seule fois.
 */
import { normalizeExerciseName } from "@/lib/previous-performance";

/** Le défaut, écrit UNE fois : sans ligne, la progression est désactivée. */
export const PROGRESSION_ACTIVE_PAR_DEFAUT = false;

/** Ce qu'il faut d'un exercice pour calculer sa clé de réglage. */
export interface ExercicePourReglage {
  readonly name: string;
  readonly libraryExerciseId?: string | null;
}

/** L'identité retenue pour un exercice — l'une OU l'autre, jamais les deux. */
export type IdentiteReglage =
  | { readonly genre: "banque"; readonly exerciseLibraryId: string }
  | { readonly genre: "nom"; readonly exerciseNameNormalized: string };

/**
 * L'identité de réglage d'un exercice, ou `null` s'il n'en a aucune.
 *
 * `null` quand l'exercice n'a ni fiche de banque ni nom exploitable : un
 * exercice sans nom ne peut pas porter de réglage, et lui en inventer un
 * reviendrait à faire partager le même réglage à tous les exercices sans
 * nom du programme.
 */
export function identiteReglage(exercice: ExercicePourReglage): IdentiteReglage | null {
  const banque = (exercice.libraryExerciseId ?? "").trim();
  if (banque !== "") return { genre: "banque", exerciseLibraryId: banque };
  const nom = normalizeExerciseName(exercice.name ?? "");
  if (nom !== "") return { genre: "nom", exerciseNameNormalized: nom };
  return null;
}

/**
 * La clé d'index en mémoire. Le préfixe est indispensable : sans lui, une
 * fiche de banque dont l'identifiant vaudrait littéralement le nom normalisé
 * d'un autre exercice les confondrait.
 */
export function cleReglage(identite: IdentiteReglage): string {
  return identite.genre === "banque"
    ? `banque:${identite.exerciseLibraryId}`
    : `nom:${identite.exerciseNameNormalized}`;
}

/** La clé d'un exercice, ou `null` s'il n'a pas d'identité. */
export function cleReglageDeLExercice(exercice: ExercicePourReglage): string | null {
  const identite = identiteReglage(exercice);
  return identite ? cleReglage(identite) : null;
}

/* ─── Lecture ─── */

/** Une ligne de `program_exercise_progression`, telle que la base la rend. */
export interface LigneReglage {
  readonly exerciseLibraryId: string | null;
  readonly exerciseNameNormalized: string | null;
  readonly progressionActive: boolean;
}

export type IndexReglages = ReadonlyMap<string, boolean>;

/**
 * Indexe les lignes d'un programme par clé d'exercice.
 *
 * Une ligne portant les deux identités, ou aucune, est IGNORÉE : le CHECK de
 * la table l'interdit, mais ce module lit aussi des données de test et des
 * réponses réseau — et une ligne ambiguë ne doit pas décider à la place du
 * coach. Le défaut (OFF) s'applique alors.
 */
export function indexerReglages(lignes: readonly LigneReglage[]): IndexReglages {
  const index = new Map<string, boolean>();
  for (const ligne of lignes) {
    const banque = (ligne.exerciseLibraryId ?? "").trim();
    const nom = (ligne.exerciseNameNormalized ?? "").trim();
    if (banque !== "" && nom !== "") continue;
    if (banque !== "") index.set(cleReglage({ genre: "banque", exerciseLibraryId: banque }), ligne.progressionActive);
    else if (nom !== "") index.set(cleReglage({ genre: "nom", exerciseNameNormalized: nom }), ligne.progressionActive);
  }
  return index;
}

/**
 * La progression est-elle active pour cet exercice ?
 *
 * ⚠️ TOUTES LES OCCURRENCES D'UN MÊME EXERCICE RENDENT LA MÊME RÉPONSE, quelle
 * que soit leur semaine : la clé n'en dépend pas.
 */
export function progressionActivePour(index: IndexReglages, exercice: ExercicePourReglage): boolean {
  const cle = cleReglageDeLExercice(exercice);
  if (!cle) return PROGRESSION_ACTIVE_PAR_DEFAUT;
  return index.get(cle) ?? PROGRESSION_ACTIVE_PAR_DEFAUT;
}

/* ─── Écriture ─── */

/** Ce qu'il faut écrire pour poser le réglage d'un exercice. */
export interface EcritureReglage {
  readonly programId: string;
  readonly exerciseLibraryId: string | null;
  readonly exerciseNameNormalized: string | null;
  readonly progressionActive: boolean;
}

/**
 * La ligne à écrire pour basculer un exercice, ou `null` si l'exercice n'a
 * pas d'identité — auquel cas il n'y a rien à persister, et le bouton ne doit
 * pas être proposé.
 */
export function ecritureDuReglage(
  programId: string,
  exercice: ExercicePourReglage,
  progressionActive: boolean,
): EcritureReglage | null {
  const identite = identiteReglage(exercice);
  if (!identite || programId.trim() === "") return null;
  return {
    programId,
    exerciseLibraryId: identite.genre === "banque" ? identite.exerciseLibraryId : null,
    exerciseNameNormalized: identite.genre === "nom" ? identite.exerciseNameNormalized : null,
    progressionActive,
  };
}

/**
 * L'index après bascule, SANS attendre le réseau — c'est ce qui fait que les
 * boutons des autres semaines changent d'état en même temps que celui qu'on
 * vient de toucher. Une seule entrée est modifiée, parce qu'une seule entrée
 * existe pour cet exercice.
 */
export function indexApresBascule(
  index: IndexReglages,
  exercice: ExercicePourReglage,
  progressionActive: boolean,
): IndexReglages {
  const cle = cleReglageDeLExercice(exercice);
  if (!cle) return index;
  const suivant = new Map(index);
  suivant.set(cle, progressionActive);
  return suivant;
}
