/**
 * GARDE DE RÉENTRANCE — « une seule sauvegarde à la fois ».
 *
 * ════════════════════════════════════════════════════════════════════════
 * POURQUOI CE MODULE EXISTE
 * ════════════════════════════════════════════════════════════════════════
 * Le builder pouvait lancer PLUSIEURS sauvegardes simultanées. Le bouton
 * « Enregistrer » était bien désactivé pendant `saveStatus === "saving"`,
 * mais le raccourci Cmd/Ctrl+S, lui, appelait `handleSave()` sans aucune
 * condition. Une sauvegarde complète coûtant `7·N + 12` requêtes dont
 * `7·N + 3` STRICTEMENT SÉQUENTIELLES (une RPC par séance, attendue), K
 * appuis lancent K sauvegardes qui se disputent la même file : le coût est
 * multiplié par K, et douze appuis suffisent à transformer 15 s en trois
 * minutes.
 *
 * ────────────────────────────────────────────────────────────────────────
 * ⚠️ POURQUOI UN DRAPEAU, ET NON L'ÉTAT REACT `saveStatus`
 * ────────────────────────────────────────────────────────────────────────
 * Deux raisons, et chacune suffit :
 *
 *   1. `setSaveStatus("saving")` est ASYNCHRONE. Deux appels dans le même
 *      tic lisent tous deux l'ancienne valeur et passent tous deux la garde.
 *      Ce drapeau est posé de façon SYNCHRONE, avant le premier `await`.
 *
 *   2. L'écouteur `keydown` du builder capture ses valeurs à l'inscription,
 *      et sa liste de dépendances exclut délibérément `saveStatus` (voir
 *      ProgramBuilderFullscreen). Une garde qui lirait cet état lirait donc
 *      une valeur PÉRIMÉE — exactement le piège que ce module évite.
 *
 * ⚠️ IL NE MET RIEN EN FILE D'ATTENTE. Un appui pendant une sauvegarde est
 * IGNORÉ, pas différé : rejouer la sauvegarde à la fin écrirait un état que
 * le coach n'a pas demandé d'écrire à ce moment-là, et relancerait les
 * `7·N + 12` requêtes qu'on cherche précisément à ne pas doubler. Le refus
 * est explicite (`"deja-en-cours"`) pour que l'appelant puisse le distinguer
 * d'un échec.
 *
 * ⚠️ LE DRAPEAU EST TOUJOURS RELÂCHÉ, y compris si l'action LÈVE. Sans le
 * `finally`, une seule sauvegarde en erreur condamnerait définitivement le
 * bouton et le raccourci.
 */

/** Ce que rend la garde quand une exécution est déjà en cours. */
export const DEJA_EN_COURS = "deja-en-cours";

export interface GardeDeSauvegarde {
  /**
   * Exécute `action`, SAUF si une exécution est déjà en cours — auquel cas
   * `DEJA_EN_COURS` est rendu sans que `action` soit appelée.
   */
  executer: <T>(action: () => Promise<T>) => Promise<T | typeof DEJA_EN_COURS>;
  /** `true` entre le début et la fin d'une exécution. Lecture seule. */
  readonly enCours: boolean;
}

export function creerGardeDeSauvegarde(): GardeDeSauvegarde {
  let enCours = false;
  return {
    async executer(action) {
      if (enCours) return DEJA_EN_COURS;
      enCours = true;
      try {
        return await action();
      } finally {
        enCours = false;
      }
    },
    get enCours() {
      return enCours;
    },
  };
}
