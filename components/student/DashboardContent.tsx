"use client";

import Link from "next/link";
import { Bell, CalendarDays, Dumbbell, Flame, Scale, Target, TrendingUp } from "lucide-react";

import { DiagnosticOffline } from "@/components/pwa/DiagnosticOffline";
import { StatCard } from "@/components/shared/StatCard";
import { WeightChart } from "@/components/shared/WeightChart";
import { NextSessionHighlight } from "@/components/student/NextSessionHighlight";
import { useEtatOfflineEleve } from "@/hooks/useEtatOfflineEleve";
import { useStudentProfile, type StudentProfileState } from "@/hooks/useStudentProfile";
import { useSupabaseAppointmentsForStudent } from "@/hooks/useSupabaseAppointmentsForStudent";
import { useSupabaseNutritionForStudent } from "@/hooks/useSupabaseNutritionForStudent";
import { useSupabaseStudentProfile } from "@/hooks/useSupabaseStudentProfile";
import { useSupabaseTrainingProgram } from "@/hooks/useSupabaseTrainingProgram";
import { formatDateTime } from "@/lib/admin";
import { coachingStatusLabels, computeWeightEvolution } from "@/lib/profile";
import { getHighlightedScheduleDay } from "@/data/student";
import { derivedSessionTypeLabel } from "@/lib/session-summary";
import { deriveSessionType } from "@/lib/training-blocks";
import { computeCurrentWeekNumber, toEleveTrainingProgram, toEleveWorkoutSession } from "@/lib/training-schedule";
import type {
  CoachNotification,
  DocumentItem,
  MealPlan,
  TrainingProgram,
  UpcomingSession,
} from "@/types";
import { Loader } from "@/components/ui/Loader";

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
  const supabaseTraining = useSupabaseTrainingProgram();
  const supabaseNutrition = useSupabaseNutritionForStudent();
  const supabaseAppointments = useSupabaseAppointmentsForStudent();
  /*
   * POURQUOI LE CHARGEMENT A ÉCHOUÉ — la même question que sur /entrainement,
   * et la MÊME réponse : `useEtatOfflineEleve` (donc `diagnostiquer` +
   * `classerSource`). On ne rediagnostique rien ici, et on n'invente pas une
   * troisième détection de réseau.
   *
   * Il n'interroge rien tant que le chargement en ligne n'a pas rendu son
   * verdict, ni quand Supabase n'est pas configuré : l'environnement de
   * démonstration garde exactement le comportement d'avant.
   */
  const useSupabase = supabaseProfile.ready && supabaseProfile.state !== null;
  const local = useEtatOfflineEleve(supabaseProfile.ready && !useSupabase);

  if (!supabaseProfile.ready) {
    return <Loader libelle="Chargement du dashboard…" variante="ligne" />;
  }

  /* ══════════════════════════════════════════════════════════════════
   * SUPABASE CONFIGURÉ, MAIS RIEN N'EST ARRIVÉ — POURQUOI ?
   * ══════════════════════════════════════════════════════════════════
   * Ce bloc disait UNE seule chose — « ce compte n'est pas relié à une
   * fiche élève » — pour quatre situations sans rapport. En avion, l'élève
   * lisait donc qu'il devait contacter son coach. C'était faux, et ça
   * l'envoyait chercher un problème qui n'existait pas.
   *
   * Aucune de ces branches ne montre `data/student.ts` : la démonstration
   * n'est atteinte que plus bas, et UNIQUEMENT sur `local.etat === "mock"`,
   * c'est-à-dire quand `createSupabaseBrowserClient()` ne rend rien.
   *
   * On n'interroge plus `isSupabaseConfigured()` ici : c'était une SECONDE
   * détection de l'environnement, à côté de celle du hook. Deux détections
   * finissent toujours par diverger — et celle-ci divergeait déjà, puisque
   * l'une regardait les variables d'environnement et l'autre le client. */
  if (local.etat !== "mock" && !useSupabase) {
    if (local.etat === "chargement") {
      return <Loader libelle="Chargement du dashboard…" variante="ligne" />;
    }

    return (
      <div>
        <DiagnosticOffline
          titre="/dashboard"
          lignes={{
            etat: local.etat,
            sessionIdSnapshot: local.sessionId,
            businessDate: local.businessDate,
            auth: local.identite ? "oui" : "non",
            remplacantsCles: local.contenu ? Object.keys(local.contenu.remplacants ?? {}).length : null,
          }}
        />
        <div className="mb-8">
          <h1 className="font-heading text-3xl font-extrabold uppercase text-foreground md:text-4xl">
            Ton espace
          </h1>
          <p className="mt-1 text-sm text-muted-foreground">
            {local.etat === "offline"
              ? "Pas de connexion — voici ce qui est disponible sur cet appareil."
              : local.etat === "erreur"
                ? "Le serveur n'a pas pu répondre correctement. Réessaie dans un instant — rien n'a été perdu."
                : "Ce compte n'est pas encore relié à une fiche élève. Contacte ton coach pour finaliser ton accès."}
          </p>
        </div>

        {/* La séance du jour, et RIEN d'autre : c'est tout ce que le snapshot
            contient. Elle porte l'identifiant réel, donc son lien ouvre la
            vraie séance, préparée en ligne. */}
        {local.etat === "offline" && local.contenu && (
          <div className="mb-8">
            <NextSessionHighlight session={local.contenu.session} dayLabel="Aujourd'hui" />
          </div>
        )}

        {/* Poids, notifications, plan alimentaire, rendez-vous, documents :
            tout cela vient du serveur. On le dit une fois, sobrement, au lieu
            d'afficher cinq cartes vides — et surtout au lieu d'afficher les
            chiffres de quelqu'un d'autre. */}
        <div className="rounded-card border border-dashed border-border bg-card p-6 text-sm text-muted-foreground">
          {local.etat === "offline"
            ? "Poids, plan alimentaire, rendez-vous et documents demandent une connexion. Ils reviendront dès que le réseau sera là."
            : "Ces informations n'ont pas pu être chargées."}
        </div>
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
  // Résumé dérivé du modèle canonique blocks[] (jamais exercises[]/cardioBlocks[]).
  const realHighlightBlocks = realHighlightedSession?.blocks ?? [];
  const realHighlightMeta = realHighlightBlocks.length
    ? derivedSessionTypeLabel(deriveSessionType(realHighlightBlocks))
    : null;

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
        <StatCard icon={TrendingUp} label="Progression" value={weightDeltaLabel} tone="positive" />
      </div>

      <div className="mb-6 grid grid-cols-1 gap-6 lg:grid-cols-3">
        <div className="rounded-card border border-border bg-card p-6 shadow-soft lg:col-span-2">
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

        <div className="rounded-card border border-border bg-card p-6 shadow-soft">
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
        <div className="rounded-card border border-border bg-card p-6 shadow-soft">
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
              <div className="flex h-12 w-12 flex-shrink-0 items-center justify-center rounded-panel bg-primary">
                <Dumbbell size={20} className="text-primary-foreground" />
              </div>
              <div>
                <div className="text-sm font-medium text-foreground">
                  {useSupabase ? realHighlightedSession!.name : upcomingSession.name}
                </div>
                <div className="mt-0.5 text-xs text-muted-foreground">
                  {useSupabase
                    ? `${realHighlightedDay?.isToday ? "Aujourd'hui" : realHighlightedDay?.day} · ${realHighlightedSession!.durationMinutes} min${realHighlightMeta ? ` · ${realHighlightMeta}` : ""}`
                    : `${upcomingSession.day} · ${upcomingSession.time} · ${upcomingSession.durationMinutes} min · ${upcomingSession.exerciseCount} exercices`}
                </div>
              </div>
            </div>
          )}
          <Link
            href="/entrainement"
            className="pressable flex min-h-[44px] items-center justify-center rounded-control border border-primary text-center text-xs uppercase tracking-widest text-primary hover:bg-primary hover:text-primary-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/40"
          >
            Voir la séance
          </Link>
        </div>

        <div className="rounded-card border border-border bg-card p-6 shadow-soft">
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
            className="pressable flex min-h-[44px] items-center justify-center rounded-control border border-primary text-center text-xs uppercase tracking-widest text-primary hover:bg-primary hover:text-primary-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/40"
          >
            Voir le plan
          </Link>
        </div>
      </div>

      {supabaseAppointments.active &&
        (() => {
          const nextAppointment = supabaseAppointments.appointments
            .filter((a) => (a.status === "pending" || a.status === "confirmed") && new Date(a.startAt).getTime() >= new Date().getTime())
            .sort((a, b) => a.startAt.localeCompare(b.startAt))[0];
          return (
            <div className="mt-6 rounded-card border border-border bg-card p-6 shadow-soft">
              <div className="mb-4 flex items-center justify-between">
                <h2 className="font-heading text-lg font-bold uppercase text-foreground">Prochain rendez-vous</h2>
                <Link href="/rendez-vous" className="text-xs uppercase tracking-wide text-primary hover:underline">
                  Tout voir
                </Link>
              </div>
              {!nextAppointment ? (
                <p className="text-sm text-muted-foreground">Aucun rendez-vous à venir.</p>
              ) : (
                <div className="flex items-center gap-4">
                  <div className="flex h-12 w-12 flex-shrink-0 items-center justify-center rounded-panel bg-primary">
                    <CalendarDays size={20} className="text-primary-foreground" />
                  </div>
                  <div>
                    <div className="text-sm font-medium text-foreground">{nextAppointment.title}</div>
                    <div className="mt-0.5 text-xs text-muted-foreground">{formatDateTime(nextAppointment.startAt)}</div>
                  </div>
                </div>
              )}
            </div>
          );
        })()}

      <div className="mt-6 rounded-card border border-border bg-card p-6 shadow-soft">
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
