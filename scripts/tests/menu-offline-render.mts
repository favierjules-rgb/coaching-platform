import assert from "node:assert/strict";
import { createServer, type Server } from "node:http";
import { existsSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import esbuild from "esbuild";
import type { Browser, BrowserContext, Page } from "playwright-core";

/**
 * LE CLIC RÉEL DANS LE MENU, HORS LIGNE.
 *
 * ════════════════════════════════════════════════════════════════════════
 * CE QUE CETTE SUITE PROUVE, ET QUE LES AUTRES NE PROUVAIENT PAS
 * ════════════════════════════════════════════════════════════════════════
 * `pwa-service-worker` envoie des requêtes au service worker à la main. Elle
 * prouve ce qu'il RÉPOND, jamais ce qu'un clic PRODUIT.
 *
 * Ici : `public/sw.js` est réellement enregistré dans Chromium, les
 * coquilles sont préparées par le vrai canal `message`, le navigateur passe
 * réellement hors ligne, et on clique sur les vrais `<Link>` de
 * `StudentSidebar`. Ce sont de vraies navigations de document, servies par
 * le vrai Cache Storage.
 */

const RACINE = join(dirname(fileURLToPath(import.meta.url)), "..", "..");
const ENTREE = join(RACINE, "scripts", "tests", "menu-offline-render", "entree.tsx");
const STUB_RESEAU = join(RACINE, "scripts", "tests", "parcours-offline-render", "supabase-mode.ts");
const SW = readFileSync(join(RACINE, "public", "sw.js"), "utf8");

let réussis = 0;
let échecs = 0;

async function test(nom: string, fn: () => Promise<void> | void) {
  try {
    await fn();
    réussis += 1;
    console.log(`ok - ${nom}`);
  } catch (erreur) {
    échecs += 1;
    console.error(`ÉCHEC - ${nom}`);
    console.error(erreur);
  }
}

const CANDIDATS = [
  process.env.CHROMIUM_PATH,
  "/opt/pw-browsers/chromium",
  "/usr/bin/chromium",
  "/usr/bin/chromium-browser",
  "/usr/bin/google-chrome",
].filter((c): c is string => Boolean(c));
const executable = CANDIDATS.find((c) => existsSync(c));
if (!executable) {
  console.error("Aucun navigateur trouvé. Pose CHROMIUM_PATH, ou installe Chromium.");
  process.exit(1);
}

/** Les entrées du menu, relues dans la barre latérale elle-même. */
const MENU = Array.from(
  readFileSync(join(RACINE, "components", "student", "StudentSidebar.tsx"), "utf8")
    .split("const studentLinks = [")[1]
    .split("];")[0]
    .matchAll(/href:\s*"([^"]+)"/g),
).map((m) => m[1]);

const construction = await esbuild.build({
  entryPoints: [ENTREE],
  bundle: true,
  write: false,
  format: "esm",
  platform: "browser",
  target: "es2022",
  jsx: "automatic",
  tsconfig: join(RACINE, "tsconfig.json"),
  plugins: [
    {
      name: "alias-supabase-mode",
      setup(build) {
        build.onResolve({ filter: /^@\/lib\/supabase\/browser$/ }, () => ({ path: STUB_RESEAU }));
      },
    },
  ],
  define: { "process.env.NODE_ENV": '"development"' },
  banner: { js: "globalThis.process ??= { env: {} };" },
  logLevel: "silent",
});
const bundle = construction.outputFiles[0].text;

/**
 * Le harnais est servi SOUS `/_next/static/` — donc précaché comme une
 * dépendance de coquille, exactement comme le serait le code de
 * l'application. Sans cela, la barre latérale n'existerait plus après la
 * première navigation hors ligne, et on ne pourrait pas enchaîner les clics.
 */
const CHEMIN_BUNDLE = "/_next/static/chunks/harnais-abc123.js";

function coquille(route: string): string {
  return (
    `<!doctype html><html lang="fr"><head><meta charset="utf-8">` +
    `<link rel="stylesheet" href="/_next/static/css/app-abc123.css">` +
    `<script src="${CHEMIN_BUNDLE}" type="module"></script>` +
    `</head><body><div id="racine" data-route="${route}"></div></body></html>`
  );
}

const PAGE_HORS_LIGNE = `<!doctype html><html><body><h1>Pas de connexion</h1></body></html>`;

const serveur: Server = createServer((requete, reponse) => {
  const chemin = new URL(requete.url ?? "/", "http://x").pathname;
  if (chemin === "/sw.js") {
    reponse.writeHead(200, { "content-type": "text/javascript; charset=utf-8" }).end(SW);
    return;
  }
  if (chemin === CHEMIN_BUNDLE) {
    reponse.writeHead(200, { "content-type": "text/javascript; charset=utf-8" }).end(bundle);
    return;
  }
  if (chemin.startsWith("/_next/static/")) {
    reponse.writeHead(200, { "content-type": "text/css" }).end("/* build */");
    return;
  }
  if (chemin === "/hors-ligne") {
    reponse.writeHead(200, { "content-type": "text/html; charset=utf-8" }).end(PAGE_HORS_LIGNE);
    return;
  }
  reponse.writeHead(200, { "content-type": "text/html; charset=utf-8" }).end(coquille(chemin));
});
await new Promise<void>((ok) => serveur.listen(0, "127.0.0.1", ok));
const adresse = serveur.address();
const origine = `http://127.0.0.1:${typeof adresse === "object" && adresse ? adresse.port : 0}`;

const { chromium } = await import("playwright-core");
const navigateur: Browser = await chromium.launch({
  executablePath: executable,
  args: ["--no-sandbox", "--disable-dev-shm-usage"],
});

interface Harnais {
  preparer: () => Promise<void>;
  pushs: () => string[];
  cache: () => Promise<string[]>;
  lien: (href: string) => boolean;
}

const appeler = <R,>(page: Page, nom: keyof Harnais, ...args: unknown[]): Promise<R> =>
  page.evaluate(
    ([n, a]) =>
      (window as unknown as { __harnais: Record<string, (...x: unknown[]) => unknown> }).__harnais[
        n as string
      ](...(a as unknown[])) as unknown,
    [nom, args] as const,
  ) as Promise<R>;

/**
 * Un contexte neuf (donc un Cache Storage neuf), l'application ouverte UNE
 * fois en ligne sur /entrainement, et rien d'autre visité.
 */
async function atelier<T>(travail: (page: Page, contexte: BrowserContext) => Promise<T>): Promise<T> {
  const contexte: BrowserContext = await navigateur.newContext();
  try {
    const page = await contexte.newPage();
    page.on("pageerror", (erreur) => console.error("  [page]", erreur.message));
    await page.goto(`${origine}/entrainement`);
    await page.waitForFunction(() => "__harnais" in window);
    await appeler(page, "preparer");
    // La préparation est asynchrone côté service worker : on attend qu'elle
    // ait abouti, en interrogeant vraiment Cache Storage. (`waitForFunction`
    // ne convient pas : une fonction asynchrone lui rend une promesse, qui
    // est toujours « vraie ».)
    const limite = Date.now() + 20000;
    for (;;) {
      const vus = await appeler<string[]>(page, "cache");
      if (MENU.every((route) => vus.includes(route))) break;
      if (Date.now() > limite) {
        throw new Error(`préparation incomplète — en cache : ${JSON.stringify(vus)}`);
      }
      await page.waitForTimeout(150);
    }

    return await travail(page, contexte);
  } finally {
    await contexte.close();
  }
}

await test("MENU1. une seule ouverture en ligne met les 7 coquilles ET leurs fichiers en cache", async () => {
  await atelier(async (page) => {
    const enCache = await appeler<string[]>(page, "cache");
    for (const route of MENU) {
      assert.ok(enCache.includes(route), `${route} n'est pas préparée`);
    }
    assert.ok(
      enCache.includes(CHEMIN_BUNDLE),
      "le fichier dont la coquille a besoin pour démarrer n'est pas en cache",
    );
    assert.ok(
      enCache.includes("/_next/static/css/app-abc123.css"),
      "la feuille de style de la coquille n'est pas en cache",
    );
  });
});

await test("MENU2. HORS LIGNE, un vrai clic sur chaque entrée ouvre SA page", async () => {
  await atelier(async (page, contexte) => {
    await contexte.setOffline(true);
    for (const route of MENU) {
      if (route === "/entrainement") continue;
      const trouve = await appeler<boolean>(page, "lien", route);
      assert.ok(trouve, `le lien ${route} n'est pas rendu par la barre latérale`);
      await page.waitForURL(`${origine}${route}`, { timeout: 10000 });
      const rendu = await page.evaluate(() => ({
        route: document.getElementById("racine")?.getAttribute("data-route") ?? null,
        texte: document.body.textContent ?? "",
      }));
      assert.equal(rendu.route, route, `le document servi n'est pas la coquille de ${route}`);
      assert.ok(!rendu.texte.includes("Pas de connexion"), `${route} est tombée sur la page de secours`);
      // Retour au point de départ pour le clic suivant.
      await page.goBack();
      await page.waitForFunction(() => "__harnais" in window, undefined, { timeout: 10000 });
    }
  });
});

await test("MENU3. HORS LIGNE, on enchaîne les menus sans jamais repasser en ligne", async () => {
  // Le parcours réel : Nutrition → Documents → Profil → Entraînement, sans
  // réseau, sans démarrage à froid entre deux.
  await atelier(async (page, contexte) => {
    await contexte.setOffline(true);
    for (const route of ["/nutrition", "/documents", "/profil", "/entrainement"]) {
      const trouve = await appeler<boolean>(page, "lien", route);
      assert.ok(trouve, `le lien ${route} a disparu après la navigation précédente`);
      await page.waitForURL(`${origine}${route}`, { timeout: 10000 });
      await page.waitForFunction(() => "__harnais" in window, undefined, { timeout: 10000 });
      const route_rendue = await page.evaluate(
        () => document.getElementById("racine")?.getAttribute("data-route") ?? null,
      );
      assert.equal(route_rendue, route, `${route} n'a pas été servie depuis sa coquille`);
    }
  });
});

/*
 * ────────────────────────────────────────────────────────────────────────
 * CE QUE CE HARNAIS NE PROUVE PAS, ET POURQUOI C'EST DIT ICI
 * ────────────────────────────────────────────────────────────────────────
 * Sans le runtime complet de Next (routeur, arbre de segments, charges RSC),
 * `<Link>` se dégrade en ancre ordinaire : ici, un clic EN LIGNE recharge
 * lui aussi le document. Ce harnais ne peut donc pas montrer que la
 * correction laisse la navigation client intacte quand le réseau est là.
 *
 * Cette moitié-là est prouvée ailleurs, sur la fonction de décision
 * elle-même : `scripts/tests/pwa-lancement.mts`, cas NAV1 à NAV3 — hors
 * ligne le clic est repris, en ligne il ne l'est jamais.
 */

await navigateur.close();
serveur.close();

console.log(`\n${réussis} réussis, ${échecs} échecs`);
process.exit(échecs === 0 ? 0 : 1);
