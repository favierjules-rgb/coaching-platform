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
  const chemin = requete.url ?? "/";
  if (chemin.startsWith("/paquet.js")) {
    reponse.writeHead(200, { "content-type": "text/javascript; charset=utf-8" }).end(paquet);
    return;
  }
  /*
   * ⚠️ LES FICHIERS DE `public/` SONT SERVIS POUR DE VRAI.
   *
   * La photo au centre de l'amas vient de `/brand/avis/…`. Sans cette route,
   * elle renverrait un 404 et le harnais mesurerait une géométrie sans son
   * élément central — c'est-à-dire une géométrie qui n'existe nulle part
   * ailleurs que dans le test.
   */
  if (chemin.startsWith("/brand/")) {
    const fichier = resolve(ICI, "../../public", chemin.replace(/^\//, "").split("?")[0]);
    if (existsSync(fichier)) {
      const type = fichier.endsWith(".webp")
        ? "image/webp"
        : fichier.endsWith(".svg")
          ? "image/svg+xml"
          : "application/octet-stream";
      reponse.writeHead(200, { "content-type": type }).end(readFileSync(fichier));
      return;
    }
    reponse.writeHead(404).end("introuvable");
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

/**
 * ⚠️ `orbiteFigee` EXISTE PARCE QUE L'AMAS BOUGE EN PERMANENCE.
 *
 * Depuis que les cartes parcourent une orbite, deux mesures prises à une
 * seconde d'intervalle ne portent plus sur la même composition : tout test de
 * géométrie devenait un tirage au sort. Figer l'animation — sans la
 * supprimer — rend les positions déterministes tout en gardant vivants le
 * survol, le focus et les transitions, que `prefers-reduced-motion` aurait
 * neutralisés.
 *
 * Les tests de l'ORBITE elle-même, eux, la laissent tourner.
 */
async function atelier(
  taille: { width: number; height: number },
  options: { tactile?: boolean; mouvementReduit?: boolean; orbiteFigee?: boolean } = {},
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
  if (options.orbiteFigee ?? true) {
    await page.addStyleTag({
      content: "[data-avis-scene] { animation-play-state: paused !important; }",
    });
    // Une image de rendu pour que la pause soit effective avant la mesure.
    await page.evaluate(() => new Promise((ok) => requestAnimationFrame(() => ok(null))));
  }
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

await test("R3 — mobile : l'amas ORBITAL tient dans l'écran", async () => {
  /*
   * ⚠️ CE TEST A CHANGÉ DEUX FOIS, ET IL FAUT SAVOIR POURQUOI.
   *
   * Il exigeait d'abord une colonne de cartes pleine largeur, puis deux
   * colonnes compactes. La composition est maintenant une ORBITE : les neuf
   * cartes sont posées autour de la photo, chacune par son angle et son
   * rayon. Les seuils de largeur des versions précédentes n'ont plus de sens
   * — ils décrivaient une grille qui n'existe plus.
   *
   * Ce qui compte désormais : que l'amas tienne dans l'écran, que la photo
   * soit au centre, et qu'aucune carte ne parte hors du cadre.
   */
  const page = await atelier({ width: 390, height: 844 }, { tactile: true });
  const g = await geometrie(page);

  const scene = await page.evaluate(() => {
    const s2 = document.querySelector<HTMLElement>("[data-avis-scene]");
    const photo = document.querySelector<HTMLElement>(".avis-centre");
    if (!s2 || !photo) return null;
    const rs = s2.getBoundingClientRect();
    const rp = photo.getBoundingClientRect();
    return {
      scene: { x: rs.x, y: rs.y, w: rs.width, h: rs.height, cx: rs.x + rs.width / 2, cy: rs.y + rs.height / 2 },
      photo: { cx: rp.x + rp.width / 2, cy: rp.y + rp.height / 2, w: rp.width },
    };
  });
  assert.ok(scene, "la scène et la photo doivent exister");

  // ── LA SCÈNE EST CARRÉE : c'est ce qui rend l'orbite circulaire.
  assert.ok(
    Math.abs(scene.scene.w - scene.scene.h) < 2,
    `la scène doit être carrée — ${Math.round(scene.scene.w)}×${Math.round(scene.scene.h)}`,
  );

  // ── AUCUNE CARTE NE SORT DE LA SCÈNE.
  for (const [i, r] of g.rects.entries()) {
    assert.ok(
      r.x >= scene.scene.x - 2 && r.droite <= scene.scene.x + scene.scene.w + 2,
      `mobile : la carte ${i + 1} sort de la scène (${Math.round(r.x)}…${Math.round(r.droite)} pour ${Math.round(scene.scene.x)}…${Math.round(scene.scene.x + scene.scene.w)})`,
    );
  }

  // ── ET AUCUN DÉBORDEMENT DE PAGE.
  assert.ok(g.scrollWidth <= g.innerWidth + 1, "aucun débordement horizontal");

  await page.screenshot({ path: join(CAPTURES, "mobile-pile.png"), fullPage: true });
  await page.context().close();
});

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

await test("R5 bis — le recouvrement est VOULU, mais chaque carte reste identifiable", async () => {
  /*
   * ⚠️ CE TEST INTERDISAIT TOUT RECOUVREMENT DE TEXTE. Il ne le peut plus :
   * neuf cartes posées autour d'une photo se chevauchent nécessairement, et
   * c'est demandé — « quitte à ce qu'ils se passent les uns sur les autres ».
   *
   * Ce qui reste non négociable, c'est l'ATTRIBUTION. Un avis dont on ne voit
   * plus qui l'a écrit n'est plus un témoignage, c'est un bout de texte. Le
   * test vérifie donc que l'avatar de CHAQUE carte — l'ancre d'identité, en
   * haut à gauche — reste entièrement visible, quel que soit l'empilement.
   *
   * Le survol, lui, ramène la carte entière au premier plan : rien n'est
   * définitivement caché.
   */
  const page = await atelier({ width: 1440, height: 900 });
  const zones = await page.evaluate(() => {
    const hotes = [...document.querySelectorAll<HTMLElement>("[data-avis-pile] > li")];
    return hotes.map((h, i) => {
      const carte = h.querySelector<HTMLElement>(".avis-carte");
      const avatar = h.querySelector<HTMLElement>(".avis-avatar, .avis-avatar-initiale");
      const rc = (carte ?? h).getBoundingClientRect();
      const ra = (avatar ?? h).getBoundingClientRect();
      return {
        i,
        plan: Number(getComputedStyle(h).zIndex) || 0,
        carte: { g: rc.x, d: rc.right, h: rc.y, b: rc.bottom },
        avatar: { g: ra.x, d: ra.right, h: ra.y, b: ra.bottom },
      };
    });
  });

  assert.ok(zones.length >= 6, `toutes les cartes doivent être mesurées — ${zones.length}`);

  for (const cible of zones) {
    for (const dessus of zones) {
      if (dessus.i === cible.i || dessus.plan <= cible.plan) continue;
      const x = Math.min(dessus.carte.d, cible.avatar.d) - Math.max(dessus.carte.g, cible.avatar.g);
      const y = Math.min(dessus.carte.b, cible.avatar.b) - Math.max(dessus.carte.h, cible.avatar.h);
      assert.ok(
        x <= 1 || y <= 1,
        `la carte ${dessus.i + 1} recouvre l'avatar de la carte ${cible.i + 1} (${Math.round(x)}×${Math.round(y)} px) — l'avis n'est plus attribuable`,
      );
    }
  }
  await page.context().close();
});

await test("R5 quater — le recouvrement d'un en-tête reste BORNÉ", async () => {
  /*
   * ⚠️ CE TEST INTERDISAIT QU'UN EN-TÊTE SOIT RECOUVERT. Dans une grille, un
   * en-tête caché était toujours un défaut. Dans un amas voulu chevauchant,
   * une carte au premier plan mord forcément un peu sur ses voisines.
   *
   * On borne donc au lieu d'interdire : un en-tête peut être entamé, jamais
   * effacé. Le seuil est la MOITIÉ de sa surface — au-delà, le nom de la
   * personne devient illisible, et R5 bis garantit déjà que l'avatar, lui,
   * reste toujours entièrement visible.
   */
  for (const taille of [
    { width: 768, height: 1024 },
    { width: 1440, height: 900 },
  ]) {
    const page = await atelier(taille);
    const zones = await page.evaluate(() => {
      const hotes = [...document.querySelectorAll<HTMLElement>("[data-avis-pile] > li")];
      return hotes.map((h, i) => {
        const carte = h.querySelector<HTMLElement>(".avis-carte");
        const entete = h.querySelector<HTMLElement>(".avis-entete");
        const rc = (carte ?? h).getBoundingClientRect();
        const re = (entete ?? carte ?? h).getBoundingClientRect();
        return {
          i,
          plan: Number(getComputedStyle(h).zIndex) || 0,
          carte: { g: rc.x, d: rc.right, h: rc.y, b: rc.bottom },
          entete: { g: re.x, d: re.right, h: re.y, b: re.bottom, aire: re.width * re.height },
        };
      });
    });

    for (const cible of zones) {
      let couvert = 0;
      for (const dessus of zones) {
        if (dessus.i === cible.i || dessus.plan <= cible.plan) continue;
        const x = Math.min(dessus.carte.d, cible.entete.d) - Math.max(dessus.carte.g, cible.entete.g);
        const y = Math.min(dessus.carte.b, cible.entete.b) - Math.max(dessus.carte.h, cible.entete.h);
        if (x > 0 && y > 0) couvert += x * y;
      }
      const part = cible.entete.aire > 0 ? couvert / cible.entete.aire : 0;
      assert.ok(
        part <= 0.5,
        `${taille.width} px : ${Math.round(part * 100)} % de l'en-tête de la carte ${cible.i + 1} est recouvert`,
      );
    }
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
  /*
   * ⚠️ ON NE TAPE PAS LE CENTRE D'UNE CARTE, ON TAPE UN POINT VISIBLE.
   *
   * Les cartes se chevauchent volontairement : le centre géométrique de l'une
   * peut être recouvert par une voisine de plan supérieur. `page.tap()` vise
   * ce centre et attendait indéfiniment que la cible devienne atteignable.
   *
   * Ce n'est pas ce que fait un doigt. Un doigt tape là où il VOIT la carte.
   * On cherche donc, dans la page, un point qui appartienne réellement à la
   * carte visée — `elementFromPoint` donne la réponse — et on tape là.
   */
  const page = await atelier({ width: 390, height: 844 }, { tactile: true });

  const pointVisible = (n: number) =>
    page.evaluate((rang: number) => {
      const hote = document.querySelector<HTMLElement>(
        `[data-avis-pile] > li:nth-child(${rang})`,
      );
      const carte = hote?.querySelector<HTMLElement>(".avis-carte");
      if (!carte) return null;
      const r = carte.getBoundingClientRect();
      /*
       * On balaie la carte et on retient le premier point où ELLE est la
       * première carte rencontrée. `elementsFromPoint` rend la pile complète
       * sous le curseur, du dessus vers le dessous : si une autre carte y
       * figure avant celle-ci, le doigt toucherait l'autre.
       */
      for (const fy of [0.5, 0.3, 0.7, 0.15, 0.85]) {
        for (const fx of [0.5, 0.3, 0.7, 0.15, 0.85]) {
          const x = r.x + r.width * fx;
          const y = r.y + r.height * fy;
          if (x < 0 || y < 0 || x > innerWidth || y > innerHeight) continue;
          const pile = document.elementsFromPoint(x, y);
          const premiere = pile.find((e) => e.closest(".avis-carte"));
          if (premiere && premiere.closest(".avis-carte") === carte) return { x, y };
        }
      }
      return null;
    }, n);

  /*
   * ⚠️ D'ABORD L'INVARIANT QUI COMPTE : AU REPOS, LES NEUF CARTES SONT
   * ATTEIGNABLES.
   *
   * C'est ce que le chevauchement met en danger — une carte entièrement
   * recouverte serait un avis qu'on ne peut pas ouvrir, autant ne pas
   * l'afficher. Le test l'a d'ailleurs attrapé : la carte 7 disparaissait
   * sous sa voisine, et l'empilement a dû passer d'un ordre de liste à un
   * ordre par rayon.
   *
   * ⚠️ AU REPOS, ET PAS PENDANT QU'UN AVIS EST OUVERT. Une carte dépliée
   * grandit autour de son centre et peut recouvrir ses voisines — l'avis de
   * huit cents caractères en couvre plusieurs. C'est le comportement attendu
   * d'un élément mis au premier plan, et un tap à l'extérieur le referme.
   */
  for (let n = 1; n <= 9; n += 1) {
    assert.ok(await pointVisible(n), `au repos, la carte ${n} n'offre aucun point tapable`);
  }

  const avant = await geometrie(page);
  const p2 = await pointVisible(2);
  assert.ok(p2, "un point visible de la carte 2 doit exister — sinon elle est entièrement cachée");
  await page.touchscreen.tap(p2.x, p2.y);
  await page.waitForTimeout(320);
  const apres = await geometrie(page);

  assert.ok(
    Number(apres.plans[1]) > Number(avant.plans[1]),
    "le tap doit mettre la carte en avant",
  );
  assert.ok(apres.scrollWidth <= apres.innerWidth + 1, "et ne crée aucun débordement");

  // Un tap sur une AUTRE carte change la mise en avant : le comportement
  // demandé pour le tactile, où le survol n'existe pas.
  const p4 = await pointVisible(4);
  assert.ok(p4, "un point visible de la carte 4 doit exister");
  await page.touchscreen.tap(p4.x, p4.y);
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
      const pile = document.querySelector<HTMLElement>("[data-avis-amas]");
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

  const photoAvant = await page.evaluate(() => {
    const f = document.querySelector<HTMLElement>(".avis-centre");
    const r = f?.getBoundingClientRect();
    return r ? { cx: Math.round(r.x + r.width / 2), cy: Math.round(r.y + r.height / 2) } : null;
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
  /*
   * ⚠️ PLUS AUCUNE ROTATION DE GROUPE — c'est un retrait demandé. La secousse
   * est désormais une pure combinaison de translations : l'ancienne
   * micro-rotation de ±0,4° a disparu du composant, et ce test refuse qu'elle
   * revienne.
   */
  assert.equal(
    pendant.variables.rotation,
    "",
    `la secousse ne doit porter aucune rotation — trouvé « ${pendant.variables.rotation} »`,
  );

  /*
   * ── 2. LA PHOTO NE BOUGE PAS.
   *
   * C'est elle, le point fixe. La secousse porte sur l'amas — traits et
   * cartes — qui est le VOISIN de la photo dans l'arbre, pas son parent. Si
   * elle était posée un cran plus haut, sur la scène, la photo frémirait avec
   * le reste et le centre cesserait d'être immobile.
   */
  const photoApres = await page.evaluate(() => {
    const f = document.querySelector<HTMLElement>(".avis-centre");
    const r = f?.getBoundingClientRect();
    return r ? { cx: Math.round(r.x + r.width / 2), cy: Math.round(r.y + r.height / 2) } : null;
  });
  assert.ok(photoApres, "la photo doit exister");
  assert.deepEqual(
    photoApres,
    photoAvant,
    "la photo doit rester immobile pendant la secousse du groupe",
  );

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
    /*
     * ⚠️ TOUJOURS LA PREMIÈRE CARTE, ET C'EST UN ARTEFACT DE MESURE ASSUMÉ.
     *
     * Les cartes se chevauchent : le CENTRE d'une carte peut être recouvert
     * par une voisine de plan supérieur. `page.tap()` vise ce centre et
     * attendait alors indéfiniment que la cible devienne atteignable — trente
     * secondes d'expiration. Un vrai doigt, lui, tape la partie VISIBLE de la
     * carte et ne rencontre aucun problème.
     *
     * La première carte porte le plan le plus élevé au repos : elle n'est
     * jamais recouverte. Taper la même carte à chaque tour n'affaiblit rien —
     * ce qu'on mesure ici est la direction tirée au sort, pas la cible.
     */
    await page.tap(`[data-avis-pile] > li:nth-child(1) .avis-carte`);
    await page.waitForTimeout(40);
    const v = await page.evaluate(() => {
      const p = document.querySelector<HTMLElement>("[data-avis-amas]");
      return [
        p?.style.getPropertyValue("--avis-groupe-x") ?? "",
        p?.style.getPropertyValue("--avis-groupe-y") ?? "",
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
    if (!/^0px\|0px$/.test(v)) vecteurs.add(v);
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

await test("R16 — les deux inégalités qui tiennent l'orbite", async () => {
  /*
   * ⚠️ CE TEST VÉRIFIAIT UN « BUDGET DE RANGÉE ». Il n'y a plus de rangées :
   * chaque carte est placée par un angle et un rayon. Deux inégalités
   * remplacent l'ancienne, et chacune correspond à un défaut réellement
   * rencontré pendant la construction :
   *
   *   1. rayon + demi-carte ≤ demi-scène
   *      Sans elle, la carte la plus au large sortait de l'écran — mesuré à
   *      390 px : 404 px de bord droit pour 390 px de fenêtre.
   *
   *   2. rayon − demi-carte ≥ rayon de la photo
   *      Sans elle, la carte la plus proche passait SOUS la photo, qui la
   *      recouvre : elle devenait intouchable, et le tap ne la mettait plus
   *      en avant.
   */
  for (const taille of [
    { width: 1440, height: 900 },
    { width: 390, height: 844 },
  ]) {
    const page = await atelier(taille, { tactile: taille.width < 768 });
    const m = await page.evaluate(() => {
      const scene = document.querySelector<HTMLElement>("[data-avis-scene]");
      const photo = document.querySelector<HTMLElement>(".avis-centre");
      if (!scene || !photo) return null;
      const rs = scene.getBoundingClientRect();
      const rp = photo.getBoundingClientRect();
      const cx = rs.x + rs.width / 2;
      const cy = rs.y + rs.height / 2;
      return {
        demiScene: rs.width / 2,
        rayonPhoto: rp.width / 2,
        cartes: [...document.querySelectorAll<HTMLElement>("[data-avis-pile] .avis-carte")].map(
          (c, i) => {
            const r = c.getBoundingClientRect();
            return {
              i: i + 1,
              rayon: Math.hypot(r.x + r.width / 2 - cx, r.y + r.height / 2 - cy),
              demiLargeur: r.width / 2,
              hors:
                r.x < rs.x - 2 ||
                r.right > rs.right + 2 ||
                r.y < rs.y - 2 ||
                r.bottom > rs.bottom + 2,
            };
          },
        ),
      };
    });
    assert.ok(m, "scène et photo doivent exister");
    assert.equal(m.cartes.length, 9, `neuf cartes attendues — ${m.cartes.length}`);

    for (const c of m.cartes) {
      assert.ok(!c.hors, `${taille.width} px : la carte ${c.i} sort de la scène`);
      assert.ok(
        c.rayon - c.demiLargeur >= m.rayonPhoto - 2,
        `${taille.width} px : la carte ${c.i} passe sous la photo (bord intérieur à ${Math.round(c.rayon - c.demiLargeur)} px pour un rayon de photo de ${Math.round(m.rayonPhoto)} px) — elle deviendrait intouchable`,
      );
    }
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

/* ═══════ R18-R20. L'ORBITE ═══════ */

await test("R18 — l'amas tourne LENTEMENT, autour du centre exact de la photo", async () => {
  /*
   * ⚠️ LE CENTRE NE SE VÉRIFIE PAS EN LISANT UN `transform-origin` — il n'y en
   * a pas. Les cartes sont placées en coordonnées polaires ; le centre est
   * l'origine de ce repère. On le vérifie donc par la PROPRIÉTÉ qui le
   * définit : si le centre de rotation est bien celui de la photo, alors la
   * distance de chaque carte à ce point ne change pas pendant qu'elle tourne.
   *
   * Un centre décalé, lui, ferait respirer cette distance à chaque tour.
   */
  const page = await atelier({ width: 1440, height: 900 }, { orbiteFigee: false });

  // ── LA DURÉE : lente, perceptible après quelques secondes, pas un manège.
  const duree = await page.evaluate(() => {
    const scene = document.querySelector<HTMLElement>("[data-avis-scene]");
    if (!scene) return null;
    const s2 = getComputedStyle(scene);
    return {
      duree: parseFloat(s2.animationDuration),
      nom: s2.animationName,
      fonction: s2.animationTimingFunction,
      iterations: s2.animationIterationCount,
    };
  });
  assert.ok(duree, "la scène doit exister");
  assert.notEqual(duree.nom, "none", "l'orbite doit être animée");
  assert.ok(
    duree.duree >= 30 && duree.duree <= 45,
    `un tour doit durer de 30 à 45 s — mesuré ${duree.duree} s`,
  );
  assert.equal(duree.fonction, "linear", "une orbite ne doit ni accélérer ni ralentir");
  assert.equal(duree.iterations, "infinite", "elle ne s'arrête pas d'elle-même");

  // ── LES RAYONS : constants pendant la rotation.
  const releve = () =>
    page.evaluate(() => {
      const photo = document.querySelector<HTMLElement>(".avis-centre");
      if (!photo) return null;
      const rp = photo.getBoundingClientRect();
      const cx = rp.x + rp.width / 2;
      const cy = rp.y + rp.height / 2;
      return {
        centre: { cx, cy },
        cartes: [...document.querySelectorAll<HTMLElement>("[data-avis-pile] .avis-carte")].map(
          (c) => {
            const r = c.getBoundingClientRect();
            return {
              x: r.x + r.width / 2,
              y: r.y + r.height / 2,
              rayon: Math.hypot(r.x + r.width / 2 - cx, r.y + r.height / 2 - cy),
            };
          },
        ),
      };
    });

  const releves = [];
  for (let n = 0; n < 4; n += 1) {
    releves.push(await releve());
    if (n < 3) await page.waitForTimeout(1300);
  }
  assert.ok(releves.every(Boolean), "les relevés doivent aboutir");

  // ── 1. ÇA BOUGE VRAIMENT.
  const depart = releves[0]!;
  const arrivee = releves[3]!;
  const parcours = Math.hypot(
    arrivee.cartes[0].x - depart.cartes[0].x,
    arrivee.cartes[0].y - depart.cartes[0].y,
  );
  assert.ok(parcours > 3, `l'amas doit se déplacer — ${Math.round(parcours)} px en ~4 s`);

  // ── 2. MAIS LENTEMENT. À 38 s le tour, quatre secondes valent environ
  // 38° d'arc, soit une fraction du rayon — jamais la moitié du cercle.
  assert.ok(
    parcours < depart.cartes[0].rayon,
    `le déplacement doit rester lent — ${Math.round(parcours)} px pour un rayon de ${Math.round(depart.cartes[0].rayon)} px`,
  );

  // ── 3. LE CENTRE EST BIEN CELUI DE LA PHOTO.
  for (let i = 0; i < depart.cartes.length; i += 1) {
    const rayons = releves.map((r) => r!.cartes[i].rayon);
    const ecart = Math.max(...rayons) - Math.min(...rayons);
    assert.ok(
      ecart <= 2,
      `la carte ${i + 1} change de distance à la photo pendant l'orbite (${ecart.toFixed(1)} px) — le centre de rotation n'est pas celui de la photo`,
    );
  }

  // ── 4. LA PHOTO, ELLE, NE BOUGE PAS.
  const centres = releves.map((r) => `${Math.round(r!.centre.cx)}|${Math.round(r!.centre.cy)}`);
  assert.equal(new Set(centres).size, 1, `la photo doit rester immobile — ${centres.join(", ")}`);

  await page.screenshot({ path: join(CAPTURES, "orbite.png"), fullPage: true });
  await page.context().close();
});

await test("R19 — l'orbite se met en PAUSE au survol, au tap, et n'existe pas en mouvement réduit", async () => {
  /*
   * On ne lit pas un texte qui se déplace. Dès qu'une carte est mise en
   * avant — survol, focus ou tap — l'orbite s'arrête, et elle repart quand la
   * carte est relâchée. `animation-play-state` fige la variable où elle en
   * est : rien ne saute au redémarrage.
   */
  const page = await atelier({ width: 1440, height: 900 }, { orbiteFigee: false });

  const position = () =>
    page.evaluate(() => {
      const c = document.querySelector<HTMLElement>("[data-avis-pile] .avis-carte");
      const r = c?.getBoundingClientRect();
      const scene = document.querySelector<HTMLElement>("[data-avis-scene]");
      return {
        x: r ? Math.round(r.x) : 0,
        y: r ? Math.round(r.y) : 0,
        etat: scene?.dataset.avisOrbite ?? "",
        anim: scene ? getComputedStyle(scene).animationPlayState : "",
      };
    });

  /*
   * ⚠️ `mouse.move` ET NON `hover()`, ET LA RAISON EST INSTRUCTIVE.
   *
   * `hover()` attend que la cible soit « visible ET STABLE » : deux images de
   * rendu avec la même boîte. Une carte en orbite ne l'est jamais — elle
   * avance d'une fraction de pixel à chaque image — et l'appel expirait au
   * bout de trente secondes.
   *
   * Ce n'est pas un défaut de l'interface : à 38 s le tour, un vrai curseur
   * survole sans aucune difficulté et le navigateur émet `mouseenter`
   * normalement. C'est Playwright qui est plus exigeant que la réalité. On
   * pose donc le curseur à la position courante de la carte, ce qui est
   * exactement ce que fait une main.
   */
  const cible = await page.evaluate(() => {
    const r = document
      .querySelector<HTMLElement>("[data-avis-pile] > li:nth-child(1) .avis-carte")
      ?.getBoundingClientRect();
    return r ? { x: r.x + r.width / 2, y: r.y + r.height / 2 } : null;
  });
  assert.ok(cible, "la première carte doit être trouvée");
  await page.mouse.move(cible.x, cible.y);
  await page.waitForTimeout(200);
  const a = await position();
  assert.equal(a.etat, "pause", "le survol doit demander la pause");
  assert.equal(a.anim, "paused", "et l'animation doit être effectivement en pause");

  await page.waitForTimeout(1500);
  const b = await position();
  assert.equal(a.x, b.x, "la carte survolée ne doit plus se déplacer en x");
  assert.equal(a.y, b.y, "ni en y");

  // ── ET L'ORBITE REPART quand on quitte la carte.
  await page.mouse.move(5, 5);
  await page.waitForTimeout(1200);
  const c = await position();
  assert.equal(c.etat, "tourne", "quitter la carte doit relancer l'orbite");
  assert.ok(c.x !== b.x || c.y !== b.y, "et l'amas doit repartir");
  await page.context().close();

  // ── TACTILE : le tap met aussi en pause.
  const mobile = await atelier({ width: 390, height: 844 }, { tactile: true, orbiteFigee: false });
  // Même raison qu'au survol : on tape la position courante de la carte.
  const cibleTactile = await mobile.evaluate(() => {
    const r = document
      .querySelector<HTMLElement>("[data-avis-pile] > li:nth-child(1) .avis-carte")
      ?.getBoundingClientRect();
    return r ? { x: r.x + r.width / 2, y: r.y + r.height / 2 } : null;
  });
  assert.ok(cibleTactile, "la première carte mobile doit être trouvée");
  await mobile.touchscreen.tap(cibleTactile.x, cibleTactile.y);
  await mobile.waitForTimeout(200);
  const etatTactile = await mobile.evaluate(() => {
    const scene = document.querySelector<HTMLElement>("[data-avis-scene]");
    return {
      etat: scene?.dataset.avisOrbite ?? "",
      anim: scene ? getComputedStyle(scene).animationPlayState : "",
    };
  });
  assert.equal(etatTactile.etat, "pause", "le tap doit mettre l'orbite en pause");
  assert.equal(etatTactile.anim, "paused", "effectivement");
  await mobile.context().close();

  // ── MOUVEMENT RÉDUIT : aucune orbite du tout.
  const calme = await atelier(
    { width: 1440, height: 900 },
    { mouvementReduit: true, orbiteFigee: false },
  );
  const anim = await calme.evaluate(() => {
    const scene = document.querySelector<HTMLElement>("[data-avis-scene]");
    return scene ? getComputedStyle(scene).animationName : "";
  });
  assert.equal(anim, "none", "sous prefers-reduced-motion, aucune orbite");

  const avant = await calme.evaluate(() => {
    const r = document
      .querySelector<HTMLElement>("[data-avis-pile] .avis-carte")
      ?.getBoundingClientRect();
    return r ? `${Math.round(r.x)}|${Math.round(r.y)}` : "";
  });
  await calme.waitForTimeout(1500);
  const apres = await calme.evaluate(() => {
    const r = document
      .querySelector<HTMLElement>("[data-avis-pile] .avis-carte")
      ?.getBoundingClientRect();
    return r ? `${Math.round(r.x)}|${Math.round(r.y)}` : "";
  });
  assert.equal(apres, avant, "et rien ne doit bouger");
  await calme.context().close();
});

await test("R20 — un trait fin relie CHAQUE avis à la photo", async () => {
  const page = await atelier({ width: 1440, height: 900 });
  const traits = await page.evaluate(() => {
    const scene = document.querySelector<HTMLElement>("[data-avis-scene]");
    const photo = document.querySelector<HTMLElement>(".avis-centre");
    if (!scene || !photo) return null;
    const rs = scene.getBoundingClientRect();
    const cx = rs.x + rs.width / 2;
    const cy = rs.y + rs.height / 2;
    const liens = [...document.querySelectorAll<HTMLElement>(".avis-lien")];
    const cartes = [...document.querySelectorAll<HTMLElement>("[data-avis-pile] .avis-carte")];
    return {
      nb: liens.length,
      nbCartes: cartes.length,
      pointeurs: getComputedStyle(
        document.querySelector<HTMLElement>(".avis-rayons") as HTMLElement,
      ).pointerEvents,
      details: liens.map((l, i) => {
        const r = l.getBoundingClientRect();
        const s2 = getComputedStyle(l);
        const rc = cartes[i]?.getBoundingClientRect();
        // Le bout du trait, calculé depuis l'angle et la longueur déclarés.
        const longueur = parseFloat(s2.width);
        return {
          epaisseur: parseFloat(s2.height),
          fond: s2.backgroundImage,
          longueur,
          // Distance entre le centre de la carte et le centre du trait :
          // le trait doit partir du centre et finir sur la carte.
          rayonCarte: rc ? Math.hypot(rc.x + rc.width / 2 - cx, rc.y + rc.height / 2 - cy) : -1,
          racineAuCentre: Math.hypot(
            (s2.transform.includes("matrix") ? r.x : r.x) - cx,
            r.y - cy,
          ),
        };
      }),
    };
  });

  assert.ok(traits, "la scène doit exister");
  assert.equal(traits.nb, traits.nbCartes, "un trait par avis, ni plus ni moins");
  assert.equal(traits.nb, 9, `neuf traits attendus — ${traits.nb}`);
  assert.equal(traits.pointeurs, "none", "la couche de traits ne doit rien intercepter");

  for (const [i, d] of traits.details.entries()) {
    // ⚠️ FIN : un trait de plus d'un pixel deviendrait un motif, pas un lien.
    assert.ok(d.epaisseur <= 1.5, `le trait ${i + 1} fait ${d.epaisseur} px d'épaisseur`);
    // ⚠️ GRIS : il guide l'œil, il ne doit pas rivaliser avec les cartes.
    assert.ok(/gradient/.test(d.fond), `le trait ${i + 1} doit être un dégradé gris`);
    // ⚠️ SA LONGUEUR EST CELLE DU RAYON DE SA CARTE : il s'arrête exactement
    // sur elle, jamais avant, jamais au-delà.
    assert.ok(
      Math.abs(d.longueur - d.rayonCarte) <= 2,
      `le trait ${i + 1} mesure ${Math.round(d.longueur)} px pour une carte à ${Math.round(d.rayonCarte)} px du centre`,
    );
  }
  await page.context().close();
});

await new Promise<void>((ok) => serveur.close(() => ok()));
await navigateur.close();

console.log(`\nCaptures écrites dans scripts/tests/avis-google-render/captures/`);
console.log(`${réussis} réussis, ${échecs} échecs`);
if (échecs > 0) process.exit(1);
