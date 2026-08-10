/**
 * HORS LIGNE — INDEXEDDB À MAINS NUES, DANS LA PAGE.
 *
 * Ce module est chargé DANS le navigateur, aux côtés de `lib/offline/idb.ts`.
 * Il ne connaît ni le dépôt, ni le schéma, ni le moteur : il ouvre, écrit et
 * relit avec l'API brute du navigateur.
 *
 * C'est la condition pour que les scénarios prouvent quelque chose. Vérifier
 * le moteur avec le moteur, c'est demander à quelqu'un de relire sa propre
 * copie : si `onupgradeneeded` effaçait un magasin, une lecture passant par
 * le même code ne verrait qu'une base cohérente et vide.
 *
 * Les fonctions d'espionnage, en bas de fichier, remplacent temporairement
 * des méthodes du navigateur pour CONSTATER ce que le code testé fait —
 * pas pour le simuler. Elles se restaurent toujours.
 */

export function requete<T>(r: IDBRequest<T>): Promise<T> {
  return new Promise((ok, ko) => {
    r.onsuccess = () => ok(r.result);
    r.onerror = () => ko(r.error ?? new Error("requête refusée"));
  });
}

export interface Ouverture {
  base: IDBDatabase;
  /** `true` si le navigateur a signalé un blocage pendant cette ouverture. */
  bloquee: boolean;
}

/**
 * Ouvre une base à mains nues.
 *
 * `surUpgrade` reçoit la base pendant `onupgradeneeded` : c'est là que les
 * scénarios FABRIQUENT l'état de départ (par exemple une base en version N
 * à laquelle il manque deux magasins), ce que le moteur, lui, ne sait pas
 * faire — et n'a pas à savoir faire.
 */
export function ouvrirBrut(
  nom: string,
  version: number,
  surUpgrade?: (base: IDBDatabase) => void,
): Promise<Ouverture> {
  return new Promise((ok, ko) => {
    const demande = indexedDB.open(nom, version);
    let bloquee = false;
    demande.onupgradeneeded = () => surUpgrade?.(demande.result);
    demande.onblocked = () => {
      bloquee = true;
    };
    demande.onsuccess = () => ok({ base: demande.result, bloquee });
    demande.onerror = () => ko(demande.error ?? new Error("ouverture refusée"));
  });
}

/** Une transaction d'écriture, résolue au `complete` — jamais avant. */
export function ecrire(
  base: IDBDatabase,
  entrees: readonly { magasin: string; cle: string; valeur: unknown }[],
): Promise<void> {
  const magasins = [...new Set(entrees.map((e) => e.magasin))];
  const tx = base.transaction(magasins, "readwrite");
  return new Promise((ok, ko) => {
    tx.oncomplete = () => ok();
    tx.onabort = () => ko(tx.error ?? new Error("transaction annulée"));
    tx.onerror = () => ko(tx.error ?? new Error("transaction en échec"));
    for (const e of entrees) tx.objectStore(e.magasin).put(e.valeur, e.cle);
  });
}

export function magasins(base: IDBDatabase): string[] {
  return [...base.objectStoreNames].sort();
}

/** Tout le contenu de la base, magasin par magasin, clé par clé. */
export async function contenu(base: IDBDatabase): Promise<Record<string, Record<string, unknown>>> {
  const noms = magasins(base);
  if (noms.length === 0) return {};
  const tx = base.transaction(noms, "readonly");
  const tout: Record<string, Record<string, unknown>> = {};
  for (const nom of noms) {
    const magasin = tx.objectStore(nom);
    const cles = await requete(magasin.getAllKeys());
    const valeurs = await requete(magasin.getAll());
    tout[nom] = Object.fromEntries(cles.map((cle, i) => [String(cle), valeurs[i]]));
  }
  return tout;
}

/** Ferme la base et attend que le navigateur ait pris acte. */
export async function fermer(base: IDBDatabase): Promise<void> {
  base.close();
  await new Promise((ok) => setTimeout(ok, 0));
}

/* ════════════════════════════════════════════════════════════════════════
 * ESPIONS
 * ════════════════════════════════════════════════════════════════════════ */

export interface EspionDestructions {
  /** Ce qui a été détruit pendant l'observation, dans l'ordre. */
  appels: string[];
  restaurer(): void;
}

/**
 * Compte les destructions — `deleteObjectStore`, `clear`, `deleteDatabase`.
 *
 * L'invariant du chantier n'est pas « après coup, les données sont encore
 * là » : c'est « rien n'a été détruit ». Une migration qui effacerait puis
 * réécrirait à l'identique passerait la première formulation et raterait la
 * seconde — jusqu'au jour où la réécriture échoue à mi-chemin.
 */
export function espionnerDestructions(): EspionDestructions {
  const appels: string[] = [];
  const deleteObjectStore = IDBDatabase.prototype.deleteObjectStore;
  const clear = IDBObjectStore.prototype.clear;
  const deleteDatabase = IDBFactory.prototype.deleteDatabase;

  IDBDatabase.prototype.deleteObjectStore = function (nom: string) {
    appels.push(`deleteObjectStore(${nom})`);
    return deleteObjectStore.call(this, nom);
  };
  IDBObjectStore.prototype.clear = function () {
    appels.push(`clear(${this.name})`);
    return clear.call(this);
  };
  IDBFactory.prototype.deleteDatabase = function (nom: string) {
    appels.push(`deleteDatabase(${nom})`);
    return deleteDatabase.call(this, nom);
  };

  return {
    appels,
    restaurer() {
      IDBDatabase.prototype.deleteObjectStore = deleteObjectStore;
      IDBObjectStore.prototype.clear = clear;
      IDBFactory.prototype.deleteDatabase = deleteDatabase;
    },
  };
}

export interface EtatConnexions {
  /** Nombre de connexions ouvertes sur la base observée depuis le début. */
  total: number;
  /** Celles qui n'ont jamais été fermées. */
  vivantes: number;
}

export interface TraceurConnexions {
  etat(): EtatConnexions;
  restaurer(): void;
}

/**
 * Suit CHAQUE connexion ouverte sur une base donnée, et laquelle a été
 * fermée.
 *
 * C'est l'instrument de la connexion fantôme : quand une ouverture est
 * rejetée pour cause de blocage, la demande, elle, n'est pas annulée. Elle
 * finit par aboutir quand la fenêtre gênante se ferme, et rend une connexion
 * que plus personne n'attend. Sans fermeture explicite, elle reste vivante
 * et bloquera la prochaine montée de version — un défaut qu'aucune lecture
 * de données ne peut révéler, seulement un comptage.
 */
export function tracerConnexions(nomBase: string): TraceurConnexions {
  let total = 0;
  const vivantes = new Set<IDBDatabase>();

  const open = IDBFactory.prototype.open;
  const close = IDBDatabase.prototype.close;

  IDBFactory.prototype.open = function (nom: string, version?: number) {
    const demande = version === undefined ? open.call(this, nom) : open.call(this, nom, version);
    if (nom === nomBase) {
      demande.addEventListener("success", () => {
        total += 1;
        vivantes.add(demande.result);
      });
    }
    return demande;
  };

  IDBDatabase.prototype.close = function () {
    vivantes.delete(this);
    return close.call(this);
  };

  return {
    etat: () => ({ total, vivantes: vivantes.size }),
    restaurer() {
      IDBFactory.prototype.open = open;
      IDBDatabase.prototype.close = close;
    },
  };
}

/* ════════════════════════════════════════════════════════════════════════
 * DEUX OUTILS QUI DOIVENT VIVRE DANS UN MODULE
 * ════════════════════════════════════════════════════════════════════════
 * Le code passé à `page.evaluate` est évalué par le navigateur comme un
 * script ordinaire — donc en mode NON strict. Or l'application, elle, est
 * faite de modules, qui sont toujours stricts. Une écriture sur un objet
 * gelé y lève une `TypeError` ; dans un `evaluate`, elle échoue en silence.
 *
 * Ces deux fonctions vivent donc ICI, dans un vrai module, pour que ce qui
 * est constaté soit ce qui se produirait dans l'application.
 */

/** Exécute `action` et dit si elle a levé. */
export function leve(action: () => unknown): boolean {
  try {
    action();
    return false;
  } catch {
    return true;
  }
}

/** Tente d'écrire une propriété, en mode strict. `true` si le navigateur refuse. */
export function tenterEcriture(objet: object, propriete: string, valeur: unknown): boolean {
  try {
    (objet as Record<string, unknown>)[propriete] = valeur;
    return false;
  } catch {
    return true;
  }
}

/** Ce qu'une `ErreurStockage` dit, réduit à ce qui traverse `page.evaluate`. */
export function decrireErreur(erreur: unknown): { nom: string; cause: string | null; message: string } {
  const e = erreur as { name?: string; cause?: unknown; message?: string } | null;
  return {
    nom: e?.name ?? "inconnu",
    cause: typeof e?.cause === "string" ? e.cause : null,
    message: e?.message ?? String(erreur),
  };
}
