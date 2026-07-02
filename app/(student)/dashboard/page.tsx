import Link from "next/link";
import { Bell, Dumbbell, Flame, Scale, Target, TrendingUp } from "lucide-react";

import { StatCard } from "@/components/student/StatCard";
import { WeightChart } from "@/components/student/WeightChart";
import {
  activeMealPlan,
  activeProgram,
  coachNotifications,
  recentDocuments,
  student,
  upcomingSession,
  weightHistory,
} from "@/data/student";

export default function DashboardPage() {
  const latestWeight = weightHistory[weightHistory.length - 1].kg;
  const firstWeight = weightHistory[0].kg;
  const weightDelta = +(latestWeight - firstWeight).toFixed(1);
  const weightDeltaLabel = `${weightDelta > 0 ? "+" : ""}${weightDelta} kg`;

  return (
    <div>
      <div className="mb-8">
        <h1 className="font-heading text-3xl font-extrabold uppercase text-foreground md:text-4xl">
          Bonjour, {student.firstName}
        </h1>
        <p className="mt-1 text-sm text-muted-foreground">
          Semaine {student.weekNumber} · Programme {activeProgram.name}
        </p>
      </div>

      <div className="mb-6 grid grid-cols-2 gap-4 lg:grid-cols-4">
        <StatCard icon={Flame} label="Séances cette semaine" value="3 / 5" />
        <StatCard icon={Scale} label="Poids actuel" value={`${latestWeight} kg`} />
        <StatCard icon={Target} label="Objectif" value={student.goal} />
        <StatCard
          icon={TrendingUp}
          label="Progression"
          value={weightDeltaLabel}
          accent
        />
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
          <h2 className="mb-4 font-heading text-lg font-bold uppercase text-foreground">
            Prochaine séance
          </h2>
          <div className="mb-4 flex items-center gap-4">
            <div className="flex h-12 w-12 flex-shrink-0 items-center justify-center bg-primary">
              <Dumbbell size={20} className="text-primary-foreground" />
            </div>
            <div>
              <div className="text-sm font-medium text-foreground">
                {upcomingSession.name}
              </div>
              <div className="mt-0.5 text-xs text-muted-foreground">
                {upcomingSession.day} · {upcomingSession.time} ·{" "}
                {upcomingSession.durationMinutes} min ·{" "}
                {upcomingSession.exerciseCount} exercices
              </div>
            </div>
          </div>
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
          <div className="mb-4">
            <div className="text-sm font-medium text-foreground">
              {activeMealPlan.name}
            </div>
            <div className="mt-1 text-xs text-muted-foreground">
              {activeMealPlan.calories} kcal · {activeMealPlan.protein}g
              prot. · {activeMealPlan.carbs}g gluc. · {activeMealPlan.fat}g
              lip.
            </div>
          </div>
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
