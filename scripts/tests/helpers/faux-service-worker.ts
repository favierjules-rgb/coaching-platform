import { readFileSync } from "node:fs";
import { createContext, runInContext } from "node:vm";

/**
 * UN FAUX CONTEXTE DE SERVICE WORKER, POUR EXÉCUTER LE VRAI FICHIER.
 *
 * `public/sw.js` n'est chargé nulle part par l'application : c'est le
 * navigateur qui l'exécute, dans un contexte à lui. Sans ce bac, il n'y
 * aurait aucune façon de le vérifier autrement qu'en lisant son source —
 * or « le fichier contient bien `if (url.pathname.indexOf("/api/") === 0)` »
 * ne prouve rien du tout : ni que la condition est atteinte, ni qu'elle
 * porte sur la bonne requête, ni qu'elle a l'effet annoncé.
 *
 * Ce bac fournit donc de quoi le faire TOURNER : `self`, `caches`, `fetch`,
 * puis on lui envoie de vrais événements et on regarde ce qui sort — ce
 * qu'il met en cache, ce qu'il répond, et surtout ce qu'il laisse passer
 * sans y toucher. Même démarche que `faux-navigateur.ts` pour la découpe
 * vidéo (F5).
 *
 * ────────────────────────────────────────────────────────────────────────
 * LE POINT DÉLICAT : LES CLÉS DE CACHE
 * ────────────────────────────────────────────────────────────────────────
 * Le vrai `CacheStorage` NORMALISE toute clé en URL absolue. C'est ce qui
 * fait qu'un `cache.add("/_next/static/x.js")` à l'installation est ensuite
 * retrouvé par un `cache.match(requete)` dont l'URL est absolue. Un faux
 * cache qui garderait les clés telles quelles ferait passer un test que le
 * navigateur ferait échouer — exactement le genre de test qui rassure à
 * tort. La normalisation est donc reproduite ici.
 */

export interface RequeteFausse {
  method: string;
  url: string;
  /** "navigate" pour un chargement de page, "cors"/"no-cors" sinon. */
  mode?: string;
}

/** Ce que le service worker a fait d'une requête. */
export interface Verdict {
  /** A-t-il appelé `respondWith` ? Faux = il a laissé faire le navigateur. */
  repondu: boolean;
  reponse: Response | null;
}

export interface OptionsBac {
  /** Origine du site. Toute autre origine est « distante ». */
  origine?: string;
  /** Réponses du réseau, indexées par chemin (« /hors-ligne »). */
  reseau?: Record<string, () => Response>;
}

class FauxCache {
  readonly entrees = new Map<string, Response>();

  constructor(
    private readonly origine: string,
    private readonly reseau: (entree: string) => Promise<Response>,
  ) {}

  private cle(entree: string | RequeteFausse): string {
    const brut = typeof entree === "string" ? entree : entree.url;
    return new URL(brut, this.origine).href;
  }

  async put(entree: string | RequeteFausse, reponse: Response): Promise<void> {
    this.entrees.set(this.cle(entree), reponse);
  }

  async match(entree: string | RequeteFausse): Promise<Response | undefined> {
    return this.entrees.get(this.cle(entree));
  }

  async delete(entree: string | RequeteFausse): Promise<boolean> {
    return this.entrees.delete(this.cle(entree));
  }

  /**
   * Les clés, DANS L'ORDRE D'INSERTION — comme le vrai `Cache.keys()`.
   * C'est sur cet ordre que repose l'expulsion des plus anciennes entrées ;
   * un faux cache qui les rendrait triées ferait passer un test que le
   * navigateur ferait échouer.
   */
  async keys(): Promise<RequeteFausse[]> {
    return Array.from(this.entrees.keys()).map((url) => ({ method: "GET", url }));
  }

  async add(url: string): Promise<void> {
    const reponse = await this.reseau(url);
    if (!reponse.ok) {
      // Le vrai `Cache.add` rejette sur une réponse non-OK. Sans cela, un
      // 404 serait mis en cache et resservi comme s'il était valide.
      throw new TypeError(`Cache.add a échoué pour ${url}`);
    }
    this.entrees.set(this.cle(url), reponse);
  }

  /** Les URL absolues réellement présentes, triées. */
  urls(): string[] {
    return Array.from(this.entrees.keys()).sort();
  }
}

export class BacServiceWorker {
  readonly caches = new Map<string, FauxCache>();
  /** Toutes les URL demandées au réseau, dans l'ordre. */
  readonly appelsReseau: string[] = [];
  /** Bascule à `true` pour simuler une coupure. */
  horsLigne = false;
  skipWaitingAppele = false;
  claimAppele = false;

  private readonly ecouteurs = new Map<string, Array<(evenement: unknown) => void>>();
  private readonly reseau: Record<string, () => Response>;
  readonly origine: string;
  /** Le contexte d'exécution, pour atteindre les fonctions internes du fichier. */
  readonly portee: Record<string, unknown>;

  constructor(chemin: string, options: OptionsBac = {}) {
    this.origine = options.origine ?? "https://seth.example";
    this.reseau = options.reseau ?? {};

    const bac: Record<string, unknown> = {};
    bac.globalThis = bac;
    bac.self = bac;
    bac.console = console;
    bac.URL = URL;
    bac.Response = Response;
    bac.TypeError = TypeError;
    bac.Error = Error;
    bac.location = { origin: this.origine };
    bac.addEventListener = (nom: string, fn: (evenement: unknown) => void) => {
      const liste = this.ecouteurs.get(nom) ?? [];
      liste.push(fn);
      this.ecouteurs.set(nom, liste);
    };
    bac.skipWaiting = async () => {
      this.skipWaitingAppele = true;
    };
    bac.clients = {
      claim: async () => {
        this.claimAppele = true;
      },
    };
    bac.fetch = (entree: string | RequeteFausse) => this.fetch(entree);
    bac.caches = {
      open: async (nom: string) => this.ouvrir(nom),
      keys: async () => Array.from(this.caches.keys()),
      delete: async (nom: string) => this.caches.delete(nom),
      // `CacheStorage.match` interroge TOUS les caches, dans leur ordre de
      // création, et rend la première correspondance. Le service worker s'en
      // sert pour retrouver un fichier précaché avec la page hors ligne sans
      // avoir à savoir dans quel cache il se trouve.
      match: async (entree: string | RequeteFausse) => {
        for (const cache of this.caches.values()) {
          const trouve = await cache.match(entree);
          if (trouve) {
            return trouve;
          }
        }
        return undefined;
      },
    };

    const contexte = createContext(bac);
    runInContext(readFileSync(chemin, "utf8"), contexte, { filename: chemin });
    this.portee = bac;
  }

  private ouvrir(nom: string): FauxCache {
    const existant = this.caches.get(nom);
    if (existant) {
      return existant;
    }
    const cache = new FauxCache(this.origine, (url) => this.fetch(url));
    this.caches.set(nom, cache);
    return cache;
  }

  private async fetch(entree: string | RequeteFausse): Promise<Response> {
    const brut = typeof entree === "string" ? entree : entree.url;
    const absolue = new URL(brut, this.origine).href;
    this.appelsReseau.push(absolue);
    if (this.horsLigne) {
      // Ce qu'un navigateur fait vraiment sans réseau : la promesse est
      // REJETÉE. Elle ne résout pas sur une réponse d'erreur — c'est toute
      // la différence entre « pas de réseau » et « le serveur a répondu 500 ».
      throw new TypeError("Failed to fetch");
    }
    const fabricant = this.reseau[new URL(absolue).pathname];
    if (!fabricant) {
      return new Response("introuvable", { status: 404 });
    }
    return fabricant();
  }

  private async declencher(nom: string, evenement: Record<string, unknown>): Promise<void> {
    const liste = this.ecouteurs.get(nom) ?? [];
    for (const ecouteur of liste) {
      ecouteur(evenement);
    }
  }

  /** Rejoue l'installation et attend tout ce qu'elle a mis en attente. */
  async installer(): Promise<void> {
    const attentes: Promise<unknown>[] = [];
    await this.declencher("install", {
      waitUntil: (promesse: Promise<unknown>) => attentes.push(promesse),
    });
    await Promise.all(attentes);
  }

  /** Rejoue l'activation (purge des caches d'une version précédente). */
  async activer(): Promise<void> {
    const attentes: Promise<unknown>[] = [];
    await this.declencher("activate", {
      waitUntil: (promesse: Promise<unknown>) => attentes.push(promesse),
    });
    await Promise.all(attentes);
  }

  /**
   * Rejoue un `postMessage` venu d'une page contrôlée, et attend ce que le
   * service worker a mis en attente.
   *
   * C'est le seul canal par lequel une page peut PARLER à son service
   * worker. Dans une application Next.js, c'est aussi le seul moment où le
   * service worker apprend qu'une page élève est ouverte : le routeur
   * client ne produit aucune requête de navigation qu'il pourrait
   * intercepter.
   */
  async message(donnees: unknown): Promise<void> {
    const attentes: Promise<unknown>[] = [];
    await this.declencher("message", {
      data: donnees,
      waitUntil: (promesse: Promise<unknown>) => attentes.push(promesse),
    });
    await Promise.all(attentes);
  }

  /** Envoie une requête et rapporte ce que le service worker en a fait. */
  async requeter(requete: RequeteFausse): Promise<Verdict> {
    let promesse: Promise<Response> | null = null;
    await this.declencher("fetch", {
      request: requete,
      respondWith: (valeur: Promise<Response>) => {
        promesse = valeur;
      },
    });
    if (promesse === null) {
      return { repondu: false, reponse: null };
    }
    return { repondu: true, reponse: await promesse };
  }

  /** Contenu d'un cache, par URL absolue. Vide si le cache n'existe pas. */
  contenu(nom: string): string[] {
    return this.caches.get(nom)?.urls() ?? [];
  }

  /** Toutes les URL en cache, tous caches confondus. */
  toutLeCache(): string[] {
    return Array.from(this.caches.values())
      .flatMap((cache) => cache.urls())
      .sort();
  }
}

/** Raccourci : requête de navigation (chargement d'une page). */
export function navigation(url: string): RequeteFausse {
  return { method: "GET", url, mode: "navigate" };
}

/** Raccourci : sous-requête (script, image, appel de données). */
export function sousRequete(url: string, method = "GET"): RequeteFausse {
  return { method, url, mode: "cors" };
}
