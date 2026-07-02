"use client";

import { useCallback, useSyncExternalStore } from "react";

import type { ActualDailyIntake, NutritionDay, NutritionPlan } from "@/types";

/**
 * Suivi nutrition partagé entre /nutrition et /nutrition/[planId].
 *
 * Tant que Supabase n'est pas branché, les journées validées sont
 * persistées dans localStorage (par plan) afin que les deux pages lisent
 * le même état et qu'il survive à un rechargement. Le format stocké est
 * volontairement plat (dayId -> statut + macros réelles) pour se
 * transposer facilement en lignes `actual_daily_intake` plus tard.
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

export function useNutritionTracking(plan: NutritionPlan) {
  const days = useSyncExternalStore(
    (onStoreChange) => subscribe(plan.id, onStoreChange),
    () => getSnapshot(plan),
    () => plan.days,
  );

  const validateDay = useCallback(
    (dayId: string, actual: ActualDailyIntake) => {
      const overrides = parseOverrides(readRaw(plan.id));
      overrides[dayId] = { status: "valide", actual };
      writeOverrides(plan.id, overrides);
    },
    [plan.id],
  );

  const resetWeek = useCallback(() => {
    writeOverrides(plan.id, {});
  }, [plan.id]);

  return { days, validateDay, resetWeek };
}
