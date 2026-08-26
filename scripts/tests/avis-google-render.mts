import assert from "node:assert/strict";
import { existsSync, mkdirSync, readFileSync, readdirSync } from "node:fs";
import { createServer, type Server } from "node:http";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import * as esbuild from "esbuild";
import type { Browser, Page } from "playwright-core";

/**
 * LA PILE D'AVIS — MESURÉE DANS UN VRAI NAVIGATEUR.
 *
 *   npx tsx scripts/tests/avis-google-render.mts
 *
 * ════════════════════════════════════════════════════════════════════════
 * POURQUOI CE SECOND HARNAIS
 * ════════════════════════════════════════════════════════════════════════
 * `avis-google.mts` prouve les RÈGLES : le filtre 5 étoiles, l'idempotence,
 * l'étanchéité des secrets, la présence du contenu dans le DOM. Il ne peut
 * rien dire de la DISPOSITION — un test qui chercherait « grid-area: 1 / 1 »
 * dans la feuille de style prouverait seulement que quelqu'un a tapé ces
 * lettres.
 *
 * Ici, on lit ce que le moteur de disposition A CALCULÉ, avec la vraie CSS du
 * projet compilée par Tailwind : la largeur réellement défilable du document,
 * les rectangles des cartes, l'ordre d'empilement effectif, et ce que devient
 * une transition sous `prefers-reduced-motion`.
 *
 * ⚠️ LES AVIS SONT DES FIXTURES, et le harnais ne mesure QUE de la géométrie.
 * Aucun texte d'avis réel n'entre ici.
 *
 * CE QUI RESTE À VÉRIFIER À L'ŒIL : l'élégance de la composition. Les captures
 * écrites dans `scripts/tests/avis-google-render/captures/` sont là pour ça.
 */

const ICI = dirname(fileURLToPath(import.meta.url));
const RACINE = resolve(ICI, "..", "..");
const ENTREE = join(ICI, "avis-google-render", "entree.tsx");
const CAPTURES = join(ICI, "avis-google-render", "captures");

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
 * ⚠️ LA FEUILLE DE STYLE EST INDISPENSABLE. Sans elle, `.avis-pile`,
 * `.avis-carte` et leurs points de rupture n'existent pas : toutes les mesures
 * seraient celles d'un document sans mise en page, et ce harnais serait vert
 * quoi qu'il arrive.
 */
const postcss = (await import("postcss")).default;
const tailwind = (await import("@tailwindcss/postcss")).default;
const css = (
  await postcss([tailwind({ base: RACINE })]).process(readFileSync(join(RACINE, "app/globals.css"), "utf8"), {
    from: join(RACINE, "app/globals.css"),
    to: join(RACINE, "app/globals.css"),
  })
).css;

/*
 * ⚠️ LE META VIEWPORT EST OBLIGATOIRE. Sans lui, l'émulation mobile de
 * Chromium utilise une fenêtre de mise en page de 980 px : une mesure prise à
 * « 390 px » ne voudrait rien dire.
 */
const PAGE = `<!doctype html><html lang="fr"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><title>harnais avis (Phase A)</title><style>${css}</style></head>
<body style="margin:0"><div id="racine"></div><script type="module" src="/paquet.js"></script></body></html>`;

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

async function atelier(
  taille: { width: number; height: number },
  options: { tactile?: boolean; mouvementReduit?: boolean } = {},
): Promise<Page> {
  const contexte = await navigateur.newContext({
    viewport: taille,
    hasTouch: options.tactile ?? false,
    isMobile: options.tactile ?? false,
    deviceScaleFactor: 1,
    reducedMotion: options.mouvementReduit ? "reduce" : "no-preference",
  });
  const page = await contexte.newPage();
  await page.goto(origine, { waitUntil: "networkidle" });
  await page.waitForSelector("[data-avis-pile] li", { timeout: 10_000 });
  return page;
}

/**
 * La géométrie de la pile — DEUX BOÎTES PAR AVIS, ET LA DISTINCTION COMPTE.
 *
 * ⚠️ ÉCRIT APRÈS DEUX FAUX ROUGES, ET LA LEÇON EST ICI. Une première rédaction
 * ne mesurait que le `<li>`. Or l'inclinaison, le décalage et l'agrandissement
 * vivent sur `.avis-carte`, l'élément INTÉRIEUR : le `<li>` est la cellule de
 * grille, et elle ne bouge pas d'un pixel quand la carte qu'elle contient
 * tourne ou grandit. Le harnais mesurait donc fidèlement une boîte sur
 * laquelle rien ne se passe.
 *
 *   • `hotes` — les `<li>`. Portent `z-index` (l'ordre d'empilement) et les
 *     marges négatives (l'écartement des voisines).
 *   • `cartes` — les `.avis-carte`. Portent la transformation, donc c'est là
 *     que se lisent le décalage, la rotation et l'agrandissement — et c'est là
 *     qu'un débordement se produirait réellement.
 */
async function geometrie(page: Page) {
  // ⚠️ AUCUNE FONCTION NOMMÉE DANS `page.evaluate`. tsx instrumente les
  // déclarations de fonctions avec un helper `__name` qui n'existe pas dans la
  // page : le calcul est donc écrit deux fois, en ligne, plutôt qu'extrait.
  return page.evaluate(() => {
    const hotes = [...document.querySelectorAll<HTMLElement>("[data-avis-pile] > li")];
    const cartes = [...document.querySelectorAll<HTMLElement>("[data-avis-pile] .avis-carte")];
    return {
      nb: hotes.length,
      // `rects` = les CARTES : c'est la boîte réellement peinte à l'écran.
      rects: cartes.map((e) => {
        const r = e.getBoundingClientRect();
        return { x: r.x, y: r.y, w: r.width, h: r.height, droite: r.right, bas: r.bottom };
      }),
      hotes: hotes.map((e) => {
        const r = e.getBoundingClientRect();
        return { x: r.x, y: r.y, w: r.width, h: r.height, droite: r.right, bas: r.bottom };
      }),
      plans: hotes.map((c) => getComputedStyle(c).zIndex),
      scrollWidth: document.documentElement.scrollWidth,
      innerWidth: window.innerWidth,
      largeurCorps: document.body.getBoundingClientRect().width,
    };
  });
}

mkdirSync(CAPTURES, { recursive: true });

/* ═══════════════ DÉBORDEMENT HORIZONTAL — LES TROIS LARGEURS ═══════════════ */

for (const [nom, taille] of [
  ["mobile 390 px", { width: 390, height: 844 }],
  ["tablette 768 px", { width: 768, height: 1024 }],
  ["desktop 1440 px", { width: 1440, height: 900 }],
] as const) {
  await test(`R1 — ${nom} : AUCUN débordement horizontal`, async () => {
    const page = await atelier(taille);
    const g = await geometrie(page);

    // La mesure qui compte vraiment : le document est-il plus large que la
    // fenêtre ? C'est exactement ce qui produit une barre de défilement.
    assert.ok(
      g.scrollWidth <= g.innerWidth + 1,
      `${nom} : document défilable sur ${g.scrollWidth} px pour une fenêtre de ${g.innerWidth} px`,
    );

    // Et aucune carte ne sort de la fenêtre, ni à gauche ni à droite.
    for (const [i, r] of g.rects.entries()) {
      assert.ok(r.x >= -1, `${nom} : la carte ${i + 1} sort à gauche (x = ${Math.round(r.x)})`);
      assert.ok(
        r.droite <= g.innerWidth + 1,
        `${nom} : la carte ${i + 1} sort à droite (${Math.round(r.droite)} > ${g.innerWidth})`,
      );
    }

    await page.screenshot({ path: join(CAPTURES, `repos-${taille.width}.png`), fullPage: true });
    await page.context().close();
  });
}

/* ═══════════════ LA COMPOSITION EST BIEN UNE PILE ═══════════════ */

await test("R2 — desktop : les cartes se RECOUVRENT, ce n'est pas une grille sage", async () => {
  const page = await atelier({ width: 1440, height: 900 });
  const g = await geometrie(page);
  // ⚠️ PAS DE COMPTE FIGÉ. Le harnais monte les vraies données de
  // démonstration : ajouter un avis au mock ne doit pas faire rougir un test
  // de géométrie.
  assert.ok(g.nb >= 6, `l'effet de pile demande plusieurs cartes — ${g.nb} rendues`);

  /*
   * ⚠️ CE TEST EXIGEAIT DES RECOUVREMENTS ENTRE VOISINES. IL N'EN EXIGE PLUS,
   * et c'est un changement de contrat assumé.
   *
   * Le recouvrement était produit par des marges négatives, et il a coûté
   * deux défauts réels : du texte, puis un en-tête, passés sous la carte
   * d'à côté. La consigne est désormais explicite — le désordre vient des
   * POSITIONS, les gouttières sont plus larges que l'étalement des décalages,
   * donc deux voisines ne peuvent plus se toucher.
   *
   * Ce qui reste à prouver, et qui est la vraie exigence : que la composition
   * ne soit PAS une grille sagement alignée.
   */
  const xs = g.rects.map((r) => Math.round(r.x));
  const ys = g.rects.map((r) => Math.round(r.y));

  // Aucune carte ne partage exactement la position d'une autre.
  const positions = new Set(g.rects.map((r) => `${Math.round(r.x)}|${Math.round(r.y)}`));
  assert.equal(positions.size, g.rects.length, "deux cartes occupent la même position");

  // Les cartes d'une même rangée ne sont pas alignées au pixel près : c'est
  // précisément ce qui distingue cette composition d'un tableau.
  const rangees = new Map<number, number[]>();
  for (const r of g.rects) {
    const cle = Math.round(r.y / 120);
    rangees.set(cle, [...(rangees.get(cle) ?? []), Math.round(r.y)]);
  }
  const rangeeDesalignee = [...rangees.values()].some((v) => v.length > 1 && new Set(v).size > 1);
  assert.ok(rangeeDesalignee, "au moins une rangée doit être désalignée verticalement");

  // Et les écarts horizontaux entre cartes voisines ne sont pas constants.
  const ecarts = xs.slice(1).map((v, i) => v - xs[i]).filter((e) => e > 0);
  assert.ok(
    new Set(ecarts).size > 1,
    `les espacements horizontaux doivent être irréguliers — ${[...new Set(ecarts)].join(", ")}`,
  );

  assert.ok(new Set(ys).size >= 2, "les cartes doivent être décalées verticalement");
  await page.context().close();
});

await test("R3 — mobile : un AMAS COMPACT, pas une colonne interminable", async () => {
  /*
   * ⚠️ CE TEST EXIGEAIT UNE COLONNE DE CARTES PLEINE LARGEUR. IL EXIGE
   * MAINTENANT L'INVERSE, et le renversement est demandé.
   *
   * Neuf cartes pleine largeur mesuraient plus de trois écrans : la secousse
   * de groupe y était invisible, on ne voyait bouger que la carte touchée et
   * sa voisine. Or c'est tout l'intérêt du geste. Les cartes sont donc
   * réduites et rangées sur deux colonnes.
   *
   * L'invariant mesuré : l'ensemble tient dans une hauteur qui permet de VOIR
   * le groupe réagir, sans jamais déborder latéralement.
   */
  const page = await atelier({ width: 390, height: 844 }, { tactile: true });
  const g = await geometrie(page);

  // ── DEUX COLONNES : des cartes partagent une même ligne.
  const parLigne = new Map<number, number>();
  for (const r of g.rects) {
    const ligne = Math.round(r.y / 60);
    parLigne.set(ligne, (parLigne.get(ligne) ?? 0) + 1);
  }
  const lignesDoubles = [...parLigne.values()].filter((n) => n >= 2).length;
  assert.ok(
    lignesDoubles >= 3,
    `au moins trois lignes doivent porter deux cartes — ${lignesDoubles}`,
  );

  // ── DES CARTES PETITES : c'est ce qui rend l'amas visible d'un coup d'œil.
  for (const [i, r] of g.rects.entries()) {
    assert.ok(
      r.w < 200,
      `mobile : la carte ${i + 1} fait ${Math.round(r.w)} px — trop large pour un amas`,
    );
    assert.ok(r.w > 120, `mobile : la carte ${i + 1} est illisible (${Math.round(r.w)} px)`);
  }

  // ── UN AMAS COMPACT : la hauteur totale de la pile reste de l'ordre d'un
  // écran, sans quoi le mouvement du groupe ne se lit pas.
  const hauteur = await page.evaluate(() => {
    const p = document.querySelector<HTMLElement>("[data-avis-pile]");
    return p?.offsetHeight ?? 0;
  });
  /*
   * ⚠️ LE SEUIL EST EXPRIMÉ EN HAUTEURS D'ÉCRAN, PAS EN PIXELS RONDS.
   *
   * La propriété qui compte n'est pas « moins de mille pixels », c'est « on
   * voit assez de l'ensemble pour que sa réaction se lise ». Un plafond en
   * pixels absolus n'aurait aucun sens sur un écran plus haut, et
   * m'inviterait surtout à rogner le contenu jusqu'à tomber sous le chiffre.
   * L'ancienne colonne pleine largeur dépassait TROIS écrans ; une pile et
   * quart reste largement lisible d'un coup d'œil.
   */
  assert.ok(
    hauteur <= 844 * 1.3,
    `la pile mobile doit rester compacte — ${Math.round(hauteur)} px pour un écran de 844 px`,
  );

  // ── ET AUCUN DÉBORDEMENT LATÉRAL malgré les décalages.
  assert.ok(g.scrollWidth <= g.innerWidth + 1, "aucun débordement horizontal");

  await page.screenshot({ path: join(CAPTURES, "mobile-pile.png"), fullPage: true });
  await page.context().close();
});

/* ═══════════════ LA MISE EN AVANT ═══════════════ */

await test("R4 — au survol, la carte passe DEVANT et grandit", async () => {
  const page = await atelier({ width: 1440, height: 900 });
  const avant = await geometrie(page);

  // On survole la troisième carte — celle du milieu, la plus recouverte.
  await page.hover("[data-avis-pile] > li:nth-child(3) .avis-carte");
  await page.waitForTimeout(320); // la transition dure 200 ms

  const apres = await geometrie(page);
  const planAvant = Number(avant.plans[2]);
  const planApres = Number(apres.plans[2]);
  assert.ok(
    planApres > planAvant,
    `la carte survolée doit passer devant (${planAvant} → ${planApres})`,
  );
  assert.ok(
    Number(apres.plans[2]) > Number(apres.plans[0]) && Number(apres.plans[2]) > Number(apres.plans[4]),
    "elle doit passer devant TOUTES les autres, pas seulement sa voisine",
  );

  // Elle grandit — mesure réelle, pas lecture de la feuille de style.
  assert.ok(
    apres.rects[2].w > avant.rects[2].w + 2,
    `la carte survolée doit grandir (${Math.round(avant.rects[2].w)} → ${Math.round(apres.rects[2].w)})`,
  );

  // ⚠️ ET ELLE RESTE DANS LA FENÊTRE. C'est la contrainte explicite : une
  // carte qui grandit ne doit pas sortir de l'écran.
  assert.ok(apres.rects[2].x >= -1, "la carte agrandie ne sort pas à gauche");
  assert.ok(
    apres.rects[2].droite <= apres.innerWidth + 1,
    `la carte agrandie sort à droite (${Math.round(apres.rects[2].droite)} > ${apres.innerWidth})`,
  );
  assert.ok(
    apres.scrollWidth <= apres.innerWidth + 1,
    "et le survol ne crée aucun défilement horizontal",
  );

  await page.screenshot({ path: join(CAPTURES, "survol-1440.png"), fullPage: true });
  await page.context().close();
});

await test("R5 — les voisines LAISSENT DE LA PLACE à la carte mise en avant", async () => {
  const page = await atelier({ width: 1440, height: 900 });
  const avant = await geometrie(page);
  await page.hover("[data-avis-pile] > li:nth-child(3) .avis-carte");
  await page.waitForTimeout(320);
  const apres = await geometrie(page);

  /*
   * ⚠️ CE TEST EXIGEAIT QUE LA VOISINE S'ÉCARTE. IL EXIGE MAINTENANT
   * L'INVERSE, et le renversement est délibéré.
   *
   * L'écartement venait d'une marge négative annulée au survol. Or déplier un
   * avis de huit cents caractères fait grandir la carte : si ses voisines
   * bougeaient en même temps, toute la composition sauterait sous le curseur,
   * et viser une carte deviendrait un jeu d'adresse. Les hôtes ont donc une
   * hauteur fixe et les cartes sont en position absolue — la carte mise en
   * avant grandit PAR-DESSUS, sans déplacer personne.
   *
   * L'invariant mesuré : les voisines ne bougent pas d'un pixel.
   */
  for (const i of [0, 1, 3, 4]) {
    if (!avant.hotes[i] || !apres.hotes[i]) continue;
    assert.ok(
      Math.abs(apres.hotes[i].x - avant.hotes[i].x) < 1.5,
      `la carte ${i + 1} a bougé horizontalement de ${Math.round(apres.hotes[i].x - avant.hotes[i].x)} px`,
    );
    assert.ok(
      Math.abs(apres.hotes[i].y - avant.hotes[i].y) < 1.5,
      `la carte ${i + 1} a bougé verticalement de ${Math.round(apres.hotes[i].y - avant.hotes[i].y)} px`,
    );
  }

  // Et la carte visée, elle, a bien grandi.
  assert.ok(
    apres.rects[2].w > avant.rects[2].w + 1,
    `la carte mise en avant doit s'élargir — ${Math.round(avant.rects[2].w)} → ${Math.round(apres.rects[2].w)} px`,
  );
  assert.ok(
    apres.rects[2].h > avant.rects[2].h + 1,
    "et grandir en hauteur, puisqu'elle dévoile l'avis entier",
  );
  await page.context().close();
});

await test("R6 — le focus clavier produit EXACTEMENT la même mise en avant", async () => {
  const page = await atelier({ width: 1440, height: 900 });
  const avant = await geometrie(page);

  // On tabule jusqu'à la troisième carte.
  await page.keyboard.press("Tab");
  await page.keyboard.press("Tab");
  await page.keyboard.press("Tab");
  await page.waitForTimeout(320);

  const apres = await geometrie(page);
  const focalise = await page.evaluate(() => {
    const actif = document.activeElement;
    const cartes = [...document.querySelectorAll("[data-avis-pile] .avis-carte")];
    return cartes.indexOf(actif as Element);
  });
  assert.ok(focalise >= 0, "le focus doit atteindre une carte");
  assert.ok(
    Number(apres.plans[focalise]) > Number(avant.plans[focalise]),
    "la carte focalisée passe devant, comme au survol",
  );

  // Le contour de focus est réellement peint.
  const contour = await page.evaluate(() => {
    const actif = document.activeElement as HTMLElement | null;
    if (!actif) return null;
    const s = getComputedStyle(actif);
    return { style: s.outlineStyle, largeur: s.outlineWidth };
  });
  assert.ok(contour, "une carte est focalisée");
  assert.notEqual(contour.style, "none", "le focus doit être VISIBLE");
  await page.screenshot({ path: join(CAPTURES, "focus-clavier.png"), fullPage: true });
  await page.context().close();
});

await test("R5 bis — le recouvrement NE MANGE PAS le texte des cartes en retrait", async () => {
  /*
   * ⚠️ CE TEST EXISTE PARCE QU'UNE CAPTURE A MONTRÉ CE QU'AUCUNE MESURE NE
   * VOYAIT. Le recouvrement valait 43 px, le rembourrage gauche 26 : la carte
   * de devant couvrait donc 17 px de texte, et chaque avis en retrait perdait
   * sa première lettre. Aucune carte ne débordait de rien — elles étaient
   * simplement recouvertes, et tous les tests étaient verts.
   *
   * L'invariant mesuré ici : le texte d'une carte commence APRÈS le bord droit
   * de la carte qui la précède.
   */
  const page = await atelier({ width: 1440, height: 900 });
  const zones = await page.evaluate(() => {
    const hotes = [...document.querySelectorAll<HTMLElement>("[data-avis-pile] > li")];
    return hotes.map((h) => {
      const carte = h.querySelector<HTMLElement>(".avis-carte");
      const r = (carte ?? h).getBoundingClientRect();
      const pad = carte ? parseFloat(getComputedStyle(carte).paddingLeft) : 0;
      return { gaucheCarte: r.x, droiteCarte: r.right, haut: r.y, debutTexte: r.x + pad };
    });
  });

  /*
   * ⚠️ ON NE COMPARE QUE DES CARTES DE LA MÊME RANGÉE. La grille enjambe : la
   * première carte d'une nouvelle rangée est à GAUCHE de la dernière de la
   * rangée précédente, et les comparer linéairement produisait un faux rouge
   * spectaculaire (« la carte 5 recouvre 1183 px du texte de la carte 6 »).
   * Deux cartes sont sur la même rangée si leurs hauts coïncident au pixel
   * près — leur décalage vertical au repos est identique par construction.
   */
  let paires = 0;
  for (let i = 1; i < zones.length; i += 1) {
    const memeRangee = Math.abs(zones[i].haut - zones[i - 1].haut) < 40;
    if (!memeRangee) continue;
    paires += 1;
    const marge = zones[i].debutTexte - zones[i - 1].droiteCarte;
    assert.ok(
      marge >= -1,
      `la carte ${i} recouvre ${Math.round(-marge)} px du TEXTE de la carte ${i + 1}`,
    );
  }
  assert.ok(paires >= 3, `au moins trois paires voisines à vérifier — ${paires} trouvées`);
  await page.context().close();
});

await test("R5 quater — le recouvrement VERTICAL ne mange pas l'en-tête des cartes du dessous", async () => {
  /*
   * ⚠️ AJOUTÉ APRÈS UNE CAPTURE À 768 PX. La compensation du recouvrement
   * existait à gauche mais pas en haut : les cartes de la deuxième rangée
   * remontaient sous celles de la première, et leur avatar comme leur nom
   * passaient dessous. Rien ne débordait de rien — aucun test de géométrie ne
   * pouvait le voir.
   *
   * L'invariant mesuré : l'en-tête d'une carte commence SOUS le bas de la
   * carte qui la surplombe.
   */
  for (const taille of [
    { width: 768, height: 1024 },
    { width: 1440, height: 900 },
  ]) {
    const page = await atelier(taille);
    const zones = await page.evaluate(() => {
      const hotes = [...document.querySelectorAll<HTMLElement>("[data-avis-pile] > li")];
      return hotes.map((h) => {
        const carte = h.querySelector<HTMLElement>(".avis-carte");
        // L'EN-TÊTE : l'avatar et le nom. C'est lui qui ne doit jamais être
        // recouvert — pas la boîte de la carte, dont le rembourrage et la
        // rotation débordent légitimement au-delà du texte.
        const entete = h.querySelector<HTMLElement>(".avis-carte > div");
        const rc = (carte ?? h).getBoundingClientRect();
        const re = (entete ?? carte ?? h).getBoundingClientRect();
        return {
          carte: { gauche: rc.x, droite: rc.right, haut: rc.y, bas: rc.bottom },
          entete: { gauche: re.x, droite: re.right, haut: re.y, bas: re.bottom },
        };
      });
    });

    /*
     * ⚠️ ON TESTE L'INTERSECTION AVEC L'EN-TÊTE, PAS AVEC LA CARTE.
     *
     * Une première rédaction comparait les boîtes des CARTES : elle rougissait
     * sur un liseré de 15 px au bord droit d'une carte — c'est-à-dire à
     * l'intérieur de son rembourrage, là où aucun texte n'est écrit. Ce n'était
     * pas un défaut, c'était une mesure au mauvais endroit.
     *
     * La propriété réelle : la boîte d'une carte du dessus ne doit recouvrir
     * aucun pixel de l'avatar ni du nom d'une carte du dessous.
     */
    let paires = 0;
    for (let i = 0; i < zones.length; i += 1) {
      for (let j = 0; j < zones.length; j += 1) {
        if (i === j) continue;
        const dessus = zones[i].carte;
        const entete = zones[j].entete;
        if (zones[j].carte.haut <= zones[i].carte.haut + 40) continue;

        const recouvrementX =
          Math.min(dessus.droite, entete.droite) - Math.max(dessus.gauche, entete.gauche);
        const recouvrementY = Math.min(dessus.bas, entete.bas) - Math.max(dessus.haut, entete.haut);
        /*
         * ⚠️ LE SEUIL EST LA LARGEUR D'UN CARACTÈRE, ET C'EST DÉLIBÉRÉ.
         *
         * `getBoundingClientRect` d'un élément dans une carte TOURNÉE rend la
         * boîte englobante de la rotation, plus large que ce qui est peint.
         * Aux jonctions de colonnes, ça produit des liserés de 1 à 2 px qui ne
         * recouvrent aucun pixel de texte — mesuré à 768 px.
         *
         * On ne teste donc pas le contact géométrique, on teste ce qui compte :
         * qu'aucun CARACTÈRE ne soit caché. À cette taille de police, une
         * lettre fait environ 7 px ; en dessous de 4 px de large, rien de
         * lisible ne peut être recouvert.
         */
        if (recouvrementX < 4) continue;
        paires += 1;
        assert.ok(
          recouvrementY <= 1,
          `${taille.width} px : la carte ${i + 1} recouvre ${Math.round(recouvrementY)} px de l'EN-TÊTE de la carte ${j + 1} sur ${Math.round(recouvrementX)} px de large`,
        );
      }
    }
    assert.ok(paires >= 1, `${taille.width} px : au moins une paire superposée à vérifier`);
    await page.context().close();
  }
});

await test("R5 ter — les cartes courtes ne s'étirent pas jusqu'à la plus haute", async () => {
  /*
   * Même arbitrage que sur le carrousel de séance : un léger décrochage entre
   * voisines vaut mieux qu'un grand vide sous un avis de deux lignes. Les
   * fixtures ont des longueurs volontairement très différentes ; si toutes les
   * cartes sortaient à la même hauteur, c'est que `height: 100%` ou
   * `align-items: stretch` serait revenu.
   */
  const page = await atelier({ width: 1440, height: 900 });
  const g = await geometrie(page);
  const hauteurs = g.rects.map((r) => Math.round(r.h));

  /*
   * ⚠️ LE SEUIL EST TOMBÉ DE TROIS HAUTEURS DISTINCTES À DEUX, et il faut
   * savoir pourquoi plutôt que de le croire assoupli par confort.
   *
   * Au repos, l'avis n'occupe plus qu'UNE ligne écrêtée. Toutes les cartes
   * ont donc la même charpente — en-tête, étoiles, une ligne, mention — et
   * ne diffèrent plus que par le nombre de lignes du NOM. Deux hauteurs
   * distinctes (les huit cartes ordinaires, et celle de Vincent dont le nom
   * passe à la ligne) sont exactement ce que produit une composition qui ne
   * s'étire pas. En exiger trois reviendrait à exiger des avis de longueurs
   * différentes, ce qui ne dépend plus de la mise en page.
   *
   * La vraie garde contre l'étirement est plus bas, dans la feuille de style.
   */
  assert.ok(
    new Set(hauteurs).size >= 2,
    `les cartes doivent prendre leur hauteur naturelle — hauteurs mesurées : ${hauteurs.join(", ")}`,
  );

  /*
   * ⚠️ PAS DE SEUIL EN PIXELS SUR L'ÉCART. Une première version exigeait plus
   * de 80 px entre la plus courte et la plus haute : ce chiffre était calé sur
   * une ancienne fixture dont un texte était démesurément long, et il rougissait
   * sur des avis de longueurs réalistes alors que rien ne s'étirait. On vérifie
   * donc la CAUSE dans la feuille de style, pas une conséquence arbitraire.
   */
  const etirement = await page.evaluate(() => {
    const pile = document.querySelector<HTMLElement>("[data-avis-pile]");
    const carte = document.querySelector<HTMLElement>("[data-avis-pile] .avis-carte");
    if (!pile || !carte) return null;
    return { alignItems: getComputedStyle(pile).alignItems, hauteurCarte: getComputedStyle(carte).height };
  });
  assert.ok(etirement, "la pile et une carte doivent exister");
  assert.notEqual(etirement.alignItems, "stretch", "la grille ne doit pas étirer ses cartes");
  await page.context().close();
});

/* ═══════════════ TOUT EST LISIBLE SANS INTERACTION ═══════════════ */

await test("R7 — aucune carte n'est transparente ni masquée au repos", async () => {
  const page = await atelier({ width: 1440, height: 900 });
  const etats = await page.evaluate(() =>
    [...document.querySelectorAll<HTMLElement>("[data-avis-pile] .avis-carte")].map((c) => {
      const s = getComputedStyle(c);
      return {
        opacite: Number(s.opacity),
        visibilite: s.visibility,
        affichage: s.display,
        texte: (c.textContent ?? "").trim().length,
      };
    }),
  );
  for (const [i, e] of etats.entries()) {
    assert.equal(e.opacite, 1, `la carte ${i + 1} est à ${e.opacite} d'opacité`);
    assert.equal(e.visibilite, "visible", `la carte ${i + 1} est ${e.visibilite}`);
    assert.notEqual(e.affichage, "none", `la carte ${i + 1} est retirée du flux`);
    assert.ok(e.texte > 20, `la carte ${i + 1} ne porte que ${e.texte} caractères`);
  }
  await page.context().close();
});

await test("R8 — écrêté au repos, ENTIER au survol — et jamais coupé sans recours", async () => {
  /*
   * ⚠️ CE TEST INTERDISAIT TOUT ÉCRÊTAGE. LE CONTRAT A CHANGÉ : au repos, la
   * carte ne montre que les premières lignes ; le texte complet apparaît au
   * survol. Ce qui serait inacceptable, et que ce test verrouille désormais,
   * c'est un texte coupé SANS MOYEN DE LE LIRE.
   *
   * Trois choses sont donc mesurées : l'écrêtage existe au repos, le texte
   * intégral est dans le DOM malgré lui, et le survol le rend entièrement
   * visible.
   */
  const page = await atelier({ width: 1440, height: 900 });

  const repos = await page.evaluate(() =>
    [...document.querySelectorAll<HTMLElement>("[data-avis-pile] .avis-texte")].map((p, i) => ({
      i,
      coupe: p.scrollHeight > p.clientHeight + 1,
      lignes: getComputedStyle(p).webkitLineClamp,
      // ⚠️ LE TEXTE COMPLET EST DANS LE DOM MÊME ÉCRÊTÉ : c'est ce qui
      // distingue une mise en page d'un masquage.
      caracteres: (p.textContent ?? "").length,
    })),
  );

  const ecretees = repos.filter((r) => r.coupe);
  assert.ok(
    ecretees.length >= 3,
    `l'écrêtage au repos doit être visible sur plusieurs cartes — ${ecretees.length}`,
  );
  for (const r of repos) {
    assert.notEqual(r.lignes, "none", `la carte ${r.i + 1} ne porte aucun écrêtage au repos`);
    assert.ok(r.caracteres > 0, `le texte de la carte ${r.i + 1} doit rester dans le DOM`);
  }

  // ── LE SURVOL REND L'AVIS ENTIER.
  const cible = ecretees[0].i + 1;
  const avantSurvol = repos[ecretees[0].i].caracteres;
  await page.hover(`[data-avis-pile] > li:nth-child(${cible}) .avis-carte`);
  await page.waitForTimeout(320);
  const survole = await page.evaluate((n: number) => {
    const p = document.querySelector<HTMLElement>(
      `[data-avis-pile] > li:nth-child(${n}) .avis-texte`,
    );
    if (!p) return null;
    return {
      coupe: p.scrollHeight > p.clientHeight + 1,
      lignes: getComputedStyle(p).webkitLineClamp,
      caracteres: (p.textContent ?? "").length,
    };
  }, cible);

  assert.ok(survole, "la carte survolée doit être trouvée");
  assert.ok(!survole.coupe, `le texte de la carte ${cible} reste tronqué au survol`);
  assert.equal(survole.lignes, "none", "l'écrêtage doit être levé au survol");
  assert.equal(
    survole.caracteres,
    avantSurvol,
    "le survol ne doit RIEN ajouter au texte — il le dévoile, il ne le complète pas",
  );
  await page.context().close();
});

await test("R8 bis — le NOM DE L'AUTEUR n'est jamais coupé", async () => {
  /*
   * ⚠️ AJOUTÉ APRÈS UNE CAPTURE. Un `truncate` sur le nom produisait
   * « FIXTURE QUAT… » dès que le rembourrage de recouvrement resserrait la
   * colonne. Un nom à moitié affiché n'attribue plus l'avis à personne, et
   * l'attribution est une exigence de Google autant qu'une question
   * d'honnêteté.
   */
  const page = await atelier({ width: 1440, height: 900 });
  const noms = await page.evaluate(() =>
    [...document.querySelectorAll<HTMLElement>("[data-avis-pile] .avis-carte > div > span > span:first-child")].map(
      (n) => ({
        texte: (n.textContent ?? "").trim(),
        coupe: n.scrollWidth > n.clientWidth + 1,
        ellipsis: getComputedStyle(n).textOverflow,
      }),
    ),
  );
  assert.ok(noms.length >= 5, `les cinq noms doivent être trouvés — ${noms.length} trouvés`);
  for (const n of noms) {
    assert.ok(!n.coupe, `le nom « ${n.texte} » est coupé`);
    assert.notEqual(n.ellipsis, "ellipsis", `le nom « ${n.texte} » porte une ellipse`);
  }
  await page.context().close();
});

/* ═══════════════ MOUVEMENT RÉDUIT ═══════════════ */

await test("R9 — sous prefers-reduced-motion : plus aucune transition, ni transformation", async () => {
  const page = await atelier({ width: 1440, height: 900 }, { mouvementReduit: true });
  const styles = await page.evaluate(() =>
    [...document.querySelectorAll<HTMLElement>("[data-avis-pile] .avis-carte")].map((c) => {
      const s = getComputedStyle(c);
      return { transition: s.transitionProperty, duree: s.transitionDuration, transform: s.transform };
    }),
  );
  for (const [i, s] of styles.entries()) {
    assert.ok(
      s.transition === "none" || s.duree === "0s",
      `la carte ${i + 1} anime encore (${s.transition} / ${s.duree})`,
    );
    assert.equal(s.transform, "none", `la carte ${i + 1} est encore transformée (${s.transform})`);
  }

  // ⚠️ ET LE CONTENU RESTE ENTIÈREMENT LISIBLE. Couper le mouvement ne doit
  // rien cacher — sinon on aurait échangé une animation contre une régression
  // d'accessibilité.
  const opacites = await page.evaluate(() =>
    [...document.querySelectorAll<HTMLElement>("[data-avis-pile] .avis-carte")].map((c) =>
      Number(getComputedStyle(c).opacity),
    ),
  );
  assert.ok(opacites.length >= 6, `plusieurs cartes attendues — ${opacites.length}`);
  assert.deepEqual(
    [...new Set(opacites)],
    [1],
    `toutes les cartes restent pleinement visibles — opacités : ${opacites.join(", ")}`,
  );

  const g = await geometrie(page);
  assert.ok(g.scrollWidth <= g.innerWidth + 1, "et toujours aucun débordement horizontal");
  await page.screenshot({ path: join(CAPTURES, "mouvement-reduit.png"), fullPage: true });
  await page.context().close();
});

/* ═══════════════ TACTILE ═══════════════ */

await test("R10 — tactile : le tap met la carte en avant", async () => {
  const page = await atelier({ width: 390, height: 844 }, { tactile: true });
  const avant = await geometrie(page);
  await page.tap("[data-avis-pile] > li:nth-child(2) .avis-carte");
  await page.waitForTimeout(320);
  const apres = await geometrie(page);

  assert.ok(
    Number(apres.plans[1]) > Number(avant.plans[1]),
    "le tap doit mettre la carte en avant",
  );
  assert.ok(apres.scrollWidth <= apres.innerWidth + 1, "et ne crée aucun débordement");

  // Un tap sur une AUTRE carte change la mise en avant : le comportement
  // demandé pour le tactile, où le survol n'existe pas.
  await page.tap("[data-avis-pile] > li:nth-child(4) .avis-carte");
  await page.waitForTimeout(320);
  const ensuite = await geometrie(page);
  assert.ok(
    Number(ensuite.plans[3]) > Number(ensuite.plans[1]),
    "la nouvelle carte tapée passe devant la précédente",
  );
  await page.context().close();
});

await test("R11 — AUCUN avis de moins de 5 étoiles n'atteint le rendu réel", async () => {
  /*
   * ⚠️ LE HARNAIS MONTE LES VRAIES DONNÉES DE DÉMONSTRATION, passées par le
   * VRAI filtre. Le jeu contient un 4 étoiles, un 3 étoiles et un 5 étoiles
   * sans texte, tous nommés « Ne doit pas s'afficher ». Si le filtre cassait,
   * leur texte apparaîtrait dans le DOM du navigateur — et ce test le verrait.
   */
  const page = await atelier({ width: 1440, height: 900 });
  const contenu = await page.evaluate(() => ({
    texte: document.body.innerText,
    cartes: document.querySelectorAll("[data-avis-pile] > li").length,
    etoilesParCarte: [...document.querySelectorAll("[data-avis-pile] > li")].map(
      (c) => c.querySelectorAll(".avis-etoile").length,
    ),
  }));

  assert.ok(!contenu.texte.includes("Ne doit pas s"), "aucun avis piège n'est rendu");
  assert.ok(!contenu.texte.includes("QUATRE étoiles"), "le 4 étoiles est absent");
  assert.ok(!contenu.texte.includes("TROIS étoiles"), "le 3 étoiles est absent");

  // Chaque carte rendue porte exactement cinq étoiles.
  for (const [i, n] of contenu.etoilesParCarte.entries()) {
    assert.equal(n, 5, `la carte ${i + 1} affiche ${n} étoiles au lieu de 5`);
  }
  assert.ok(contenu.cartes >= 6, `l'effet de pile demande plusieurs cartes — ${contenu.cartes}`);
  await page.context().close();
});

await test("R12 — AUCUN texte de provenance n'est peint à l'écran", async () => {
  /*
   * ⚠️ CE TEST VÉRIFIAIT QUE LE BANDEAU ÉTAIT BIEN VISIBLE. Il vérifie
   * maintenant qu'il n'y a PLUS RIEN — retrait demandé explicitement.
   *
   * La mesure porte sur le TEXTE PEINT, pas sur le source : un libellé
   * réintroduit ailleurs dans la page — en petit, en bas, dans une autre
   * couleur — serait attrapé ici alors qu'une recherche dans le fichier de la
   * section le manquerait.
   */
  const page = await atelier({ width: 1440, height: 900 });
  const vu = await page.evaluate(() => ({
    bandeau: document.querySelector("[data-avis-demonstration]") !== null,
    texte: document.body.innerText,
  }));

  assert.equal(vu.bandeau, false, "plus aucun élément de bandeau dans le DOM");
  for (const motif of [
    /recopiés? manuellement/i,
    /non synchronis/i,
    /données de démonstration/i,
    /pas de vrais avis/i,
  ]) {
    assert.ok(!motif.test(vu.texte), `un texte de provenance est peint : ${motif}`);
  }

  // Et les avis, eux, sont toujours là — le retrait n'a rien emporté d'autre.
  assert.ok(vu.texte.includes("NAÏLA NACH") || vu.texte.includes("Naïla Nach"), "les avis sont rendus");
  await page.context().close();
});

/* ═══════ R13-R15. HORIZONTALITÉ ET RÉACTION DE GROUPE ═══════ */

await test("R13 — AUCUNE carte n'est tournée : mesuré dans la matrice calculée", async () => {
  /*
   * ⚠️ ON NE LIT PAS LE CSS, ON LIT CE QUE LE NAVIGATEUR APPLIQUE.
   *
   * Une inclinaison pourrait revenir par une variable, un héritage, une
   * classe utilitaire. La seule preuve qui vaut est la matrice calculée :
   * `matrix(a, b, c, d, e, f)`. Une transformation sans rotation ni
   * cisaillement a b = c = 0. Toute inclinaison, quelle qu'en soit l'origine,
   * fait sortir b et c de zéro.
   */
  const page = await atelier({ width: 1440, height: 900 });

  const matrices = await page.evaluate(() =>
    [...document.querySelectorAll<HTMLElement>("[data-avis-pile] .avis-carte")].map((e, i) => ({
      i,
      transform: getComputedStyle(e).transform,
    })),
  );

  const sansRotation = (transform: string, ou: string) => {
    if (transform === "none") return;
    const valeurs = /matrix\(([^)]+)\)/.exec(transform);
    assert.ok(valeurs, `${ou} : transformation illisible (${transform})`);
    const [, b, c] = valeurs[1].split(",").map((v) => Number(v.trim()));
    assert.ok(Math.abs(b) < 1e-6, `${ou} : la carte est tournée (b = ${b})`);
    assert.ok(Math.abs(c) < 1e-6, `${ou} : la carte est cisaillée (c = ${c})`);
  };

  for (const m of matrices) sansRotation(m.transform, `repos, carte ${m.i + 1}`);
  assert.ok(matrices.length >= 6, `toutes les cartes doivent être mesurées — ${matrices.length}`);

  // ── ET AU SURVOL, où l'ancienne version remettait explicitement `rotate(0)`.
  await page.hover("[data-avis-pile] > li:nth-child(2) .avis-carte");
  await page.waitForTimeout(320);
  const auSurvol = await page.evaluate(() =>
    [...document.querySelectorAll<HTMLElement>("[data-avis-pile] .avis-carte")].map((e, i) => ({
      i,
      transform: getComputedStyle(e).transform,
    })),
  );
  for (const m of auSurvol) sansRotation(m.transform, `survol, carte ${m.i + 1}`);

  await page.screenshot({ path: join(CAPTURES, "survol-texte-complet.png"), fullPage: true });
  await page.context().close();
});

await test("R14 — tactile : le GROUPE réagit, et c'est le conteneur qui bouge", async () => {
  /*
   * ⚠️ LA DIFFÉRENCE MESURÉE ICI EST TOUTE LA DEMANDE.
   *
   * « Le groupe réagit » et « chaque carte réagit » produisent deux
   * impressions opposées : une pile qu'on effleure, ou neuf objets qui
   * sursautent chacun dans leur coin. Le test vérifie donc DEUX choses à la
   * fois — que le conteneur bouge, ET que les cartes, elles, ne bougent pas
   * d'elles-mêmes.
   */
  const page = await atelier({ width: 390, height: 844 }, { tactile: true });

  const lire = () =>
    page.evaluate(() => {
      const pile = document.querySelector<HTMLElement>("[data-avis-pile]");
      return {
        groupe: pile ? getComputedStyle(pile).transform : "absent",
        secousse: pile?.dataset.avisSecousse ?? null,
        origine: pile ? getComputedStyle(pile).transformOrigin : "",
        variables: {
          x: pile?.style.getPropertyValue("--avis-groupe-x") ?? "",
          y: pile?.style.getPropertyValue("--avis-groupe-y") ?? "",
          rotation: pile?.style.getPropertyValue("--avis-groupe-rotation") ?? "",
        },
        cartes: [...document.querySelectorAll<HTMLElement>("[data-avis-pile] .avis-carte")].map(
          (e) => getComputedStyle(e).transform,
        ),
      };
    });

  const avant = await lire();
  assert.equal(avant.variables.x, "0px", "au repos le groupe ne bouge pas");
  assert.equal(avant.secousse, null, "et il ne porte pas la marque de secousse");

  await page.tap("[data-avis-pile] > li:nth-child(2) .avis-carte");
  await page.waitForTimeout(40);
  const pendant = await lire();

  // ── 1. LE GROUPE A BOUGÉ.
  assert.equal(pendant.secousse, "true", "le conteneur porte la marque de secousse");
  assert.notEqual(pendant.groupe, avant.groupe, "la transformation du conteneur doit changer");
  const dx = parseFloat(pendant.variables.x);
  const dy = parseFloat(pendant.variables.y);
  assert.ok(
    Math.abs(dx) + Math.abs(dy) > 0,
    `le groupe doit se déplacer — (${pendant.variables.x}, ${pendant.variables.y})`,
  );
  // ⚠️ AMPLITUDE FAIBLE : c'est un frémissement, pas un déplacement.
  assert.ok(Math.hypot(dx, dy) <= 12, `déplacement trop ample : ${Math.round(Math.hypot(dx, dy))} px`);
  // ⚠️ ET LA MICRO-ROTATION RESTE SOUS LE PLAFOND DEMANDÉ.
  assert.ok(
    Math.abs(parseFloat(pendant.variables.rotation)) <= 0.5,
    `rotation du groupe hors plafond : ${pendant.variables.rotation}`,
  );

  // ── 2. AUTOUR D'UN POINT CENTRAL.
  const [ox, oy] = pendant.origine.split(" ").map((v) => parseFloat(v));
  /*
   * ⚠️ `offsetWidth` ET NON `getBoundingClientRect`. Le conteneur est en train
   * de pivoter : sa boîte englobante est plus large que sa boîte de mise en
   * page, d'autant plus que la pile est haute. Comparer l'origine — exprimée
   * dans le repère non transformé — à une boîte tournée faisait rougir ce
   * test une fois sur deux, selon l'angle tiré au sort. La mesure était
   * fausse, pas le code.
   */
  const boite = await page.evaluate(() => {
    const p = document.querySelector<HTMLElement>("[data-avis-pile]");
    return { w: p?.offsetWidth ?? 0, h: p?.offsetHeight ?? 0 };
  });
  assert.ok(Math.abs(ox - boite.w / 2) < 2, `l'origine n'est pas centrée en x (${pendant.origine})`);
  assert.ok(Math.abs(oy - boite.h / 2) < 2, `l'origine n'est pas centrée en y (${pendant.origine})`);

  // ── 3. AUCUNE CARTE N'A BOUGÉ D'ELLE-MÊME.
  /*
   * La carte tapée est mise en avant, donc sa propre transformation change
   * légitimement — elle se soulève. Toutes les AUTRES doivent être identiques
   * au pixel près : si elles avaient chacune reçu la secousse, elles auraient
   * toutes changé.
   */
  let inchangees = 0;
  for (let i = 0; i < avant.cartes.length; i += 1) {
    if (i === 1) continue;
    assert.equal(
      pendant.cartes[i],
      avant.cartes[i],
      `la carte ${i + 1} a reçu la secousse individuellement — elle ne devrait pas`,
    );
    inchangees += 1;
  }
  assert.ok(inchangees >= 5, `assez de cartes témoins — ${inchangees}`);

  // ── 4. ET ELLE RETOMBE.
  await page.waitForTimeout(400);
  const apres = await lire();
  assert.equal(apres.secousse, null, "la secousse doit retomber d'elle-même");
  assert.equal(apres.variables.x, "0px", "et le groupe revenir à sa place");

  await page.context().close();
});

await test("R15 — la direction de la secousse change d'un tap à l'autre", async () => {
  /*
   * ⚠️ « DIRECTION ALÉATOIRE À CHAQUE INTERACTION » est vérifiable sans
   * fragilité : on tape plusieurs fois et on regarde combien de vecteurs
   * DISTINCTS sortent. Un tirage figé n'en donnerait qu'un.
   *
   * Le seuil est bas à dessein — deux vecteurs distincts sur six taps
   * suffisent à prouver qu'il y a tirage, sans qu'un hasard malheureux fasse
   * rougir une suite qui doit rester déterministe dans son verdict.
   */
  const page = await atelier({ width: 390, height: 844 }, { tactile: true });
  const vecteurs = new Set<string>();

  for (let n = 0; n < 6; n += 1) {
    await page.tap(`[data-avis-pile] > li:nth-child(${(n % 4) + 1}) .avis-carte`);
    await page.waitForTimeout(40);
    const v = await page.evaluate(() => {
      const p = document.querySelector<HTMLElement>("[data-avis-pile]");
      return [
        p?.style.getPropertyValue("--avis-groupe-x") ?? "",
        p?.style.getPropertyValue("--avis-groupe-y") ?? "",
        p?.style.getPropertyValue("--avis-groupe-rotation") ?? "",
      ].join("|");
    });
    /*
     * ⚠️ ON N'ENREGISTRE QUE LES VECTEURS NON NULS, ET C'EST ESSENTIEL.
     *
     * Ce test a été mis à l'épreuve en FIGEANT la direction : il est resté
     * vert. La raison : entre le tap et la lecture, la secousse peut déjà
     * être retombée à (0, 0), et ce zéro comptait comme un second vecteur
     * « distinct ». Le test prouvait alors l'existence de la retombée, pas
     * celle du tirage au sort.
     */
    if (!/^0px\|0px\|0deg$/.test(v)) vecteurs.add(v);
    await page.waitForTimeout(320);
  }

  assert.ok(vecteurs.size >= 1, "aucune secousse n'a été observée sur six taps");
  assert.ok(
    vecteurs.size >= 2,
    `la direction doit varier — un seul vecteur observé sur six taps : ${[...vecteurs][0]}`,
  );

  // Et le texte complet est bien apparu sur la carte tapée.
  await page.tap("[data-avis-pile] > li:nth-child(1) .avis-carte");
  await page.waitForTimeout(320);
  const deplie = await page.evaluate(() => {
    const p = document.querySelector<HTMLElement>("[data-avis-pile] > li:nth-child(1) .avis-texte");
    if (!p) return null;
    return { coupe: p.scrollHeight > p.clientHeight + 1, lignes: getComputedStyle(p).webkitLineClamp };
  });
  assert.ok(deplie, "la première carte doit être trouvée");
  assert.equal(deplie.lignes, "none", "le tap doit lever l'écrêtage");
  assert.ok(!deplie.coupe, "et montrer l'avis en entier");

  await page.screenshot({ path: join(CAPTURES, "mobile-tap-groupe.png"), fullPage: true });
  await page.context().close();
});

await test("R16 — la place réservée par rangée couvre la carte la PLUS HAUTE", async () => {
  /*
   * ⚠️ L'INVARIANT QUI MANQUAIT, ET QUI A COÛTÉ UN DÉFAUT RÉEL.
   *
   * Les cartes sont en position absolue dans un hôte de hauteur fixe. Tant
   * que `hauteur d'hôte + gouttière` dépasse la carte la plus haute, rien ne
   * déborde sur la rangée suivante. En resserrant la composition, la place
   * réservée est passée sous la hauteur de la carte de Vincent — dont le nom
   * court sur trois lignes — et son bas a recouvert l'en-tête de la carte du
   * dessous : 11 px sur 247 px de large.
   *
   * R5 quater l'a vu, mais seulement APRÈS coup et sans dire pourquoi. Ce
   * test-ci nomme la cause : il compare directement le budget de la rangée à
   * la carte la plus haute, et son message donne les deux chiffres.
   */
  // ⚠️ LES DEUX COMPOSITIONS SONT VÉRIFIÉES. Desktop et mobile réservent des
  // hauteurs différentes pour des cartes différentes ; resserrer l'une sans
  // l'autre est exactement l'erreur que ce test doit rendre impossible.
  for (const taille of [
    { width: 1440, height: 900 },
    { width: 390, height: 844 },
  ]) {
    const page = await atelier(taille, { tactile: taille.width < 768 });
    const mesures = await page.evaluate(() => {
      const pile = document.querySelector<HTMLElement>("[data-avis-pile]");
      const hotes = [...document.querySelectorAll<HTMLElement>("[data-avis-pile] > li")];
      return {
        gouttiere: parseFloat(pile ? getComputedStyle(pile).rowGap : "0") || 0,
        hotes: hotes.map((l) => l.offsetHeight),
        cartes: hotes.map((li, i) => ({
          i: i + 1,
          hauteur: li.querySelector<HTMLElement>(".avis-carte")?.offsetHeight ?? 0,
        })),
      };
    });

    const budget = mesures.hotes[0] + mesures.gouttiere;
    const plusHaute = mesures.cartes.reduce((a, b) => (b.hauteur > a.hauteur ? b : a));
    assert.ok(
      plusHaute.hauteur <= budget,
      `${taille.width} px : la carte ${plusHaute.i} fait ${Math.round(plusHaute.hauteur)} px pour un budget de rangée de ${Math.round(budget)} px — elle débordera sur la rangée suivante`,
    );

    // ⚠️ ET LES HÔTES SONT TOUS ÉGAUX : c'est ce qui rend le budget calculable.
    assert.equal(
      new Set(mesures.hotes).size,
      1,
      `${taille.width} px : toutes les rangées doivent réserver la même place — ${[...new Set(mesures.hotes)].join(", ")}`,
    );
    await page.context().close();
  }
});

await test("R17 — le centre du groupe est IMAGINAIRE : rien ne le représente", async () => {
  /*
   * ⚠️ `transform-origin` EST UN POINT DE CALCUL, PAS UN OBJET. L'amas doit
   * sembler s'organiser autour de quelque chose sans que ce quelque chose
   * soit jamais peint. Ce test cherche donc tout ce qui pourrait le trahir :
   * un pseudo-élément, un enfant qui ne serait pas une carte, un repère
   * dessiné.
   */
  const page = await atelier({ width: 1440, height: 900 });
  // ⚠️ AUCUNE FONCTION NOMMÉE DANS `page.evaluate`. tsx instrumente les
  // déclarations avec un helper `__name` qui n'existe pas dans la page ;
  // l'appel à `getComputedStyle` est donc répété en ligne plutôt qu'extrait.
  const inspection = await page.evaluate(() => {
    const pile = document.querySelector<HTMLElement>("[data-avis-pile]");
    if (!pile) return null;
    return {
      // Le conteneur ne contient QUE des cartes.
      enfants: [...pile.children].map((e) => e.tagName.toLowerCase()),
      // Aucun pseudo-élément peint sur le conteneur.
      avant: getComputedStyle(pile, "::before").content,
      apres: getComputedStyle(pile, "::after").content,
      // Ni sur les hôtes.
      pseudosHotes: [...pile.children].flatMap((e) => [
        getComputedStyle(e, "::before").content,
        getComputedStyle(e, "::after").content,
      ]),
      // Aucun SVG, cercle ou repère hors des cartes.
      reperes: pile.querySelectorAll("svg:not(.avis-etoile), circle, line, hr").length,
    };
  });

  assert.ok(inspection, "le conteneur doit exister");
  assert.ok(
    inspection.enfants.every((t) => t === "li"),
    `le conteneur ne doit contenir que des cartes — trouvé : ${inspection.enfants.join(", ")}`,
  );
  for (const [nom, valeur] of [
    ["::before", inspection.avant],
    ["::after", inspection.apres],
  ] as const) {
    assert.ok(
      valeur === "none" || valeur === "normal" || valeur === "",
      `un pseudo-élément ${nom} est peint sur le groupe (${valeur}) — le centre doit rester invisible`,
    );
  }
  for (const v of inspection.pseudosHotes) {
    assert.ok(
      v === "none" || v === "normal" || v === "",
      `un pseudo-élément est peint sur une carte (${v})`,
    );
  }
  assert.equal(inspection.reperes, 0, "aucun cercle, axe ou repère ne doit être dessiné");
  await page.context().close();
});

await new Promise<void>((ok) => serveur.close(() => ok()));
await navigateur.close();

console.log(`\nCaptures écrites dans scripts/tests/avis-google-render/captures/`);
console.log(`${réussis} réussis, ${échecs} échecs`);
if (échecs > 0) process.exit(1);
