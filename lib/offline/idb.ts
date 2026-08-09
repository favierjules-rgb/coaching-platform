import {
  MAGASINS,
  NOM_BASE,
  SCHEMA_VERSION,
  type NomMagasin,
} from "@/lib/offline/schema";
import type { Decision, Ecriture, Lecture, MoteurStockage } from "@/lib/offline/depot";

/**
 * INDEXEDDB — l'implémentation réelle du moteur de stockage.
 *
 * ════════════════════════════════════════════════════════════════════════
 * AUCUN ACCÈS AU NAVIGATEUR À L'IMPORT
 * ════════════════════════════════════════════════════════════════════════
 * Pas une ligne de ce module ne touche `indexedDB`, `window` ou `navigator`
 * au niveau du fichier. Tout passe par des fonctions, appelées depuis du
 * code client. Un `const db = indexedDB.open(...)` en tête de module
 * suffirait à faire échouer le rendu serveur de toute page qui l'importe,
 * même indirectement — et l'erreur apparaîtrait au build, loin d'ici.
 *
 * ════════════════════════════════════════════════════════════════════════
 * L'ABSENCE D'INDEXEDDB N'EST PAS UNE PANNE
 * ════════════════════════════════════════════════════════════════════════
 * Navigation privée sur certains navigateurs, stockage désactivé, quota
 * atteint : IndexedDB peut simplement ne pas être là. L'application EN
 * LIGNE doit continuer exactement comme avant — elle n'a jamais eu besoin
 * de stockage local. Ce qui disparaît, c'est le mode hors ligne, et il doit
 * disparaître en le DISANT, jamais en faisant semblant.
 *
 * D'où `ErreurStockage` : l'appelant peut distinguer « le stockage local
 * est indisponible » de « le retour est enregistré localement ». C'est
 * exactement la différence entre afficher « Synchronisation en attente » et
 * mentir à l'élève.
 */

/** Ce qui a empêché l'opération — assez précis pour décider quoi afficher. */
export type CauseStockage =
  /** Le navigateur n'expose pas IndexedDB du tout. */
  | "indisponible"
  /** L'ouverture a été refusée (stockage bloqué, profil restreint). */
  | "ouverture_refusee"
  /** Une autre fenêtre garde une version plus ancienne ouverte. */
  | "bloquee"
  /** La transaction a été annulée — rien n'a été écrit. */
  | "abandonnee"
  /** Plus de place. */
  | "quota"
  /** La base sur le disque est plus récente que ce que ce code sait lire. */
  | "version_incompatible";

export class ErreurStockage extends Error {
  constructor(
    readonly cause: CauseStockage,
    message: string,
  ) {
    super(message);
    this.name = "ErreurStockage";
  }
}

/** `true` si ce navigateur, ici et maintenant, expose IndexedDB. */
export function stockageLocalDisponible(): boolean {
  return typeof globalThis !== "undefined" && typeof globalThis.indexedDB !== "undefined";
}

/* ════════════════════════════════════════════════════════════════════════
 * LA CIBLE — QUELLE BASE, QUELLE VERSION
 * ════════════════════════════════════════════════════════════════════════
 * En production il n'y a qu'une réponse, celle de `schema.ts`. Elle est
 * écrite UNE fois, ici, dans `CIBLE_PRODUCTION`.
 *
 * Les tests, eux, ont besoin de viser une base jetable et de choisir la
 * version pour observer une vraie montée N → N+1. Ce besoin ne justifie pas
 * une seconde implémentation du moteur : une copie « de test » de
 * `ouvrirBase` prouverait le comportement de la copie, pas celui du code
 * qui tourne sur le téléphone de l'élève. Le paramètre descend donc dans le
 * chemin RÉEL — `ouvrirCible()` ci-dessous est le seul endroit du projet où
 * `indexedDB.open` est appelé — et la seule façon d'en fabriquer un autre
 * est `MoteurIndexedDB.pourTests`.
 */

/** Base et version visées par un moteur. */
export interface CibleBase {
  readonly nomBase: string;
  readonly version: number;
}

/** L'unique cible de production. Gelée : personne ne la déplace en cours de route. */
const CIBLE_PRODUCTION: CibleBase = Object.freeze({
  nomBase: NOM_BASE,
  version: SCHEMA_VERSION,
});

/**
 * Préfixe imposé aux bases de test.
 *
 * « Ne jamais toucher la base de production » cesse ici d'être une règle de
 * discipline pour devenir une propriété du code : `pourTests` refuse tout
 * nom qui ne commence pas par ce préfixe, donc aucun test — même écrit
 * distraitement, même copié-collé — ne peut ouvrir `seth-offline`.
 */
const PREFIXE_BASES_DE_TEST = "seth-offline-idb-tests-";

/**
 * Marque de type portée par une cible validée.
 *
 * Elle n'existe qu'à la compilation et ne coûte rien à l'exécution. Son
 * seul rôle : rendre le constructeur du moteur INUTILISABLE avec une cible
 * arbitraire depuis un autre fichier. Seul `pourTests`, juste en dessous,
 * sait en produire une — après vérification.
 */
declare const CIBLE_VALIDEE: unique symbol;
type CibleValidee = CibleBase & { readonly [CIBLE_VALIDEE]: true };

/** Transforme une requête IndexedDB en promesse. */
function promesse<T>(requete: IDBRequest<T>): Promise<T> {
  return new Promise((resoudre, rejeter) => {
    requete.onsuccess = () => resoudre(requete.result);
    requete.onerror = () => rejeter(requete.error ?? new Error("requête IndexedDB en échec"));
  });
}

/** Traduit une erreur du navigateur en cause exploitable. */
function cause(erreur: unknown): CauseStockage {
  const nom = (erreur as { name?: string } | null)?.name;
  if (nom === "QuotaExceededError") return "quota";
  if (nom === "VersionError") return "version_incompatible";
  if (nom === "AbortError") return "abandonnee";
  return "ouverture_refusee";
}

/**
 * Ouvre la base de PRODUCTION et garantit les quatre magasins.
 *
 * ────────────────────────────────────────────────────────────────────────
 * LA MIGRATION NE DÉTRUIT RIEN — JAMAIS
 * ────────────────────────────────────────────────────────────────────────
 * `onupgradeneeded` ne fait qu'AJOUTER ce qui manque. Il n'y a ici ni
 * `deleteDatabase`, ni `clear`, ni suppression d'un enregistrement jugé
 * illisible, et il ne doit jamais y en avoir : une opération en attente est
 * une saisie d'entraînement que l'élève croit enregistrée et que le serveur
 * n'a jamais reçue. « Repartir sur une base propre » revient à jeter son
 * travail pour simplifier le nôtre.
 *
 * Un enregistrement d'une version que ce code ne sait plus lire est
 * simplement ignoré à la LECTURE (`estCompatible` dans `depot.ts`) : il
 * reste sur le disque, il n'est pas envoyé, il n'est pas effacé. Le jour où
 * une migration saura le convertir, il sera encore là.
 */
export function ouvrirBase(): Promise<IDBDatabase> {
  return ouvrirCible(CIBLE_PRODUCTION);
}

/**
 * Ouvre la base VISÉE et garantit les quatre magasins.
 *
 * Unique appel à `indexedDB.open` du projet : la production et les tests
 * passent exactement par ces lignes, y compris par le `onupgradeneeded`
 * ci-dessous. C'est toute la raison d'être du paramètre : un test qui
 * ouvrirait lui-même une base ne prouverait rien sur ce fichier.
 */
function ouvrirCible(cible: CibleBase): Promise<IDBDatabase> {
  if (!stockageLocalDisponible()) {
    return Promise.reject(new ErreurStockage("indisponible", "IndexedDB n'existe pas sur ce navigateur"));
  }
  return new Promise((resoudre, rejeter) => {
    const demande = globalThis.indexedDB.open(cible.nomBase, cible.version);

    demande.onupgradeneeded = () => {
      const base = demande.result;
      for (const magasin of Object.values(MAGASINS)) {
        if (!base.objectStoreNames.contains(magasin)) {
          base.createObjectStore(magasin);
        }
      }
    };

    // Une fois la promesse tranchée, plus rien ne doit la retrancher — et
    // surtout, aucune connexion ne doit rester ouverte dans le vide.
    let tranchee = false;

    demande.onblocked = () => {
      // Une autre fenêtre de l'application garde une version antérieure
      // ouverte. On le SIGNALE plutôt que de forcer : recharger d'autorité
      // la fenêtre de quelqu'un qui est en train de saisir sa séance serait
      // pire que le blocage lui-même. Le rejet est IMMÉDIAT et déterministe
      // — pas d'attente d'un déblocage qui pourrait ne jamais venir.
      if (tranchee) return;
      tranchee = true;
      rejeter(
        new ErreurStockage(
          "bloquee",
          "Une autre fenêtre de l'application empêche la mise à jour du stockage local.",
        ),
      );
    };

    demande.onsuccess = () => {
      const base = demande.result;
      // ═══ LA CONNEXION FANTÔME ═══
      // Le blocage n'annule pas la demande d'ouverture : quand la fenêtre
      // gênante se ferme enfin, `onsuccess` finit par arriver. Si l'appel
      // applicatif a déjà été rejeté, cette connexion n'appartient à
      // personne — elle resterait ouverte, invisible, et bloquerait à son
      // tour le prochain upgrade. On la ferme sur-le-champ.
      if (tranchee) {
        base.close();
        return;
      }
      tranchee = true;
      resoudre(base);
    };

    demande.onerror = () => {
      if (tranchee) return;
      tranchee = true;
      rejeter(new ErreurStockage(cause(demande.error), demande.error?.message ?? "ouverture refusée"));
    };
  });
}

/**
 * Moteur IndexedDB.
 *
 * La base est ouverte à la PREMIÈRE opération, pas à la construction : un
 * composant peut instancier le moteur sans provoquer d'accès disque, et le
 * rendu serveur ne déclenche rien.
 */
export class MoteurIndexedDB implements MoteurStockage {
  private base: Promise<IDBDatabase> | null = null;

  /**
   * Base et version visées.
   *
   * Copiée puis GELÉE à la construction, et déclarée `readonly` : ni le
   * moteur, ni son appelant, ni un `onversionchange` ne peuvent la déplacer
   * en cours de vie. Un moteur ouvert en version N qui adopterait
   * silencieusement N+1 à la réouverture ferait disparaître exactement
   * l'erreur que le mode hors ligne doit signaler — `version_incompatible`
   * deviendrait un succès, et du code trop ancien écrirait dans une base
   * trop récente.
   */
  private readonly cible: CibleBase;

  /**
   * Le constructeur ne s'utilise SANS ARGUMENT que depuis l'application :
   * en production il n'existe qu'une base et qu'une version, celles de
   * `schema.ts`. Le paramètre exige une cible validée, type que seul
   * `pourTests` sait produire — un autre fichier ne peut donc pas viser
   * ailleurs sans passer par la seam, et la seam est vérifiée
   * statiquement (`scripts/tests/idb/garde-fous.mts`).
   */
  constructor(cible: CibleValidee = CIBLE_PRODUCTION as CibleValidee) {
    this.cible = Object.freeze({ nomBase: cible.nomBase, version: cible.version });
  }

  /** La cible réellement visée. Objet gelé : lecture seule, pour le diagnostic et les tests. */
  get cibleVisee(): CibleBase {
    return this.cible;
  }

  /**
   * SEAM DE TEST — le seul moyen de faire viser une AUTRE base à ce moteur.
   *
   * Elle n'existe pas pour rendre le moteur configurable : elle existe
   * parce que les garanties qui comptent ici — une montée de version ne
   * détruit pas l'outbox, un blocage se signale au lieu de forcer, une
   * connexion fantôme ne survit pas — ne sont observables que sur une VRAIE
   * base IndexedDB, et qu'aucun test n'a le droit d'aller les observer sur
   * celle de l'élève.
   *
   * Deux refus, tous deux à l'exécution et non par convention :
   *   • un nom qui ne commence pas par `seth-offline-idb-tests-` ; la base
   *     de production est donc inatteignable par ici, y compris par
   *     copier-coller distrait ;
   *   • une version qui n'est pas un entier ≥ 1 — `indexedDB.open` accepte
   *     silencieusement `1.5` en l'arrondissant, ce qui transformerait un
   *     scénario de montée de version en test qui ne teste rien.
   *
   * Aucune implémentation parallèle : le moteur rendu ici est le moteur de
   * production, à l'octet près, avec une cible différente.
   */
  static pourTests(cible: { nomBase: string; version: number }): MoteurIndexedDB {
    if (!cible.nomBase.startsWith(PREFIXE_BASES_DE_TEST)) {
      throw new Error(
        `MoteurIndexedDB.pourTests : nom de base « ${cible.nomBase} » refusé — il doit commencer par « ${PREFIXE_BASES_DE_TEST} ». La base de production n'est pas ouvrable par cette voie.`,
      );
    }
    if (!Number.isInteger(cible.version) || cible.version < 1) {
      throw new Error(
        `MoteurIndexedDB.pourTests : version « ${cible.version} » refusée — un entier supérieur ou égal à 1 est attendu.`,
      );
    }
    return new MoteurIndexedDB({ nomBase: cible.nomBase, version: cible.version } as CibleValidee);
  }

  private ouvrir(): Promise<IDBDatabase> {
    if (!this.base) {
      const tentative = ouvrirCible(this.cible)
        .then((base) => {
          // Quand une AUTRE fenêtre demande une version supérieure, celle-ci
          // doit libérer la base au lieu de la retenir indéfiniment — et
          // oublier sa référence, sinon l'opération suivante travaillerait
          // sur une connexion fermée. Elle rouvrira à la version courante.
          base.onversionchange = () => {
            base.close();
            if (this.base === tentative) {
              this.base = null;
            }
          };
          base.onclose = () => {
            if (this.base === tentative) {
              this.base = null;
            }
          };
          return base;
        })
        .catch((erreur) => {
          // Un échec d'ouverture ne doit pas empoisonner la suite : la
          // prochaine tentative pourrait réussir (fenêtre gênante fermée,
          // place libérée). Sans cet oubli, il faudrait tuer l'application
          // pour retrouver son stockage local.
          if (this.base === tentative) {
            this.base = null;
          }
          throw erreur;
        });
      this.base = tentative;
    }
    return this.base;
  }

  async lire(magasin: NomMagasin, cle: string): Promise<unknown> {
    const base = await this.ouvrir();
    const tx = base.transaction(magasin, "readonly");
    return promesse(tx.objectStore(magasin).get(cle));
  }

  async ecrire(magasin: NomMagasin, cle: string, valeur: unknown): Promise<void> {
    await this.transaction([magasin], [], () => [{ type: "ecrire", magasin, cle, valeur }]);
  }

  async supprimer(magasin: NomMagasin, cle: string): Promise<void> {
    await this.transaction([magasin], [], () => [{ type: "supprimer", magasin, cle }]);
  }

  async cles(magasin: NomMagasin): Promise<string[]> {
    const base = await this.ouvrir();
    const tx = base.transaction(magasin, "readonly");
    const brutes = await promesse(tx.objectStore(magasin).getAllKeys());
    return brutes.map((cle) => String(cle));
  }

  /**
   * UNE transaction IndexedDB pour tout le lot.
   *
   * L'atomicité n'est pas obtenue par un `try/catch` autour de deux
   * écritures : elle est fournie par la base. Si `travail` lève, ou si une
   * écriture échoue, `tx.abort()` défait ce qui a déjà été écrit — y
   * compris ce qui l'avait été avec succès une milliseconde plus tôt.
   *
   * La promesse ne se résout qu'au `complete` de la transaction, jamais
   * avant : c'est ce qui autorise l'appelant à dire « c'est enregistré »
   * sans mentir. Une résolution anticipée transformerait le message
   * « Synchronisation en attente » en promesse en l'air.
   */
  async transaction(
    magasins: readonly NomMagasin[],
    lectures: readonly Lecture[],
    decider: Decision,
  ): Promise<void> {
    const base = await this.ouvrir();
    const tx = base.transaction(magasins as string[], "readwrite");

    return new Promise<void>((resoudre, rejeter) => {
      const echouer = (erreur: unknown) =>
        rejeter(
          erreur instanceof ErreurStockage
            ? erreur
            : new ErreurStockage(cause(erreur), (erreur as Error)?.message ?? "transaction annulée"),
        );

      // La promesse ne se résout qu'au `complete`, JAMAIS avant. C'est ce
      // qui autorise l'appelant à annoncer « enregistré » sans mentir : une
      // résolution anticipée transformerait « Synchronisation en attente »
      // en promesse en l'air.
      tx.oncomplete = () => resoudre();
      tx.onabort = () => echouer(tx.error);
      tx.onerror = () => echouer(tx.error);

      if (lectures.length === 0) {
        try {
          appliquer(verifier(decider([])));
        } catch (erreur) {
          annuler(erreur);
        }
        return;
      }

      const lues: unknown[] = new Array(lectures.length);
      let restantes = lectures.length;

      // Toutes les lectures sont émises IMMÉDIATEMENT, puis la décision est
      // prise dans le rappel de succès de la dernière — donc pendant que la
      // transaction est encore active. Aucun `await` ne peut s'intercaler :
      // c'est ce qui rend `TransactionInactiveError` impossible ici.
      lectures.forEach((lecture, index) => {
        const requete = tx.objectStore(lecture.magasin).get(lecture.cle);
        requete.onerror = () => echouer(requete.error);
        requete.onsuccess = () => {
          lues[index] = requete.result;
          restantes -= 1;
          if (restantes > 0) return;
          try {
            appliquer(verifier(decider(lues)));
          } catch (erreur) {
            annuler(erreur);
          }
        };
      });

      /**
       * GARDE D'EXÉCUTION contre un `decider` devenu asynchrone.
       *
       * La signature TypeScript l'interdit déjà, mais un `as never`, un
       * fichier JavaScript ou une évolution du code peuvent la contourner.
       * Or une promesse rendue ici serait catastrophique en silence :
       * IndexedDB validerait la transaction faute de requête en attente, les
       * écritures partiraient dans une transaction morte, et l'erreur
       * n'apparaîtrait qu'à l'exécution, sur un téléphone.
       *
       * On annule donc immédiatement, avec un message qui dit quoi corriger.
       */
      function verifier(resultat: readonly Ecriture[]): readonly Ecriture[] {
        const suspect = resultat as unknown as { then?: unknown };
        if (suspect && typeof suspect.then === "function") {
          throw new ErreurStockage(
            "abandonnee",
            "decider() doit être SYNCHRONE : une promesse laisse IndexedDB valider la transaction avant les écritures.",
          );
        }
        return resultat;
      }

      function appliquer(ecritures: readonly Ecriture[]): void {
        for (const ecriture of ecritures) {
          const magasin = tx.objectStore(ecriture.magasin);
          const requete =
            ecriture.type === "ecrire"
              ? magasin.put(ecriture.valeur, ecriture.cle)
              : magasin.delete(ecriture.cle);
          requete.onerror = () => echouer(requete.error);
        }
      }

      function annuler(erreur: unknown): void {
        try {
          tx.abort();
        } catch {
          // Déjà terminée : l'erreur d'origine reste la bonne.
        }
        echouer(erreur);
      }
    });
  }

  /** Ferme la connexion — utile aux tests de persistance et au changement de compte. */
  async fermer(): Promise<void> {
    if (!this.base) return;
    const base = await this.base.catch(() => null);
    this.base = null;
    base?.close();
  }
}
