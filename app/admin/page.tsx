"use client";

import Link from "next/link";
import {
  AlertTriangle,
  Bell,
  CalendarDays,
  ClipboardList,
  CreditCard,
  Dumbbell,
  FileText,
  MessageSquare,
  UserPlus,
  Users,
  UtensilsCrossed,
} from "lucide-react";

import { ActivityFeed } from "@/components/admin/ActivityFeed";
import { DashboardNotifications } from "@/components/admin/DashboardNotifications";
import { NotificationComposer } from "@/components/admin/NotificationComposer";
import { StatCard } from "@/components/admin/StatCard";
import { StatusBadge, studentStatusTone } from "@/components/admin/StatusBadge";
import { useAdminData } from "@/hooks/useAdminData";
import { useSupabaseActivity } from "@/hooks/useSupabaseActivity";
import { useSupabaseAdminBilling } from "@/hooks/useSupabaseAdminBilling";
import { useSupabaseAppointments } from "@/hooks/useSupabaseAppointments";
import { useSupabaseDocuments } from "@/hooks/useSupabaseDocuments";
import { useSupabaseNutritionPlans } from "@/hooks/useSupabaseNutritionPlans";
import { useSupabaseProgramsSummary } from "@/hooks/useSupabaseProgramsSummary";
import { useSupabaseStudents } from "@/hooks/useSupabaseStudents";
import { useSupabaseAdminFeedback } from "@/hooks/useSupabaseAdminFeedback";
import { isSupabaseConfigured } from "@/lib/supabase/env";
import { Loader } from "@/components/ui/Loader";
import { formatAmountCents } from "@/lib/stripe/status";
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
              className="pressable flex min-h-[44px] items-center justify-between gap-3 rounded-control border border-border px-4 py-2.5 text-sm text-foreground hover:border-primary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/40"
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

  /*
   * ════════════════════════════════════════════════════════════════════
   * LA SOURCE DÉPEND DE LA CONFIGURATION, PLUS DU NOMBRE DE LIGNES
   * ════════════════════════════════════════════════════════════════════
   * Les CINQ listes de ce tableau de bord choisissaient leur source sur le
   * nombre de lignes chargées. Au premier rendu elles sont toutes vides :
   * le dashboard annonçait donc les compteurs des fixtures de
   * `data/admin.ts` — 7 élèves `@mail.mock`, 3 programmes, 7 retours — à
   * chaque ouverture, avant de se corriger. Et un compteur réellement à
   * zéro restait sur la valeur mock, définitivement.
   *
   * ⚠️ « SUPABASE EST-IL CONFIGURÉ » EST LA BONNE QUESTION. Après
   * chargement, une liste vide veut dire « aucune donnée », pas « montre-moi
   * des faux ». Même contrat que /admin/eleves, /admin/programmes,
   * /admin/nutrition, /admin/documents et /admin/retours.
   *
   * ⚠️ LES TROIS DRAPEAUX « (exemple) » SUIVENT LA SOURCE, et c'est leur
   * sens exact : l'étiquette ne doit dire « exemple » que lorsque ce qui est
   * compté EST un exemple. Les laisser sur le nombre de lignes afficherait
   * « Programmes actifs (exemple) » sur des programmes bien réels d'un coach
   * qui n'en a aucun d'actif.
   *
   * Le repli mock survit pour le seul cas où il a un sens : Supabase non
   * configuré — développement local, démonstration.
   */
  const supabaseActive = isSupabaseConfigured();
  const supabaseStudents = useSupabaseStudents();
  const students = supabaseActive ? supabaseStudents.students : state.students;
  const supabaseFeedback = useSupabaseAdminFeedback();
  const feedback = supabaseActive ? supabaseFeedback.feedback : state.feedback;
  const supabasePrograms = useSupabaseProgramsSummary();
  const programs = supabaseActive ? supabasePrograms.programs : state.programs;
  const programsAreReal = supabaseActive;
  const supabaseNutritionPlans = useSupabaseNutritionPlans();
  const nutritionPlans = supabaseActive ? supabaseNutritionPlans.plans : state.nutritionPlans;
  const nutritionPlansAreReal = supabaseActive;
  const supabaseDocuments = useSupabaseDocuments();
  const realDocuments = supabaseActive ? supabaseDocuments.documents : documents;
  const documentsAreReal = supabaseActive;
  const supabaseAppointments = useSupabaseAppointments();
  const supabaseActivity = useSupabaseActivity();
  const supabaseBilling = useSupabaseAdminBilling();

  /*
   * ⚠️ AUCUN COMPTEUR N'EST AFFICHÉ AVANT D'ÊTRE VRAI. Les cinq listes
   * alimentent des chiffres (« 26 élèves », « 16 programmes ») : les rendre
   * à zéro puis les corriger donnerait l'impression d'une base vide. La
   * garde est APRÈS tous les hooks (règle des hooks), et ne couvre QUE les
   * cinq listes qui pilotent la source — les rendez-vous, l'activité et la
   * facturation ont leurs propres états de chargement, inchangés.
   */
  if (
    supabaseActive &&
    (supabaseStudents.loading ||
      supabaseFeedback.loading ||
      supabasePrograms.loading ||
      supabaseNutritionPlans.loading ||
      supabaseDocuments.loading)
  ) {
    return <Loader libelle="Chargement du tableau de bord…" variante="ligne" />;
  }

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

  // Notifications réelles = flux d'activité (activity_events), déjà chargé
  // pour le Centre d'activité — aucune requête supplémentaire. Le compteur de
  // la carte suit les non-lues ; le bloc liste les 4 plus récentes.
  const unreadNotificationsCount = supabaseActivity.events.filter((event) => !event.isRead).length;

  const activeSubscriptions = supabaseBilling.items.filter((item) => item.status === "actif");
  const latePayments = supabaseBilling.items.filter((item) => item.status === "paiement_echoue");
  const estimatedMonthlyRevenueCents = activeSubscriptions.reduce(
    (total, item) => total + (item.subscription?.amountCents ?? 0),
    0,
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
        <StatCard
          icon={Bell}
          label="Notifications non lues"
          value={unreadNotificationsCount}
          tone={unreadNotificationsCount > 0 ? "primary" : "default"}
        />
      </div>

      <div className="mb-8 grid grid-cols-1 gap-4 sm:grid-cols-3">
        <StatCard icon={CreditCard} label="Abonnements actifs" value={activeSubscriptions.length} tone="primary" />
        <StatCard
          icon={AlertTriangle}
          label="Paiements en retard"
          value={latePayments.length}
          tone={latePayments.length > 0 ? "amber" : "default"}
        />
        <StatCard icon={CreditCard} label="Revenu mensuel estimé" value={formatAmountCents(estimatedMonthlyRevenueCents)} />
      </div>

      <div className="mb-8 rounded-card border border-border bg-card p-6 shadow-soft">
        <h2 className="mb-4 font-heading text-lg font-bold uppercase text-foreground">
          Actions rapides
        </h2>
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-5">
          {quickActions.map(({ label, href, icon: Icon }) => (
            <Link
              key={href}
              href={href}
              className="pressable flex flex-col items-center justify-center gap-2 rounded-panel border border-border bg-surface-soft/40 px-4 py-5 text-center text-xs uppercase tracking-widest text-muted-foreground hover:border-primary hover:text-primary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/40"
            >
              <Icon size={20} />
              {label}
            </Link>
          ))}
        </div>
      </div>

      <div className="mb-8 rounded-card border border-border bg-card p-6 shadow-soft">
        <div className="mb-4 flex flex-wrap items-center justify-between gap-2">
          <h2 className="font-heading text-lg font-bold uppercase text-foreground">
            Notifications
          </h2>
          {/* La gestion avancée — programmation, répétitions, historique —
              vit sur sa propre page. Ce bloc reste court à dessein. */}
          <Link
            href="/admin/notifications"
            className="text-[11px] uppercase tracking-widest text-muted-foreground transition-colors hover:text-primary"
          >
            Gérer →
          </Link>
        </div>
        <NotificationComposer students={students} compact />
        <div className="mt-6">
          <DashboardNotifications events={supabaseActivity.events} loading={supabaseActivity.loading} />
        </div>
      </div>

      <div className="mb-8 rounded-card border border-border bg-card p-6 shadow-soft">
        <h2 className="mb-4 font-heading text-lg font-bold uppercase text-foreground">
          Centre d&apos;activité
        </h2>
        {!supabaseActivity.loading && supabaseActivity.events.length === 0 ? (
          <p className="text-sm text-muted-foreground">
            Aucune activité pour le moment — elle apparaîtra ici dès qu&apos;un élève complète son onboarding, envoie un
            retour, réserve un rendez-vous, ou qu&apos;une action leur est assignée.
          </p>
        ) : (
          <ActivityFeed events={supabaseActivity.events} students={students} onMarkRead={supabaseActivity.markRead} showFilter />
        )}
      </div>

      {/* Wrapper LOCAL (polish Apple admin, Lot B) : AdminSection est un
          transversal réservé aux lots C/H/J — la carte « Élèves à suivre »
          du dashboard est donc polie ici directement, sans toucher au
          composant partagé ni en créer un nouveau. */}
      <div className="rounded-card border border-border bg-card p-6 shadow-soft">
        <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
          <h2 className="font-heading text-lg font-bold uppercase text-foreground">Élèves à suivre</h2>
        </div>
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
      </div>
    </div>
  );
}
