import type { AdminProgram } from "@/types";
import { messageRefusAutorisation } from "@/lib/messages-autorisation";
import { EchecEnregistrementGroupe } from "@/lib/supabase/training-program-save";

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

/**
 * Vrai si l'erreur est un conflit optimiste propagé par la RPC.
 *
 * ⚠️ DEUX FORMES, ET LA SECONDE EST NOUVELLE. Le moteur par séance lève
 * `STALE_TRAINING_SESSION` nu ; la RPC groupée la préfixe par la séance fautive
 * (`SESSION_FAILED <clé>: STALE_TRAINING_SESSION`), donc `includes` reste le bon
 * test. S'y ajoute `STALE_TRAINING_PROGRAM` — le verrou de TÊTE, qui n'existait
 * pas : deux coachs sur la même programmation, le dernier écrivait en silence.
 * Les deux mènent au même conseil (recharger), donc au même état `stale`.
 */
export function isStaleTrainingSessionError(error: unknown): boolean {
  if (error instanceof EchecEnregistrementGroupe) {
    return error.cause === "seance_perimee" || error.cause === "tete_perimee";
  }
  return (
    error instanceof Error &&
    (error.message.includes("STALE_TRAINING_SESSION") || error.message.includes("STALE_TRAINING_PROGRAM"))
  );
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
    /*
     * ⚠️ CE N'EST PAS UN ÉCHEC D'ENREGISTREMENT, ET LE MESSAGE NE DOIT PAS LE
     * LAISSER CROIRE. La transaction est COMMITÉE : les écritures sont en base.
     * Ce qui a échoué, c'est la relecture qui aurait rapatrié les identifiants
     * réels et les nouveaux `updated_at`. L'état affiché est donc périmé, et
     * c'est pour cela que la page interdit une nouvelle sauvegarde jusqu'à une
     * resynchronisation — pas parce que quelque chose aurait mal tourné.
     */
    return "Enregistré. En revanche la synchronisation avec le serveur a échoué : resynchronise avant de modifier à nouveau.";
  }
  if (outcome.kind === "error") {
    /*
     * LES CAUSES DE LA RPC GROUPÉE D'ABORD — elles sont TYPÉES, donc fiables,
     * là où la lecture du texte de l'erreur est une heuristique.
     *
     * ⚠️ `delai_depasse` A SON PROPRE MESSAGE, ET C'EST TOUT L'ENJEU DU
     * CHANTIER. Un dépassement de `statement_timeout` (57014) rangé avec les
     * refus de droits enverrait le coach vérifier ses autorisations alors que
     * l'opération était seulement trop longue — et, surtout, masquerait un
     * échec de performance derrière un faux diagnostic. Il est nommé pour ce
     * qu'il est. Rien n'a été écrit : la transaction a été annulée en entier.
     */
    if (outcome.error instanceof EchecEnregistrementGroupe) {
      const seance = outcome.error.seance ? ` (séance ${outcome.error.seance})` : "";
      switch (outcome.error.cause) {
        case "delai_depasse":
          return `L'enregistrement a dépassé le temps autorisé par le serveur${seance}. Aucune modification n'a été enregistrée — réessaie, et signale-le si cela se reproduit.`;
        case "tete_non_ecrivable":
        case "non_autorise":
          return messageRefusAutorisation("NOT_AUTHORIZED", "programme") ?? null;
        case "programme_introuvable":
          return "Cette programmation est introuvable ou n'est plus dans ton périmètre. Recharge la page.";
        case "semaine_refusee":
          return `Une semaine n'a pas pu être créée${seance}. Aucune modification n'a été enregistrée — recharge la page et réessaie.`;
        case "seance_refusee":
          return `Une séance a été refusée par le serveur${seance}. Aucune modification n'a été enregistrée — recharge la page et vérifie son contenu.`;
        case "charge_invalide":
          return `Le contenu envoyé a été refusé${seance}. Aucune modification n'a été enregistrée — recharge la page et réessaie.`;
        default:
          break;
      }
    }
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
  /**
   * « La sauvegarde a réussi, la relecture non. » L'état affiché est périmé :
   * ses `updatedAt` de séance ne valent plus comme verrous optimistes, et les
   * prescriptions que le serveur vient de CRÉER portent encore, côté client,
   * des identifiants temporaires `new-prescription:…` dont la correspondance
   * n'est jamais arrivée. Tant que ce drapeau est levé, aucune nouvelle
   * sauvegarde ne doit partir.
   */
  desynchronise: boolean;
}

/**
 * Transition d'état PURE de la page.
 *
 * - `success`        → remplace l'instantané, incrémente la révision (⇒ UN
 *                      remount depuis les données fraîches), lève la
 *                      désynchronisation.
 * - `refetch-failed` → GARDE le même objet programme et la MÊME révision (⇒
 *                      aucun remount, modifications locales conservées) et
 *                      lève le drapeau `desynchronise`.
 * - `stale` / `error`→ état inchangé.
 *
 * L'incrément de révision ne dépend PAS de `program.updatedAt` : la RPC bumpe
 * `workout_sessions.updated_at`, pas forcément `programs.updated_at`.
 */
export function nextBuilderState(state: BuilderState, outcome: BuilderSaveOutcome): BuilderState {
  if (outcome.kind === "success") {
    return { program: outcome.freshProgram, revision: state.revision + 1, desynchronise: false };
  }
  if (outcome.kind === "refetch-failed") {
    // ⚠️ MÊME RÉFÉRENCE D'OBJET ET MÊME RÉVISION, volontairement : c'est ce qui
    // garantit que la `key` du builder ne change pas et qu'il n'est pas démonté.
    return { program: state.program, revision: state.revision, desynchronise: true };
  }
  return state;
}

/**
 * Pourquoi une sauvegarde est refusée AVANT d'atteindre le réseau, ou `null`
 * si elle peut partir.
 *
 * ════════════════════════════════════════════════════════════════════════════
 * ⚠️ POURQUOI UNE GARDE CLIENTE ALORS QUE LE VERROU SERVEUR EXISTE DÉJÀ
 * ════════════════════════════════════════════════════════════════════════════
 * Le verrou optimiste refuserait bien la seconde sauvegarde (`updatedAt`
 * périmé ⇒ `STALE_TRAINING_SESSION`), et c'est ce qui protège les données
 * aujourd'hui. Mais s'en contenter a trois défauts :
 *
 *   1. le coach reçoit « séance modifiée depuis le chargement », un diagnostic
 *      FAUX : personne n'a modifié la séance, c'est son propre enregistrement
 *      qui n'a pas été relu ;
 *   2. la protection repose sur une COÏNCIDENCE — que `updated_at` ait bougé.
 *      Une sauvegarde qui n'aurait touché que des lignes dont le contenu était
 *      identique laisserait les `updated_at` en place (les gardes
 *      `is distinct from` du lot D n'écrivent pas pour rien), et le verrou ne
 *      se déclencherait pas ;
 *   3. surtout — les prescriptions créées par la sauvegarde existent en base,
 *      mais l'état local porte encore leurs identifiants TEMPORAIRES. Une
 *      seconde sauvegarde qui passerait le verrou les RÉINSÉRERAIT : doublons.
 *
 * La garde cliente est donc la protection PRINCIPALE, et le verrou serveur le
 * filet. C'est aussi la raison pour laquelle `id_mapping` n'est PAS branché
 * dans la machine à états : la réconciliation reste la relecture, et son échec
 * est traité en interdisant l'écriture, pas en devinant les correspondances.
 */
export function refusPourDesynchronisation(state: Pick<BuilderState, "desynchronise">): string | null {
  if (!state.desynchronise) return null;
  return "Rien n'a été envoyé : le dernier enregistrement a réussi mais n'a pas pu être relu. Resynchronise l'état serveur avant de modifier à nouveau.";
}

export type BuilderResyncOutcome =
  | { kind: "success"; freshProgram: AdminProgram }
  | { kind: "failed" };

/**
 * Relecture explicite, déclenchée par le coach depuis l'interface. C'est la
 * SEULE sortie de l'état désynchronisé : elle rapatrie les identifiants
 * réellement persistés et les `updatedAt` à jour.
 */
export async function orchestrateBuilderResync(deps: {
  refetch: () => Promise<AdminProgram | null>;
}): Promise<BuilderResyncOutcome> {
  let frais: AdminProgram | null;
  try {
    frais = await deps.refetch();
  } catch {
    return { kind: "failed" };
  }
  if (!frais) return { kind: "failed" };
  return { kind: "success", freshProgram: frais };
}

/**
 * Transition PURE après une resynchronisation. Un succès se comporte EXACTEMENT
 * comme un succès de sauvegarde — nouvel instantané, révision incrémentée, donc
 * remount du builder depuis les données serveur : les identifiants temporaires
 * disparaissent avec l'ancien état. Un échec laisse tout en place, drapeau
 * compris : on ne sort pas de la désynchronisation sans données fraîches.
 */
export function nextBuilderStateApresResync(state: BuilderState, outcome: BuilderResyncOutcome): BuilderState {
  if (outcome.kind === "success") {
    return { program: outcome.freshProgram, revision: state.revision + 1, desynchronise: false };
  }
  return state;
}

/**
 * Ce que la page rend au builder : l'issue, le message, et le drapeau de
 * désynchronisation (qui décide de la couleur et de l'action affichées).
 */
export interface ResultatPourBuilder {
  ok: boolean;
  userMessage?: string | null;
  desynchronise?: boolean;
}

/**
 * ════════════════════════════════════════════════════════════════════════════
 * LE GESTIONNAIRE DE SAUVEGARDE DE LA PAGE, EXTRAIT HORS DE REACT.
 * ════════════════════════════════════════════════════════════════════════════
 * La page ne fait plus que deux choses : fournir `save`/`refetch`, et appliquer
 * l'état rendu. TOUTE la décision est ici, donc testable DIRECTEMENT — les
 * tests appellent cette fonction, pas une copie de sa logique.
 *
 * ⚠️ L'ORDRE DES DEUX PREMIÈRES LIGNES EST LE CŒUR DE LA GARANTIE. Le refus
 * pour désynchronisation est évalué AVANT `save`, donc `save` n'est jamais
 * appelé dans cet état : aucune requête ne part, aucun `expectedUpdatedAt`
 * périmé n'atteint le serveur, et aucune prescription déjà créée ne peut être
 * réinsérée. Inverser ces deux lignes casserait la protection sans casser
 * aucun type — d'où le test qui compte les appels à `save`.
 *
 * `etat` est rendu PAR RÉFÉRENCE quand rien ne change, pour que l'appelant
 * puisse éviter un `setState` inutile (et donc un rendu inutile).
 */
export async function executerSauvegardeDeLaPage(args: {
  etat: BuilderState;
  save: () => Promise<boolean>;
  refetch: () => Promise<AdminProgram | null>;
}): Promise<{ etat: BuilderState; resultat: ResultatPourBuilder; outcome: BuilderSaveOutcome | null }> {
  const refus = refusPourDesynchronisation(args.etat);
  if (refus) {
    return {
      etat: args.etat,
      resultat: { ok: false, userMessage: refus, desynchronise: true },
      // `null` : il n'y a pas eu d'appel, donc pas d'issue à rapporter.
      outcome: null,
    };
  }

  const outcome = await orchestrateBuilderSave({ save: args.save, refetch: args.refetch });
  const etat = nextBuilderState(args.etat, outcome);

  if (outcome.kind === "success") {
    return { etat, resultat: { ok: true }, outcome };
  }
  if (outcome.kind === "refetch-failed") {
    return {
      etat,
      resultat: { ok: false, userMessage: builderSaveUserMessage(outcome), desynchronise: true },
      outcome,
    };
  }
  return { etat, resultat: { ok: false, userMessage: builderSaveUserMessage(outcome) }, outcome };
}

/** Pendant de `executerSauvegardeDeLaPage` pour la resynchronisation. */
export async function executerResynchronisationDeLaPage(args: {
  etat: BuilderState;
  refetch: () => Promise<AdminProgram | null>;
}): Promise<{ etat: BuilderState; ok: boolean }> {
  const outcome = await orchestrateBuilderResync({ refetch: args.refetch });
  return { etat: nextBuilderStateApresResync(args.etat, outcome), ok: outcome.kind === "success" };
}

/**
 * LA DÉRIVATION DU PROGRAMME AFFICHÉ, extraite de la page pour être testable.
 *
 * ⚠️ C'EST L'EXPRESSION QUI A CAUSÉ LA PERTE DE TRAVAIL. Quand elle rendait
 * `undefined`, la page affichait « Programme introuvable. » et démontait le
 * builder avec les modifications en cours. Deux protections indépendantes la
 * tiennent désormais définie après un échec de relecture :
 *   1. `useSupabaseProgram.refetch` ne remplace plus le cache par `null` ;
 *   2. la page ÉPINGLE l'instantané de la sauvegarde dans `savedProgram`.
 * Chacune suffit seule — c'est volontaire, et les deux sont testées séparément.
 */
export function programmeActifDeLaPage(
  savedProgram: AdminProgram | null,
  cacheProgram: AdminProgram | null | undefined,
  programId: string,
): AdminProgram | undefined {
  const derive = cacheProgram ?? undefined;
  return savedProgram && savedProgram.id === programId ? savedProgram : derive;
}
