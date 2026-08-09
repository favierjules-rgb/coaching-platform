import type { AdminStudentFeedback, WorkoutFeedbackPayload } from "@/types";

import type { DepotOffline } from "@/lib/offline/depot";
import type { OperationOutbox } from "@/lib/offline/schema";

/**
 * HORS LIGNE — LE SYNCHRONISATEUR.
 *
 * ════════════════════════════════════════════════════════════════════════
 * IL NE DÉCIDE PAS DE CE QUI EST VRAI
 * ════════════════════════════════════════════════════════════════════════
 * Ce module ne parle ni à `fetch`, ni à Supabase, ni au DOM. Il reçoit un
 * `Transport` et une horloge, et se contente d'ORDONNANCER : quoi envoyer,
 * dans quel ordre, que faire de chaque réponse, et quand il est permis
 * d'effacer. C'est ce qui rend la partie dangereuse — l'acquittement —
 * exécutable dans Node, sans navigateur et sans serveur.
 *
 * Le chemin d'envoi reste EXACTEMENT celui de l'application en ligne
 * (`POST /api/student/workout-feedback`). Aucun contournement, aucun
 * `service_role`, aucune route « offline » : le serveur et ses déclencheurs
 * restent seuls autoritaires sur `prescribed_snapshot`, `program_id`, le
 * statut coach, `coach_reply`, l'unicité `student_id/session_id` et la
 * revalidation des remplacements.
 *
 * ════════════════════════════════════════════════════════════════════════
 * L'ORDRE EST LA GARANTIE
 * ════════════════════════════════════════════════════════════════════════
 * Pour chaque opération :
 *
 *   1. capturer `operationId`, `revision` et `payload` — figés ici, ils ne
 *      seront plus relus pendant le voyage ;
 *   2. envoyer par le chemin serveur existant ;
 *   3. attendre le succès ;
 *   4. RELIRE l'état autoritatif du serveur ;
 *   5. reconstruire la copie locale à partir de cette relecture ;
 *   6. `acquitterSiInchange(revision capturée)` ;
 *   7. l'effacement n'a lieu QUE si la révision présente est encore celle
 *      qui est partie.
 *
 * Inverser 4 et 6 — effacer sur la seule réponse HTTP — laisserait, en cas
 * d'échec de relecture, un élève sans opération en attente ET sans état à
 * jour : persuadé que c'est parti, sans moyen de le vérifier.
 *
 * ════════════════════════════════════════════════════════════════════════
 * LA COURSE A → B
 * ════════════════════════════════════════════════════════════════════════
 * L'élève corrige sa séance pendant que le POST de A voyage. L'outbox passe
 * en révision B. Le serveur confirme A. Effacer ici supprimerait B — une
 * correction que l'élève croit enregistrée, disparue sans un mot.
 *
 * `acquitterSiInchange` rend alors `"remplacee"` : A est bien enregistré
 * côté serveur, B reste en file, et repart au flush suivant. C'est la seule
 * issue correcte, et elle est vérifiée par un test qui fabrique la course.
 */

/* ════════════════════════════════════════════════════════════════════════
 * I. CE QUE LE MONDE EXTÉRIEUR DOIT FOURNIR
 * ════════════════════════════════════════════════════════════════════════ */

/**
 * La réponse du serveur, réduite à ce qui change la conduite à tenir.
 *
 * Quatre cas, et pas un de moins : confondre « le réseau a coupé » avec
 * « le serveur a refusé ce retour » conduirait soit à réessayer sans fin une
 * requête qui sera toujours refusée, soit à compter comme échec métier une
 * simple perte de réseau.
 */
export type ReponseServeur =
  | { etat: "succes" }
  /** Pas de réseau, requête interrompue, serveur injoignable. */
  | { etat: "reseau"; message?: string }
  /** Session expirée : l'élève doit se reconnecter. L'outbox est intouchable. */
  | { etat: "auth" }
  /** Le serveur a compris et a REFUSÉ (validation, remplacement devenu invalide…). */
  | { etat: "metier"; message: string };

export interface Transport {
  /** Envoie par le chemin serveur EXISTANT. */
  envoyer(payload: WorkoutFeedbackPayload): Promise<ReponseServeur>;
  /**
   * Relit l'état autoritatif du serveur pour cette séance.
   *
   * `null` est une réponse valide (aucun retour côté serveur) ; une panne de
   * lecture doit LEVER, pour que l'acquittement n'ait pas lieu.
   */
  relire(sessionId: string): Promise<AdminStudentFeedback | null>;
}

export interface OptionsSynchronisation {
  depot: DepotOffline;
  /** Id Auth du compte connecté — voir `lib/offline/identite.ts`. */
  userId: string;
  transport: Transport;
  maintenant?: () => number;
  /**
   * SERVER WINS — reconstruit la copie locale depuis l'état relu.
   *
   * Appelé APRÈS une relecture réussie et AVANT l'acquittement. Il ne touche
   * jamais la saisie de l'élève : il met à jour ce que le dépôt garde de
   * l'état SERVEUR (le retour existant du snapshot).
   */
  surEtatServeur?: (sessionId: string, feedback: AdminStudentFeedback | null) => Promise<void> | void;
}

/* ════════════════════════════════════════════════════════════════════════
 * II. CE QUE LA SYNCHRONISATION REND
 * ════════════════════════════════════════════════════════════════════════ */

export type SortieOperation =
  | "acquittee"
  /** Envoyée et confirmée, mais une révision plus récente attend déjà. */
  | "remplacee"
  | "conservee_reseau"
  | "conservee_auth"
  | "conservee_metier"
  /** La relecture autoritative a échoué : on ne sait pas, donc on ne touche à rien. */
  | "conservee_relecture";

export interface BilanOperation {
  sessionId: string;
  operationId: string;
  revision: number;
  sortie: SortieOperation;
  message?: string;
}

export type BilanSynchronisation =
  | { etat: "deja_en_cours" }
  | { etat: "rien_a_faire" }
  | { etat: "termine"; operations: BilanOperation[] };

/* ════════════════════════════════════════════════════════════════════════
 * III. LE VERROU
 * ════════════════════════════════════════════════════════════════════════
 * Les déclencheurs sont nombreux et se chevauchent : démarrage de
 * l'application, événement `online`, `visibilitychange` → visible, ouverture
 * de la séance. Sortir du métro déclenche facilement les trois derniers dans
 * la même seconde.
 *
 * Sans verrou, deux flux liraient la même opération et l'enverraient deux
 * fois. Le serveur est idempotent par `operationId`, mais le second
 * acquittement porterait sur un état que le premier a déjà modifié — et
 * c'est exactement le genre de course qui, un jour, efface une correction.
 *
 * Le verrou est PAR COMPTE : deux comptes sur le même téléphone ne se
 * bloquent pas l'un l'autre, et l'outbox de A n'est jamais vidée pendant que
 * B est connecté.
 *
 * Il est volontairement local au processus. `navigator.locks` couvrirait
 * plusieurs onglets, mais Background Sync et les verrous inter-onglets
 * ajouteraient une dépendance de plateforme là où la primitive vraiment
 * protectrice est ailleurs : `acquitterSiInchange`, qui reste correcte même
 * si deux onglets envoient en même temps.
 */
const verrous = new Set<string>();

/** Pour les tests : y a-t-il un flush en cours pour ce compte ? */
export function flushEnCours(userId: string): boolean {
  return verrous.has(userId);
}

/* ════════════════════════════════════════════════════════════════════════
 * IV. LA SYNCHRONISATION
 * ════════════════════════════════════════════════════════════════════════ */

export async function synchroniser(
  options: OptionsSynchronisation,
): Promise<BilanSynchronisation> {
  const { depot, userId, transport } = options;
  const maintenant = options.maintenant ?? (() => Date.now());

  if (userId === "") {
    return { etat: "rien_a_faire" };
  }
  if (verrous.has(userId)) {
    return { etat: "deja_en_cours" };
  }
  verrous.add(userId);

  try {
    const enAttente = await depot.operationsEnAttente(userId);
    if (enAttente.length === 0) {
      return { etat: "rien_a_faire" };
    }

    const operations: BilanOperation[] = [];
    for (const operation of enAttente) {
      const bilan = await envoyerUne(operation);
      operations.push(bilan);
      // Réseau coupé ou session expirée : la suite échouerait de la même
      // façon. On s'arrête — les opérations restantes ne sont pas touchées
      // et repartiront au prochain déclencheur.
      if (bilan.sortie === "conservee_reseau" || bilan.sortie === "conservee_auth") {
        break;
      }
    }
    return { etat: "termine", operations };
  } finally {
    verrous.delete(userId);
  }

  async function envoyerUne(operation: OperationOutbox): Promise<BilanOperation> {
    // ── 1. CAPTURE ────────────────────────────────────────────────────
    // Figés maintenant. Tout ce qui suit raisonne sur ces valeurs, jamais
    // sur une relecture de l'outbox : c'est ce qui rend la course A → B
    // détectable au lieu d'être subie.
    const { sessionId, operationId, revision, payload } = operation;
    const base = { sessionId, operationId, revision };

    // ── 2 & 3. ENVOI PAR LE CHEMIN SERVEUR EXISTANT ───────────────────
    const reponse = await transport.envoyer(payload);

    if (reponse.etat === "reseau") {
      // Ni `attempts`, ni `lastError` : une coupure de réseau n'est pas un
      // échec de CE retour. Gonfler le compteur dans un tunnel donnerait,
      // au bout de trois stations, une opération qui a l'air condamnée.
      return { ...base, sortie: "conservee_reseau", message: reponse.message };
    }
    if (reponse.etat === "auth") {
      // L'outbox est conservée telle quelle. Une session expirée se règle
      // par une reconnexion, jamais en jetant une séance.
      return { ...base, sortie: "conservee_auth" };
    }
    if (reponse.etat === "metier") {
      // Le serveur a compris et refusé — remplacement devenu invalide,
      // validation en échec. L'opération RESTE et dit pourquoi.
      await depot.marquerEchec(userId, sessionId, reponse.message, maintenant());
      return { ...base, sortie: "conservee_metier", message: reponse.message };
    }

    // ── 4. RELECTURE AUTORITATIVE ─────────────────────────────────────
    let etatServeur: AdminStudentFeedback | null;
    try {
      etatServeur = await transport.relire(sessionId);
    } catch (erreur) {
      // On ne sait pas ce que le serveur a retenu : on n'efface rien. Le
      // prochain envoi sera idempotent grâce à `operationId`.
      const message = erreur instanceof Error ? erreur.message : "relecture impossible";
      await depot.marquerEchec(userId, sessionId, `relecture : ${message}`, maintenant());
      return { ...base, sortie: "conservee_relecture", message };
    }

    // ── 5. SERVER WINS ────────────────────────────────────────────────
    // La copie locale de l'état SERVEUR est reconstruite ici, avant tout
    // acquittement — et sans jamais toucher la saisie en cours de l'élève.
    await options.surEtatServeur?.(sessionId, etatServeur);

    // ── 6 & 7. ACQUITTEMENT CONDITIONNEL ──────────────────────────────
    const issue = await depot.acquitterSiInchange(userId, sessionId, revision);
    if (issue === "remplacee") {
      // A est enregistré côté serveur ; B attend toujours et repartira.
      return { ...base, sortie: "remplacee" };
    }
    return { ...base, sortie: "acquittee" };
  }
}
