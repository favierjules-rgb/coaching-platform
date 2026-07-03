"use client";

import { useState } from "react";
import { AlertTriangle, CheckCheck, MessageSquare } from "lucide-react";

import { FeedbackDetailModal } from "@/components/admin/FeedbackDetailModal";
import { FilterButtons, SearchInput } from "@/components/admin/SearchAndFilters";
import { StatusBadge, feedbackStatusTone } from "@/components/admin/StatusBadge";
import { useAdminData } from "@/hooks/useAdminData";
import { feedbackStatusLabels, feedbackTypeLabels, formatDate, fullName, matchesTextSearch } from "@/lib/admin";
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
  const { feedback, students } = state;

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
            className="border border-border bg-background px-4 py-2 text-xs uppercase tracking-widest text-muted-foreground"
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
        <p className="flex items-center gap-2 text-sm text-muted-foreground">
          <MessageSquare size={16} />
          Aucun retour ne correspond à ta recherche.
        </p>
      ) : (
        <div className="flex flex-col gap-4">
          {filtered.map((f) => {
            const student = students.find((s) => s.id === f.studentId);
            return (
              <div
                key={f.id}
                className="flex flex-col gap-4 border border-border bg-card p-6 lg:flex-row lg:items-center lg:justify-between"
              >
                <div className="grid flex-1 grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
                  <div>
                    <span className="block text-xs uppercase tracking-wide text-muted-foreground">Élève</span>
                    <span className="text-sm font-bold text-foreground">{student ? fullName(student) : "—"}</span>
                  </div>
                  <div>
                    <span className="block text-xs uppercase tracking-wide text-muted-foreground">Type · Concerné</span>
                    <span className="text-sm text-foreground">
                      {feedbackTypeLabels[f.type]} — {f.refLabel}
                    </span>
                  </div>
                  <div>
                    <span className="block text-xs uppercase tracking-wide text-muted-foreground">Date</span>
                    <span className="text-sm text-foreground">{formatDate(f.date)}</span>
                    {f.rpe !== null && <span className="block text-xs text-muted-foreground">RPE {f.rpe}/10</span>}
                  </div>
                  <div>
                    <span className="block text-xs uppercase tracking-wide text-muted-foreground">Statut</span>
                    <StatusBadge label={feedbackStatusLabels[f.status]} tone={feedbackStatusTone(f.status)} />
                  </div>
                </div>
                <div className="flex flex-shrink-0 flex-wrap gap-2">
                  <FeedbackDetailModal
                    feedback={f}
                    student={student}
                    onReply={(reply) => addCoachReply(f.id, reply)}
                  />
                  {f.status !== "important" && (
                    <button
                      type="button"
                      onClick={() => setFeedbackStatus(f.id, "important")}
                      className="flex items-center gap-1.5 border border-amber-500/50 px-4 py-2 text-xs uppercase tracking-widest text-amber-400 transition-colors hover:bg-amber-500/10"
                    >
                      <AlertTriangle size={13} />
                      Marquer important
                    </button>
                  )}
                  {f.status !== "traité" && (
                    <button
                      type="button"
                      onClick={() => setFeedbackStatus(f.id, "traité")}
                      className="flex items-center gap-1.5 border border-green-500/50 px-4 py-2 text-xs uppercase tracking-widest text-green-400 transition-colors hover:bg-green-500/10"
                    >
                      <CheckCheck size={13} />
                      Marquer traité
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
