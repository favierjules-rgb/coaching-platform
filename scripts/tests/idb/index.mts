import assert from "node:assert/strict";
import { existsSync, readdirSync } from "node:fs";
import { mkdir, mkdtemp, readdir, readFile, writeFile } from "node:fs/promises";
import { createServer, type Server } from "node:http";
import * as moduleNode from "node:module";
import { tmpdir } from "node:os";
import { dirname, join, normalize, relative, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";

import type { Browser, BrowserContext, Page } from "playwright-core";

/**
 * HORS LIGNE — INDEXEDDB, DANS UN VRAI NAVIGATEUR.
 *
 *   npm run test:offline-idb
 *
 * Complément de `offline-depot.mts`, qui prouve déjà, sur un moteur en
 * mémoire et en quelques millisecondes, tout ce qui ne dépend pas du
 * navigateur. Ici, et seulement ici :
 *
 *   G      personne, dans l'application, n'appelle la seam de test ;
 *   A40-A  une montée de version d'IndexedDB ne perd rien — la propriété
 *          sur laquelle repose toute la stratégie hors ligne ;
 *   A40-B  notre `onupgradeneeded` n'ajoute que ce qui manque ;
 *   B      un second onglet provoque un refus net, la reprise fonctionne
 *          sur le même moteur, et aucune connexion fantôme ne subsiste ;
 *   V      `versionchange` fait lâcher l'ancien moteur, qui refuse ensuite
 *          en disant `version_incompatible` — et sa version ne bouge pas ;
 *   S      la seam de test ne peut pas atteindre la base de l'élève.
 *
 * ════════════════════════════════════════════════════════════════════════
 * POURQUOI UN VRAI NAVIGATEUR
 * ════════════════════════════════════════════════════════════════════════
 * Les garanties ci-dessus sont des propriétés du MOTEUR DE BASE DE DONNÉES
 * du navigateur, pas du nôtre. Les simuler reviendrait à écrire le
 * comportement qu'on espère, puis à vérifier qu'il est bien celui qu'on a
 * écrit. Le seul juge est un vrai Chromium.
 *
 * ════════════════════════════════════════════════════════════════════════
 * LE CODE TESTÉ EST LE CODE DE PRODUCTION
 * ════════════════════════════════════════════════════════════════════════
 * Le serveur ci-dessous sert `lib/offline/*.ts` — les fichiers réels, dont
 * seuls les types sont retirés. Aucun bundle, aucune copie, aucune
 * réécriture : ce qui s'exécute dans la page est, ligne pour ligne, ce qui
 * s'exécutera sur le téléphone de l'élève.
 *
 * ════════════════════════════════════════════════════════════════════════
 * UN SEUL FICHIER, ET C'EST VOULU
 * ════════════════════════════════════════════════════════════════════════
 * Tout le code Node tient ici, comme dans les autres tests du dépôt. Le
 * découper en modules obligerait à choisir entre une extension d'import que
 * TypeScript refuse et une résolution que `tsx` et Node ne traitent pas de
 * la même façon — un risque de panne d'outillage, pris pour un confort de
 * lecture, sur un fichier que des titres suffisent à parcourir.
 *
 * ════════════════════════════════════════════════════════════════════════
 * AUCUN TEST N'APPROCHE LA BASE DE L'ÉLÈVE
 * ════════════════════════════════════════════════════════════════════════
 * Chaque scénario ouvre une base à lui,
 * `seth-offline-idb-tests-<runId>-<scenario>`, et la supprime en partant.
 * Ce n'est pas seulement une règle de bonne conduite :
 * `MoteurIndexedDB.pourTests` REFUSE tout nom qui ne porte pas ce préfixe,
 * donc `seth-offline` est hors d'atteinte depuis ici.
 */

/** Racine du dépôt — `scripts/tests/idb/` en remonte de trois. */
const RACINE = resolve(dirname(fileURLToPath(import.meta.url)), "..", "..", "..");

const PREFIXE_BASES_DE_TEST = "seth-offline-idb-tests-";

/* ════════════════════════════════════════════════════════════════════════
 * I. TROUVER UN NAVIGATEUR — SANS EN INSTALLER UN
 * ════════════════════════════════════════════════════════════════════════
 * `playwright-core` pilote un navigateur ; il n'en télécharge aucun. C'est
 * volontaire : ajouter 150 Mo de Chromium à `npm install` pour une poignée
 * de tests serait payé par tout le monde, tout le temps.
 *
 * Conséquence assumée : sur une machine sans navigateur, ces tests ne
 * s'exécutent pas. Ils ne DOIVENT PAS échouer pour autant — un test rouge
 * signifie « le code est cassé », jamais « la machine est nue ». Voir la
 * sortie 0 et le message explicite, tout en bas de ce fichier.
 */

function candidats(): string[] {
  const liste: string[] = [];
  const parEnv = process.env.CHROME_PATH ?? process.env.CHROMIUM_PATH ?? "";
  if (parEnv) liste.push(parEnv);

  liste.push(
    // macOS
    "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
    "/Applications/Google Chrome Canary.app/Contents/MacOS/Google Chrome Canary",
    "/Applications/Chromium.app/Contents/MacOS/Chromium",
    "/Applications/Microsoft Edge.app/Contents/MacOS/Microsoft Edge",
    // Linux
    "/usr/bin/google-chrome",
    "/usr/bin/google-chrome-stable",
    "/usr/bin/chromium",
    "/usr/bin/chromium-browser",
    "/snap/bin/chromium",
  );

  // Un Chromium déjà déposé par Playwright ailleurs sur la machine.
  const depot = process.env.PLAYWRIGHT_BROWSERS_PATH;
  if (depot && existsSync(depot)) {
    for (const entree of readdirSync(depot)) {
      if (!entree.startsWith("chromium")) continue;
      liste.push(
        join(depot, entree, "chrome-linux", "chrome"),
        join(depot, entree, "chrome-mac", "Chromium.app", "Contents", "MacOS", "Chromium"),
      );
    }
  }
  return liste;
}

/** Chemin du premier navigateur utilisable, ou `null` s'il n'y en a aucun. */
function trouverNavigateur(): string | null {
  for (const chemin of candidats()) {
    if (chemin && existsSync(chemin)) return chemin;
  }
  return null;
}

/* ════════════════════════════════════════════════════════════════════════
 * II. SERVIR LE CODE RÉEL
 * ════════════════════════════════════════════════════════════════════════
 * IndexedDB exige une origine : `file://` et `about:blank` ne suffisent pas.
 * D'où ce serveur, qui n'écoute que sur la boucle locale, sur un port
 * attribué par le système, le temps du test.
 */

/**
 * `stripTypeScriptTypes`, l'effaceur de types intégré à Node (≥ 22.13).
 *
 * `@types/node` est encore en ^20 dans ce dépôt et ne le déclare pas ; le
 * détour par une signature explicite évite de toucher aux dépendances pour
 * une fonction que le runtime, lui, expose bel et bien.
 */
type Effaceur = (code: string, options: { mode: "strip" | "transform" }) => string;
const stripTypeScriptTypes = (moduleNode as unknown as { stripTypeScriptTypes?: Effaceur })
  .stripTypeScriptTypes;

/** `@/lib/offline/schema` → `/@/lib/offline/schema` : le serveur fait le reste. */
function reecrireSpecificateurs(source: string): string {
  return source.replace(/(\bfrom\s*|\bimport\s*\(\s*)(["'])@\/([^"']+)\2/g, "$1$2/@/$3$2");
}

async function moduleTranspile(cheminRelatif: string): Promise<string | null> {
  // `..` interdit : le serveur ne sort pas du dépôt.
  const sur = normalize(cheminRelatif).replace(/^(\.\.[/\\])+/, "");
  if (!stripTypeScriptTypes) {
    throw new Error(
      "Node ne sait pas effacer les types (stripTypeScriptTypes absent) : Node 22.13 ou plus est nécessaire pour servir les modules de lib/offline au navigateur.",
    );
  }
  for (const candidat of [sur, `${sur}.ts`, join(sur, "index.ts")]) {
    const absolu = join(RACINE, candidat);
    if (!absolu.startsWith(RACINE) || !existsSync(absolu)) continue;
    const source = await readFile(absolu, "utf8");
    // `transform` et non `strip` : `ErreurStockage` déclare sa cause en
    // propriété de constructeur, syntaxe que le simple effacement refuse.
    const js = stripTypeScriptTypes(source, { mode: "transform" });
    return reecrireSpecificateurs(js);
  }
  return null;
}

const PAGE_VIDE = `<!doctype html><html lang="fr"><head><meta charset="utf-8">
<title>harnais idb</title></head><body></body></html>`;

async function demarrerServeur(): Promise<{ origine: string; arreter: () => Promise<void> }> {
  const serveur: Server = createServer((requete, reponse) => {
    const chemin = (requete.url ?? "/").split("?")[0];
    if (chemin === "/" || chemin === "/index.html") {
      reponse.writeHead(200, { "content-type": "text/html; charset=utf-8" });
      reponse.end(PAGE_VIDE);
      return;
    }
    if (chemin === "/favicon.ico") {
      reponse.writeHead(204).end();
      return;
    }
    if (chemin.startsWith("/@/")) {
      moduleTranspile(decodeURIComponent(chemin.slice(3)))
        .then((js) => {
          if (js === null) {
            reponse.writeHead(404).end("module introuvable");
            return;
          }
          reponse.writeHead(200, { "content-type": "text/javascript; charset=utf-8" });
          reponse.end(js);
        })
        .catch((erreur: unknown) => {
          reponse.writeHead(500).end(String(erreur));
        });
      return;
    }
    reponse.writeHead(404).end("introuvable");
  });

  await new Promise<void>((ok) => serveur.listen(0, "127.0.0.1", ok));
  const adresse = serveur.address();
  const port = typeof adresse === "object" && adresse !== null ? adresse.port : 0;
  return {
    origine: `http://127.0.0.1:${port}`,
    arreter: () => new Promise<void>((ok) => serveur.close(() => ok())),
  };
}

/* ════════════════════════════════════════════════════════════════════════
 * III. L'ATELIER
 * ════════════════════════════════════════════════════════════════════════ */

interface Atelier {
  /** Identifiant de cette exécution — il rend les bases uniques d'un lancement à l'autre. */
  readonly runId: string;
  /** Nom de la base isolée d'un scénario. */
  nomBase(scenario: string): string;
  /**
   * Une page NEUVE sur la même origine — donc sur le même stockage.
   *
   * Un autre contexte de navigateur aurait un stockage à lui : la base
   * préparée à l'étape précédente serait introuvable, et le test passerait
   * en ne prouvant rien.
   */
  nouvellePage(): Promise<Page>;
  /** Supprime les bases de test et rend celles qui auraient survécu. */
  nettoyer(): Promise<string[]>;
  fermer(): Promise<void>;
}

async function ouvrirAtelier(executable: string): Promise<Atelier> {
  const { chromium } = await import("playwright-core");
  const serveur = await demarrerServeur();
  const navigateur: Browser = await chromium.launch({
    executablePath: executable,
    args: ["--no-sandbox", "--disable-dev-shm-usage"],
  });
  const contexte: BrowserContext = await navigateur.newContext();
  const pages: Page[] = [];
  const runId = `${process.pid}-${Date.now().toString(36)}`;

  return {
    runId,
    nomBase: (scenario) => `${PREFIXE_BASES_DE_TEST}${runId}-${scenario}`,

    async nouvellePage() {
      const page = await contexte.newPage();
      page.on("pageerror", (erreur) => console.error("  [page]", erreur.message));
      page.on("console", (message) => {
        if (message.type() === "error") console.error("  [console]", message.text());
      });
      await page.goto(`${serveur.origine}/`);
      pages.push(page);
      return page;
    },

    async nettoyer() {
      const page = await contexte.newPage();
      await page.goto(`${serveur.origine}/`);
      const restantes = await page.evaluate(async (prefixe: string) => {
        const toutes = await indexedDB.databases();
        const nôtres = toutes
          .map((b) => b.name ?? "")
          .filter((nom) => nom.startsWith(prefixe));
        for (const nom of nôtres) {
          await new Promise<void>((ok) => {
            const demande = indexedDB.deleteDatabase(nom);
            demande.onsuccess = () => ok();
            demande.onerror = () => ok();
            // Une base encore ouverte quelque part bloquerait la suppression :
            // on ne veut pas d'attente infinie, on veut le CONSTAT.
            demande.onblocked = () => ok();
          });
        }
        const apres = await indexedDB.databases();
        return apres.map((b) => b.name ?? "").filter((nom) => nom.startsWith(prefixe));
      }, PREFIXE_BASES_DE_TEST);
      await page.close();
      return restantes;
    },

    async fermer() {
      for (const page of pages) {
        if (!page.isClosed()) await page.close();
      }
      await contexte.close();
      await navigateur.close();
      await serveur.arreter();
    },
  };
}

/* ════════════════════════════════════════════════════════════════════════
 * IV. LE COMPTEUR — même forme que les autres tests du dépôt
 * ════════════════════════════════════════════════════════════════════════ */

type Testeur = (nom: string, fn: () => Promise<void> | void) => Promise<void>;

function compteur() {
  let réussis = 0;
  let échecs = 0;
  const test: Testeur = async (nom, fn) => {
    try {
      await fn();
      réussis += 1;
      console.log(`ok - ${nom}`);
    } catch (erreur) {
      échecs += 1;
      console.error(`ÉCHEC - ${nom}`);
      console.error(erreur);
    }
  };
  return {
    test,
    get réussis() {
      return réussis;
    },
    get échecs() {
      return échecs;
    },
  };
}

/** Les arborescences qui composent l'application livrée. */
const ARBRES = ["app", "components", "hooks", "lib"] as const;

/** La seule définition légitime de la seam. */
const DEFINITION = join("lib", "offline", "idb.ts");

const EXTENSIONS = [".ts", ".tsx", ".mts", ".js", ".jsx", ".mjs"];

async function fichiers(racine: string, arbre: string): Promise<string[]> {
  const trouves: string[] = [];
  async function descendre(dossier: string): Promise<void> {
    let entrees;
    try {
      entrees = await readdir(dossier, { withFileTypes: true });
    } catch {
      return; // arbre absent : signalé par le test, pas ici
    }
    for (const entree of entrees) {
      const chemin = join(dossier, entree.name);
      if (entree.isDirectory()) {
        if (entree.name === "node_modules" || entree.name.startsWith(".")) continue;
        await descendre(chemin);
        continue;
      }
      if (EXTENSIONS.some((ext) => entree.name.endsWith(ext))) trouves.push(chemin);
    }
  }
  await descendre(join(racine, arbre));
  return trouves;
}

/** Les fichiers de l'application qui mentionnent `motif`, chemins relatifs à la racine. */
async function mentions(racine: string, motif: RegExp): Promise<string[]> {
  const coupables: string[] = [];
  for (const arbre of ARBRES) {
    for (const chemin of await fichiers(racine, arbre)) {
      const source = await readFile(chemin, "utf8");
      if (motif.test(source)) coupables.push(relative(racine, chemin).split(sep).join(sep));
    }
    motif.lastIndex = 0;
  }
  return coupables.sort();
}

/**
 * Les contrôles, isolés de leur exécution : `racine` est un paramètre pour
 * qu'ils puissent être retournés contre une arborescence factice — un test
 * de garde-fou qui ne sait pas échouer ne garde rien.
 */
const controles = {
  async usagesDeLaSeam(racine: string): Promise<string[]> {
    return mentions(racine, /\bpourTests\b/);
  },
  async appelsDirectsAIndexedDbOpen(racine: string): Promise<string[]> {
    return mentions(racine, /indexedDB\s*\.\s*open\s*\(/);
  },
};

async function garde_fous(test: Testeur): Promise<void> {
  await test("G1. `pourTests` n'apparaît QUE dans lib/offline/idb.ts", async () => {
    const usages = await controles.usagesDeLaSeam(RACINE);
    assert.deepEqual(
      usages,
      [DEFINITION],
      "La seam de test est mentionnée hors de sa définition. Un écran qui l'appelle écrirait dans une base jetable, et la séance de l'élève partirait avec.",
    );
  });

  await test("G2. `indexedDB.open` n'apparaît QUE dans lib/offline/idb.ts", async () => {
    const appels = await controles.appelsDirectsAIndexedDbOpen(RACINE);
    assert.deepEqual(
      appels,
      [DEFINITION],
      "Une ouverture de base hors du moteur échapperait à `onblocked`, à `onversionchange` et à la fermeture des connexions fantômes — les trois garanties que ce chantier passe son temps à prouver.",
    );
  });

  await test("G3. les garde-fous savent DÉTECTER une violation", async () => {
    // Sans cette vérification, G1 et G2 pourraient passer parce qu'ils ne
    // lisent rien du tout — un chemin faux, une extension oubliée — et
    // annoncer « aucun usage » sur un dépôt qu'ils n'ont jamais ouvert.
    const faux = await mkdtemp(join(tmpdir(), "garde-fous-"));
    await mkdir(join(faux, "components", "student"), { recursive: true });
    await writeFile(
      join(faux, "components", "student", "Coupable.tsx"),
      "const moteur = MoteurIndexedDB.pourTests({ nomBase: 'x', version: 1 });\nindexedDB.open('x', 1);\n",
      "utf8",
    );

    assert.deepEqual(await controles.usagesDeLaSeam(faux), [
      join("components", "student", "Coupable.tsx"),
    ]);
    assert.deepEqual(await controles.appelsDirectsAIndexedDbOpen(faux), [
      join("components", "student", "Coupable.tsx"),
    ]);
  });

  await test("G4. les quatre arborescences ont bien été lues", async () => {
    // Une faute de chemin ferait passer G1 et G2 sur le vide.
    for (const arbre of ARBRES) {
      const lus = await fichiers(RACINE, arbre);
      assert.ok(lus.length > 0, `aucun fichier lu sous ${arbre}/ — le contrôle porterait sur rien`);
    }
  });
}

const MODULES = {
  idb: "/@/lib/offline/idb.ts",
  depot: "/@/lib/offline/depot.ts",
  schema: "/@/lib/offline/schema.ts",
  brut: "/@/scripts/tests/idb/page/idb-brut.ts",
} as const;

const A = "11111111-1111-4111-8111-aaaaaaaaaaaa";
const SEANCE = "33333333-3333-4333-8333-111111111111";
const SEANCE_ILLISIBLE = "55555555-5555-4555-8555-999999999999";
const DATE_METIER = "2026-08-09";
const T0 = 1_786_000_000_000;

/**
 * Les clés sont écrites À LA MAIN, pas via `schema.ts`.
 *
 * Un test de persistance qui construirait ses clés avec le code qu'il teste
 * survivrait à un changement de séparateur sans rien dire — alors que ce
 * changement rendrait, lui, illisibles toutes les séances déjà sur les
 * téléphones. Ici, ce jour-là, ce test devient rouge.
 */
const CLE_COMPTE_SEANCE = `${A}:${SEANCE}`;
const CLE_COMPTE_DATE = `${A}:${DATE_METIER}`;
const CLE_COMPTE_ILLISIBLE = `${A}:${SEANCE_ILLISIBLE}`;

/** Un retour d'entraînement complet — la forme exacte attendue par l'API. */
const RETOUR = {
  studentId: "",
  sessionKey: "s1",
  sessionRefLabel: "Haut du corps",
  completed: true,
  globalRpe: 8,
  globalComment: "épaule droite un peu raide",
  pain: "",
  exercises: [
    {
      exerciseName: "Développé couché",
      exerciseOrder: 0,
      rpe: 8,
      comment: "",
      sets: [{ setNumber: 1, loadUsed: "80", repsDone: "10" }],
    },
  ],
  sessionId: SEANCE,
  durationMinutes: 62,
  performedAt: DATE_METIER,
};

/* ════════════════════════════════════════════════════════════════════════
 * A40-A — LA PROPRIÉTÉ INDEXEDDB
 * ════════════════════════════════════════════════════════════════════════
 * Toute la stratégie hors ligne repose sur une affirmation qui n'est écrite
 * nulle part dans notre code : une montée de version d'IndexedDB conserve
 * les données des magasins qu'on ne touche pas.
 *
 * Si elle était fausse, `SCHEMA_VERSION = 2` suffirait un jour à effacer les
 * séances non synchronisées de tous les élèves à la fois, à la première
 * ouverture de l'application, sans erreur et sans trace. Elle mérite donc
 * d'être vérifiée sur le vrai moteur du navigateur, et non supposée.
 *
 * La vérification est double, et c'est délibéré :
 *   1. inspection PHYSIQUE de la base — ce qui est réellement sur le disque ;
 *   2. lecture par `DepotOffline` — ce que l'application en fait.
 * L'une sans l'autre laisserait passer la panne la plus vicieuse : des
 * données intactes que le dépôt ne rend plus, ou un dépôt qui répond bien
 * alors que le disque a été vidé.
 */
async function a40A(test: Testeur, atelier: Atelier): Promise<void> {
  const nomBase = atelier.nomBase("a40-a");
  const versionN = 1;
  const versionN1 = 2;

  const page = await atelier.nouvellePage();
  const avant = await page.evaluate(
    async (c) => {
      const brut = (await import(c.modules.brut)) as typeof import("./page/idb-brut");
      const schema = (await import(c.modules.schema)) as typeof import("../../../lib/offline/schema");

      const compatible = schema.SCHEMA_VERSION;
      const illisible = schema.SCHEMA_VERSION + 1;

      // ── Étape 1 : une base en version N, remplie à mains nues ──────────
      const { base } = await brut.ouvrirBrut(c.nomBase, c.versionN, (b) => {
        for (const magasin of Object.values(schema.MAGASINS)) b.createObjectStore(magasin);
      });

      await brut.ecrire(base, [
        {
          magasin: schema.MAGASINS.snapshot,
          cle: c.cleDate,
          valeur: {
            schemaVersion: compatible,
            userId: c.userId,
            businessDate: c.dateMetier,
            sessionId: c.sessionId,
            payload: { blocs: ["développé couché"] },
            syncedAt: c.t0,
          },
        },
        {
          magasin: schema.MAGASINS.brouillon,
          cle: c.cleSeance,
          valeur: {
            schemaVersion: compatible,
            userId: c.userId,
            sessionId: c.sessionId,
            revision: 3,
            businessDate: c.dateMetier,
            payload: { charge: "80" },
            updatedAt: c.t0,
            syncStatus: "en_attente",
          },
        },
        {
          magasin: schema.MAGASINS.outbox,
          cle: c.cleSeance,
          valeur: {
            schemaVersion: compatible,
            userId: c.userId,
            operationId: "op-en-attente",
            revision: 3,
            sessionId: c.sessionId,
            payload: c.retour,
            createdAt: c.t0,
            updatedAt: c.t0,
            attempts: 1,
            lastAttemptAt: c.t0,
            lastError: "réseau indisponible",
          },
        },
        {
          // L'ENREGISTREMENT QUE CE CODE NE SAIT PAS LIRE.
          // Il n'est pas là par accident : c'est le cas qu'une migration
          // pressée « nettoierait ». Il doit survivre à tout, sans jamais
          // être envoyé.
          magasin: schema.MAGASINS.outbox,
          cle: c.cleIllisible,
          valeur: {
            schemaVersion: illisible,
            userId: c.userId,
            operationId: "op-du-futur",
            revision: 1,
            sessionId: c.sessionIllisible,
            payload: { forme: "inconnue" },
            createdAt: c.t0,
            updatedAt: c.t0,
            attempts: 0,
            lastAttemptAt: null,
            lastError: null,
          },
        },
        {
          magasin: schema.MAGASINS.affichage,
          cle: c.userId,
          valeur: {
            schemaVersion: compatible,
            userId: c.userId,
            accessType: "programme_seul",
            updatedAt: c.t0,
          },
        },
      ]);

      const etatInitial = { magasins: brut.magasins(base), contenu: await brut.contenu(base) };
      await brut.fermer(base);

      // ── Étape 2 : une VRAIE montée de version, qui ne touche à rien ────
      // `onupgradeneeded` ne crée rien et ne supprime rien : c'est
      // exactement la propriété d'IndexedDB qui est en jeu, isolée de notre
      // code.
      const monte = await brut.ouvrirBrut(c.nomBase, c.versionN1);
      const versionApresMontee = monte.base.version;
      await brut.fermer(monte.base);

      return { etatInitial, versionApresMontee, illisible, compatible };
    },
    {
      modules: MODULES,
      nomBase,
      versionN,
      versionN1,
      userId: A,
      sessionId: SEANCE,
      sessionIllisible: SEANCE_ILLISIBLE,
      dateMetier: DATE_METIER,
      cleDate: CLE_COMPTE_DATE,
      cleSeance: CLE_COMPTE_SEANCE,
      cleIllisible: CLE_COMPTE_ILLISIBLE,
      retour: RETOUR,
      t0: T0,
    },
  );

  // Toutes les connexions de la première page disparaissent avec elle.
  await page.close();

  const page2 = await atelier.nouvellePage();
  const apres = await page2.evaluate(
    async (c) => {
      const brut = (await import(c.modules.brut)) as typeof import("./page/idb-brut");
      const idb = (await import(c.modules.idb)) as typeof import("../../../lib/offline/idb");
      const depotModule = (await import(c.modules.depot)) as typeof import("../../../lib/offline/depot");

      // ── Vérification 1 : le disque, sans passer par notre code ─────────
      const { base } = await brut.ouvrirBrut(c.nomBase, c.versionN1);
      const physique = {
        version: base.version,
        magasins: brut.magasins(base),
        contenu: await brut.contenu(base),
      };
      await brut.fermer(base);

      // ── Vérification 2 : ce que l'application en lit ───────────────────
      const moteur = idb.MoteurIndexedDB.pourTests({ nomBase: c.nomBase, version: c.versionN1 });
      const depot = new depotModule.DepotOffline(moteur);

      const lu = {
        snapshot: await depot.lireSnapshot(c.userId, c.dateMetier),
        brouillon: await depot.lireBrouillon(c.userId, c.sessionId),
        operation: await depot.lireOperation(c.userId, c.sessionId),
        operationIllisible: await depot.lireOperation(c.userId, c.sessionIllisible),
        enAttente: await depot.operationsEnAttente(c.userId),
        typeAcces: await depot.lireTypeAcces(c.userId),
      };
      await moteur.fermer();

      // ── Et après la lecture, le disque n'a pas bougé ───────────────────
      const relu = await brut.ouvrirBrut(c.nomBase, c.versionN1);
      const physiqueApresLecture = await brut.contenu(relu.base);
      await brut.fermer(relu.base);

      return { physique, lu, physiqueApresLecture };
    },
    {
      modules: MODULES,
      nomBase,
      versionN1,
      userId: A,
      sessionId: SEANCE,
      sessionIllisible: SEANCE_ILLISIBLE,
      dateMetier: DATE_METIER,
    },
  );

  await test("A40-A/1. la montée N → N+1 a bien eu lieu", () => {
    assert.equal(avant.versionApresMontee, versionN1);
    assert.equal(apres.physique.version, versionN1, "la base relue n'est pas en version N+1");
  });

  await test("A40-A/2. INSPECTION PHYSIQUE — pas un octet perdu dans la montée de version", () => {
    assert.deepEqual(
      apres.physique.magasins,
      avant.etatInitial.magasins,
      "un magasin a disparu pendant la montée de version",
    );
    assert.deepEqual(
      apres.physique.contenu,
      avant.etatInitial.contenu,
      "le contenu de la base a changé pendant une montée de version — c'est la séance non synchronisée de l'élève qui part avec",
    );
  });

  await test("A40-A/3. INSPECTION PHYSIQUE — l'opération en attente est intacte, champ par champ", () => {
    const outbox = apres.physique.contenu["training_outbox"];
    const operation = outbox[CLE_COMPTE_SEANCE] as Record<string, unknown>;
    assert.ok(operation, "l'opération en attente a disparu de la base");
    assert.equal(operation.operationId, "op-en-attente", "l'identifiant d'idempotence a bougé");
    assert.equal(operation.revision, 3, "la révision a bougé : l'acquittement supprimerait une correction");
    assert.equal(operation.attempts, 1);
    assert.equal(operation.lastError, "réseau indisponible");
    assert.deepEqual(operation.payload, RETOUR, "le retour à envoyer a été altéré");
  });

  await test("A40-A/4. LECTURE PAR LE DÉPÔT — tout le compatible est rendu", () => {
    assert.ok(apres.lu.snapshot, "le snapshot n'est plus lisible après la montée de version");
    assert.equal(apres.lu.snapshot?.sessionId, SEANCE);
    assert.ok(apres.lu.brouillon, "le brouillon n'est plus lisible");
    assert.equal(apres.lu.brouillon?.revision, 3);
    assert.equal(apres.lu.brouillon?.businessDate, DATE_METIER, "la date métier de la séance a glissé");
    assert.ok(apres.lu.operation, "l'opération en attente n'est plus lisible");
    assert.equal(apres.lu.operation?.operationId, "op-en-attente");
    assert.equal(apres.lu.typeAcces, "programme_seul");
  });

  await test("A40-A/5. LECTURE PAR LE DÉPÔT — une seule opération synchronisable, la bonne", () => {
    assert.equal(
      apres.lu.enAttente.length,
      1,
      "le dépôt propose à l'envoi un nombre d'opérations inattendu",
    );
    assert.equal(apres.lu.enAttente[0]?.sessionId, SEANCE);
    assert.equal(
      apres.lu.operationIllisible,
      null,
      "un enregistrement d'une version inconnue a été rendu comme s'il était compris",
    );
  });

  await test("A40-A/6. l'enregistrement illisible est TOUJOURS sur le disque, jamais effacé", () => {
    const outbox = apres.physiqueApresLecture["training_outbox"];
    const orphelin = outbox[CLE_COMPTE_ILLISIBLE] as Record<string, unknown> | undefined;
    assert.ok(
      orphelin,
      "l'enregistrement d'une version inconnue a été supprimé — c'est une saisie d'élève jetée pour simplifier la lecture",
    );
    assert.equal(orphelin?.schemaVersion, avant.illisible);
    assert.equal(orphelin?.operationId, "op-du-futur");
    assert.deepEqual(
      apres.physiqueApresLecture,
      avant.etatInitial.contenu,
      "la lecture par le dépôt a modifié la base — une lecture ne doit RIEN écrire",
    );
  });

  await page2.close();
}

/* ════════════════════════════════════════════════════════════════════════
 * A40-B — NOTRE `onupgradeneeded`
 * ════════════════════════════════════════════════════════════════════════
 * A40-A prouve ce que fait IndexedDB. A40-B prouve ce que fait NOTRE code
 * quand il monte une base : ajouter les magasins manquants, et rien d'autre.
 *
 * La base de départ est volontairement incomplète — deux magasins sur
 * quatre — parce que c'est l'état réel d'un téléphone qui a connu une
 * version antérieure de l'application. Elle contient déjà une opération en
 * attente, dans un magasin qui existe : c'est elle qu'une migration
 * maladroite emporterait.
 */
async function a40B(test: Testeur, atelier: Atelier): Promise<void> {
  const nomBase = atelier.nomBase("a40-b");
  const versionN = 1;
  const versionN1 = 2;

  const page = await atelier.nouvellePage();
  const resultat = await page.evaluate(
    async (c) => {
      const brut = (await import(c.modules.brut)) as typeof import("./page/idb-brut");
      const idb = (await import(c.modules.idb)) as typeof import("../../../lib/offline/idb");
      const schema = (await import(c.modules.schema)) as typeof import("../../../lib/offline/schema");

      const operation = {
        schemaVersion: schema.SCHEMA_VERSION,
        userId: c.userId,
        operationId: "op-avant-migration",
        revision: 7,
        sessionId: c.sessionId,
        payload: c.retour,
        createdAt: c.t0,
        updatedAt: c.t0,
        attempts: 2,
        lastAttemptAt: c.t0,
        lastError: null,
      };

      // ── Une base d'AVANT : deux magasins sur quatre ────────────────────
      const depart = await brut.ouvrirBrut(c.nomBase, c.versionN, (b) => {
        b.createObjectStore(schema.MAGASINS.outbox);
        b.createObjectStore(schema.MAGASINS.snapshot);
      });
      await brut.ecrire(depart.base, [
        { magasin: schema.MAGASINS.outbox, cle: c.cleSeance, valeur: operation },
      ]);
      const avant = {
        magasins: brut.magasins(depart.base),
        contenu: await brut.contenu(depart.base),
      };
      await brut.fermer(depart.base);

      // ── La montée, par le VRAI chemin du moteur ────────────────────────
      const espion = brut.espionnerDestructions();
      const moteur = idb.MoteurIndexedDB.pourTests({ nomBase: c.nomBase, version: c.versionN1 });
      // Une opération quelconque suffit à déclencher l'ouverture : le moteur
      // n'ouvre rien à la construction, c'est justement ce qui permet à un
      // composant de l'instancier sans réveiller le disque.
      const clesOutbox = await moteur.cles(schema.MAGASINS.outbox);
      const destructions = [...espion.appels];
      espion.restaurer();

      const pendant = await brut.ouvrirBrut(c.nomBase, c.versionN1);
      const apresMontee = {
        version: pendant.base.version,
        magasins: brut.magasins(pendant.base),
        contenu: await brut.contenu(pendant.base),
      };
      await brut.fermer(pendant.base);
      await moteur.fermer();

      // ── Et après fermeture puis réouverture ────────────────────────────
      const relu = await brut.ouvrirBrut(c.nomBase, c.versionN1);
      const apresReouverture = {
        magasins: brut.magasins(relu.base),
        contenu: await brut.contenu(relu.base),
      };
      await brut.fermer(relu.base);

      return {
        avant,
        apresMontee,
        apresReouverture,
        destructions,
        clesOutbox,
        magasinsAttendus: Object.values(schema.MAGASINS).sort(),
      };
    },
    {
      modules: MODULES,
      nomBase,
      versionN,
      versionN1,
      userId: A,
      sessionId: SEANCE,
      cleSeance: CLE_COMPTE_SEANCE,
      retour: RETOUR,
      t0: T0,
    },
  );

  await test("A40-B/1. les magasins manquants sont créés, les existants conservés", () => {
    assert.deepEqual(resultat.avant.magasins, ["training_outbox", "training_snapshot"]);
    assert.deepEqual(
      resultat.apresMontee.magasins,
      resultat.magasinsAttendus,
      "après la montée, la base ne porte pas exactement les quatre magasins du schéma",
    );
    const apres: readonly string[] = resultat.apresMontee.magasins;
    for (const existant of resultat.avant.magasins) {
      assert.ok(
        apres.includes(existant),
        `le magasin ${existant} existait avant la montée et n'existe plus après`,
      );
    }
    assert.equal(resultat.apresMontee.version, 2);
  });

  await test("A40-B/2. AUCUNE destruction : ni deleteObjectStore, ni clear, ni deleteDatabase", () => {
    assert.deepEqual(
      resultat.destructions,
      [],
      "la montée de version détruit quelque chose. « Repartir sur une base propre » revient à jeter le travail de l'élève pour simplifier le nôtre.",
    );
  });

  await test("A40-B/3. l'opération en attente traverse la montée sans une égratignure", () => {
    const avant = resultat.avant.contenu["training_outbox"][CLE_COMPTE_SEANCE];
    const apres = resultat.apresMontee.contenu["training_outbox"][CLE_COMPTE_SEANCE];
    assert.deepEqual(apres, avant, "l'opération en attente a été modifiée par la montée de version");
    assert.deepEqual(
      resultat.clesOutbox,
      [CLE_COMPTE_SEANCE],
      "le moteur ne voit pas l'opération qui était déjà là",
    );
  });

  await test("A40-B/4. et elle est encore là après fermeture puis réouverture", () => {
    assert.deepEqual(
      resultat.apresReouverture.magasins,
      resultat.magasinsAttendus,
      "les magasins créés pendant la montée n'ont pas survécu à la fermeture",
    );
    assert.deepEqual(
      resultat.apresReouverture.contenu["training_outbox"][CLE_COMPTE_SEANCE],
      resultat.avant.contenu["training_outbox"][CLE_COMPTE_SEANCE],
      "l'opération en attente n'a pas survécu à la réouverture",
    );
  });

  await page.close();
}

/* ════════════════════════════════════════════════════════════════════════
 * BLOCAGE, REPRISE, ET CONNEXION FANTÔME
 * ════════════════════════════════════════════════════════════════════════
 * Deux onglets de l'application, c'est la situation ordinaire : l'élève a
 * ouvert sa séance ce matin et la rouvre à la salle. Quand la version du
 * schéma change, l'onglet du matin bloque la montée du second.
 *
 * Trois exigences se tiennent ici, et la troisième est invisible :
 *   1. le blocage est SIGNALÉ tout de suite (`bloquee`), pas attendu ;
 *   2. une fois l'onglet gênant fermé, le MÊME moteur repart — sans quoi
 *      il faudrait tuer l'application pour retrouver son stockage local ;
 *   3. la connexion que la demande bloquée finit par obtenir, et que plus
 *      personne n'attend, est FERMÉE. Sinon elle survit, invisible, et
 *      bloque à son tour la montée suivante — depuis un onglet que
 *      l'utilisateur croit avoir fermé.
 */
async function blocageEtFantome(test: Testeur, atelier: Atelier): Promise<void> {
  const nomBase = atelier.nomBase("blocage");

  const page = await atelier.nouvellePage();
  const resultat = await page.evaluate(
    async (c) => {
      const brut = (await import(c.modules.brut)) as typeof import("./page/idb-brut");
      const idb = (await import(c.modules.idb)) as typeof import("../../../lib/offline/idb");
      const schema = (await import(c.modules.schema)) as typeof import("../../../lib/offline/schema");

      const traceur = brut.tracerConnexions(c.nomBase);
      try {
        // ── L'autre onglet : ouvert en version N, et qui ne lâche rien ───
        // Aucun `onversionchange` : il se comporte comme une page figée,
        // le pire cas et le plus banal.
        const gene = await brut.ouvrirBrut(c.nomBase, 1, (b) => {
          for (const magasin of Object.values(schema.MAGASINS)) b.createObjectStore(magasin);
        });

        // ── Notre moteur, qui veut monter en N+1 ────────────────────────
        const moteur = idb.MoteurIndexedDB.pourTests({ nomBase: c.nomBase, version: 2 });

        let refus: ReturnType<typeof brut.decrireErreur> | null = null;
        try {
          await moteur.cles(schema.MAGASINS.outbox);
        } catch (erreur) {
          refus = brut.decrireErreur(erreur);
        }
        const apresRefus = traceur.etat();

        // ── L'onglet gênant se ferme ────────────────────────────────────
        await brut.fermer(gene.base);
        // Le temps que la demande bloquée aboutisse et que le moteur ferme
        // la connexion dont plus personne ne veut.
        await new Promise((ok) => setTimeout(ok, 150));
        const apresLiberation = traceur.etat();

        // ── REPRISE sur le MÊME moteur ──────────────────────────────────
        let reprise: { ok: boolean; cles: string[]; erreur: unknown } = {
          ok: false,
          cles: [],
          erreur: null,
        };
        try {
          reprise = { ok: true, cles: await moteur.cles(schema.MAGASINS.outbox), erreur: null };
        } catch (erreur) {
          reprise = { ok: false, cles: [], erreur: brut.decrireErreur(erreur) };
        }

        await moteur.fermer();
        await new Promise((ok) => setTimeout(ok, 50));
        const apresFermeture = traceur.etat();

        // ── Preuve indépendante : une montée en N+2 n'est PAS bloquée ───
        // Si une connexion fantôme en version 2 subsistait, celle-ci le
        // serait. C'est le même constat que `vivantes === 0`, obtenu par un
        // chemin qui ne dépend d'aucun espion.
        const suivante = await brut.ouvrirBrut(c.nomBase, 3);
        const bloqueeEnsuite = suivante.bloquee;
        await brut.fermer(suivante.base);

        return { refus, apresRefus, apresLiberation, reprise, apresFermeture, bloqueeEnsuite };
      } finally {
        traceur.restaurer();
      }
    },
    { modules: MODULES, nomBase },
  );

  await test("B1. un autre onglet bloque : le moteur le DIT, immédiatement", () => {
    assert.ok(resultat.refus, "l'ouverture n'a pas été refusée alors qu'une autre connexion bloquait");
    assert.equal(resultat.refus?.nom, "ErreurStockage");
    assert.equal(
      resultat.refus?.cause,
      "bloquee",
      "le blocage doit être distinguable : c'est ce qui permet de dire « une autre fenêtre empêche la mise à jour » au lieu de faire semblant d'enregistrer",
    );
  });

  await test("B2. le MÊME moteur repart une fois l'onglet gênant fermé", () => {
    assert.equal(
      resultat.reprise.ok,
      true,
      `la reprise a échoué (${JSON.stringify(resultat.reprise.erreur)}) — un échec d'ouverture empoisonne le moteur, et il faut relancer l'application pour retrouver son stockage local`,
    );
    assert.deepEqual(resultat.reprise.cles, []);
  });

  await test("B3. AUCUNE connexion fantôme ne survit au refus", () => {
    assert.ok(
      resultat.apresLiberation.total >= 2,
      `la demande bloquée n'a jamais abouti (total=${resultat.apresLiberation.total}) : le scénario ne prouverait rien`,
    );
    assert.equal(
      resultat.apresFermeture.vivantes,
      0,
      "une connexion est restée ouverte sans propriétaire — elle bloquera la prochaine montée de version depuis un onglet que personne ne peut fermer",
    );
  });

  await test("B4. et la montée de version suivante n'est pas bloquée", () => {
    assert.equal(
      resultat.bloqueeEnsuite,
      false,
      "la montée suivante est bloquée : il reste bien une connexion vivante quelque part",
    );
  });

  await page.close();
}

/* ════════════════════════════════════════════════════════════════════════
 * VERSIONCHANGE — L'ANCIEN LÂCHE, LE NOUVEAU PASSE
 * ════════════════════════════════════════════════════════════════════════
 * C'est la contrepartie du blocage. Notre moteur, lui, POSE un
 * `onversionchange` : quand une autre fenêtre demande une version
 * supérieure, il ferme sa connexion au lieu de la retenir. Sans cela, deux
 * onglets de notre propre application se bloqueraient mutuellement à la
 * première mise à jour du schéma.
 *
 * Ce qu'il ne fait PAS, et qui compte autant : adopter la nouvelle version.
 * Un moteur né en version N reste en version N. Le code qui tourne dans
 * l'ancien onglet n'a pas été mis à jour ; le laisser écrire dans une base
 * plus récente, c'est écrire des enregistrements dont il ignore la forme.
 * Il doit échouer en le disant — `version_incompatible`.
 */
async function versionchange(test: Testeur, atelier: Atelier): Promise<void> {
  const nomBase = atelier.nomBase("versionchange");

  const page = await atelier.nouvellePage();
  const resultat = await page.evaluate(
    async (c) => {
      const brut = (await import(c.modules.brut)) as typeof import("./page/idb-brut");
      const idb = (await import(c.modules.idb)) as typeof import("../../../lib/offline/idb");
      const schema = (await import(c.modules.schema)) as typeof import("../../../lib/offline/schema");

      const operation = {
        schemaVersion: schema.SCHEMA_VERSION,
        userId: c.userId,
        operationId: "op-de-l-ancien",
        revision: 1,
        sessionId: c.sessionId,
        payload: c.retour,
        createdAt: c.t0,
        updatedAt: c.t0,
        attempts: 0,
        lastAttemptAt: null,
        lastError: null,
      };

      // ── L'ancien onglet : moteur en version N ───────────────────────────
      const ancien = idb.MoteurIndexedDB.pourTests({ nomBase: c.nomBase, version: 1 });
      await ancien.ecrire(schema.MAGASINS.outbox, c.cleSeance, operation);
      const cibleAncienAuDepart = { ...ancien.cibleVisee };

      // ── Le nouvel onglet : moteur en version N+1 ────────────────────────
      const nouveau = idb.MoteurIndexedDB.pourTests({ nomBase: c.nomBase, version: 2 });
      let montee: { ok: boolean; erreur: unknown } = { ok: false, erreur: null };
      try {
        await nouveau.cles(schema.MAGASINS.outbox);
        montee = { ok: true, erreur: null };
      } catch (erreur) {
        montee = { ok: false, erreur: brut.decrireErreur(erreur) };
      }
      const relueParLeNouveau = await nouveau.lire(schema.MAGASINS.outbox, c.cleSeance);

      // ── L'ancien reprend la main : il doit refuser, en le disant ────────
      let refusAncien: ReturnType<typeof brut.decrireErreur> | null = null;
      try {
        await ancien.cles(schema.MAGASINS.outbox);
      } catch (erreur) {
        refusAncien = brut.decrireErreur(erreur);
      }

      // ── La version n'est pas une variable ───────────────────────────────
      const cibleAncienALaFin = { ...ancien.cibleVisee };
      const gelee = Object.isFrozen(ancien.cibleVisee);
      const mutationRefusee = brut.tenterEcriture(ancien.cibleVisee, "version", 99);
      const versionApresTentative = ancien.cibleVisee.version;

      await ancien.fermer();
      await nouveau.fermer();

      return {
        cibleAncienAuDepart,
        montee,
        relueParLeNouveau,
        refusAncien,
        cibleAncienALaFin,
        gelee,
        mutationRefusee,
        versionApresTentative,
      };
    },
    {
      modules: MODULES,
      nomBase,
      userId: A,
      sessionId: SEANCE,
      cleSeance: CLE_COMPTE_SEANCE,
      retour: RETOUR,
      t0: T0,
    },
  );

  await test("V1. le moteur en N+1 obtient la base — l'ancien a lâché sur `versionchange`", () => {
    assert.equal(
      resultat.montee.ok,
      true,
      `la montée a échoué (${JSON.stringify(resultat.montee.erreur)}) : deux onglets de notre propre application se bloquent mutuellement`,
    );
  });

  await test("V2. la montée n'a rien coûté aux données de l'ancien", () => {
    const relue = resultat.relueParLeNouveau as Record<string, unknown> | null;
    assert.ok(relue, "l'opération écrite avant la montée a disparu");
    assert.equal(relue?.operationId, "op-de-l-ancien");
  });

  await test("V3. l'ancien moteur ÉCHOUE en disant `version_incompatible`", () => {
    assert.ok(
      resultat.refusAncien,
      "l'ancien moteur a réussi à rouvrir : du code qui ne connaît pas le schéma courant écrit dans la base courante",
    );
    assert.equal(resultat.refusAncien?.nom, "ErreurStockage");
    assert.equal(resultat.refusAncien?.cause, "version_incompatible");
  });

  await test("V4. la version visée n'est JAMAIS mutable", () => {
    assert.deepEqual(resultat.cibleAncienAuDepart, { nomBase, version: 1 });
    assert.deepEqual(
      resultat.cibleAncienALaFin,
      { nomBase, version: 1 },
      "le moteur a adopté une autre version en cours de route — `version_incompatible` deviendrait un succès silencieux",
    );
    assert.equal(resultat.gelee, true, "la cible n'est pas gelée");
    assert.equal(resultat.mutationRefusee, true, "la version a pu être réassignée de l'extérieur");
    assert.equal(resultat.versionApresTentative, 1);
  });

  await page.close();
}

/* ════════════════════════════════════════════════════════════════════════
 * LA SEAM ELLE-MÊME
 * ════════════════════════════════════════════════════════════════════════
 * Les garde-fous statiques interdisent d'APPELER `pourTests` depuis
 * l'application. Ceux-ci vérifient que, même appelée, elle ne peut pas
 * atteindre la base de l'élève — et que la cible de production reste
 * exactement celle de `schema.ts`.
 */
async function seam(test: Testeur, atelier: Atelier): Promise<void> {
  const page = await atelier.nouvellePage();
  const resultat = await page.evaluate(
    async (c) => {
      const brut = (await import(c.modules.brut)) as typeof import("./page/idb-brut");
      const idb = (await import(c.modules.idb)) as typeof import("../../../lib/offline/idb");
      const schema = (await import(c.modules.schema)) as typeof import("../../../lib/offline/schema");

      const production = new idb.MoteurIndexedDB();
      return {
        baseDeProduction: brut.leve(() =>
          idb.MoteurIndexedDB.pourTests({ nomBase: schema.NOM_BASE, version: 1 }),
        ),
        autreBase: brut.leve(() =>
          idb.MoteurIndexedDB.pourTests({ nomBase: "une-base-quelconque", version: 1 }),
        ),
        prefixeApprochant: brut.leve(() =>
          idb.MoteurIndexedDB.pourTests({ nomBase: "seth-offline", version: 1 }),
        ),
        versionDecimale: brut.leve(() =>
          idb.MoteurIndexedDB.pourTests({ nomBase: `${c.prefixe}ok`, version: 1.5 }),
        ),
        versionNulle: brut.leve(() =>
          idb.MoteurIndexedDB.pourTests({ nomBase: `${c.prefixe}ok`, version: 0 }),
        ),
        baseDeTestAcceptee: !brut.leve(() =>
          idb.MoteurIndexedDB.pourTests({ nomBase: `${c.prefixe}ok`, version: 2 }),
        ),
        cibleProduction: { ...production.cibleVisee },
        cibleProductionGelee: Object.isFrozen(production.cibleVisee),
        attendu: { nomBase: schema.NOM_BASE, version: schema.SCHEMA_VERSION },
      };
    },
    { modules: MODULES, prefixe: "seth-offline-idb-tests-" },
  );

  await test("S1. `pourTests` refuse la base de production", () => {
    assert.equal(resultat.baseDeProduction, true, "un test peut viser la base de l'élève");
    assert.equal(resultat.prefixeApprochant, true);
    assert.equal(resultat.autreBase, true, "un nom sans le préfixe de test est accepté");
    assert.equal(resultat.baseDeTestAcceptee, true, "une base de test légitime est refusée");
  });

  await test("S2. `pourTests` refuse une version qui n'est pas un entier ≥ 1", () => {
    assert.equal(
      resultat.versionDecimale,
      true,
      "`indexedDB.open` arrondirait silencieusement 1.5 : un scénario de montée de version ne testerait plus rien",
    );
    assert.equal(resultat.versionNulle, true);
  });

  await test("S3. la cible de production reste exactement celle de schema.ts", () => {
    assert.deepEqual(
      resultat.cibleProduction,
      resultat.attendu,
      "le moteur de production ne vise plus la base et la version déclarées dans schema.ts",
    );
    assert.equal(resultat.cibleProductionGelee, true);
  });

  await page.close();
}

/* ════════════════════════════════════════════════════════════════════════
 * C — LE SNAPSHOT PASSE-T-IL RÉELLEMENT PAR INDEXEDDB ?
 * ════════════════════════════════════════════════════════════════════════
 * `ContenuSnapshot` porte le view model RÉEL de la séance. IndexedDB ne
 * stocke pas du JSON : il applique l'algorithme de clonage structuré, qui
 * lève `DataCloneError` sur une fonction, une classe non sérialisable, un
 * élément React, un client Supabase ou un `AbortSignal`.
 *
 * Le danger n'est pas théorique : le view model traverse plusieurs couches
 * avant d'arriver ici, et il suffirait qu'une seule y attache un rappel ou
 * une instance pour que l'écriture échoue — sur le téléphone, au moment de
 * préparer la séance, c'est-à-dire là où personne ne regarde.
 *
 * Ce scénario écrit un modèle représentatif par le VRAI moteur, ferme tout,
 * rouvre dans une nouvelle page, et compare. Puis il vérifie que le
 * contrôle sait échouer, en tentant d'écrire une valeur non clonable.
 */
async function clonageSnapshot(test: Testeur, atelier: Atelier): Promise<void> {
  const nomBase = atelier.nomBase("clonage");

  // Modèle REPRÉSENTATIF : blocs, exercices, prescriptions, séries/reps/
  // charges/RPE, repos/tempo/notes, cardio avec segments, retour existant,
  // historique et options de remplacement préchargées.
  const contenu = {
    studentId: "aaaaaaaa-1111-4111-8111-aaaaaaaaaaaa",
    session: {
      id: SEANCE,
      programId: "99999999-9999-4999-8999-555555555555",
      day: "Dimanche",
      name: "Haut du corps",
      muscleGroups: "Pectoraux, triceps",
      durationMinutes: 60,
      warmup: "5 min rameur puis rotations d'épaules",
      coachNotes: "Garde les coudes serrés",
      sessionType: "mixte",
      bannerUrl: "https://exemple.test/banniere.jpg",
      exercises: [
        {
          id: "66666666-6666-4666-8666-333333333333",
          name: "Développé couché",
          sets: 4,
          reps: "8-10",
          load: "80 kg",
          rpe: 8,
          rest: "2 min",
          tempo: "3-1-1",
          notes: "Amplitude complète",
          videoUrl: "https://exemple.test/dc.mp4",
        },
      ],
      blocks: [
        {
          id: "b1",
          kind: "strength",
          title: "Bloc principal",
          order: 0,
          color: "#111111",
          exercises: [
            {
              id: "66666666-6666-4666-8666-333333333333",
              name: "Développé couché",
              sets: 4,
              reps: "8-10",
              load: "80 kg",
              rpe: 8,
              rest: "2 min",
              tempo: "3-1-1",
              notes: "Amplitude complète",
              exerciseLibraryId: "88888888-8888-4888-8888-666666666666",
            },
          ],
        },
      ],
      cardioBlocks: [
        {
          id: "c1",
          cardioType: "continu",
          title: "Effort continu",
          order: 1,
          segments: [{ order: 0, durationSeconds: 1800, distanceMeters: 5000, intensity: "modérée" }],
          notes: "Allure régulière",
        },
      ],
    },
    programId: "99999999-9999-4999-8999-555555555555",
    programName: "Prise de masse",
    feedbackExistant: {
      id: "fb-1",
      studentId: "aaaaaaaa-1111-4111-8111-aaaaaaaaaaaa",
      type: "entrainement",
      sessionId: SEANCE,
      performedAt: "2026-08-09",
      durationMinutes: 65,
      completed: true,
      rpe: 8,
      comment: "bonne séance",
      exerciseEntries: [
        { exerciseName: "Développé couché", setNumber: 1, loadUsed: "80", repsDone: "10", rpe: 8, comment: "" },
      ],
      videos: [],
    },
    historique: [
      { id: "fb-0", sessionId: "ancienne", performedAt: "2026-08-02", exerciseEntries: [] },
    ],
    remplacants: {
      "88888888-8888-4888-8888-666666666666": [
        {
          id: "77777777-7777-4777-8777-444444444444",
          name: "Développé haltères",
          videoUrl: "https://exemple.test/dh.mp4",
          alternativeVideoUrl: "",
          muscleGroup: "Pectoraux",
          equipment: "Haltères",
          level: "intermédiaire",
        },
      ],
    },
    accessType: "programme_seul",
  };

  const page = await atelier.nouvellePage();
  const ecriture = await page.evaluate(
    async (c) => {
      const brut = (await import(c.modules.brut)) as typeof import("./page/idb-brut");
      const idb = (await import(c.modules.idb)) as typeof import("../../../lib/offline/idb");
      const depotModule = (await import(c.modules.depot)) as typeof import("../../../lib/offline/depot");

      const moteur = idb.MoteurIndexedDB.pourTests({ nomBase: c.nomBase, version: 1 });
      const depot = new depotModule.DepotOffline(moteur);

      let erreurEcriture: string | null = null;
      try {
        await depot.ecrireSnapshot({
          userId: c.userId,
          businessDate: c.dateMetier,
          sessionId: c.sessionId,
          payload: c.contenu,
          maintenant: c.t0,
        });
      } catch (erreur) {
        erreurEcriture = brut.decrireErreur(erreur).message;
      }

      // CONTRÔLE NÉGATIF : une valeur non clonable DOIT être refusée. Sans
      // lui, un test vert prouverait seulement qu'on n'a rien écrit.
      let refusFonction: { nom: string; message: string } | null = null;
      try {
        await depot.ecrireSnapshot({
          userId: c.userId,
          businessDate: "2026-01-01",
          sessionId: "non-clonable",
          // Un `AbortSignal` — l'une des valeurs exactement visées par ce
          // contrôle, et non clonable par construction. (Une fonction ferait
          // l'affaire aussi, mais l'outillage de test la renomme avant de
          // l'injecter dans la page, ce qui ne prouverait plus rien.)
          payload: { signal: new AbortController().signal },
          maintenant: c.t0,
        });
      } catch (erreur) {
        const decrit = brut.decrireErreur(erreur);
        refusFonction = { nom: decrit.nom, message: decrit.message };
      }

      await moteur.fermer();
      return { erreurEcriture, refusFonction };
    },
    { modules: MODULES, nomBase, userId: A, sessionId: SEANCE, dateMetier: "2026-08-09", contenu, t0: T0 },
  );

  // Fermeture COMPLÈTE de la page : plus aucune connexion, plus aucun objet
  // JavaScript survivant. Ce qui sera relu vient forcément du disque.
  await page.close();

  const page2 = await atelier.nouvellePage();
  const relecture = await page2.evaluate(
    async (c) => {
      const idb = (await import(c.modules.idb)) as typeof import("../../../lib/offline/idb");
      const depotModule = (await import(c.modules.depot)) as typeof import("../../../lib/offline/depot");
      const moteur = idb.MoteurIndexedDB.pourTests({ nomBase: c.nomBase, version: 1 });
      const depot = new depotModule.DepotOffline(moteur);
      const snapshot = await depot.lireSnapshot(c.userId, c.dateMetier);
      await moteur.fermer();
      return { payload: snapshot?.payload ?? null, sessionId: snapshot?.sessionId ?? null };
    },
    { modules: MODULES, nomBase, userId: A, dateMetier: "2026-08-09" },
  );

  await test("C1. le view model RÉEL s'écrit dans IndexedDB sans erreur de clonage", () => {
    assert.equal(
      ecriture.erreurEcriture,
      null,
      "le snapshot contient une valeur non structured-cloneable (fonction, classe, élément React, client Supabase, AbortSignal…)",
    );
  });

  await test("C2. et il ressort IDENTIQUE après fermeture et réouverture", () => {
    assert.equal(relecture.sessionId, SEANCE);
    assert.deepEqual(
      relecture.payload,
      contenu,
      "la structure relue diffère de celle écrite — une partie du view model n'a pas survécu au disque",
    );
  });

  await test("C3. le contrôle sait ÉCHOUER : un AbortSignal est bien refusé", () => {
    assert.ok(
      ecriture.refusFonction,
      "IndexedDB a accepté une valeur non clonable : C1 ne prouverait plus rien",
    );
    // Le moteur traduit toutes les pannes de transaction en `ErreurStockage`
    // — c'est son contrat. Ce qui prouve la CAUSE, c'est le message que le
    // navigateur a produit, conservé tel quel par la traduction.
    assert.equal(ecriture.refusFonction?.nom, "ErreurStockage");
    assert.match(
      ecriture.refusFonction?.message ?? "",
      /clone/i,
      `le refus ne vient pas du clonage structuré : ${ecriture.refusFonction?.message}`,
    );
  });

  await page2.close();
}

/* ════════════════════════════════════════════════════════════════════════
 * EXÉCUTION
 * ════════════════════════════════════════════════════════════════════════
 * Les garde-fous statiques passent EN PREMIER, et sans navigateur : ils ne
 * lisent que des fichiers. Une machine nue doit quand même apprendre que
 * quelqu'un a câblé la seam de test dans un écran.
 */

const compte = compteur();

await garde_fous(compte.test);

const executable = trouverNavigateur();

if (!executable) {
  // Pas de navigateur : on s'arrête, on n'échoue pas. `playwright-core`
  // pilote un navigateur, il n'en installe aucun — et un rouge doit
  // continuer de vouloir dire « le code est cassé », jamais « la machine
  // est nue ». Aucune vérification n'a été faite sur une intégration
  // continue : ne comptez pas dessus sans l'y avoir essayé.
  console.log(
    "\nChrome introuvable, test IndexedDB non exécuté.\n" +
      "  Ces scénarios exigent un vrai navigateur : IndexedDB ne s'observe pas dans Node.\n" +
      "  Indiquez-en un avec CHROME_PATH=/chemin/vers/chrome npm run test:offline-idb",
  );
} else {
  console.log(`\nnavigateur : ${executable}`);
  const atelier = await ouvrirAtelier(executable);
  console.log(`bases de test : ${PREFIXE_BASES_DE_TEST}${atelier.runId}-*\n`);

  let restantes: string[] = [];
  try {
    await a40A(compte.test, atelier);
    await a40B(compte.test, atelier);
    await blocageEtFantome(compte.test, atelier);
    await versionchange(compte.test, atelier);
    await seam(compte.test, atelier);
    await clonageSnapshot(compte.test, atelier);
  } finally {
    // Le nettoyage passe AVANT le verdict : une base laissée derrière soi
    // ferait échouer le prochain lancement pour une raison qui n'aurait
    // rien à voir avec le code.
    restantes = await atelier.nettoyer();
    await atelier.fermer();
  }

  await compte.test("Z. aucune base de test ne survit à l'exécution", () => {
    assert.deepEqual(restantes, [], `bases de test non supprimées : ${restantes.join(", ")}`);
  });
}

console.log(`\n${compte.réussis} réussis, ${compte.échecs} échecs`);
process.exit(compte.échecs === 0 ? 0 : 1);
