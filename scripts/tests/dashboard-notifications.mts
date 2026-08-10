import assert from "node:assert/strict";
import { createServer, type Server } from "node:http";
import { existsSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import esbuild from "esbuild";
import type { Browser, BrowserContext, Page } from "playwright-core";

/**
 * LE BLOC DU TABLEAU DE BORD DOIT POUVOIR TOUT CRÉER.
 *
 * ════════════════════════════════════════════════════════════════════════
 * L'ÉCART PRODUIT QUE CETTE SUITE EXISTE POUR FERMER
 * ════════════════════════════════════════════════════════════════════════
 * La première version du composer traitait `compact` comme une amputation :
 * la section « Quand » n'était pas rendue du tout, et `corpsRequete()`
 * forçait `{ mode: "now" }`. Le tableau de bord ne savait donc qu'envoyer
 * tout de suite — alors que le besoin était précisément d'y programmer un
 * rappel et d'y créer une répétition, la page servant à GÉRER ce qui existe.
 *
 * ════════════════════════════════════════════════════════════════════════
 * CE QUE CHAQUE CAS PROUVE
 * ════════════════════════════════════════════════════════════════════════
 * DASHNOTIF1  compact · Maintenant  → l'envoi immédiat part.
 * DASHNOTIF2  compact · Programmer  → date et heure apparaissent, et RIEN
 *             de la récurrence (repli progressif).
 * DASHNOTIF3  compact · Répéter     → fréquence, jours, heure — et pas de date.
 * DASHNOTIF4  la MÊME saisie depuis le tableau de bord et depuis la page
 *             produit le MÊME ordre au serveur, octet pour octet.
 * DASHNOTIF5  aucune logique de récurrence dupliquée : `compact` n'entre
 *             dans aucun calcul.
 */

const RACINE = join(dirname(fileURLToPath(import.meta.url)), "..", "..");
const ENTREE = join(RACINE, "scripts", "tests", "dashboard-notifications", "entree.tsx");

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

const construction = await esbuild.build({
  entryPoints: [ENTREE],
  bundle: true, write: false, format: "esm", platform: "browser", target: "es2022",
  jsx: "automatic", tsconfig: join(RACINE, "tsconfig.json"),
  define: { "process.env.NODE_ENV": '"development"' },
  banner: { js: "globalThis.process ??= { env: {} };" },
  logLevel: "silent",
});
const bundle = construction.outputFiles[0].text;

const PAGE = `<!doctype html><html lang="fr"><head><meta charset="utf-8"><title>composer</title></head>
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

type Appeler = <R>(nom: string, ...args: unknown[]) => Promise<R>;

interface Vu {
  texte: string;
  boutons: string[];
  controles: string[];
  typesEntrees: string[];
  quandEstUnMenu: boolean;
}

async function atelier<T>(travail: (page: Page, appeler: Appeler) => Promise<T>): Promise<T> {
  const contexte: BrowserContext = await navigateur.newContext();
  try {
    const page = await contexte.newPage();
    page.on("pageerror", (erreur) => console.error("  [page]", erreur.message));
    await page.goto(origine);
    await page.waitForFunction(() => "__harnais" in window);
    const appeler = <R,>(nom: string, ...args: unknown[]): Promise<R> =>
      page.evaluate(
        ([n, a]) =>
          (window as unknown as { __harnais: Record<string, (...x: unknown[]) => unknown> }).__harnais[
            n as string
          ](...(a as unknown[])) as unknown,
        [nom, args] as const,
      ) as Promise<R>;
    return await travail(page, appeler);
  } finally {
    await contexte.close();
  }
}

/* ════════════════════════════════════════════════════════════════════════ */

await test("DASHNOTIF1. compact · Maintenant : l'envoi immédiat part depuis le tableau de bord", async () => {
  await atelier(async (_page, appeler) => {
    await appeler("monter", true);
    const vu = await appeler<Vu>("vu");
    assert.ok(vu.quandEstUnMenu, "en compact, « Quand » est un menu déroulant");
    assert.match(vu.texte, /Quand/, "la section Quand doit exister même en compact");

    await appeler("choisirQuand", "now");
    await appeler("agir");
    const payload = await appeler<Record<string, unknown> | null>("dernierPayload");
    assert.ok(payload, "un ordre doit partir vers /campaigns");
    assert.deepEqual((payload as { quand: unknown }).quand, { mode: "now" });
  });
});

await test("DASHNOTIF2. compact · Programmer : date et heure, et rien de la récurrence", async () => {
  await atelier(async (_page, appeler) => {
    await appeler("monter", true);
    await appeler("choisirQuand", "once");
    const vu = await appeler<Vu>("vu");

    assert.ok(vu.controles.includes("Date"), "un champ Date doit apparaître");
    assert.ok(vu.controles.includes("Heure"), "un champ Heure doit apparaître");
    // Repli progressif : ce que le mode ne demande pas ne s'affiche pas.
    assert.ok(!vu.controles.includes("Fréquence"), "aucune fréquence en mode Programmer");
    assert.ok(!vu.controles.includes("Jour 1"), "aucun sélecteur de jours en mode Programmer");
    assert.ok(vu.boutons.some((b) => /Programmer/.test(b)), "l'action doit s'appeler Programmer");

    await appeler("remplir", { date: "2026-09-14", heure: "17:30" });
    await appeler("choisirDestinataire", "un", [(await appeler<{ ELEVE_A: string }>("constantes")).ELEVE_A]);
    await appeler("agir");
    const payload = await appeler<{ quand: Record<string, unknown> } | null>("dernierPayload");
    assert.deepEqual(payload?.quand, {
      mode: "once", date: "2026-09-14", heure: "17:30", fuseau: "Europe/Paris",
    });
  });
});

await test("DASHNOTIF3. compact · Répéter : fréquence, jours, heure — et pas de date", async () => {
  await atelier(async (_page, appeler) => {
    await appeler("monter", true);
    await appeler("choisirQuand", "recurring");
    const vu = await appeler<Vu>("vu");

    assert.ok(vu.controles.includes("Fréquence"), "un menu de fréquence doit apparaître");
    for (const jour of [1, 2, 3, 4, 5, 6, 7]) {
      assert.ok(vu.controles.includes(`Jour ${jour}`), `le jour ${jour} doit être proposé`);
    }
    assert.ok(vu.controles.includes("Heure"), "une heure doit être demandée");
    assert.ok(!vu.controles.includes("Date"), "aucune date en mode Répéter");
    assert.ok(vu.boutons.some((b) => /Créer la répétition/.test(b)));

    await appeler("remplir", { freq: "weekly", jours: [2, 4], heure: "20:00" });
    await appeler("agir");
    const payload = await appeler<{ quand: Record<string, unknown> } | null>("dernierPayload");
    assert.deepEqual(payload?.quand, {
      mode: "recurring",
      fuseau: "Europe/Paris",
      recurrence: { freq: "weekly", hour: 20, minute: 0, weekdays: [2, 4] },
    });
  });
});

await test("DASHNOTIF4. la même saisie, ici ou sur la page, produit le MÊME ordre", async () => {
  const saisir = async (compact: boolean) =>
    atelier(async (_page, appeler) => {
      const { ELEVE_A, ELEVE_B } = await appeler<{ ELEVE_A: string; ELEVE_B: string }>("constantes");
      await appeler("monter", compact);
      await appeler("choisirDestinataire", "plusieurs", [ELEVE_A, ELEVE_B]);
      await appeler("choisirQuand", "recurring");
      await appeler("remplir", { freq: "weekly", jours: [1], heure: "08:00" });
      await appeler("agir");
      return appeler<unknown>("dernierPayload");
    });

  const duTableauDeBord = await saisir(true);
  const deLaPage = await saisir(false);

  assert.ok(duTableauDeBord, "le tableau de bord doit pouvoir créer une répétition");
  assert.ok(deLaPage, "la page aussi");
  // Octet pour octet : c'est la seule façon de prouver qu'aucune des deux
  // présentations n'ajoute, n'oublie ou ne réécrit quoi que ce soit.
  assert.equal(JSON.stringify(duTableauDeBord), JSON.stringify(deLaPage));
  assert.deepEqual((duTableauDeBord as { quand: Record<string, unknown> }).quand, {
    mode: "recurring",
    fuseau: "Europe/Paris",
    recurrence: { freq: "weekly", hour: 8, minute: 0, weekdays: [1] },
  });
});

await test("DASHNOTIF5. `compact` ne touche à aucun calcul : ni récurrence, ni payload, ni audience", () => {
  const source = readFileSync(join(RACINE, "components", "admin", "NotificationComposer.tsx"), "utf8");

  // Les fonctions qui DÉCIDENT quoi envoyer ne doivent jamais lire `compact`.
  for (const nom of ["corpsRequete", "envoyer", "demanderEnvoi"]) {
    const debut = source.indexOf(`function ${nom}(`);
    assert.ok(debut > 0, `${nom} introuvable`);
    // Jusqu'au début de la fonction suivante, ou du rendu.
    const suite = source.slice(debut + 1);
    const fin = suite.search(/\n  (?:async )?function |\n  const libelleAction/);
    const corps = suite.slice(0, fin > 0 ? fin : suite.length);
    assert.ok(!corps.includes("compact"), `${nom} ne doit pas dépendre de la présentation`);
  }

  // Le calcul d'échéance n'existe qu'à un seul endroit, et ce n'est pas ici.
  assert.ok(
    !/prochaineEcheance\s*\(/.test(source),
    "le composant ne doit pas calculer d'échéance : c'est le rôle de lib/notifications/recurrence.ts",
  );
  assert.ok(
    !/instantPourHeureLocale|weekdays\s*:\s*\[.*\]\.map/.test(source.replace(/weekdays: jours/g, "")),
    "aucune règle de récurrence réimplémentée dans le composant",
  );

  // Un seul composer monté des deux côtés : pas de variante dupliquée.
  const dashboard = readFileSync(join(RACINE, "app", "admin", "page.tsx"), "utf8");
  const page = readFileSync(join(RACINE, "app", "admin", "notifications", "page.tsx"), "utf8");
  assert.ok(dashboard.includes("<NotificationComposer students={students} compact />"));
  assert.ok(page.includes("<NotificationComposer students={students}"));
  assert.ok(dashboard.includes('href="/admin/notifications"'), "le lien « Gérer → » reste présent");
});

await navigateur.close();
serveur.close();

console.log(`\n${réussis} réussis, ${échecs} échecs`);
process.exit(échecs === 0 ? 0 : 1);
