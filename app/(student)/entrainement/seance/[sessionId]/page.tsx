"use client";

import Link from "next/link";
import { useParams } from "next/navigation";
import { ArrowLeft, Flame, MessageSquare } from "lucide-react";

import { DiagnosticOffline } from "@/components/pwa/DiagnosticOffline";
import { MuscleHeatmapSection } from "@/components/student/MuscleHeatmapSection";
import { SessionAnalysisSection } from "@/components/student/SessionAnalysisSection";
import { SessionFeedbackSection } from "@/components/student/SessionFeedbackSection";
import {
  getTrainingProgram,
  getWorkoutSession,
  student,
} from "@/data/student";
import { useSeanceHorsLigne } from "@/hooks/useSeanceHorsLigne";
import { Loader } from "@/components/ui/Loader";

/**
 * LA SÉANCE — SIX ÉTATS, ET PLUS UN SEUL BOOLÉEN.
 *
 * ════════════════════════════════════════════════════════════════════════
 * CE QUI A CHANGÉ ICI, ET POURQUOI
 * ════════════════════════════════════════════════════════════════════════
 * Cette page faisait `if (supabaseTraining.active) … else mock`. Ce `else`
 * couvrait quatre situations sans rapport, dont une panne réseau : un élève
 * réel, en avion, voyait la séance de DÉMONSTRATION de `data/student.ts` et
 * la remplissait. Rien à l'écran ne l'en distinguait.
 *
 * `useSeanceHorsLigne` rend désormais un état explicite. La démonstration
 * n'apparaît QUE pour `mock`, c'est-à-dire quand Supabase n'est réellement
 * pas configuré. Une erreur serveur dit qu'il y a une erreur ; un compte
 * sans fiche le dit aussi ; et seule une panne de transport constatée
 * ouvre la lecture du dépôt local.
 */

function CadreSeance({ titre, message }: { titre: string; message: string }) {
  return (
    <div>
      <Link
        href="/entrainement"
        className="mb-6 inline-flex min-h-[44px] w-fit items-center gap-2 rounded-control text-xs uppercase tracking-widest text-muted-foreground transition-colors hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/40"
      >
        <ArrowLeft size={14} />
        Entraînement
      </Link>
      <h1 className="mb-2 font-heading text-2xl font-extrabold uppercase text-foreground">{titre}</h1>
      <p className="text-sm text-muted-foreground">{message}</p>
    </div>
  );
}

export default function SessionDetailPage() {
  const params = useParams<{ sessionId: string }>();
  const seance = useSeanceHorsLigne(params.sessionId);

  if (seance.etat === "chargement") {
    return <Loader libelle="Chargement…" variante="ligne" />;
  }

  /* ── ÉTATS SANS DONNÉES ÉLÈVE ──────────────────────────────────────────
   * Aucun d'eux ne retombe sur `data/student.ts`, et aucun ne présente un
   * vieux snapshot comme si la séance était disponible. */
  if (seance.etat === "erreur") {
    return (
      <CadreSeance
        titre="Séance indisponible"
        message="Le serveur n'a pas pu répondre correctement. Réessaie dans un instant — rien n'a été perdu."
      />
    );
  }
  if (seance.etat === "indisponible") {
    return (
      <CadreSeance
        titre="Séance introuvable"
        message="Cette séance n'est pas disponible sur cet appareil. Connecte-toi à Internet pour la charger."
      />
    );
  }

  if (seance.etat === "online" || seance.etat === "offline") {
    const contenu = seance.contenu;
    const realSession = contenu?.session ?? null;
    const realProgramName = contenu?.programName ?? null;
    const realProgramId = contenu?.programId ?? null;

    // Chemins de vidéo DÉJÀ déposés : ils viennent du retour enregistré, et
    // ce sont les seuls qu'un payload hors ligne a le droit de reconduire.
    const cheminsVideoConnus = (contenu?.feedbackExistant?.videos ?? []).map((v) => v.videoPath);

    if (!realSession || !contenu) {
      return (
        <CadreSeance titre="Séance introuvable" message="Cette séance n'existe pas dans tes programmes." />
      );
    }

    return (
      <div>
        <Link
          href={realProgramId ? `/entrainement/${realProgramId}` : "/entrainement"}
          className="mb-6 inline-flex min-h-[44px] w-fit items-center gap-2 rounded-control text-xs uppercase tracking-widest text-muted-foreground transition-colors hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/40"
        >
          <ArrowLeft size={14} />
          {realProgramName ?? "Entraînement"}
        </Link>

        {realSession.bannerUrl && (
          // eslint-disable-next-line @next/next/no-img-element -- bucket Storage public, URL externe
          <img src={realSession.bannerUrl} alt="" className="mb-6 h-48 w-full rounded-card border border-border object-cover" />
        )}

        <div className="mb-8">
          <h1 className="font-heading text-3xl font-extrabold uppercase text-foreground md:text-4xl">
            {realSession.name}
          </h1>
          <p className="mt-1 text-sm text-muted-foreground">
            {realSession.day} · {realSession.durationMinutes} min
            {(realSession.sessionType ?? "strength") !== "cardio" ? ` · ${realSession.exercises.length} exercices` : ""}
            {(realSession.sessionType ?? "strength") !== "strength"
              ? ` · ${(realSession.cardioBlocks ?? []).length} bloc${(realSession.cardioBlocks ?? []).length > 1 ? "s" : ""} cardio`
              : ""}
          </p>
        </div>

        <SessionAnalysisSection session={{ ...realSession, muscleGroup: realSession.muscleGroups }} />

        <div className="mb-8">
          <MuscleHeatmapSection blocks={realSession.blocks ?? []} />
        </div>

        {realSession.warmup && (
          <div className="mb-8 flex items-start gap-4 rounded-card border border-border bg-card p-6 shadow-soft">
            <Flame size={20} className="mt-0.5 flex-shrink-0 text-primary" />
            <div>
              <h2 className="mb-1 font-heading text-sm font-bold uppercase text-foreground">Échauffement</h2>
              <p className="text-sm leading-relaxed text-muted-foreground">{realSession.warmup}</p>
            </div>
          </div>
        )}

        {realSession.coachNotes && (
          <div className="mb-8 flex items-start gap-4 rounded-card border border-border bg-card p-6 shadow-soft">
            <MessageSquare size={20} className="mt-0.5 flex-shrink-0 text-primary" />
            <div>
              <h2 className="mb-1 font-heading text-sm font-bold uppercase text-foreground">Notes du coach</h2>
              <p className="text-sm leading-relaxed text-muted-foreground">{realSession.coachNotes}</p>
            </div>
          </div>
        )}

        {/*
          LES QUATRE PROPS DU CHEMIN RÉEL.
          Elles sont optionnelles dans le composant — pour que les contextes
          historiques (démonstration, harnais de rendu) continuent de
          fonctionner sans rien changer — mais la page élève les fournit
          TOUTES, explicitement. `scripts/tests/seance-page-props.mts` échoue
          si l'une d'elles disparaît d'ici.
        */}
        <DiagnosticOffline
          titre="/entrainement/seance"
          lignes={{
            etat: seance.etat,
            source: seance.etat === "offline" ? "offline" : "supabase",
            horsLigne: seance.etat === "offline",
            sessionIdUrl: params.sessionId,
            sessionIdRendu: realSession.id,
            businessDate: seance.businessDate,
            auth: seance.identite ? "oui" : "non",
            studentEleve: contenu.studentId,
            remplacantsCles: Object.keys(contenu.remplacants ?? {}).length,
            remplacantsTotal: Object.values(contenu.remplacants ?? {}).reduce((n, o) => n + o.length, 0),
            exercicesAvecFiche: (realSession.blocks ?? []).reduce(
              (n, bloc) =>
                n +
                (bloc.category === "strength"
                  ? (bloc.exercises ?? []).filter((e) => Boolean(e.libraryExerciseId)).length
                  : 0),
              0,
            ),
          }}
        />

        <SessionFeedbackSection
          studentId={contenu.studentId}
          sessionId={realSession.id}
          programId={realProgramId}
          sessionRefLabel={realSession.name}
          blocks={realSession.blocks}
          exercises={realSession.exercises}
          cardioBlocks={realSession.cardioBlocks}
          sessionMuscleGroup={realSession.muscleGroups}
          source={seance.etat === "offline" ? "offline" : "supabase"}
          authUserId={seance.identite?.userId ?? null}
          businessDate={seance.businessDate}
          cheminsVideoConnus={cheminsVideoConnus}
          chargerRemplacants={seance.chargerRemplacants}
        />
      </div>
    );
  }

  /* ── DÉMONSTRATION ────────────────────────────────────────────────────
   * Le seul état qui mène encore à `data/student.ts`, et il n'est atteint
   * que si `createSupabaseBrowserClient()` n'a rien rendu : environnement
   * volontairement non configuré. Un vrai compte n'arrive jamais ici. */
  const session = getWorkoutSession(params.sessionId);

  if (!session) {
    return (
      <div>
        <Link
          href="/entrainement"
          className="mb-6 inline-flex min-h-[44px] w-fit items-center gap-2 rounded-control text-xs uppercase tracking-widest text-muted-foreground transition-colors hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/40"
        >
          <ArrowLeft size={14} />
          Entraînement
        </Link>
        <p className="text-sm text-muted-foreground">Séance introuvable.</p>
      </div>
    );
  }

  const program = getTrainingProgram(session.programId);

  return (
    <div>
      <Link
        href={program ? `/entrainement/${program.id}` : "/entrainement"}
        className="mb-6 inline-flex items-center gap-2 text-xs uppercase tracking-widest text-muted-foreground transition-colors hover:text-foreground"
      >
        <ArrowLeft size={14} />
        {program ? program.name : "Entraînement"}
      </Link>

      <div className="mb-8">
        <h1 className="font-heading text-3xl font-extrabold uppercase text-foreground md:text-4xl">
          {session.name}
        </h1>
        <p className="mt-1 text-sm text-muted-foreground">
          {session.day} · {session.durationMinutes} min ·{" "}
          {session.exercises.length} exercices
        </p>
      </div>

      <SessionAnalysisSection session={{ ...session, muscleGroup: session.muscleGroups }} />

      <div className="mb-8 flex items-start gap-4 rounded-card border border-border bg-card p-6 shadow-soft">
        <Flame size={20} className="mt-0.5 flex-shrink-0 text-primary" />
        <div>
          <h2 className="mb-1 font-heading text-sm font-bold uppercase text-foreground">
            Échauffement
          </h2>
          <p className="text-sm leading-relaxed text-muted-foreground">
            {session.warmup}
          </p>
        </div>
      </div>

      <div className="mb-8 flex items-start gap-4 rounded-card border border-border bg-card p-6 shadow-soft">
        <MessageSquare size={20} className="mt-0.5 flex-shrink-0 text-primary" />
        <div>
          <h2 className="mb-1 font-heading text-sm font-bold uppercase text-foreground">
            Notes du coach
          </h2>
          <p className="text-sm leading-relaxed text-muted-foreground">
            {session.coachNotes}
          </p>
        </div>
      </div>

      <DiagnosticOffline
        titre="/entrainement/seance"
        lignes={{
          etat: seance.etat,
          source: "mock",
          horsLigne: false,
          sessionIdUrl: params.sessionId,
          sessionIdRendu: session.id,
        }}
      />

      <SessionFeedbackSection
        studentId={student.id}
        sessionId={session.id}
        programId={program?.id ?? null}
        sessionRefLabel={session.name}
        blocks={session.blocks}
        exercises={session.exercises}
        cardioBlocks={session.cardioBlocks}
        sessionMuscleGroup={session.muscleGroups}
      />
    </div>
  );
}
