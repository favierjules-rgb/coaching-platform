import type { AdminProgram } from "@/types";
import { messageRefusAutorisation } from "@/lib/messages-autorisation";

/**
 * Orchestration PURE du flux de sauvegarde du builder de programme (Lot 3B).
 *
 * Extrait hors React pour être testable directement : le composant/page ne fait
 * qu'appeler `orchestrateBuilderSave`, puis applique `nextBuilderState` au
 * couple { program, revision } qu'il possède. AUCUN état React ici.
 *
 * Pourquoi une révision contrôlée plutôt que `program.updatedAt` comme `key` :
 * la RPC met à jour `workout_sessions.updated_at`, PAS forcément
 * `programs.updated_at` — une sauvegarde de séance pourrait donc réussir sans
 * changer `program.updatedAt`, et un STALE pourrait au contraire changer la
 * version serveur et déclencher un remount non désiré effaçant les
 * modifications locales. On remonte donc UNIQUEMENT sur un succès réel
 * (sauvegarde OK + refetch OK), via un compteur incrémenté explicitement.
 */

export type BuilderSaveOutcome =
  | { kind: "success"; freshProgram: AdminProgram }
  | { kind: "stale" }
  | { kind: "refetch-failed" }
  | { kind: "error"; error: unknown };

/** Vrai si l'erreur est un conflit optimiste STALE_TRAINING_SESSION propagé par la RPC. */
export function isStaleTrainingSessionError(error: unknown): boolean {
  return error instanceof Error && error.message.includes("STALE_TRAINING_SESSION");
}

/**
 * Exécute la sauvegarde puis, en cas de succès réel, recharge le programme.
 * - `save()` lève sur STALE (contrat `updateProgram`) → `{ stale }`.
 * - `save()` renvoie `false` (échec non-STALE) → `{ error }`.
 * - `refetch()` renvoie `null` (échec / aucune donnée) → `{ refetch-failed }`.
 * - sinon → `{ success, freshProgram }`.
 * Le refetch n'est JAMAIS lancé si la sauvegarde n'a pas réussi.
 */
export async function orchestrateBuilderSave(deps: {
  save: () => Promise<boolean>;
  refetch: () => Promise<AdminProgram | null>;
}): Promise<BuilderSaveOutcome> {
  let ok: boolean;
  try {
    ok = await deps.save();
  } catch (error) {
    if (isStaleTrainingSessionError(error)) return { kind: "stale" };
    return { kind: "error", error };
  }
  if (!ok) return { kind: "error", error: new Error("SAVE_FAILED") };

  const freshProgram = await deps.refetch();
  if (!freshProgram) return { kind: "refetch-failed" };
  return { kind: "success", freshProgram };
}

/**
 * Message UTILE pour le coach selon l'issue (incident du 02/08 : trois échecs
 * « NOT_AUTHORIZED » derrière un libellé générique — la session du navigateur
 * était passée sur le compte élève de test). `null` = garder le libellé
 * générique. L'erreur technique complète part en console (dev), jamais ici.
 */
export function builderSaveUserMessage(outcome: BuilderSaveOutcome): string | null {
  if (outcome.kind === "stale") {
    return "Séance modifiée depuis le chargement — recharge la page puis réapplique tes modifications.";
  }
  if (outcome.kind === "refetch-failed") {
    return "Enregistré, mais le rechargement a échoué — recharge la page pour vérifier l'état.";
  }
  if (outcome.kind === "error") {
    const message = outcome.error instanceof Error ? outcome.error.message : "";
    // Incident du 25/08 : une lecture tronquée faisait sauter des séances, et
    // l'enregistrement se déclarait réussi. Ce cas a désormais son propre code
    // ET son propre message — le traiter comme un « SAVE_FAILED » enverrait le
    // coach vérifier ses droits, ce qui n'a rien à voir.
    if (message.startsWith("STRUCTURE_INCOMPLETE")) {
      return "Une partie du programme n'a pas pu être enregistrée. Recharge la page et vérifie le contenu avant de réessayer — n'enregistre pas par-dessus.";
    }
    /*
     * ⚠️ L'ANCIEN MESSAGE POSAIT UN DIAGNOSTIC FAUX. Il disait « ta session n'a
     * plus les droits coach » et demandait de se reconnecter en admin. Depuis
     * P13-B, le cas courant n'est plus une session perdue : c'est un
     * collaborateur qui n'a pas `entrainement / ecriture`. Se reconnecter ne
     * lui donnera jamais ce droit, et le message l'envoyait chercher au
     * mauvais endroit.
     *
     * Le texte est désormais celui de la nutrition, au mot près — même refus,
     * même formulation. Le code technique (`NOT_AUTHORIZED`, `42501`…) reste
     * dans `outcome.error` et en console : il n'est simplement plus affiché.
     */
    const refus = messageRefusAutorisation(message, "programme");
    if (refus) return refus;
  }
  return null;
}

export interface BuilderState {
  program: AdminProgram;
  revision: number;
}

/**
 * Transition d'état PURE de la page. Seul un `success` remplace le snapshot et
 * incrémente la révision (⇒ un unique remount). STALE / refetch-failed / error
 * laissent l'état LOCAL inchangé (aucun remount, modifications non enregistrées
 * conservées). L'incrément de révision ne dépend PAS de `program.updatedAt`.
 */
export function nextBuilderState(state: BuilderState, outcome: BuilderSaveOutcome): BuilderState {
  if (outcome.kind === "success") {
    return { program: outcome.freshProgram, revision: state.revision + 1 };
  }
  return state;
}
