import assert from "node:assert/strict";
import { existsSync, readFileSync, readdirSync } from "node:fs";
import { createServer, type Server } from "node:http";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import * as esbuild from "esbuild";
import type { Browser, BrowserContext, Page } from "playwright-core";

/**
 * LE PARCOURS HORIZONTAL D'UNE SÉANCE — MESURÉ, PAS DEVINÉ.
 *
 *   npx tsx scripts/tests/seance-carousel-render.mts
 *
 * ════════════════════════════════════════════════════════════════════════
 * TROIS NIVEAUX DE PREUVE, ET IL FAUT LES DISTINGUER
 * ════════════════════════════════════════════════════════════════════════
 * 1. STRUCTUREL (Node, sans navigateur) — `student-session-blocks.mts`,
 *    tests CAR-01…CAR-10 : la suite de cartes, leur ordre, leurs clés, la
 *    numérotation. Aucune disposition n'y est prouvée.
 *
 * 2. MESURÉ (ce fichier) — un vrai Chromium, la vraie feuille Tailwind du
 *    projet, le vrai `SessionFeedbackSection`. On lit ce que le moteur de
 *    disposition A CALCULÉ : `scroll-snap-type`, `scroll-snap-align`, la
 *    largeur d'une carte, l'existence d'un défilement horizontal, la
 *    hauteur du document, et la position du bouton d'envoi dans l'arbre.
 *    Un test qui chercherait « snap-mandatory » dans le source prouverait
 *    seulement que quelqu'un a tapé ces lettres ; ici, si Tailwind ne
 *    générait pas la règle, la mesure vaudrait « none » et le test
 *    rougirait.
 *
 * 3. TACTILE (fin de fichier) — un VRAI glissement du doigt, envoyé par le
 *    protocole de débogage de Chromium (`Input.dispatchTouchEvent`) dans un
 *    contexte tactile. Ce niveau est marqué à part dans la sortie : si
 *    l'inertie du navigateur sans affichage rend la mesure instable, le
 *    test le DIT au lieu de se déclarer vert.
 *
 * CE QUI N'EST PROUVÉ NULLE PART, ET QUI RESTE À VÉRIFIER À LA MAIN :
 * la sensation du geste sur un téléphone réel (fluidité, décélération,
 * confort du pouce), et le rendu visuel des couleurs de bloc.
 */

const ICI = dirname(fileURLToPath(import.meta.url));
const RACINE = resolve(ICI, "..", "..");
const ENTREE = join(ICI, "seance-carousel-render", "entree.tsx");

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
const remarques: string[] = [];
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
  console.log("Chrome introuvable — harnais non exécuté. CHROME_PATH=/chemin/vers/chrome pour l'indiquer.");
  process.exit(0);
}

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
  banner: { js: "globalThis.process ??= { env: {} };" },
  logLevel: "silent",
});
const paquet = construction.outputFiles[0].text;

/*
 * ⚠️ LA FEUILLE DE STYLE EST INDISPENSABLE.
 * Sans elle, `snap-x`, `snap-mandatory`, `snap-start`, `overflow-x-auto` et
 * `w-full` n'existent pas : toutes les mesures seraient celles d'un document
 * sans mise en page, et ce harnais serait vert quoi qu'il arrive. On compile
 * donc la CSS réelle du projet — y compris `.rail-seance`.
 */
const postcss = (await import("postcss")).default;
const tailwind = (await import("@tailwindcss/postcss")).default;
const css = (
  await postcss([tailwind({ base: RACINE })]).process(readFileSync(join(RACINE, "app/globals.css"), "utf8"), {
    from: join(RACINE, "app/globals.css"),
    to: join(RACINE, "app/globals.css"),
  })
).css;

const PAGE = `<!doctype html><html lang="fr"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><title>harnais carrousel</title><style>${css}</style></head>
<body><div id="racine"></div><script type="module" src="/paquet.js"></script></body></html>`;

const serveur: Server = createServer((requete, reponse) => {
  if ((requete.url ?? "/").startsWith("/paquet.js")) {
    reponse.writeHead(200, { "content-type": "text/javascript; charset=utf-8" }).end(paquet);
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

type Mesures = {
  snapType: string;
  overflowX: string;
  overscrollX: string;
  largeurRail: number;
  hauteurRail: number;
  largeurDefilable: number;
  scrollLeft: number;
  nbCartes: number;
  kinds: string[];
  snapAligns: string[];
  largeursCartes: number[];
  offsets: number[];
  submitPresent: boolean;
  submitDansRail: boolean;
  hauteurDocument: number;
  hauteurFenetre: number;
  indicateur: string;
};

type Harnais = {
  monter: (v?: "complet" | "solo" | "long") => Promise<void>;
  mesures: () => Mesures | null;
  defilerVers: (x: number) => Promise<number>;
  contenuCarte: (i: number) => {
    kind: string;
    texte: string;
    placeholders: string[];
    ariaLabels: string[];
    boutons: string[];
    selects: number;
    textareas: number;
  } | null;
  defileursVerticaux: () => { balise: string; dansRail: boolean; estUneCarte: boolean; hauteur: number }[];
  largeurDocument: () => { scrollWidth: number; innerWidth: number };
  carteEnButee: () => Promise<{
    enButee: boolean;
    overscrollY: string;
    scrollYPage: number;
    pageDefilable: boolean;
    centre: { x: number; y: number };
  }>;
  scrollYPage: () => number;
  lisere: () => {
    largeurCarte: string;
    couleurCarte: string;
    largeurBandeau: string;
    hauteurCarte: number;
    hauteurBandeau: number;
  }[];
  cliquerRail: (d: string) => Promise<number | null>;
  typesBoutonsRail: () => (string | null)[];
  espionnerSoumission: () => boolean;
  soumissions: number;
};

const H = "__harnais";

/**
 * `innerText` rend le texte TEL QU'IL S'AFFICHE : les classes `uppercase`
 * remontent donc en majuscules. Comparer sur la casse d'origine ferait
 * rougir un test alors que l'interface est correcte — et, pire, inviterait
 * à écrire les assertions en majuscules, ce qui les rendrait dépendantes
 * d'un choix purement visuel. On compare donc sans casse.
 */
const contient = (texte: string, attendu: string) => texte.toLowerCase().includes(attendu.toLowerCase());

async function atelier(
  taille: { width: number; height: number },
  tactile: boolean,
  variante: "complet" | "solo" | "long" = "complet",
): Promise<{ page: Page; contexte: BrowserContext }> {
  const contexte = await navigateur.newContext({
    viewport: taille,
    hasTouch: tactile,
    isMobile: tactile,
    deviceScaleFactor: tactile ? 3 : 1,
  });
  const page = await contexte.newPage();
  page.on("pageerror", (erreur) => console.error("  [page]", erreur.message));
  await page.goto(origine);
  await page.waitForFunction((h) => h in window, H);
  await page.evaluate(
    ([h, v]) => (window as unknown as Record<string, Harnais>)[h as string].monter(v as "complet" | "solo" | "long"),
    [H, variante],
  );
  await page.waitForSelector("[data-rail-seance]");
  return { page, contexte };
}

const mesurer = (page: Page) =>
  page.evaluate((h) => (window as unknown as Record<string, Harnais>)[h].mesures(), H) as Promise<Mesures>;

/* ══════════════════════════════════════════════════════════════════════════
 * NIVEAU 2 — MESURÉ DANS CHROMIUM
 * ══════════════════════════════════════════════════════════════════════════ */

console.log("\n── Mesuré dans Chromium (mobile 390 × 844) ──");

{
  const { page, contexte } = await atelier({ width: 390, height: 844 }, true);

  if (process.env.CAPTURE) {
    await page.screenshot({ path: process.env.CAPTURE, fullPage: false });
    console.log(`   capture → ${process.env.CAPTURE}`);
  }

  await test("CARR-01 — le rail EXISTE et défile horizontalement", async () => {
    const m = await mesurer(page);
    assert.equal(m.overflowX, "auto", "overflow-x calculé");
    assert.ok(
      m.largeurDefilable > m.largeurRail + 50,
      `le contenu doit dépasser le rail (${m.largeurDefilable} vs ${m.largeurRail})`,
    );
  });

  await test("CARR-02 — le rattrapage est OBLIGATOIRE sur l'axe X, et chaque carte s'aligne à gauche", async () => {
    const m = await mesurer(page);
    // Chromium normalise en « x mandatory ».
    assert.match(m.snapType, /\bx\b/, `axe X attendu, lu : « ${m.snapType} »`);
    assert.match(m.snapType, /mandatory/, `rattrapage obligatoire attendu, lu : « ${m.snapType} »`);
    assert.equal(m.snapAligns.length, m.nbCartes);
    assert.ok(
      m.snapAligns.every((a) => a === "start"),
      `toutes les cartes en scroll-snap-align:start, lu : ${JSON.stringify([...new Set(m.snapAligns)])}`,
    );
  });

  await test("CARR-03 — une carte par exercice, DEUX cartes pour le bloc cardio", async () => {
    const m = await mesurer(page);
    // 3 exercices + (cardio + validation) + 2 exercices = 7 cartes.
    assert.equal(m.nbCartes, 7, `7 cartes attendues, ${m.nbCartes} rendues`);
    assert.deepEqual(m.kinds, [
      "exercice",
      "exercice",
      "exercice",
      "cardio",
      "cardio-validation",
      "exercice",
      "exercice",
    ]);
  });

  await test("CARR-04 — sur téléphone, UNE carte occupe la largeur du rail", async () => {
    const m = await mesurer(page);
    for (const largeur of m.largeursCartes) {
      assert.ok(
        Math.abs(largeur - m.largeurRail) <= 2,
        `carte ${largeur}px pour un rail de ${m.largeurRail}px — une seule carte doit être visible`,
      );
    }
  });

  await test("CARR-05 — la validation GLOBALE est présente et HORS du rail", async () => {
    const m = await mesurer(page);
    assert.equal(m.submitPresent, true, "le bouton d'envoi de la séance doit exister");
    assert.equal(m.submitDansRail, false, "il ne doit JAMAIS être une carte du parcours");
  });

  await test("CARR-06 — la carte d'exercice garde TOUS ses contrôles", async () => {
    const carte = await page.evaluate((h) => (window as unknown as Record<string, Harnais>)[h].contenuCarte(0), H);
    assert.ok(carte, "carte 0 introuvable");
    assert.equal(carte.kind, "exercice");
    assert.ok(contient(carte.texte, "Tirage horizontal"), "le nom de l'exercice");
    assert.ok(contient(carte.texte, "2 séries"), "la prescription");
    assert.ok(contient(carte.texte, "Retour élève"), "le bloc de saisie");
    // Charge / Reps / RPE pour chacune des 2 séries.
    const charges = carte.placeholders.filter((p) => p.startsWith("Charge"));
    const reps = carte.placeholders.filter((p) => p.startsWith("Reps"));
    // Le placeholder du RPE porte la PRESCRIPTION (« RPE 8 »), pas le mot
    // « RPE » : on l'identifie par son libellé accessible, qui est stable.
    const rpe = carte.ariaLabels.filter((l) => l.startsWith("RPE série "));
    assert.equal(charges.length, 2, `2 champs Charge attendus, ${charges.length}`);
    assert.equal(reps.length, 2, `2 champs Reps attendus, ${reps.length}`);
    assert.equal(rpe.length, 2, `2 champs RPE attendus, ${rpe.length}`);
    assert.ok(
      carte.placeholders.some((p) => p.startsWith("Commentaire")),
      "le commentaire d'exercice",
    );
  });

  await test("CARR-07 — la carte de VALIDATION cardio porte le formulaire du bloc", async () => {
    const carte = await page.evaluate((h) => (window as unknown as Record<string, Harnais>)[h].contenuCarte(4), H);
    assert.ok(carte);
    assert.equal(carte.kind, "cardio-validation");
    assert.ok(contient(carte.texte, "Réalisation du bloc"), "le formulaire de réalisation");
    assert.ok(contient(carte.texte, "Bloc terminé"), "la case de fin de bloc");
    // Et la carte PRÉCÉDENTE porte la prescription, pas le formulaire.
    const prescription = await page.evaluate((h) => (window as unknown as Record<string, Harnais>)[h].contenuCarte(3), H);
    assert.equal(prescription?.kind, "cardio");
    assert.ok(!contient(prescription?.texte ?? "", "Réalisation du bloc"), "la prescription ne contient pas le formulaire");
  });

  await test("CARR-08 — chaque carte annonce son bloc", async () => {
    const c0 = await page.evaluate((h) => (window as unknown as Record<string, Harnais>)[h].contenuCarte(0), H);
    const c5 = await page.evaluate((h) => (window as unknown as Record<string, Harnais>)[h].contenuCarte(5), H);
    assert.ok((c0?.texte ?? "").toLowerCase().startsWith("bloc 1 · musculation"), `bandeau attendu, lu : « ${c0?.texte.slice(0, 40)} »`);
    assert.ok((c5?.texte ?? "").toLowerCase().startsWith("bloc 3 · musculation"), `bandeau attendu, lu : « ${c5?.texte.slice(0, 40)} »`);
  });

  await test("CARR-20 — le liseré du bloc descend sur TOUTE la hauteur de la carte", async () => {
    /*
     * Tant que la bordure colorée vivait sur le bandeau, le trait s'arrêtait
     * sous l'en-tête et la carte paraissait coupée. On vérifie donc qu'elle
     * est portée par la CARTE (donc pleine hauteur) et que le bandeau, lui,
     * n'en porte plus.
     */
    const liseres = await page.evaluate((h) => (window as unknown as Record<string, Harnais>)[h].lisere(), H);
    assert.equal(liseres.length, 7);
    for (const [index, l] of liseres.entries()) {
      assert.equal(l.largeurCarte, "4px", `carte ${index} : la bordure gauche doit être portée par la carte`);
      assert.equal(l.largeurBandeau, "0px", `carte ${index} : le bandeau ne doit plus porter de bordure gauche`);
      assert.ok(
        l.hauteurCarte > l.hauteurBandeau * 2,
        `carte ${index} : le liseré ne couvrirait que l'en-tête (${l.hauteurBandeau}px sur ${l.hauteurCarte}px)`,
      );
    }
    // Deux blocs de couleurs différentes doivent donner deux liserés distincts.
    assert.notEqual(liseres[0].couleurCarte, liseres[3].couleurCarte, "muscu et cardio ont deux couleurs");
  });

  await test("CARR-21 — chaque carte s'arrête à SON contenu, sans être étirée", async () => {
    /*
     * ARBITRAGE DU 23/08/2026. Les cartes ne sont pas alignées sur la
     * hauteur de la plus haute (`items-start` sur le rail) : une carte
     * courte — la prescription d'un bloc cardio, typiquement — étirait
     * sinon son cadre et son liseré sur plusieurs centaines de pixels
     * vides. Le vide subsiste dans le RAIL, mais il est transparent : plus
     * aucun cadre ne l'entoure, et la ligne d'indicateur ne bouge pas d'une
     * carte à l'autre puisqu'elle suit la hauteur du rail.
     */
    const liseres = await page.evaluate((h) => (window as unknown as Record<string, Harnais>)[h].lisere(), H);
    const hauteurs = liseres.map((l) => l.hauteurCarte);
    const min = Math.min(...hauteurs);
    const max = Math.max(...hauteurs);
    assert.ok(
      max - min > 20,
      `les cartes seraient toutes étirées à la même hauteur (${JSON.stringify(hauteurs)}) — « items-start » a disparu du rail`,
    );
    const m = await mesurer(page);
    assert.ok(
      min < m.hauteurRail - 20,
      `la carte la plus courte (${min}px) doit rester plus courte que le rail (${m.hauteurRail}px)`,
    );
  });

  await test("CARR-09 — un SEUL défilement vertical : la page. Et aucun défilement horizontal de page", async () => {
    /*
     * CE QUE CE TEST N'EXIGE PAS. Il n'exige pas que toute la séance tienne
     * dans l'écran : la validation globale vit sous le rail, en flux normal,
     * et l'atteindre suppose de faire défiler la page. C'est voulu — la
     * mettre en `position:fixed` serait précisément le contournement qu'on
     * refuse.
     *
     * CE QU'IL EXIGE. Qu'aucun défileur vertical PARASITE n'apparaisse. Les
     * seuls tolérés sont les contenus de carte, et ils doivent être bornés :
     * une carte qui dépasserait l'écran ferait défiler la page à l'intérieur
     * de la page, ce qui était exactement le défaut du builder.
     */
    const defileurs = await page.evaluate((h) => (window as unknown as Record<string, Harnais>)[h].defileursVerticaux(), H);
    const parasites = defileurs.filter((d) => !d.estUneCarte);
    assert.deepEqual(
      parasites,
      [],
      `défileur vertical inattendu : ${JSON.stringify(parasites)}`,
    );
    const m = await mesurer(page);
    for (const defileur of defileurs) {
      assert.ok(
        defileur.hauteur <= m.hauteurFenetre * 0.8 + 2,
        `le contenu d'une carte défile sur ${defileur.hauteur}px pour un écran de ${m.hauteurFenetre}px — il doit rester borné`,
      );
    }
    /*
     * ET LE RAIL LUI-MÊME TIENT DANS L'ÉCRAN.
     * Sans cette borne, une carte au contenu très long ne créerait aucun
     * défileur — elle s'étirerait, le rail avec elle, et l'élève ferait
     * défiler la PAGE à l'intérieur d'une carte. C'est le défaut recherché,
     * et il ne se voit pas en comptant les défileurs : il se voit sur la
     * hauteur du rail.
     */
    assert.ok(
      m.hauteurRail <= m.hauteurFenetre,
      `le rail mesure ${m.hauteurRail}px pour un écran de ${m.hauteurFenetre}px — une carte doit rester dans le viewport`,
    );
    // Le rail défile horizontalement DANS lui-même ; la page, elle, ne doit
    // jamais partir de côté.
    const largeur = await page.evaluate((h) => (window as unknown as Record<string, Harnais>)[h].largeurDocument(), H);
    assert.ok(
      largeur.scrollWidth <= largeur.innerWidth + 1,
      `la page déborde horizontalement : ${largeur.scrollWidth}px pour ${largeur.innerWidth}px`,
    );
  });

  await test("CARR-10 — défiler d'une carte met l'indicateur à jour", async () => {
    const avant = await mesurer(page);
    assert.ok(contient(avant.indicateur, "Bloc 1 · MUSCULATION"), `lu : « ${avant.indicateur} »`);
    // « Carte n / N » est masqué sous `sm` : sur 390 px, l'indicateur tiendrait
    // sur deux lignes. Le bloc et la position dans le bloc, eux, restent
    // toujours lisibles — c'est ce qui dit à l'élève où il en est.
    assert.ok(contient(avant.indicateur, "1 / 3"), `position dans le bloc, lu : « ${avant.indicateur} »`);
    assert.ok(!contient(avant.indicateur, "Carte"), `« Carte n / N » doit être masqué sur téléphone, lu : « ${avant.indicateur} »`);
    await page.evaluate(
      ([h, x]) => (window as unknown as Record<string, Harnais>)[h as string].defilerVers(x as number),
      [H, avant.offsets[3]],
    );
    const apres = await mesurer(page);
    assert.ok(contient(apres.indicateur, "Bloc 2 · CARDIO"), `lu : « ${apres.indicateur} »`);
    assert.ok(contient(apres.indicateur, "1 / 2"), `position dans le bloc, lu : « ${apres.indicateur} »`);
    await page.evaluate(
      ([h, x]) => (window as unknown as Record<string, Harnais>)[h as string].defilerVers(x as number),
      [H, avant.offsets[4]],
    );
    const validation = await mesurer(page);
    assert.ok(contient(validation.indicateur, "Bloc 2 · VALIDATION"), `lu : « ${validation.indicateur} »`);
    assert.ok(contient(validation.indicateur, "2 / 2"), `lu : « ${validation.indicateur} »`);
    await page.evaluate(([h]) => (window as unknown as Record<string, Harnais>)[h as string].defilerVers(0), [H]);
  });

  await test("CARR-11 — les boutons ‹ › déplacent le rail sans soumettre le formulaire", async () => {
    const types = await page.evaluate((h) => (window as unknown as Record<string, Harnais>)[h].typesBoutonsRail(), H);
    assert.equal(types.length, 2, "deux boutons de navigation");
    assert.ok(
      types.every((t) => t === "button"),
      `type="button" obligatoire dans un <form>, lu : ${JSON.stringify(types)}`,
    );
    const espion = await page.evaluate((h) => (window as unknown as Record<string, Harnais>)[h].espionnerSoumission(), H);
    assert.equal(espion, true, "formulaire introuvable");
    const apres = await page.evaluate((h) => (window as unknown as Record<string, Harnais>)[h].cliquerRail("Carte suivante"), H);
    const m = await mesurer(page);
    assert.ok(apres !== null && apres > 0, `le rail doit avoir avancé, scrollLeft = ${apres}`);
    assert.ok(
      Math.abs((apres ?? 0) - m.offsets[1]) <= 3,
      `il doit s'arrêter sur la carte 2 (${m.offsets[1]}px), atteint ${apres}px`,
    );
    const soumissions = await page.evaluate((h) => (window as unknown as Record<string, Harnais>)[h].soumissions, H);
    assert.equal(soumissions, 0, "naviguer ne doit JAMAIS envoyer le retour");
    await page.evaluate(([h]) => (window as unknown as Record<string, Harnais>)[h as string].defilerVers(0), [H]);
  });

  await contexte.close();
}

console.log("\n── Mesuré dans Chromium (bureau 1440 × 900) ──");

{
  const { page, contexte } = await atelier({ width: 1440, height: 900 }, false);

  await test("CARR-12 — sur grand écran le rail RESTE horizontal, avec un aperçu de la carte suivante", async () => {
    const m = await mesurer(page);
    assert.match(m.snapType, /mandatory/);
    assert.equal(m.nbCartes, 7);
    for (const largeur of m.largeursCartes) {
      assert.ok(largeur < m.largeurRail - 40, `carte ${largeur}px / rail ${m.largeurRail}px — la suivante doit dépasser`);
      assert.ok(largeur > 320, `carte ${largeur}px : trop étroite pour être lisible`);
    }
  });

  await test("CARR-12 bis — sur grand écran, l'indicateur affiche AUSSI la position absolue", async () => {
    const m = await mesurer(page);
    assert.ok(contient(m.indicateur, "Carte 1 / 7"), `lu : « ${m.indicateur} »`);
    assert.ok(contient(m.indicateur, "Bloc 1 · MUSCULATION"), `lu : « ${m.indicateur} »`);
  });

  await test("CARR-13 — la validation globale reste hors du rail sur grand écran aussi", async () => {
    const m = await mesurer(page);
    assert.equal(m.submitPresent, true);
    assert.equal(m.submitDansRail, false);
  });

  await test("CARR-14 — les flèches du clavier ne volent PAS la saisie d'un champ", async () => {
    const m = await mesurer(page);
    await page.evaluate(([h]) => (window as unknown as Record<string, Harnais>)[h as string].defilerVers(0), [H]);
    // Curseur au milieu de « 3456 » dans le premier champ Charge, puis ←.
    const champ = page.locator('input[placeholder^="Charge"]').first();
    await champ.fill("3456");
    await champ.click();
    await page.keyboard.press("End");
    await page.keyboard.press("ArrowLeft");
    await page.keyboard.press("ArrowLeft");
    await page.waitForTimeout(200);
    const apres = await mesurer(page);
    assert.equal(apres.scrollLeft, 0, `le rail ne doit pas bouger pendant une saisie (scrollLeft=${apres.scrollLeft})`);
    assert.equal(await champ.inputValue(), "3456", "la valeur saisie est intacte");
    assert.ok(m.offsets.length === 7);
  });

  await contexte.close();
}

console.log("\n── Cas limite ──");

{
  const { page, contexte } = await atelier({ width: 390, height: 844 }, true, "solo");

  await test("CARR-17 — une carte trop haute défile DANS elle-même, sans étirer le rail", async () => {
    /*
     * Fixture volontairement extrême : douze séries sur un exercice, donc
     * une carte bien plus haute que l'écran. Sans borne, le rail s'étirerait
     * et l'élève ferait défiler la PAGE à l'intérieur d'une carte — ce que
     * le §8 refuse. Avec la borne, le contenu défile dans la carte et le
     * rail reste dans le viewport.
     */
    const { page: p, contexte: c } = await atelier({ width: 390, height: 844 }, true, "long");
    try {
      const m = await mesurer(p);
      assert.ok(
        m.hauteurRail <= m.hauteurFenetre,
        `rail de ${m.hauteurRail}px pour un écran de ${m.hauteurFenetre}px — la carte étire le rail`,
      );
      const defileurs = await p.evaluate((h) => (window as unknown as Record<string, Harnais>)[h].defileursVerticaux(), H);
      const dansCarte = defileurs.filter((d) => d.estUneCarte);
      assert.ok(dansCarte.length >= 1, "le contenu de la carte doit défiler dans la carte");
      assert.deepEqual(defileurs.filter((d) => !d.estUneCarte), [], "et nulle part ailleurs");
    } finally {
      await c.close();
    }
  });

  await test("CARR-15 — une séance d'un seul exercice : une carte, ‹ et › désactivés", async () => {
    const m = await mesurer(page);
    assert.equal(m.nbCartes, 1);
    assert.equal(m.submitPresent, true);
    assert.equal(m.submitDansRail, false);
    const precedent = await page.evaluate((h) => (window as unknown as Record<string, Harnais>)[h].cliquerRail("Carte précédente"), H);
    const suivant = await page.evaluate((h) => (window as unknown as Record<string, Harnais>)[h].cliquerRail("Carte suivante"), H);
    assert.equal(precedent, null, "‹ doit être désactivé");
    assert.equal(suivant, null, "› doit être désactivé");
  });

  await contexte.close();
}

/* ══════════════════════════════════════════════════════════════════════════
 * NIVEAU 3 — UN VRAI GLISSEMENT DU DOIGT
 * ══════════════════════════════════════════════════════════════════════════
 * `Input.dispatchTouchEvent` envoie de VRAIS événements tactiles au moteur,
 * pas des événements JavaScript synthétiques : c'est le compositeur de
 * Chromium qui fait défiler, décélère et rattrape. Si le résultat n'est pas
 * reproductible sans affichage, on le DIT — on ne le maquille pas en vert.
 * ══════════════════════════════════════════════════════════════════════════ */

console.log("\n── Le piège du double défilement (carte trop haute) ──");

{
  /*
   * LE DÉFAUT SIGNALÉ EN SALLE, REPRODUIT.
   *
   * Une carte plus haute que l'écran défile dans elle-même. Arrivé en bas,
   * l'élève veut continuer vers le bas de la PAGE — mais la carte occupe
   * toute la largeur, il n'a aucun autre endroit où poser le doigt. Si le
   * défilement ne passe pas la main à la page, il est coincé.
   *
   * `overscroll-behavior-y: contain` produit exactement ce blocage. Ces deux
   * tests le vérifient de deux façons : par la déclaration calculée, et par
   * un VRAI glissement du doigt.
   */
  const { page, contexte } = await atelier({ width: 390, height: 844 }, true, "long");
  const cdp = await contexte.newCDPSession(page);

  const etat = await page.evaluate((h) => (window as unknown as Record<string, Harnais>)[h].carteEnButee(), H);

  await test("CARR-18 — arrivé en bas d'une carte, le défilement PEUT passer à la page", () => {
    assert.equal(etat.enButee, true, "la fixture doit produire une carte réellement plus haute que l'écran");
    assert.equal(etat.pageDefilable, true, "et une page qui a du contenu sous le rail");
    assert.notEqual(
      etat.overscrollY,
      "contain",
      "`overscroll-behavior-y: contain` coupe le relais vers la page : c'est le blocage signalé",
    );
    assert.notEqual(etat.overscrollY, "none", "`none` bloquerait tout autant");
  });

  /*
   * LE RELAIS, MESURÉ À LA MOLETTE.
   *
   * Chromium applique `overscroll-behavior` aux événements de molette
   * exactement comme au doigt, et sans dépendre du compositeur tactile — ce
   * qui en fait la mesure FIABLE du chaînage, là où le glissement tactile
   * reste capricieux sans affichage. On pose le pointeur au milieu de la
   * carte déjà en butée, on tourne la molette vers le bas : si le relais
   * existe, la page descend.
   */
  await test("CARR-19 — en butée de carte, le défilement PASSE réellement à la page", async () => {
    const avant = await page.evaluate((h) => (window as unknown as Record<string, Harnais>)[h].scrollYPage(), H);
    await page.mouse.move(etat.centre.x, etat.centre.y);
    // Chromium « verrouille » une rafale de molette sur le premier défileur
    // touché : arrivé en butée, il faut une NOUVELLE rafale pour que
    // l'ancêtre prenne la main. On en envoie donc plusieurs, espacées — ce
    // qui est aussi ce que fait une main sur un trackpad.
    for (let rafale = 0; rafale < 4; rafale += 1) {
      await page.mouse.wheel(0, 300);
      await page.waitForTimeout(250);
    }
    await page.waitForTimeout(300);
    const apres = await page.evaluate((h) => (window as unknown as Record<string, Harnais>)[h].scrollYPage(), H);
    assert.ok(
      apres > avant,
      `la page doit prendre le relais : scrollY ${avant} → ${apres} (blocage si la valeur ne bouge pas)`,
    );
  });

  const toucher = async (type: "touchStart" | "touchMove" | "touchEnd", x: number, y: number) =>
    cdp.send("Input.dispatchTouchEvent", { type, touchPoints: type === "touchEnd" ? [] : [{ x, y, id: 1 }] });

  try {
    const { x, y } = etat.centre;
    const avant = etat.scrollYPage;
    // Un glissement VERS LE HAUT, doigt posé au milieu de la carte déjà en
    // butée : c'est le geste exact de l'élève qui veut descendre.
    await toucher("touchStart", x, y + 120);
    for (const dy of [20, 45, 75, 110, 150, 190]) {
      await toucher("touchMove", x, y + 120 - dy);
      await page.waitForTimeout(16);
    }
    await toucher("touchEnd", x, y + 120 - 190);
    await page.waitForTimeout(700);
    const apres = await page.evaluate((h) => (window as unknown as Record<string, Harnais>)[h].scrollYPage(), H);

    if (apres === avant) {
      remarques.push(
        "Relais carte → page AU DOIGT : le glissement tactile réel n'a pas fait descendre la page sous " +
          "Chromium sans affichage. Le relais lui-même EST prouvé (CARR-19, à la molette, qui obéit à la " +
          "même règle `overscroll-behavior`) ; c'est seulement la variante tactile qui n'est pas concluante ici.",
      );
      console.log("~  relais carte → page : non concluant sans affichage (voir remarques)");
    } else {
      await test("CARR-19 bis — et un vrai glissement du doigt le fait aussi", () => {
        assert.ok(apres > avant, `la page doit descendre : scrollY ${avant} → ${apres}`);
      });
    }
  } catch (erreur) {
    remarques.push(`Relais carte → page : glissement non envoyé (${erreur instanceof Error ? erreur.message : erreur}).`);
    console.log("~  relais carte → page : non envoyé (voir remarques)");
  }

  await contexte.close();
}

console.log("\n── Glissement tactile réel (CDP) ──");

{
  const { page, contexte } = await atelier({ width: 390, height: 844 }, true);
  const cdp = await contexte.newCDPSession(page);
  const m0 = await mesurer(page);

  const toucher = async (type: "touchStart" | "touchMove" | "touchEnd", x: number, y: number) =>
    cdp.send("Input.dispatchTouchEvent", {
      type,
      touchPoints: type === "touchEnd" ? [] : [{ x, y, id: 1 }],
    });

  try {
    const y = 300;
    await toucher("touchStart", 330, y);
    // Un vrai balayage : plusieurs points intermédiaires, pas un saut.
    for (const x of [300, 260, 210, 160, 110, 70, 40]) {
      await toucher("touchMove", x, y);
      await page.waitForTimeout(16);
    }
    await toucher("touchEnd", 40, y);
    await page.waitForTimeout(900);
    const apres = await mesurer(page);

    if (apres.scrollLeft === 0) {
      remarques.push(
        "Glissement tactile : le rail n'a pas bougé sous Chromium sans affichage — " +
          "le compositeur tactile n'est pas actif dans ce mode. NON PROUVÉ ICI, à vérifier sur téléphone.",
      );
      console.log("~  glissement tactile : non concluant sans affichage (voir remarques)");
    } else {
      await test("CARR-16 — un vrai glissement du doigt fait avancer le rail et le RATTRAPE sur une carte", async () => {
        assert.ok(apres.scrollLeft > 0, "le rail a suivi le doigt");
        const distances = m0.offsets.map((o) => Math.abs(o - apres.scrollLeft));
        const meilleure = Math.min(...distances);
        assert.ok(
          meilleure <= 3,
          `le rail doit s'immobiliser sur une carte : scrollLeft=${apres.scrollLeft}, offsets=${JSON.stringify(m0.offsets)}`,
        );
        assert.notEqual(
          distances.indexOf(meilleure),
          0,
          "le glissement doit avoir changé de carte, pas rebondir sur la première",
        );
      });
    }
  } catch (erreur) {
    remarques.push(
      `Glissement tactile : impossible à envoyer (${erreur instanceof Error ? erreur.message : erreur}). NON PROUVÉ ICI.`,
    );
    console.log("~  glissement tactile : non envoyé (voir remarques)");
  }

  await contexte.close();
}

await navigateur.close();
serveur.close();

if (remarques.length > 0) {
  console.log("\n── Remarques (non prouvé automatiquement) ──");
  for (const remarque of remarques) console.log(`   • ${remarque}`);
}

console.log("\n── À vérifier à la main sur un téléphone ──");
console.log("   • confort et fluidité du geste au pouce");
console.log("   • rendu des couleurs de bloc sur le bandeau de chaque carte");

console.log(`\n${réussis} test(s) réussi(s), ${échecs} échec(s).`);
if (échecs > 0) process.exit(1);
