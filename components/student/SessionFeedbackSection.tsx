"use client";

import { useMemo, useRef, useState, type FormEvent } from "react";
import { resolvePrescription } from "@/lib/workout-history";
import {
  buildPreviousPerformanceIndex,
  findPreviousPerformance,
  hasRealizedSetInput,
  normalizeExerciseName,
  parseRpeInput,
} from "@/lib/previous-performance";
import { CheckCircle } from "lucide-react";

import { ExerciseFeedbackCard } from "@/components/student/ExerciseFeedbackCard";
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
import { isUuid } from "@/lib/uuid";
import type {
  ActualSetEntry,
  AdminCardioBlock,
  AdminExerciseFeedbackEntry,
  AdminStudentFeedback,
  Exercise,
  ExerciseFeedback,
  ExerciseFeedbackPayload,
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
}: SessionFeedbackSectionProps) {
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
  const existingFeedback = supabaseFeedback.active ? supabaseFeedback.existingFeedback : mockExistingFeedback;

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
  const [submitError, setSubmitError] = useState<string | null>(null);

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

    // Option B — RPE PAR SÉRIE : validation AVANT toute écriture, erreur
    // VISIBLE, aucune valeur écrêtée ni inventée. "" = null (série sans RPE
    // acceptée) ; seules les valeurs entières 1-10 passent (mêmes bornes que
    // le schéma zod de la route et le CHECK SQL).
    const rpeParSerie = new Map<string, number | null>();
    for (const exerciseFb of Object.values(exerciseFeedback)) {
      for (const set of exerciseFb.sets) {
        const parsed = parseRpeInput(set.rpe);
        if (!parsed.ok) {
          setSubmitError(
            `RPE invalide (série ${set.setNumber} — ${exerciseFb.exerciseName}) : saisis un entier de 1 à 10, ou laisse vide.`,
          );
          return;
        }
        rpeParSerie.set(`${exerciseFb.exerciseId}#${set.setNumber}`, parsed.rpe);
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
      if (supabaseFeedback.active) {
        const exercisesPayload: ExerciseFeedbackPayload[] = Object.values(exerciseFeedback)
          .map((exerciseFb, index) => ({
            exerciseName: exerciseFb.exerciseName,
            exerciseOrder: index,
            // Option B : plus de saisie RPE au niveau exercice pour la
            // musculation — le RPE vit PAR SÉRIE (exercise_set_feedback.rpe).
            // Aucune moyenne ni valeur globale inventée. (Le cardio garde son
            // rpe de bloc au niveau exercice via cardioPayloads, inchangé.)
            rpe: null,
            comment: exerciseFb.comment,
            // hasRealizedSetInput : seules les séries réellement SAISIES
            // partent en base (charge, reps OU RPE) — un placeholder
            // « Dernières perfs » ne vit que dans l'attribut placeholder du
            // DOM, jamais dans cet état.
            sets: exerciseFb.sets
              .filter(hasRealizedSetInput)
              .map((set) => ({
                setNumber: set.setNumber,
                loadUsed: set.loadUsed,
                repsDone: set.repsDone,
                rpe: rpeParSerie.get(`${exerciseFb.exerciseId}#${set.setNumber}`) ?? null,
              })),
          }))
          .filter((exerciseFb) => exerciseFb.sets.length > 0);
        exercisesPayload.push(...cardioPayloads);

        const ok = await supabaseFeedback.submit({
          sessionRefLabel,
          completed,
          globalRpe: globalRpeValue,
          globalComment,
          pain: painText,
          exercises: exercisesPayload,
          // Renseignées uniquement quand la séance vient d'un vrai programme
          // Supabase (voir lib/supabase/programs.ts) — sessionId/programId
          // mock ("session-upper", "prog-1"...) ne sont pas des uuid valides
          // et resteraient null, comme avant la migration des programmes.
          sessionId: isUuid(sessionId) ? sessionId : null,
          programId: isUuid(programId) ? programId : null,
        });
        if (!ok) {
          // Les données saisies restent en place — l'élève peut réessayer.
          setSubmitError("L'enregistrement a échoué. Vérifie ta connexion puis réessaie.");
          releaseForRetry();
          return;
        }
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

  if (existingFeedback && !editing) {
    const parsed = parseCardioResults(existingFeedback.exerciseEntries);
    // Historique (phase 1) : si la photographie du prescrit a été posée à la
    // soumission, le récapitulatif l'affiche — c'est elle qui fait foi, même
    // si le coach a retravaillé la séance depuis. Sans snapshot (anciens
    // retours), rien ne change : la séance vivante reste la seule source,
    // historique non figé assumé.
    const prescription = resolvePrescription(existingFeedback.prescribedSnapshot, true);
    return (
      <div className="flex flex-col gap-6 animate-fade-in">
        <div className="rounded-card border border-primary/30 bg-card p-8 text-center shadow-soft">
          <CheckCircle size={32} className="mx-auto mb-3 text-primary" />
          <h3 className="mb-1 font-heading text-base font-bold uppercase text-foreground">
            Retour envoyé
          </h3>
          <p className="text-sm text-muted-foreground">
            Ton coach recevra ton retour avant la prochaine séance.
          </p>
          {supabaseFeedback.active && (
            <button
              type="button"
              onClick={startEditing}
              className="pressable mx-auto mt-4 flex min-h-[44px] items-center gap-2 rounded-control border border-border px-5 py-2 text-xs uppercase tracking-widest text-muted-foreground transition-colors hover:border-primary hover:text-primary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/40"
            >
              Modifier mon retour
            </button>
          )}
        </div>

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
    <form onSubmit={handleSubmit} className="flex flex-col gap-6">
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

          <button
            type="submit"
            disabled={submitting}
            className="pressable mt-2 min-h-[48px] rounded-control bg-primary py-4 text-center text-xs font-bold uppercase tracking-widest text-primary-foreground transition-colors hover:bg-primary-hover focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/40 disabled:cursor-not-allowed disabled:opacity-60"
          >
            {submitting ? "Enregistrement…" : "Enregistrer mon retour"}
          </button>
        </div>
      </div>
    </form>
  );
}
