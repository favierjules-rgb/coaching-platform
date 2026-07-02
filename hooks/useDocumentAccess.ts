"use client";

import { useCallback, useSyncExternalStore } from "react";

import type { DocumentStatus, StudentDocumentAccess } from "@/types";

/**
 * Suivi "consulté / nouveau" partagé entre /documents et
 * /documents/[documentId]. Même pattern que useNutritionTracking : les
 * documents consultés sont persistés dans localStorage (par élève) pour
 * que toutes les pages lisent le même état et qu'il survive à un
 * rechargement, implémenté avec useSyncExternalStore pour rester cohérent
 * entre plusieurs instances montées en même temps.
 */

type PersistedViewedAt = Record<string, string>; // documentId -> viewedAt ISO

const CHANGE_EVENT = "seth-document-access:change";

function storageKey(studentId: string): string {
  return `seth-document-access:${studentId}`;
}

function readRaw(studentId: string): string | null {
  try {
    return window.localStorage.getItem(storageKey(studentId));
  } catch {
    return null;
  }
}

function parseOverrides(raw: string | null): PersistedViewedAt {
  if (!raw) {
    return {};
  }
  try {
    return JSON.parse(raw) as PersistedViewedAt;
  } catch {
    return {};
  }
}

function writeOverrides(studentId: string, overrides: PersistedViewedAt): void {
  try {
    window.localStorage.setItem(storageKey(studentId), JSON.stringify(overrides));
  } catch {
    // localStorage indisponible (navigation privée, quota...) : on continue
    // sans persister, l'état reste au moins cohérent pour l'onglet courant.
  }
  window.dispatchEvent(new CustomEvent(CHANGE_EVENT, { detail: studentId }));
}

function buildViewedMap(
  seed: StudentDocumentAccess[],
  overrides: PersistedViewedAt,
): Map<string, string | null> {
  const map = new Map<string, string | null>();
  for (const access of seed) {
    map.set(access.documentId, access.viewedAt);
  }
  for (const [documentId, viewedAt] of Object.entries(overrides)) {
    map.set(documentId, viewedAt);
  }
  return map;
}

// Cache la dernière snapshot par élève pour ne renvoyer une nouvelle
// référence de Map que lorsque le contenu localStorage a réellement
// changé (obligatoire avec useSyncExternalStore).
const snapshotCache = new Map<
  string,
  { raw: string | null; map: Map<string, string | null> }
>();

function getSnapshot(
  studentId: string,
  seed: StudentDocumentAccess[],
): Map<string, string | null> {
  const raw = readRaw(studentId);
  const cached = snapshotCache.get(studentId);
  if (cached && cached.raw === raw) {
    return cached.map;
  }
  const map = buildViewedMap(seed, parseOverrides(raw));
  snapshotCache.set(studentId, { raw, map });
  return map;
}

// Snapshot "sans overrides" utilisée côté serveur (aucun accès à
// localStorage pendant le SSR) : mémorisée pour renvoyer toujours la même
// référence, comme l'exige useSyncExternalStore.
const seedSnapshotCache = new Map<string, Map<string, string | null>>();

function getSeedSnapshot(
  studentId: string,
  seed: StudentDocumentAccess[],
): Map<string, string | null> {
  const cached = seedSnapshotCache.get(studentId);
  if (cached) {
    return cached;
  }
  const map = buildViewedMap(seed, {});
  seedSnapshotCache.set(studentId, map);
  return map;
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

export function useDocumentAccess(
  studentId: string,
  seed: StudentDocumentAccess[],
) {
  const viewedMap = useSyncExternalStore(
    (onStoreChange) => subscribe(studentId, onStoreChange),
    () => getSnapshot(studentId, seed),
    () => getSeedSnapshot(studentId, seed),
  );

  const markViewed = useCallback(
    (documentId: string) => {
      if (getSnapshot(studentId, seed).get(documentId)) {
        return; // déjà consulté (seed ou override) : rien à faire.
      }
      const overrides = parseOverrides(readRaw(studentId));
      overrides[documentId] = new Date().toISOString();
      writeOverrides(studentId, overrides);
    },
    [studentId, seed],
  );

  const getStatus = useCallback(
    (documentId: string): DocumentStatus =>
      viewedMap.get(documentId) ? "consulté" : "nouveau",
    [viewedMap],
  );

  return { getStatus, markViewed };
}
