import type { SupabaseClient } from "@supabase/supabase-js";

import { buildStudentActivityLink, logActivityEvent } from "@/lib/supabase/activity";
import type {
  AdminExerciseFeedbackEntry,
  AdminStudentFeedback,
  FeedbackStatus,
  FeedbackVideoEntry,
  SupabaseExerciseFeedback,
  SupabaseExerciseSetFeedback,
  SupabaseWorkoutFeedback,
  WorkoutFeedbackPayload,
} from "@/types";
import type { Database } from "@/types/supabase";
import { loadSignedFeedbackVideoUrls } from "@/lib/supabase/storage-feedback-videos";
import { exerciseFeedbackWorthPersisting } from "@/lib/workout-feedback-entry";
import { sanitizeDurationMinutes, sanitizePerformedAt } from "@/lib/workout-history";

/**
 * Couche d'accès aux retours d'entraînement Supabase (tables
 * `workout_feedback`, `exercise_feedback`, `exercise_set_feedback`).
 *
 * Comme lib/supabase/students.ts, toutes les lectures renvoient un résultat
 * "vide" (jamais d'exception) aussi bien quand Supabase n'a réellement
 * aucune donnée qu'en cas d'erreur (RLS, réseau...) — warning dev
 * uniquement, jamais bloquant, pour préserver le repli mock/localStorage.
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

function devWarn(context: string, error: { message: string } | null): void {
  if (error && process.env.NODE_ENV === "development") {
    console.warn(`[Supabase] ${context} :`, error.message);
  }
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
function toAdminStudentFeedback(
  feedback: SupabaseWorkoutFeedback,
  exercises: SupabaseExerciseFeedback[],
  setsByExerciseFeedbackId: Map<string, SupabaseExerciseSetFeedback[]>,
  /**
   * Démonstrations ACTUELLES des remplaçants, par id de fiche de banque.
   * Vide par défaut : seule la lecture destinée à l'écran de l'élève
   * (getWorkoutFeedbackBySession) paie la requête supplémentaire — les
   * listes du coach n'affichent aucune vidéo.
   */
  substituteVideos: Map<string, string> = new Map(),
  /**
   * URLs signées des vidéos d'élève, par chemin. Vide par défaut, pour la
   * même raison que `substituteVideos` : seuls les écrans qui affichent
   * réellement la vidéo paient les signatures.
   */
  videoUrls: Map<string, string> = new Map(),
): AdminStudentFeedback {
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

/** Récupère et regroupe les exercices/séries de un ou plusieurs retours en un minimum de requêtes. */
async function loadExercisesAndSets(
  supabase: TypedSupabaseClient,
  workoutFeedbackIds: string[],
): Promise<{
  exercisesByFeedbackId: Map<string, SupabaseExerciseFeedback[]>;
  setsByExerciseFeedbackId: Map<string, SupabaseExerciseSetFeedback[]>;
}> {
  if (workoutFeedbackIds.length === 0) {
    return { exercisesByFeedbackId: new Map(), setsByExerciseFeedbackId: new Map() };
  }

  const { data: exerciseRows, error: exerciseError } = await supabase
    .from("exercise_feedback")
    .select("*")
    .in("workout_feedback_id", workoutFeedbackIds);
  devWarn("loadExercisesAndSets (exercise_feedback)", exerciseError);
  const exercises = (exerciseRows ?? []).map(mapExerciseFeedbackRow);

  const exerciseIds = exercises.map((exercise) => exercise.id);
  const { data: setRows, error: setsError } =
    exerciseIds.length > 0
      ? await supabase.from("exercise_set_feedback").select("*").in("exercise_feedback_id", exerciseIds)
      : { data: [] as ExerciseSetFeedbackRow[], error: null };
  devWarn("loadExercisesAndSets (exercise_set_feedback)", setsError);
  const sets = (setRows ?? []).map(mapExerciseSetFeedbackRow);

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

  return { exercisesByFeedbackId, setsByExerciseFeedbackId };
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
  const { exercisesByFeedbackId, setsByExerciseFeedbackId } = await loadExercisesAndSets(supabase, [feedback.id]);
  const exercises = exercisesByFeedbackId.get(feedback.id) ?? [];
  // SEULE lecture qui résout les démonstrations : c'est celle qui alimente
  // l'écran où l'élève rouvre son retour pour le modifier.
  const videos = await loadSubstituteVideos(supabase, exercises);
  const videosEleve = await loadFeedbackVideoUrls(supabase, exercises);
  return toAdminStudentFeedback(feedback, exercises, setsByExerciseFeedbackId, videos, videosEleve);
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
  const { exercisesByFeedbackId, setsByExerciseFeedbackId } = await loadExercisesAndSets(
    supabase,
    feedbacks.map((f) => f.id),
  );
  // C'EST CE CHEMIN QUE LE COACH EMPRUNTE. /admin/retours affiche cette
  // liste, et c'est depuis une de ses lignes que FeedbackDetailModal s'ouvre
  // — il n'existe aucun second chargement « de détail ». Les URLs sont donc
  // signées ici, EN UNE SEULE requête pour toute la page (createSignedUrls),
  // et seulement pour les vidéos que la RLS accorde à CE coach.
  const videoUrls = await loadFeedbackVideoUrls(supabase, [...exercisesByFeedbackId.values()].flat());
  return feedbacks.map((feedback) =>
    toAdminStudentFeedback(
      feedback,
      exercisesByFeedbackId.get(feedback.id) ?? [],
      setsByExerciseFeedbackId,
      new Map(),
      videoUrls,
    ),
  );
}

/** Retours Supabase d'un élève précis, pour la section "Retours récents" de /admin/eleves/[studentId]. */
export async function getWorkoutFeedbackForStudent(
  supabase: TypedSupabaseClient,
  studentId: string,
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
  const { exercisesByFeedbackId, setsByExerciseFeedbackId } = await loadExercisesAndSets(
    supabase,
    feedbacks.map((f) => f.id),
  );
  return feedbacks.map((feedback) =>
    toAdminStudentFeedback(feedback, exercisesByFeedbackId.get(feedback.id) ?? [], setsByExerciseFeedbackId),
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

/** Comme useAdminData().addCoachReply côté mock : enregistre la réponse et marque le retour "traité". */
export async function updateWorkoutFeedbackCoachReply(
  supabase: TypedSupabaseClient,
  feedbackId: string,
  reply: string,
): Promise<boolean> {
  const { error } = await supabase
    .from("workout_feedback")
    .update({ coach_reply: reply, status: "traité", updated_at: new Date().toISOString() })
    .eq("id", feedbackId);
  devWarn("updateWorkoutFeedbackCoachReply", error);
  return !error;
}
