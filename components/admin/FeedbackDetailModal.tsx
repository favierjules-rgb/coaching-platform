"use client";

import { useState } from "react";
import { CheckCircle, Eye } from "lucide-react";

import { TextareaField } from "@/components/admin/AdminFormFields";
import { Modal, PrimaryButton } from "@/components/admin/Modal";
import { StatusBadge, feedbackStatusTone } from "@/components/admin/StatusBadge";
import { feedbackStatusLabels, feedbackTypeLabels, formatDate, fullName } from "@/lib/admin";
import { isCardioResultEntryName, parseCardioResults, type CardioBlockResult } from "@/lib/cardio-feedback";
import { formatDistanceMeters, formatDurationSeconds } from "@/lib/cardio";
import type { AdminStudent, AdminStudentFeedback } from "@/types";

/** Ligne prévu/réalisé d'une métrique d'un bloc cardio (valeurs absentes masquées proprement). */
function metricLine(label: string, prescribed: string | null, realized: string | null): string | null {
  if (prescribed === null && realized === null) return null;
  if (prescribed !== null && realized !== null) return `${label} — prévu : ${prescribed} · réalisé : ${realized}`;
  if (realized !== null) return `${label} — réalisé : ${realized}`;
  return `${label} — prévu : ${prescribed}`;
}

/** Carte d'UN bloc cardio dans la modale (ordre de séance, aucun identifiant technique affiché). */
function CardioBlockResultCard({ result }: { result: CardioBlockResult }) {
  const lines = [
    metricLine(
      "Durée",
      result.prescribed.durationSeconds !== null ? formatDurationSeconds(result.prescribed.durationSeconds) : null,
      result.durationSeconds !== null ? formatDurationSeconds(result.durationSeconds) : null,
    ),
    metricLine(
      "Distance",
      result.prescribed.distanceMeters !== null ? formatDistanceMeters(result.prescribed.distanceMeters) : null,
      result.distanceMeters !== null ? formatDistanceMeters(result.distanceMeters) : null,
    ),
    metricLine(
      "Dénivelé",
      result.prescribed.elevationGainMeters !== null ? `${result.prescribed.elevationGainMeters} m` : null,
      result.elevationGainMeters !== null ? `${result.elevationGainMeters} m` : null,
    ),
    metricLine(
      "Répétitions",
      result.prescribed.repetitions !== null ? String(result.prescribed.repetitions) : null,
      result.repetitionsDone !== null ? String(result.repetitionsDone) : null,
    ),
  ].filter((line): line is string => line !== null);

  return (
    <div className="rounded-panel border border-border bg-surface-soft/40 p-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <span className="text-sm font-semibold uppercase text-foreground">{result.title}</span>
        <span className={`text-xs uppercase tracking-wide ${result.completed ? "text-success" : "text-muted-foreground"}`}>
          {result.completed ? "Terminé" : "Non terminé"}
        </span>
      </div>
      <div className="mt-2 flex flex-col gap-0.5 text-xs text-muted-foreground">
        {lines.map((line) => (
          <p key={line}>{line}</p>
        ))}
        {result.rpe !== null && <p>RPE : {result.rpe}/10</p>}
        {result.pain && <p className="text-warning">Douleur / gêne : {result.pain}</p>}
        {result.comment && <p className="text-foreground">{result.comment}</p>}
      </div>
    </div>
  );
}

/** Libellé de type affiché : « Entraînement · Course » si le retour contient des résultats cardio. */
export function feedbackTypeDisplayLabel(feedback: AdminStudentFeedback): string {
  if (feedback.type === "entrainement" && feedback.exerciseEntries.some((e) => isCardioResultEntryName(e.exerciseName))) {
    return "Entraînement · Course";
  }
  return feedbackTypeLabels[feedback.type];
}

export function FeedbackDetailModal({
  feedback,
  student,
  onReply,
}: {
  feedback: AdminStudentFeedback;
  student: AdminStudent | undefined;
  onReply: (reply: string) => void;
}) {
  const [open, setOpen] = useState(false);
  const [reply, setReply] = useState("");
  const [sent, setSent] = useState(false);

  // La réponse enregistrée est chargée UNE fois par retour (comparaison par
  // id UNIQUEMENT — jamais par le contenu du brouillon) : si la liste se
  // recharge pendant la saisie, le brouillon n'est pas écrasé. Ajustement
  // d'état pendant le rendu (motif recommandé « You Might Not Need an
  // Effect », déjà utilisé par app/admin/parametres) — logique équivalente
  // testée dans scripts/tests/feedback-reply-draft.mts.
  const [loadedForId, setLoadedForId] = useState<string | null>(null);
  if (loadedForId !== feedback.id) {
    setLoadedForId(feedback.id);
    setReply(feedback.coachReply ?? "");
  }

  function close() {
    setOpen(false);
    setSent(false);
  }

  function handleSend() {
    if (!reply.trim()) return;
    onReply(reply.trim());
    setSent(true);
  }

  // Résultats cardio BLOC PAR BLOC (format v2, triés par ordre de séance) +
  // éventuel retour global historique (v1) ; les entrées réservées
  // « Cardio · Résultats » sont retirées du détail par exercice pour ne pas
  // s'afficher comme une fausse série de musculation, et aucune structure
  // technique (JSON, blockId) n'est jamais rendue.
  const parsedCardio = parseCardioResults(feedback.exerciseEntries);
  const strengthEntries = feedback.exerciseEntries.filter((entry) => !isCardioResultEntryName(entry.exerciseName));

  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        className="pressable flex min-h-[44px] items-center gap-1.5 rounded-control border border-border px-4 py-2 text-xs uppercase tracking-widest text-muted-foreground transition-colors hover:border-primary hover:text-primary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/40"
      >
        <Eye size={13} />
        Voir détail
      </button>

      {open && (
        <Modal title={`${feedbackTypeDisplayLabel(feedback)} — ${feedback.refLabel}`} onClose={close} maxWidth="max-w-lg">
          <div className="flex flex-col gap-4">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <span className="text-sm text-foreground">{student ? fullName(student) : "Élève non identifié"}</span>
              <StatusBadge label={feedbackStatusLabels[feedback.status]} tone={feedbackStatusTone(feedback.status)} />
            </div>
            <p className="text-xs text-muted-foreground">{formatDate(feedback.date)}</p>

            {feedback.type === "entrainement" && (
              <>
                <p className="text-sm text-foreground">
                  Séance {feedback.completed ? "terminée" : "non terminée"}
                </p>
                {!feedback.programId && (
                  <p className="text-xs text-muted-foreground">Programme non lié</p>
                )}
              </>
            )}
            {feedback.rpe !== null && (
              <p className="text-sm text-foreground">RPE global : {feedback.rpe} / 10</p>
            )}
            {feedback.pain && (
              <p className="text-sm text-warning">Douleur / gêne : {feedback.pain}</p>
            )}
            {feedback.comment && <p className="text-sm text-foreground">{feedback.comment}</p>}

            {parsedCardio.blocks.length > 0 && (
              <div>
                <h4 className="mb-2 text-xs uppercase tracking-wide text-muted-foreground">Retour cardio — bloc par bloc</h4>
                <div className="flex flex-col gap-2">
                  {parsedCardio.blocks.map((result) => (
                    <CardioBlockResultCard key={result.blockId} result={result} />
                  ))}
                </div>
              </div>
            )}

            {parsedCardio.legacy && (
              <div>
                <h4 className="mb-2 text-xs uppercase tracking-wide text-muted-foreground">Retour cardio global (historique)</h4>
                <div className="rounded-panel border border-border bg-surface-soft/40 p-3 text-sm text-foreground">
                  {[
                    parsedCardio.legacy.durationLabel && `Durée : ${parsedCardio.legacy.durationLabel}`,
                    parsedCardio.legacy.distanceLabel && `Distance : ${parsedCardio.legacy.distanceLabel}`,
                    parsedCardio.legacy.elevationLabel && `D+ : ${parsedCardio.legacy.elevationLabel}`,
                  ]
                    .filter(Boolean)
                    .join(" · ")}
                </div>
              </div>
            )}

            {strengthEntries.length > 0 && (
              <div>
                <h4 className="mb-2 text-xs uppercase tracking-wide text-muted-foreground">Détail par exercice</h4>
                <div className="flex flex-col gap-2">
                  {strengthEntries.map((entry, i) => (
                    <div key={i} className="rounded-panel border border-border p-3 text-sm">
                      <div className="flex justify-between text-foreground">
                        <span>{entry.exerciseName} — série {entry.setNumber}</span>
                        {entry.rpe !== null && <span className="text-muted-foreground">RPE {entry.rpe}</span>}
                      </div>
                      <div className="mt-1 text-xs text-muted-foreground">
                        {entry.loadUsed} · {entry.repsDone} reps
                        {entry.comment && ` · ${entry.comment}`}
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            )}

            {sent ? (
              <div role="status" className="flex items-center gap-3 rounded-panel border border-success/40 bg-success/10 px-4 py-3 text-sm text-success">
                <CheckCircle size={18} className="flex-shrink-0" aria-hidden="true" />
                Réponse envoyée, retour marqué comme traité.
              </div>
            ) : (
              <>
                <TextareaField label="Réponse coach" value={reply} onChange={setReply} rows={3} />
                <PrimaryButton onClick={handleSend} disabled={!reply.trim()}>
                  Envoyer la réponse
                </PrimaryButton>
              </>
            )}
          </div>
        </Modal>
      )}
    </>
  );
}
