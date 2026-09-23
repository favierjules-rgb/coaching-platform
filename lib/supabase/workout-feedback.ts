import type { SupabaseClient } from "@supabase/supabase-js";

import { buildStudentActivityLink, logActivityEvent } from "@/lib/supabase/activity";
import type {
  AdminExerciseFeedbackEntry,
  AdminStudentFeedback,
  CoachReplyVideoEntry,
  FeedbackStatus,
  FeedbackVideoEntry,
  SupabaseExerciseFeedback,
  SupabaseExerciseSetFeedback,
  SupabaseWorkoutFeedback,
  WorkoutFeedbackPayload,
} from "@/types";
import type { Database } from "@/types/supabase";
import type { ReponseCoach } from "@/lib/coach-reply-video";
import { serialiserAnnotations } from "@/lib/video-annotations";
import { loadSignedCoachReplyVideoUrls } from "@/lib/supabase/storage-coach-reply-videos";
import { loadSignedFeedbackVideoUrls } from "@/lib/supabase/storage-feedback-videos";
import { exerciseFeedbackWorthPersisting } from "@/lib/workout-feedback-entry";
import { sanitizeDurationMinutes, sanitizePerformedAt } from "@/lib/workout-history";

/**
 * Couche d'accès aux retours d'entraînement Supabase (tables
 * `workout_feedback`, `exercise_feedback`, `exercise_set_feedback`).
 *
 * Comme lib/supabase/students.ts, toutes les lectures renvoient un résultat
 * "vide" (jamais d'exception) aussi bien quand Supabase n'a réellement
 * aucune donnée qu'en cas d'erreur (RLS, réseau...) — jamais bloquant, pour
 * préserver le repli mock/localStorage.
 *
 * ⚠️ « JAMAIS D'EXCEPTION » N'A JAMAIS VOULU DIRE « JAMAIS UN MOT ». Ce
 * fichier a pourtant longtemps confondu les deux : l'erreur n'était
 * journalisée qu'en développement, et une lecture rejetée devenait un
 * résultat vide indiscernable d'une absence réelle de données. Le contrat est
 * maintenant explicite en deux points, et c'est le seul changement :
 *   • une erreur de lecture est journalisée DANS TOUS LES ENVIRONNEMENTS, avec
 *     `code`, `details` et `hint` (voir `devWarn`) ;
 *   • une lecture partielle se DÉCLARE partielle — `loadExercisesAndSets` rend
 *     `complet` et `erreur` à côté de ses deux cartes, et chaque appelant
 *     nomme la conséquence pour son écran.
 * Aucune lecture ne lève pour autant : le repli mock/localStorage est intact.
 *
 * Les lignes sont converties vers `AdminStudentFeedback` /
 * `AdminExerciseFeedbackEntry` (déjà utilisés par /admin/retours,
 * FeedbackDetailModal et la section "Retours récents" de
 * /admin/eleves/[studentId]) pour que ces composants n'aient rien à
 * changer.
 */

type TypedSupabaseClient = SupabaseClient<Database>;

type WorkoutFeedbackRow = Database["public"]["Tables"]["workout_feedback"]["Row"];
type ExerciseFeedbackRow = Database["public"]["Tables"]["exercise_feedback"]["Row"];
type ExerciseSetFeedbackRow = Database["public"]["Tables"]["exercise_set_feedback"]["Row"];

/**
 * Une erreur de lecture telle que PostgREST la rend : le message, et les trois
 * champs qui disent souvent POURQUOI.
 */
type ErreurLecture = { message: string; code?: string; details?: string; hint?: string };

/**
 * Signale une erreur de lecture — DANS TOUS LES ENVIRONNEMENTS.
 *
 * ⚠️ CETTE FONCTION A DÉJÀ LAISSÉ PASSER UNE PANNE ENTIÈRE, EN SILENCE. Sa
 * version précédente ne journalisait que si `NODE_ENV === "development"` et ne
 * gardait que `message`. Sur Preview comme en production, `NODE_ENV` vaut
 * "production" : le rejet de la passerelle sur `exercise_set_feedback` (une
 * URL de 25 847 caractères, mesurée dans `edge_logs`) n'a produit AUCUNE
 * trace, et la modale du coach s'est affichée sans son détail par exercice
 * sans que rien, nulle part, ne le dise. Une lecture qui échoue doit se voir
 * là où elle échoue.
 *
 * `code`, `details` et `hint` sont conservés parce que ce sont eux qui
 * distinguent un refus RLS d'une URL trop longue ou d'une colonne absente.
 * Même forme que lib/supabase/activity.ts et lib/supabase/appointments.ts — le
 * nom `devWarn` est gardé pour rester aligné sur ces deux voisins, qui
 * journalisent eux aussi en production.
 *
 * ⚠️ RIEN D'AUTRE N'EST JOURNALISÉ. Ni jeton, ni cookie, ni en-tête, ni URL,
 * ni identifiant d'élève : uniquement les champs de l'erreur rendue.
 */
function devWarn(context: string, error: ErreurLecture | null): void {
  if (!error) return;
  console.error(
    `[Supabase] ${context} : ${error.message}` +
      (error.code ? ` (code ${error.code})` : "") +
      (error.details ? ` — ${error.details}` : "") +
      (error.hint ? ` — ${error.hint}` : ""),
  );
}

/* ─── Row -> types Supabase* (camelCase) ─── */

function mapWorkoutFeedbackRow(row: WorkoutFeedbackRow): SupabaseWorkoutFeedback {
  return {
    id: row.id,
    studentId: row.student_id,
    sessionId: row.session_id,
    programId: row.program_id,
    sessionKey: row.session_key,
    sessionRefLabel: row.session_ref_label,
    completed: row.completed,
    globalRpe: row.global_rpe,
    globalComment: row.global_comment,
    pain: row.pain,
    status: row.status as FeedbackStatus,
    coachReply: row.coach_reply,
    coachReplyVideoPath: row.coach_reply_video_path ?? null,
    coachReplyVideoUploadedAt: row.coach_reply_video_uploaded_at ?? null,
    coachReplyVideoAnnotations: row.coach_reply_video_annotations ?? null,
    submittedAt: row.submitted_at,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    prescribedSnapshot: row.prescribed_snapshot ?? null,
    performedAt: row.performed_at ?? null,
    durationMinutes: row.duration_minutes ?? null,
    sessionStatus: row.session_status ?? null,
  };
}

function mapExerciseFeedbackRow(row: ExerciseFeedbackRow): SupabaseExerciseFeedback {
  return {
    id: row.id,
    workoutFeedbackId: row.workout_feedback_id,
    studentId: row.student_id,
    exerciseId: row.exercise_id,
    exerciseName: row.exercise_name,
    exerciseOrder: row.exercise_order,
    rpe: row.rpe,
    comment: row.comment,
    substituteExerciseLibraryId: row.substitute_exercise_library_id,
    substituteExerciseName: row.substitute_exercise_name,
    videoPath: row.video_path,
    videoUploadedAt: row.video_uploaded_at,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

function mapExerciseSetFeedbackRow(row: ExerciseSetFeedbackRow): SupabaseExerciseSetFeedback {
  return {
    id: row.id,
    exerciseFeedbackId: row.exercise_feedback_id,
    studentId: row.student_id,
    setNumber: row.set_number,
    loadUsed: row.load_used,
    repsDone: row.reps_done,
    rpe: row.rpe ?? null,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

/**
 * Compose un AdminStudentFeedback (forme mock existante) à partir d'un
 * retour Supabase et de ses exercices/séries déjà triés. `exerciseEntries`
 * reste volontairement une liste à plat (une entrée par série, avec
 * exerciseName/rpe/comment dupliqués) pour correspondre exactement à ce que
 * produit déjà SessionFeedbackSection côté mock — un exercice sans aucune
 * série renseignée ne produit aucune entrée, comme en mock.
 */
interface ResolutionsLecture {
  /**
   * Démonstrations ACTUELLES des remplaçants, par id de fiche de banque.
   * Absente par défaut : seule la lecture destinée à l'écran de l'élève
   * (getWorkoutFeedbackBySession) paie la requête supplémentaire — les
   * listes du coach n'affichent aucune vidéo.
   */
  substituteVideos?: Map<string, string>;
  /**
   * URLs signées des vidéos d'ÉLÈVE, par chemin. Absente par défaut, pour la
   * même raison : seuls les écrans qui affichent réellement la vidéo paient
   * les signatures — une URL signée est un jeton d'accès, on n'en fabrique
   * pas pour des lignes que personne ne regardera.
   */
  videoUrls?: Map<string, string>;
  /** URLs signées des réponses vidéo du COACH (F5), même règle. */
  coachReplyVideoUrls?: Map<string, string>;
}

function toAdminStudentFeedback(
  feedback: SupabaseWorkoutFeedback,
  exercises: SupabaseExerciseFeedback[],
  setsByExerciseFeedbackId: Map<string, SupabaseExerciseSetFeedback[]>,
  /**
   * Ce qui a été résolu EN AMONT, et que ce convertisseur se contente de
   * poser. Un objet nommé plutôt que trois paramètres positionnels : deux
   * `Map<string, string>` voisines s'intervertissent sans que TypeScript
   * n'ait rien à en dire, et l'écran afficherait alors sereinement la
   * mauvaise vidéo.
   */
  resolutions: ResolutionsLecture = {},
): AdminStudentFeedback {
  const { substituteVideos = new Map(), videoUrls = new Map(), coachReplyVideoUrls = new Map() } = resolutions;

  const exerciseEntries: AdminExerciseFeedbackEntry[] = exercises
    .slice()
    .sort((a, b) => (a.exerciseOrder ?? 0) - (b.exerciseOrder ?? 0))
    .flatMap((exercise) => {
      const sets = (setsByExerciseFeedbackId.get(exercise.id) ?? [])
        .slice()
        .sort((a, b) => a.setNumber - b.setNumber);
      return sets.map((set) => ({
        exerciseId: exercise.exerciseId ?? undefined,
        exerciseName: exercise.exerciseName,
        setNumber: set.setNumber,
        loadUsed: set.loadUsed,
        repsDone: set.repsDone,
        // Option B (feat/student-previous-set-performance) : `rpe` est le
        // RPE de LA série (exercise_set_feedback.rpe) — null pour tout
        // retour antérieur. Le RPE global d'exercice n'est PLUS recopié sur
        // chaque série : il est exposé séparément (exerciseRpe) pour être
        // affiché UNE fois, avec un libellé honnête.
        rpe: set.rpe,
        exerciseRpe: exercise.rpe,
        comment: exercise.comment,
        // Remplacement (F3) : `exerciseName` reste le PRESCRIT, ce champ
        // porte le RÉALISÉ. `null` sur tout l'historique — aucun backfill.
        substituteExerciseName: exercise.substituteExerciseName,
        substituteExerciseLibraryId: exercise.substituteExerciseLibraryId,
        substituteVideoUrl: exercise.substituteExerciseLibraryId
          ? (substituteVideos.get(exercise.substituteExerciseLibraryId) ?? null)
          : null,
      }));
    });

  // VIDÉOS (F4) — bâties depuis les EXERCICES, jamais depuis les séries.
  // Un exercice filmé sans aucune série saisie ne produit aucune entrée dans
  // `exerciseEntries` : construire les vidéos à partir de cette liste-là les
  // aurait perdues, et la resoumission suivante aurait effacé la référence.
  const videos: FeedbackVideoEntry[] = exercises
    .slice()
    .sort((a, b) => (a.exerciseOrder ?? 0) - (b.exerciseOrder ?? 0))
    .filter((exercise) => exercise.videoPath)
    .map((exercise) => ({
      exerciseName: exercise.exerciseName,
      realizedName: exercise.substituteExerciseName ?? exercise.exerciseName,
      videoPath: exercise.videoPath as string,
      videoUrl: videoUrls.get(exercise.videoPath as string) ?? null,
    }));

  // RÉPONSE VIDÉO DU COACH (F5) — un objet ou `null`, jamais un tableau : le
  // coach répond une fois, et remplacer sa réponse écrase la précédente.
  const coachReplyVideo: CoachReplyVideoEntry | null = feedback.coachReplyVideoPath
    ? {
        videoPath: feedback.coachReplyVideoPath,
        videoUrl: coachReplyVideoUrls.get(feedback.coachReplyVideoPath) ?? null,
        uploadedAt: feedback.coachReplyVideoUploadedAt,
        annotations: feedback.coachReplyVideoAnnotations,
      }
    : null;

  return {
    id: feedback.id,
    studentId: feedback.studentId,
    type: "entrainement",
    sessionId: feedback.sessionKey ?? undefined,
    programId: feedback.programId,
    refLabel: feedback.sessionRefLabel || "Séance",
    date: feedback.submittedAt.slice(0, 10),
    completed: feedback.completed,
    rpe: feedback.globalRpe,
    pain: feedback.pain,
    comment: feedback.globalComment,
    exerciseEntries,
    videos,
    status: feedback.status,
    coachReply: feedback.coachReply,
    coachReplyVideo,
    prescribedSnapshot: feedback.prescribedSnapshot ?? null,
    performedAt: feedback.performedAt ?? null,
    durationMinutes: feedback.durationMinutes ?? null,
    sessionStatus: (feedback.sessionStatus as "done" | "missed" | null) ?? null,
    createdAt: feedback.createdAt,
    updatedAt: feedback.updatedAt,
  };
}

/**
 * Démonstrations ACTUELLES des remplaçants déclarés dans ces lignes.
 *
 * POURQUOI ICI ET PAS DANS LE RETOUR. L'URL d'une vidéo n'a rien à faire
 * dans un retour de séance : elle changerait sans prévenir, alors qu'un
 * retour est une photographie. On résout donc à la LECTURE, en UNE requête
 * groupée, et seulement s'il y a au moins un remplacement — une séance sans
 * remplacement ne paie rien. Une fiche supprimée depuis ne rend simplement
 * aucune vidéo : le NOM réalisé, lui, reste dans le retour.
 */
async function loadSubstituteVideos(
  supabase: TypedSupabaseClient,
  exercises: SupabaseExerciseFeedback[],
): Promise<Map<string, string>> {
  const ids = [...new Set(exercises.map((e) => e.substituteExerciseLibraryId).filter((id): id is string => !!id))];
  if (ids.length === 0) return new Map();
  const { data, error } = await supabase
    .from("exercise_library")
    .select("id, video_url, alternative_video_url")
    .in("id", ids);
  devWarn("loadSubstituteVideos", error);
  const videos = new Map<string, string>();
  for (const ligne of data ?? []) {
    const url = (ligne.video_url || ligne.alternative_video_url || "").trim();
    if (url) videos.set(ligne.id, url);
  }
  return videos;
}

/* ─── Lecture par lots d'identifiants ─── */

/**
 * ⚠️ UNE LISTE D'IDENTIFIANTS VOYAGE DANS L'URL, ET UNE URL A UN PLAFOND.
 *
 * `.in("colonne", ids)` devient `?colonne=in.(uuid1,uuid2,…)` : la liste
 * entière part dans la ligne de requête HTTP. Au-delà d'un certain volume, la
 * passerelle placée devant PostgREST rejette la requête AVANT la base — un 400
 * qui n'apparaît dans aucun `postgres_logs`.
 *
 * PANNE CONSTATÉE SUR CE FICHIER, PAS SUPPOSÉE. Les `edge_logs` du projet, sur
 * le chemin `/rest/v1/exercise_set_feedback`, séparent parfaitement les deux
 * régimes : 91 requêtes de 185 à 4 514 caractères d'URL → 200 ; 15 requêtes de
 * 25 028 à 25 847 caractères → 400, sans une seule ligne entre les deux. Les
 * 660 identifiants de séries d'une page `/admin/retours` produisent exactement
 * 25 847 caractères — la valeur mesurée sur le rejet rejoué, à zéro d'écart.
 *
 * ⚠️ LE PLAFOND EXACT N'EST PAS CONNU, ET C'EST POURQUOI LA MARGE EST LARGE.
 * Les journaux ne le bornent qu'à l'intervalle ]4 514 ; 25 028] ; le resserrer
 * demanderait d'émettre des requêtes-sondes avec la clé du projet. Un lot de
 * 100 identifiants pèse 4 007 caractères (36 caractères par UUID, plus les
 * `%2C` de séparation) : il reste dans la zone dont les journaux prouvent
 * qu'elle passe, et non dans une zone simplement « plus petite que le mur ».
 *
 * ⚠️ MÊME RAISON QUE `lireParLots` DE lib/supabase/programs.ts, MAIS PAS LE
 * MÊME RÉGLAGE. Là-bas les lots valent 200 identifiants et partent tous
 * ensemble ; ici ils valent 100 et la concurrence est bornée, parce que le
 * fan-out est plus grand (7 lots pour une page réelle) et qu'une liste de
 * retours en émet déjà deux vagues, l'une après l'autre.
 */
export const TAILLE_DE_LOT_IDS = 100;

/**
 * Nombre de lots émis SIMULTANÉMENT.
 *
 * Borné, et pas seulement « parallèle » : 7 requêtes lâchées d'un coup pour un
 * seul écran sont 7 connexions prises au même pool, au même instant, pour un
 * coach parmi d'autres. Trois vagues de 3, 3 et 1 coûtent deux attentes de
 * plus et rendent la charge prévisible.
 */
export const LOTS_EN_PARALLELE = 3;

/** Découpe une liste en lots d'au plus `taille` éléments. Pure, donc testable seule. */
export function decouperEnLots<T>(valeurs: readonly T[], taille: number): T[][] {
  if (taille < 1) throw new Error("decouperEnLots : la taille d'un lot doit être au moins 1");
  const lots: T[][] = [];
  for (let i = 0; i < valeurs.length; i += taille) {
    lots.push(valeurs.slice(i, i + taille) as T[]);
  }
  return lots;
}

/** Ce que rend la lecture d'UN lot : les lignes, ou l'erreur qui les remplace. */
type LotLu<T> = { data: T[] | null; error: ErreurLecture | null };

/**
 * Lit toutes les lignes correspondant à `ids` en découpant la liste en lots
 * dont l'URL reste courte, `LOTS_EN_PARALLELE` lots à la fois.
 *
 * ⚠️ UN LOT EN ERREUR NE DEVIENT JAMAIS UN LOT VIDE. C'était précisément le
 * défaut : `(data ?? [])` rendait `[]` indifféremment pour « aucune ligne » et
 * pour « la requête a été rejetée », et l'écran affichait un retour sans
 * séries comme s'il n'en avait jamais eu. Ici l'erreur est journalisée telle
 * quelle, `complet` passe à `false`, et elle est RENDUE à l'appelant : c'est
 * lui qui décide quoi en dire, pas ce helper.
 *
 * ⚠️ ET LES VAGUES SUIVANTES NE PARTENT PAS. Une fois la lecture connue comme
 * incomplète, les requêtes restantes ne peuvent plus la rendre complète : les
 * émettre ne ferait que payer, et peut-être insister, sur une panne déjà
 * établie. Les lignes déjà obtenues sont conservées et rendues avec
 * `complet: false` — jamais présentées comme le jeu entier.
 */
async function lireParLots<T>(
  contexte: string,
  ids: readonly string[],
  lireUnLot: (lot: string[]) => PromiseLike<LotLu<T>>,
): Promise<{ rows: T[]; complet: boolean; erreur: ErreurLecture | null }> {
  if (ids.length === 0) return { rows: [], complet: true, erreur: null };

  const lots = decouperEnLots(ids, TAILLE_DE_LOT_IDS);
  const rows: T[] = [];

  for (let depart = 0; depart < lots.length; depart += LOTS_EN_PARALLELE) {
    const vague = lots.slice(depart, depart + LOTS_EN_PARALLELE);
    const resultats = await Promise.all(vague.map((lot) => lireUnLot(lot)));

    let erreur: ErreurLecture | null = null;
    let rangDuLotFautif = 0;
    for (let n = 0; n < resultats.length; n += 1) {
      const resultat = resultats[n] as LotLu<T>;
      if (resultat.error) {
        // Le premier échec de la vague est celui qu'on remonte ; les lots
        // voisins qui ont abouti sont tout de même conservés.
        if (!erreur) {
          erreur = resultat.error;
          rangDuLotFautif = depart + n + 1;
        }
        continue;
      }
      if (resultat.data) rows.push(...resultat.data);
    }

    if (erreur) {
      devWarn(`${contexte} (lot ${rangDuLotFautif}/${lots.length} interrompu)`, erreur);
      return { rows, complet: false, erreur };
    }
  }

  return { rows, complet: true, erreur: null };
}

/**
 * Récupère et regroupe les exercices/séries de un ou plusieurs retours, en
 * lots d'identifiants (voir `TAILLE_DE_LOT_IDS`).
 *
 * ⚠️ LES DEUX LECTURES SONT TRAITÉES DE LA MÊME FAÇON. Seule celle des séries
 * dépassait réellement le plafond (660 identifiants) ; celle des exercices
 * passait encore avec les 129 retours de production. « Passe encore » n'est pas
 * une propriété du code mais du volume du jour : le premier écran à porter 700
 * retours aurait reproduit la même panne, au même endroit, sans rien avoir
 * changé. Les deux passent donc par le même chemin.
 *
 * `complet` vaut `false` dès qu'UN SEUL lot a échoué : les deux cartes rendues
 * sont alors partielles, et l'appelant doit le savoir avant de les présenter
 * comme le détail complet d'un retour.
 */
async function loadExercisesAndSets(
  supabase: TypedSupabaseClient,
  workoutFeedbackIds: string[],
): Promise<{
  exercisesByFeedbackId: Map<string, SupabaseExerciseFeedback[]>;
  setsByExerciseFeedbackId: Map<string, SupabaseExerciseSetFeedback[]>;
  complet: boolean;
  erreur: ErreurLecture | null;
}> {
  if (workoutFeedbackIds.length === 0) {
    return {
      exercisesByFeedbackId: new Map(),
      setsByExerciseFeedbackId: new Map(),
      complet: true,
      erreur: null,
    };
  }

  const lectureExercices = await lireParLots<ExerciseFeedbackRow>(
    "loadExercisesAndSets (exercise_feedback)",
    workoutFeedbackIds,
    (lot) => supabase.from("exercise_feedback").select("*").in("workout_feedback_id", lot),
  );
  const exercises = lectureExercices.rows.map(mapExerciseFeedbackRow);

  const exerciseIds = exercises.map((exercise) => exercise.id);
  const lectureSeries = await lireParLots<ExerciseSetFeedbackRow>(
    "loadExercisesAndSets (exercise_set_feedback)",
    exerciseIds,
    (lot) => supabase.from("exercise_set_feedback").select("*").in("exercise_feedback_id", lot),
  );
  const sets = lectureSeries.rows.map(mapExerciseSetFeedbackRow);

  // ⚠️ LES LOTS SONT FUSIONNÉS AVANT LE REGROUPEMENT, ET L'ORDRE NE DÉPEND PAS
  // DE LA FUSION. Toutes les séries d'un même exercice partagent le même
  // `exercise_feedback_id` : elles tombent donc toujours dans le même lot, et
  // `toAdminStudentFeedback` retrie de toute façon par `exerciseOrder` puis par
  // `setNumber`. L'ordre rendu à l'écran est le même, quel que soit l'ordre
  // d'arrivée des vagues.
  const exercisesByFeedbackId = new Map<string, SupabaseExerciseFeedback[]>();
  for (const exercise of exercises) {
    const list = exercisesByFeedbackId.get(exercise.workoutFeedbackId) ?? [];
    list.push(exercise);
    exercisesByFeedbackId.set(exercise.workoutFeedbackId, list);
  }

  const setsByExerciseFeedbackId = new Map<string, SupabaseExerciseSetFeedback[]>();
  for (const set of sets) {
    const list = setsByExerciseFeedbackId.get(set.exerciseFeedbackId) ?? [];
    list.push(set);
    setsByExerciseFeedbackId.set(set.exerciseFeedbackId, list);
  }

  // Le rang du lot fautif est déjà journalisé par `lireParLots`. La
  // CONSÉQUENCE, elle, n'est pas la même selon l'écran : c'est chaque appelant
  // qui la nomme, avec ses mots, là où elle se produit.
  return {
    exercisesByFeedbackId,
    setsByExerciseFeedbackId,
    complet: lectureExercices.complet && lectureSeries.complet,
    erreur: lectureExercices.erreur ?? lectureSeries.erreur,
  };
}

/**
 * URLs SIGNÉES des vidéos de technique (F4), par chemin.
 *
 * Même arbitrage que `loadSubstituteVideos` : seules les lectures de DÉTAIL
 * paient les signatures — l'écran où l'élève rouvre son retour, et la modale
 * où le coach le regarde. Les listes transportent le chemin et rien d'autre.
 * Une URL signée est un jeton d'accès : on n'en fabrique pas pour des lignes
 * que personne ne regardera.
 */
async function loadFeedbackVideoUrls(
  supabase: TypedSupabaseClient,
  exercises: SupabaseExerciseFeedback[],
): Promise<Map<string, string>> {
  return loadSignedFeedbackVideoUrls(
    supabase,
    exercises.map((exercise) => exercise.videoPath),
  );
}

/* ─── Lecture ─── */

/**
 * Retour déjà soumis par un élève pour une séance donnée (identifiée par
 * `sessionKey`, l'id mock stable de la séance), ou `null` si aucun retour
 * n'existe encore — utilisé par SessionFeedbackSection pour préremplir /
 * afficher le récapitulatif au lieu du formulaire vierge.
 */
export async function getWorkoutFeedbackBySession(
  supabase: TypedSupabaseClient,
  studentId: string,
  sessionKey: string,
): Promise<AdminStudentFeedback | null> {
  const { data, error } = await supabase
    .from("workout_feedback")
    .select("*")
    .eq("student_id", studentId)
    .eq("session_key", sessionKey)
    .maybeSingle();
  devWarn("getWorkoutFeedbackBySession", error);
  if (!data) {
    return null;
  }

  const feedback = mapWorkoutFeedbackRow(data);
  const { exercisesByFeedbackId, setsByExerciseFeedbackId, complet, erreur } = await loadExercisesAndSets(supabase, [
    feedback.id,
  ]);
  if (!complet) {
    /*
     * ⚠️ ICI L'ENJEU N'EST PAS L'AFFICHAGE, C'EST UNE PERTE DE DONNÉES.
     *
     * Cet écran PRÉREMPLIT le formulaire, et une resoumission remplace les
     * séries (delete + reinsert, voir `saveWorkoutFeedback`). Un préremplissage
     * amputé que l'élève renvoie effacerait donc pour de bon les séries
     * manquantes.
     *
     * Le comportement n'est pas changé dans ce correctif — le rendre bloquant
     * demanderait de trancher ce que l'écran doit faire à la place, ce qui
     * dépasse le périmètre. Mais la trace, elle, est désormais lisible en
     * production : c'est ce qui manquait pour que le problème soit seulement
     * visible.
     */
    devWarn("getWorkoutFeedbackBySession (préremplissage incomplet — resoumission risquée)", erreur);
  }
  const exercises = exercisesByFeedbackId.get(feedback.id) ?? [];
  // SEULE lecture qui résout les démonstrations : c'est celle qui alimente
  // l'écran où l'élève rouvre son retour pour le modifier.
  const videos = await loadSubstituteVideos(supabase, exercises);
  const videosEleve = await loadFeedbackVideoUrls(supabase, exercises);
  // La réponse du coach n'est PAS signée ici : cet écran est celui où l'élève
  // remplit ou rouvre son retour, il n'affiche pas la réponse. Elle l'est
  // dans l'historique, qui l'affiche.
  return toAdminStudentFeedback(feedback, exercises, setsByExerciseFeedbackId, {
    substituteVideos: videos,
    videoUrls: videosEleve,
  });
}

/** Liste de tous les retours Supabase pour /admin/retours, plus récents en premier. */
export async function getAdminWorkoutFeedbackList(supabase: TypedSupabaseClient): Promise<AdminStudentFeedback[]> {
  const { data, error } = await supabase
    .from("workout_feedback")
    .select("*")
    .order("submitted_at", { ascending: false });
  devWarn("getAdminWorkoutFeedbackList", error);
  if (!data || data.length === 0) {
    return [];
  }

  const feedbacks = data.map(mapWorkoutFeedbackRow);
  const { exercisesByFeedbackId, setsByExerciseFeedbackId, complet, erreur } = await loadExercisesAndSets(
    supabase,
    feedbacks.map((f) => f.id),
  );
  if (!complet) {
    /*
     * ⚠️ ON REND LA LISTE PARTIELLE, ET ON LE DIT — ON NE REND PAS UN TABLEAU
     * VIDE.
     *
     * Rendre `[]` serait pire que silencieux : `useSupabaseAdminFeedback`
     * retombe alors sur la liste MOCK, et le coach lirait des retours
     * fabriqués en croyant lire ceux de ses élèves. Entre un détail incomplet
     * et un détail inventé, il n'y a pas d'hésitation.
     */
    devWarn("getAdminWorkoutFeedbackList (détail par exercice incomplet)", erreur);
  }
  // C'EST CE CHEMIN QUE LE COACH EMPRUNTE. /admin/retours affiche cette
  // liste, et c'est depuis une de ses lignes que FeedbackDetailModal s'ouvre
  // — il n'existe aucun second chargement « de détail ». Les URLs sont donc
  // signées ici, EN UNE SEULE requête pour toute la page (createSignedUrls),
  // et seulement pour les vidéos que la RLS accorde à CE coach.
  const videoUrls = await loadFeedbackVideoUrls(supabase, [...exercisesByFeedbackId.values()].flat());
  // Et les réponses du coach lui-même (F5) : il doit VOIR ce qu'il a déjà
  // envoyé avant de décider de le remplacer. Même signature groupée, même
  // règle de refus — un coach non rattaché n'obtient rien.
  const coachReplyVideoUrls = await loadSignedCoachReplyVideoUrls(
    supabase,
    feedbacks.map((f) => f.coachReplyVideoPath),
  );
  return feedbacks.map((feedback) =>
    toAdminStudentFeedback(feedback, exercisesByFeedbackId.get(feedback.id) ?? [], setsByExerciseFeedbackId, {
      videoUrls,
      coachReplyVideoUrls,
    }),
  );
}

/**
 * Retours Supabase d'un élève précis — section "Retours récents" de
 * /admin/eleves/[studentId], historique élève, et calculs de progression.
 *
 * `avecReponseVideo` est OPT-IN, et il faut dire pourquoi plutôt que de
 * signer systématiquement : cette fonction sert aussi aux statistiques
 * (lib/supabase/progress.ts), qui ne montrent aucune vidéo. Signer là-bas
 * fabriquerait des jetons d'accès pour des lignes que personne ne regarde,
 * à chaque calcul. Seul l'historique de l'élève — le seul écran où il lit la
 * réponse de son coach — le demande.
 */
export async function getWorkoutFeedbackForStudent(
  supabase: TypedSupabaseClient,
  studentId: string,
  options: { avecReponseVideo?: boolean } = {},
): Promise<AdminStudentFeedback[]> {
  const { data, error } = await supabase
    .from("workout_feedback")
    .select("*")
    .eq("student_id", studentId)
    .order("submitted_at", { ascending: false });
  devWarn("getWorkoutFeedbackForStudent", error);
  if (!data || data.length === 0) {
    return [];
  }

  const feedbacks = data.map(mapWorkoutFeedbackRow);
  const { exercisesByFeedbackId, setsByExerciseFeedbackId, complet, erreur } = await loadExercisesAndSets(
    supabase,
    feedbacks.map((f) => f.id),
  );
  if (!complet) {
    // ⚠️ CETTE LECTURE ALIMENTE AUSSI LES CALCULS DE PROGRESSION
    // (lib/supabase/progress.ts, référence de l'occurrence N-1). Des séries
    // manquantes n'y produisent pas une erreur mais un REPÈRE FAUX, ou aucun
    // repère : c'est le genre de panne qu'on ne voit qu'en la journalisant.
    devWarn("getWorkoutFeedbackForStudent (détail par exercice incomplet)", erreur);
  }
  const coachReplyVideoUrls = options.avecReponseVideo
    ? await loadSignedCoachReplyVideoUrls(
        supabase,
        feedbacks.map((f) => f.coachReplyVideoPath),
      )
    : new Map<string, string>();
  return feedbacks.map((feedback) =>
    toAdminStudentFeedback(feedback, exercisesByFeedbackId.get(feedback.id) ?? [], setsByExerciseFeedbackId, {
      coachReplyVideoUrls,
    }),
  );
}

/* ─── Écriture ─── */

/**
 * Enregistre le retour complet d'une séance (upsert par student_id +
 * sessionKey, voir la contrainte unique sur workout_feedback) : si un
 * retour existe déjà, ses champs sont mis à jour et ses exercices/séries
 * sont remplacés (delete + reinsert, plus simple et tout aussi correct
 * qu'un diff fin vu la fréquence de resoumission) — le statut existant
 * (traité/important) n'est jamais réinitialisé par une mise à jour. Sinon
 * un nouveau retour est créé avec le statut par défaut "a-traiter".
 *
 * `payload.exercises` doit déjà être filtré en amont (un exercice sans
 * aucune série renseignée ne doit pas être transmis), comme le fait
 * SessionFeedbackSection côté mock.
 *
 * ── CE QUE CETTE COUCHE N'ÉCRIT PLUS (migration 20260821090000) ──────────
 * `prescribed_snapshot` : la photographie du PRESCRIT est RECONSTRUITE par
 * la base, à chaque écriture, depuis les lignes de prescription réelles. Un
 * snapshot envoyé d'ici — ou par n'importe quel appel PostgREST direct —
 * n'est même pas lu. Le construire côté client n'aurait donc aucun effet,
 * et laisserait croire à une autorité qui n'existe plus.
 * `status`, `coach_reply`, `session_status`, `submitted_at`, `updated_at`
 * sont dans le même cas : imposés ou dérivés par la base.
 *
 * ── COURSE ENTRE DEUX SOUMISSIONS (migration 20260823090000) ─────────────
 * L'unicité « un élève + une séance = un seul retour » est tenue par un
 * index UNIQUE PARTIEL, donc par PostgreSQL lui-même. La lecture puis
 * écriture ci-dessous ne peut PAS l'assurer : deux requêtes simultanées
 * lisent toutes les deux « aucun retour ». Quand l'index tranche, le
 * perdant reçoit un SQLSTATE 23505 — on relit alors le retour GAGNANT et on
 * poursuit en mise à jour, ce qui est exactement le chemin d'une
 * resoumission ordinaire. Aucun second retour n'est créé, et aucune autre
 * erreur Supabase n'est masquée : seul le code 23505 déclenche ce
 * rattrapage.
 */

/**
 * Collision d'unicité PostgreSQL, et RIEN d'autre. On ne teste ni le
 * message ni le nom de l'index : une panne réseau, un refus RLS ou une
 * violation de CHECK doivent rester des échecs francs, jamais être
 * réinterprétés en « le retour existait déjà ».
 */
function estCollisionUnicite(error: unknown): boolean {
  return typeof error === "object" && error !== null && (error as { code?: unknown }).code === "23505";
}

/** Ce dont la mise à jour a besoin d'un retour déjà en base. */
type RetourExistant = {
  id: string;
  status: string;
  coach_reply: string;
  performed_at: string | null;
};
export async function saveWorkoutFeedback(
  supabase: TypedSupabaseClient,
  payload: WorkoutFeedbackPayload,
): Promise<AdminStudentFeedback | null> {
  const { data: existing, error: lookupError } = await supabase
    .from("workout_feedback")
    .select("id, status, coach_reply, performed_at")
    .eq("student_id", payload.studentId)
    .eq("session_key", payload.sessionKey)
    .maybeSingle();
  devWarn("saveWorkoutFeedback (lookup)", lookupError);

  const now = new Date().toISOString();

  // La date de réalisation est conservée telle que posée à l'ORIGINE ; à
  // défaut, la date (validée) de cette soumission. Elle appartient bien à
  // l'élève : c'est lui qui déclare QUAND il a fait sa séance. Calculée à
  // partir de la ligne RÉELLEMENT visée — qui, en cas de course perdue,
  // n'est pas celle qu'on avait lue au départ.
  const champsHistorique = (ligne: RetourExistant | null) => ({
    performed_at: payload.completed
      ? (ligne?.performed_at ?? sanitizePerformedAt(payload.performedAt))
      : null,
    duration_minutes: sanitizeDurationMinutes(payload.durationMinutes),
  });

  let feedbackId: string;
  let status: FeedbackStatus;
  let coachReply: string;
  // Métadonnées de séance RELUES après écriture. Quand `session_id` est
  // renseigné, la base les DÉRIVE de la séance (migration 20260822090000) :
  // les renvoyer telles qu'envoyées afficherait la version du client, pas
  // celle qui a été enregistrée. On les envoie tout de même, parce qu'elles
  // restent la seule source sur le chemin mock (séance sans `session_id`),
  // et on relit ce que la base a retenu.
  let programId: string | null = payload.programId ?? null;
  let sessionKey: string = payload.sessionKey;
  let refLabel: string = payload.sessionRefLabel;

  // Le retour à mettre à jour : celui trouvé par la clé applicative, ou —
  // après une course perdue — celui que l'index UNIQUE a désigné gagnant.
  let cible: RetourExistant | null = existing ?? null;

  if (!cible) {
    const { data: inserted, error: insertError } = await supabase
      .from("workout_feedback")
      .insert({
        student_id: payload.studentId,
        session_id: payload.sessionId ?? null,
        program_id: payload.programId ?? null,
        session_key: payload.sessionKey,
        session_ref_label: payload.sessionRefLabel,
        completed: payload.completed,
        global_rpe: payload.globalRpe,
        global_comment: payload.globalComment,
        pain: payload.pain,
        ...champsHistorique(null),
      })
      .select("id, status, coach_reply, program_id, session_key, session_ref_label")
      .single();
    devWarn("saveWorkoutFeedback (insert)", insertError);

    if (inserted) {
      programId = inserted.program_id;
      sessionKey = inserted.session_key ?? payload.sessionKey;
      refLabel = inserted.session_ref_label ?? payload.sessionRefLabel;
      feedbackId = inserted.id;
      status = inserted.status as FeedbackStatus;
      coachReply = inserted.coach_reply;
      return await ecrireExercicesEtRendre(supabase, payload, {
        feedbackId, status, coachReply, programId, sessionKey, refLabel, now,
      });
    }

    // COURSE PERDUE. L'index a tranché : un retour existe déjà pour ce
    // couple (élève, séance). On ne crée surtout pas un second retour — on
    // reprend celui qui a gagné, exactement comme une resoumission.
    if (!estCollisionUnicite(insertError) || !payload.sessionId) {
      return null;
    }
    const { data: gagnante, error: relectureError } = await supabase
      .from("workout_feedback")
      .select("id, status, coach_reply, performed_at")
      .eq("student_id", payload.studentId)
      .eq("session_id", payload.sessionId)
      .maybeSingle();
    devWarn("saveWorkoutFeedback (relecture après collision)", relectureError);
    if (!gagnante) {
      // L'index dit qu'une ligne existe, la relecture ne la voit pas :
      // situation contradictoire (RLS, ligne supprimée entre-temps). On
      // échoue franchement plutôt que d'insister.
      return null;
    }
    cible = gagnante as RetourExistant;
  }

  feedbackId = cible.id;
  status = cible.status as FeedbackStatus;
  coachReply = cible.coach_reply;
  const { data: updated, error: updateError } = await supabase
    .from("workout_feedback")
    .update({
      session_id: payload.sessionId ?? null,
      program_id: payload.programId ?? null,
      session_ref_label: payload.sessionRefLabel,
      completed: payload.completed,
      global_rpe: payload.globalRpe,
      global_comment: payload.globalComment,
      pain: payload.pain,
      ...champsHistorique(cible),
    })
    .eq("id", feedbackId)
    .select("id, program_id, session_key, session_ref_label")
    .single();
  devWarn("saveWorkoutFeedback (update)", updateError);
  if (updated) {
    programId = updated.program_id;
    sessionKey = updated.session_key ?? payload.sessionKey;
    refLabel = updated.session_ref_label ?? payload.sessionRefLabel;
  }

  const { error: deleteError } = await supabase.from("exercise_feedback").delete().eq("workout_feedback_id", feedbackId);
  devWarn("saveWorkoutFeedback (delete previous exercises)", deleteError);

  return await ecrireExercicesEtRendre(supabase, payload, {
    feedbackId, status, coachReply, programId, sessionKey, refLabel, now,
  });
}

/**
 * Écrit les exercices et séries réalisés, journalise l'activité, et compose
 * le retour rendu à l'appelant. Extrait de `saveWorkoutFeedback` pour que
 * les DEUX chemins — création et mise à jour, cette dernière incluant le
 * rattrapage d'une course perdue — partagent rigoureusement le même code.
 */
async function ecrireExercicesEtRendre(
  supabase: TypedSupabaseClient,
  payload: WorkoutFeedbackPayload,
  contexte: {
    feedbackId: string;
    status: FeedbackStatus;
    coachReply: string;
    programId: string | null;
    sessionKey: string;
    refLabel: string;
    now: string;
  },
): Promise<AdminStudentFeedback | null> {
  const { feedbackId, status, coachReply, programId, sessionKey, refLabel, now } = contexte;

  const exerciseEntries: AdminExerciseFeedbackEntry[] = [];
  // Les vidéos sont collectées AU NIVEAU DE L'EXERCICE, comme à la lecture :
  // un exercice filmé sans série n'a aucune entrée de série, sa vidéo ne peut
  // donc pas voyager dans `exerciseEntries`.
  const videos: FeedbackVideoEntry[] = [];
  for (const exercise of payload.exercises) {
    // Une ligne est écrite dès qu'elle porte une donnée UTILE — pas
    // seulement des séries. Avant ce correctif, un exercice filmé sans
    // aucune série saisie disparaissait à l'envoi et laissait son fichier
    // orphelin dans le bucket. La règle vit dans lib/workout-feedback-entry.ts,
    // pour être lue et testée seule.
    if (!exerciseFeedbackWorthPersisting(exercise)) continue;
    const { data: exerciseRow, error: exerciseError } = await supabase
      .from("exercise_feedback")
      .insert({
        workout_feedback_id: feedbackId,
        student_id: payload.studentId,
        // `exercise_id` existait depuis l'origine sans jamais être écrit.
        // Il l'est à partir du chantier F3, parce que c'est LUI qui donne au
        // trigger de base l'exercice prescrit dont il faut comparer le
        // pattern. `null` reste normal : séance mock, ou bloc cardio.
        exercise_id: exercise.exerciseId ?? null,
        exercise_name: exercise.exerciseName,
        exercise_order: exercise.exerciseOrder,
        rpe: exercise.rpe,
        comment: exercise.comment,
        // On envoie l'IDENTIFIANT, jamais le nom : le trigger
        // enforce_exercise_feedback_substitution dérive le nom de la banque
        // et refuse tout remplacement qui ne partage pas le pattern.
        substitute_exercise_library_id: exercise.substituteExerciseLibraryId ?? null,
        // Vidéo de technique (F4) : on envoie le CHEMIN rendu par le dépôt.
        // `video_uploaded_at` n'est PAS envoyé — il est dérivé par le
        // trigger, exactement comme substitute_exercise_name.
        video_path: exercise.videoPath ?? null,
      })
      // On RELIT le nom écrit par la base plutôt que de le supposer : c'est
      // la base qui décide, l'écran ne fait qu'afficher sa décision.
      // On RELIT ce que la base a retenu — nom du remplaçant ET chemin de
      // vidéo : c'est elle qui décide, l'écran ne fait qu'afficher sa décision.
      .select("id, substitute_exercise_name, video_path")
      .single();
    devWarn("saveWorkoutFeedback (exercise insert)", exerciseError);
    if (!exerciseRow) continue;

    // On relit le chemin RETENU PAR LA BASE, jamais celui qu'on a envoyé :
    // c'est elle qui refuse un chemin étranger, l'écran ne fait qu'afficher
    // sa décision. L'URL signée, elle, n'est pas fabriquée ici — cet objet
    // sert à rafraîchir l'écran de l'élève, qui la résout lui-même.
    if (exerciseRow.video_path) {
      videos.push({
        exerciseName: exercise.exerciseName,
        realizedName: exerciseRow.substitute_exercise_name ?? exercise.exerciseName,
        videoPath: exerciseRow.video_path,
        videoUrl: null,
      });
    }

    const { error: setsError } = await supabase.from("exercise_set_feedback").insert(
      exercise.sets.map((set) => ({
        exercise_feedback_id: exerciseRow.id,
        student_id: payload.studentId,
        set_number: set.setNumber,
        load_used: set.loadUsed,
        reps_done: set.repsDone,
        // RPE PAR SÉRIE (option B) — null si non saisi, jamais inventé ni
        // moyenné. Le cardio n'émet pas cette clé (rpe de bloc au niveau
        // exercice, inchangé).
        rpe: set.rpe ?? null,
      })),
    );
    devWarn("saveWorkoutFeedback (sets insert)", setsError);

    for (const set of exercise.sets) {
      exerciseEntries.push({
        exerciseName: exercise.exerciseName,
        setNumber: set.setNumber,
        loadUsed: set.loadUsed,
        repsDone: set.repsDone,
        rpe: set.rpe ?? null,
        exerciseRpe: exercise.rpe,
        comment: exercise.comment,
        substituteExerciseName: exerciseRow.substitute_exercise_name,
        substituteExerciseLibraryId: exercise.substituteExerciseLibraryId ?? null,
      });
    }
  }

  await logActivityEvent(supabase, {
    studentId: payload.studentId,
    actorType: "student",
    eventType: "workout_feedback_submitted",
    title: "Retour entraînement envoyé",
    description: payload.sessionRefLabel ? `Retour envoyé pour "${payload.sessionRefLabel}".` : "Retour d'entraînement envoyé.",
    metadata: buildStudentActivityLink(payload.studentId),
  });

  return {
    id: feedbackId,
    studentId: payload.studentId,
    type: "entrainement",
    sessionId: sessionKey,
    programId,
    refLabel: refLabel || "Séance",
    date: now.slice(0, 10),
    completed: payload.completed,
    rpe: payload.globalRpe,
    pain: payload.pain,
    comment: payload.globalComment,
    exerciseEntries,
    videos,
    status,
    coachReply,
    createdAt: now,
    updatedAt: now,
  };
}

export async function updateWorkoutFeedbackStatus(
  supabase: TypedSupabaseClient,
  feedbackId: string,
  status: FeedbackStatus,
): Promise<boolean> {
  const { error } = await supabase
    .from("workout_feedback")
    .update({ status, updated_at: new Date().toISOString() })
    .eq("id", feedbackId);
  devWarn("updateWorkoutFeedbackStatus", error);
  return !error;
}

export function markWorkoutFeedbackReviewed(supabase: TypedSupabaseClient, feedbackId: string): Promise<boolean> {
  return updateWorkoutFeedbackStatus(supabase, feedbackId, "traité");
}

export function markWorkoutFeedbackImportant(supabase: TypedSupabaseClient, feedbackId: string): Promise<boolean> {
  return updateWorkoutFeedbackStatus(supabase, feedbackId, "important");
}

/**
 * La réponse du coach : texte, vidéo, ou les deux. Marque le retour "traité".
 *
 * ── POURQUOI UN OBJET, ET PAS UN TROISIÈME PARAMÈTRE ────────────────────────
 * La réponse a trois faces désormais (texte, chemin de vidéo, calque
 * d'annotations) et elles se posent ENSEMBLE, en une seule écriture. Les
 * séparer en plusieurs appels laisserait exister, entre les deux, un retour
 * portant une vidéo sans son calque — que l'élève pourrait ouvrir.
 *
 * ── CE QU'ON N'ENVOIE PAS ───────────────────────────────────────────────────
 * `coach_reply_video_uploaded_at` n'est pas dans le type `Update` de
 * `workout_feedback` : ce n'est pas un oubli, c'est la règle rendue
 * inexprimable. Le gardien la DÉRIVE (`clock_timestamp()` au moment où le
 * chemin apparaît ou change), et c'est elle qui déclenche la purge à 3 jours.
 * Qui pourrait l'écrire pourrait garder sa vidéo indéfiniment.
 *
 * ── LE CALQUE EST RECONSTRUIT AVANT D'ÊTRE ENVOYÉ ───────────────────────────
 * `serialiserAnnotations` ne transmet pas l'objet de l'éditeur tel quel : il
 * le rebâtit champ par champ, pour qu'aucune propriété parasite ne se
 * retrouve stockée, et arrondit les coordonnées. Un calque vide part en
 * `null` plutôt qu'en tableau vide — la base refuse d'ailleurs un calque sans
 * vidéo, et « aucune annotation » n'est pas « un tableau de rien ».
 */
export async function updateWorkoutFeedbackCoachReply(
  supabase: TypedSupabaseClient,
  feedbackId: string,
  reponse: ReponseCoach,
): Promise<boolean> {
  const majVideo =
    reponse.videoPath === undefined
      ? {}
      : {
          coach_reply_video_path: reponse.videoPath,
          // Retirer la vidéo emporte son calque : la contrainte
          // `..._annotations_sans_video` refuserait la ligne autrement, et un
          // calque orphelin ne se rejoue par-dessus rien.
          coach_reply_video_annotations:
            reponse.videoPath && reponse.annotations && reponse.annotations.length > 0
              ? serialiserAnnotations(reponse.annotations)
              : null,
        };

  const { error } = await supabase
    .from("workout_feedback")
    .update({
      coach_reply: reponse.texte,
      status: "traité",
      updated_at: new Date().toISOString(),
      ...majVideo,
    })
    .eq("id", feedbackId);
  devWarn("updateWorkoutFeedbackCoachReply", error);
  return !error;
}
