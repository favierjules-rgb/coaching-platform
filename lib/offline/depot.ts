import type { WorkoutFeedbackPayload } from "@/types";

import {
  cleAffichage,
  cleBrouillon,
  cleOutbox,
  cleSnapshot,
  estCompatible,
  estTypeAcces,
  MAGASINS,
  prefixeCompte,
  SCHEMA_VERSION,
  type BrouillonSeance,
  type EtatSynchronisation,
  type NomMagasin,
  type OperationOutbox,
  type PreferenceAffichage,
  type SnapshotSeance,
  type TypeAcces,
} from "@/lib/offline/schema";

/**
 * LE DÉPÔT LOCAL — toutes les opérations métier, aucune API du navigateur.
 *
 * ════════════════════════════════════════════════════════════════════════
 * POURQUOI CE FICHIER NE CONNAÎT PAS INDEXEDDB
 * ════════════════════════════════════════════════════════════════════════
 * Il parle à un `MoteurStockage` : quatre méthodes, rien de plus.
 * `lib/offline/idb.ts` en fournit l'implémentation IndexedDB pour le
 * navigateur ; `MoteurMemoire`, ici même, en fournit une pour les tests.
 *
 * Ce n'est pas de l'abstraction pour le plaisir. Sans elle, la seule façon
 * de vérifier « le compte B ne lit jamais les données du compte A » serait
 * d'installer un faux IndexedDB complet — beaucoup de code de test pour
 * prouver quelque chose qui ne dépend pas d'IndexedDB. Avec elle, la règle
 * se vérifie sur le comportement réel, dans Node, en quelques lignes.
 *
 * ════════════════════════════════════════════════════════════════════════
 * AUCUNE LECTURE SANS IDENTIFIANT DE COMPTE
 * ════════════════════════════════════════════════════════════════════════
 * Il n'existe dans ce fichier aucune méthode qui rende des enregistrements
 * sans qu'un `userId` ait été fourni. Ce n'est pas un filtre appliqué après
 * coup : la clé commence par l'identifiant, et chaque lecture revérifie
 * ensuite le contenu (`estCompatible`). Deux barrières, parce que la
 * première pourrait un jour être contournée par une clé construite ailleurs.
 */

/** Une lecture demandée au début d'une transaction. */
export interface Lecture {
  magasin: NomMagasin;
  cle: string;
}

/** Une écriture décidée à partir de ces lectures. */
export type Ecriture =
  | { type: "ecrire"; magasin: NomMagasin; cle: string; valeur: unknown }
  | { type: "supprimer"; magasin: NomMagasin; cle: string };

/**
 * Décide quoi écrire À PARTIR de ce qui vient d'être lu.
 *
 * SYNCHRONE, et ce n'est pas un détail de style. IndexedDB valide une
 * transaction dès qu'il n'a plus de requête en attente : un simple `await`
 * sur autre chose qu'une requête IDB — un `fetch`, un `setTimeout`, une
 * promesse quelconque — rend la main à la boucle d'événements, la
 * transaction se referme, et la requête suivante lève
 * `TransactionInactiveError`. Sur Safari, en production, chez un élève.
 *
 * Rendre ce rappel synchrone rend la faute IMPOSSIBLE À ÉCRIRE : il n'y a
 * pas de `await` disponible entre les lectures et les écritures.
 */
export type Decision = (lues: readonly unknown[]) => readonly Ecriture[];

/** Le peu qu'un moteur de stockage doit savoir faire. */
export interface MoteurStockage {
  lire(magasin: NomMagasin, cle: string): Promise<unknown>;
  ecrire(magasin: NomMagasin, cle: string, valeur: unknown): Promise<void>;
  supprimer(magasin: NomMagasin, cle: string): Promise<void>;
  /** Toutes les clés d'un magasin. Réservé aux purges — jamais à un affichage. */
  cles(magasin: NomMagasin): Promise<string[]>;
  /**
   * LIT puis ÉCRIT dans une seule transaction.
   *
   * Ce n'est pas une commodité : c'est la seule façon d'écrire le brouillon
   * final et l'opération à envoyer sans risquer l'entre-deux. Un retour
   * enregistré localement mais absent de la file d'attente ne partirait
   * jamais ; une file d'attente sans brouillon renverrait l'élève sur un
   * formulaire vide. Aucun `try/catch` n'empêche ces états — seule une
   * transaction le fait.
   *
   * C'est aussi ce qui rend le « lire, comparer, écrire » sûr entre deux
   * fenêtres de l'application : les transactions d'écriture portant sur les
   * mêmes magasins sont sérialisées par la base. Un verrou JavaScript ne
   * protégerait qu'une seule fenêtre.
   */
  transaction(
    magasins: readonly NomMagasin[],
    lectures: readonly Lecture[],
    decider: Decision,
  ): Promise<void>;
}

/** Moteur en mémoire — utilisé par les tests, jamais en production. */
export class MoteurMemoire implements MoteurStockage {
  private readonly donnees = new Map<NomMagasin, Map<string, unknown>>();

  private table(magasin: NomMagasin): Map<string, unknown> {
    const existante = this.donnees.get(magasin);
    if (existante) return existante;
    const neuve = new Map<string, unknown>();
    this.donnees.set(magasin, neuve);
    return neuve;
  }

  async lire(magasin: NomMagasin, cle: string): Promise<unknown> {
    // Copie profonde : IndexedDB stocke une COPIE structurée. Rendre la même
    // référence laisserait un appelant modifier le contenu du dépôt sans
    // écrire — un test passerait alors pour de mauvaises raisons.
    const valeur = this.table(magasin).get(cle);
    return valeur === undefined ? undefined : structuredClone(valeur);
  }

  async ecrire(magasin: NomMagasin, cle: string, valeur: unknown): Promise<void> {
    this.table(magasin).set(cle, structuredClone(valeur));
  }

  async supprimer(magasin: NomMagasin, cle: string): Promise<void> {
    this.table(magasin).delete(cle);
  }

  async cles(magasin: NomMagasin): Promise<string[]> {
    return Array.from(this.table(magasin).keys());
  }

  async transaction(
    magasins: readonly NomMagasin[],
    lectures: readonly Lecture[],
    decider: Decision,
  ): Promise<void> {
    // Copie des tables concernées AVANT d'écrire. Si quoi que ce soit lève,
    // on remet exactement ce qui était là — c'est ce que fait un abort.
    const avant = new Map<NomMagasin, Map<string, unknown>>();
    for (const magasin of magasins) {
      avant.set(magasin, new Map(this.table(magasin)));
    }
    try {
      const lues = lectures.map((l) => {
        const valeur = this.table(l.magasin).get(l.cle);
        return valeur === undefined ? undefined : structuredClone(valeur);
      });
      const decidees = decider(lues);
      // Même garde que dans le moteur IndexedDB : un `decider` devenu
      // asynchrone doit échouer ICI aussi, sinon les tests passeraient sur
      // le double et casseraient dans le navigateur.
      if ((decidees as unknown as { then?: unknown })?.then instanceof Function) {
        throw new Error("decider() doit être SYNCHRONE");
      }
      for (const ecriture of decidees) {
        if (ecriture.type === "ecrire") {
          await this.ecrire(ecriture.magasin, ecriture.cle, ecriture.valeur);
        } else {
          await this.supprimer(ecriture.magasin, ecriture.cle);
        }
      }
    } catch (erreur) {
      for (const [magasin, table] of avant) {
        this.donnees.set(magasin, table);
      }
      throw erreur;
    }
  }

  /** Inspection de test : tout ce qui est stocké, tous magasins confondus. */
  toutPourInspection(): Record<string, Record<string, unknown>> {
    const sortie: Record<string, Record<string, unknown>> = {};
    for (const [magasin, table] of this.donnees) {
      sortie[magasin] = Object.fromEntries(table);
    }
    return sortie;
  }
}

/** Ce que rend une tentative de synchronisation, vue du dépôt. */
export type ResultatEnvoi =
  | { statut: "acquitte" }
  | { statut: "conserve"; raison: string };

export class DepotOffline {
  constructor(private readonly moteur: MoteurStockage) {}

  /* ── Séance du jour ──────────────────────────────────────────────── */

  /**
   * Remplace le snapshot du jour.
   *
   * Appelé UNIQUEMENT après un chargement en ligne complet et valide. Un
   * chargement partiel qui écraserait le snapshot précédent priverait
   * l'élève de sa séance au moment précis où le réseau devient mauvais —
   * c'est-à-dire au pire moment possible.
   */
  async ecrireSnapshot(entree: {
    userId: string;
    businessDate: string;
    sessionId: string;
    payload: unknown;
    maintenant: number;
  }): Promise<void> {
    const enregistrement: SnapshotSeance = {
      schemaVersion: SCHEMA_VERSION,
      userId: entree.userId,
      businessDate: entree.businessDate,
      sessionId: entree.sessionId,
      payload: entree.payload,
      syncedAt: entree.maintenant,
    };
    await this.moteur.ecrire(
      MAGASINS.snapshot,
      cleSnapshot(entree.userId, entree.businessDate),
      enregistrement,
    );
  }

  /** Le snapshot de CE compte pour CETTE date, ou `null`. */
  async lireSnapshot(userId: string, dateMetier: string): Promise<SnapshotSeance | null> {
    const brut = await this.moteur.lire(MAGASINS.snapshot, cleSnapshot(userId, dateMetier));
    if (!estCompatible(brut, userId)) {
      return null;
    }
    return brut as SnapshotSeance;
  }

  /* ── Brouillon ───────────────────────────────────────────────────── */

  /**
   * Enregistre la saisie en cours.
   *
   * REFUSE toute écriture dont la révision n'est pas strictement supérieure
   * à celle déjà en place. C'est ce qui protège de la course la plus banale
   * du chantier : une sauvegarde différée « état A », programmée pendant que
   * l'élève tapait, qui se déclenche après la validation finale « état B ».
   * Elle ferait revenir la séance en arrière, sans erreur, sans trace.
   */
  async ecrireBrouillon(entree: {
    userId: string;
    sessionId: string;
    businessDate: string;
    payload: unknown;
    maintenant: number;
    revision: number;
    syncStatus?: EtatSynchronisation;
  }): Promise<boolean> {
    const existant = await this.lireBrouillon(entree.userId, entree.sessionId);
    if (existant && entree.revision <= existant.revision) {
      return false;
    }
    const enregistrement: BrouillonSeance = {
      schemaVersion: SCHEMA_VERSION,
      userId: entree.userId,
      sessionId: entree.sessionId,
      revision: entree.revision,
      // La date de la SÉANCE ne bouge jamais après la première écriture.
      // Une séance saisie lundi soir et synchronisée mardi matin reste une
      // séance du lundi.
      businessDate: existant?.businessDate ?? entree.businessDate,
      payload: entree.payload,
      updatedAt: entree.maintenant,
      syncStatus: entree.syncStatus ?? "brouillon",
    };
    await this.moteur.ecrire(
      MAGASINS.brouillon,
      cleBrouillon(entree.userId, entree.sessionId),
      enregistrement,
    );
    return true;
  }

  async lireBrouillon(userId: string, sessionId: string): Promise<BrouillonSeance | null> {
    const brut = await this.moteur.lire(MAGASINS.brouillon, cleBrouillon(userId, sessionId));
    if (!estCompatible(brut, userId)) {
      return null;
    }
    const brouillon = brut as BrouillonSeance;
    // Une clé ne suffit pas : on revérifie que le brouillon parle bien de la
    // séance demandée. Mélanger deux séances serait invisible à l'écran.
    return brouillon.sessionId === sessionId ? brouillon : null;
  }

  async supprimerBrouillon(userId: string, sessionId: string): Promise<void> {
    await this.moteur.supprimer(MAGASINS.brouillon, cleBrouillon(userId, sessionId));
  }

  /* ── Outbox ──────────────────────────────────────────────────────── */

  /**
   * Dépose — ou REMPLACE — l'opération en attente de cette séance.
   *
   * Une séance n'a jamais qu'une opération : elle porte le dernier état
   * complet du retour. Le serveur remplace de toute façon l'intégralité du
   * retour à chaque envoi (`saveWorkoutFeedback` supprime puis réécrit tous
   * les exercices), donc empiler des états intermédiaires n'apporterait
   * rien et multiplierait les envois.
   *
   * Ce qui est conservé du précédent : `operationId`, `createdAt` et le
   * compteur de tentatives. L'élève qui corrige sa saisie ne redémarre pas
   * une nouvelle opération — c'est toujours le même retour, mis à jour.
   */
  async deposerOperation(entree: {
    userId: string;
    sessionId: string;
    payload: WorkoutFeedbackPayload;
    operationId: string;
    maintenant: number;
    revision: number;
  }): Promise<OperationOutbox> {
    const existante = await this.lireOperation(entree.userId, entree.sessionId);
    const enregistrement: OperationOutbox = {
      schemaVersion: SCHEMA_VERSION,
      userId: entree.userId,
      operationId: existante?.operationId ?? entree.operationId,
      revision: entree.revision,
      sessionId: entree.sessionId,
      payload: entree.payload,
      createdAt: existante?.createdAt ?? entree.maintenant,
      updatedAt: entree.maintenant,
      attempts: existante?.attempts ?? 0,
      lastAttemptAt: existante?.lastAttemptAt ?? null,
      lastError: existante?.lastError ?? null,
    };
    await this.moteur.ecrire(
      MAGASINS.outbox,
      cleOutbox(entree.userId, entree.sessionId),
      enregistrement,
    );
    return enregistrement;
  }

  async lireOperation(userId: string, sessionId: string): Promise<OperationOutbox | null> {
    const brut = await this.moteur.lire(MAGASINS.outbox, cleOutbox(userId, sessionId));
    if (!estCompatible(brut, userId)) {
      return null;
    }
    const operation = brut as OperationOutbox;
    return operation.sessionId === sessionId ? operation : null;
  }

  /**
   * Les opérations en attente de CE compte.
   *
   * La sélection se fait sur le PRÉFIXE de clé, donc sur l'identifiant du
   * compte, puis chaque enregistrement est revérifié. Il n'existe aucune
   * variante « toutes les opérations » : le compte B ne peut pas énumérer
   * celles du compte A, même par erreur de code.
   */
  async operationsEnAttente(userId: string): Promise<OperationOutbox[]> {
    const cles = await this.moteur.cles(MAGASINS.outbox);
    const miennes = cles.filter((cle) => cle.startsWith(prefixeCompte(userId)));
    const operations: OperationOutbox[] = [];
    for (const cle of miennes) {
      const brut = await this.moteur.lire(MAGASINS.outbox, cle);
      if (estCompatible(brut, userId)) {
        operations.push(brut as OperationOutbox);
      }
    }
    // Ordre d'arrivée : la plus ancienne saisie part la première.
    return operations.sort((a, b) => a.createdAt - b.createdAt);
  }

  /** Une tentative a échoué. L'opération RESTE, et dit pourquoi. */
  async marquerEchec(
    userId: string,
    sessionId: string,
    erreur: string,
    maintenant: number,
  ): Promise<void> {
    const operation = await this.lireOperation(userId, sessionId);
    if (!operation) {
      return;
    }
    await this.moteur.ecrire(MAGASINS.outbox, cleOutbox(userId, sessionId), {
      ...operation,
      attempts: operation.attempts + 1,
      lastAttemptAt: maintenant,
      lastError: erreur.slice(0, 500),
    } satisfies OperationOutbox);
  }

  /**
   * Le serveur a confirmé. On efface — et seulement maintenant.
   *
   * Jamais avant d'avoir relu l'état serveur : effacer sur la seule réponse
   * HTTP, puis échouer à relire, laisserait l'élève sans opération en
   * attente ET sans état à jour, c'est-à-dire persuadé que c'est parti sans
   * moyen de le vérifier.
   */
  async acquitter(userId: string, sessionId: string): Promise<void> {
    await this.moteur.supprimer(MAGASINS.outbox, cleOutbox(userId, sessionId));
  }

  /**
   * « ENREGISTRER MON RETOUR », HORS LIGNE — brouillon et file d'attente
   * écrits ENSEMBLE ou pas du tout.
   *
   * Les deux portent exactement le même payload et la même révision. C'est
   * la seule transition du chantier qui doit être atomique : entre les deux
   * écritures, l'état serait soit un retour enregistré qui ne partira jamais,
   * soit un envoi programmé sans la saisie correspondante. Ni l'un ni l'autre
   * n'est rattrapable au redémarrage, et aucun `try/catch` ne les empêche.
   *
   * La sauvegarde ordinaire de la saisie, elle, reste une écriture simple :
   * elle ne touche qu'un magasin, il n'y a pas d'entre-deux possible.
   *
   * ────────────────────────────────────────────────────────────────────────
   * DEUX MAGASINS, DEUX FORMES — ET C'EST LE CORRECTIF DU 09/08/2026
   * ────────────────────────────────────────────────────────────────────────
   * La première version écrivait le MÊME objet des deux côtés : le payload
   * serveur. C'était une mauvaise invariant, et elle a coûté un écran blanc.
   *
   * `training_draft` reçoit ce que l'ÉCRAN sait relire — des chaînes de
   * saisie. `training_outbox` reçoit ce que le SERVEUR attend — des nombres
   * normalisés, `performedAt` figé. Confondre les deux revenait à hydrater
   * un formulaire avec un payload : `analyserDuree` appelait `.trim()` sur
   * un nombre, et la séance que l'élève venait de mettre à l'abri
   * disparaissait de l'écran.
   *
   * Ce qui reste vrai — et qui est la VRAIE invariant :
   *
   *     construireWorkoutFeedbackPayload(draft.payload, contexte)
   *       ≡ outbox.payload
   *
   * au moment de la validation. Les deux enregistrements portent le même
   * `userId`, le même `sessionId`, la même `businessDate` et la MÊME
   * révision ; ils ne portent plus le même contenu, et ne le doivent pas.
   */
  async validerRetourHorsLigne(entree: {
    userId: string;
    sessionId: string;
    businessDate: string;
    /**
     * L'état du FORMULAIRE, dans la forme que l'écran sait réafficher.
     *
     * C'est lui que l'élève retrouvera en rouvrant la séance : mêmes
     * charges, mêmes répétitions, même durée saisie, même remplacement.
     */
    etatFormulaire: unknown;
    /** Le payload SERVEUR validé — c'est lui, et lui seul, qui partira au POST. */
    payloadServeur: WorkoutFeedbackPayload;
    operationId: string;
    maintenant: number;
  }): Promise<{ revision: number }> {
    const cleB = cleBrouillon(entree.userId, entree.sessionId);
    const cleO = cleOutbox(entree.userId, entree.sessionId);
    let revisionEcrite = 0;

    await this.moteur.transaction(
      [MAGASINS.brouillon, MAGASINS.outbox],
      [
        { magasin: MAGASINS.brouillon, cle: cleB },
        { magasin: MAGASINS.outbox, cle: cleO },
      ],
      ([brut1, brut2]) => {
        const ancien = estCompatible(brut1, entree.userId)
          ? (brut1 as BrouillonSeance)
          : null;
        const enFile = estCompatible(brut2, entree.userId) ? (brut2 as OperationOutbox) : null;

        // LA RÉVISION EST CALCULÉE ICI, dans la transaction, à partir des
        // DEUX magasins. Prendre seulement celle du brouillon laisserait
        // repasser un numéro déjà porté par une opération en attente : un
        // brouillon en révision 7 et une file en révision 8 produiraient un
        // 8 en double, et l'acquittement conditionnel ne saurait plus
        // distinguer l'ancien du nouveau.
        //
        // Calculer hors transaction serait pire encore : deux fenêtres de
        // l'application liraient le même maximum et fabriqueraient la même
        // révision. Ici, la base sérialise les transactions d'écriture
        // portant sur les mêmes magasins — la seconde lit ce que la
        // première a écrit.
        revisionEcrite = Math.max(ancien?.revision ?? 0, enFile?.revision ?? 0) + 1;

        const brouillon: BrouillonSeance = {
          schemaVersion: SCHEMA_VERSION,
          userId: entree.userId,
          sessionId: entree.sessionId,
          revision: revisionEcrite,
          // La date de la SÉANCE ne bouge jamais après la première écriture.
          businessDate: ancien?.businessDate ?? entree.businessDate,
          // LA FORME DU FORMULAIRE, jamais celle du payload — voir l'en-tête
          // de cette méthode.
          payload: entree.etatFormulaire,
          updatedAt: entree.maintenant,
          syncStatus: "en_attente",
        };
        const operation: OperationOutbox = {
          schemaVersion: SCHEMA_VERSION,
          userId: entree.userId,
          // Même retour, donc même identifiant tant qu'il n'est pas acquitté.
          operationId: enFile?.operationId ?? entree.operationId,
          revision: revisionEcrite,
          sessionId: entree.sessionId,
          // LA FORME DU SERVEUR.
          payload: entree.payloadServeur,
          createdAt: enFile?.createdAt ?? entree.maintenant,
          updatedAt: entree.maintenant,
          attempts: enFile?.attempts ?? 0,
          lastAttemptAt: enFile?.lastAttemptAt ?? null,
          lastError: enFile?.lastError ?? null,
        };

        return [
          { type: "ecrire", magasin: MAGASINS.brouillon, cle: cleB, valeur: brouillon },
          { type: "ecrire", magasin: MAGASINS.outbox, cle: cleO, valeur: operation },
        ];
      },
    );

    return { revision: revisionEcrite };
  }

  /**
   * Acquitte — MAIS SEULEMENT si rien n'a changé depuis l'envoi.
   *
   * La course : le synchroniseur envoie l'état A, l'élève corrige sa séance
   * pendant que la requête voyage, l'outbox devient B, puis le serveur
   * confirme A. Supprimer aveuglément effacerait B — une correction que
   * l'élève croit enregistrée, disparue sans un mot.
   *
   * `operationId` ne peut pas servir à ce contrôle : il reste
   * volontairement stable quand le payload est remplacé, c'est tout son
   * intérêt pour l'idempotence. Seule la révision distingue A de B.
   */
  async acquitterSiInchange(
    userId: string,
    sessionId: string,
    revisionEnvoyee: number,
  ): Promise<"acquitte" | "remplacee" | "absente"> {
    const actuelle = await this.lireOperation(userId, sessionId);
    if (!actuelle) {
      return "absente";
    }
    if (actuelle.revision !== revisionEnvoyee) {
      // Une saisie plus récente attend : elle repartira au prochain envoi.
      return "remplacee";
    }
    await this.moteur.supprimer(MAGASINS.outbox, cleOutbox(userId, sessionId));
    return "acquitte";
  }

  /* ── Métadonnée d'affichage ──────────────────────────────────────── */

  /** Mémorise le type d'accès, POUR L'AFFICHAGE DU MENU uniquement. */
  async ecrireTypeAcces(userId: string, accessType: TypeAcces, maintenant: number): Promise<void> {
    if (!estTypeAcces(accessType)) {
      return;
    }
    const enregistrement: PreferenceAffichage = {
      schemaVersion: SCHEMA_VERSION,
      userId,
      accessType,
      updatedAt: maintenant,
    };
    await this.moteur.ecrire(MAGASINS.affichage, cleAffichage(userId), enregistrement);
  }

  /**
   * Le type d'accès mémorisé, ou `null`.
   *
   * `null` — jamais une valeur par défaut inventée : l'appelant retombe
   * alors sur le comportement actuel du hook. Et une valeur illisible ou
   * inconnue est traitée comme absente, pas « au mieux ».
   */
  async lireTypeAcces(userId: string): Promise<TypeAcces | null> {
    const brut = await this.moteur.lire(MAGASINS.affichage, cleAffichage(userId));
    if (!estCompatible(brut, userId)) {
      return null;
    }
    const valeur = (brut as PreferenceAffichage).accessType;
    return estTypeAcces(valeur) ? valeur : null;
  }

  /* ── Purge ───────────────────────────────────────────────────────── */

  /**
   * Efface ce qui appartient à ce compte, SAUF les opérations en attente.
   *
   * Une opération en attente est une saisie d'entraînement que l'élève croit
   * enregistrée et que le serveur n'a jamais reçue. La supprimer parce qu'il
   * s'est déconnecté serait effacer son travail sans le lui dire. La
   * décision lui revient : voir `purgerTout`, qui n'est appelé qu'après un
   * accord explicite.
   */
  async purgerSaufEnAttente(userId: string): Promise<{ operationsConservees: number }> {
    await this.effacerMagasin(MAGASINS.snapshot, userId);
    await this.effacerMagasin(MAGASINS.affichage, userId);

    const enAttente = await this.operationsEnAttente(userId);
    const sessionsProtegees = new Set(enAttente.map((operation) => operation.sessionId));
    for (const cle of await this.moteur.cles(MAGASINS.brouillon)) {
      if (!cle.startsWith(prefixeCompte(userId))) continue;
      const sessionId = cle.slice(prefixeCompte(userId).length);
      // Le brouillon d'une séance en attente reste : c'est lui qui sera
      // relu si la synchronisation échoue et qu'il faut réafficher la saisie.
      if (!sessionsProtegees.has(sessionId)) {
        await this.moteur.supprimer(MAGASINS.brouillon, cle);
      }
    }
    return { operationsConservees: enAttente.length };
  }

  /** Efface TOUT ce qui appartient à ce compte, opérations comprises. */
  async purgerTout(userId: string): Promise<void> {
    for (const magasin of Object.values(MAGASINS)) {
      await this.effacerMagasin(magasin, userId);
    }
  }

  private async effacerMagasin(magasin: NomMagasin, userId: string): Promise<void> {
    for (const cle of await this.moteur.cles(magasin)) {
      if (cle === userId || cle.startsWith(prefixeCompte(userId))) {
        await this.moteur.supprimer(magasin, cle);
      }
    }
  }
}
