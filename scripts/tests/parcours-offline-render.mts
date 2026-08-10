import assert from "node:assert/strict";
import { createServer, type Server } from "node:http";
import { existsSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import esbuild from "esbuild";
import type { Browser, BrowserContext, Page } from "playwright-core";

/**
 * LE PARCOURS iPHONE, DE BOUT EN BOUT, DANS UN VRAI NAVIGATEUR.
 *
 * ════════════════════════════════════════════════════════════════════════
 * LE BOGUE QUE CETTE SUITE EXISTE POUR EMPÊCHER DE REVENIR
 * ════════════════════════════════════════════════════════════════════════
 * 09/08/2026, iPhone, mode avion, après relance de la PWA : /entrainement
 * affichait « Force & Hypertrophie » et « Remise en route » — les
 * programmes de DÉMONSTRATION de `data/student.ts` — et sa carte du jour
 * pointait vers une séance de démonstration. Rien à l'écran ne le disait.
 *
 * La cause : `useSupabaseTrainingProgram` rend `active: false` sur TOUTE
 * erreur, panne réseau comprise, et la page traitait ce `false` comme
 * « environnement de démonstration ».
 *
 * Aucun test ne pouvait l'attraper : ils rendaient `SessionFeedbackSection`
 * avec des props déjà choisies, jamais la PAGE qui les choisit.
 */

const RACINE = join(dirname(fileURLToPath(import.meta.url)), "..", "..");
const ENTREE = join(RACINE, "scripts", "tests", "parcours-offline-render", "entree.tsx");
const STUB_RESEAU = join(RACINE, "scripts", "tests", "parcours-offline-render", "supabase-mode.ts");
const STUB_HOOKS = join(RACINE, "scripts", "tests", "parcours-offline-render", "hooks-en-ligne.ts");

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

/**
 * Le réseau est la SEULE frontière substituée : `@/lib/supabase/browser`
 * rend un client en mode avion. Tout le reste du graphe est le code de
 * production, pages comprises.
 */
const aliasReseau: esbuild.Plugin = {
  name: "alias-supabase-mode",
  setup(build) {
    build.onResolve({ filter: /^@\/lib\/supabase\/browser$/ }, () => ({ path: STUB_RESEAU }));
    // En mode `online` seulement, ces deux hooks rendent ce que le serveur
    // aurait rendu ; dans tous les autres modes ils délèguent au vrai hook.
    build.onResolve({ filter: /^@\/hooks\/useSupabaseTrainingProgram$/ }, (a) =>
      a.importer === STUB_HOOKS ? null : { path: STUB_HOOKS });
    build.onResolve({ filter: /^@\/hooks\/useSupabaseStudentProfile$/ }, (a) =>
      a.importer === STUB_HOOKS ? null : { path: STUB_HOOKS });
    build.onResolve({ filter: /^@\/hooks\/useSupabaseNutritionForStudent$/ }, (a) =>
      a.importer === STUB_HOOKS ? null : { path: STUB_HOOKS });
    build.onResolve({ filter: /^@\/hooks\/useSupabaseStudentDocuments$/ }, (a) =>
      a.importer === STUB_HOOKS ? null : { path: STUB_HOOKS });
    build.onResolve({ filter: /^@\/hooks\/useStudentNutritionPlanV2$/ }, (a) =>
      a.importer === STUB_HOOKS ? null : { path: STUB_HOOKS });
  },
};

const construction = await esbuild.build({
  entryPoints: [ENTREE],
  bundle: true,
  write: false,
  format: "esm",
  platform: "browser",
  target: "es2022",
  jsx: "automatic",
  tsconfig: join(RACINE, "tsconfig.json"),
  plugins: [aliasReseau],
  define: {
    "process.env.NODE_ENV": '"development"',
    // L'encart de diagnostic n'est visible qu'ainsi — en production il rend `null`.
    "process.env.NEXT_PUBLIC_DIAGNOSTIC_OFFLINE": '"1"',
  },
  banner: { js: "globalThis.process ??= { env: {} };" },
  logLevel: "silent",
});
const bundle = construction.outputFiles[0].text;

const PAGE = `<!doctype html><html lang="fr"><head><meta charset="utf-8"><title>parcours</title></head>
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

interface Vu {
  texte: string;
  liens: string[];
  boutons: string[];
  champsFichier: number;
  diagnostics: string[];
}

/**
 * Un CONTEXTE NEUF par cas — donc un stockage neuf.
 *
 * C'est ce qui autorise les pages à viser la base de production : dans un
 * profil de navigateur créé à l'instant, elle est vide et le restera. Le
 * contexte est détruit à la fin du cas.
 */
async function atelier<T>(travail: (page: Page, appeler: <R>(nom: string, ...args: unknown[]) => Promise<R>) => Promise<T>): Promise<T> {
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
    // Mode par défaut : l'avion. Les cas en ligne le changent eux-mêmes.
    await appeler("reseau", "offline");
    return await travail(page, appeler);
  } finally {
    await contexte.close();
  }
}

/** Les chaînes de `data/student.ts` qui ne doivent JAMAIS apparaître à un vrai compte. */
const CHAINES_DEMONSTRATION = [
  "Force & Hypertrophie",
  "Remise en route",
  "Upper Body — Pectoraux / Triceps",
  "Prise de masse musculaire",
  "Reprise progressive après pause",
];

/* ════════════════════════════════════════════════════════════════════════
 * I. /ENTRAINEMENT APRÈS UN DÉMARRAGE À FROID SANS RÉSEAU
 * ════════════════════════════════════════════════════════════════════════ */

await test("PAR1. /entrainement hors ligne n'affiche AUCUNE donnée de démonstration", async () => {
  await atelier(async (page, appeler) => {
    await appeler("semer", {});
    await appeler("monterEntrainement");
    await page.waitForFunction(
      () => !/Chargement…/.test(document.getElementById("racine")?.textContent ?? ""),
      undefined,
      { timeout: 5000 },
    );
    const vu = await appeler<Vu>("vu");
    for (const chaine of CHAINES_DEMONSTRATION) {
      assert.ok(
        !vu.texte.includes(chaine),
        `« ${chaine} » vient de data/student.ts et n'a rien à faire devant un élève réel`,
      );
    }
  });
});

await test("PAR2. la carte du jour porte le sessionId EXACT du snapshot", async () => {
  await atelier(async (page, appeler) => {
    const c = await appeler<{ SEANCE: string; nomSeance: string }>("constantes");
    await appeler("semer", {});
    await appeler("monterEntrainement");
    await page.waitForFunction(
      () => /Prochaine séance/.test(document.getElementById("racine")?.textContent ?? ""),
      undefined,
      { timeout: 5000 },
    );
    const vu = await appeler<Vu>("vu");
    assert.ok(vu.texte.includes(c.nomSeance), "la séance du snapshot doit être celle affichée");
    assert.ok(
      vu.liens.includes(`/entrainement/seance/${c.SEANCE}`),
      `le lien doit viser la séance du snapshot ; liens rendus : ${vu.liens.join(" | ")}`,
    );
    assert.ok(
      !vu.liens.some((l) => /\/entrainement\/seance\/session-/.test(l)),
      "un lien vers une séance de démonstration est resté",
    );
  });
});

await test("PAR3. sans snapshot, /entrainement le DIT — il n'invente rien", async () => {
  await atelier(async (page, appeler) => {
    await appeler("monterEntrainement");
    await page.waitForFunction(
      () => !/Chargement…/.test(document.getElementById("racine")?.textContent ?? ""),
      undefined,
      { timeout: 5000 },
    );
    const vu = await appeler<Vu>("vu");
    for (const chaine of CHAINES_DEMONSTRATION) {
      assert.ok(!vu.texte.includes(chaine), `« ${chaine} » ne doit pas servir de repli`);
    }
    assert.ok(
      /pas disponible sur cet appareil|Connecte-toi à Internet/i.test(vu.texte),
      "l'écran doit dire pourquoi il est vide",
    );
  });
});

/* ════════════════════════════════════════════════════════════════════════
 * II. LA SÉANCE OUVERTE DEPUIS CETTE CARTE
 * ════════════════════════════════════════════════════════════════════════ */

await test("PAR4. la séance s'ouvre en source `offline`, sur le sessionId du snapshot", async () => {
  await atelier(async (page, appeler) => {
    const c = await appeler<{ SEANCE: string }>("constantes");
    await appeler("semer", {});
    await appeler("monterSeance", c.SEANCE);
    await page.waitForFunction(
      () => /Retour élève|Résumé de la séance/.test(document.getElementById("racine")?.textContent ?? ""),
      undefined,
      { timeout: 5000 },
    );
    const vu = await appeler<Vu>("vu");
    const diagnostic = vu.diagnostics.join(" ");
    assert.match(diagnostic, /source\s*offline/, `source attendue « offline » — lu : ${diagnostic}`);
    assert.match(diagnostic, /horsLigne\s*true/, `horsLigne attendu « true » — lu : ${diagnostic}`);
    assert.ok(diagnostic.includes(c.SEANCE), "le sessionId rendu doit être celui du snapshot");
  });
});

await test("PAR5. hors ligne, AUCUNE commande d'ajout de vidéo n'est montée (R15)", async () => {
  await atelier(async (page, appeler) => {
    const c = await appeler<{ SEANCE: string }>("constantes");
    await appeler("semer", {});
    await appeler("monterSeance", c.SEANCE);
    await page.waitForFunction(
      () => /Retour élève|Résumé de la séance/.test(document.getElementById("racine")?.textContent ?? ""),
      undefined,
      { timeout: 5000 },
    );
    const vu = await appeler<Vu>("vu");
    assert.equal(vu.champsFichier, 0, "un <input type=\"file\"> est monté hors ligne");
    for (const libelle of ["Importer une vidéo", "Filmer 20 s"]) {
      assert.ok(
        !vu.boutons.some((b) => b.toLowerCase().includes(libelle.toLowerCase())),
        `« ${libelle} » est encore proposé en avion`,
      );
    }
  });
});

await test("PAR6. les remplaçants du snapshot sont proposés SANS réseau", async () => {
  await atelier(async (page, appeler) => {
    const c = await appeler<{ SEANCE: string }>("constantes");
    await appeler("semer", {});
    await appeler("monterSeance", c.SEANCE);
    await page.waitForFunction(
      () => /Retour élève|Résumé de la séance/.test(document.getElementById("racine")?.textContent ?? ""),
      undefined,
      { timeout: 5000 },
    );
    const options = await appeler<string[]>("ouvrirRemplacants");
    assert.ok(
      options.some((o) => o.includes("Tirage vertical")),
      `le sélecteur doit proposer les options du snapshot — obtenu : ${JSON.stringify(options)}`,
    );
  });
});

await test("PAR7. une séance ABSENTE du snapshot ne rend jamais la démonstration", async () => {
  await atelier(async (page, appeler) => {
    await appeler("semer", {});
    await appeler("monterSeance", "44444444-4444-4444-8444-444444444444");
    await page.waitForFunction(
      () => !/Chargement…/.test(document.getElementById("racine")?.textContent ?? ""),
      undefined,
      { timeout: 5000 },
    );
    const vu = await appeler<Vu>("vu");
    assert.ok(/introuvable|pas disponible/i.test(vu.texte), "l'écran doit le dire");
    assert.ok(!vu.texte.includes("Développé couché — Barre"), "aucune séance de démonstration");
  });
});

/* ════════════════════════════════════════════════════════════════════════
 * III. LE DASHBOARD
 * ════════════════════════════════════════════════════════════════════════
 * Même défaut historique : `active: false` était lu comme « démonstration »,
 * alors qu'il veut dire « le chargement n'a rien donné » — panne réseau
 * comprise. Le dashboard ne montrait pas de mock (une garde antérieure le
 * couvrait) mais annonçait à l'élève, en avion, que son compte n'était pas
 * relié à une fiche. C'était faux.
 * ════════════════════════════════════════════════════════════════════════ */

await test("DASH1. dashboard EN LIGNE : les données réelles, jamais celles de la démonstration", async () => {
  await atelier(async (page, appeler) => {
    const c = await appeler<{ prenomReel: string }>("constantes");
    await appeler("reseau", "online");
    await appeler("monterDashboard");
    await page.waitForFunction(
      () => !/Chargement du dashboard/.test(document.getElementById("racine")?.textContent ?? ""),
      undefined,
      { timeout: 5000 },
    );
    const vu = await appeler<Vu>("vu");
    assert.ok(vu.texte.includes(c.prenomReel), `le prénom réel doit s'afficher — lu : ${vu.texte.slice(0, 120)}`);
    assert.ok(
      !vu.texte.includes("Programme Force & Hypertrophie"),
      "le programme de démonstration ne doit pas apparaître pour un compte réel",
    );
  });
});

await test("DASH2. dashboard HORS LIGNE : aucune chaîne de data/student.ts, et la vraie séance du jour", async () => {
  await atelier(async (page, appeler) => {
    const c = await appeler<{ SEANCE: string; nomSeance: string }>("constantes");
    await appeler("semer", {});
    await appeler("monterDashboard");
    await page.waitForFunction(
      () => !/Chargement du dashboard/.test(document.getElementById("racine")?.textContent ?? ""),
      undefined,
      { timeout: 5000 },
    );
    const vu = await appeler<Vu>("vu");
    for (const chaine of CHAINES_DEMONSTRATION) {
      assert.ok(!vu.texte.includes(chaine), `« ${chaine} » vient de data/student.ts`);
    }
    assert.ok(
      !/pas encore relié à une fiche élève/.test(vu.texte),
      "en avion, on ne dit pas à l'élève que son compte est mal configuré",
    );
    assert.ok(vu.texte.includes(c.nomSeance), "la séance du jour du snapshot doit être proposée");
    assert.ok(
      vu.liens.includes(`/entrainement/seance/${c.SEANCE}`),
      `le lien doit viser la séance réelle ; liens : ${vu.liens.join(" | ")}`,
    );
  });
});

await test("DASH3. dashboard sur ERREUR SERVEUR : ni démonstration, ni snapshot", async () => {
  await atelier(async (page, appeler) => {
    const c = await appeler<{ nomSeance: string }>("constantes");
    // Un snapshot EXISTE : c'est tout l'intérêt du cas. Un 500 ne doit pas
    // ouvrir le dépôt local — le serveur a répondu, il n'y a pas de panne
    // réseau, et servir une photographie d'hier masquerait l'incident.
    await appeler("semer", {});
    await appeler("reseau", "erreur");
    await appeler("monterDashboard");
    await page.waitForFunction(
      () => !/Chargement du dashboard/.test(document.getElementById("racine")?.textContent ?? ""),
      undefined,
      { timeout: 5000 },
    );
    const vu = await appeler<Vu>("vu");
    for (const chaine of CHAINES_DEMONSTRATION) {
      assert.ok(!vu.texte.includes(chaine), `« ${chaine} » ne doit pas servir de repli`);
    }
    assert.ok(!vu.texte.includes(c.nomSeance), "un 500 ne doit PAS ouvrir le snapshot");
    assert.match(vu.diagnostics.join(" "), /etat\s*erreur/, "l'état retenu doit être « erreur »");
    assert.ok(/n'a pas pu répondre/.test(vu.texte), "l'écran doit dire que le serveur a échoué");
  });
});

/* ════════════════════════════════════════════════════════════════════════
 * IV. LE DÉTAIL D'UN PROGRAMME
 * ════════════════════════════════════════════════════════════════════════ */

await test("PROG1. /entrainement/[programId] EN LIGNE : le programme réel", async () => {
  await atelier(async (page, appeler) => {
    const c = await appeler<{ PROGRAMME: string; nomProgrammeReel: string }>("constantes");
    await appeler("reseau", "online");
    await appeler("monterProgramme", c.PROGRAMME);
    await page.waitForFunction(
      () => !/Chargement…/.test(document.getElementById("racine")?.textContent ?? ""),
      undefined,
      { timeout: 5000 },
    );
    const vu = await appeler<Vu>("vu");
    assert.ok(vu.texte.includes(c.nomProgrammeReel), `le programme réel doit s'afficher — lu : ${vu.texte.slice(0, 160)}`);
    for (const chaine of CHAINES_DEMONSTRATION) {
      assert.ok(!vu.texte.includes(chaine), `« ${chaine} » n'a rien à faire ici`);
    }
  });
});

await test("PROG2. la même page HORS LIGNE : jamais un programme de démonstration", async () => {
  await atelier(async (page, appeler) => {
    const c = await appeler<{ PROGRAMME: string }>("constantes");
    await appeler("semer", {});
    await appeler("monterProgramme", c.PROGRAMME);
    await page.waitForFunction(
      () => !/Chargement…/.test(document.getElementById("racine")?.textContent ?? ""),
      undefined,
      { timeout: 5000 },
    );
    const vu = await appeler<Vu>("vu");
    for (const chaine of CHAINES_DEMONSTRATION) {
      assert.ok(!vu.texte.includes(chaine), `« ${chaine} » vient de data/student.ts`);
    }
    assert.ok(/nécessite une connexion/.test(vu.texte), "l'écran doit dire ce qui manque");
    assert.ok(vu.texte.includes("Hypertrophie — bloc 2"), "le nom du programme du snapshot peut être montré");
  });
});

await test("PROG3. donnée insuffisante hors ligne : état explicite, et rien d'inventé", async () => {
  await atelier(async (page, appeler) => {
    const c = await appeler<{ nomSeance: string }>("constantes");
    // Le snapshot porte un AUTRE programme que celui demandé.
    await appeler("semer", {});
    await appeler("monterProgramme", "12345678-1234-4123-8123-123456789abc");
    await page.waitForFunction(
      () => !/Chargement…/.test(document.getElementById("racine")?.textContent ?? ""),
      undefined,
      { timeout: 5000 },
    );
    const vu = await appeler<Vu>("vu");
    assert.ok(/nécessite une connexion/.test(vu.texte), "l'écran doit être explicite");
    assert.ok(!vu.texte.includes(c.nomSeance), "la séance d'un AUTRE programme ne doit pas être proposée ici");
    for (const chaine of CHAINES_DEMONSTRATION) {
      assert.ok(!vu.texte.includes(chaine), `« ${chaine} » ne doit pas servir de repli`);
    }
  });
});

/* ════════════════════════════════════════════════════════════════════════
 * V. NUTRITION ET DOCUMENTS — LES TROIS DERNIÈRES DETTES
 * ════════════════════════════════════════════════════════════════════════
 * Ni l'une ni l'autre n'est disponible hors ligne, et ce n'est pas l'objet.
 * L'objet : qu'un élève réel en avion ne reçoive plus le plan alimentaire ni
 * la bibliothèque de démonstration — des macros et des documents qui ne sont
 * pas les siens, présentés comme les siens.
 * ════════════════════════════════════════════════════════════════════════ */

/** Ce que `data/student.ts` contient pour ces deux écrans. */
const CHAINES_NUTRITION_DEMO = ["3 L / jour", "Whey protéine", "Créatine monohydrate", "relancer ton métabolisme"];
const CHAINES_DOCUMENTS_DEMO = ["Guide nutrition prise de masse"];

await test("NUT1. nutrition EN LIGNE : le plan réel, inchangé", async () => {
  await atelier(async (page, appeler) => {
    const c = await appeler<{ nomPlanReel: string }>("constantes");
    await appeler("reseau", "online");
    await appeler("monterNutrition");
    await page.waitForFunction(
      () => !/Chargement…/.test(document.getElementById("racine")?.textContent ?? ""),
      undefined,
      { timeout: 5000 },
    );
    const vu = await appeler<Vu>("vu");
    assert.ok(vu.texte.includes(c.nomPlanReel), `le plan réel doit s'afficher — lu : ${vu.texte.slice(0, 160)}`);
    for (const chaine of CHAINES_NUTRITION_DEMO) {
      assert.ok(!vu.texte.includes(chaine), `« ${chaine} » vient de data/student.ts`);
    }
  });
});

await test("NUT2. nutrition HORS LIGNE : aucun contenu de data/student.ts", async () => {
  await atelier(async (page, appeler) => {
    await appeler("monterNutrition");
    await page.waitForFunction(
      () => !/Chargement…/.test(document.getElementById("racine")?.textContent ?? ""),
      undefined,
      { timeout: 5000 },
    );
    const vu = await appeler<Vu>("vu");
    for (const chaine of CHAINES_NUTRITION_DEMO) {
      assert.ok(!vu.texte.includes(chaine), `« ${chaine} » ne doit pas servir de repli`);
    }
    assert.ok(/nécessite une connexion/.test(vu.texte), "l'écran doit dire ce qui manque");
    assert.match(vu.diagnostics.join(" "), /etat\s*offline/, "l'état retenu doit être « offline »");
  });
});

await test("NUT3. nutrition sur ERREUR SERVEUR : jamais la démonstration", async () => {
  await atelier(async (page, appeler) => {
    await appeler("reseau", "erreur");
    await appeler("monterNutrition");
    await page.waitForFunction(
      () => !/Chargement…/.test(document.getElementById("racine")?.textContent ?? ""),
      undefined,
      { timeout: 5000 },
    );
    const vu = await appeler<Vu>("vu");
    for (const chaine of CHAINES_NUTRITION_DEMO) {
      assert.ok(!vu.texte.includes(chaine), `« ${chaine} » ne doit pas servir de repli`);
    }
    assert.match(vu.diagnostics.join(" "), /etat\s*erreur/, "un 500 doit rester un 500");
    assert.ok(/n'a pas pu répondre/.test(vu.texte), "l'écran doit dire que le serveur a échoué");
  });
});

await test("NUT4. détail d'un plan HORS LIGNE : « cette partie nécessite une connexion »", async () => {
  await atelier(async (page, appeler) => {
    const c = await appeler<{ PLAN: string }>("constantes");
    await appeler("monterPlan", c.PLAN);
    await page.waitForFunction(
      () => !/Chargement…/.test(document.getElementById("racine")?.textContent ?? ""),
      undefined,
      { timeout: 5000 },
    );
    const vu = await appeler<Vu>("vu");
    assert.ok(/nécessite une connexion/.test(vu.texte), "l'écran doit être explicite");
    for (const chaine of CHAINES_NUTRITION_DEMO) {
      assert.ok(!vu.texte.includes(chaine), `« ${chaine} » ne doit pas apparaître`);
    }
    assert.ok(
      vu.liens.includes("/nutrition"),
      `le retour vers les plans doit rester possible ; liens : ${vu.liens.join(" | ")}`,
    );
  });
});

await test("DOC1. documents EN LIGNE : la bibliothèque réelle, inchangée", async () => {
  await atelier(async (page, appeler) => {
    await appeler("reseau", "online");
    await appeler("monterDocuments");
    await page.waitForFunction(
      () => !/Chargement…/.test(document.getElementById("racine")?.textContent ?? ""),
      undefined,
      { timeout: 5000 },
    );
    const vu = await appeler<Vu>("vu");
    assert.ok(vu.texte.includes("ressources partagées par ton coach"), "l'écran réel doit être rendu");
    for (const chaine of CHAINES_DOCUMENTS_DEMO) {
      assert.ok(!vu.texte.includes(chaine), `« ${chaine} » vient de data/student.ts`);
    }
  });
});

await test("DOC2. documents HORS LIGNE : aucun document de démonstration", async () => {
  await atelier(async (page, appeler) => {
    await appeler("monterDocuments");
    await page.waitForFunction(
      () => !/Chargement…/.test(document.getElementById("racine")?.textContent ?? ""),
      undefined,
      { timeout: 5000 },
    );
    const vu = await appeler<Vu>("vu");
    for (const chaine of CHAINES_DOCUMENTS_DEMO) {
      assert.ok(!vu.texte.includes(chaine), `« ${chaine} » ne doit pas servir de repli`);
    }
    assert.ok(/nécessite une connexion/.test(vu.texte), "l'écran doit dire ce qui manque");
  });
});

await test("DOC3. documents sur ERREUR SERVEUR : jamais la démonstration", async () => {
  await atelier(async (page, appeler) => {
    await appeler("reseau", "erreur");
    await appeler("monterDocuments");
    await page.waitForFunction(
      () => !/Chargement…/.test(document.getElementById("racine")?.textContent ?? ""),
      undefined,
      { timeout: 5000 },
    );
    const vu = await appeler<Vu>("vu");
    for (const chaine of CHAINES_DOCUMENTS_DEMO) {
      assert.ok(!vu.texte.includes(chaine), `« ${chaine} » ne doit pas servir de repli`);
    }
    assert.match(vu.diagnostics.join(" "), /etat\s*erreur/, "un 500 doit rester un 500");
  });
});

/* ════════════════════════════════════════════════════════════════════════
 * VI. L'ENCART DE DIAGNOSTIC NE DOIT RIEN LAISSER FUIR
 * ════════════════════════════════════════════════════════════════════════ */

await test("DIAG1. aucun identifiant d'utilisateur complet dans l'encart", async () => {
  await atelier(async (page, appeler) => {
    const c = await appeler<{ USER: string; ELEVE: string; SEANCE: string }>("constantes");
    await appeler("semer", {});
    await appeler("monterSeance", c.SEANCE);
    await page.waitForFunction(
      () => /Retour élève|Résumé de la séance/.test(document.getElementById("racine")?.textContent ?? ""),
      undefined,
      { timeout: 5000 },
    );
    const diagnostic = (await appeler<Vu>("vu")).diagnostics.join(" ");
    assert.ok(!diagnostic.includes(c.USER), "l'identifiant Auth ne doit pas apparaître en entier");
    assert.ok(!diagnostic.includes(c.ELEVE), "l'identifiant élève ne doit pas apparaître en entier");
    // L'identifiant de SÉANCE, lui, désigne un objet : il reste lisible en
    // entier, c'est ce qui permet de comparer une capture à un snapshot.
    assert.ok(diagnostic.includes(c.SEANCE), "le sessionId doit rester comparable");
  });
});

await test("PROF1. profil HORS LIGNE : jamais le profil de démonstration", async () => {
  // Le huitième écran, trouvé en auditant le menu : l'import de
  // `data/student` était dans la page, l'appel des hooks dans le composant.
  // En avion, l'élève voyait un autre prénom, d'autres mensurations, et des
  // boutons d'édition qui écrivaient dans le localStorage du mock.
  await atelier(async (page, appeler) => {
    await appeler("monterProfil");
    await page.waitForFunction(
      () => !/Chargement du profil/.test(document.getElementById("racine")?.textContent ?? ""),
      undefined,
      { timeout: 5000 },
    );
    const vu = await appeler<Vu>("vu");
    assert.ok(!vu.texte.includes("Alexandre"), "le profil de démonstration ne doit jamais apparaître");
    assert.ok(/demande une connexion/.test(vu.texte), "l'écran doit dire ce qui manque");
    assert.match(vu.diagnostics.join(" "), /etat\s*offline/, "l'état retenu doit être « offline »");
  });
});

await navigateur.close();
serveur.close();

console.log(`\n${réussis} réussis, ${échecs} échecs`);
process.exit(échecs === 0 ? 0 : 1);
