"use client";

import { useMemo } from "react";
import Link from "next/link";
import { ArrowLeft } from "lucide-react";

import { SectionIndisponible } from "@/components/pwa/SectionIndisponible";
import { CoursesParcours } from "@/components/student/CoursesParcours";
import { useEtatOfflineEleve } from "@/hooks/useEtatOfflineEleve";
import {
  FENETRE_HABITUDES_JOURS,
  FENETRE_HABITUDES_LONGUE_JOURS,
  datesRecentes,
} from "@/hooks/useCourses";
import { useConsumedMeals } from "@/hooks/useConsumedMeals";
import { useRaccourcisAliments } from "@/hooks/useRaccourcisAliments";
import { useStudentNutritionPlanV2 } from "@/hooks/useStudentNutritionPlanV2";
import { useSupabaseNutritionForStudent } from "@/hooks/useSupabaseNutritionForStudent";

/**
 * COURSES C1 — LA PAGE ÉLÈVE.
 *
 * ────────────────────────────────────────────────────────────────────────────
 * ELLE NE FAIT QUE CÂBLER
 * ────────────────────────────────────────────────────────────────────────────
 * Toutes les données viennent des lecteurs qui EXISTENT DÉJÀ :
 *
 *   plan + recettes  → `useStudentNutritionPlanV2`   (A4/recettes)
 *   favoris          → `useRaccourcisAliments`       (A5)
 *   habitudes        → `useConsumedMeals`            (A2, lu par A5.7)
 *
 * ⚠️ AUCUN NOUVEL ACCÈS AUX MÊMES TABLES. Ouvrir ici une seconde lecture de
 * `consumed_meals` ferait deux requêtes concurrentes pour la même donnée, et
 * deux vérités possibles sur l'historique.
 *
 * ⚠️ AUCUNE ÉCRITURE. `useConsumedMeals` expose des fonctions d'écriture ;
 * cette page ne lit que `.meals`, et un test le vérifie sur son source.
 */
export default function CoursesPage() {
  const supabaseNutrition = useSupabaseNutritionForStudent();

  // ⚠️ POURQUOI LE CHARGEMENT N'A RIEN DONNÉ — même diagnostic qu'/nutrition.
  // La coquille de `/courses` est mise en cache par le service worker : hors
  // ligne, l'écran s'ouvre. Sans ce hook, il s'ouvrirait sur « aucun plan »,
  // et un élève dans le métro croirait son plan disparu. Aucune requête tant
  // que le verdict en ligne n'est pas tombé.
  const local = useEtatOfflineEleve(supabaseNutrition.ready && !supabaseNutrition.active);

  // La date du jour, calculée UNE fois. Lue pendant le rendu, elle différerait
  // entre serveur et client autour de minuit — même précaution qu'A5.6.
  const aujourdHui = useMemo(() => {
    const m = new Date();
    return `${m.getFullYear()}-${String(m.getMonth() + 1).padStart(2, "0")}-${String(m.getDate()).padStart(2, "0")}`;
  }, []);

  // Le plan assigné. `useSupabaseNutrition` n'en rend qu'un seul (règle du
  // plan unique assigné), donc aucun choix à faire ici.
  const planId = supabaseNutrition.plans[0]?.id ?? null;
  const plan = useStudentNutritionPlanV2(supabaseNutrition.active ? planId : null);

  const raccourcis = useRaccourcisAliments(
    supabaseNutrition.studentId ?? null,
    supabaseNutrition.active,
  );

  // ── LES DEUX FENÊTRES D'HABITUDES — §8 ────────────────────────────────
  // Sept jours portent le signal principal ; vingt-huit ne servent qu'à
  // départager, et n'écrasent jamais la fenêtre courte (voir `habitudesDepuis`).
  const datesCourtes = useMemo(
    () => datesRecentes(aujourdHui, FENETRE_HABITUDES_JOURS),
    [aujourdHui],
  );
  const datesLongues = useMemo(
    () => datesRecentes(aujourdHui, FENETRE_HABITUDES_LONGUE_JOURS),
    [aujourdHui],
  );
  const recents = useConsumedMeals(datesCourtes, supabaseNutrition.active);
  const longs = useConsumedMeals(datesLongues, supabaseNutrition.active);

  if (!supabaseNutrition.ready) {
    return <p className="text-sm text-muted-foreground">Chargement…</p>;
  }

  // ⚠️ HORS LIGNE, ON NE GÉNÈRE PAS UNE LISTE VIDE. Les courses dérivent du
  // plan, des recettes et de l'historique : sans réseau, une liste « générée »
  // serait fausse, et l'élève ferait ses courses avec.
  if (!supabaseNutrition.active) {
    if (local.etat === "chargement") {
      return <p className="text-sm text-muted-foreground">Chargement…</p>;
    }
    if (local.etat === "mock") {
      // Supabase non configuré : il n'existe aucun plan réel à dépouiller, et
      // C1 n'invente pas de recettes de démonstration.
      return (
        <SectionIndisponible
          zone="/courses"
          titre="Mes courses"
          etat="indisponible"
          retour={{ href: "/nutrition", libelle: "Nutrition" }}
        />
      );
    }
    return (
      <SectionIndisponible
        zone="/courses"
        titre="Mes courses"
        etat={local.etat}
        retour={{ href: "/nutrition", libelle: "Nutrition" }}
        messageOffline="Cette partie nécessite une connexion : la liste de courses se construit à partir de ton plan et de ton historique, qui ne sont pas conservés sur cet appareil."
        lignes={{ auth: local.identite ? "oui" : "non", businessDate: local.businessDate }}
      />
    );
  }

  return (
    <div className="flex min-w-0 flex-col">
      <Link
        href="/nutrition"
        className="mb-6 inline-flex items-center gap-2 text-xs uppercase tracking-widest text-muted-foreground transition-colors hover:text-foreground"
      >
        <ArrowLeft size={14} />
        Nutrition
      </Link>

      <h1 className="mb-1 font-heading text-3xl font-extrabold uppercase text-foreground md:text-4xl">
        Mes courses
      </h1>
      <p className="mb-6 text-sm text-muted-foreground">
        Une liste construite à partir de ton plan, de tes envies et de tes habitudes.
      </p>

      {plan.error !== null && (
        <p className="mb-4 rounded-panel border border-destructive/40 bg-destructive/5 px-3 py-2 text-sm text-destructive">
          {plan.error}
        </p>
      )}

      <CoursesParcours
        aujourdHui={aujourdHui}
        week={plan.week}
        recettes={plan.recipes}
        favoris={raccourcis.favoris}
        repasRecents={recents.meals}
        repasLongs={longs.meals}
        chargement={plan.loading}
      />
    </div>
  );
}
