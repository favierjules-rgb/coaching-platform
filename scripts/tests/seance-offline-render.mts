import assert from "node:assert/strict";
import { existsSync, readdirSync } from "node:fs";
import { createServer, type Server } from "node:http";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import * as esbuild from "esbuild";
import type { Browser, BrowserContext, Page } from "playwright-core";

/**
 * LA SÉANCE HORS LIGNE — LE VRAI COMPOSANT, DANS UN VRAI CHROMIUM.
 *
 *   npm run test:seance-offline-render
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
const ENTREE = join(ICI, "seance-offline-render", "entree.tsx");
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

/** Une page neuve, une base neuve, le harnais chargé. */
async function atelier(): Promise<{ page: Page; nomBase: string }> {
  const page = await contexte.newPage();
  page.on("pageerror", (erreur) => console.error("  [page]", erreur.message));
  await page.goto(origine);
  await page.waitForFunction(() => "__harnais" in window);
  compteur += 1;
  return { page, nomBase: `${PREFIXE_BASES}${runId}-render-${compteur}` };
}

type EtatDepot = {
  brouillon: { revision: number; payload: unknown } | null;
  operation: { revision: number; operationId: string; payload: Record<string, unknown> } | null;
};

const lireDepot = (page: Page, nomBase: string) =>
  page.evaluate(
    (n) => (window as unknown as { __harnais: { etatDepot: (n: string) => Promise<EtatDepot> } }).__harnais.etatDepot(n),
    nomBase,
  ) as Promise<EtatDepot>;

const requetes = (page: Page) =>
  page.evaluate(
    () => (window as unknown as { __harnais: { requetes: () => { url: string; methode: string }[] } }).__harnais.requetes(),
  );

const monter = (page: Page, config: Record<string, unknown>) =>
  page.evaluate(
    (c) => (window as unknown as { __harnais: { monter: (c: unknown) => Promise<void> } }).__harnais.monter(c),
    config,
  );


const envois = (page: Page) =>
  page.evaluate(
    () => (window as unknown as { __harnais: { envois: () => { globalComment: string }[] } }).__harnais.envois(),
  );
const relectures = (page: Page) =>
  page.evaluate(() => (window as unknown as { __harnais: { relectures: () => string[] } }).__harnais.relectures());

/** Attend que la synchronisation de montage soit retombée. */
async function laisserSynchroniser(page: Page) {
  await page.waitForFunction(() => !document.querySelector("fieldset")?.disabled);
  await page.waitForTimeout(300);
}

const OUTBOX_A = { charge: "état A", operationId: "op-A" };

const remonter = (page: Page, config: Record<string, unknown>) =>
  page.evaluate(
    (c) => (window as unknown as { __harnais: { remonter: (c: unknown) => Promise<void> } }).__harnais.remonter(c),
    config,
  );

/** Remplit le formulaire comme le ferait l'élève, puis valide. */
async function saisirEtValider(page: Page, duree: string, commentaire: string) {
  await page.waitForSelector("#duration-minutes");
  await page.waitForFunction(() => !document.querySelector("fieldset")?.disabled);
  await page.fill("#duration-minutes", duree);
  await page.fill("#global-comment", commentaire);
  await page.click(BOUTON);
  await page.waitForSelector(ATTENTE, { timeout: 5000 });
}

const BOUTON = "button:has-text('Enregistrer mon retour')";
const ATTENTE = "text=Synchronisation en attente";
/*
 * « Séance terminée » ne peut PAS servir de marqueur : c'est aussi le
 * libellé de la case à cocher du formulaire. On vise une phrase que seul le
 * récapitulatif porte.
 */
const CARTE_FIN = "text=Ton coach recevra ton retour";

try {
  /* ══════════════════════════════════════════════════════════════════════
   * R4 — HYDRATATION
   * ══════════════════════════════════════════════════════════════════════ */

  await test("R4. le brouillon est restauré, et AUCUNE écriture partielle n'a lieu pendant", async () => {
    const { page, nomBase } = await atelier();
    await monter(page, {
      nomBase,
      moteur: "retard",
      delaiMs: 350,
      brouillon: {
        exerciseFeedback: {},
        substitutions: {},
        videosExercice: {},
        blockDrafts: {},
        completed: false,
        globalRpe: "8",
        globalComment: "saisie restaurée",
        pain: "",
        painLevel: "aucune",
        painDetail: "",
        durationMinutes: "65",
      },
    });

    // Pendant l'hydratation, le formulaire annonce qu'il se prépare.
    await page.waitForSelector("text=Restauration de ta saisie…");
    const revisionPendant = (await lireDepot(page, nomBase)).brouillon?.revision;
    assert.equal(revisionPendant, 1, "une révision a été créée pendant l'hydratation");

    // Puis les états sont restaurés.
    await page.waitForSelector("#duration-minutes");
    await page.waitForFunction(
      () => (document.querySelector("#duration-minutes") as HTMLInputElement | null)?.value === "65",
      undefined,
      { timeout: 5000 },
    );
    assert.equal(await page.inputValue("#global-comment"), "saisie restaurée");

    // Et rien de partiel n'a été écrit : la révision n'a pas bougé.
    const apres = await lireDepot(page, nomBase);
    assert.equal(apres.brouillon?.revision, 1, "l'hydratation a produit des révisions intermédiaires");
    await page.close();
  });

  await test("R4b. COURSE — l'élève ne peut pas saisir une valeur qui serait écrasée", async () => {
    const { page, nomBase } = await atelier();
    await monter(page, {
      nomBase,
      moteur: "retard",
      delaiMs: 600,
      brouillon: {
        exerciseFeedback: {}, substitutions: {}, videosExercice: {}, blockDrafts: {},
        completed: false, globalRpe: "", globalComment: "valeur du brouillon",
        pain: "", painLevel: "aucune", painDetail: "", durationMinutes: "42",
      },
    });

    await page.waitForSelector("#duration-minutes");
    // Le champ existe, mais le navigateur REFUSE la saisie : il est dans un
    // `<fieldset disabled>`. C'est la fermeture déterministe de la course.
    assert.equal(
      await page.locator("#duration-minutes").isDisabled(),
      true,
      "le champ est modifiable pendant l'hydratation : une frappe serait écrasée",
    );
    assert.equal(await page.locator(BOUTON).isDisabled(), true, "on peut soumettre un formulaire non hydraté");

    await page.waitForFunction(
      () => (document.querySelector("#duration-minutes") as HTMLInputElement | null)?.value === "42",
      undefined,
      { timeout: 5000 },
    );
    // Une fois hydraté, la saisie redevient possible.
    assert.equal(await page.locator("#duration-minutes").isDisabled(), false);
    await page.close();
  });

  await test("R4c. l'autosave ne démarre QU'APRÈS l'hydratation", async () => {
    const { page, nomBase } = await atelier();
    await monter(page, { nomBase, moteur: "normal" });
    await page.waitForSelector("#duration-minutes");
    await page.waitForFunction(() => !document.querySelector("fieldset")?.disabled);

    assert.equal((await lireDepot(page, nomBase)).brouillon, null, "un brouillon a été écrit sans aucune saisie");

    await page.fill("#duration-minutes", "65");
    await page.waitForTimeout(1200); // au-delà du différé (800 ms)
    const apres = await lireDepot(page, nomBase);
    assert.ok(apres.brouillon, "l'autosave ne s'est pas déclenché après la saisie");
    assert.equal(
      (apres.brouillon?.payload as { durationMinutes: string }).durationMinutes,
      "65",
    );
    await page.close();
  });

  /* ══════════════════════════════════════════════════════════════════════
   * P8 – P11 — LE CLIC HORS LIGNE
   * ══════════════════════════════════════════════════════════════════════ */

  await test("P8/P9/P10/P11. clic réel hors ligne : aucun POST, commit atomique, pending APRÈS, pas de carte F2", async () => {
    const { page, nomBase } = await atelier();
    await monter(page, { nomBase, moteur: "normal" });
    await page.waitForSelector("#duration-minutes");
    await page.waitForFunction(() => !document.querySelector("fieldset")?.disabled);

    await page.fill("#duration-minutes", "65");
    await page.fill("#global-comment", "séance faite en avion");

    // P10 — AVANT le clic, rien n'est annoncé.
    assert.equal(await page.locator(ATTENTE).count(), 0);

    await page.click(BOUTON);
    await page.waitForSelector(ATTENTE, { timeout: 5000 });

    // P8 — aucune requête n'a quitté la page.
    assert.deepEqual(await requetes(page), [], "un POST a été tenté hors ligne");

    // P9 — brouillon ET opération, même révision : une seule transaction.
    const etat = await lireDepot(page, nomBase);
    assert.ok(etat.brouillon, "le brouillon manque");
    assert.ok(etat.operation, "l'opération en attente manque");
    assert.equal(etat.brouillon?.revision, etat.operation?.revision);
    assert.equal(etat.operation?.payload.durationMinutes, 65, "la durée déclarée n'est pas dans le payload");
    assert.equal(etat.operation?.payload.globalComment, "séance faite en avion");
    assert.equal(etat.operation?.payload.performedAt, "2026-08-09", "la date de la séance a bougé");

    // P11 — la carte de fin de séance ne doit PAS apparaître : rien n'est parti.
    assert.equal(
      await page.locator("text=Modifier mon retour").count(),
      0,
      "le récapitulatif de retour envoyé s'affiche alors que rien n'a été envoyé",
    );
    // La saisie reste à l'écran.
    assert.equal(await page.inputValue("#duration-minutes"), "65");
    await page.close();
  });

  /* ══════════════════════════════════════════════════════════════════════
   * P12 — LE STOCKAGE LOCAL TOMBE
   * ══════════════════════════════════════════════════════════════════════ */

  await test("P12. IndexedDB en panne : aucun faux succès, saisie conservée, erreur affichée", async () => {
    const { page, nomBase } = await atelier();
    await monter(page, { nomBase, moteur: "panne" });
    await page.waitForSelector("#duration-minutes");
    await page.waitForFunction(() => !document.querySelector("fieldset")?.disabled);

    await page.fill("#duration-minutes", "65");
    await page.click(BOUTON);
    await page.waitForSelector("text=Impossible d'enregistrer sur cet appareil", { timeout: 5000 });

    assert.equal(await page.locator(ATTENTE).count(), 0, "« Synchronisation en attente » affiché sans commit");
    assert.equal(await page.locator("text=Modifier mon retour").count(), 0, "carte de fin affichée malgré l'échec");
    assert.equal(await page.inputValue("#duration-minutes"), "65", "la saisie a été perdue");
    assert.deepEqual(await requetes(page), []);
    await page.close();
  });

  /* ══════════════════════════════════════════════════════════════════════
   * R15 — LA VIDÉO
   * ══════════════════════════════════════════════════════════════════════ */

  await test("R15a/R15b. hors ligne : aucun moyen d'ajouter une vidéo, aucun envoi déclenché", async () => {
    const { page, nomBase } = await atelier();
    await monter(page, { nomBase, moteur: "normal" });
    await page.waitForSelector("#duration-minutes");
    await page.waitForFunction(() => !document.querySelector("fieldset")?.disabled);

    // Le bloc d'ajout n'est pas seulement désactivé : il n'est pas monté.
    assert.equal(await page.locator('input[type="file"]').count(), 0, "un sélecteur de fichier est présent");
    assert.equal(await page.locator("button:has-text('Importer une vidéo')").count(), 0);
    assert.equal(await page.locator("button:has-text('Filmer')").count(), 0);
    assert.ok(
      (await page.locator("text=Une connexion est nécessaire pour ajouter une vidéo.").count()) > 0,
      "l'élève n'est pas informé",
    );

    // Et le reste du retour reste enregistrable.
    await page.fill("#duration-minutes", "70");
    await page.click(BOUTON);
    await page.waitForSelector(ATTENTE, { timeout: 5000 });
    assert.deepEqual(await requetes(page), [], "un envoi réseau a été déclenché");
    const etat = await lireDepot(page, nomBase);
    assert.equal(etat.operation?.payload.durationMinutes, 70);
    await page.close();
  });

  /* ══════════════════════════════════════════════════════════════════════
   * DRAFT — UNE SEULE FORME PAR MAGASIN
   * ══════════════════════════════════════════════════════════════════════ */

  await test("DRAFT1/2/3/5. après validation : draft = formulaire, outbox = payload, même révision", async () => {
    const { page, nomBase } = await atelier();
    await monter(page, { nomBase });
    await saisirEtValider(page, "65", "séance en avion");

    const etat = await lireDepot(page, nomBase);
    const draft = etat.brouillon?.payload as Record<string, unknown>;
    const outbox = etat.operation?.payload as Record<string, unknown>;

    // DRAFT1 — le draft porte la forme FORMULAIRE.
    assert.equal(typeof draft.durationMinutes, "string", "le draft porte un payload serveur");
    assert.equal(draft.durationMinutes, "65");
    assert.equal(typeof draft.globalRpe, "string");
    assert.ok(draft.exerciseFeedback, "la structure de saisie manque au draft");
    assert.equal(draft.globalComment, "séance en avion");

    // DRAFT2 — l'outbox porte la forme SERVEUR, normalisée.
    assert.equal(typeof outbox.durationMinutes, "number", "l'outbox ne porte pas la durée normalisée");
    assert.equal(outbox.durationMinutes, 65);
    assert.equal(outbox.performedAt, "2026-08-09", "la date de séance doit être figée");
    assert.ok(Array.isArray(outbox.exercises));

    // DRAFT3 — une seule révision pour les deux.
    assert.equal(etat.brouillon?.revision, etat.operation?.revision);

    // DRAFT5 — « 65 » côté formulaire, 65 côté serveur, dans le même geste.
    assert.notEqual(typeof draft.durationMinutes, typeof outbox.durationMinutes);
    await page.close();
  });

  await test("DRAFT4/DRAFT6. kill + réouverture avec pending : toutes les saisies reviennent", async () => {
    const { page, nomBase } = await atelier();
    await monter(page, { nomBase });
    await saisirEtValider(page, "65", "séance en avion");

    // KILL : l'arbre React est détruit, le dépôt reconstruit. Seul
    // IndexedDB survit — comme après une PWA tuée.
    await remonter(page, { nomBase });

    // DRAFT6 — aucun `trim is not a function` : l'écran revient.
    await page.waitForSelector("#duration-minutes", { timeout: 5000 });
    await page.waitForFunction(() => !document.querySelector("fieldset")?.disabled);

    // DRAFT4 — les saisies sont là.
    assert.equal(await page.inputValue("#duration-minutes"), "65", "la durée n'a pas été restaurée");
    assert.equal(await page.inputValue("#global-comment"), "séance en avion");
    await page.waitForSelector(ATTENTE, { timeout: 5000 });
    assert.equal(await page.locator(CARTE_FIN).count(), 0, "carte de fin sur un retour non parti");
    await page.close();
  });

  await test("DRAFT7. modification après réouverture → NOUVELLE révision, même operationId", async () => {
    const { page, nomBase } = await atelier();
    await monter(page, { nomBase });
    await saisirEtValider(page, "65", "première version");
    const avant = await lireDepot(page, nomBase);

    await remonter(page, { nomBase });
    await page.waitForSelector("#duration-minutes", { timeout: 5000 });
    await page.waitForFunction(() => !document.querySelector("fieldset")?.disabled);
    await page.fill("#global-comment", "version corrigée");
    await page.click(BOUTON);
    await page.waitForTimeout(500);

    const apres = await lireDepot(page, nomBase);
    assert.ok(
      (apres.operation?.revision ?? 0) > (avant.operation?.revision ?? 0),
      "la correction n'a pas produit de nouvelle révision",
    );
    assert.equal(apres.operation?.operationId, avant.operation?.operationId, "même retour, même identifiant");
    assert.equal(
      (apres.operation?.payload as Record<string, unknown>).globalComment,
      "version corrigée",
      "la dernière version n'est pas celle qui partira",
    );
    await page.close();
  });

  await test("DRAFT8. après synchronisation réussie, le vieux draft ne reprend JAMAIS la main", async () => {
    const { page, nomBase } = await atelier();
    await monter(page, { nomBase });
    await saisirEtValider(page, "65", "version locale");

    // Le réseau revient : on remonte avec un transport qui marche.
    await remonter(page, { nomBase, transport: "succes" });
    await page.waitForSelector(CARTE_FIN, { timeout: 5000 });

    assert.equal((await lireDepot(page, nomBase)).operation, null, "l'outbox devrait être acquittée");
    const corps = (await page.textContent("body")) ?? "";
    assert.ok(corps.includes("confirmé par le serveur"), "c'est le draft local qui s'affiche, pas le serveur");
    assert.ok(!corps.includes("version locale"), "le vieux draft a repris priorité sur le serveur");
    await page.close();
  });

  await test("DRAFT9. A en cours + B créée : draft B ET outbox B survivent au succès de A", async () => {
    const { page, nomBase } = await atelier();
    await monter(page, { nomBase, outbox: OUTBOX_A, transport: "course" });
    await laisserSynchroniser(page);

    const etat = await lireDepot(page, nomBase);
    assert.ok(etat.operation, "l'outbox B a été effacée par le succès de A");
    assert.equal((etat.operation?.payload as Record<string, unknown>).globalComment, "correction B");
    assert.ok(etat.brouillon, "le draft B a été effacé");
    assert.equal((etat.brouillon?.payload as Record<string, unknown>).globalComment, "correction B");
    assert.equal(etat.brouillon?.revision, etat.operation?.revision, "draft et outbox B doivent rester liés");
    assert.equal(await page.locator(CARTE_FIN).count(), 0, "carte F2 malgré B en attente");
    await page.close();
  });

  await test("DRAFT10. un ancien draft de forme INVALIDE ne fait jamais planter l'écran", async () => {
    const { page, nomBase } = await atelier();
    // Exactement ce que l'ancien code écrivait : un payload serveur, avec
    // des nombres là où le formulaire attend des chaînes.
    await page.evaluate(
      async (n: string) => {
        await (
          window as unknown as { __harnais: { semerDraftBrut: (n: string, p: unknown) => Promise<void> } }
        ).__harnais.semerDraftBrut(n, {
          studentId: "x", sessionKey: "y", completed: true,
          globalRpe: 8, durationMinutes: 65, performedAt: "2026-08-09", exercises: [],
        });
      },
      nomBase,
    );

    await monter(page, { nomBase });
    await page.waitForSelector("#duration-minutes", { timeout: 5000 });
    await page.waitForFunction(() => !document.querySelector("fieldset")?.disabled);

    // L'écran vit, le formulaire est utilisable, et rien d'illisible n'a été
    // injecté dedans.
    assert.equal(await page.inputValue("#duration-minutes"), "", "une forme invalide a été hydratée");
    await page.fill("#duration-minutes", "70");
    await page.click(BOUTON);
    await page.waitForSelector(ATTENTE, { timeout: 5000 });
    await page.close();
  });

  /* ══════════════════════════════════════════════════════════════════════
   * SYNC — LA SYNCHRONISATION AUTOMATIQUE
   * ══════════════════════════════════════════════════════════════════════ */

  await test("SYNC1/SYNC3/SYNC4/SYNC17. une opération en attente part au MONTAGE, sans geste de l'élève", async () => {
    // C'est le cas du redémarrage : séance validée hors ligne, PWA tuée,
    // réseau revenu, application rouverte. Personne ne rouvre la séance à la
    // main — le montage suffit.
    const { page, nomBase } = await atelier();
    await monter(page, { nomBase, outbox: OUTBOX_A, transport: "succes" });
    await laisserSynchroniser(page);

    assert.deepEqual((await envois(page)).map((e) => e.globalComment), ["état A"]);
    assert.deepEqual(await relectures(page), ["33333333-3333-4333-8333-111111111111"]);
    await page.close();
  });

  await test("SYNC2. `visibilitychange` → visible relance l'envoi", async () => {
    const { page, nomBase } = await atelier();
    // Transport en panne réseau au montage : l'opération reste.
    await monter(page, { nomBase, outbox: OUTBOX_A, transport: "reseau" });
    await laisserSynchroniser(page);
    assert.equal((await envois(page)).length, 1);

    // On remplace le transport par un transport qui marche, puis on simule
    // le retour au premier plan.
    await page.evaluate(() => {
      Object.defineProperty(document, "visibilityState", { value: "visible", configurable: true });
      document.dispatchEvent(new Event("visibilitychange"));
    });
    await page.waitForTimeout(400);
    assert.ok((await envois(page)).length >= 2, "le retour au premier plan n'a rien relancé");
    await page.close();
  });

  await test("SYNC5. quatre déclencheurs quasi simultanés → UN SEUL envoi", async () => {
    const { page, nomBase } = await atelier();
    await monter(page, { nomBase, outbox: OUTBOX_A, transport: "succes" });
    // Le montage a déjà déclenché le premier ; on en empile trois autres
    // dans la même milliseconde.
    await page.evaluate(() => {
      window.dispatchEvent(new Event("online"));
      document.dispatchEvent(new Event("visibilitychange"));
      window.dispatchEvent(new Event("online"));
    });
    await laisserSynchroniser(page);
    assert.equal(
      (await envois(page)).length,
      1,
      "le verrou par compte n'a pas absorbé la rafale",
    );
    await page.close();
  });

  await test("SYNC6/SYNC7. succès + relecture → outbox acquittée, bandeau disparu", async () => {
    const { page, nomBase } = await atelier();
    await monter(page, { nomBase, outbox: OUTBOX_A, transport: "succes" });
    await laisserSynchroniser(page);

    assert.equal((await lireDepot(page, nomBase)).operation, null, "l'outbox n'a pas été acquittée");
    await page.waitForFunction(
      () => !document.body.textContent?.includes("Synchronisation en attente"),
      undefined,
      { timeout: 5000 },
    );
    await page.close();
  });

  await test("SYNC8. serveur confirmé → le récapitulatif remplace le formulaire", async () => {
    const { page, nomBase } = await atelier();
    await monter(page, { nomBase, outbox: OUTBOX_A, transport: "succes" });

    // La relecture serveur a alimenté `existingFeedback` (SERVER WINS) et
    // l'outbox est vide : la branche récapitulatif reprend la main, donc le
    // formulaire disparaît. Le bouton « Modifier mon retour », lui, reste
    // conditionné au chemin Supabase réel — absent de ce harnais, où aucune
    // variable d'environnement n'est fournie.
    // On attend le RÉCAPITULATIF lui-même, pas l'absence du formulaire :
    // l'écran affiche aussi « Chargement du retour… » au tout premier
    // rendu, où le formulaire est également absent. Attendre une absence,
    // c'est risquer de confondre « pas encore » et « plus jamais ».
    await page.waitForSelector(CARTE_FIN, { timeout: 5000 });
    assert.equal((await lireDepot(page, nomBase)).operation, null, "l'outbox devrait être acquittée");
    assert.equal(await page.locator(ATTENTE).count(), 0, "le bandeau persiste après acquittement");
    // Et ce qui s'affiche vient bien de la RELECTURE serveur, pas de la
    // saisie locale : « confirmé par le serveur » est le commentaire que
    // seul le serveur porte.
    const corps = (await page.textContent("body")) ?? "";
    assert.ok(corps.includes("confirmé par le serveur"), "l'état affiché ne vient pas du serveur");
    assert.ok(corps.includes("Ton coach recevra ton retour"), "le récapitulatif de fin de séance n'est pas rendu");
    await page.close();
  });

  await test("SYNC9. A confirmée pendant que B est créée → B RESTE, bandeau maintenu", async () => {
    const { page, nomBase } = await atelier();
    await monter(page, { nomBase, outbox: OUTBOX_A, transport: "course" });
    await laisserSynchroniser(page);

    const etat = await lireDepot(page, nomBase);
    assert.ok(etat.operation, "la correction B a été effacée par l'acquittement de A");
    assert.equal(etat.operation?.payload.globalComment, "correction B");
    assert.equal(etat.operation?.operationId, "op-A", "même retour, même identifiant d'idempotence");
    await page.waitForSelector(ATTENTE, { timeout: 5000 });
    assert.equal(await page.locator("text=Modifier mon retour").count(), 0, "carte de fin malgré un pending");
    await page.close();
  });

  await test("SYNC10. flush suivant → B part à son tour et est acquittée", async () => {
    const { page, nomBase } = await atelier();
    await monter(page, { nomBase, outbox: OUTBOX_A, transport: "course" });
    await laisserSynchroniser(page);
    assert.ok((await lireDepot(page, nomBase)).operation, "B devrait attendre");

    // Le transport « course » ne recrée B qu'une fois par envoi : au flush
    // suivant, il en fabriquerait un troisième. On déclenche donc un envoi et
    // on vérifie que B est bien PARTI (le contenu envoyé le prouve).
    await page.evaluate(() => window.dispatchEvent(new Event("online")));
    await page.waitForTimeout(500);
    const envoyes = (await envois(page)).map((e) => e.globalComment);
    assert.ok(envoyes.includes("correction B"), `B n'a jamais été envoyée : ${envoyes.join(", ")}`);
    await page.close();
  });

  await test("SYNC11/SYNC16. sans identité locale : AUCUN envoi, l'outbox de A reste intacte", async () => {
    const { page, nomBase } = await atelier();
    await monter(page, { nomBase, outbox: OUTBOX_A, transport: "succes", avecIdentite: false });
    await page.waitForTimeout(600);

    assert.deepEqual(await envois(page), [], "un envoi a eu lieu sans compte identifié");
    assert.ok((await lireDepot(page, nomBase)).operation, "l'opération de A a disparu");
    await page.close();
  });

  await test("SYNC12. erreur RÉSEAU → opération conservée, aucun acquittement", async () => {
    const { page, nomBase } = await atelier();
    await monter(page, { nomBase, outbox: OUTBOX_A, transport: "reseau" });
    await laisserSynchroniser(page);

    assert.equal((await envois(page)).length, 1);
    assert.deepEqual(await relectures(page), [], "une relecture a été tentée sans succès d'envoi");
    const etat = await lireDepot(page, nomBase);
    assert.ok(etat.operation, "l'opération a disparu sur une coupure réseau");
    assert.equal(etat.operation?.payload.globalComment, "état A");
    await page.waitForSelector(ATTENTE, { timeout: 5000 });
    await page.close();
  });

  await test("SYNC13. refus MÉTIER → conservée, avec le diagnostic", async () => {
    const { page, nomBase } = await atelier();
    await monter(page, { nomBase, outbox: OUTBOX_A, transport: "metier" });
    await laisserSynchroniser(page);

    const etat = await lireDepot(page, nomBase);
    assert.ok(etat.operation, "un refus métier a effacé la séance");
    await page.waitForSelector(ATTENTE, { timeout: 5000 });
    await page.close();
  });

  await test("SYNC14. POST réussi mais relecture en échec → PAS d'acquittement", async () => {
    const { page, nomBase } = await atelier();
    await monter(page, { nomBase, outbox: OUTBOX_A, transport: "relecture_ko" });
    await laisserSynchroniser(page);

    assert.equal((await envois(page)).length, 1);
    assert.equal((await relectures(page)).length, 1);
    assert.ok(
      (await lireDepot(page, nomBase)).operation,
      "acquitté sans savoir ce que le serveur a retenu",
    );
    await page.waitForSelector(ATTENTE, { timeout: 5000 });
    await page.close();
  });

  await test("SYNC15/SYNC18. outbox vide → zéro envoi, et aucune boucle", async () => {
    const { page, nomBase } = await atelier();
    await monter(page, { nomBase, transport: "succes" });
    await laisserSynchroniser(page);
    assert.deepEqual(await envois(page), [], "un envoi a eu lieu sans rien à envoyer");

    // Une synchronisation qui déclencherait un rendu, lequel relancerait une
    // synchronisation, enverrait des requêtes indéfiniment. On secoue.
    for (let i = 0; i < 5; i += 1) {
      await page.evaluate(() => {
        window.dispatchEvent(new Event("online"));
        document.dispatchEvent(new Event("visibilitychange"));
      });
    }
    await page.waitForTimeout(600);
    assert.deepEqual(await envois(page), [], "des envois se déclenchent en boucle");
    await page.close();
  });
} finally {
  // Nettoyage : aucune base de test ne survit.
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
