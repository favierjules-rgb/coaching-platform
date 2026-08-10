"use client";

import Link from "next/link";

import { DiagnosticOffline } from "@/components/pwa/DiagnosticOffline";
import { NextSessionHighlight } from "@/components/student/NextSessionHighlight";
import { TrainingProgramCard } from "@/components/student/TrainingProgramCard";
import {
  activeProgram,
  getHighlightedScheduleDay,
  getWorkoutSession,
  trainingPrograms,
} from "@/data/student";
import { useEtatOfflineEleve } from "@/hooks/useEtatOfflineEleve";
import { useSupabaseTrainingProgram } from "@/hooks/useSupabaseTrainingProgram";
import { computeCurrentWeekNumber, toEleveTrainingProgram, toEleveWorkoutSession } from "@/lib/training-schedule";

/**
 * Priorité Supabase dès qu'un compte élève réel est identifié (même
 * principe que /profil et /dashboard) : les programmes assignés réels
 * (table `assignments`, voir lib/supabase/programs.ts) remplacent alors
 * entièrement data/student.ts, y compris pour afficher "Aucun programme
 * attribué" plutôt qu'un programme mock qui ferait croire à un vrai suivi.
 */
export default function EntrainementPage() {
  const supabaseTraining = useSupabaseTrainingProgram();
  // On ne diagnostique QUE si le chargement en ligne n'a rien donné : en
  // ligne, ce hook ne fait aucune requête.
  const local = useEtatOfflineEleve(supabaseTraining.ready && !supabaseTraining.active);

  if (!supabaseTraining.ready) {
    return <p className="text-sm text-muted-foreground">Chargement…</p>;
  }

  if (supabaseTraining.active) {
    const { programs, activeProgram: realActiveProgram, student } = supabaseTraining;

    if (!realActiveProgram) {
      return (
        <div>
          <div className="mb-8">
            <h1 className="font-heading text-3xl font-extrabold uppercase text-foreground md:text-4xl">
              Entraînement
            </h1>
          </div>
          <p className="text-sm text-muted-foreground">
            Aucun programme attribué pour le moment. Contacte ton coach.
          </p>
          {/* L'historique reste consultable SANS programme assigné (bascule
              d'assignation, fin de programme…) — jamais dépendant des
              assignations actuelles. */}
          <Link
            href="/entrainement/historique"
            className="mt-4 inline-block text-xs uppercase tracking-widest text-primary hover:underline"
          >
            Historique des retours →
          </Link>
        </div>
      );
    }

    const weekNumber = computeCurrentWeekNumber(realActiveProgram, student);
    const eleveActiveProgram = toEleveTrainingProgram(realActiveProgram, weekNumber);
    const weekSessions = realActiveProgram.sessions
      .filter((s) => s.weekNumber === weekNumber)
      .map(toEleveWorkoutSession);
    const highlightedDay = getHighlightedScheduleDay(eleveActiveProgram.schedule);
    const highlightedSession = highlightedDay?.sessionId
      ? weekSessions.find((s) => s.id === highlightedDay.sessionId)
      : undefined;

    return (
      <div>
        <div className="mb-8">
          <h1 className="font-heading text-3xl font-extrabold uppercase text-foreground md:text-4xl">
            Entraînement
          </h1>
          <p className="mt-1 text-sm text-muted-foreground">
            Programme actif : {eleveActiveProgram.name} · Semaine {eleveActiveProgram.currentWeek} /{" "}
            {eleveActiveProgram.durationWeeks}
          </p>
          <Link
            href="/entrainement/historique"
            className="mt-2 inline-block text-xs uppercase tracking-widest text-primary hover:underline"
          >
            Historique des retours →
          </Link>
        </div>

        {highlightedSession && highlightedDay && (
          <div className="mb-8">
            <NextSessionHighlight
              session={highlightedSession}
              dayLabel={highlightedDay.isToday ? "Aujourd'hui" : highlightedDay.day}
            />
          </div>
        )}

        <div>
          <h2 className="mb-4 font-heading text-lg font-bold uppercase text-foreground">
            Mes programmes
          </h2>
          <div className="grid grid-cols-1 gap-6 sm:grid-cols-2 lg:grid-cols-3">
            {programs.map((program) => (
              <TrainingProgramCard
                key={program.id}
                program={toEleveTrainingProgram(
                  program,
                  computeCurrentWeekNumber(program, student),
                )}
              />
            ))}
          </div>
        </div>
      </div>
    );
  }

  /* ══════════════════════════════════════════════════════════════════
   * LE SERVEUR N'A PAS RÉPONDU — ET CE N'EST PAS UNE DÉMONSTRATION
   * ══════════════════════════════════════════════════════════════════
   * Tout ce qui suit était autrefois un `else` unique menant à
   * `data/student.ts`. Il couvrait quatre situations sans rapport, dont la
   * panne réseau : un élève réel, en avion, voyait « Force & Hypertrophie »
   * et « Remise en route » — et surtout un LIEN vers une séance de
   * démonstration qui ne correspondait à rien.
   *
   * Même règle que sur l'écran de séance : la démonstration n'est atteinte
   * que si Supabase n'est réellement pas configuré. */
  if (local.etat === "chargement") {
    return <p className="text-sm text-muted-foreground">Chargement…</p>;
  }

  if (local.etat === "offline" && local.contenu && local.sessionId) {
    const seanceDuJour = local.contenu.session;
    return (
      <div>
        <DiagnosticOffline
          titre="/entrainement"
          lignes={{
            etat: local.etat,
            source: "offline",
            sessionIdSnapshot: local.sessionId,
            sessionIdRendu: seanceDuJour.id,
            businessDate: local.businessDate,
            auth: local.identite ? "oui" : "non",
            remplacantsCles: Object.keys(local.contenu.remplacants ?? {}).length,
          }}
        />
        <div className="mb-8">
          <h1 className="font-heading text-3xl font-extrabold uppercase text-foreground md:text-4xl">
            Entraînement
          </h1>
          <p className="mt-1 text-sm text-muted-foreground">
            {local.contenu.programName
              ? `Programme actif : ${local.contenu.programName}`
              : "Programme actif"}
          </p>
        </div>

        <div className="mb-8">
          {/*
            La carte du jour porte l'identifiant EXACT du snapshot : c'est
            la même clé que celle mise en cache par le service worker, et
            celle que `lireSnapshotPourSeance` exigera à l'ouverture.
          */}
          <NextSessionHighlight session={seanceDuJour} dayLabel="Aujourd'hui" />
        </div>

        {/*
          Ce qui a besoin du serveur reste VIDE, et le dit. Ni programmes,
          ni progression, ni historique : rien de tout cela n'est dans le
          snapshot, et l'inventer serait le défaut qu'on vient de corriger.
        */}
        <div className="rounded-card border border-border bg-card p-6 shadow-soft">
          <h2 className="mb-2 font-heading text-lg font-bold uppercase text-foreground">
            Mes programmes
          </h2>
          <p className="text-sm text-muted-foreground">
            Tes programmes et ta progression demandent une connexion. Ta séance du jour, elle,
            est disponible ci-dessus — tu peux la remplir maintenant, elle partira toute seule
            au retour du réseau.
          </p>
        </div>
      </div>
    );
  }

  if (local.etat !== "mock") {
    return (
      <div>
        <DiagnosticOffline
          titre="/entrainement"
          lignes={{
            etat: local.etat,
            diagnostic: local.diagnostic ?? null,
            sessionIdSnapshot: local.sessionId,
            auth: local.identite ? "oui" : "non",
          }}
        />
        <div className="mb-8">
          <h1 className="font-heading text-3xl font-extrabold uppercase text-foreground md:text-4xl">
            Entraînement
          </h1>
        </div>
        <p className="text-sm text-muted-foreground">
          {local.etat === "erreur"
            ? "Le serveur n'a pas pu répondre correctement. Réessaie dans un instant — rien n'a été perdu."
            : local.etat === "offline"
              ? "Ta séance du jour n'a pas été préparée sur cet appareil. Connecte-toi à Internet pour la charger."
              : "Ton entraînement n'est pas disponible sur cet appareil. Connecte-toi à Internet pour le charger."}
        </p>
      </div>
    );
  }

  /* ── DÉMONSTRATION ──────────────────────────────────────────────────
   * Seul `local.etat === "mock"` arrive ici : Supabase non configuré. */
  const highlightedDay = getHighlightedScheduleDay(activeProgram.schedule);
  const highlightedSession = highlightedDay?.sessionId
    ? getWorkoutSession(highlightedDay.sessionId)
    : undefined;

  return (
    <div>
      <div className="mb-8">
        <h1 className="font-heading text-3xl font-extrabold uppercase text-foreground md:text-4xl">
          Entraînement
        </h1>
        <p className="mt-1 text-sm text-muted-foreground">
          Programme actif : {activeProgram.name} · Semaine{" "}
          {activeProgram.currentWeek} / {activeProgram.durationWeeks}
        </p>
      </div>

      {highlightedSession && highlightedDay && (
        <div className="mb-8">
          <NextSessionHighlight
            session={highlightedSession}
            dayLabel={highlightedDay.isToday ? "Aujourd'hui" : highlightedDay.day}
          />
        </div>
      )}

      <div>
        <h2 className="mb-4 font-heading text-lg font-bold uppercase text-foreground">
          Mes programmes
        </h2>
        <div className="grid grid-cols-1 gap-6 sm:grid-cols-2 lg:grid-cols-3">
          {trainingPrograms.map((program) => (
            <TrainingProgramCard key={program.id} program={program} />
          ))}
        </div>
      </div>
    </div>
  );
}
