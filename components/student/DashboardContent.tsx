"use client";

import Link from "next/link";
import { Bell, Dumbbell, Flame, Scale, Target, TrendingUp } from "lucide-react";

import { StatCard } from "@/components/student/StatCard";
import { WeightChart } from "@/components/student/WeightChart";
import { useStudentProfile, type StudentProfileState } from "@/hooks/useStudentProfile";
import { useSupabaseNutritionForStudent } from "@/hooks/useSupabaseNutritionForStudent";
import { useSupabaseStudentProfile } from "@/hooks/useSupabaseStudentProfile";
import { useSupabaseTrainingProgram } from "@/hooks/useSupabaseTrainingProgram";
import { isSupabaseConfigured } from "@/lib/supabase/env";
import { coachingStatusLabels, computeWeightEvolution } from "@/lib/profile";
import { getHighlightedScheduleDay } from "@/data/student";
import { computeCurrentWeekNumber, toEleveTrainingProgram, toEleveWorkoutSession } from "@/lib/training-schedule";
import type {
  CoachNotification,
  DocumentItem,
  MealPlan,
  TrainingProgram,
  UpcomingSession,
} from "@/types";

interface DashboardContentProps {
  studentId: string;
  seed: StudentProfileState;
  activeProgram: TrainingProgram;
  upcomingSession: UpcomingSession;
  activeMealPlan: MealPlan;
  coachNotifications: CoachNotification[];
  recentDocuments: DocumentItem[];
}

/**
 * Documents ne sont pas encore migrés vers Supabase : cette section reste
 * un exemple fixe quel que soit le compte connecté, clairement annotée
 * "exemple" plutôt que présentée comme les vraies données de l'élève.
 * Programme et plan alimentaire actifs sont réels dès qu'assignés (voir
 * hooks/useSupabaseTrainingProgram.ts et hooks/useSupabaseNutritionForStudent.ts).
 */
export function DashboardContent({
  studentId,
  seed,
  activeProgram,
  upcomingSession,
  activeMealPlan,
  coachNotifications,
  recentDocuments,
}: DashboardContentProps) {
  // Toujours montés tous les deux (règle des hooks) : useSupabaseStudentProfile
  // vérifie si l'utilisateur connecté a une vraie fiche élève Supabase. Tant
  // que Supabase n'est pas configuré, n'a pas de fiche pour ce compte, ou que
  // la vérification est en cours, on continue avec le mock/localStorage
  // existant (même hook/même clé que /profil, pour rester cohérent).
  const mockProfile = useStudentProfile(studentId, seed);
  const supabaseProfile = useSupabaseStudentProfile();
  const useSupabase = supabaseProfile.ready && supabaseProfile.state !== null;
  const supabaseTraining = useSupabaseTrainingProgram();
  const supabaseNutrition = useSupabaseNutritionForStudent();

  if (!supabaseProfile.ready) {
    return <p className="text-sm text-muted-foreground">Chargement du dashboard…</p>;
  }

  // Supabase configuré et utilisateur connecté, mais aucune fiche élève
  // reliée à ce compte (élève pas encore lié par le coach, ou coach/admin
  // qui prévisualise l'espace élève — voir lib/supabase/guards.ts) : ne
  // jamais afficher les données mock (Alexandre) à la place, ce qui ferait
  // croire à un vrai compte qu'il s'agit de ses propres données.
  if (isSupabaseConfigured() && !useSupabase) {
    return (
      <div className="flex flex-col items-center justify-center gap-3 border border-dashed border-border py-20 text-center">
        <p className="font-heading text-lg font-bold uppercase text-foreground">
          Profil élève non configuré
        </p>
        <p className="max-w-md text-sm text-muted-foreground">
          Ce compte n&apos;est pas encore relié à une fiche élève. Contacte ton coach pour finaliser ton accès.
        </p>
      </div>
    );
  }

  const state = useSupabase ? supabaseProfile.state! : mockProfile.state;
  const { profile, weightHistory } = state;
  const evolution = computeWeightEvolution(weightHistory, profile);
  const weightDeltaLabel = evolution.hasData
    ? `${evolution.deltaFromStartKg > 0 ? "+" : ""}${evolution.deltaFromStartKg} kg`
    : "—";

  // Prochaine séance réelle : programme réellement assigné à l'élève (voir
  // hooks/useSupabaseTrainingProgram.ts) plutôt que l'exemple statique
  // upcomingSession/activeProgram, dès que Supabase a la priorité.
  const realActiveProgram = useSupabase ? supabaseTraining.activeProgram : null;
  const realWeekNumber = realActiveProgram ? computeCurrentWeekNumber(realActiveProgram, supabaseTraining.student) : 1;
  const realEleveProgram = realActiveProgram ? toEleveTrainingProgram(realActiveProgram, realWeekNumber) : null;
  const realWeekSessions = realActiveProgram
    ? realActiveProgram.sessions.filter((s) => s.weekNumber === realWeekNumber).map(toEleveWorkoutSession)
    : [];
  const realHighlightedDay = realEleveProgram ? getHighlightedScheduleDay(realEleveProgram.schedule) : null;
  const realHighlightedSession = realHighlightedDay?.sessionId
    ? realWeekSessions.find((s) => s.id === realHighlightedDay.sessionId)
    : undefined;

  return (
    <div>
      <div className="mb-8">
        <h1 className="font-heading text-3xl font-extrabold uppercase text-foreground md:text-4xl">
          Bonjour, {profile.firstName}
        </h1>
        <p className="mt-1 text-sm text-muted-foreground">
          {useSupabase
            ? `Niveau ${profile.level || "non renseigné"} · Statut ${
                coachingStatusLabels[profile.coachingStatus] ?? profile.coachingStatus
              }`
            : `Semaine ${profile.weekNumber} · Programme ${activeProgram.name}`}
        </p>
      </div>

      <div className="mb-6 grid grid-cols-2 gap-4 lg:grid-cols-4">
        <StatCard icon={Flame} label="Séances cette semaine (exemple)" value="3 / 5" />
        <StatCard
          icon={Scale}
          label="Poids actuel"
          value={evolution.hasData ? `${evolution.currentWeightKg} kg` : "Non renseigné"}
        />
        <StatCard icon={Target} label="Objectif" value={profile.goal || "Non renseigné"} />
        <StatCard icon={TrendingUp} label="Progression" value={weightDeltaLabel} accent />
      </div>

      <div className="mb-6 grid grid-cols-1 gap-6 lg:grid-cols-3">
        <div className="border border-border bg-card p-6 lg:col-span-2">
          <div className="mb-4 flex items-center justify-between">
            <h2 className="font-heading text-lg font-bold uppercase text-foreground">
              Évolution du poids
            </h2>
            <span className="font-heading text-xs uppercase tracking-wide text-primary">
              6 mois
            </span>
          </div>
          <WeightChart data={weightHistory} />
        </div>

        <div className="border border-border bg-card p-6">
          <h2 className="mb-4 font-heading text-lg font-bold uppercase text-foreground">
            Notifications
          </h2>
          <div className="flex flex-col gap-4">
            {coachNotifications.map((notification) => (
              <div
                key={notification.id}
                className="flex items-start gap-3 border-b border-border pb-4 last:border-0 last:pb-0"
              >
                <div className="relative mt-0.5">
                  <Bell size={16} className="text-muted-foreground" />
                  {notification.unread && (
                    <span className="absolute -right-0.5 -top-0.5 h-1.5 w-1.5 rounded-full bg-primary" />
                  )}
                </div>
                <div className="flex-1">
                  <p className="text-sm leading-snug text-foreground">
                    {notification.message}
                  </p>
                  <span className="text-xs text-muted-foreground">
                    {notification.time}
                  </span>
                </div>
              </div>
            ))}
          </div>
        </div>
      </div>

      <div className="grid grid-cols-1 gap-6 lg:grid-cols-2">
        <div className="border border-border bg-card p-6">
          <div className="mb-4 flex items-center justify-between">
            <h2 className="font-heading text-lg font-bold uppercase text-foreground">
              Prochaine séance
            </h2>
            {!useSupabase && (
              <span className="text-[10px] uppercase tracking-widest text-muted-foreground">
                Exemple — programme non connecté
              </span>
            )}
          </div>
          {useSupabase && !realHighlightedSession ? (
            <p className="mb-4 text-sm text-muted-foreground">Aucun programme attribué pour le moment.</p>
          ) : (
            <div className="mb-4 flex items-center gap-4">
              <div className="flex h-12 w-12 flex-shrink-0 items-center justify-center bg-primary">
                <Dumbbell size={20} className="text-primary-foreground" />
              </div>
              <div>
                <div className="text-sm font-medium text-foreground">
                  {useSupabase ? realHighlightedSession!.name : upcomingSession.name}
                </div>
                <div className="mt-0.5 text-xs text-muted-foreground">
                  {useSupabase
                    ? `${realHighlightedDay?.isToday ? "Aujourd'hui" : realHighlightedDay?.day} · ${realHighlightedSession!.durationMinutes} min · ${realHighlightedSession!.exercises.length} exercices`
                    : `${upcomingSession.day} · ${upcomingSession.time} · ${upcomingSession.durationMinutes} min · ${upcomingSession.exerciseCount} exercices`}
                </div>
              </div>
            </div>
          )}
          <Link
            href="/entrainement"
            className="block border border-primary py-3 text-center text-xs uppercase tracking-widest text-primary transition-colors hover:bg-primary hover:text-primary-foreground"
          >
            Voir la séance
          </Link>
        </div>

        <div className="border border-border bg-card p-6">
          <h2 className="mb-4 font-heading text-lg font-bold uppercase text-foreground">
            Plan alimentaire actif
          </h2>
          {useSupabase && !supabaseNutrition.activePlan ? (
            <p className="mb-4 text-sm text-muted-foreground">Aucun plan alimentaire attribué pour le moment.</p>
          ) : (
            <div className="mb-4">
              <div className="text-sm font-medium text-foreground">
                {useSupabase ? supabaseNutrition.activePlan!.name : activeMealPlan.name}
              </div>
              <div className="mt-1 text-xs text-muted-foreground">
                {useSupabase
                  ? `${supabaseNutrition.activePlan!.caloriesPerDay} kcal · ${supabaseNutrition.activePlan!.protein}g prot. · ${supabaseNutrition.activePlan!.carbs}g gluc. · ${supabaseNutrition.activePlan!.fat}g lip.`
                  : `${activeMealPlan.calories} kcal · ${activeMealPlan.protein}g prot. · ${activeMealPlan.carbs}g gluc. · ${activeMealPlan.fat}g lip.`}
              </div>
            </div>
          )}
          <Link
            href="/nutrition"
            className="block border border-primary py-3 text-center text-xs uppercase tracking-widest text-primary transition-colors hover:bg-primary hover:text-primary-foreground"
          >
            Voir le plan
          </Link>
        </div>
      </div>

      <div className="mt-6 border border-border bg-card p-6">
        <div className="mb-4 flex items-center justify-between">
          <h2 className="font-heading text-lg font-bold uppercase text-foreground">
            Documents récents
          </h2>
          <Link
            href="/documents"
            className="text-xs uppercase tracking-wide text-primary hover:underline"
          >
            Tout voir
          </Link>
        </div>
        <div className="flex flex-col gap-3">
          {recentDocuments.map((document) => (
            <div
              key={document.id}
              className="flex items-center justify-between border-b border-border pb-3 last:border-0 last:pb-0"
            >
              <div>
                <div className="text-sm text-foreground">{document.title}</div>
                <div className="text-xs uppercase tracking-wide text-muted-foreground">
                  {document.type}
                </div>
              </div>
              <span className="text-xs text-muted-foreground">
                {document.addedAt}
              </span>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
