"use client";

import { useCallback, useSyncExternalStore } from "react";

import { bodyMeasurementLabels, nextWeightHistoryMonth } from "@/lib/profile";
import type {
  BodyMeasurement,
  BodyMeasurementType,
  CustomMeasurement,
  MeasurementLogEntry,
  ProgressPhoto,
  StudentProfile,
  WeightEntry,
} from "@/types";

let localIdCounter = 0;
function localId(prefix: string): string {
  localIdCounter += 1;
  return `${prefix}-${Date.now()}-${localIdCounter}`;
}

/**
 * État complet du profil élève (informations personnelles, historique de
 * poids, mensurations, mesures personnalisées, photos de progression).
 * Regroupé en un seul objet car toutes les cartes du profil doivent
 * partager la même source de vérité — contrairement au suivi
 * nutrition/documents (une seule sous-structure), ici une mise à jour du
 * poids doit se répercuter à la fois sur le profil et sur l'historique.
 */
export interface StudentProfileState {
  profile: StudentProfile;
  weightHistory: WeightEntry[];
  measurements: BodyMeasurement[];
  customMeasurements: CustomMeasurement[];
  measurementHistory: MeasurementLogEntry[];
  photos: ProgressPhoto[];
}

const CHANGE_EVENT = "seth-student-profile:change";

function storageKey(studentId: string): string {
  return `seth-student-profile:${studentId}`;
}

function readRaw(studentId: string): string | null {
  try {
    return window.localStorage.getItem(storageKey(studentId));
  } catch {
    return null;
  }
}

function parseState(raw: string | null): StudentProfileState | null {
  if (!raw) {
    return null;
  }
  try {
    const parsed = JSON.parse(raw) as StudentProfileState;
    // Défensif : un état persisté avant l'ajout de measurementHistory (ou
    // dont un tableau aurait été corrompu) ne doit jamais faire planter la
    // page — on retombe sur des tableaux vides plutôt que undefined.
    return {
      ...parsed,
      weightHistory: Array.isArray(parsed.weightHistory) ? parsed.weightHistory : [],
      measurements: Array.isArray(parsed.measurements) ? parsed.measurements : [],
      customMeasurements: Array.isArray(parsed.customMeasurements) ? parsed.customMeasurements : [],
      measurementHistory: Array.isArray(parsed.measurementHistory) ? parsed.measurementHistory : [],
      photos: Array.isArray(parsed.photos) ? parsed.photos : [],
    };
  } catch {
    return null;
  }
}

function writeState(studentId: string, state: StudentProfileState): void {
  try {
    window.localStorage.setItem(storageKey(studentId), JSON.stringify(state));
  } catch {
    // localStorage indisponible (navigation privée, quota...) : on continue
    // sans persister, l'état reste au moins cohérent pour l'onglet courant.
  }
  window.dispatchEvent(new CustomEvent(CHANGE_EVENT, { detail: studentId }));
}

// Cache la dernière snapshot par élève pour ne renvoyer une nouvelle
// référence d'objet que lorsque le contenu localStorage a réellement
// changé (obligatoire avec useSyncExternalStore).
const snapshotCache = new Map<
  string,
  { raw: string | null; state: StudentProfileState }
>();

function getSnapshot(
  studentId: string,
  seed: StudentProfileState,
): StudentProfileState {
  const raw = readRaw(studentId);
  const cached = snapshotCache.get(studentId);
  if (cached && cached.raw === raw) {
    return cached.state;
  }
  const state = parseState(raw) ?? seed;
  snapshotCache.set(studentId, { raw, state });
  return state;
}

// Snapshot "sans localStorage" utilisée côté serveur : mémorisée pour
// renvoyer toujours la même référence, comme l'exige useSyncExternalStore.
const seedSnapshotCache = new Map<string, StudentProfileState>();

function getSeedSnapshot(
  studentId: string,
  seed: StudentProfileState,
): StudentProfileState {
  const cached = seedSnapshotCache.get(studentId);
  if (cached) {
    return cached;
  }
  seedSnapshotCache.set(studentId, seed);
  return seed;
}

function subscribe(studentId: string, onStoreChange: () => void) {
  function handleChange(event: Event) {
    if (event instanceof StorageEvent) {
      if (event.key === storageKey(studentId)) {
        onStoreChange();
      }
      return;
    }
    if (event instanceof CustomEvent && event.detail === studentId) {
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

export interface CustomMeasurementInput {
  name: string;
  value: number;
  unit: string;
  note: string;
}

/**
 * Source de vérité unique pour toute la page /profil, partagée entre
 * toutes les sections (résumé, informations personnelles, évolution du
 * poids, mensurations, photos). Persistée dans localStorage tant que
 * Supabase n'est pas connecté, avec useSyncExternalStore pour que chaque
 * mise à jour (poids, objectif, infos, mensurations, photo) soit
 * immédiatement visible partout et survive à un rechargement.
 */
export function useStudentProfile(studentId: string, seed: StudentProfileState) {
  const state = useSyncExternalStore(
    (onStoreChange) => subscribe(studentId, onStoreChange),
    () => getSnapshot(studentId, seed),
    () => getSeedSnapshot(studentId, seed),
  );

  const updateProfile = useCallback(
    (partial: Partial<StudentProfile>) => {
      const current = getSnapshot(studentId, seed);
      writeState(studentId, {
        ...current,
        profile: { ...current.profile, ...partial },
      });
    },
    [studentId, seed],
  );

  const updateWeight = useCallback(
    (weightKg: number) => {
      const current = getSnapshot(studentId, seed);
      const newHistory: WeightEntry[] = [
        ...current.weightHistory,
        { month: nextWeightHistoryMonth(current.weightHistory), kg: weightKg },
      ];
      writeState(studentId, {
        ...current,
        profile: { ...current.profile, currentWeightKg: weightKg },
        weightHistory: newHistory,
      });
    },
    [studentId, seed],
  );

  const updateMeasurements = useCallback(
    (
      values: Partial<Record<BodyMeasurementType, number>>,
      date: string,
      note: string,
      custom: CustomMeasurementInput | null,
    ) => {
      const current = getSnapshot(studentId, seed);
      const newHistoryEntries: MeasurementLogEntry[] = [];
      const measuredAt = date || new Date().toISOString().slice(0, 10);
      const createdAt = new Date().toISOString();

      const measurements = current.measurements.map((measurement) => {
        const newValue = values[measurement.type];
        if (newValue === undefined) {
          return measurement;
        }
        newHistoryEntries.push({
          id: localId("meas-log"),
          studentId,
          key: measurement.type,
          label: bodyMeasurementLabels[measurement.type] ?? measurement.type,
          value: newValue,
          unit: measurement.unit,
          measuredAt,
          note,
          createdAt,
        });
        return {
          ...measurement,
          currentValue: newValue,
          note: note || measurement.note,
          lastUpdatedAt: date,
        };
      });

      // Une mesure personnalisée déjà existante (même nom, insensible à la
      // casse) doit être MISE À JOUR (valeur actuelle) plutôt que dupliquée :
      // la valeur de départ reste exploitable comme historique.
      let customMeasurements = current.customMeasurements;
      if (custom) {
        const normalizedName = custom.name.trim().toLowerCase();
        const existing = customMeasurements.find(
          (m) => m.name.trim().toLowerCase() === normalizedName,
        );
        if (existing) {
          customMeasurements = customMeasurements.map((m) =>
            m.id === existing.id
              ? { ...m, currentValue: custom.value, note: custom.note || m.note, lastUpdatedAt: date }
              : m,
          );
          newHistoryEntries.push({
            id: localId("meas-log"),
            studentId,
            key: existing.id,
            label: existing.name,
            value: custom.value,
            unit: custom.unit,
            measuredAt,
            note: custom.note,
            createdAt,
          });
        } else {
          const newCustomId = localId("custom");
          customMeasurements = [
            ...customMeasurements,
            {
              id: newCustomId,
              studentId,
              name: custom.name,
              unit: custom.unit,
              startValue: custom.value,
              currentValue: custom.value,
              note: custom.note,
              lastUpdatedAt: date,
            },
          ];
          newHistoryEntries.push({
            id: localId("meas-log"),
            studentId,
            key: newCustomId,
            label: custom.name,
            value: custom.value,
            unit: custom.unit,
            measuredAt,
            note: custom.note,
            createdAt,
          });
        }
      }

      writeState(studentId, {
        ...current,
        measurements,
        customMeasurements,
        measurementHistory: [...current.measurementHistory, ...newHistoryEntries],
      });
    },
    [studentId, seed],
  );

  const addPhoto = useCallback(
    (photo: ProgressPhoto) => {
      const current = getSnapshot(studentId, seed);
      writeState(studentId, { ...current, photos: [...current.photos, photo] });
    },
    [studentId, seed],
  );

  const removePhoto = useCallback(
    (photoId: string) => {
      const current = getSnapshot(studentId, seed);
      writeState(studentId, {
        ...current,
        photos: current.photos.filter((photo) => photo.id !== photoId),
      });
    },
    [studentId, seed],
  );

  const resetProfile = useCallback(() => {
    try {
      window.localStorage.removeItem(storageKey(studentId));
    } catch {
      // localStorage indisponible : rien à nettoyer.
    }
    window.dispatchEvent(new CustomEvent(CHANGE_EVENT, { detail: studentId }));
  }, [studentId]);

  return {
    state,
    updateProfile,
    updateWeight,
    updateMeasurements,
    addPhoto,
    removePhoto,
    resetProfile,
  };
}
