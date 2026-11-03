"use client";

import Link from "next/link";
import { ArrowLeft } from "lucide-react";

import { BandeauPlanningLive } from "@/components/admin/presentiel/BandeauPlanningLive";
import { MuscleHeatmapSection } from "@/components/student/MuscleHeatmapSection";
import { ProgramWeekCalendar } from "@/components/student/ProgramWeekCalendar";
import { ProgressBar } from "@/components/student/ProgressBar";
import { WeekAnalysisSection } from "@/components/student/WeekAnalysisSection";
import { Loader } from "@/components/ui/Loader";
import { usePlanningLive } from "@/hooks/usePlanningLive";
import {
  buildScheduleForWeek,
  computeCurrentWeekNumber,
  toEleveTrainingProgram,
  toEleveWorkoutSession,
} from "@/lib/training-schedule";

/**
 * ════════════════════════════════════════════════════════════════════════════
 * MODE LIVE — LE PLANNING COMPLET DE L'ÉLÈVE, CÔTÉ COACH
 * ════════════════════════════════════════════════════════════════════════════
 * ⚠️ AUCUN COMPOSANT DE PLANNING N'EST RÉÉCRIT ICI. Les semaines, les cartes de
 * jour, les pastilles de blocs, l'analyse de volume, la carte de chaleur
 * musculaire et la barre de progression sont CEUX DE L'ÉLÈVE, montés tels
 * quels. Ce fichier ne fait que quatre choses :
 *
 *   1. charger le programme TEL QU'IL EST AFFECTÉ à cet élève (donc avec SA
 *      date de début, donc SA semaine courante) ;
 *   2. calculer la semaine courante avec la même fonction que l'élève ;
 *   3. faire pointer les cartes de séance vers la route PRÉSENTIELLE au lieu
 *      de `/entrainement/seance/[id]` ;
 *   4. tenir le bandeau permanent à l'écran.
 *
 * Une copie « simplifiée » du planning aurait divergé au premier changement de
 * forme des blocs, et le coach aurait vu autre chose que son élève. C'est
 * précisément ce qu'on ne veut pas quand on commente une séance à voix haute,
 * côte à côte, en salle.
 *
 * ⚠️ LA SEMAINE COURANTE EST CELLE DE L'ÉLÈVE, PAS CELLE DU PROGRAMME.
 * `computeCurrentWeekNumber` lit `programStartDate` — la date portée par la
 * LIGNE D'AFFECTATION — et retombe sur `students.start_date` à défaut. Deux
 * élèves sur la même programmation sont donc à deux semaines différentes, et
 * c'est bien ce qu'on veut afficher.
 */
export function PlanningLiveContenu({
  studentId,
  programId,
}: {
  readonly studentId: string;
  readonly programId: string;
}) {
  const etat = usePlanningLive(programId, studentId);

  const retour = (
    <Link
      href="/admin/programmes"
      className="mb-6 inline-flex items-center gap-2 text-xs uppercase tracking-widest text-muted-foreground transition-colors hover:text-foreground"
    >
      <ArrowLeft size={14} />
      Programmations
    </Link>
  );

  if (etat.chargement) {
    return <Loader libelle="Chargement du planning…" variante="ligne" />;
  }

  /*
   * ⚠️ TROIS SITUATIONS, TROIS MESSAGES — JAMAIS UN PLANNING APPROXIMATIF.
   * Le serveur a déjà refusé l'accès non autorisé avant ce rendu ; ce qui
   * reste ici, ce sont les cas où la donnée a bougé PENDANT la séance :
   * affectation retirée, élève devenu illisible.
   */
  if (etat.affectationIntrouvable || !etat.programme) {
    return (
      <div>
        {retour}
        <p className="text-sm text-muted-foreground">
          Cette programmation n&apos;est plus affectée à cet élève. Reviens à la liste des
          programmations et relance le mode Live.
        </p>
      </div>
    );
  }

  const programme = etat.programme;
  const nomEleve = etat.eleve
    ? `${etat.eleve.firstName} ${etat.eleve.lastName}`.trim() || "Élève"
    : "Élève";

  const semaineCourante = computeCurrentWeekNumber(programme, etat.eleve);
  const vueEleve = toEleveTrainingProgram(
    programme,
    semaineCourante,
    undefined,
    etat.seancesTerminees,
  );
  const semaines = Array.from(new Set(programme.sessions.map((s) => s.weekNumber))).sort(
    (a, b) => a - b,
  );
  const seancesSemaineCourante = programme.sessions
    .filter((s) => s.weekNumber === semaineCourante)
    .map(toEleveWorkoutSession);
  const seancesMetriques = seancesSemaineCourante.map((s) => ({ ...s, muscleGroup: s.muscleGroups }));

  /*
   * LA DESTINATION D'UNE CARTE DE SÉANCE — la route présentielle EXISTANTE,
   * inchangée, avec son programme en paramètre.
   *
   * ⚠️ RIEN N'EST DÉCIDÉ ICI SUR LES DROITS. Ce lien ne fait que porter deux
   * identifiants ; la page cible revérifie tout côté serveur, et la route
   * d'enregistrement aussi. Un lien forgé à la main mènerait à une redirection.
   */
  const lienSeance = (session: { id: string }) =>
    `/admin/eleves/${studentId}/seance/${session.id}?programme=${programme.id}`;

  return (
    <div>
      {retour}

      <BandeauPlanningLive nomEleve={nomEleve} nomProgramme={programme.name} />

      <div className="mb-8">
        <h1 className="font-heading text-2xl font-extrabold uppercase text-foreground md:text-3xl">
          {programme.name}
        </h1>
        <p className="mt-1 text-sm text-muted-foreground">
          {programme.goal}
          {` · Semaine ${semaineCourante} / ${programme.durationWeeks}`}
        </p>
      </div>

      {/* Même règle que la page élève : progression inconnue ⇒ rien, jamais 0 %. */}
      {vueEleve.progressionConnue !== false && (
        <div className="mb-8 rounded-card border border-border bg-card p-6">
          <div className="mb-3 flex items-center justify-between text-xs text-muted-foreground">
            <span className="uppercase tracking-wide">Progression du programme</span>
            <span>{vueEleve.progressPercent}%</span>
          </div>
          <ProgressBar percent={vueEleve.progressPercent} />
        </div>
      )}

      {seancesMetriques.length > 0 && <WeekAnalysisSection sessions={seancesMetriques} />}

      {seancesSemaineCourante.some((s) => (s.blocks ?? []).length > 0) && (
        <div className="mb-8">
          <MuscleHeatmapSection
            blocks={seancesSemaineCourante.flatMap((s) => s.blocks ?? [])}
            title="Intensité musculaire de la semaine"
          />
        </div>
      )}

      {/*
        TOUTES LES SEMAINES, EMPILÉES — passées, courante, futures.

        ⚠️ `semaineCourante` EST PASSÉE À `buildScheduleForWeek` : c'est elle qui
        décide si « aujourd'hui » a le droit d'être mis en avant dans un bloc.
        Sans ce quatrième argument, chaque semaine affichée aurait son propre
        « aujourd'hui », et le coach verrait sept jours en surbrillance sur un
        programme de sept semaines.
      */}
      <div className="flex flex-col gap-8">
        {semaines.length === 0 ? (
          <p className="text-sm text-muted-foreground">Aucune séance planifiée pour le moment.</p>
        ) : (
          semaines.map((semaine) => (
            <div key={semaine}>
              <h2 className="mb-4 flex flex-wrap items-center gap-2 font-heading text-lg font-bold uppercase text-foreground">
                Semaine {semaine}
                {semaine === semaineCourante ? (
                  <span className="rounded-control border border-primary/50 bg-primary/10 px-2 py-0.5 text-[10px] tracking-widest text-primary">
                    en cours
                  </span>
                ) : null}
              </h2>
              <ProgramWeekCalendar
                schedule={buildScheduleForWeek(programme, semaine, undefined, semaineCourante)}
                sessions={programme.sessions
                  .filter((s) => s.weekNumber === semaine)
                  .map(toEleveWorkoutSession)}
                lienSeance={lienSeance}
                /* ⚠️ `?? new Set()` ET PAS `undefined` : sans cet ensemble, la
                   grille n'afficherait aucune action, et le coach n'aurait
                   nulle part où appuyer. Un ensemble vide dit « rien de
                   réalisé à notre connaissance », ce qui est exact quand la
                   lecture de l'historique a échoué — et toutes les séances
                   restent alors proposées, jamais masquées. */
                seancesTerminees={etat.seancesTerminees ?? new Set<string>()}
                libelleAction="Démarrer en mode Live"
              />
            </div>
          ))
        )}
      </div>
    </div>
  );
}
