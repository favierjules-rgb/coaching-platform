"use client";

import { useMemo } from "react";
import Link from "next/link";

import { ChoixMagasinProche } from "@/components/student/ChoixMagasinProche";
import { ListeDeCoursesParcours } from "@/components/student/ListeDeCoursesParcours";
import { useStudentNutritionPlanV2 } from "@/hooks/useStudentNutritionPlanV2";
import { useSupabaseNutritionForStudent } from "@/hooks/useSupabaseNutritionForStudent";

/**
 * COURSES C1 — LA ROUTE `/nutrition/courses`.
 *
 * ────────────────────────────────────────────────────────────────────────────
 * POURQUOI ICI, ET PAS AILLEURS
 * ────────────────────────────────────────────────────────────────────────────
 * ⚠️ PAS `/courses`. C'est l'adresse d'un parcours abandonné dont aucune ligne
 * n'est reprise ; la liste appartient au domaine NUTRITION, pas à un espace à
 * part.
 *
 * ⚠️ PAS `/nutrition/[planId]/courses` NON PLUS. Une liste de courses est
 * attachée à un ÉLÈVE et à des DATES réelles, jamais à un plan : l'élève n'a
 * qu'un plan assigné à la fois, et si son coach le remplace en milieu de
 * semaine, les repas déjà validés restent valides — leur `planned_on` ne bouge
 * pas. Mettre `planId` dans l'URL aurait fabriqué une liste par plan, donc
 * plusieurs listes pour une même semaine.
 *
 * Le plan reste nécessaire pour SAVOIR quels repas sont prescrits chaque jour ;
 * il est simplement lu, pas adressé.
 *
 * ────────────────────────────────────────────────────────────────────────────
 * COURSES C4.3a — LE CHOIX DU MAGASIN EST MONTÉ ICI, ET PAS DANS LE PARCOURS
 * ────────────────────────────────────────────────────────────────────────────
 * ⚠️ `ListeDeCoursesParcours` EST SOUS CONTRAT UX-24, qui lui interdit
 * littéralement les mots « magasin », « store », « prix » et « geoloc ». Ce
 * n'est pas une gêne à contourner : c'est le contrat de CONFINEMENT du moteur
 * de composition de la liste, qui n'a aucune raison de savoir OÙ l'élève fait
 * ses courses. Le choix du magasin vit donc à côté, dans la page — qui, elle,
 * assemble déjà les morceaux.
 *
 * ⚠️ ET RIEN N'EST DÉCLENCHÉ AU CHARGEMENT. Le composant lit le magasin déjà
 * choisi ; la géolocalisation n'est demandée qu'au tap sur son bouton.
 */
export default function ListeDeCoursesPage() {
  const nutrition = useSupabaseNutritionForStudent();
  const v2 = useStudentNutritionPlanV2(nutrition.activePlan?.id ?? null);

  // ⚠️ LA MÊME FABRICATION DE « AUJOURD'HUI » QUE L'ÉCRAN DU PLAN : découpée
  // en année/mois/jour et reconstruite en heure locale, jamais `toISOString()`
  // qui bascule d'un jour en soirée. `useMemo` sur une chaîne, pas sur un
  // tableau : un littéral recréé à chaque rendu relancerait la lecture.
  const aujourdHui = useMemo(() => {
    const maintenant = new Date();
    return `${maintenant.getFullYear()}-${String(maintenant.getMonth() + 1).padStart(2, "0")}-${String(
      maintenant.getDate(),
    ).padStart(2, "0")}`;
  }, []);

  if (!nutrition.ready || v2.loading) {
    return <p className="text-sm text-muted-foreground">Chargement…</p>;
  }

  if (!nutrition.activePlan) {
    return (
      <div className="flex flex-col gap-4">
        <h1 className="font-heading text-2xl font-extrabold uppercase text-foreground sm:text-3xl">
          GÉNÉRER MA LISTE DE COURSE
        </h1>
        <p className="text-sm text-muted-foreground">
          Aucun plan alimentaire ne t&apos;est attribué pour le moment&nbsp;: il n&apos;y a donc
          aucun repas à mettre en courses. Contacte ton coach.
        </p>
        <Link
          href="/nutrition"
          className="pressable flex min-h-[44px] w-fit items-center rounded-control border border-border px-4 py-2 text-xs uppercase tracking-widest text-muted-foreground transition-colors hover:border-info hover:text-info focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-info/50"
        >
          Retour à la nutrition
        </Link>
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-6">
      <ChoixMagasinProche studentId={nutrition.studentId ?? null} />
      <ListeDeCoursesParcours
        week={v2.week}
        studentId={nutrition.studentId}
        aujourdHui={aujourdHui}
      />
    </div>
  );
}
