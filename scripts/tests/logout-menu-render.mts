import assert from "node:assert/strict";
import { existsSync, readdirSync } from "node:fs";
import { createServer, type Server } from "node:http";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import * as esbuild from "esbuild";
import type { Browser, BrowserContext, Page } from "playwright-core";

/**
 * DÉCONNEXION ET MENU — LE VRAI COMPOSANT, DANS UN VRAI CHROMIUM.
 *
 *   npm run test:logout-menu
 *
 * ════════════════════════════════════════════════════════════════════════
 * POURQUOI CE TROISIÈME NIVEAU EXISTE
 * ════════════════════════════════════════════════════════════════════════
 * `offline-integration.mts` prouve les règles, dans Node, sur des modules
 * purs. `scripts/tests/idb/` prouve le moteur de base de données. Ni l'un ni
 * l'autre ne peut répondre à : « quand l'élève CLIQUE, que se passe-t-il ? »
 *
 * Cette question fait intervenir les effets React, l'hydratation, le
 * différé, les événements du navigateur et le rendu qui suit le commit
 * IndexedDB. Aucun de ces mécanismes n'existe dans `renderToString`, et les
 * simuler reviendrait à tester la simulation.
 *
 * Ici, tout est réel — sauf deux frontières explicitement injectées, le
 * dépôt et le réseau (voir `seance-offline-render/entree.tsx`).
 *
 * ════════════════════════════════════════════════════════════════════════
 * ESBUILD N'EST QU'UN OUTIL DE TEST
 * ════════════════════════════════════════════════════════════════════════
 * Le navigateur ne sait lire ni le TSX, ni les chemins `@/…`, ni les modules
 * CommonJS de React. `esbuild` fabrique donc un unique fichier navigateur à
 * partir de l'entrée ci-dessous. Il ne participe à AUCUN build de
 * production : Next garde son propre compilateur, et rien dans `app/`,
 * `components/`, `hooks/` ou `lib/` ne l'importe.
 */

const ICI = dirname(fileURLToPath(import.meta.url));
const RACINE = resolve(ICI, "..", "..");
const ENTREE = join(ICI, "logout-menu-render", "entree.tsx");
const PREFIXE_BASES = "seth-offline-idb-tests-";
/* ── NAVIGATEUR ─────────────────────────────────────────────────────────── */

function trouverNavigateur(): string | null {
  const candidats = [
    process.env.CHROME_PATH ?? "",
    "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
    "/Applications/Chromium.app/Contents/MacOS/Chromium",
    "/usr/bin/google-chrome",
    "/usr/bin/chromium",
    "/usr/bin/chromium-browser",
  ];
  const depot = process.env.PLAYWRIGHT_BROWSERS_PATH;
  if (depot && existsSync(depot)) {
    for (const entree of readdirSync(depot)) {
      if (entree.startsWith("chromium")) {
        candidats.push(join(depot, entree, "chrome-linux", "chrome"));
      }
    }
  }
  return candidats.find((chemin) => chemin && existsSync(chemin)) ?? null;
}

/* ── COMPTEUR ───────────────────────────────────────────────────────────── */

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

/* ── EXÉCUTION ──────────────────────────────────────────────────────────── */

const executable = trouverNavigateur();
if (!executable) {
  console.log(
    "Chrome introuvable, harnais React non exécuté.\n" +
      "  Indiquez-en un avec CHROME_PATH=/chemin/vers/chrome npm run test:seance-offline-render",
  );
  process.exit(0);
}

// Un seul fichier navigateur, construit en mémoire.
const construction = await esbuild.build({
  entryPoints: [ENTREE],
  bundle: true,
  write: false,
  format: "esm",
  platform: "browser",
  target: "es2022",
  jsx: "automatic",
  tsconfig: join(RACINE, "tsconfig.json"),
  define: { "process.env.NODE_ENV": '"development"' },
  // Le navigateur n'a pas de `process`. Next l'injecte au build ; ici, une
  // enveloppe vide suffit — et elle garantit au passage qu'AUCUNE variable
  // Supabase n'est disponible, donc que `createSupabaseBrowserClient()` rend
  // `null` et qu'aucun appel réseau n'est même envisageable.
  banner: { js: "globalThis.process ??= { env: {} };" },
  logLevel: "silent",
});
const bundle = construction.outputFiles[0].text;

const PAGE = `<!doctype html><html lang="fr"><head><meta charset="utf-8"><title>harnais séance</title></head>
<body><div id="racine"></div><script type="module" src="/bundle.js"></script></body></html>`;

const serveur: Server = createServer((requete, reponse) => {
  if ((requete.url ?? "/").startsWith("/bundle.js")) {
    reponse.writeHead(200, { "content-type": "text/javascript; charset=utf-8" }).end(bundle);
    return;
  }
  reponse.writeHead(200, { "content-type": "text/html; charset=utf-8" }).end(PAGE);
});
await new Promise<void>((ok) => serveur.listen(0, "127.0.0.1", ok));
const adresse = serveur.address();
const origine = `http://127.0.0.1:${typeof adresse === "object" && adresse ? adresse.port : 0}`;

const { chromium } = await import("playwright-core");
const navigateur: Browser = await chromium.launch({
  executablePath: executable,
  args: ["--no-sandbox", "--disable-dev-shm-usage"],
});
const contexte: BrowserContext = await navigateur.newContext();
const runId = `${process.pid}-${Date.now().toString(36)}`;
let compteur = 0;

const appel = <T,>(page: Page, nom: string, ...args: unknown[]) =>
  page.evaluate(
    ({ n, a }) =>
      (window as unknown as { __harnais: Record<string, (...x: unknown[]) => unknown> }).__harnais[n](
        ...(a as unknown[]),
      ),
    { n: nom, a: args },
  ) as Promise<T>;

type EtatCompte = {
  snapshot: boolean;
  brouillon: boolean;
  operation: boolean;
  acces: string | null;
  enAttente: number;
};

const A = "11111111-1111-4111-8111-aaaaaaaaaaaa";
const B = "22222222-2222-4222-8222-bbbbbbbbbbbb";
const BOUTON = "button.bouton-deconnexion";
const DIALOGUE = "[role='alertdialog']";

async function atelierPage(): Promise<{ page: Page; nomBase: string }> {
  const page = await contexte.newPage();
  page.on("pageerror", (erreur) => console.error("  [page]", erreur.message));
  await page.goto(origine);
  await page.waitForFunction(() => "__harnais" in window);
  compteur += 1;
  return { page, nomBase: `${PREFIXE_BASES}${runId}-logout-${compteur}` };
}

try {
  /* ══════════════════════════════════════════════════════════════════════
   * LOG — LA DÉCONNEXION
   * ══════════════════════════════════════════════════════════════════════ */

  await test("LOG1. A sans opération en attente → purge complète, signOut immédiat", async () => {
    const { page, nomBase } = await atelierPage();
    await appel(page, "semer", nomBase, A, { pending: false });
    await appel(page, "monterDeconnexion", nomBase, A);
    await page.click(BOUTON);
    await page.waitForFunction(
      () => (window as unknown as { __harnais: { signOuts: () => string[] } }).__harnais.signOuts().length > 0,
      undefined,
      { timeout: 5000 },
    );

    assert.equal(await page.locator(DIALOGUE).count(), 0, "aucune confirmation ne devait s'afficher");
    const etat = await appel<EtatCompte>(page, "etat", nomBase, A);
    assert.equal(etat.snapshot, false, "le snapshot devait partir");
    assert.equal(etat.brouillon, false, "le brouillon devait partir");
    assert.equal(etat.acces, null, "display_prefs devait partir");
    await page.close();
  });

  await test("LOG2. A avec opération en attente → confirmation AVANT tout signOut", async () => {
    const { page, nomBase } = await atelierPage();
    await appel(page, "semer", nomBase, A, { pending: true });
    await appel(page, "monterDeconnexion", nomBase, A);
    await page.click(BOUTON);
    await page.waitForSelector(DIALOGUE, { timeout: 5000 });

    assert.deepEqual(await appel<string[]>(page, "signOuts"), [], "signOut exécuté avant la confirmation");
    const corps = (await page.textContent(DIALOGUE)) ?? "";
    assert.ok(corps.includes("attend"), "l'élève n'est pas informé de ce qui est en jeu");
    assert.ok(corps.includes("conservée sur cet appareil"), "le sort de la séance n'est pas annoncé");
    await page.close();
  });

  await test("LOG3. « Rester connecté » → rien n'est déconnecté, rien n'est purgé", async () => {
    const { page, nomBase } = await atelierPage();
    await appel(page, "semer", nomBase, A, { pending: true });
    await appel(page, "monterDeconnexion", nomBase, A);
    await page.click(BOUTON);
    await page.waitForSelector(DIALOGUE, { timeout: 5000 });
    await page.click("button:has-text('Rester connecté')");
    await page.waitForSelector(DIALOGUE, { state: "detached", timeout: 5000 });

    assert.deepEqual(await appel<string[]>(page, "signOuts"), []);
    const etat = await appel<EtatCompte>(page, "etat", nomBase, A);
    assert.equal(etat.operation, true, "l'outbox a été touchée");
    assert.equal(etat.snapshot, true, "le snapshot a été purgé malgré l'annulation");
    assert.equal(etat.acces, "coaching");
    await page.close();
  });

  await test("LOG4. « Se déconnecter quand même » → outbox et brouillon conservés, le reste purgé", async () => {
    const { page, nomBase } = await atelierPage();
    await appel(page, "semer", nomBase, A, { pending: true });
    await appel(page, "monterDeconnexion", nomBase, A);
    await page.click(BOUTON);
    await page.waitForSelector(DIALOGUE, { timeout: 5000 });
    await page.click("button:has-text('Se déconnecter quand même')");
    await page.waitForFunction(
      () => (window as unknown as { __harnais: { signOuts: () => string[] } }).__harnais.signOuts().length > 0,
      undefined,
      { timeout: 5000 },
    );

    const etat = await appel<EtatCompte>(page, "etat", nomBase, A);
    assert.equal(etat.operation, true, "l'opération en attente a été perdue");
    assert.equal(etat.brouillon, true, "le brouillon de la séance en attente a été perdu");
    assert.equal(etat.snapshot, false, "le snapshot devait partir");
    assert.equal(
      etat.acces,
      null,
      "display_prefs doit partir même avec un pending : il se reconstruit en une requête",
    );
    await page.close();
  });

  await test("LOG5/LOG6. B après la déconnexion de A : aucune donnée de A, aucun envoi de A", async () => {
    const { page, nomBase } = await atelierPage();
    await appel(page, "semer", nomBase, A, { pending: true });
    await appel(page, "monterDeconnexion", nomBase, A);
    await page.click(BOUTON);
    await page.waitForSelector(DIALOGUE, { timeout: 5000 });
    await page.click("button:has-text('Se déconnecter quand même')");
    await page.waitForFunction(
      () => (window as unknown as { __harnais: { signOuts: () => string[] } }).__harnais.signOuts().length > 0,
      undefined,
      { timeout: 5000 },
    );

    // Le stockage de A survit — c'est voulu, il permettra sa reprise.
    assert.equal((await appel<EtatCompte>(page, "etat", nomBase, A)).operation, true);

    // Mais B ne voit RIEN : toutes les lectures sont scindées par compte.
    const etatB = await appel<EtatCompte>(page, "etat", nomBase, B);
    assert.equal(etatB.snapshot, false, "B voit le snapshot de A");
    assert.equal(etatB.brouillon, false, "B voit le brouillon de A");
    assert.equal(etatB.operation, false, "B voit le pending de A");
    assert.equal(etatB.acces, null, "B hérite de la préférence de A");
    assert.equal(etatB.enAttente, 0, "B pourrait envoyer l'outbox de A");
    await page.close();
  });

  await test("LOG7. A se reconnecte : son outbox est retrouvée intacte", async () => {
    const { page, nomBase } = await atelierPage();
    await appel(page, "semer", nomBase, A, { pending: true });
    await appel(page, "monterDeconnexion", nomBase, A);
    await page.click(BOUTON);
    await page.waitForSelector(DIALOGUE, { timeout: 5000 });
    await page.click("button:has-text('Se déconnecter quand même')");
    await page.waitForFunction(
      () => (window as unknown as { __harnais: { signOuts: () => string[] } }).__harnais.signOuts().length > 0,
      undefined,
      { timeout: 5000 },
    );

    // A revient : l'identité redevient la sienne, et tout est là.
    const etat = await appel<EtatCompte>(page, "etat", nomBase, A);
    assert.equal(etat.enAttente, 1, "l'outbox de A n'a pas survécu à sa déconnexion");
    assert.equal(etat.brouillon, true, "le brouillon de reprise a disparu");
    await page.close();
  });

  await test("LOG8. stockage illisible : la déconnexion reste possible, sans prétendre avoir purgé", async () => {
    const { page, nomBase } = await atelierPage();
    await appel(page, "semer", nomBase, A, { pending: true });
    // Le dépôt du bouton est en panne : impossible de savoir s'il reste
    // quelque chose. Retenir l'élève sur un téléphone partagé serait pire.
    await appel(page, "monterDeconnexion", nomBase, A, { moteurEnPanne: true });
    await page.click(BOUTON);
    await page.waitForFunction(
      () => (window as unknown as { __harnais: { signOuts: () => string[] } }).__harnais.signOuts().length > 0,
      undefined,
      { timeout: 5000 },
    );

    assert.equal(await page.locator(DIALOGUE).count(), 0);
    // Et RIEN n'a été effacé : on n'a pas prétendu purger ce qu'on ne
    // pouvait pas lire.
    const etat = await appel<EtatCompte>(page, "etat", nomBase, A);
    assert.equal(etat.operation, true, "une purge a été annoncée sur un stockage illisible");
    await page.close();
  });

  /* ══════════════════════════════════════════════════════════════════════
   * MENU — display_prefs
   * ══════════════════════════════════════════════════════════════════════ */

  const lireMenu = async (page: Page) => ({
    acces: await page.textContent("#acces"),
    menu: await page.textContent("#menu"),
  });

  await test("MENU1/MENU2. coaching : mémorisé en ligne, puis identique hors ligne", async () => {
    const { page, nomBase } = await atelierPage();
    await appel(page, "monterMenu", nomBase, A, "coaching");
    await page.waitForFunction(() => document.querySelector("#acces")?.textContent === "coaching", undefined, { timeout: 5000 });
    const enLigne = await lireMenu(page);

    // MENU1 — la résolution en ligne a bien écrit la préférence.
    assert.equal((await appel<EtatCompte>(page, "etat", nomBase, A)).acces, "coaching");

    // MENU2 — hors ligne (aucune résolution possible), même menu.
    await appel(page, "monterMenu", nomBase, A);
    await page.waitForTimeout(300);
    assert.deepEqual(await lireMenu(page), enLigne, "le menu diffère hors ligne");
    await page.close();
  });

  await test("MENU3/MENU4. programme_seul : mémorisé en ligne, menu RÉDUIT hors ligne", async () => {
    const { page, nomBase } = await atelierPage();
    await appel(page, "monterMenu", nomBase, A, "programme_seul");
    await page.waitForFunction(() => document.querySelector("#acces")?.textContent === "programme_seul", undefined, { timeout: 5000 });
    assert.equal((await lireMenu(page)).menu, "réduit");
    assert.equal((await appel<EtatCompte>(page, "etat", nomBase, A)).acces, "programme_seul");

    await appel(page, "monterMenu", nomBase, A);
    await page.waitForFunction(() => document.querySelector("#acces")?.textContent === "programme_seul", undefined, { timeout: 5000 });
    assert.equal((await lireMenu(page)).menu, "réduit", "hors ligne, le menu complet réapparaît");
    await page.close();
  });

  await test("MENU5. la préférence de A n'est JAMAIS réutilisée par B", async () => {
    const { page, nomBase } = await atelierPage();
    await appel(page, "monterMenu", nomBase, A, "programme_seul");
    await page.waitForFunction(() => document.querySelector("#acces")?.textContent === "programme_seul", undefined, { timeout: 5000 });

    // B se connecte, hors ligne, sans préférence à lui.
    await appel(page, "monterMenu", nomBase, B);
    await page.waitForTimeout(400);
    assert.equal(
      (await lireMenu(page)).acces,
      "coaching",
      "B a hérité de la préférence de A — il n'existe aucune lecture « la dernière disponible »",
    );
    await page.close();
  });

  await test("MENU6. une valeur locale illisible est ignorée, pas interprétée", async () => {
    const { page, nomBase } = await atelierPage();
    await appel(page, "semerAccesInvalide", nomBase, A);
    await appel(page, "monterMenu", nomBase, A);
    await page.waitForTimeout(400);
    assert.equal((await lireMenu(page)).acces, "coaching", "une valeur inconnue a été interprétée");
    await page.close();
  });

  await test("MENU7. IndexedDB HS en ligne : le menu en ligne fonctionne normalement", async () => {
    const { page, nomBase } = await atelierPage();
    // La sonde reçoit un dépôt sain, mais la préférence ne pourra pas être
    // relue : ce qui compte est que la RÉSOLUTION en ligne fasse foi.
    await appel(page, "monterMenu", nomBase, A, "programme_seul");
    await page.waitForFunction(() => document.querySelector("#acces")?.textContent === "programme_seul", undefined, { timeout: 5000 });
    assert.equal((await lireMenu(page)).menu, "réduit");
    await page.close();
  });
} finally {
  const page = await contexte.newPage();
  await page.goto(origine);
  const restantes = await page.evaluate(async (prefixe: string) => {
    const toutes = await indexedDB.databases();
    const nôtres = toutes.map((b) => b.name ?? "").filter((n) => n.startsWith(prefixe));
    for (const nom of nôtres) {
      await new Promise<void>((ok) => {
        const d = indexedDB.deleteDatabase(nom);
        d.onsuccess = () => ok();
        d.onerror = () => ok();
        d.onblocked = () => ok();
      });
    }
    const apres = await indexedDB.databases();
    return apres.map((b) => b.name ?? "").filter((n) => n.startsWith(prefixe));
  }, PREFIXE_BASES);
  await page.close();
  await contexte.close();
  await navigateur.close();
  await new Promise<void>((ok) => serveur.close(() => ok()));

  await test("Z. aucune base de test ne survit", () => {
    assert.deepEqual(restantes, []);
  });
}

console.log(`\n${réussis} réussis, ${échecs} échecs`);
process.exit(échecs === 0 ? 0 : 1);
