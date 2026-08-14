"use client";

import { useCallback, useMemo, useState } from "react";

import { agregerCourses } from "@/lib/courses/agregation";
import {
  type ModeGeneration,
  type ResultatCourses,
  genererCourses,
  modeRecommande,
} from "@/lib/courses/besoins";
import {
  type PeriodeCourses,
  construirePeriode,
  joursDeLaPeriode,
} from "@/lib/courses/periode";
import {
  type CategorieEnvie,
  type PreferencesCourses,
  PREFERENCES_VIDES,
  normaliserLibelle,
} from "@/lib/courses/preferences";
import { agregerConsommation } from "@/lib/nutrition/historique";
import type { ConsumedMeal } from "@/lib/nutrition/consumed";
import type { PlanV2Week } from "@/lib/nutrition/plan-v2-week";
import type { RecipeWithTags } from "@/lib/nutrition/recipe-rows";
import type { AlimentRapide } from "@/lib/supabase/consumed-meals";

/**
 * COURSES C1 — L'ÉTAT DU PARCOURS, ET RIEN D'AUTRE.
 *
 * ────────────────────────────────────────────────────────────────────────────
 * CE HOOK NE CALCULE AUCUNE COURSE
 * ────────────────────────────────────────────────────────────────────────────
 * ⚠️ Il porte l'état des quatre étapes — durée, envies, exclusions, mode — et
 * DÉLÈGUE la génération à `genererCourses`. Refaire ici, en React, un morceau
 * de la sélection ou de l'agrégation créerait une seconde implémentation que
 * les tests du moteur ne couvriraient pas. Un test l'interdit (C1-UI-10).
 *
 * ────────────────────────────────────────────────────────────────────────────
 * IL N'ÉCRIT RIEN, ET IL NE LIT RIEN LUI-MÊME
 * ────────────────────────────────────────────────────────────────────────────
 * Le plan, les recettes, les favoris et l'historique lui sont PASSÉS : ils sont
 * chargés par les lecteurs qui existent déjà (`useStudentNutritionPlanV2`,
 * `useRaccourcisAliments`, `useConsumedMeals`). Ouvrir ici un second accès aux
 * mêmes tables ferait deux requêtes concurrentes pour la même donnée.
 */

/** Fenêtre principale des habitudes — le §8 : sept jours d'abord. */
export const FENETRE_HABITUDES_JOURS = 7;
/** Fenêtre de départage, quand sept jours ne suffisent pas à trancher. */
export const FENETRE_HABITUDES_LONGUE_JOURS = 28;

/** Les N derniers jours, la date du jour comprise. */
export function datesRecentes(aujourdHui: string, nbJours: number): readonly string[] {
  const p = construirePeriode(aujourdHui, 1);
  if (!p) return [];
  const [a, m, j] = aujourdHui.split("-").map(Number);
  const dates: string[] = [];
  for (let i = nbJours - 1; i >= 0; i -= 1) {
    const d = new Date(a, m - 1, j);
    d.setDate(d.getDate() - i);
    dates.push(
      `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`,
    );
  }
  return dates;
}

/**
 * Combien de REPAS contiennent chaque aliment, libellé normalisé.
 *
 * ⚠️ ON AGRÈGE REPAS PAR REPAS, ET C'EST TOUT LE POINT. `agregerConsommation`
 * fond volontairement toutes les consommations d'un même aliment en UNE ligne
 * — c'est ce qu'il faut pour un total hebdomadaire, et c'est exactement ce
 * qu'il ne faut pas ici : appelé une fois sur toute la fenêtre, il rendrait 1
 * pour un aliment mangé sept fois comme pour un aliment mangé une fois, et
 * « nombre de consommations » ne voudrait plus rien dire. Un appel par repas
 * garde la fréquence.
 *
 * ⚠️ ON PASSE QUAND MÊME PAR `agregerConsommation` (A5.7) plutôt que de compter
 * les entrées à la main : c'est lui qui sait ne jamais fusionner deux GTIN ni
 * deux `catalog_food`. Dans un même repas, un aliment ne compte qu'une fois,
 * même saisi en deux entrées ou en deux unités — un repas est UNE consommation.
 */
function occurrencesParRepas(repas: readonly ConsumedMeal[]): Record<string, number> {
  const compte: Record<string, number> = {};
  for (const r of repas) {
    const vusDansCeRepas = new Set<string>();
    for (const ligne of agregerConsommation([r])) {
      const n = normaliserLibelle(ligne.nameSnapshot);
      if (n !== "") vusDansCeRepas.add(n);
    }
    for (const n of vusDansCeRepas) compte[n] = (compte[n] ?? 0) + 1;
  }
  return compte;
}

/**
 * Les habitudes : libellé normalisé → nombre de consommations.
 *
 * La fenêtre LONGUE ne remplace pas la courte : elle la COMPLÈTE, et seulement
 * pour les aliments que la courte ne connaît pas. Sept jours restent le signal
 * principal, vingt-huit ne sert qu'à départager — c'est le §8.
 */
export function habitudesDepuis(
  repasCourts: readonly ConsumedMeal[],
  repasLongs: readonly ConsumedMeal[] = [],
): Readonly<Record<string, number>> {
  const compte = occurrencesParRepas(repasCourts);
  for (const [n, occurrences] of Object.entries(occurrencesParRepas(repasLongs))) {
    if (compte[n] === undefined) compte[n] = occurrences;
  }
  return compte;
}

/** Le libellé affichable d'un favori, quel que soit son type. */
export function libelleFavori(f: AlimentRapide): string {
  return f.type === "aliment" ? f.aliment.name : f.produit.name;
}

export interface EtatCourses {
  readonly nbJours: number;
  readonly debut: string;
  readonly periode: PeriodeCourses | null;
  readonly preferences: PreferencesCourses;
  /** `null` tant que l'élève n'a pas choisi : on suit alors la recommandation. */
  readonly modeChoisi: ModeGeneration | null;
  readonly mode: ModeGeneration;
  readonly resultat: ResultatCourses | null;

  readonly setNbJours: (n: number) => void;
  readonly setDebut: (iso: string) => void;
  readonly basculerEnvie: (categorie: CategorieEnvie, valeur: string) => void;
  readonly ajouterEnvie: (categorie: CategorieEnvie, valeur: string) => void;
  readonly basculerExclusion: (valeur: string) => void;
  readonly setMode: (m: ModeGeneration) => void;
  readonly generer: () => void;
  readonly reinitialiser: () => void;
}

export function useCourses({
  aujourdHui,
  week,
  recettes,
  favoris,
  repasRecents,
  repasLongs,
}: {
  aujourdHui: string;
  week: PlanV2Week | null;
  recettes: readonly RecipeWithTags[];
  favoris: readonly AlimentRapide[];
  repasRecents: readonly ConsumedMeal[];
  repasLongs?: readonly ConsumedMeal[];
}): EtatCourses {
  const [nbJours, setNbJours] = useState(3);
  const [debut, setDebut] = useState(aujourdHui);
  const [preferences, setPreferences] = useState<PreferencesCourses>(PREFERENCES_VIDES);
  const [modeChoisi, setModeChoisi] = useState<ModeGeneration | null>(null);
  const [resultat, setResultat] = useState<ResultatCourses | null>(null);

  const periode = useMemo(() => construirePeriode(debut, nbJours), [debut, nbJours]);

  // ⚠️ LA RECOMMANDATION SUIT LES ENVIES, MAIS NE LES IMPOSE PAS. Tant que
  // l'élève n'a rien choisi, le mode bascule tout seul quand il coche une
  // envie ; dès qu'il a choisi, son choix tient — sinon l'écran changerait
  // d'avis sous ses doigts.
  const mode = modeChoisi ?? modeRecommande(preferences);

  const basculerEnvie = useCallback((categorie: CategorieEnvie, valeur: string) => {
    setPreferences((p) => {
      const actuelles = p.envies[categorie] ?? [];
      const présente = actuelles.some((v) => normaliserLibelle(v) === normaliserLibelle(valeur));
      return {
        ...p,
        envies: {
          ...p.envies,
          [categorie]: présente
            ? actuelles.filter((v) => normaliserLibelle(v) !== normaliserLibelle(valeur))
            : [...actuelles, valeur],
        },
      };
    });
  }, []);

  const ajouterEnvie = useCallback(
    (categorie: CategorieEnvie, valeur: string) => {
      const propre = valeur.trim();
      if (propre === "") return;
      basculerEnvie(categorie, propre);
    },
    [basculerEnvie],
  );

  const basculerExclusion = useCallback((valeur: string) => {
    const propre = valeur.trim();
    if (propre === "") return;
    setPreferences((p) => {
      const présente = p.exclusions.some((v) => normaliserLibelle(v) === normaliserLibelle(propre));
      return {
        ...p,
        exclusions: présente
          ? p.exclusions.filter((v) => normaliserLibelle(v) !== normaliserLibelle(propre))
          : [...p.exclusions, propre],
      };
    });
  }, []);

  const generer = useCallback(() => {
    if (!periode) {
      setResultat(null);
      return;
    }
    // ⚠️ UN SEUL APPEL, AU MOTEUR EXISTANT. Rien n'est recalculé ici.
    setResultat(
      genererCourses({
        jours: joursDeLaPeriode(periode, week),
        week,
        recettes,
        preferences,
        favoris: favoris.map(libelleFavori),
        habitudes: habitudesDepuis(repasRecents, repasLongs ?? []),
        mode,
      }),
    );
  }, [periode, week, recettes, preferences, favoris, repasRecents, repasLongs, mode]);

  const reinitialiser = useCallback(() => {
    setPreferences(PREFERENCES_VIDES);
    setModeChoisi(null);
    setResultat(null);
  }, []);

  return {
    nbJours,
    debut,
    periode,
    preferences,
    modeChoisi,
    mode,
    resultat,
    setNbJours,
    setDebut,
    basculerEnvie,
    ajouterEnvie,
    basculerExclusion,
    setMode: setModeChoisi,
    generer,
    reinitialiser,
  };
}

/** Ré-export pour les écrans, afin qu'ils n'aillent pas chercher l'agrégateur. */
export { agregerCourses };
