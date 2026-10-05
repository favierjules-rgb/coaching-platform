"use client";

import { useCallback, useSyncExternalStore } from "react";

import { isSupabaseConfigured } from "@/lib/supabase/env";
import type { ActualDailyIntake, NutritionDay, NutritionPlan } from "@/types";

/**
 * SUIVI NUTRITION DE LA DÉMONSTRATION — ET DE RIEN D'AUTRE (P6).
 *
 * ════════════════════════════════════════════════════════════════════════
 * LE LOCALSTORAGE N'EST PLUS UNE SOURCE DE VÉRITÉ, ET C'EST STRUCTUREL
 * ════════════════════════════════════════════════════════════════════════
 * Ce hook persistait les journées validées dans
 * `localStorage["seth-nutrition-tracking:<planId>"]`. Audit du 05/10/2026 :
 * ses trois consommateurs — `NutritionPlanWorkspace`,
 * `NutritionWeekStatusClient`, `NutritionPlanCardLive` — ne sont montés que
 * dans la branche de DÉMONSTRATION de `/nutrition` et `/nutrition/[planId]`,
 * atteinte uniquement quand `local.etat === "mock"`, c'est-à-dire quand
 * Supabase n'est pas configuré. La clé ne pouvait donc être écrite que par
 * une session de démonstration — et le plan qu'elle annote vient de
 * `data/student.ts`.
 *
 * ⚠️ LA GARDE CI-DESSOUS REND CELA VÉRIFIABLE PLUTÔT QUE SUPPOSÉ. Dès que
 * Supabase est configuré, la clé n'est NI lue NI écrite, et `validateDay` /
 * `resetWeek` ne font rien. Un écran réel branché par erreur sur ce hook
 * n'obtiendrait donc pas un état local : il obtiendrait le plan tel quel.
 * S'en remettre à « de toute façon ce composant n'est monté qu'en
 * démonstration » serait fonder une règle de données sur une arborescence de
 * rendu, que le prochain lot déplacerait sans le savoir.
 *
 * ⚠️ LE STATUT RÉEL EST AILLEURS, ET IL EST DÉRIVÉ. Pour un élève Supabase,
 * « cette journée est remplie » se lit dans `consumed_meals` /
 * `meal_entries` — voir `lib/nutrition/statut-journee.ts` et
 * `lib/supabase/nutrition-journal.ts`. Aucune écriture n'est ajoutée ici : le
 * statut n'est pas stocké, il est dérivé des repas, qui SONT la persistance.
 *
 * ⚠️ LA CLÉ EXISTANTE N'EST PAS EFFACÉE. Les validations déjà posées dans un
 * navigateur restent lisibles dans ce même navigateur quand Supabase est
 * absent : le parcours de démonstration continue de fonctionner à
 * l'identique. Elles ne sont PAS migrables vers Supabase — `dayId` est un
 * identifiant de `data/student.ts` sans date, et `hunger` / `energy` /
 * `digestion` / `comment` n'ont aucune colonne d'accueil. Les convertir
 * demanderait d'inventer des dates.
 *
 * Implémenté avec useSyncExternalStore (plutôt qu'un useState + useEffect)
 * pour éviter tout risque de désynchronisation entre plusieurs instances
 * du hook montées en même temps (ex: la carte "Ajustement semaine" et le
 * calendrier sur la même page) et pour rester compatible avec le rendu
 * serveur (aucun accès à `window` avant l'hydratation).
 */

type DayOverrideStatus = Extract<NutritionDay["status"], "valide">;

interface DayOverride {
  status: DayOverrideStatus;
  actual: ActualDailyIntake;
}

type PersistedOverrides = Record<string, DayOverride>;

const CHANGE_EVENT = "seth-nutrition-tracking:change";

function storageKey(planId: string): string {
  return `seth-nutrition-tracking:${planId}`;
}

function readRaw(planId: string): string | null {
  try {
    return window.localStorage.getItem(storageKey(planId));
  } catch {
    return null;
  }
}

function parseOverrides(raw: string | null): PersistedOverrides {
  if (!raw) {
    return {};
  }
  try {
    return JSON.parse(raw) as PersistedOverrides;
  } catch {
    return {};
  }
}

function writeOverrides(planId: string, overrides: PersistedOverrides): void {
  try {
    window.localStorage.setItem(storageKey(planId), JSON.stringify(overrides));
  } catch {
    // localStorage indisponible (navigation privée, quota...) : on continue
    // sans persister, l'état reste au moins cohérent pour l'onglet courant.
  }
  // "storage" ne se déclenche que sur les *autres* onglets : on émet aussi
  // un évènement custom pour que les instances du hook dans l'onglet
  // courant se resynchronisent immédiatement.
  window.dispatchEvent(new CustomEvent(CHANGE_EVENT, { detail: planId }));
}

function applyOverrides(
  seedDays: NutritionDay[],
  overrides: PersistedOverrides,
): NutritionDay[] {
  return seedDays.map((day) => {
    const override = overrides[day.id];
    if (!override) {
      return day;
    }
    return { ...day, status: override.status, actual: override.actual };
  });
}

// Cache la dernière snapshot calculée par plan pour ne renvoyer une
// nouvelle référence de tableau que lorsque le contenu localStorage a
// réellement changé (obligatoire avec useSyncExternalStore, sous peine de
// boucle de rendu infinie).
const snapshotCache = new Map<
  string,
  { raw: string | null; days: NutritionDay[] }
>();

function getSnapshot(plan: NutritionPlan): NutritionDay[] {
  const raw = readRaw(plan.id);
  const cached = snapshotCache.get(plan.id);
  if (cached && cached.raw === raw) {
    return cached.days;
  }
  const days = applyOverrides(plan.days, parseOverrides(raw));
  snapshotCache.set(plan.id, { raw, days });
  return days;
}

function subscribe(planId: string, onStoreChange: () => void) {
  function handleChange(event: Event) {
    if (event instanceof StorageEvent) {
      if (event.key === storageKey(planId)) {
        onStoreChange();
      }
      return;
    }
    if (event instanceof CustomEvent && event.detail === planId) {
      onStoreChange();
    }
  }

  window.addEventListener("storage", handleChange);
  window.addEventListener(CHANGE_EVENT, handleChange);
  return () => {
    window.removeEventListener("storage", handleChange);
    window.removeEventListener(CHANGE_EVENT, handleChange);
  };
}

/** Aucun abonnement : utilisé quand le localStorage est hors jeu. */
function neRienEcouter(): () => void {
  return () => {};
}

export function useNutritionTracking(plan: NutritionPlan) {
  /*
   * ⚠️ LA GARDE. Lue à chaque rendu, et non mémorisée : la valeur dépend de
   * variables d'environnement `NEXT_PUBLIC_*`, donc elle est stable pour une
   * session, mais la figer dans un `useRef` rendrait le hook impossible à
   * éprouver avec et sans Supabase dans le même harnais de test.
   */
  const supabaseActif = isSupabaseConfigured();

  const days = useSyncExternalStore(
    (onStoreChange) => (supabaseActif ? neRienEcouter() : subscribe(plan.id, onStoreChange)),
    () => (supabaseActif ? plan.days : getSnapshot(plan)),
    () => plan.days,
  );

  const validateDay = useCallback(
    (dayId: string, actual: ActualDailyIntake) => {
      /*
       * ⚠️ INERTE SOUS SUPABASE, ET SILENCIEUSEMENT — pas une exception. Ce
       * hook n'est atteint que par la démonstration ; lever ici ferait planter
       * un écran si un lot futur l'y branchait par erreur, au lieu de
       * simplement ne rien persister localement. Le statut réel se dérive des
       * repas (lib/nutrition/statut-journee.ts).
       */
      if (supabaseActif) return;
      const overrides = parseOverrides(readRaw(plan.id));
      overrides[dayId] = { status: "valide", actual };
      writeOverrides(plan.id, overrides);
    },
    [plan.id, supabaseActif],
  );

  const resetWeek = useCallback(() => {
    if (supabaseActif) return;
    writeOverrides(plan.id, {});
  }, [plan.id, supabaseActif]);

  return { days, validateDay, resetWeek };
}
