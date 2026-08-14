"use client";

import { useMemo, useState } from "react";

import Link from "next/link";
import { useParams } from "next/navigation";
import { ArrowLeft, ShoppingCart } from "lucide-react";

import { SectionIndisponible } from "@/components/pwa/SectionIndisponible";
import { NutritionPlanWorkspace } from "@/components/student/NutritionPlanWorkspace";
import { RecipesHighlightLink } from "@/components/student/RecipesHighlightLink";
import { StatusBadge } from "@/components/student/StatusBadge";
import { StudentPrescribedWeek } from "@/components/student/StudentPrescribedWeek";
import { WeeklyNutritionTracker } from "@/components/student/WeeklyNutritionTracker";
import { StatCard } from "@/components/shared/StatCard";
import { nutritionGoalLabels } from "@/lib/nutrition";
import { dailyTargetsByWeekday, weeklyCaloriesFromDays } from "@/lib/nutrition/plan-v2-week";
import { WEEKDAY_KEYS, type WeekdayKey } from "@/lib/nutrition/weekdays";
import { getCurrentWeekDates } from "@/lib/nutrition-weekly";
import { getNutritionPlan, student } from "@/data/student";
import { useConsumedMeals } from "@/hooks/useConsumedMeals";
import { useRaccourcisAliments } from "@/hooks/useRaccourcisAliments";
import { type Semaine, decalerSemaine, semaineContenant } from "@/lib/nutrition/historique";
import { useEtatOfflineEleve } from "@/hooks/useEtatOfflineEleve";
import { useStudentNutritionPlanV2 } from "@/hooks/useStudentNutritionPlanV2";
import { useSupabaseNutritionForStudent } from "@/hooks/useSupabaseNutritionForStudent";

export default function NutritionPlanDetailPage() {
  const params = useParams<{ planId: string }>();
  const supabaseNutrition = useSupabaseNutritionForStudent();
  // Le plan v2 COMPLET : profils, sept jours, repas prescrits, et la
  // bibliothèque de recettes que la RLS autorise pour cet élève.
  const v2 = useStudentNutritionPlanV2(supabaseNutrition.active ? (params.planId ?? null) : null);
  const local = useEtatOfflineEleve(supabaseNutrition.ready && !supabaseNutrition.active);

  // ── LE PONT ENTRE LE JOUR-TYPE ET LA DATE (ALIMENTS A2) ────────────────
  // La prescription n'a aucune date : `nutrition_days.day` vaut `monday`…, et
  // `week_start_date` est NULL sur les 70 lignes de Production. La
  // consommation, elle, est datée. On réutilise `getCurrentWeekDates()` — la
  // convention DÉJÀ en place pour le suivi hebdomadaire — plutôt que d'écrire
  // un second calendrier qui pourrait diverger d'un jour.
  //
  // `useMemo` sur une chaîne, et non sur le tableau : un littéral recréé à
  // chaque rendu relancerait la lecture indéfiniment.
  const datesAujourdHui = useMemo(() => {
    const maintenant = new Date();
    return `${maintenant.getFullYear()}-${String(maintenant.getMonth() + 1).padStart(2, "0")}-${String(
      maintenant.getDate(),
    ).padStart(2, "0")}`;
  }, []);

  // ── A5.7 — LA SEMAINE AFFICHÉE EST UN ÉTAT, ET LE CHARGEMENT LA SUIT ──────
  //
  // Par défaut : la semaine qui contient AUJOURD'HUI. Changer de semaine change
  // les sept dates, donc la clé de `useConsumedMeals`, donc la lecture — une
  // requête bornée à sept jours, jamais l'historique entier.
  //
  // ⚠️ Naviguer ne déplace RIEN : on change ce qu'on demande à la base, pas ce
  // qu'elle contient. Aucune écriture n'est déclenchée par ces deux boutons.
  const [semaine, setSemaine] = useState<Semaine>(
    () => semaineContenant(datesAujourdHui) ?? { debut: "", fin: "", dates: getCurrentWeekDates() },
  );
  const datesSemaine = semaine.dates;
  const datesParJour = useMemo(
    () =>
      Object.fromEntries(
        WEEKDAY_KEYS.map((jour, index) => [jour, datesSemaine[index]]),
      ) as Record<WeekdayKey, string>,
    [datesSemaine],
  );
  const consommation = useConsumedMeals(datesSemaine, supabaseNutrition.active);
  const raccourcis = useRaccourcisAliments(
    supabaseNutrition.studentId ?? null,
    supabaseNutrition.active,
  );

  if (!supabaseNutrition.ready) {
    return <p className="text-sm text-muted-foreground">Chargement…</p>;
  }

  if (supabaseNutrition.active) {
    const plan = supabaseNutrition.plans.find((p) => p.id === params.planId);

    if (!plan) {
      return (
        <div>
          <Link
            href="/nutrition"
            className="mb-6 inline-flex items-center gap-2 text-xs uppercase tracking-widest text-muted-foreground transition-colors hover:text-foreground"
          >
            <ArrowLeft size={14} />
            Mes plans alimentaires
          </Link>
          <p className="text-sm text-muted-foreground">Plan introuvable.</p>
        </div>
      );
    }

    // L'objectif hebdomadaire est la SOMME des sept jours, chacun selon son
    // profil — jamais « calories du jour × 7 », qui serait faux dès que deux
    // jours utilisent deux profils différents. On retombe sur la valeur
    // stockée tant que la semaine n'est pas chargée.
    const caloriesSemaine = v2.week ? weeklyCaloriesFromDays(v2.week) : plan.weeklyTargetCalories;

    // Les objectifs des SEPT jours, lundi → dimanche, tels que le coach les a
    // prescrits. `undefined` tant que la semaine n'est pas chargée : le suivi
    // retombe alors sur l'objectif unique, sans jamais afficher de valeur
    // inventée.
    const objectifsParJour = v2.week
      ? dailyTargetsByWeekday(v2.week).map((cible) =>
          cible
            ? {
                calories: cible.calories.totalCalories,
                protein: cible.grams.proteinGrams,
                carbs: cible.grams.carbGrams,
                fat: cible.grams.fatGrams,
              }
            : null,
        )
      : undefined;

    return (
      <div>
        <Link
          href="/nutrition"
          className="mb-6 inline-flex items-center gap-2 text-xs uppercase tracking-widest text-muted-foreground transition-colors hover:text-foreground"
        >
          <ArrowLeft size={14} />
          Mes plans alimentaires
        </Link>

        <div className="mb-8 flex flex-wrap items-start justify-between gap-4">
          <div>
            <h1 className="font-heading text-3xl font-extrabold uppercase text-foreground md:text-4xl">
              {plan.name}
            </h1>
            <p className="mt-1 text-sm text-muted-foreground">{nutritionGoalLabels[plan.goalType]}</p>
          </div>
          <StatusBadge status={plan.status} />
        </div>

        <div className="mb-8 grid grid-cols-2 gap-4 sm:grid-cols-3 lg:grid-cols-5">
          <StatCard label="kcal / jour" value={String(plan.caloriesPerDay)} size="lg" />
          <StatCard label="Protéines" value={`${plan.protein}g`} size="lg" />
          <StatCard label="Glucides" value={`${plan.carbs}g`} size="lg" />
          <StatCard label="Lipides" value={`${plan.fat}g`} size="lg" />
          <StatCard label="kcal / semaine" value={caloriesSemaine.toLocaleString("fr-FR")} size="lg" />
        </div>

        {/* L'entrée vers les recettes, en haut : l'outil le plus utile au
            quotidien ne doit pas être celui qu'on atteint en dernier. */}
        <div className="mb-8">
          <RecipesHighlightLink planId={plan.id} className="w-full sm:max-w-sm" />
        </div>

        {plan.coachNotes && (
          <div className="mb-8 border border-border bg-card p-6">
            <h2 className="mb-2 font-heading text-lg font-bold uppercase text-foreground">Consignes du coach</h2>
            <p className="text-sm leading-relaxed text-foreground">{plan.coachNotes}</p>
          </div>
        )}

        {/* ──────────────── SECTION 1 — SUIVI DE LA SEMAINE ────────────────
            Réutilisé tel quel : même composant, mêmes calculs, même rendu que
            l'écran /nutrition. Aucune notion de repas ni de créneau ici — cet
            outil reste strictement journalier.

            LE TITRE APPARTIENT AU COMPOSANT. `WeeklyNutritionTracker` rend
            déjà son propre `<h2>Suivi de la semaine</h2>` : celui qui vivait
            ici le doublait à l'écran. C'est ce titre-ci qui a été retiré, et
            pas l'autre — le composant est monté sur DEUX écrans (/nutrition
            et cette page), et lui ôter son titre l'aurait laissé anonyme sur
            le premier. Le doublon est donc supprimé à sa source, jamais
            masqué en CSS. */}
        {supabaseNutrition.studentId && (
          <section className="mb-10">
            <WeeklyNutritionTracker
              studentId={supabaseNutrition.studentId}
              planId={plan.id}
              target={{
                calories: plan.caloriesPerDay,
                protein: plan.protein,
                carbs: plan.carbs,
                fat: plan.fat,
                weeklyTargetCalories: caloriesSemaine,
                // Les SEPT objectifs réellement prescrits. Sans eux, le suivi
                // affichait la même moyenne hebdomadaire pour les sept jours,
                // alors que le coach a pu prescrire 3 000 kcal le lundi et
                // 2 000 le mardi.
                perDay: objectifsParJour,
              }}
            />
          </section>
        )}

        {/* ─────────────── SECTION 2 — SEMAINE ALIMENTAIRE ────────────────
            Ce que le COACH a prescrit à la main. Lecture seule : aucun champ
            de modification n'est rendu côté élève. */}
        <section className="mb-10">
          <h2 className="mb-4 font-heading text-lg font-bold uppercase text-foreground">
            Semaine alimentaire
          </h2>
          {v2.loading ? (
            <p className="text-sm text-muted-foreground">Chargement de la semaine…</p>
          ) : v2.error ? (
            <ÉtatErreur message={v2.error} onRéessayer={() => void v2.refetch()} />
          ) : v2.week ? (
            <StudentPrescribedWeek
              week={v2.week}
              // Le suivi est OPTIONNEL : sans cette prop, le composant rend
              // exactement la prescription d'avant A2. C'est la garantie de
              // non-régression demandée — on ajoute, on ne remplace pas.
              suivi={{
                datesParJour,
                meals: consommation.meals,
                chargement: consommation.loading,
                enCours: consommation.enCours,
                erreur: consommation.error,
                onEffacerErreur: consommation.effacerErreur,
                onOuvrirPrescrit: consommation.ouvrirPrescrit,
                onCreerRepas: consommation.creerRepas,
                onRenommerRepas: consommation.renommerRepas,
                onSupprimerRepas: consommation.supprimerRepas,
                onAjouterCatalogue: consommation.ajouterCatalogue,
                onAjouterProduit: consommation.ajouterProduit,
                // FAVORIS ET RÉCENTS (A5). Chargés ICI, une fois, et non dans
                // la feuille d'ajout : celle-ci est montée et démontée à chaque
                // ouverture, et un chargement interne repartirait de zéro à
                // chaque tap sur « Ajouter un aliment ».
                raccourcis,
                // La date du jour, INJECTÉE. `datesSemaine` est déjà mémorisée
                // à partir de la même horloge : lire l'heure une seconde fois
                // dans le rendu ferait diverger les deux autour de minuit.
                aujourdHui: datesAujourdHui,
                onSemainePrecedente: () => setSemaine((s) => decalerSemaine(s, -1)),
                onSemaineSuivante: () => setSemaine((s) => decalerSemaine(s, 1)),
                onAjouterManuel: consommation.ajouterManuel,
                onCorriger: consommation.corrigerQuantité,
                onSupprimerAliment: consommation.supprimerAliment,
              }}
            />
          ) : (
            <p className="rounded-panel border border-dashed border-border px-4 py-6 text-center text-sm text-muted-foreground">
              Ce plan n&apos;a pas encore de semaine.
            </p>
          )}
        </section>

        {/* SECTION 3 — RECETTES ADAPTATIVES : déplacée sur son propre écran,
            /nutrition/[planId]/recettes, atteint par le bouton mis en avant
            en haut de page. Rien n'a changé dans l'outil lui-même. */}

        {plan.shoppingList.length > 0 && (
          <div className="border border-border bg-card p-6">
            <div className="mb-4 flex items-center gap-3">
              <ShoppingCart size={18} className="text-primary" />
              <h2 className="font-heading text-lg font-bold uppercase text-foreground">Liste de courses</h2>
            </div>
            <div className="flex flex-wrap gap-2">
              {plan.shoppingList.map((item) => (
                <span key={item} className="border border-border px-3 py-1 text-xs text-muted-foreground">
                  {item}
                </span>
              ))}
            </div>
          </div>
        )}
      </div>
    );
  }

  /* ══════════════════════════════════════════════════════════════════
   * LE SERVEUR N'A PAS RÉPONDU
   * ══════════════════════════════════════════════════════════════════
   * Le détail d'un plan — sept jours, repas prescrits, recettes — n'est pas
   * conservé sur l'appareil. On le dit. Ce qu'on ne fait plus : ouvrir le
   * plan de démonstration sous l'identifiant demandé, ce qui donnait à un
   * élève réel des macros qui n'étaient pas les siennes. */
  if (local.etat === "chargement") {
    return <p className="text-sm text-muted-foreground">Chargement…</p>;
  }

  if (local.etat !== "mock") {
    return (
      <SectionIndisponible
        zone="/nutrition/[planId]"
        titre="Plan alimentaire"
        etat={local.etat}
        retour={{ href: "/nutrition", libelle: "Mes plans alimentaires" }}
        lignes={{ planIdUrl: params.planId, auth: local.identite ? "oui" : "non" }}
      />
    );
  }

  /* ── DÉMONSTRATION ──────────────────────────────────────────────────
   * Seul `local.etat === "mock"` arrive ici : Supabase non configuré. */
  const plan = getNutritionPlan(params.planId);

  if (!plan) {
    return (
      <div>
        <Link
          href="/nutrition"
          className="mb-6 inline-flex items-center gap-2 text-xs uppercase tracking-widest text-muted-foreground transition-colors hover:text-foreground"
        >
          <ArrowLeft size={14} />
          Mes plans alimentaires
        </Link>
        <p className="text-sm text-muted-foreground">Plan introuvable.</p>
      </div>
    );
  }

  return (
    <div>
      <Link
        href="/nutrition"
        className="mb-6 inline-flex items-center gap-2 text-xs uppercase tracking-widest text-muted-foreground transition-colors hover:text-foreground"
      >
        <ArrowLeft size={14} />
        Mes plans alimentaires
      </Link>

      <div className="mb-8 flex flex-wrap items-start justify-between gap-4">
        <div>
          <h1 className="font-heading text-3xl font-extrabold uppercase text-foreground md:text-4xl">
            {plan.name}
          </h1>
          <p className="mt-1 text-sm text-muted-foreground">
            {nutritionGoalLabels[plan.goalType]}
          </p>
        </div>
        <StatusBadge status={plan.status} />
      </div>

      <div className="mb-8 grid grid-cols-2 gap-4 sm:grid-cols-3 lg:grid-cols-5">
        <StatCard label="kcal / jour" value={String(plan.dailyTarget.calories)} size="lg" />
        <StatCard label="Protéines" value={`${plan.dailyTarget.protein}g`} size="lg" />
        <StatCard label="Glucides" value={`${plan.dailyTarget.carbs}g`} size="lg" />
        <StatCard label="Lipides" value={`${plan.dailyTarget.fat}g`} size="lg" />
        <StatCard label="kcal / semaine" value={plan.weeklyTargetCalories.toLocaleString("fr-FR")} size="lg" />
      </div>

      <div className="mb-8">
        <NutritionPlanWorkspace studentId={student.id} plan={plan} />
      </div>

      <div className="border border-border bg-card p-6">
        <div className="mb-4 flex items-center gap-3">
          <ShoppingCart size={18} className="text-primary" />
          <h2 className="font-heading text-lg font-bold uppercase text-foreground">
            Liste de courses
          </h2>
        </div>
        <div className="flex flex-wrap gap-2">
          {plan.shoppingList.map((item) => (
            <span
              key={item}
              className="border border-border px-3 py-1 text-xs text-muted-foreground"
            >
              {item}
            </span>
          ))}
        </div>
      </div>
    </div>
  );
}

/**
 * Un vrai état d'ERREUR, avec possibilité de réessayer.
 *
 * Avant la PR C, une lecture Supabase en échec était avalée par la couche
 * d'accès et se présentait à l'élève comme « aucun plan attribué » — un
 * message faux, qui l'envoyait écrire à son coach pour un problème de réseau.
 */
function ÉtatErreur({ message, onRéessayer }: { message: string; onRéessayer: () => void }) {
  return (
    <div
      className="flex flex-col items-start gap-3 rounded-panel border border-destructive/40 bg-destructive/10 px-4 py-3"
      role="alert"
    >
      <p className="text-sm text-destructive">{message}</p>
      <button
        type="button"
        onClick={onRéessayer}
        className="pressable flex min-h-11 items-center gap-2 rounded-control border border-destructive/50 px-4 text-xs uppercase tracking-widest text-destructive transition-colors hover:bg-destructive/10 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-destructive/40"
      >
        Réessayer
      </button>
    </div>
  );
}
