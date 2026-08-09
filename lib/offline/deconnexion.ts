import type { DepotOffline } from "@/lib/offline/depot";

/**
 * HORS LIGNE — LA DÉCONNEXION.
 *
 * ════════════════════════════════════════════════════════════════════════
 * SE DÉCONNECTER NE DOIT JAMAIS JETER UNE SÉANCE
 * ════════════════════════════════════════════════════════════════════════
 * Un téléphone peut servir à deux élèves : ce qui reste sur le disque après
 * un départ doit être NUL pour ce compte. La purge est donc la règle.
 *
 * Sauf qu'une opération en attente n'est pas un cache. C'est une séance
 * réellement faite, que le serveur n'a jamais reçue. La purger reviendrait à
 * effacer le travail de quelqu'un pour tenir une promesse d'hygiène — et
 * l'élève ne verrait rien : ni erreur, ni avertissement, juste une séance
 * qui n'a jamais existé.
 *
 * D'où deux chemins, et un seul est automatique :
 *
 *   • RIEN EN ATTENTE → purge complète, sans question. Snapshot, brouillons
 *     et préférence d'affichage du compte disparaissent.
 *   • QUELQUE CHOSE EN ATTENTE → on ne supprime RIEN et on rend la main à
 *     l'appelant, qui doit prévenir. La décision appartient à l'élève, pas à
 *     une routine de nettoyage.
 *
 * ════════════════════════════════════════════════════════════════════════
 * ET LE COMPTE B NE TOUCHE JAMAIS À CELUI DE A
 * ════════════════════════════════════════════════════════════════════════
 * Toutes les opérations sont préfixées par l'identifiant du compte
 * (`prefixeCompte`) : la purge de A ne peut pas atteindre B, et le
 * synchronisateur de B ne peut pas vider l'outbox de A — il ne sait même pas
 * l'énumérer (voir `depot.ts`, « aucune lecture sans identifiant »).
 */

export type DecisionDeconnexion =
  /** Tout est parti : le compte ne laisse rien derrière lui. */
  | { etat: "purge" }
  /**
   * Une ou plusieurs séances attendent d'être envoyées. RIEN n'a été
   * supprimé — l'appelant doit prévenir et laisser choisir.
   */
  | { etat: "en_attente"; operations: { sessionId: string; businessDate: string | null }[] };

/**
 * Prépare la déconnexion du compte — et purge SEULEMENT s'il n'y a rien à
 * perdre.
 *
 * N'efface jamais rien quand une opération est en attente : c'est un
 * constat rendu à l'appelant, pas une suppression différée.
 */
export async function preparerDeconnexion(
  depot: DepotOffline,
  userId: string,
): Promise<DecisionDeconnexion> {
  if (userId === "") {
    return { etat: "purge" };
  }
  const enAttente = await depot.operationsEnAttente(userId);
  if (enAttente.length > 0) {
    return {
      etat: "en_attente",
      operations: enAttente.map((operation) => ({
        sessionId: operation.sessionId,
        // La date de la séance telle qu'elle est partie dans le payload —
        // celle du jour de l'entraînement, pas celle d'aujourd'hui.
        businessDate: operation.payload.performedAt ?? null,
      })),
    };
  }
  await depot.purgerTout(userId);
  return { etat: "purge" };
}

/**
 * L'élève a été prévenu et choisit de partir QUAND MÊME.
 *
 * On garde alors ce qui n'a pas encore été envoyé, et on efface le reste :
 * `purgerSaufEnAttente` retire le snapshot et la préférence d'affichage,
 * et ne conserve que les brouillons rattachés à une opération en file.
 *
 * Cette fonction n'existe que pour être appelée APRÈS un avertissement
 * explicite. Elle n'est jamais le chemin par défaut.
 */
export async function deconnecterEnConservantLesEnvois(
  depot: DepotOffline,
  userId: string,
): Promise<{ operationsConservees: number }> {
  if (userId === "") {
    return { operationsConservees: 0 };
  }
  return depot.purgerSaufEnAttente(userId);
}
