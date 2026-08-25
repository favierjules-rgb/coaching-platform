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

  // Au moins une paire voisine doit se chevaucher horizontalement : sinon la
  // « pile » n'est qu'une rangée de cartes côte à côte.
  let recouvrements = 0;
  for (let i = 1; i < g.rects.length; i += 1) {
    if (g.rects[i].x < g.rects[i - 1].droite - 4) recouvrements += 1;
  }
  assert.ok(
    recouvrements >= 3,
    `les cartes doivent se recouvrir — seulement ${recouvrements} recouvrement(s) sur ${g.rects.length - 1}`,
  );

  // Et elles ne sont pas toutes à la même hauteur : le décalage vertical fait
  // partie de la composition.
  const y = new Set(g.rects.map((r) => Math.round(r.y)));
  assert.ok(y.size >= 2, "les cartes doivent être décalées verticalement");
  await page.context().close();
});

await test("R3 — mobile : pile VERTICALE, chaque carte pleine largeur", async () => {
  const page = await atelier({ width: 390, height: 844 }, { tactile: true });
  const g = await geometrie(page);

  // Chaque carte commence sous la précédente : sur un pouce, on lit, on ne
  // devine pas.
  for (let i = 1; i < g.rects.length; i += 1) {
    assert.ok(
      g.rects[i].y > g.rects[i - 1].y,
      `mobile : la carte ${i + 1} doit être SOUS la carte ${i}`,
    );
  }
  // Et aucune n'est plus étroite que l'écran moins ses marges.
  for (const [i, r] of g.rects.entries()) {
    assert.ok(r.w >= 300, `mobile : la carte ${i + 1} ne fait que ${Math.round(r.w)} px de large`);
  }
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

  // La carte qui SUIT la carte mise en avant doit s'être écartée vers la
  // droite : c'est le « les cartes voisines se déplacent légèrement ».
  // L'écartement est une marge posée sur le `<li>` : on mesure donc l'hôte,
  // pas la carte (dont la position dépend en plus de sa propre rotation).
  const deplacement = apres.hotes[3].x - avant.hotes[3].x;
  assert.ok(
    deplacement > 2,
    `la voisine de droite doit s'écarter — déplacement mesuré : ${Math.round(deplacement)} px`,
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

  // LA PROPRIÉTÉ RÉELLE : les hauteurs DIFFÈRENT. Si les cartes s'étiraient,
  // elles sortiraient toutes à la même hauteur, et cet ensemble aurait un
  // seul élément.
  assert.ok(
    new Set(hauteurs).size >= 3,
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

await test("R8 — le texte n'est jamais tronqué, quelle que soit sa longueur", async () => {
  const page = await atelier({ width: 1440, height: 900 });
  const debordements = await page.evaluate(() =>
    [...document.querySelectorAll<HTMLElement>("[data-avis-pile] .avis-texte")].map((p, i) => ({
      i,
      // Un texte coupé a un contenu plus haut que sa boîte.
      coupe: p.scrollHeight > p.clientHeight + 1,
      clamp: getComputedStyle(p).webkitLineClamp,
      overflow: getComputedStyle(p).overflow,
    })),
  );
  for (const d of debordements) {
    assert.ok(!d.coupe, `le texte de la carte ${d.i + 1} est tronqué`);
    assert.ok(
      d.clamp === "none" || d.clamp === "" || d.clamp === "auto",
      `la carte ${d.i + 1} porte un line-clamp (${d.clamp})`,
    );
  }
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

await test("R12 — le bandeau de démonstration est VISIBLE à l'écran", async () => {
  const page = await atelier({ width: 1440, height: 900 });
  const bandeau = await page.evaluate(() => {
    const e = document.querySelector<HTMLElement>("[data-avis-demonstration]");
    if (!e) return null;
    const r = e.getBoundingClientRect();
    const s = getComputedStyle(e);
    return {
      texte: (e.textContent ?? "").trim(),
      largeur: r.width,
      hauteur: r.height,
      opacite: Number(s.opacity),
      affichage: s.display,
    };
  });
  assert.ok(bandeau, "le bandeau doit être présent");
  assert.ok(/démonstration/i.test(bandeau.texte), "il dit qu'il s'agit d'une démonstration");
  assert.ok(/pas de vrais avis/i.test(bandeau.texte), "et le dit sans ambiguïté");
  // Présent dans le DOM ne suffit pas : il doit être PEINT.
  assert.ok(bandeau.largeur > 100 && bandeau.hauteur > 10, "il occupe une place réelle à l'écran");
  assert.equal(bandeau.opacite, 1, "il n'est pas atténué");
  assert.notEqual(bandeau.affichage, "none", "il n'est pas masqué");
  await page.context().close();
});

await new Promise<void>((ok) => serveur.close(() => ok()));
await navigateur.close();

console.log(`\nCaptures écrites dans scripts/tests/avis-google-render/captures/`);
console.log(`${réussis} réussis, ${échecs} échecs`);
if (échecs > 0) process.exit(1);
