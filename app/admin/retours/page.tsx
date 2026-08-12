"use client";

import { useState } from "react";
import { AlertTriangle, CheckCheck, MessageSquare, RotateCcw } from "lucide-react";

import { FeedbackDetailModal, feedbackTypeDisplayLabel } from "@/components/admin/FeedbackDetailModal";
import { FilterButtons, SearchInput } from "@/components/admin/SearchAndFilters";
import { StatusBadge, feedbackStatusTone } from "@/components/admin/StatusBadge";
import { useAdminData } from "@/hooks/useAdminData";
import { useSupabaseAdminFeedback } from "@/hooks/useSupabaseAdminFeedback";
import { useSupabaseStudents } from "@/hooks/useSupabaseStudents";
import { feedbackStatusLabels, formatDate, fullName, matchesTextSearch } from "@/lib/admin";
import { formatRpeFr } from "@/lib/rpe";
import type { FeedbackStatus, FeedbackType } from "@/types";

type StatusFilter = "tous" | FeedbackStatus;
type TypeFilter = "tous" | FeedbackType;

const statusFilters: { value: StatusFilter; label: string }[] = [
  { value: "tous", label: "Tous" },
  { value: "a-traiter", label: "À traiter" },
  { value: "important", label: "Important" },
  { value: "traité", label: "Traité" },
];

const typeFilters: { value: TypeFilter; label: string }[] = [
  { value: "tous", label: "Tous" },
  { value: "entrainement", label: "Entraînement" },
  { value: "nutrition", label: "Nutrition" },
  { value: "profil", label: "Profil" },
];

export default function AdminFeedbackPage() {
  const { state, setFeedbackStatus, addCoachReply } = useAdminData();

  // Supabase a la priorité dès qu'il a au moins un retour réel ; sinon on
  // retombe sur la liste mock (localStorage) — même logique que
  // /admin/eleves (voir hooks/useSupabaseStudents.ts). Les élèves viennent
  // de la même source que les retours affichés, pour que les noms/emails se
  // résolvent correctement des deux côtés.
  const supabaseFeedback = useSupabaseAdminFeedback();
  const supabaseStudents = useSupabaseStudents();
  const useSupabase = supabaseFeedback.feedback.length > 0;
  const feedback = useSupabase ? supabaseFeedback.feedback : state.feedback;
  const students = useSupabase ? supabaseStudents.students : state.students;

  const [query, setQuery] = useState("");
  const [statusFilter, setStatusFilter] = useState<StatusFilter>("tous");
  const [typeFilter, setTypeFilter] = useState<TypeFilter>("tous");
  const [studentFilter, setStudentFilter] = useState("tous");

  const filtered = feedback
    .filter((f) => {
      const student = students.find((s) => s.id === f.studentId);
      return (
        matchesTextSearch([f.refLabel, f.comment, student ? fullName(student) : ""], query) &&
        (statusFilter === "tous" || f.status === statusFilter) &&
        (typeFilter === "tous" || f.type === typeFilter) &&
        (studentFilter === "tous" || f.studentId === studentFilter)
      );
    })
    .sort((a, b) => new Date(b.date).getTime() - new Date(a.date).getTime());

  return (
    <div>
      <div className="mb-8">
        <h1 className="font-heading text-3xl font-extrabold uppercase text-foreground md:text-4xl">
          Retours élèves
        </h1>
        <p className="mt-1 text-sm text-muted-foreground">{feedback.length} retours au total.</p>
      </div>

      <div className="mb-6 flex flex-col gap-4">
        <SearchInput value={query} onChange={setQuery} placeholder="Rechercher un retour..." />
        <div className="flex flex-wrap items-center gap-4">
          <FilterButtons options={statusFilters} active={statusFilter} onChange={setStatusFilter} />
          <FilterButtons options={typeFilters} active={typeFilter} onChange={setTypeFilter} />
          <select
            value={studentFilter}
            onChange={(e) => setStudentFilter(e.target.value)}
            aria-label="Filtrer par élève"
            className="min-h-[44px] max-w-full rounded-control border border-border bg-surface-soft px-4 py-2 text-xs uppercase tracking-widest text-muted-foreground transition-colors focus:border-primary focus:outline-none focus-visible:ring-2 focus-visible:ring-primary/40"
          >
            <option value="tous">Tous les élèves</option>
            {students.map((s) => (
              <option key={s.id} value={s.id}>
                {fullName(s)}
              </option>
            ))}
          </select>
        </div>
      </div>

      {filtered.length === 0 ? (
        <p className="flex items-center gap-2 rounded-card border border-border bg-card p-6 text-sm text-muted-foreground shadow-soft">
          <MessageSquare size={16} aria-hidden="true" />
          {feedback.length === 0 ? "Aucun retour pour le moment." : "Aucun retour ne correspond à ta recherche."}
        </p>
      ) : (
        <div className="flex flex-col gap-4">
          {filtered.map((f) => {
            const student = students.find((s) => s.id === f.studentId);
            return (
              // Infos en grille (min-w-0 partout), actions sur une LIGNE
              // DÉDIÉE sous un séparateur — jamais côte à côte avec le
              // contenu, donc aucune collision possible de 1024 à 1440 px
              // (leçon de l'audit). Mobile : tout s'empile, boutons pleine
              // largeur.
              <div key={f.id} className="flex flex-col gap-4 rounded-card border border-border bg-card p-6 shadow-soft transition-colors hover:border-border-strong">
                <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-4">
                  <div className="min-w-0">
                    <span className="block text-xs uppercase tracking-wide text-muted-foreground">Élève</span>
                    <span className="break-words text-sm font-bold text-foreground">
                      {student ? fullName(student) : "Élève non identifié"}
                    </span>
                  </div>
                  <div className="min-w-0">
                    <span className="block text-xs uppercase tracking-wide text-muted-foreground">Type · Concerné</span>
                    <span className="break-words text-sm text-foreground">
                      {feedbackTypeDisplayLabel(f)} — {f.refLabel}
                    </span>
                  </div>
                  <div className="min-w-0">
                    <span className="block text-xs uppercase tracking-wide text-muted-foreground">Date</span>
                    <span className="text-sm text-foreground">{formatDate(f.date)}</span>
                    {f.rpe !== null && <span className="block text-xs text-muted-foreground">RPE {formatRpeFr(f.rpe)}/10</span>}
                  </div>
                  <div className="min-w-0">
                    <span className="block text-xs uppercase tracking-wide text-muted-foreground">Statut</span>
                    <span className="mt-1 block">
                      <StatusBadge label={feedbackStatusLabels[f.status]} tone={feedbackStatusTone(f.status)} />
                    </span>
                  </div>
                </div>
                <div className="flex flex-col gap-2 border-t border-border pt-4 sm:flex-row sm:flex-wrap">
                  <FeedbackDetailModal
                    feedback={f}
                    student={student}
                    // Le chemin MOCK ne connaît que le texte : il n'a ni
                    // bucket, ni élève réel à qui adresser une vidéo. On ne
                    // lui invente pas une réponse vidéo qu'il ne saurait ni
                    // stocker ni relire.
                    onReply={(reponse) =>
                      useSupabase ? supabaseFeedback.addReply(f.id, reponse) : addCoachReply(f.id, reponse.texte)
                    }
                  />
                  {f.status !== "important" && (
                    <button
                      type="button"
                      onClick={() =>
                        useSupabase ? supabaseFeedback.updateStatus(f.id, "important") : setFeedbackStatus(f.id, "important")
                      }
                      className="pressable flex min-h-[44px] items-center justify-center gap-1.5 rounded-control border border-warning/50 px-4 py-2 text-xs uppercase tracking-widest text-warning transition-colors hover:bg-warning/10 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-warning/40 sm:justify-start"
                    >
                      <AlertTriangle size={13} aria-hidden="true" />
                      Marquer important
                    </button>
                  )}
                  {f.status !== "traité" && (
                    <button
                      type="button"
                      onClick={() =>
                        useSupabase ? supabaseFeedback.updateStatus(f.id, "traité") : setFeedbackStatus(f.id, "traité")
                      }
                      className="pressable flex min-h-[44px] items-center justify-center gap-1.5 rounded-control border border-success/50 px-4 py-2 text-xs uppercase tracking-widest text-success transition-colors hover:bg-success/10 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-success/40 sm:justify-start"
                    >
                      <CheckCheck size={13} aria-hidden="true" />
                      Marquer traité
                    </button>
                  )}
                  {f.status !== "a-traiter" && (
                    <button
                      type="button"
                      onClick={() =>
                        useSupabase
                          ? supabaseFeedback.updateStatus(f.id, "a-traiter")
                          : setFeedbackStatus(f.id, "a-traiter")
                      }
                      className="pressable flex min-h-[44px] items-center justify-center gap-1.5 rounded-control border border-border px-4 py-2 text-xs uppercase tracking-widest text-muted-foreground transition-colors hover:border-primary hover:text-primary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/40 sm:justify-start"
                    >
                      <RotateCcw size={13} aria-hidden="true" />
                      Remettre à traiter
                    </button>
                  )}
                </div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
