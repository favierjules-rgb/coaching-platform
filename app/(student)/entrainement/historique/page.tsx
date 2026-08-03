"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { ArrowLeft, CheckCircle2, CircleSlash, MessageSquare } from "lucide-react";

import { describeCardioBlockResult, isCardioResultEntryName, parseCardioResults } from "@/lib/cardio-feedback";
import { createSupabaseBrowserClient } from "@/lib/supabase/browser";
import { getCurrentStudentId } from "@/lib/supabase/current-student";
import { getWorkoutFeedbackForStudent } from "@/lib/supabase/workout-feedback";
import { resolvePrescription } from "@/lib/workout-history";
import type { AdminStudentFeedback } from "@/types";

/**
 * Historique des retours de séance de l'élève — chemin de lecture
 * INDÉPENDANT de l'assignation actuelle (chantier
 * fix/regularisation-anciens-programmes).
 *
 * Pourquoi cette page : un retour reste en base à vie (RLS
 * workout_feedback_student_or_staff, par student_id), mais la page de séance
 * n'est atteignable que via le programme ASSIGNÉ. Après une bascule
 * d'assignation (modèle → copie individuelle) ou un retrait de programme,
 * les anciens retours devenaient invisibles côté élève alors qu'ils
 * existaient toujours. Ici, la liste et le détail reposent UNIQUEMENT sur
 * l'identité de l'élève — mêmes fonctions de lecture que le coach
 * (getWorkoutFeedbackForStudent), aucune dépendance aux programmes.
 *
 * Prescription affichée : le snapshot figé quand il existe (retours depuis
 * la phase 1) ; pour les retours antérieurs, seuls les résultats RÉALISÉS
 * sont disponibles — indiqué honnêtement, jamais reconstruit.
 */
export default function HistoriqueRetoursPage() {
  const [ready, setReady] = useState(false);
  const [feedbacks, setFeedbacks] = useState<AdminStudentFeedback[]>([]);
  const [ouvert, setOuvert] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    async function charger() {
      const supabase = createSupabaseBrowserClient();
      if (!supabase) {
        if (!cancelled) setReady(true);
        return;
      }
      const studentId = await getCurrentStudentId(supabase);
      if (!studentId) {
        if (!cancelled) setReady(true);
        return;
      }
      const liste = await getWorkoutFeedbackForStudent(supabase, studentId);
      if (!cancelled) {
        setFeedbacks(liste);
        setReady(true);
      }
    }
    charger();
    return () => {
      cancelled = true;
    };
  }, []);

  return (
    <div>
      <div className="mb-8">
        <Link
          href="/entrainement"
          className="mb-3 flex w-fit items-center gap-2 text-xs uppercase tracking-widest text-muted-foreground transition-colors hover:text-primary"
        >
          <ArrowLeft size={14} />
          Entraînement
        </Link>
        <h1 className="font-heading text-3xl font-extrabold uppercase text-foreground md:text-4xl">
          Historique des retours
        </h1>
        <p className="mt-1 text-sm text-muted-foreground">
          Tous tes retours de séance, y compris ceux de programmes passés.
        </p>
      </div>

      {!ready ? (
        <p className="text-sm text-muted-foreground">Chargement…</p>
      ) : feedbacks.length === 0 ? (
        <p className="text-sm text-muted-foreground">Aucun retour de séance pour le moment.</p>
      ) : (
        <ul className="flex flex-col gap-3">
          {feedbacks.map((feedback) => {
            const estOuvert = ouvert === feedback.id;
            const prescription = resolvePrescription(feedback.prescribedSnapshot, false);
            const date = feedback.performedAt ?? feedback.date ?? "";
            // Les entrées CARDIO portent une enveloppe JSON versionnée dans
            // `comment` (contrat lib/cardio-feedback) : JAMAIS rendue brute.
            // parseCardioResults la parse sûrement ; un JSON invalide ou v1
            // retombe sur le résumé lisible (legacy), sans accolades.
            const entreesMuscu = feedback.exerciseEntries.filter((e) => !isCardioResultEntryName(e.exerciseName));
            const cardio = parseCardioResults(feedback.exerciseEntries);
            return (
              <li key={feedback.id} className="rounded-panel border border-border bg-surface">
                <button
                  type="button"
                  onClick={() => setOuvert(estOuvert ? null : feedback.id)}
                  className="flex min-h-[44px] w-full items-center justify-between gap-3 px-4 py-3 text-left focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/40"
                >
                  <span className="flex items-center gap-3">
                    {feedback.completed ? (
                      <CheckCircle2 size={16} className="flex-shrink-0 text-success" />
                    ) : (
                      <CircleSlash size={16} className="flex-shrink-0 text-muted-foreground" />
                    )}
                    <span className="text-sm text-foreground">{feedback.refLabel || "Séance"}</span>
                  </span>
                  <span className="flex items-center gap-3 text-xs text-muted-foreground">
                    {feedback.coachReply && <MessageSquare size={14} className="text-primary" />}
                    {feedback.rpe != null && <span>RPE {feedback.rpe}</span>}
                    <span>{date}</span>
                  </span>
                </button>

                {estOuvert && (
                  <div className="flex flex-col gap-4 border-t border-border px-4 py-4">
                    {prescription.source === "snapshot" && prescription.snapshot ? (
                      <div>
                        <p className="mb-2 text-xs uppercase tracking-widest text-muted-foreground">
                          Prescription au moment de la séance
                        </p>
                        <ul className="flex flex-col gap-1 text-sm text-foreground">
                          {prescription.snapshot.blocks.flatMap((bloc) =>
                            bloc.exercises.map((exercice) => (
                              <li key={`${bloc.position}-${exercice.order}`} className="text-muted-foreground">
                                <span className="text-foreground">{exercice.name}</span>
                                {exercice.sets != null && ` · ${exercice.sets} séries`}
                                {exercice.reps && ` × ${exercice.reps}`}
                                {exercice.recommendedLoad && ` · ${exercice.recommendedLoad}`}
                              </li>
                            )),
                          )}
                        </ul>
                      </div>
                    ) : (
                      <p className="text-xs text-muted-foreground">
                        Prescription d&apos;origine indisponible (retour antérieur à l&apos;historique figé) — tes
                        résultats réalisés restent complets ci-dessous.
                      </p>
                    )}

                    {entreesMuscu.length > 0 && (
                      <div>
                        <p className="mb-2 text-xs uppercase tracking-widest text-muted-foreground">Réalisé</p>
                        <ul className="flex flex-col gap-2 text-sm">
                          {entreesMuscu.map((entree, index) => (
                            <li key={`${feedback.id}-${index}`} className="text-muted-foreground">
                              <span className="text-foreground">{entree.exerciseName}</span>
                              {" · série "}
                              {entree.setNumber} : {entree.loadUsed || "—"} × {entree.repsDone || "—"}
                              {entree.rpe != null && ` · RPE ${entree.rpe}`}
                              {entree.comment && ` — ${entree.comment}`}
                            </li>
                          ))}
                        </ul>
                      </div>
                    )}

                    {(cardio.blocks.length > 0 || cardio.legacy) && (
                      <div>
                        <p className="mb-2 text-xs uppercase tracking-widest text-muted-foreground">Cardio réalisé</p>
                        <ul className="flex flex-col gap-2 text-sm">
                          {cardio.blocks.map((bloc) => {
                            const lisible = describeCardioBlockResult(bloc);
                            return (
                              <li key={bloc.blockId} className="text-muted-foreground">
                                <span className="text-foreground">{lisible.title}</span>
                                {lisible.details && ` · ${lisible.details}`}
                                {!bloc.completed && " · non terminé"}
                                {lisible.comment && ` — ${lisible.comment}`}
                              </li>
                            );
                          })}
                          {cardio.legacy && (
                            <li className="text-muted-foreground">
                              <span className="text-foreground">Cardio</span>
                              {cardio.legacy.durationLabel && ` · Durée ${cardio.legacy.durationLabel}`}
                              {cardio.legacy.distanceLabel && ` · Distance ${cardio.legacy.distanceLabel}`}
                              {cardio.legacy.elevationLabel && ` · D+ ${cardio.legacy.elevationLabel}`}
                              {" · détail complet indisponible"}
                            </li>
                          )}
                        </ul>
                      </div>
                    )}

                    {feedback.comment && (
                      <p className="text-sm text-muted-foreground">Commentaire : {feedback.comment}</p>
                    )}
                    {feedback.pain && <p className="text-sm text-destructive">Douleurs : {feedback.pain}</p>}
                    {feedback.coachReply && (
                      <div className="rounded-control border border-primary/30 bg-primary/5 px-3 py-2">
                        <p className="text-xs uppercase tracking-widest text-primary">Réponse du coach</p>
                        <p className="mt-1 text-sm text-foreground">{feedback.coachReply}</p>
                      </div>
                    )}
                  </div>
                )}
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}
