"use client";

import { useState } from "react";
import { CheckCircle, Eye } from "lucide-react";

import { TextareaField } from "@/components/admin/AdminFormFields";
import { Modal, PrimaryButton } from "@/components/admin/Modal";
import { StatusBadge, feedbackStatusTone } from "@/components/admin/StatusBadge";
import { feedbackStatusLabels, feedbackTypeLabels, formatDate, fullName } from "@/lib/admin";
import type { AdminStudent, AdminStudentFeedback } from "@/types";

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
  const [reply, setReply] = useState(feedback.coachReply);
  const [sent, setSent] = useState(false);

  function close() {
    setOpen(false);
    setSent(false);
  }

  function handleSend() {
    if (!reply.trim()) return;
    onReply(reply.trim());
    setSent(true);
  }

  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        className="flex items-center gap-1.5 border border-border px-4 py-2 text-xs uppercase tracking-widest text-muted-foreground transition-colors hover:border-primary hover:text-primary"
      >
        <Eye size={13} />
        Voir détail
      </button>

      {open && (
        <Modal title={`${feedbackTypeLabels[feedback.type]} — ${feedback.refLabel}`} onClose={close} maxWidth="max-w-lg">
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
              <p className="text-sm text-amber-400">Douleur / gêne : {feedback.pain}</p>
            )}
            {feedback.comment && <p className="text-sm text-foreground">{feedback.comment}</p>}

            {feedback.exerciseEntries.length > 0 && (
              <div>
                <h4 className="mb-2 text-xs uppercase tracking-wide text-muted-foreground">Détail par exercice</h4>
                <div className="flex flex-col gap-2">
                  {feedback.exerciseEntries.map((entry, i) => (
                    <div key={i} className="border border-border p-3 text-sm">
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
              <div className="flex items-center gap-3 border border-green-500/40 bg-green-500/10 px-4 py-3 text-sm text-green-400">
                <CheckCircle size={18} className="flex-shrink-0" />
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
