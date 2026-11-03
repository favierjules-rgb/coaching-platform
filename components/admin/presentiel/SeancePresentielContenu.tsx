"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { ArrowLeft, MessageSquare } from "lucide-react";

import { SessionFeedbackSection } from "@/components/student/SessionFeedbackSection";
import { Loader } from "@/components/ui/Loader";
import { useSupabaseProgram } from "@/hooks/useSupabaseProgram";
import { useSupabaseStudentDetail } from "@/hooks/useSupabaseStudentDetail";
import { createSupabaseBrowserClient } from "@/lib/supabase/browser";
import { formaterDureeMinutes } from "@/lib/duree";

/**
 * ════════════════════════════════════════════════════════════════════════════
 * LE CONTENU DU MODE PRÉSENTIEL
 * ════════════════════════════════════════════════════════════════════════════
 * ⚠️ AUCUN FORMULAIRE N'EST RÉÉCRIT ICI. `SessionFeedbackSection` est monté
 * TEL QUEL, avec ses cartes d'exercice, ses lignes de séries, ses formulaires
 * cardio, son remplacement d'exercice et sa validation finale. Un second
 * formulaire « pour coach » aurait divergé du premier au premier champ ajouté,
 * et l'élève aurait fini par voir deux applications différentes.
 *
 * Ce fichier ne fait que trois choses : trouver la séance, nommer l'élève, et
 * passer `presentiel`.
 *
 * ⚠️ LE CHRONOMÈTRE N'EST PAS MONTÉ ICI. Il l'est par
 * `app/(student)/entrainement/seance/[sessionId]/layout.tsx`, c'est-à-dire par
 * l'arborescence élève — et il n'y a donc rien à démarrer automatiquement, ici
 * pas davantage qu'ailleurs. Le brancher sur cette page est un choix à faire
 * ensemble : voir les limites du compte rendu.
 *
 * ⚠️ LE PROGRAMME EST DEMANDÉ DANS L'URL, IL N'EST PAS DEVINÉ. Une séance
 * appartient à un programme, mais remonter de l'un à l'autre sans le dire
 * aurait voulu dire choisir « un » programme parmi ceux de l'élève. On préfère
 * une page qui dit ce qui lui manque à une page qui devine.
 */
export function SeancePresentielContenu({
  studentId,
  sessionId,
  programId,
}: {
  readonly studentId: string;
  readonly sessionId: string;
  readonly programId: string | null;
}) {
  /*
   * LE COMPTE DU COACH — clé d'isolation du brouillon local.
   *
   * ⚠️ C'EST LE COACH, PAS L'ÉLÈVE. Le brouillon appartient à celui qui
   * saisit : sur l'appareil du coach, ses saisies en cours ne doivent ni
   * écraser celles de l'élève, ni voyager. `useBrouillonSeance` n'écrit
   * strictement rien tant que cette valeur est `null`, ce qui est aussi le
   * bon comportement pendant le chargement.
   */
  const [compteCoach, setCompteCoach] = useState<string | null>(null);
  useEffect(() => {
    let annule = false;
    void (async () => {
      const client = createSupabaseBrowserClient();
      if (!client) return;
      const { data } = await client.auth.getUser();
      if (!annule) setCompteCoach(data.user?.id ?? null);
    })();
    return () => {
      annule = true;
    };
  }, []);

  const detail = useSupabaseStudentDetail(studentId);
  const programme = useSupabaseProgram(programId ?? undefined);

  const eleve = detail.student;
  const nomEleve = eleve ? `${eleve.firstName} ${eleve.lastName}`.trim() : "Élève";
  const seance = programme.program?.sessions.find((s) => s.id === sessionId) ?? null;

  const retour = (
    <Link
      href={`/admin/eleves/${studentId}`}
      className="mb-6 inline-flex items-center gap-2 text-xs uppercase tracking-widest text-muted-foreground transition-colors hover:text-foreground"
    >
      <ArrowLeft size={14} />
      Retour à la fiche
    </Link>
  );

  if (!programId) {
    return (
      <div>
        {retour}
        <p className="text-sm text-muted-foreground">
          Le programme de cette séance n&apos;est pas précisé. Ouvrez le mode présentiel depuis la
          fiche de l&apos;élève, qui le transmet.
        </p>
      </div>
    );
  }

  if (programme.loading || detail.loading) {
    return <Loader libelle="Chargement de la séance…" variante="ligne" />;
  }

  if (!seance) {
    return (
      <div>
        {retour}
        <p className="text-sm text-muted-foreground">
          Cette séance est introuvable dans le programme indiqué.
        </p>
      </div>
    );
  }

  return (
    <div>
      {retour}

      <div className="mb-6">
        <h1 className="font-heading text-2xl font-extrabold uppercase text-foreground md:text-3xl">
          {seance.name}
        </h1>
        <p className="mt-1 text-sm text-muted-foreground">
          {programme.program?.name}
          {typeof seance.weekNumber === "number" ? ` · Semaine ${seance.weekNumber}` : ""}
          {seance.day ? ` · ${seance.day}` : ""}
          {seance.durationMinutes ? ` · ${formaterDureeMinutes(seance.durationMinutes)}` : ""}
        </p>
      </div>

      {seance.coachNotes ? (
        <div className="mb-6 flex items-start gap-4 rounded-card border border-border bg-card p-6 shadow-soft">
          <MessageSquare size={20} className="mt-0.5 flex-shrink-0 text-primary" />
          <div>
            <h2 className="mb-1 font-heading text-sm font-bold uppercase text-foreground">
              Notes du coach
            </h2>
            <p className="text-sm leading-relaxed text-muted-foreground">{seance.coachNotes}</p>
          </div>
        </div>
      ) : null}

      {/* ⚠️ LES MÊMES PROPS QUE LA PAGE ÉLÈVE, PLUS DEUX. `presentiel` bascule
          l'identité envoyée au serveur et cloisonne le brouillon ; `nomEleve`
          alimente le bandeau permanent. Tout le reste est identique — c'est
          la même séance, les mêmes prescriptions, le même enregistrement. */}
      <SessionFeedbackSection
        presentiel
        nomEleve={nomEleve}
        studentId={studentId}
        sessionId={seance.id}
        programId={programme.program?.id ?? null}
        sessionRefLabel={seance.name}
        blocks={seance.blocks}
        exercises={seance.exercises}
        cardioBlocks={seance.cardioBlocks}
        sessionMuscleGroup={seance.muscleGroup ?? ""}
        authUserId={compteCoach}
        occurrence={
          typeof seance.weekNumber === "number" && seance.day
            ? { weekNumber: seance.weekNumber, day: seance.day }
            : null
        }
        source="supabase"
      />
    </div>
  );
}
