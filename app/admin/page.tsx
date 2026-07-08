"use client";

import Link from "next/link";
import {
  Bell,
  CalendarDays,
  ClipboardList,
  Dumbbell,
  FileText,
  MessageSquare,
  UserPlus,
  Users,
  UtensilsCrossed,
} from "lucide-react";

import { StatCard } from "@/components/admin/StatCard";
import { AdminSection } from "@/components/admin/AdminSection";
import { StatusBadge, studentStatusTone } from "@/components/admin/StatusBadge";
import { useAdminData } from "@/hooks/useAdminData";
import { useSupabaseAppointments } from "@/hooks/useSupabaseAppointments";
import { useSupabaseDocuments } from "@/hooks/useSupabaseDocuments";
import { useSupabaseNutritionPlans } from "@/hooks/useSupabaseNutritionPlans";
import { useSupabasePrograms } from "@/hooks/useSupabasePrograms";
import { useSupabaseStudents } from "@/hooks/useSupabaseStudents";
import { useSupabaseAdminFeedback } from "@/hooks/useSupabaseAdminFeedback";
import {
  fullName,
  studentsWithStaleWeight,
  studentsWithRecentFeedback,
  studentsWithUnvalidatedNutritionDay,
  studentsWithUnvalidatedSession,
  studentsWithoutRecentLogin,
} from "@/lib/admin";

const quickActions = [
  { label: "Créer un élève", href: "/admin/eleves", icon: UserPlus },
  { label: "Créer un programme", href: "/admin/programmes/nouveau", icon: Dumbbell },
  { label: "Créer un plan alimentaire", href: "/admin/nutrition/nouveau", icon: UtensilsCrossed },
  { label: "Ajouter un document", href: "/admin/documents/nouveau", icon: FileText },
  { label: "Voir le calendrier", href: "/admin/calendrier", icon: CalendarDays },
  { label: "Voir les retours élèves", href: "/admin/retours", icon: MessageSquare },
];

const mockNotifications = [
  "3 nouveaux retours élèves à traiter cette semaine",
  "Léa Martin a mis son compte en pause",
  "Nouveau document ajouté : Guide mobilité épaule",
];

function StudentWatchList({
  title,
  students,
  emptyLabel,
}: {
  title: string;
  students: { id: string; firstName: string; lastName: string; status: string }[];
  emptyLabel: string;
}) {
  return (
    <div>
      <h3 className="mb-3 text-xs uppercase tracking-wide text-muted-foreground">{title}</h3>
      {students.length === 0 ? (
        <p className="text-sm text-muted-foreground">{emptyLabel}</p>
      ) : (
        <div className="flex flex-col gap-2">
          {students.map((s) => (
            <Link
              key={s.id}
              href={`/admin/eleves/${s.id}`}
              className="flex items-center justify-between gap-3 border border-border px-4 py-3 text-sm text-foreground transition-colors hover:border-primary"
            >
              {fullName(s)}
              <StatusBadge label={s.status} tone={studentStatusTone(s.status)} />
            </Link>
          ))}
        </div>
      )}
    </div>
  );
}

export default function AdminDashboardPage() {
  const { state } = useAdminData();
  const { documents } = state;

  // Élèves, retours entraînement, programmes, plans alimentaires et
  // documents : priorité Supabase dès qu'il y a au moins une ligne réelle,
  // sinon repli sur les données mock — même pattern que /admin/eleves,
  // /admin/retours, /admin/programmes, /admin/nutrition et /admin/documents.
  const supabaseStudents = useSupabaseStudents();
  const students = supabaseStudents.students.length > 0 ? supabaseStudents.students : state.students;
  const supabaseFeedback = useSupabaseAdminFeedback();
  const feedback = supabaseFeedback.feedback.length > 0 ? supabaseFeedback.feedback : state.feedback;
  const supabasePrograms = useSupabasePrograms();
  const programs = supabasePrograms.programs.length > 0 ? supabasePrograms.programs : state.programs;
  const programsAreReal = supabasePrograms.programs.length > 0;
  const supabaseNutritionPlans = useSupabaseNutritionPlans();
  const nutritionPlans = supabaseNutritionPlans.plans.length > 0 ? supabaseNutritionPlans.plans : state.nutritionPlans;
  const nutritionPlansAreReal = supabaseNutritionPlans.plans.length > 0;
  const supabaseDocuments = useSupabaseDocuments();
  const realDocuments = supabaseDocuments.documents.length > 0 ? supabaseDocuments.documents : documents;
  const documentsAreReal = supabaseDocuments.documents.length > 0;
  const supabaseAppointments = useSupabaseAppointments();

  const activeStudents = students.filter((s) => s.status === "actif");
  const pausedStudents = students.filter((s) => s.status === "pause");
  const activePrograms = programs.filter((p) => p.status === "actif");
  const activePlans = nutritionPlans.filter((p) => p.status === "actif");
  const publishedDocuments = realDocuments.filter((d) => d.status === "publié");
  const feedbackToTreat = feedback.filter((f) => f.status === "a-traiter" || f.status === "important");
  const todayKey = new Date().toDateString();
  const todaysAppointments = supabaseAppointments.appointments.filter(
    (a) => (a.status === "pending" || a.status === "confirmed") && new Date(a.startAt).toDateString() === todayKey,
  );

  return (
    <div>
      <div className="mb-8">
        <h1 className="font-heading text-3xl font-extrabold uppercase text-foreground md:text-4xl">
          Dashboard admin
        </h1>
        <p className="mt-1 text-sm text-muted-foreground">
          Vue d&apos;ensemble de ton activité de coaching.
        </p>
      </div>

      <div className="mb-8 grid grid-cols-2 gap-4 lg:grid-cols-4">
        <StatCard icon={Users} label="Élèves actifs" value={activeStudents.length} tone="primary" />
        <StatCard icon={Users} label="Élèves en pause" value={pausedStudents.length} tone="amber" />
        <StatCard
          icon={Dumbbell}
          label={programsAreReal ? "Programmes actifs" : "Programmes actifs (exemple)"}
          value={activePrograms.length}
        />
        <StatCard
          icon={UtensilsCrossed}
          label={nutritionPlansAreReal ? "Plans alimentaires actifs" : "Plans alimentaires actifs (exemple)"}
          value={activePlans.length}
        />
        <StatCard
          icon={FileText}
          label={documentsAreReal ? "Documents partagés" : "Documents partagés (exemple)"}
          value={publishedDocuments.length}
        />
        <StatCard
          icon={ClipboardList}
          label="Retours à traiter"
          value={feedbackToTreat.length}
          tone={feedbackToTreat.length > 0 ? "amber" : "default"}
        />
        <StatCard icon={CalendarDays} label="Rendez-vous aujourd'hui" value={todaysAppointments.length} />
        <StatCard icon={Bell} label="Notifications (exemple)" value={mockNotifications.length} />
      </div>

      <div className="mb-8 border border-border bg-card p-6">
        <h2 className="mb-4 font-heading text-lg font-bold uppercase text-foreground">
          Actions rapides
        </h2>
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-5">
          {quickActions.map(({ label, href, icon: Icon }) => (
            <Link
              key={href}
              href={href}
              className="flex flex-col items-center gap-2 border border-border px-4 py-5 text-center text-xs uppercase tracking-widest text-muted-foreground transition-colors hover:border-primary hover:text-primary"
            >
              <Icon size={20} />
              {label}
            </Link>
          ))}
        </div>
      </div>

      <div className="mb-8 border border-border bg-card p-6">
        <h2 className="mb-4 font-heading text-lg font-bold uppercase text-foreground">
          Notifications (exemple)
        </h2>
        <div className="flex flex-col gap-3">
          {mockNotifications.map((notif) => (
            <div key={notif} className="flex items-start gap-3 border-b border-border pb-3 text-sm text-foreground last:border-0 last:pb-0">
              <Bell size={14} className="mt-0.5 flex-shrink-0 text-primary" />
              {notif}
            </div>
          ))}
        </div>
      </div>

      <AdminSection title="Élèves à suivre">
        <div className="grid grid-cols-1 gap-6 lg:grid-cols-2">
          <StudentWatchList
            title="Retour récent"
            students={studentsWithRecentFeedback(students, feedback)}
            emptyLabel="Aucun retour récent."
          />
          <StudentWatchList
            title="Sans connexion récente"
            students={studentsWithoutRecentLogin(students)}
            emptyLabel="Tout le monde s'est connecté récemment."
          />
          <StudentWatchList
            title="Poids non mis à jour"
            students={studentsWithStaleWeight(students)}
            emptyLabel="Tous les poids sont à jour."
          />
          <StudentWatchList
            title="Séance non validée récemment"
            students={studentsWithUnvalidatedSession(students, feedback)}
            emptyLabel="Toutes les séances sont à jour."
          />
          <StudentWatchList
            title="Journée nutrition non validée récemment"
            students={studentsWithUnvalidatedNutritionDay(students, feedback)}
            emptyLabel="Toutes les journées sont à jour."
          />
        </div>
      </AdminSection>
    </div>
  );
}
