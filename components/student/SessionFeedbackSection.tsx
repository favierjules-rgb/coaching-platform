"use client";

import { useCallback, useEffect, useMemo, useRef, useState, type FormEvent } from "react";
import { resolvePrescription } from "@/lib/workout-history";
import {
  analyserDuree,
  construireWorkoutFeedbackPayload,
  corpsPourServeur,
} from "@/lib/workout-feedback-payload";
import { choisirOrigineFormulaire } from "@/lib/offline/priorite-etat";
import { soumettreRetour } from "@/lib/offline/soumission";
import { useBrouillonSeance } from "@/hooks/useBrouillonSeance";
import { useSynchronisation } from "@/hooks/useSynchronisation";
import type { DepotOffline } from "@/lib/offline/depot";
import type { Transport } from "@/lib/offline/synchronisateur";
import {
  buildPreviousPerformanceIndex,
  findPreviousPerformance,
  hasRealizedSetInput,
  normalizeExerciseName,
  parseRpeInput,
} from "@/lib/previous-performance";

import { ExerciseFeedbackCard } from "@/components/student/ExerciseFeedbackCard";
import { SessionCompletionCard } from "@/components/student/SessionCompletionCard";
import { StudentSessionBlockList } from "@/components/student/StudentSessionBlockList";
import { TrainingStatCards } from "@/components/shared/TrainingMetricsSummary";
import { useAdminData } from "@/hooks/useAdminData";
import { useSupabaseWorkoutFeedback } from "@/hooks/useSupabaseWorkoutFeedback";
import { CardioBlockFeedbackForm } from "@/components/student/CardioBlockFeedbackForm";
import {
  PAIN_LEVELS,
  cardioBlockPrescribedSnapshot,
  composePainText,
  draftFromBlockResult,
  emptyCardioBlockDraft,
  isBlockResultEmpty,
  isCardioResultEntryName,
  parseCardioResults,
  realizedFromDraft,
  serializeCardioBlockResult,
  type CardioBlockDraft,
  type CardioBlockResult,
  type PainLevel,
} from "@/lib/cardio-feedback";
import { cardioTypeLabels, formatDistanceMeters, formatDurationSeconds } from "@/lib/cardio";
import { orderedStrengthExercises, orderedStudentSessionBlocks, type StudentSessionBlockView } from "@/lib/student-session-blocks";
import { calculatePlannedVsActualMetrics, formatTonnage } from "@/lib/training-metrics";
import { construireBilanFinSeance } from "@/lib/session-completion";
import type {
  ActualSetEntry,
  AdminCardioBlock,
  AdminExerciseFeedbackEntry,
  AdminStudentFeedback,
  Exercise,
  ExerciseFeedback,
  ExerciseFeedbackPayload,
  ExerciseSubstituteOption,
  TrainingBlock,
} from "@/types";

const rpeOptions = Array.from({ length: 10 }, (_, index) => index + 1);

function buildInitialFeedback(
  exercises: Exercise[],
  studentId: string,
  sessionId: string,
): Record<string, ExerciseFeedback> {
  return Object.fromEntries(
    exercises.map((exercise) => [
      exercise.id,
      {
        studentId,
        sessionId,
        exerciseId: exercise.id,
        exerciseName: exercise.name,
        sets: Array.from({ length: exercise.sets }, (_, index) => ({
          studentId,
          sessionId,
          exerciseId: exercise.id,
          setNumber: index + 1,
          loadUsed: "",
          repsDone: "",
          // Option B : RPE saisi PAR SÉRIE ("" = non saisi, jamais inventé).
          rpe: "",
        })),
        rpe: null,
        comment: "",
      },
    ]),
  );
}

/**
 * LE BROUILLON, TEL QU'IL EST ÉCRIT SUR LE DISQUE.
 *
 * Exactement les champs que l'élève saisit — et RIEN d'autre. Aucune colonne
 * du coach (`status`, `coachReply`, `prescribedSnapshot`) n'entre ici : ce
 * sont des données que le serveur produit et protège, et les rendre
 * éditables localement reviendrait à proposer à l'élève de les réécrire.
 */
interface EtatBrouillonSeance {
  exerciseFeedback: Record<string, ExerciseFeedback>;
  substitutions: Record<string, ExerciseSubstituteOption | null>;
  videosExercice: Record<string, string | null>;
  blockDrafts: Record<string, CardioBlockDraft>;
  completed: boolean;
  globalRpe: string;
  globalComment: string;
  pain: string;
  painLevel: PainLevel;
  painDetail: string;
  durationMinutes: string;
}

/**
 * CE BROUILLON A-T-IL LA FORME D'UN ÉTAT DE FORMULAIRE ?
 *
 * ════════════════════════════════════════════════════════════════════════
 * BUG TROUVÉ PAR LE HARNAIS REACT (09/08/2026)
 * ════════════════════════════════════════════════════════════════════════
 * Le magasin `training_draft` reçoit DEUX formes différentes :
 *
 *   • l'autosave y écrit l'état du FORMULAIRE (`EtatBrouillonSeance`, où
 *     `globalRpe` et `durationMinutes` sont des chaînes de saisie) ;
 *   • `validerRetourHorsLigne` y écrit, dans la même transaction que
 *     l'outbox, le PAYLOAD validé (`WorkoutFeedbackPayload`, où `globalRpe`
 *     vaut `8` et `durationMinutes` vaut `65` — des nombres).
 *
 * Après une validation hors ligne, rouvrir la séance faisait donc hydrater
 * le formulaire avec un payload : `analyserDuree` appelait `.trim()` sur un
 * nombre, et l'écran entier tombait — sur la séance que l'élève venait
 * précisément de mettre à l'abri.
 *
 * Ce contrôle refuse d'hydrater ce qui n'est pas un état de formulaire. Le
 * retour n'est pas perdu pour autant : il attend dans l'outbox, le bandeau
 * le dit, et la synchronisation l'enverra.
 */
function estEtatBrouillonSeance(valeur: unknown): valeur is EtatBrouillonSeance {
  if (typeof valeur !== "object" || valeur === null) return false;
  const b = valeur as Partial<EtatBrouillonSeance>;
  return (
    typeof b.globalRpe === "string" &&
    typeof b.globalComment === "string" &&
    typeof b.durationMinutes === "string" &&
    typeof b.completed === "boolean" &&
    typeof b.exerciseFeedback === "object" &&
    b.exerciseFeedback !== null
  );
}

function actualEntriesFromExerciseEntries(entries: AdminExerciseFeedbackEntry[]): ActualSetEntry[] {
  return entries.map((entry) => ({
    exerciseName: entry.exerciseName,
    setNumber: entry.setNumber,
    loadUsed: entry.loadUsed,
    repsDone: entry.repsDone,
  }));
}

function PlannedVsActualSummary({
  exercises,
  sessionId,
  sessionMuscleGroup,
  exerciseEntries,
}: {
  exercises: Exercise[];
  sessionId: string;
  sessionMuscleGroup: string;
  exerciseEntries: AdminExerciseFeedbackEntry[];
}) {
  const plannedVsActual = calculatePlannedVsActualMetrics(
    { id: sessionId, muscleGroup: sessionMuscleGroup, exercises },
    actualEntriesFromExerciseEntries(exerciseEntries),
  );

  if (!plannedVsActual.actual) {
    return null;
  }

  return (
    <div className="border border-border bg-card p-6">
      <h3 className="mb-4 font-heading text-sm font-bold uppercase text-foreground">
        Prévu vs réalisé
      </h3>
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
        <div className="border border-border p-4">
          <span className="mb-2 block text-[11px] uppercase tracking-widest text-muted-foreground">Prévu</span>
          <TrainingStatCards
            totalSets={plannedVsActual.planned.totalSets}
            totalVolume={plannedVsActual.planned.totalVolume}
            totalTonnageKg={plannedVsActual.planned.totalTonnageKg}
          />
        </div>
        <div className="border border-primary/40 p-4">
          <span className="mb-2 block text-[11px] uppercase tracking-widest text-primary">Réalisé</span>
          <TrainingStatCards
            totalSets={plannedVsActual.actual.totalSets}
            totalVolume={plannedVsActual.actual.totalVolume}
            totalTonnageKg={plannedVsActual.actual.totalTonnageKg}
          />
        </div>
      </div>
      {plannedVsActual.tonnageDeltaKg !== null && (
        <p className="mt-4 text-sm text-foreground">
          Tonnage réalisé : {formatTonnage(plannedVsActual.actual.totalTonnageKg)} / prévu :{" "}
          {formatTonnage(plannedVsActual.planned.totalTonnageKg)}{" "}
          <span className={plannedVsActual.tonnageDeltaKg >= 0 ? "text-success" : "text-destructive"}>
            ({plannedVsActual.tonnageDeltaKg >= 0 ? "+" : ""}
            {Math.round(plannedVsActual.tonnageDeltaKg).toLocaleString("fr-FR")} kg)
          </span>
        </p>
      )}
    </div>
  );
}

interface SessionFeedbackSectionProps {
  studentId: string;
  sessionId: string;
  programId: string | null;
  sessionRefLabel: string;
  /** Source CANONIQUE du rendu du détail : liste ordonnée de blocs (`session.blocks[]`). */
  blocks?: TrainingBlock[];
  /** Legacy — utilisé UNE seule fois si `blocks[]` est absent (ancienne séance). */
  exercises?: Exercise[];
  cardioBlocks?: AdminCardioBlock[];
  sessionMuscleGroup: string;
  /* ══════════════════════════════════════════════════════════════════════
   * BRANCHEMENT HORS LIGNE — TOUT EST OPTIONNEL
   * ══════════════════════════════════════════════════════════════════════
   * Sans ces props, le composant se comporte EXACTEMENT comme avant : même
   * chemin Supabase, même repli mock, même formulaire. C'est ce qui rend ce
   * branchement incrémental — la page de séance peut les fournir, les
   * autres appelants (démonstration, historique) n'ont rien à changer.
   *
   * `source` est l'état explicite rendu par `useSeanceHorsLigne`. Le
   * composant ne fait donc PLUS `if (!active) useMock()` : une erreur
   * serveur n'est pas une absence de configuration.
   */
  source?: "supabase" | "offline";
  /** Id Auth — clé du dépôt local. Sans lui, aucune écriture locale. */
  authUserId?: string | null;
  /** Date métier de la SÉANCE — celle qui figera `performedAt`. */
  businessDate?: string;
  /** Chemins de vidéo déjà déposés, connus du retour existant ou du snapshot. */
  cheminsVideoConnus?: readonly string[];
  /**
   * Options de remplacement, lisibles SANS réseau.
   *
   * `useSeanceHorsLigne` les sert depuis le snapshot ; le sélecteur accepte
   * déjà ce chargeur injectable, il n'a pas été modifié.
   */
  chargerRemplacants?: (exerciseLibraryId: string) => Promise<ExerciseSubstituteOption[]>;
  /**
   * SEAM DE TEST — le dépôt local à utiliser.
   *
   * En production, `undefined` : le hook construit lui-même un
   * `DepotOffline(new MoteurIndexedDB())` sur la base de l'élève. Le harnais
   * React/Chromium, lui, injecte un dépôt visant une base jetable (ou un
   * moteur volontairement en panne, pour P12).
   *
   * C'est le MÊME code produit qui tourne dans les deux cas — seule la base
   * visée change, par la seam de test du moteur (voir `lib/offline/idb.ts`).
   */
  depot?: DepotOffline;
  /**
   * SEAM DE TEST — le transport de synchronisation.
   *
   * En production, `undefined` : le hook utilise le chemin serveur existant
   * (`POST /api/student/workout-feedback` puis relecture Supabase). Le
   * harnais injecte un transport qu'il pilote.
   */
  transport?: Transport;
}

/**
 * Formulaire de retour élève par séance. Persisté en mock/localStorage via
 * useAdminData (même source que /admin/retours) : un retour envoyé ici est
 * converti en AdminStudentFeedback (type "entrainement") et apparaît
 * immédiatement côté coach. Si un retour existe déjà pour cette séance
 * (rechargement de page, ou déjà envoyé plus tôt), on affiche directement
 * le récapitulatif au lieu du formulaire vierge — un élève ne peut pas
 * envoyer deux retours pour la même séance.
 */
export function SessionFeedbackSection({
  studentId,
  sessionId,
  programId,
  sessionRefLabel,
  blocks,
  exercises,
  cardioBlocks,
  sessionMuscleGroup,
  source,
  authUserId = null,
  businessDate,
  cheminsVideoConnus,
  chargerRemplacants,
  depot,
  transport,
}: SessionFeedbackSectionProps) {
  const horsLigne = source === "offline";
  // Normalisation UNIQUE à la frontière : `blocks[]` si présent, sinon legacy.
  // Le rendu (liste ordonnée + état de retour + analyse) ne manipule ensuite
  // QUE `blockViews` / `strengthExercises`.
  const blockViews = orderedStudentSessionBlocks({ blocks, exercises, cardioBlocks });
  const strengthExercises = orderedStrengthExercises(blockViews);
  // Retour cardio (correction fonctionnelle 25/07/2026) : dès qu'une séance
  // contient au moins un bloc cardio, l'élève peut saisir durée / distance /
  // D+ réellement réalisés — repères prescrits calculés depuis les segments.
  const hasCardio = blockViews.some((view) => view.kind === "cardio");
  // Blocs cardio AVEC leur position réelle dans la séance (ordre de
  // blockViews) et un libellé d'affichage — l'IDENTITÉ reste view.id (UUID
  // stable du bloc), jamais le titre ni l'index : deux blocs peuvent
  // s'appeler tous deux « Effort continu ».
  const cardioItems: { view: Extract<StudentSessionBlockView, { kind: "cardio" }>; order: number; label: string }[] = [];
  blockViews.forEach((view, index) => {
    if (view.kind === "cardio") {
      cardioItems.push({
        view,
        order: index,
        label: `Bloc ${cardioItems.length + 1} — ${view.title || cardioTypeLabels[view.cardioType]}`,
      });
    }
  });

  const { state, addFeedback } = useAdminData();
  const mockExistingFeedback = state.feedback.find(
    (f) => f.studentId === studentId && f.sessionId === sessionId && f.type === "entrainement",
  );

  // Supabase a la priorité dès qu'un compte élève réel est identifié pour
  // l'utilisateur connecté ; sinon (Supabase non configuré, personne
  // connecté, ou compte sans fiche élève) on continue sur le mock/localStorage
  // existant (useAdminData) — voir hooks/useSupabaseWorkoutFeedback.ts.
  const supabaseFeedback = useSupabaseWorkoutFeedback(sessionId);
  /**
   * Y a-t-il une opération EN ATTENTE pour cette séance ?
   *
   * Lu dans IndexedDB, jamais déduit du résultat d'un POST. C'est la
   * différence entre « le serveur a répondu OK » et « il ne reste plus rien
   * à envoyer » : quand une correction B a remplacé A pendant l'envoi, le
   * POST réussit ET l'outbox reste pleine. Le bandeau doit alors rester.
   *
   * ────────────────────────────────────────────────────────────────────
   * TROIS VALEURS, ET `null` EST LA PLUS IMPORTANTE
   * ────────────────────────────────────────────────────────────────────
   * BUG TROUVÉ PAR LE HARNAIS (09/08/2026) : partir de `false` revenait à
   * affirmer « rien n'attend » avant d'avoir regardé. Entre le montage et
   * la première lecture de l'outbox, le récapitulatif de fin de séance
   * pouvait donc s'afficher sur une séance qui n'était pas partie — et
   * `surEtatServeur` s'exécutant AVANT l'acquittement, la même fenêtre
   * existait pendant une synchronisation.
   *
   * `null` veut dire « on ne sait pas encore ». Le récapitulatif exige
   * `false` : un constat, jamais une valeur par défaut.
   */
  const [pendingLocal, setPendingLocal] = useState<boolean | null>(null);

  /**
   * L'état SERVEUR relu après une synchronisation réussie.
   *
   * Il remplace EN BLOC ce que l'écran connaissait : aucune fusion manuelle
   * de colonnes coach côté React — le serveur reste seul autoritaire sur
   * `status`, `coachReply`, `prescribedSnapshot` et le reste.
   */
  const [feedbackServeurSync, setFeedbackServeurSync] = useState<AdminStudentFeedback | null>(null);

  const existingFeedbackSource = supabaseFeedback.active ? supabaseFeedback.existingFeedback : mockExistingFeedback;

  // SERVER WINS : dès qu'une relecture serveur a eu lieu, c'est elle qui fait foi.
  const existingFeedback = feedbackServeurSync ?? existingFeedbackSource;

  // « Dernières perfs » (feat/student-previous-set-performance) : index des
  // dernières performances passées, construit UNE fois en mémoire depuis
  // l'historique de l'élève (Supabase : lecture par student_id via le hook,
  // requêtes groupées — indépendante des assignations ; mock : state.feedback
  // filtré). AUCUNE requête par exercice. L'identité élève du chemin réel est
  // celle du compte connecté (getCurrentStudentId) — jamais un id arbitraire.
  const previousStudentId = supabaseFeedback.active ? (supabaseFeedback.studentId ?? "") : studentId;
  const previousSource = supabaseFeedback.active
    ? supabaseFeedback.history
    : state.feedback.filter((f) => f.studentId === studentId);
  const previousIndex = useMemo(
    () =>
      buildPreviousPerformanceIndex({
        feedbacks: previousSource,
        studentId: previousStudentId,
        currentSessionId: sessionId,
      }),
    [previousSource, previousStudentId, sessionId],
  );

  const [exerciseFeedback, setExerciseFeedback] = useState(() =>
    buildInitialFeedback(strengthExercises, studentId, sessionId),
  );
  // REMPLACEMENTS (F3) — indexés par `exercise.id`, c'est-à-dire
  // `workout_exercises.id`. Cet état ne touche JAMAIS `exerciseFeedback` :
  // la structure prescrite (séries, reps, RPE cible) reste intacte, seuls le
  // nom et la vidéo affichés changent, et l'identité du remplaçant part dans
  // le retour.
  const [substitutions, setSubstitutions] = useState<Record<string, ExerciseSubstituteOption | null>>({});
  const remplacerExercice = (exerciseId: string, option: ExerciseSubstituteOption | null) =>
    setSubstitutions((prev) => ({ ...prev, [exerciseId]: option }));
  // VIDÉOS DE TECHNIQUE (F4) — indexées par `exercise.id`, exactement comme
  // les remplacements, et tout aussi étrangères à `exerciseFeedback` : une
  // vidéo ne modifie ni une série, ni un commentaire. On garde le CHEMIN,
  // jamais une URL : le fichier est déjà dans le bucket quand ce chemin
  // apparaît, l'envoi du retour ne fait que le rattacher à la ligne.
  const [videosExercice, setVideosExercice] = useState<Record<string, string | null>>({});
  const changerVideo = (exerciseId: string, chemin: string | null) =>
    setVideosExercice((prev) => ({ ...prev, [exerciseId]: chemin }));
  const [completed, setCompleted] = useState(false);
  const [globalRpe, setGlobalRpe] = useState("");
  const [globalComment, setGlobalComment] = useState("");
  const [pain, setPain] = useState("");
  // Douleur globale structurée (séances cardio) : niveau + détail optionnel.
  const [painLevel, setPainLevel] = useState<PainLevel>("aucune");
  const [painDetail, setPainDetail] = useState("");
  // Réalisations cardio BLOC PAR BLOC — brouillons locaux par blockId
  // stable, AUCUNE requête à la frappe ; modifier un bloc ne touche jamais
  // les brouillons des autres. Erreurs rattachées au bloc concerné.
  const [blockDrafts, setBlockDrafts] = useState<Record<string, CardioBlockDraft>>({});
  const [blockErrors, setBlockErrors] = useState<Record<string, string>>({});
  const draftFor = (blockId: string): CardioBlockDraft => blockDrafts[blockId] ?? emptyCardioBlockDraft();
  const patchBlockDraft = (blockId: string, next: CardioBlockDraft) =>
    setBlockDrafts((prev) => ({ ...prev, [blockId]: next }));
  // Mode édition d'un retour déjà envoyé (Supabase uniquement — le circuit
  // mock historique ne sait pas mettre à jour, il resterait en lecture).
  const [editing, setEditing] = useState(false);
  // Enregistrement : anti double-soumission + erreurs (validation ou réseau).
  // Le ref est le verrou SYNCHRONE (deux clics dans le même tick arrivent
  // avant tout re-render : un simple état React ne suffit pas) ; l'état ne
  // sert qu'à l'affichage (bouton désactivé + libellé).
  const submittingRef = useRef(false);
  const [submitting, setSubmitting] = useState(false);
  /**
   * F2 — la carte de fin de séance s'ALLUME-t-elle ?
   *
   * Vrai uniquement quand l'élève vient de cliquer sur « Enregistrer mon
   * retour » pour une PREMIÈRE soumission. C'est de l'état de composant :
   * il ne survit donc pas à un rechargement, et rouvrir la séance demain
   * montrera la même carte, chiffres compris, mais immobile.
   *
   * Une CORRECTION (« Modifier mon retour ») ne rallume rien : la séance
   * s'est terminée une fois, pas à chaque faute de frappe rattrapée.
   */
  const [celebration, setCelebration] = useState(false);

  /* ══════════════════════════════════════════════════════════════════════
   * DURÉE DÉCLARÉE
   * ══════════════════════════════════════════════════════════════════════
   * Chaîne brute, comme tous les autres champs de ce formulaire : c'est
   * `analyserDuree` qui la valide au moment de construire le payload, et
   * `sanitizeDurationMinutes` qui fait autorité côté serveur. Aucun
   * chronomètre, aucun `startedAt` : 65 minutes déclarées restent 65
   * minutes, même si l'application est restée ouverte trois heures.
   */
  const [durationMinutes, setDurationMinutes] = useState("");

  /**
   * HYDRATATION — le formulaire est-il prêt à être sauvegardé ?
   *
   * Injecter un brouillon restauré déclenche une cascade de `setState`. Si
   * l'autosave écoutait déjà, il enregistrerait des états INTERMÉDIAIRES :
   * une révision de plus pour un formulaire à moitié rempli, et un
   * brouillon partiel qui remplacerait le brouillon complet qu'on vient
   * tout juste de lire.
   *
   * Ce drapeau sépare donc les deux temps : d'abord on remplit, ensuite
   * seulement on écoute.
   */
  const [hydrate, setHydrate] = useState(false);


  const brouillonLocal = useBrouillonSeance<EtatBrouillonSeance>({
    userId: horsLigne || source === "supabase" ? authUserId : null,
    sessionId,
    businessDate: businessDate ?? "",
    ...(depot ? { depot } : {}),
  });

  /**
   * Le bilan affiché sur la carte de fin de séance.
   *
   * Calculé ICI, avant tout retour conditionnel : un hook ne peut pas vivre
   * derrière un `if`. Il est recalculé depuis le retour lui-même à chaque
   * rendu — rien n'est stocké en base, aucune colonne n'a été ajoutée.
   *
   * L'historique vient du même chargement groupé que les repères
   * « Dernières perfs » : aucune requête supplémentaire n'est payée pour la
   * carte. Sur le chemin mock il est vide, donc la carte montre les chiffres
   * du jour sans comparaison — ce qui est exact, pas dégradé.
   */
  const bilanFinSeance = useMemo(
    () =>
      construireBilanFinSeance({
        // `?? null` : le chemin mock passe par `Array.find`, qui rend
        // `undefined` et non `null`. Les deux veulent dire « pas de retour ».
        feedback: existingFeedback ?? null,
        historique: supabaseFeedback.history,
      }),
    [existingFeedback, supabaseFeedback.history],
  );
  const [submitError, setSubmitError] = useState<string | null>(null);

  /**
   * L'identité élève réellement disponible.
   *
   * En ligne elle vient du hook Supabase ; hors ligne, du snapshot, transmis
   * par la page dans `studentId`. C'est la même valeur — seule la voie
   * change.
   */
  const studentIdEffectif = supabaseFeedback.studentId ?? (horsLigne ? studentId : null);

  /**
   * Le formulaire attend-il encore son brouillon ?
   *
   * Uniquement quand un compte est identifié : sans compte, il n'y a rien à
   * restaurer et rien à attendre.
   */
  const attenteHydratation = Boolean(authUserId) && !hydrate;

  /** Erreur de durée montrée EN CONTINU, sans attendre le clic. */
  const dureeInvalide = !analyserDuree(durationMinutes).ok;

  /** L'état de saisie complet, tel qu'il part au brouillon ET au payload. */
  const etatSaisie: EtatBrouillonSeance = useMemo(
    () => ({
      exerciseFeedback,
      substitutions,
      videosExercice,
      blockDrafts,
      completed,
      globalRpe,
      globalComment,
      pain,
      painLevel,
      painDetail,
      durationMinutes,
    }),
    [
      exerciseFeedback, substitutions, videosExercice, blockDrafts, completed,
      globalRpe, globalComment, pain, painLevel, painDetail, durationMinutes,
    ],
  );

  /**
   * Relit l'outbox — la SEULE source de vérité du bandeau.
   *
   * Appelée après l'hydratation, après une validation hors ligne, et après
   * chaque synchronisation. Un échec de lecture ne change rien : on
   * n'affirme pas qu'il n'y a plus rien à envoyer sous prétexte qu'on n'a
   * pas pu regarder.
   */
  const rafraichirPending = useCallback(async () => {
    if (!authUserId) return;
    try {
      const operation = await brouillonLocal.depot.lireOperation(authUserId, sessionId);
      setPendingLocal(operation !== null);
    } catch {
      /* stockage indisponible : l'état affiché ne bouge pas */
    }
  }, [authUserId, sessionId, brouillonLocal.depot]);

  /* ══════════════════════════════════════════════════════════════════════
   * SYNCHRONISATION AUTOMATIQUE
   * ══════════════════════════════════════════════════════════════════════
   * Monter ce hook ICI, c'est le quatrième déclencheur : ouvrir la séance
   * tente l'envoi de ce qui attend. Les trois autres — démarrage de
   * l'espace élève, retour du réseau, retour au premier plan — sont posés
   * par le hook lui-même.
   *
   * `surFlush` ne suppose rien : il RELIT l'outbox. Un POST réussi ne suffit
   * pas à faire disparaître le bandeau si une correction plus récente attend
   * déjà.
   */
  useSynchronisation({
    actif: Boolean(authUserId),
    depot: brouillonLocal.depot,
    ...(transport ? { transport } : {}),
    identite: async () => authUserId,
    surFlush: () => {
      void rafraichirPending();
    },
    surEtatServeur: (sessionIdRelu, feedback) => {
      if (sessionIdRelu === sessionId) setFeedbackServeurSync(feedback);
    },
  });

  /* ══════════════════════════════════════════════════════════════════════
   * RESTAURATION — QUI GAGNE, LE BROUILLON OU LE SERVEUR ?
   * ══════════════════════════════════════════════════════════════════════
   * La règle n'est pas décidée ici : `choisirOrigineFormulaire` la porte, et
   * elle est vérifiée dans Node (R1/R2/R3). Le composant se contente
   * d'appliquer la décision, puis d'ouvrir l'autosave.
   */
  useEffect(() => {
    if (hydrate || brouillonLocal.chargement || !supabaseFeedback.ready) return;

    const decision = choisirOrigineFormulaire({
      horsLigne,
      brouillon: brouillonLocal.restaure
        ? { revision: brouillonLocal.revision, payload: brouillonLocal.restaure }
        : null,
      // Une opération en attente signifie que le serveur est en retard d'au
      // moins une révision : le brouillon doit rester visible.
      operationEnAttente:
        brouillonLocal.revision > 0 && brouillonLocal.restaure ? { revision: brouillonLocal.revision } : null,
      feedbackServeur: existingFeedback ?? null,
    });

    if (decision.origine === "brouillon" && estEtatBrouillonSeance(decision.payload)) {
      const b = decision.payload;
      /*
       * Les états sont remplis AVANT que `hydrate` ne passe à `true` :
       * l'autosave, qui en dépend, ne verra jamais un formulaire à moitié
       * rempli.
       *
       * `set-state-in-effect` est désactivé ICI, et seulement ici. C'est le
       * cas que la règle elle-même décrit comme légitime — synchroniser
       * l'état React depuis un système EXTERNE (IndexedDB) — et le garde
       * `hydrate` limite l'exécution à une fois par montage.
       *
       * L'alternative — injecter dans une microtâche pour satisfaire la
       * règle — ouvrirait une fenêtre pendant laquelle une frappe de
       * l'élève serait écrasée par le brouillon restauré. Un avertissement
       * de performance vaut mieux qu'une saisie perdue.
       */
      /*
       * BUG TROUVÉ PAR LE HARNAIS REACT (09/08/2026).
       *
       * Un brouillon ne décrit QUE les exercices qui existaient au moment
       * où il a été écrit. Si le coach a depuis retiré, ajouté ou remplacé
       * un exercice, `exerciseFeedback[exercise.id]` devient `undefined`
       * pour la carte concernée — et `ExerciseFeedbackCard` lit
       * `feedback.sets` : l'écran entier tombe, en salle, sur une saisie
       * que l'élève croyait à l'abri.
       *
       * On FUSIONNE donc sur la structure fraîche : la séance d'aujourd'hui
       * décide des exercices présents, le brouillon ne fait que remplir
       * ceux qu'il connaît encore. Ce qui a disparu du programme est
       * ignoré ; ce qui est apparu démarre vide.
       */
      // eslint-disable-next-line react-hooks/set-state-in-effect -- restauration ponctuelle depuis IndexedDB, voir ci-dessus
      setExerciseFeedback(() => {
        const frais = buildInitialFeedback(strengthExercises, studentId, sessionId);
        for (const [id, saisie] of Object.entries(b.exerciseFeedback ?? {})) {
          if (frais[id]) frais[id] = saisie;
        }
        return frais;
      });
      setSubstitutions(b.substitutions ?? {});
      setVideosExercice(b.videosExercice ?? {});
      setBlockDrafts(b.blockDrafts ?? {});
      setCompleted(b.completed);
      setGlobalRpe(b.globalRpe);
      setGlobalComment(b.globalComment);
      setPain(b.pain);
      setPainLevel(b.painLevel);
      setPainDetail(b.painDetail);
      setDurationMinutes(b.durationMinutes ?? "");
    }
    // `origine === "serveur"` : rien à faire ici, le récapitulatif et
    // `startEditing` prérempliront comme aujourd'hui.
    setHydrate(true);
    void rafraichirPending();
  }, [
    hydrate, horsLigne, brouillonLocal.chargement, brouillonLocal.restaure,
    brouillonLocal.revision, supabaseFeedback.ready, existingFeedback,
    strengthExercises, studentId, sessionId, rafraichirPending,
  ]);

  /* ══════════════════════════════════════════════════════════════════════
   * AUTOSAVE
   * ══════════════════════════════════════════════════════════════════════
   * Seulement une fois hydraté, et seulement si un compte est identifié.
   * Le différé et la révision sont dans `creerPlanificateurBrouillon` et
   * dans le dépôt — ce hook ne fait que transmettre.
   */
  useEffect(() => {
    if (!hydrate || !authUserId) return;
    brouillonLocal.enregistrer(etatSaisie);
  }, [hydrate, authUserId, etatSaisie, brouillonLocal]);

  if (!supabaseFeedback.ready) {
    return <p className="text-sm text-muted-foreground">Chargement du retour…</p>;
  }

  function handleSetChange(
    exerciseId: string,
    setNumber: number,
    field: "loadUsed" | "repsDone" | "rpe",
    value: string,
  ) {
    setExerciseFeedback((prev) => ({
      ...prev,
      [exerciseId]: {
        ...prev[exerciseId],
        sets: prev[exerciseId].sets.map((set) =>
          set.setNumber === setNumber ? { ...set, [field]: value } : set,
        ),
      },
    }));
  }

  function handleCommentChange(exerciseId: string, value: string) {
    setExerciseFeedback((prev) => ({
      ...prev,
      [exerciseId]: { ...prev[exerciseId], comment: value },
    }));
  }

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (submittingRef.current) return; // double clic / double soumission (verrou synchrone)

    const globalRpeValue = globalRpe === "" ? null : Number(globalRpe);

    // Validation + conversion des réalisations cardio BLOC PAR BLOC
    // (virgule française et point acceptés ; valeurs impossibles rejetées).
    // Une erreur est rattachée à SON bloc et bloque l'envoi sans effacer le
    // moindre brouillon ; un bloc laissé entièrement vide n'écrit rien.
    const cardioPayloads: ExerciseFeedbackPayload[] = [];
    if (hasCardio) {
      const nextErrors: Record<string, string> = {};
      for (const item of cardioItems) {
        const conversion = realizedFromDraft(draftFor(item.view.id));
        if (conversion.realized === null) {
          nextErrors[item.view.id] = conversion.error;
          continue;
        }
        if (isBlockResultEmpty(conversion.realized)) continue;
        const result: CardioBlockResult = {
          version: 2,
          blockId: item.view.id,
          order: item.order,
          title: item.label,
          // Même source que les repères affichés sous CE bloc (helper unique).
          prescribed: cardioBlockPrescribedSnapshot(item.view),
          ...conversion.realized,
        };
        cardioPayloads.push(serializeCardioBlockResult(result));
      }
      setBlockErrors(nextErrors);
      if (Object.keys(nextErrors).length > 0) {
        setSubmitError("Corrige les blocs signalés avant d'enregistrer — rien n'a été perdu.");
        return;
      }
    }

    const painText = hasCardio ? composePainText(painLevel, painDetail) : pain;

    /* ── LE PAYLOAD, CONSTRUIT UNE SEULE FOIS ──────────────────────────
     * La validation du RPE par série et celle de la durée vivent désormais
     * dans `construireWorkoutFeedbackPayload`, avec la composition
     * elle-même. Les deux chemins — envoi immédiat et mise en file — se
     * servent de CET objet : il n'existe plus aucun endroit où séries,
     * cardio ou remplacements soient reconstruits une seconde fois. */
    const construction = construireWorkoutFeedbackPayload(
      {
        exerciseFeedback,
        cardioPayloads,
        substitutions,
        videosExercice,
        completed,
        globalRpe,
        globalComment,
        painText,
        durationMinutes,
      },
      {
        studentId: supabaseFeedback.studentId ?? studentId,
        sessionKey: sessionId,
        sessionRefLabel,
        sessionId,
        programId,
        // La date de la SÉANCE, jamais celle du clic : une séance ouverte
        // dimanche 23h50 et validée lundi 00h20 reste de dimanche.
        performedAt: businessDate ?? new Date().toISOString().slice(0, 10),
        horsLigne,
        cheminsVideoConnus,
      },
    );
    if (!construction.ok) {
      // Message précis, saisie intacte — comme avant.
      setSubmitError(construction.erreur);
      return;
    }
    const payload = construction.payload;

    // Le chemin mock/localStorage, plus bas, a besoin du RPE par série sous
    // forme de table. La VALIDATION, elle, a déjà eu lieu ci-dessus : ici on
    // ne fait plus que relire des valeurs déjà acceptées.
    const rpeParSerie = new Map<string, number | null>();
    for (const exerciseFb of Object.values(exerciseFeedback)) {
      for (const set of exerciseFb.sets) {
        const parsed = parseRpeInput(set.rpe);
        rpeParSerie.set(`${exerciseFb.exerciseId}#${set.setNumber}`, parsed.ok ? parsed.rpe : null);
      }
    }

    // Verrou one-shot : posé AVANT le travail, il n'est relâché QUE si
    // l'enregistrement échoue (pour permettre un nouvel essai). Après un
    // succès il reste posé — le formulaire est remplacé par le récapitulatif
    // au rendu suivant. Indispensable sur le chemin mock, entièrement
    // synchrone : un double/triple clic arrive avant tout re-render et un
    // verrou relâché en `finally` laisserait passer chaque clic.
    setSubmitError(null);
    submittingRef.current = true;
    setSubmitting(true);
    const releaseForRetry = () => {
      submittingRef.current = false;
      setSubmitting(false);
    };
    try {
      /* ── HORS LIGNE ────────────────────────────────────────────────────
       * Aucune tentative de POST, aucun téléversement : on sait qu'il n'y a
       * pas de réseau. Le différé en cours est ABANDONNÉ — la validation
       * écrit elle-même le brouillon définitif, dans la même transaction que
       * l'opération à envoyer. */
      if (horsLigne) {
        brouillonLocal.abandonnerDiffere();
        const resultat = await soumettreRetour({
          payload,
          // Le formulaire tel qu'il est à l'écran : c'est CE qui sera
          // réaffiché à la réouverture, et non le payload envoyé.
          etatFormulaire: etatSaisie,
          userId: authUserId ?? "",
          sessionId,
          businessDate: businessDate ?? payload.performedAt ?? "",
          operationId: crypto.randomUUID(),
          reseau: null,
          // Le MÊME dépôt que l'autosave : une seule connexion, une seule
          // vérité locale.
          depot: brouillonLocal.depot,
        });
        if (resultat.etat === "en_attente") {
          // ET SEULEMENT MAINTENANT — après le commit IndexedDB confirmé, et
          // en RELISANT l'outbox plutôt qu'en supposant qu'elle est pleine.
          await rafraichirPending();
          return;
        }
        // Ni serveur, ni disque : on ne prétend RIEN, et la saisie reste.
        setSubmitError(
          "Impossible d'enregistrer sur cet appareil. Ta saisie est toujours à l'écran — ne ferme pas la page.",
        );
        releaseForRetry();
        return;
      }

      if (supabaseFeedback.active) {
        /* ── EN LIGNE ────────────────────────────────────────────────
         * Le MÊME payload, réduit au corps attendu par la route. Plus
         * aucune reconstruction : `corpsPourServeur` retire `studentId` —
         * l'identité élève est dérivée de la session authentifiée côté
         * serveur, et le schéma `.strict()` refuserait cette clé. */
        const ok = await supabaseFeedback.submit(corpsPourServeur(payload));
        if (!ok) {
          // Les données saisies restent en place — l'élève peut réessayer.
          setSubmitError("L'enregistrement a échoué. Vérifie ta connexion puis réessaie.");
          releaseForRetry();
          return;
        }
        /* Le serveur fait désormais foi : le brouillon local n'est plus
         * qu'un résidu, et le laisser ferait gagner le cas C à la prochaine
         * ouverture avec une version périmée. La purge est BEST-EFFORT —
         * son échec ne transforme jamais un enregistrement serveur réussi
         * en erreur utilisateur. */
        brouillonLocal.abandonnerDiffere();
        void brouillonLocal.purger();

        // `editing` est lu AVANT d'être remis à faux : c'est lui qui distingue
        // « je termine ma séance » de « je corrige ce que j'ai déjà envoyé ».
        if (!editing) setCelebration(true);
        setEditing(false);
        return;
      }

      const submittedAt = new Date().toISOString();
      const exerciseEntries: AdminExerciseFeedbackEntry[] = Object.values(exerciseFeedback).flatMap(
        (exerciseFb) =>
          exerciseFb.sets
            .filter(hasRealizedSetInput)
            .map((set) => ({
              exerciseId: exerciseFb.exerciseId,
              exerciseName: exerciseFb.exerciseName,
              setNumber: set.setNumber,
              loadUsed: set.loadUsed,
              repsDone: set.repsDone,
              // Option B : RPE de LA série (jamais un global recopié).
              rpe: rpeParSerie.get(`${exerciseFb.exerciseId}#${set.setNumber}`) ?? null,
              exerciseRpe: null,
              comment: exerciseFb.comment,
            })),
      );
      for (const payload of cardioPayloads) {
        for (const set of payload.sets) {
          exerciseEntries.push({
            exerciseId: "cardio-results",
            exerciseName: payload.exerciseName,
            setNumber: set.setNumber,
            loadUsed: set.loadUsed,
            repsDone: set.repsDone,
            rpe: payload.rpe,
            comment: payload.comment,
          });
        }
      }

      const feedback: Omit<AdminStudentFeedback, "id" | "createdAt" | "updatedAt"> = {
        studentId,
        type: "entrainement",
        sessionId,
        programId,
        refLabel: sessionRefLabel,
        date: submittedAt.slice(0, 10),
        completed,
        rpe: globalRpeValue,
        pain: painText,
        comment: globalComment,
        exerciseEntries,
        status: "a-traiter",
        coachReply: "",
      };

      addFeedback(feedback);
      setCelebration(true);
    } catch {
      setSubmitError("L'enregistrement a échoué. Vérifie ta connexion puis réessaie.");
      releaseForRetry();
    }
  }

  function startEditing() {
    if (!existingFeedback) return;
    const parsed = parseCardioResults(existingFeedback.exerciseEntries);
    const drafts: Record<string, CardioBlockDraft> = {};
    for (const result of parsed.blocks) {
      drafts[result.blockId] = draftFromBlockResult(result);
    }
    setBlockDrafts(drafts);
    setBlockErrors({});
    // REMPLACEMENTS — restaurés depuis le retour enregistré, sinon une
    // re-soumission les effacerait silencieusement (elle REMPLACE les lignes
    // d'exercice). Le retour porte l'identité et le nom ; la DÉMONSTRATION
    // est résolue à la lecture depuis la banque, jamais stockée ici — ainsi
    // l'élève retrouve la bonne vidéo dès la réouverture, et une vidéo
    // changée depuis par le coach est celle qu'il voit.
    setSubstitutions(() => {
      const restaurés: Record<string, ExerciseSubstituteOption | null> = {};
      const parNomPrescrit = new Map<string, AdminExerciseFeedbackEntry>();
      for (const entry of existingFeedback.exerciseEntries) {
        if (isCardioResultEntryName(entry.exerciseName)) continue;
        if (!entry.substituteExerciseLibraryId || !entry.substituteExerciseName) continue;
        parNomPrescrit.set(normalizeExerciseName(entry.exerciseName), entry);
      }
      for (const exercise of strengthExercises) {
        const entry = parNomPrescrit.get(normalizeExerciseName(exercise.name));
        if (!entry) continue;
        restaurés[exercise.id] = {
          id: entry.substituteExerciseLibraryId as string,
          name: entry.substituteExerciseName as string,
          // Résolue à la LECTURE depuis la banque (voir
          // lib/supabase/workout-feedback.ts::loadSubstituteVideos) : la
          // bonne démonstration réapparaît immédiatement, sans que l'URL
          // n'ait jamais été stockée dans le retour. Vide si la fiche a été
          // supprimée depuis — le nom réalisé, lui, subsiste.
          videoUrl: entry.substituteVideoUrl ?? "",
          alternativeVideoUrl: "",
          muscleGroup: "",
          equipment: "",
          level: "",
        };
      }
      return restaurés;
    });
    // VIDÉOS — restaurées pour la même raison que les remplacements : une
    // re-soumission REMPLACE les lignes d'exercice, donc un chemin non
    // renvoyé serait silencieusement perdu et le fichier deviendrait
    // orphelin. Le chemin survit à la réécriture parce que l'écran le
    // renvoie ; c'est précisément pour cela qu'il ne contient pas
    // l'identifiant de la ligne.
    //
    // La source est `feedback.videos` et NON `exerciseEntries` : cette
    // dernière est une liste par SÉRIE, où un exercice filmé sans aucune
    // série saisie n'apparaît pas du tout.
    setVideosExercice(() => {
      const restaurées: Record<string, string | null> = {};
      const parNomPrescrit = new Map<string, string>();
      for (const video of existingFeedback.videos ?? []) {
        parNomPrescrit.set(normalizeExerciseName(video.exerciseName), video.videoPath);
      }
      for (const exercise of strengthExercises) {
        const chemin = parNomPrescrit.get(normalizeExerciseName(exercise.name));
        if (chemin) restaurées[exercise.id] = chemin;
      }
      return restaurées;
    });

    // Option B — édition : restaure les valeurs muscu réellement ENREGISTRÉES
    // (charge/reps/RPE par série + commentaire d'exercice), pour que la
    // re-soumission (qui remplace les exercices, chemin idempotent inchangé)
    // reparte de l'existant. Le RPE GLOBAL d'un ancien retour n'est JAMAIS
    // réinjecté dans les champs de série — il n'a jamais été saisi par série.
    setExerciseFeedback(() => {
      const restauré = buildInitialFeedback(strengthExercises, studentId, sessionId);
      const parNom = new Map<string, AdminExerciseFeedbackEntry[]>();
      for (const entry of existingFeedback.exerciseEntries) {
        if (isCardioResultEntryName(entry.exerciseName)) continue;
        const cle = normalizeExerciseName(entry.exerciseName);
        parNom.set(cle, [...(parNom.get(cle) ?? []), entry]);
      }
      for (const exercise of strengthExercises) {
        const entries = parNom.get(normalizeExerciseName(exercise.name));
        const cible = restauré[exercise.id];
        if (!entries || !cible) continue;
        cible.comment = entries[0]?.comment ?? "";
        cible.sets = cible.sets.map((set) => {
          const entrée = entries.find((e) => e.setNumber === set.setNumber);
          return entrée
            ? {
                ...set,
                loadUsed: entrée.loadUsed,
                repsDone: entrée.repsDone,
                rpe: entrée.rpe != null ? String(entrée.rpe) : "",
              }
            : set;
        });
      }
      return restauré;
    });
    setCompleted(existingFeedback.completed ?? false);
    setGlobalRpe(existingFeedback.rpe !== null ? String(existingFeedback.rpe) : "");
    setGlobalComment(existingFeedback.comment);
    if (hasCardio) {
      setPainLevel(
        existingFeedback.pain.startsWith("Gêne importante")
          ? "importante"
          : existingFeedback.pain.startsWith("Gêne modérée")
            ? "modérée"
            : existingFeedback.pain.startsWith("Gêne légère")
              ? "légère"
              : "aucune",
      );
      setPainDetail(existingFeedback.pain.includes(" — ") ? existingFeedback.pain.slice(existingFeedback.pain.indexOf(" — ") + 3) : "");
    } else {
      setPain(existingFeedback.pain);
    }
    submittingRef.current = false;
    setSubmitting(false);
    setSubmitError(null);
    setEditing(true);
  }

  /*
   * F2 — LA CARTE DE FIN DE SÉANCE NE MENT PAS.
   *
   * Elle a pris la place du bloc « Retour envoyé » : même point de montage,
   * même rôle, CONFIRMER QUE C'EST PARTI. Hors ligne, rien n'est parti. La
   * montrer après une validation locale ferait croire à une confirmation
   * distante qui n'a pas eu lieu.
   *
   * La règle est donc adossée à l'OUTBOX, pas au mode d'affichage : tant
   * qu'une opération attend, le récapitulatif est interdit. Dès qu'elle a
   * été acquittée — c'est-à-dire après relecture serveur — la logique F2
   * historique reprend, y compris hors ligne sur un retour confirmé avant
   * la coupure.
   */
  if (existingFeedback && !editing && pendingLocal === false) {
    const parsed = parseCardioResults(existingFeedback.exerciseEntries);
    // Historique (phase 1) : si la photographie du prescrit a été posée à la
    // soumission, le récapitulatif l'affiche — c'est elle qui fait foi, même
    // si le coach a retravaillé la séance depuis. Sans snapshot (anciens
    // retours), rien ne change : la séance vivante reste la seule source,
    // historique non figé assumé.
    const prescription = resolvePrescription(existingFeedback.prescribedSnapshot, true);
    // Un remplacement par EXERCICE, pas par série : `exerciseEntries` est une
    // liste à plat où l'information est répétée sur chaque série.
    const remplacementsDuRetour = [
      ...new Map(
        existingFeedback.exerciseEntries
          .filter((e) => !isCardioResultEntryName(e.exerciseName) && e.substituteExerciseName)
          .map((e) => [
            `${e.exerciseName}→${e.substituteExerciseName}`,
            { prescrit: e.exerciseName, realise: e.substituteExerciseName as string },
          ]),
      ).values(),
    ];
    return (
      // Refonte apple-ui : récapitulatif recentré dans la colonne principale.
      <div className="mx-auto flex w-full max-w-3xl flex-col gap-6 animate-fade-in">
        {/*
          F2 — la carte de fin de séance prend la place du bloc « Retour
          envoyé ». Même point de montage, même rôle : confirmer que c'est
          parti. Elle y ajoute ce que l'élève vient de faire, en chiffres, et
          l'emblème qui s'allume — mais uniquement au moment de l'envoi.

          Le bilan est RECALCULÉ à chaque rendu depuis le retour lui-même :
          rien n'est stocké, aucune colonne n'a été ajoutée, et rouvrir la
          séance dans six mois affichera les mêmes chiffres.
        */}
        <SessionCompletionCard bilan={bilanFinSeance} celebre={celebration}>
          {supabaseFeedback.active && (
            <button
              type="button"
              onClick={startEditing}
              className="pressable mx-auto mt-5 flex min-h-[44px] items-center gap-2 rounded-control border border-border px-5 py-2 text-xs uppercase tracking-widest text-muted-foreground transition-colors hover:border-primary hover:text-primary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/40"
            >
              Modifier mon retour
            </button>
          )}
        </SessionCompletionCard>

        {prescription.source === "snapshot" && prescription.snapshot && (
          <div className="rounded-card border border-border bg-card p-6 shadow-soft">
            <h3 className="mb-1 font-heading text-sm font-bold uppercase text-foreground">
              Prescription au moment de la séance
            </h3>
            <p className="mb-4 text-xs text-muted-foreground">
              Photographie figée le{" "}
              {new Date(prescription.snapshot.capturedAt).toLocaleDateString("fr-FR")} — les
              modifications ultérieures du programme ne s&apos;appliquent pas ici.
            </p>
            <dl className="flex flex-col gap-2">
              {prescription.snapshot.blocks.flatMap((bloc) =>
                bloc.exercises.map((exercice) => (
                  <div
                    key={`${bloc.position}-${exercice.order}-${exercice.name}`}
                    className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1 rounded-panel border border-border bg-surface-soft/40 px-4 py-3"
                  >
                    <dt className="text-sm font-semibold text-foreground">{exercice.name}</dt>
                    <dd className="text-xs uppercase tracking-wider text-muted-foreground">
                      {[
                        exercice.sets !== null ? `${exercice.sets} séries` : null,
                        exercice.reps ? `${exercice.reps} reps` : null,
                        exercice.recommendedLoad ? `charge ${exercice.recommendedLoad}` : null,
                        exercice.recommendedRpe ? `RPE cible ${exercice.recommendedRpe}` : null,
                        exercice.restSeconds !== null ? `repos ${exercice.restSeconds}s` : null,
                      ]
                        .filter(Boolean)
                        .join(" · ")}
                    </dd>
                  </div>
                )),
              )}
            </dl>
          </div>
        )}

        {parsed.blocks.length > 0 && (
          <div className="flex flex-col gap-4">
            {parsed.blocks.map((result) => (
              <div key={result.blockId} className="rounded-card border border-border bg-card p-6 shadow-soft">
                <h3 className="mb-3 font-heading text-sm font-bold uppercase text-foreground">{result.title}</h3>
                <dl className="grid grid-cols-1 gap-3 sm:grid-cols-3">
                  {result.durationSeconds !== null && (
                    <div className="rounded-panel border border-border bg-surface-soft/40 p-4">
                      <dt className="text-[11px] uppercase tracking-widest text-muted-foreground">Durée réalisée</dt>
                      <dd className="mt-1 text-sm font-semibold text-foreground">{formatDurationSeconds(result.durationSeconds)}</dd>
                    </div>
                  )}
                  {result.distanceMeters !== null && (
                    <div className="rounded-panel border border-border bg-surface-soft/40 p-4">
                      <dt className="text-[11px] uppercase tracking-widest text-muted-foreground">Distance réalisée</dt>
                      <dd className="mt-1 text-sm font-semibold text-foreground">{formatDistanceMeters(result.distanceMeters)}</dd>
                    </div>
                  )}
                  {result.elevationGainMeters !== null && (
                    <div className="rounded-panel border border-border bg-surface-soft/40 p-4">
                      <dt className="text-[11px] uppercase tracking-widest text-muted-foreground">Dénivelé réalisé</dt>
                      <dd className="mt-1 text-sm font-semibold text-foreground">{result.elevationGainMeters} m</dd>
                    </div>
                  )}
                  {result.repetitionsDone !== null && (
                    <div className="rounded-panel border border-border bg-surface-soft/40 p-4">
                      <dt className="text-[11px] uppercase tracking-widest text-muted-foreground">Répétitions terminées</dt>
                      <dd className="mt-1 text-sm font-semibold text-foreground">
                        {result.repetitionsDone}
                        {result.prescribed.repetitions !== null ? ` / ${result.prescribed.repetitions}` : ""}
                      </dd>
                    </div>
                  )}
                </dl>
                <div className="mt-3 flex flex-col gap-1 text-sm text-muted-foreground">
                  <p>{result.completed ? "Bloc terminé" : "Bloc non terminé"}</p>
                  {result.rpe !== null && <p>RPE du bloc : {result.rpe} / 10</p>}
                  {result.pain && <p>Douleur / gêne : {result.pain}</p>}
                  {result.comment && <p className="text-foreground">{result.comment}</p>}
                </div>
              </div>
            ))}
          </div>
        )}

        {parsed.legacy && (
          <div className="rounded-card border border-border bg-card p-6 shadow-soft">
            <h3 className="mb-3 font-heading text-sm font-bold uppercase text-foreground">Retour cardio global (historique)</h3>
            <div className="flex flex-wrap gap-4 text-sm text-foreground">
              {parsed.legacy.durationLabel && <span>Durée : {parsed.legacy.durationLabel}</span>}
              {parsed.legacy.distanceLabel && <span>Distance : {parsed.legacy.distanceLabel}</span>}
              {parsed.legacy.elevationLabel && <span>D+ : {parsed.legacy.elevationLabel}</span>}
            </div>
          </div>
        )}

        {remplacementsDuRetour.length > 0 && (
          <div className="rounded-card border border-border bg-card p-6 shadow-soft">
            <h3 className="mb-3 font-heading text-sm font-bold uppercase text-foreground">
              Exercices remplacés
            </h3>
            <ul className="flex flex-col gap-1 text-sm text-muted-foreground">
              {remplacementsDuRetour.map((r) => (
                <li key={`${r.prescrit}-${r.realise}`}>
                  <span className="text-foreground">{r.realise}</span> à la place de {r.prescrit}
                </li>
              ))}
            </ul>
          </div>
        )}

        {(existingFeedback.rpe !== null || existingFeedback.comment || existingFeedback.pain) && (
          <div className="rounded-card border border-border bg-card p-6 shadow-soft">
            <h3 className="mb-3 font-heading text-sm font-bold uppercase text-foreground">Résumé global de la séance</h3>
            <div className="flex flex-col gap-1 text-sm text-muted-foreground">
              {existingFeedback.rpe !== null && <p>RPE global : {existingFeedback.rpe} / 10</p>}
              {existingFeedback.pain && <p>Douleur / gêne : {existingFeedback.pain}</p>}
              {existingFeedback.comment && <p className="text-foreground">{existingFeedback.comment}</p>}
            </div>
          </div>
        )}

        <PlannedVsActualSummary
          exercises={strengthExercises}
          sessionId={sessionId}
          sessionMuscleGroup={sessionMuscleGroup}
          exerciseEntries={existingFeedback.exerciseEntries}
        />
      </div>
    );
  }

  return (
    // Refonte apple-ui : formulaire recentré dans une colonne principale à
    // largeur maximale cohérente (grand écran) — purement visuel.
    <form onSubmit={handleSubmit} className="mx-auto flex w-full max-w-3xl flex-col gap-6">
      {/*
        LA COURSE D'HYDRATATION, FERMÉE PAR LE NAVIGATEUR LUI-MÊME.

        La lecture du brouillon est asynchrone. Entre le premier rendu et son
        arrivée, un élève rapide pourrait saisir une charge — qui serait
        ensuite ÉCRASÉE par le brouillon restauré, sans un mot.

        `<fieldset disabled>` ferme la fenêtre de façon déterministe : le
        navigateur refuse la saisie, le focus et la soumission de tout ce
        qu'il contient. Pas de drapeau à tenir à jour dans chaque champ, pas
        d'événement à intercepter — une seule ligne, et la course n'existe
        plus.

        `attenteHydratation` reste faux quand aucun compte n'est identifié :
        il n'y a alors aucun brouillon à attendre, et le formulaire ne doit
        pas rester bloqué.
      */}
      <fieldset disabled={attenteHydratation} className="contents">
      {attenteHydratation && (
        <p role="status" className="text-xs uppercase tracking-widest text-muted-foreground">
          Restauration de ta saisie…
        </p>
      )}
      {/* SEULE source de rendu : la liste ordonnée de blocs. Chaque bloc
          Strength affiche ses propres exercices (ordre canonique) ; chaque bloc
          Cardio est rendu à sa position. Jamais de liste globale aplatie. */}
      <StudentSessionBlockList
        blocks={blockViews}
        renderStrengthExercise={(exercise, index) => (
          <ExerciseFeedbackCard
            exercise={exercise}
            index={index}
            feedback={exerciseFeedback[exercise.id]}
            previous={findPreviousPerformance(previousIndex, exercise)}
            onSetChange={(setNumber, field, value) => handleSetChange(exercise.id, setNumber, field, value)}
            onCommentChange={(value) => handleCommentChange(exercise.id, value)}
            substitute={substitutions[exercise.id] ?? null}
            // Le remplacement n'est proposé QUE sur un chemin RÉEL : il
            // s'appuie sur la banque d'exercices et sur une trace écrite en
            // base. Sur le chemin mock/localStorage, ni l'une ni l'autre
            // n'existent — on ne montre pas un bouton qui ne mènerait à rien.
            //
            // HORS LIGNE, il reste proposé : c'est précisément en salle,
            // devant un appareil occupé, qu'on change d'exercice. Les options
            // admissibles viennent du snapshot (`chargerRemplacants`), et le
            // serveur les revalidera à la synchronisation.
            {...(supabaseFeedback.active || horsLigne
              ? { onSubstituteChange: (option: ExerciseSubstituteOption | null) => remplacerExercice(exercise.id, option) }
              : {})}
            {...(chargerRemplacants ? { chargerRemplacants } : {})}
            // La vidéo exige un bucket, une identité d'élève et une ligne en
            // base. Sur le chemin mock, aucun des trois — le champ n'est même
            // pas monté.
            //
            // HORS LIGNE il est monté, mais `horsLigne` en retire les deux
            // commandes d'ajout : une vidéo déjà enregistrée reste visible et
            // conservée, aucune nouvelle ne peut naître.
            {...((supabaseFeedback.active || horsLigne) && studentIdEffectif
              ? {
                  studentId: studentIdEffectif,
                  videoPath: videosExercice[exercise.id] ?? null,
                  onVideoChange: (chemin: string | null) => changerVideo(exercise.id, chemin),
                  horsLigne,
                }
              : {})}
          />
        )}
        renderCardioFooter={(block) => {
          const item = cardioItems.find((candidate) => candidate.view.id === block.id);
          if (!item) return null;
          return (
            <CardioBlockFeedbackForm
              blockId={block.id}
              blockLabel={item.label}
              prescribed={cardioBlockPrescribedSnapshot(block)}
              draft={draftFor(block.id)}
              error={blockErrors[block.id] ?? null}
              onChange={(next) => patchBlockDraft(block.id, next)}
            />
          );
        }}
      />

      <div className="rounded-card border border-border bg-card p-6 shadow-soft">
        <h2 className="mb-4 font-heading text-lg font-bold uppercase text-foreground">
          Résumé de la séance
        </h2>

        <div className="flex flex-col gap-5">
          <label className="flex min-h-[44px] cursor-pointer items-center gap-3 rounded-control border border-border bg-background px-4 py-3 text-sm text-foreground transition-colors focus-within:ring-2 focus-within:ring-primary/40 hover:border-border-strong">
            <input
              type="checkbox"
              checked={completed}
              onChange={(event) => setCompleted(event.target.checked)}
              className="h-4 w-4 accent-primary"
            />
            Séance terminée
          </label>

          <div>
            <label
              htmlFor="global-rpe"
              className="mb-2 block text-xs uppercase tracking-wide text-muted-foreground"
            >
              RPE global
              {hasCardio && <span className="ml-2 normal-case tracking-normal">(difficulté générale de la séance — le RPE de chaque bloc se saisit sous le bloc)</span>}
            </label>
            <select
              id="global-rpe"
              value={globalRpe}
              onChange={(event) => setGlobalRpe(event.target.value)}
              className="min-h-[44px] w-full appearance-none rounded-control border border-border bg-background px-4 py-3 text-sm text-foreground transition-colors focus:border-primary focus:outline-none focus-visible:ring-2 focus-visible:ring-primary/40"
            >
              <option value="" disabled>
                Choisir une note sur 10
              </option>
              {rpeOptions.map((value) => (
                <option key={value} value={value}>
                  {value} / 10
                </option>
              ))}
            </select>
          </div>

          {/*
            DURÉE DÉCLARÉE — arbitrage du 09/08/2026.
            Facultative, entière, 1 à 600. Déclarée et jamais mesurée : une
            séance d'une heure laissée trois heures dans une poche resterait
            une séance d'une heure. Aucun chronomètre, aucun `startedAt`.
          */}
          <div>
            <label
              htmlFor="duration-minutes"
              className="mb-2 block text-xs uppercase tracking-wide text-muted-foreground"
            >
              Durée de la séance
              <span className="ml-2 normal-case tracking-normal">(optionnel)</span>
            </label>
            <div className="flex items-center gap-3">
              <input
                id="duration-minutes"
                type="number"
                inputMode="numeric"
                min={1}
                max={600}
                step={1}
                value={durationMinutes}
                onChange={(event) => setDurationMinutes(event.target.value)}
                aria-invalid={dureeInvalide}
                aria-describedby={dureeInvalide ? "duration-error" : undefined}
                placeholder="65"
                className="min-h-[44px] w-32 rounded-control border border-border bg-background px-4 py-3 text-sm text-foreground transition-colors focus:border-primary focus:outline-none focus-visible:ring-2 focus-visible:ring-primary/40 aria-[invalid=true]:border-destructive"
              />
              <span className="text-sm text-muted-foreground">min</span>
            </div>
            {dureeInvalide && (
              <p id="duration-error" role="alert" className="mt-2 text-sm text-destructive">
                Saisis un nombre entier de minutes entre 1 et 600, ou laisse vide.
              </p>
            )}
          </div>

          <div>
            <label
              htmlFor="global-comment"
              className="mb-2 block text-xs uppercase tracking-wide text-muted-foreground"
            >
              Commentaire général
            </label>
            <textarea
              id="global-comment"
              rows={3}
              value={globalComment}
              onChange={(event) => setGlobalComment(event.target.value)}
              placeholder="Ex : bonnes sensations au début, difficulté dans la dernière montée."
              className="w-full resize-none rounded-control border border-border bg-background px-4 py-3 text-sm text-foreground transition-colors focus:border-primary focus:outline-none focus-visible:ring-2 focus-visible:ring-primary/40"
            />
          </div>

          {hasCardio ? (
            <div className="flex flex-col gap-3">
              <div>
                <label htmlFor="pain-level" className="mb-2 block text-xs uppercase tracking-wide text-muted-foreground">
                  Douleur ou gêne globale
                  <span className="ml-2 normal-case tracking-normal">(ressenti d&apos;ensemble — une gêne localisée à un bloc se saisit sous le bloc)</span>
                </label>
                <select
                  id="pain-level"
                  value={painLevel}
                  onChange={(event) => setPainLevel(event.target.value as PainLevel)}
                  className="min-h-[44px] w-full appearance-none rounded-control border border-border bg-background px-4 py-3 text-sm text-foreground transition-colors focus:border-primary focus:outline-none focus-visible:ring-2 focus-visible:ring-primary/40"
                >
                  {PAIN_LEVELS.map((level) => (
                    <option key={level} value={level}>
                      {level === "aucune" ? "Aucune" : `Gêne ${level}`}
                    </option>
                  ))}
                </select>
              </div>
              {painLevel !== "aucune" && (
                <div>
                  <label htmlFor="pain-detail" className="mb-2 block text-xs uppercase tracking-wide text-muted-foreground">
                    Où / comment ? (optionnel)
                  </label>
                  <input
                    id="pain-detail"
                    value={painDetail}
                    onChange={(event) => setPainDetail(event.target.value)}
                    placeholder="Ex : mollet droit dans les descentes"
                    className="min-h-[44px] w-full rounded-control border border-border bg-background px-4 py-3 text-sm text-foreground transition-colors focus:border-primary focus:outline-none focus-visible:ring-2 focus-visible:ring-primary/40"
                  />
                </div>
              )}
            </div>
          ) : (
            <div>
              <label
                htmlFor="pain"
                className="mb-2 block text-xs uppercase tracking-wide text-muted-foreground"
              >
                Douleur ou gêne éventuelle
              </label>
              <input
                id="pain"
                value={pain}
                onChange={(event) => setPain(event.target.value)}
                placeholder="Ex : légère gêne à l'épaule droite"
                className="min-h-[44px] w-full rounded-control border border-border bg-background px-4 py-3 text-sm text-foreground transition-colors focus:border-primary focus:outline-none focus-visible:ring-2 focus-visible:ring-primary/40"
              />
            </div>
          )}

          {submitError && (
            <p role="alert" className="flex items-start gap-2 rounded-panel border border-destructive/40 bg-destructive/10 px-4 py-3 text-sm text-destructive">
              {submitError}
            </p>
          )}

          {/*
            Affiché UNIQUEMENT après un commit IndexedDB confirmé (voir
            `soumettreRetour`). Discret, et surtout exact : le retour n'est
            pas « envoyé », il attend de l'être.
          */}
          {pendingLocal === true && (
            <p
              role="status"
              className="flex items-start gap-2 rounded-panel border border-border bg-card px-4 py-3 text-sm text-muted-foreground"
            >
              Synchronisation en attente — ton retour est enregistré sur cet appareil et partira
              dès que la connexion reviendra.
            </p>
          )}

          <button
            type="submit"
            disabled={submitting}
            className="pressable mt-2 min-h-[48px] rounded-control bg-primary py-4 text-center text-xs font-bold uppercase tracking-widest text-primary-foreground transition-colors hover:bg-primary-hover focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/40 disabled:cursor-not-allowed disabled:opacity-60"
          >
            {submitting ? "Enregistrement…" : "Enregistrer mon retour"}
          </button>
        </div>
      </div>
      </fieldset>
    </form>
  );
}
