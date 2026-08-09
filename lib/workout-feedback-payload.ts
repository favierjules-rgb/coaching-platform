import { hasRealizedSetInput, parseRpeInput } from "@/lib/previous-performance";
import { isUuid } from "@/lib/uuid";
import type {
  ExerciseFeedback,
  ExerciseFeedbackPayload,
  ExerciseSubstituteOption,
  WorkoutFeedbackPayload,
} from "@/types";

/**
 * LE RETOUR DE SÉANCE — UN SEUL CONSTRUCTEUR, POUR LES DEUX CHEMINS.
 *
 * ════════════════════════════════════════════════════════════════════════
 * POURQUOI CETTE FONCTION EXISTE
 * ════════════════════════════════════════════════════════════════════════
 * Jusqu'ici, le payload était fabriqué à l'intérieur de
 * `SessionFeedbackSection.handleSubmit`. Tant qu'il n'y avait qu'un chemin,
 * c'était sans conséquence. Il y en a désormais deux — l'envoi immédiat et
 * la mise en file hors ligne — et deux constructions distinctes finiraient
 * par diverger.
 *
 * La divergence serait silencieuse et à retardement : un champ ajouté au
 * formulaire, branché sur le chemin en ligne, oublié sur l'autre. Les
 * séances faites en salle — hors ligne, précisément — partiraient amputées,
 * et personne ne s'en apercevrait avant de comparer deux retours.
 *
 * Ce fichier est donc l'UNIQUE endroit où un `WorkoutFeedbackPayload` est
 * composé. Il ne connaît ni React, ni `fetch`, ni IndexedDB : il transforme
 * un état de formulaire en payload, ou refuse en disant pourquoi.
 *
 * ════════════════════════════════════════════════════════════════════════
 * DEUX FORMES, ET LA DIFFÉRENCE COMPTE
 * ════════════════════════════════════════════════════════════════════════
 * `WorkoutFeedbackPayload` porte `studentId` : le dépôt local en a besoin
 * pour savoir de qui est cette opération, y compris après un redémarrage.
 *
 * Le CORPS envoyé au serveur, lui, ne doit PAS le porter :
 * `workoutFeedbackPayloadSchema` est `.strict()` et n'accepte pas cette
 * clé — l'identité élève est dérivée de la session authentifiée, jamais
 * acceptée du client. D'où `corpsPourServeur`, qui retire exactement ce
 * champ. C'est aussi ce qui garantit qu'une opération sortie de l'outbox
 * six heures plus tard produit le même corps qu'un envoi immédiat.
 */

/* ════════════════════════════════════════════════════════════════════════
 * I. CE QUE LE FORMULAIRE FOURNIT
 * ════════════════════════════════════════════════════════════════════════ */

export interface EtatFormulaireRetour {
  /** Saisies de musculation, indexées par `workout_exercises.id`. */
  exerciseFeedback: Record<string, ExerciseFeedback>;
  /**
   * Blocs cardio DÉJÀ sérialisés par `lib/cardio-feedback.ts`.
   *
   * Ils arrivent construits : la conversion des brouillons cardio, avec ses
   * virgules françaises et ses erreurs par bloc, reste où elle est. La
   * dupliquer ici ferait exactement ce que ce fichier existe pour empêcher.
   */
  cardioPayloads: ExerciseFeedbackPayload[];
  /** Remplacements choisis, par `workout_exercises.id`. */
  substitutions: Record<string, ExerciseSubstituteOption | null>;
  /** Chemins de vidéo déjà déposés, par `workout_exercises.id`. */
  videosExercice: Record<string, string | null>;
  completed: boolean;
  /** Champ brut du formulaire : `""` = non saisi. */
  globalRpe: string;
  globalComment: string;
  /** Douleur, déjà composée (structurée pour le cardio, libre sinon). */
  painText: string;
  /** Champ brut « Durée de la séance » : `""` = non renseignée. */
  durationMinutes: string;
}

export interface ContexteRetour {
  /** `students.id` — pour le dépôt local uniquement (voir `corpsPourServeur`). */
  studentId: string;
  sessionKey: string;
  sessionRefLabel: string;
  /** `workout_sessions.id` s'il s'agit d'une vraie séance, sinon `null`. */
  sessionId: string;
  programId: string | null;
  /**
   * Date métier de la SÉANCE — jamais « maintenant ».
   *
   * Fournie par l'appelant depuis `datePourRetour(brouillon, snapshot)` :
   * une séance ouverte dimanche 23 h 50 et validée lundi 00 h 20 reste une
   * séance de dimanche. Recalculer ici, au moment du clic, la déplacerait
   * d'un jour pour la seule raison que l'heure a changé.
   */
  performedAt: string;
  /**
   * La construction a-t-elle lieu SANS RÉSEAU ?
   *
   * Une seule conséquence, et elle concerne les vidéos (voir plus bas).
   * Tout le reste du payload est identique dans les deux cas — c'est la
   * raison d'être de ce fichier.
   */
  horsLigne?: boolean;
  /**
   * Chemins de vidéo DÉJÀ déposés dans le bucket, connus du retour existant
   * ou du snapshot.
   *
   * Hors ligne, un `videoPath` absent de cette liste ne peut pas exister :
   * aucun fichier n'a pu être téléversé. Le laisser passer reviendrait à
   * envoyer au serveur un chemin qui ne désigne rien.
   */
  cheminsVideoConnus?: readonly string[];
}

export type ResultatConstruction =
  | {
      ok: true;
      payload: WorkoutFeedbackPayload;
      /**
       * Chemins de vidéo écartés parce qu'ils ne pouvaient pas exister hors
       * ligne. À signaler discrètement — jamais à traiter comme un échec :
       * une vidéo ne doit pas empêcher d'enregistrer une séance.
       */
      videosIgnorees: string[];
    }
  /** Message destiné à l'élève — précis, et sans rien effacer de sa saisie. */
  | { ok: false; erreur: string };

/* ════════════════════════════════════════════════════════════════════════
 * II. LA DURÉE DÉCLARÉE
 * ════════════════════════════════════════════════════════════════════════
 * Déclarée, jamais mesurée. Pas de chronomètre, pas de `startedAt`, aucun
 * calcul à partir du temps pendant lequel la PWA est restée ouverte : une
 * séance d'une heure laissée trois heures dans une poche resterait une
 * séance d'une heure.
 *
 * `sanitizeDurationMinutes` reste l'autorité côté serveur ; ici on refuse
 * VISIBLEMENT ce qui sortirait des bornes, plutôt que de laisser le serveur
 * transformer silencieusement une faute de frappe en `null`.
 */
export function analyserDuree(brut: string): { ok: true; minutes: number | null } | { ok: false } {
  const valeur = brut.trim();
  if (valeur === "") return { ok: true, minutes: null };
  if (!/^\d{1,3}$/.test(valeur)) return { ok: false };
  const minutes = Number(valeur);
  if (!Number.isInteger(minutes) || minutes < 1 || minutes > 600) return { ok: false };
  return { ok: true, minutes };
}

/* ════════════════════════════════════════════════════════════════════════
 * III. LE CONSTRUCTEUR
 * ════════════════════════════════════════════════════════════════════════ */

export function construireWorkoutFeedbackPayload(
  etat: EtatFormulaireRetour,
  contexte: ContexteRetour,
): ResultatConstruction {
  // ── RPE PAR SÉRIE : validé AVANT toute composition ──────────────────
  // Aucune valeur écrêtée, aucune valeur inventée : "" reste `null` (série
  // sans RPE acceptée), et tout ce qui n'est pas un entier 1-10 arrête la
  // construction avec un message qui désigne la série fautive.
  const rpeParSerie = new Map<string, number | null>();
  for (const exerciseFb of Object.values(etat.exerciseFeedback)) {
    for (const set of exerciseFb.sets) {
      const parsed = parseRpeInput(set.rpe);
      if (!parsed.ok) {
        return {
          ok: false,
          erreur: `RPE invalide (série ${set.setNumber} — ${exerciseFb.exerciseName}) : saisis un entier de 1 à 10, ou laisse vide.`,
        };
      }
      rpeParSerie.set(`${exerciseFb.exerciseId}#${set.setNumber}`, parsed.rpe);
    }
  }

  const duree = analyserDuree(etat.durationMinutes);
  if (!duree.ok) {
    return {
      ok: false,
      erreur: "Durée invalide : saisis un nombre entier de minutes entre 1 et 600, ou laisse vide.",
    };
  }

  /* ── VIDÉOS : RIEN DE NEUF NE PEUT NAÎTRE HORS LIGNE ─────────────────
   * F4/F5 restent online-only. Hors ligne il n'y a ni téléversement, ni
   * Blob, ni chemin fabriqué localement : un `videoPath` inconnu est donc
   * un chemin qui ne désigne aucun fichier. On l'écarte — SANS bloquer le
   * reste du retour, qui n'a rien à voir avec une vidéo.
   *
   * Un chemin DÉJÀ enregistré, lui, est reconduit tel quel : c'est même
   * indispensable, puisqu'une re-soumission remplace les lignes d'exercice
   * et rendrait le fichier orphelin s'il n'était pas renvoyé. */
  const connus = new Set(contexte.cheminsVideoConnus ?? []);
  const videosIgnorees: string[] = [];
  const videoRetenue = (exerciseId: string): string | null => {
    const chemin = etat.videosExercice[exerciseId] ?? null;
    if (chemin === null) return null;
    if (contexte.horsLigne !== true) return chemin;
    if (connus.has(chemin)) return chemin;
    videosIgnorees.push(chemin);
    return null;
  };

  const exercises: ExerciseFeedbackPayload[] = Object.values(etat.exerciseFeedback)
    .map((exerciseFb, index) => ({
      exerciseName: exerciseFb.exerciseName,
      exerciseOrder: index,
      // `exerciseFb.exerciseId` EST `workout_exercises.id`. Transmis
      // seulement quand c'est un uuid réel — une séance mock n'en a pas.
      exerciseId: isUuid(exerciseFb.exerciseId) ? exerciseFb.exerciseId : null,
      // L'IDENTIFIANT du remplaçant, jamais son nom : la base le dérive
      // elle-même et revalide l'admissibilité. Une substitution choisie hors
      // ligne repart donc par le chemin normal et reste revalidable.
      substituteExerciseLibraryId: etat.substitutions[exerciseFb.exerciseId]?.id ?? null,
      // Le CHEMIN déjà déposé dans le bucket, jamais une URL — et jamais un
      // chemin qui n'aurait pas pu être créé (voir `videoRetenue`).
      videoPath: videoRetenue(exerciseFb.exerciseId),
      // Option B : le RPE de musculation vit PAR SÉRIE. Aucune moyenne,
      // aucune valeur globale recopiée au niveau exercice.
      rpe: null,
      comment: exerciseFb.comment,
      // Seules les séries réellement SAISIES partent : un repère
      // « Dernières perfs » ne vit que dans un `placeholder`.
      sets: exerciseFb.sets.filter(hasRealizedSetInput).map((set) => ({
        setNumber: set.setNumber,
        loadUsed: set.loadUsed,
        repsDone: set.repsDone,
        rpe: rpeParSerie.get(`${exerciseFb.exerciseId}#${set.setNumber}`) ?? null,
      })),
    }))
    .filter((exerciseFb) => exerciseFb.sets.length > 0);

  // Le cardio est ajouté APRÈS la musculation, comme le veut le contrat
  // historique (`exerciseOrder = 900 + position du bloc`).
  exercises.push(...etat.cardioPayloads);

  return {
    ok: true,
    videosIgnorees,
    payload: {
      studentId: contexte.studentId,
      sessionKey: contexte.sessionKey,
      sessionRefLabel: contexte.sessionRefLabel,
      completed: etat.completed,
      globalRpe: etat.globalRpe === "" ? null : Number(etat.globalRpe),
      globalComment: etat.globalComment,
      pain: etat.painText,
      exercises,
      sessionId: isUuid(contexte.sessionId) ? contexte.sessionId : null,
      programId: isUuid(contexte.programId) ? contexte.programId : null,
      performedAt: contexte.performedAt,
      durationMinutes: duree.minutes,
    },
  };
}

/* ════════════════════════════════════════════════════════════════════════
 * IV. LE CORPS ENVOYÉ AU SERVEUR
 * ════════════════════════════════════════════════════════════════════════ */

/** Le corps exact attendu par `POST /api/student/workout-feedback`. */
export type CorpsWorkoutFeedback = Omit<WorkoutFeedbackPayload, "studentId">;

/**
 * Retire `studentId`, et lui seul.
 *
 * Le schéma de la route est `.strict()` : envoyer cette clé ferait échouer
 * la requête en 400. Ce n'est pas une contrainte technique gênante, c'est la
 * règle elle-même — le client n'a jamais eu le droit de dire de qui est un
 * retour, et il ne l'acquiert pas en passant hors ligne.
 *
 * Conséquence directe : une opération sortie de l'outbox six heures plus
 * tard produit exactement le corps qu'aurait produit un envoi immédiat.
 */
export function corpsPourServeur(payload: WorkoutFeedbackPayload): CorpsWorkoutFeedback {
  const { studentId: _ignore, ...corps } = payload;
  void _ignore;
  return corps;
}
