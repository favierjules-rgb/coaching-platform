process.env.TZ = "Europe/Paris";

/**
 * Harnais — LE LOADER AUX ANNEAUX.
 *
 * ════════════════════════════════════════════════════════════════════════
 * CE QUE CETTE SUITE PROTÈGE
 * ════════════════════════════════════════════════════════════════════════
 *   • que la géométrie vienne de `brand/loading.json` et LUI CORRESPONDE
 *     ENCORE — ce harnais relit le fichier de marque et recalcule tout ;
 *   • que l'ease du fichier soit conservée (dérogation VERROUILLÉE, voir 4) ;
 *   • que la période du battement reste dans la fenêtre 1–2 s ;
 *   • que les deux couleurs restent lisibles sur LEUR fond, dans les deux
 *     thèmes — un indicateur illisible n'indique rien ;
 *   • que la densité suive la taille : cinq anneaux en pleine page, deux dans
 *     un bloc, un seul en ligne de texte ;
 *   • qu'il s'annonce aux lecteurs d'écran — une attente silencieuse pour qui
 *     ne voit pas l'écran ressemble à une page cassée ;
 *   • que son battement se coupe sous `prefers-reduced-motion` SANS que le
 *     motif disparaisse ;
 *   • qu'il couvre réellement la navigation, via le `loading.tsx` racine.
 *
 * ⚠️ CE HARNAIS A CHANGÉ DE CONTRAT LE 14/09/2026. Il protégeait l'emblème
 * SETH (`DoubleStar`) comme motif d'attente ; le motif est désormais celui de
 * `brand/loading.json`. C'est une décision de marque, pas une régression —
 * et `DoubleStar` reste l'emblème du site, utilisé ailleurs.
 *
 * Lancement : npx tsx scripts/tests/loader-marque.mts
 */
import assert from "node:assert/strict";
import { existsSync, readdirSync, readFileSync } from "node:fs";

import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";

import { Loader } from "../../components/ui/Loader";
import {
  CYCLE_MS,
  DECALAGE_ANNEAU_MS,
  DENSITE_COMPLETE,
  DENSITE_MINIMALE,
  DENSITE_REDUITE,
} from "../../lib/loader-anneaux";

let réussis = 0;
let échecs = 0;

function test(nom: string, fn: () => void | Promise<void>) {
  return Promise.resolve()
    .then(fn)
    .then(() => {
      réussis += 1;
      console.log(`ok - ${nom}`);
    })
    .catch((erreur) => {
      échecs += 1;
      console.error(`ÉCHEC - ${nom}`);
      console.error(erreur);
    });
}

function lire(chemin: string): string {
  return readFileSync(new URL(chemin, import.meta.url), "utf8");
}
function sansCommentaires(source: string): string {
  return source.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "");
}

const LOADER = lire("../../components/ui/Loader.tsx");
const DESSIN = lire("../../components/ui/AnneauxDeChargement.tsx");
const GEOMETRIE = lire("../../lib/loader-anneaux.ts");
const CHARGEMENT = lire("../../app/loading.tsx");
const CSS = lire("../../app/globals.css");
/*
 * ⚠️ LE BLOC EST BORNÉ DES DEUX CÔTÉS, ET CE N'EST PAS DE LA COQUETTERIE.
 *
 * Une première version découpait du repère jusqu'à la FIN du fichier : la
 * recherche « le loader ne disparaît jamais » tombait alors sur un
 * `display: none` appartenant à un tout autre bloc, et rougissait pour une
 * règle qui n'est pas la sienne. On mesure ce qu'on croit mesurer.
 */
const DEBUT_BLOC = CSS.lastIndexOf("/*", CSS.indexOf("LOADER — components/ui/Loader.tsx"));
const FIN_BLOC = CSS.indexOf("@keyframes double-star-allumage", DEBUT_BLOC);
if (DEBUT_BLOC < 0 || FIN_BLOC < 0) throw new Error("bloc CSS du loader introuvable");
const BLOC = CSS.slice(DEBUT_BLOC, CSS.lastIndexOf("/*", FIN_BLOC));
const REGLES = BLOC.replace(/\/\*[\s\S]*?\*\//g, "");

/* ═══════════════ 0-3. LA SOURCE DE VÉRITÉ ═══════════════ */

/**
 * ⚠️ LE FICHIER DE MARQUE EST RELU, PAS PARAPHRASÉ.
 *
 * `lib/loader-anneaux.ts` contient des nombres. Des nombres recopiés à la
 * main finissent toujours par diverger de leur original — c'est exactement
 * ce que l'ancien harnais empêchait pour les tracés du logo, et il n'y a
 * aucune raison d'être plus laxiste ici. On rouvre donc `brand/loading.json`
 * et on RECALCULE tout ce que le module prétend en avoir tiré.
 */
interface AnneauReleve {
  points: number;
  rayon: number;
  phase: number;
  diametres: number[];
  ecartAngulaire: number;
  arc: number;
  decalageMs: number;
}

function releverLeFichierDeMarque(): {
  anneaux: AnneauReleve[];
  cycleMs: number;
  easeLottie: [number, number, number, number];
  couleurs: string[];
} {
  const lottie = JSON.parse(lire("../../brand/loading.json")) as {
    fr: number;
    op: number;
    w: number;
    h: number;
    layers: { st: number; shapes: unknown[] }[];
  };
  const centre = lottie.w / 2;
  const anneaux: AnneauReleve[] = [];
  const couleurs = new Set<string>();
  let easeLottie: [number, number, number, number] | null = null;

  for (const calque of lottie.layers) {
    const groupes = (calque.shapes as Record<string, unknown>[]).filter((f) => f.ty === "gr");
    const points: { angle: number; rayon: number; diametre: number }[] = [];
    for (const groupe of groupes) {
      const items = groupe.it as Record<string, unknown>[];
      const trace = items.find((i) => i.ty === "sh") as
        | { ks: { k: { v: [number, number][] } } }
        | undefined;
      const transfo = items.find((i) => i.ty === "tr") as { p: { k: [number, number] } } | undefined;
      const remplissage = items.find((i) => i.ty === "fl") as
        | { c: { k: { t: number; s: number[] }[] | number[] } }
        | undefined;
      // Les groupes SANS tracé (« Group 41 » et « Group 42 ») sont des coquilles
      // vides du fichier d'origine : deux remplissages, une transformation,
      // rien à dessiner. Elles n'entrent pas dans la géométrie.
      if (!trace || !transfo) continue;
      const [x, y] = transfo.p.k;
      const sommets = trace.ks.k.v;
      const largeur = Math.max(...sommets.map((v) => v[0])) - Math.min(...sommets.map((v) => v[0]));
      const hauteur = Math.max(...sommets.map((v) => v[1])) - Math.min(...sommets.map((v) => v[1]));
      points.push({
        angle: ((Math.atan2(y - centre, x - centre) * 180) / Math.PI + 360) % 360,
        rayon: Math.hypot(x - centre, y - centre),
        diametre: (largeur + hauteur) / 2,
      });
      const cles = remplissage?.c.k;
      if (Array.isArray(cles) && typeof cles[0] === "object") {
        for (const cle of cles as { t: number; s: number[] }[]) {
          couleurs.add(cle.s.slice(0, 3).map((v) => Math.round(v * 255)).join(","));
        }
        const premiere = (cles as { i?: { x: number[]; y: number[] }; o?: { x: number[]; y: number[] } }[])[0];
        if (!easeLottie && premiere.i && premiere.o) {
          easeLottie = [premiere.o.x[0], premiere.o.y[0], premiere.i.x[0], premiere.i.y[0]];
        }
      }
    }
    points.sort((a, b) => a.angle - b.angle);
    const pas = 360 / points.length;
    const phase = points[0].angle;
    anneaux.push({
      points: points.length,
      rayon: Math.round(points[0].rayon),
      phase: Number(phase.toFixed(3)),
      diametres: points.map((p) => Number(p.diametre.toFixed(2))),
      ecartAngulaire: Math.max(
        ...points.map((p, i) => Math.abs(((p.angle - (phase + i * pas) + 180) % 360) - 180)),
      ),
      arc: (2 * Math.PI * points[0].rayon) / points.length,
      decalageMs: (-calque.st / lottie.fr) * 1000,
    });
  }

  return {
    anneaux,
    cycleMs: Math.round((lottie.op / lottie.fr) * 1000),
    easeLottie: easeLottie ?? [0, 0, 1, 1],
    couleurs: [...couleurs],
  };
}

const MARQUE = releverLeFichierDeMarque();

await test("0. la géométrie du module CORRESPOND au fichier de marque", () => {
  assert.equal(
    DENSITE_COMPLETE.anneaux.length,
    MARQUE.anneaux.length,
    "le motif complet doit avoir autant d'anneaux que le fichier",
  );
  MARQUE.anneaux.forEach((releve, i) => {
    // `module` est un nom réservé côté Next.js (no-assign-module-variable).
    const declare = DENSITE_COMPLETE.anneaux[i];
    const ou = `anneau ${i + 1}`;
    assert.equal(declare.points, releve.points, `${ou} : nombre de points`);
    assert.equal(declare.rayon, releve.rayon, `${ou} : rayon`);
    // Tolérance de lecture : l'outil de relevé et JS n'arrondissent pas
    // identiquement au millième. On compare des mesures, pas des chaînes.
    assert.ok(
      Math.abs(declare.phase - releve.phase) < 0.002,
      `${ou} : angle du premier point — module ${declare.phase}, fichier ${releve.phase}`,
    );
    assert.equal(declare.diametres.length, releve.diametres.length, `${ou} : un diamètre par point`);
    releve.diametres.forEach((diametre, j) => {
      assert.ok(
        Math.abs(declare.diametres[j] - diametre) < 0.02,
        `${ou}, point ${j + 1} : diamètre ${declare.diametres[j]} au lieu de ${diametre}`,
      );
    });
  });
  assert.equal(DENSITE_COMPLETE.boite, 1080, "le canevas est celui du fichier");
  assert.equal(CYCLE_MS, MARQUE.cycleMs, "durée du cycle");
  /*
   * Le décalage est CONSTANT d'un anneau au suivant — c'est ce qui fait la
   * vague. On vérifie les quatre écarts, pas seulement le premier.
   */
  MARQUE.anneaux.slice(1).forEach((releve, i) => {
    const attendu = DECALAGE_ANNEAU_MS * (i + 1);
    assert.ok(
      Math.abs(releve.decalageMs - attendu) < 1,
      `anneau ${i + 2} : décalage ${releve.decalageMs.toFixed(1)} ms, module ${attendu.toFixed(1)} ms`,
    );
  });
  /*
   * ⚠️ ET LES DEUX COULEURS DU FICHIER SONT CELLES SUR LESQUELLES LA PALETTE
   * A ÉTÉ CALIBRÉE (voir 6bis). Si le fichier de marque change de couleurs un
   * jour, les jetons de globals.css devront être recalculés — ce test le dira
   * avant que quelqu'un ne s'en aperçoive à l'œil.
   */
  assert.deepEqual(
    [...MARQUE.couleurs].sort(),
    ["161,173,183", "46,3,229"].sort(),
    "les couleurs du fichier ne sont plus #A1ADB7 et #2E03E5 — recalibrer la palette",
  );
});

await test("0bis. la règle de composition du fichier est respectée par TOUTES les densités", () => {
  /*
   * ⚠️ ÉCART CONSTANT ENTRE POINTS VOISINS, DIAMÈTRE QUI CROÎT VERS
   * L'EXTÉRIEUR. Dans le fichier, 2πr/n vaut 78,54 sur les cinq anneaux : le
   * nombre de points croît exactement comme le rayon. C'est la règle qui rend
   * le motif lisible ; un anneau ajouté sans elle se verrait immédiatement.
   */
  const arcs = MARQUE.anneaux.map((a) => a.arc);
  assert.ok(
    Math.max(...arcs) - Math.min(...arcs) < 0.01,
    `écart entre points non constant dans le fichier : ${arcs.map((a) => a.toFixed(2)).join(", ")}`,
  );
  for (const anneau of MARQUE.anneaux) {
    assert.ok(anneau.ecartAngulaire < 0.01, "les points d'un anneau sont régulièrement espacés");
  }

  for (const [nom, densite] of [
    ["complète", DENSITE_COMPLETE],
    ["réduite", DENSITE_REDUITE],
    ["minimale", DENSITE_MINIMALE],
  ] as const) {
    const mesures = densite.anneaux.map((a) => (2 * Math.PI * a.rayon) / a.points);
    assert.ok(
      Math.max(...mesures) - Math.min(...mesures) < 0.2,
      `densité ${nom} : écart entre points non constant (${mesures.map((m) => m.toFixed(2)).join(", ")})`,
    );
    densite.anneaux.slice(1).forEach((anneau, i) => {
      assert.ok(
        Math.max(...anneau.diametres) >= Math.max(...densite.anneaux[i].diametres),
        `densité ${nom} : le diamètre doit croître vers l'extérieur`,
      );
    });
    // Rien ne doit déborder du viewBox.
    const dehors = densite.anneaux.find(
      (a) => a.rayon + Math.max(...a.diametres) / 2 > densite.boite / 2,
    );
    assert.ok(!dehors, `densité ${nom} : un anneau sort du canevas`);
  }
});

await test("1. le loader ne redessine rien : il monte le motif, il ne le trace pas", () => {
  const loader = sansCommentaires(LOADER);
  assert.ok(loader.includes("AnneauxDeChargement"), "le loader monte le composant de dessin");
  /*
   * ⚠️ AUCUN TRACÉ, AUCUNE COORDONNÉE. Un `<circle cx="…">` écrit à la main
   * serait un second exemplaire du motif, condamné à diverger du fichier de
   * marque le jour où celui-ci bougera. Le motif vit à UN seul endroit.
   */
  assert.ok(!/<svg|<path|<circle/.test(loader), "aucun SVG en dur dans le loader");
  // Ni image distante : le loader doit s'afficher avant tout réseau.
  assert.ok(!/<img|next\/image/.test(loader), "aucune image à charger — un loader ne s'attend pas lui-même");

  const dessin = sansCommentaires(DESSIN);
  assert.ok(dessin.includes("disquesDeLAnneau"), "le dessin dérive ses disques du module de géométrie");
  assert.ok(
    !/cx="[\d.]|cy="[\d.]|r="[\d.]/.test(dessin),
    "aucune coordonnée écrite en dur dans le composant de dessin",
  );
  /*
   * ⚠️ NI STYLE EN LIGNE. Les décalages des anneaux vivent dans le CSS, visés
   * par leur rang : un `style={{ animationDelay }}` calculé au rendu rendrait
   * le décalage invisible à la relecture du CSS et impossible à vérifier ici.
   */
  assert.ok(!/style=\{/.test(dessin), "aucun style en ligne : l'animation est entièrement en CSS");

  const geometrie = sansCommentaires(GEOMETRIE);
  assert.ok(
    !/Math\.random|Date\.now/.test(geometrie),
    "la géométrie est mesurée, jamais générée au hasard",
  );
});

await test("2. il s'annonce aux lecteurs d'écran", () => {
  const html = renderToStaticMarkup(createElement(Loader, { libelle: "Chargement des essais…" }));
  assert.ok(/role="status"/.test(html), "le loader porte role=status");
  assert.ok(/aria-live="polite"/.test(html), "et une région vivante polie");
  assert.ok(html.includes("Chargement des essais…"), "le libellé est rendu");
  assert.ok(/sr-only/.test(html), "le libellé est réservé aux lecteurs d'écran");
  // ⚠️ LE MOTIF EST DÉCORATIF : c'est le libellé qui porte l'information.
  assert.ok(/aria-hidden/.test(html), "le motif ne double pas le libellé");
});

await test("3. le libellé par défaut existe, et peut être précisé", () => {
  const parDefaut = renderToStaticMarkup(createElement(Loader, {}));
  assert.ok(/Chargement/.test(parDefaut), "un libellé par défaut est toujours rendu");
  const precis = renderToStaticMarkup(createElement(Loader, { libelle: "Chargement des programmes…" }));
  assert.ok(precis.includes("Chargement des programmes…"), "un libellé précis remplace le défaut");
});

/* ═══════════════ 4-6ter. L'ANIMATION ═══════════════ */

await test("4. L'EASE DU FICHIER EST VERROUILLÉE — dérogation assumée à la règle `linear`", () => {
  /*
   * ════════════════════════════════════════════════════════════════════════
   * POURQUOI CE TEST EXISTE, ET CE QU'IL EMPÊCHE
   * ════════════════════════════════════════════════════════════════════════
   * La règle de la maison veut qu'une boucle PERPÉTUELLE se joue à vitesse
   * constante (`.agents/skills/review-animations/STANDARDS.md`, « Constant
   * motion ») : un mouvement qui accélère et ralentit attrape l'œil bien plus
   * qu'un indicateur ne le doit. Ce loader y DÉROGE, et c'est une décision
   * prise le 14/09/2026 :
   *
   *   la règle vise une ROTATION ou un DÉPLACEMENT ; ici le mouvement est une
   *   PULSATION, le motif ne se déplace pas d'un pixel, et la fidélité au
   *   loader de marque prime. En `linear` on obtiendrait un clignotement
   *   mécanique là où le fichier donne un souffle. La période du battement,
   *   elle, reste conforme à la règle des 1–2 s (voir 5).
   *
   * Ce test verrouille la dérogation DANS LES DEUX SENS : personne ne peut la
   * supprimer en repassant à `linear` lors d'une évolution future, et
   * personne ne peut la remplacer par une autre courbe — la seule valeur
   * admise est celle que porte `brand/loading.json`, RELUE ici et non
   * recopiée. Si le fichier de marque change d'ease un jour, c'est le CSS qui
   * devra suivre, pas ce test.
   */
  const [ox, oy, ix, iy] = MARQUE.easeLottie;
  const attendue = `cubic-bezier(${ox}, ${oy}, ${ix}, ${iy})`;
  assert.equal(
    attendue,
    "cubic-bezier(0.333, 0, 0.667, 1)",
    "l'ease relue dans brand/loading.json n'est plus celle attendue",
  );

  const courbes = [...REGLES.matchAll(/animation:[\s\S]*?;/g)]
    .flatMap((bloc) => [...bloc[0].matchAll(/cubic-bezier\([^)]*\)/g)])
    .map((m) => m[0].replace(/\s+/g, " "));
  assert.equal(courbes.length, 2, "les deux animations du motif portent une courbe explicite");
  for (const courbe of courbes) {
    assert.equal(courbe, attendue, "la courbe du CSS doit être celle du fichier de marque");
  }
  assert.ok(
    !/animation:[^;]*\blinear\b/.test(REGLES),
    "l'ease d'origine a été remplacée par `linear` — c'est précisément ce que cette dérogation interdit",
  );
  /*
   * ⚠️ ET LA DÉROGATION DOIT RESTER EXPLIQUÉE. Une dérogation non documentée
   * se lit comme un oubli, et le prochain lecteur la « corrigera ».
   */
  assert.ok(
    /DÉROGATION ASSUMÉE/.test(BLOC) && /linear/.test(BLOC),
    "le CSS doit dire, en toutes lettres, qu'il déroge à la règle `linear` et pourquoi",
  );
});

await test("5. la période du BATTEMENT reste dans la fenêtre 1–2 s", () => {
  /*
   * ⚠️ ON MESURE LE BATTEMENT, PAS LE CYCLE — et la distinction n'est pas de
   * la coquetterie. Le cycle dure 3,033 s, ce qui semble hors de la fenêtre
   * de 1 à 2 s exigée d'un indicateur. Mais il contient DEUX pulsations : ce
   * que l'œil voit, c'est un battement toutes les ~1,52 s, et c'est cette
   * période-là que la règle vise (« assez lent pour ne pas s'agiter, assez
   * rapide pour qu'on lise ça travaille et non c'est figé »).
   *
   * Le nombre de pulsations est COMPTÉ dans les keyframes, jamais supposé :
   * passer le motif à une seule pulsation par cycle le ferait battre toutes
   * les 3 s, et ce test doit rougir ce jour-là.
   */
  const souffle = /@keyframes seth-loader-souffle\s*\{([\s\S]*?)\n\}/.exec(CSS);
  assert.ok(souffle, "le souffle est déclaré");
  const echelles = [...souffle![1].matchAll(/scale\(([\d.]+)\)/g)].map((m) => Number(m[1]));
  const repos = Math.min(...echelles);
  const pulsations = echelles.filter((e) => e > repos).length;
  assert.ok(pulsations >= 1, "le motif doit pulser au moins une fois par cycle");

  const duree = /animation:\s*seth-loader-souffle\s+(\d+)ms/.exec(REGLES);
  assert.ok(duree, "la durée du souffle doit être lisible");
  assert.equal(Number(duree![1]), CYCLE_MS, "la durée du CSS est celle du fichier de marque");

  const battement = Number(duree![1]) / pulsations;
  assert.ok(
    battement >= 1000 && battement <= 2000,
    `un battement toutes les ${Math.round(battement)} ms — la fenêtre est 1000 à 2000 ms`,
  );
});

await test("5bis. les deux battements sont DÉPHASÉS, et les anneaux décalés", () => {
  /*
   * Échelle et couleur culminent à des instants différents (images 13,0 et
   * 58,0 pour l'une, 31 et 75 pour l'autre) : c'est ce décalage qui donne le
   * relief. Les aligner aplatirait le motif.
   */
  const sommets = (keyframes: string, cible: string) =>
    [...keyframes.matchAll(/([\d.]+)%\s*\{\s*([^}]*)\}/g)]
      .filter((k) => k[2].includes(cible))
      .map((k) => Number(k[1]));
  const souffle = /@keyframes seth-loader-souffle\s*\{([\s\S]*?)\n\}/.exec(CSS)![1];
  const eclat = /@keyframes seth-loader-eclat\s*\{([\s\S]*?)\n\}/.exec(CSS)![1];
  const sommetsEchelle = sommets(souffle, "scale(0.9)");
  const sommetsCouleur = sommets(eclat, "--loader-vive");
  assert.ok(sommetsEchelle.length > 0 && sommetsCouleur.length > 0, "les deux sommets sont lisibles");
  for (const e of sommetsEchelle) {
    for (const c of sommetsCouleur) {
      assert.ok(
        Math.abs(e - c) > 5,
        `échelle et couleur culminent presque ensemble (${e}% et ${c}%) — le motif s'aplatit`,
      );
    }
  }

  /*
   * ⚠️ ET LES ANNEAUX SONT DÉCALÉS ENTRE EUX, sinon il n'y a plus de vague :
   * les cinq anneaux pulseraient à l'unisson. Les décalages sont NÉGATIFS —
   * l'anneau extérieur est en avance, la vague va vers le centre.
   */
  const decalages = [...REGLES.matchAll(/nth-of-type\((\d)\)\s*\{\s*animation-delay:\s*(-?[\d.]+)ms/g)].map(
    (m) => ({ rang: Number(m[1]), ms: Number(m[2]) }),
  );
  assert.equal(decalages.length, 4, "les anneaux 2 à 5 portent chacun leur décalage");
  for (const { rang, ms } of decalages) {
    const attendu = -DECALAGE_ANNEAU_MS * (rang - 1);
    assert.ok(
      Math.abs(ms - attendu) < 1,
      `anneau ${rang} : décalage ${ms} ms, attendu ${attendu.toFixed(1)} ms`,
    );
    assert.ok(ms < 0, "le décalage doit être négatif — la vague part de l'extérieur");
  }
});

await test("6. sous mouvement réduit, le battement part — PAS le signal", () => {
  const calme = BLOC.slice(BLOC.indexOf("@media (prefers-reduced-motion: reduce)"));
  assert.ok(calme.length > 0, "le garde de mouvement réduit existe");
  assert.ok(/animation:\s*none/.test(calme), "le battement est coupé");
  /*
   * ⚠️ ET LE MOTIF RESTE VISIBLE. Les deux animations jouent sur l'échelle ET
   * sur la couleur : coupées sans rien remettre, les anneaux resteraient à
   * l'échelle 1 (débordant du canevas) et sans couleur propre. L'utilisateur
   * ne saurait plus que quelque chose charge.
   */
  assert.ok(/transform:\s*scale\([\d.]+\)/.test(calme), "une échelle de repos est posée");
  assert.ok(/color:\s*var\(--loader-repos\)/.test(calme), "une couleur de repos est posée");
  assert.ok(!/display:\s*none|visibility:\s*hidden/.test(calme), "le loader ne disparaît jamais");
});

await test("6bis. les deux couleurs restent LISIBLES sur leur fond, dans les deux thèmes", () => {
  /*
   * ⚠️ AUCUNE DES DEUX COULEURS DU FICHIER NE PASSE SUR LES DEUX FONDS.
   *
   * Mesuré : le violet #2E03E5 donne 2,19:1 sur le fond sombre (#050505), et
   * la pâle #A1ADB7 donne 2,08:1 sur le fond clair (#f4f4f2). Les deux sont
   * sous le plancher de 3:1 que la WCAG 1.4.11 demande à un objet graphique
   * porteur de sens — et un indicateur de chargement en est un : s'il ne se
   * voit pas, la page a l'air cassée.
   *
   * Chaque thème garde donc UNE des deux couleurs d'origine intacte et ne
   * corrige l'autre qu'à hauteur du plancher. Ce test relit les jetons dans
   * `globals.css` et refait le calcul : personne ne peut « revenir aux vraies
   * couleurs » sans le voir rougir.
   */
  const PLANCHER = 3;
  const canal = (v: number) => (v <= 0.04045 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4);
  const luminance = (hex: string) => {
    const n = hex.replace("#", "");
    const [r, v, b] = [0, 2, 4].map((i) => canal(parseInt(n.slice(i, i + 2), 16) / 255));
    return 0.2126 * r + 0.7152 * v + 0.0722 * b;
  };
  const contraste = (a: string, b: string) => {
    const [x, y] = [luminance(a), luminance(b)].sort((p, q) => q - p);
    return (x + 0.05) / (y + 0.05);
  };
  const jeton = (palette: string, nom: string) => {
    const depuis = CSS.slice(CSS.indexOf(palette));
    const bloc = depuis.slice(0, depuis.indexOf("\n}"));
    const trouve = new RegExp(`${nom}:\\s*(#[0-9a-fA-F]{6})`).exec(bloc);
    assert.ok(trouve, `${nom} introuvable dans la palette ouverte par « ${palette} »`);
    return trouve![1];
  };

  const palettes = [
    { nom: "sombre", ouvre: ":root {" },
    { nom: "clair", ouvre: '[data-page-theme="light"] {' },
  ];
  for (const { nom, ouvre } of palettes) {
    const fond = jeton(ouvre, "--background");
    for (const couleur of ["--loader-vive", "--loader-pale", "--loader-repos"]) {
      const valeur = jeton(ouvre, couleur);
      const ratio = contraste(valeur, fond);
      assert.ok(
        ratio >= PLANCHER,
        `thème ${nom} : ${couleur} (${valeur}) donne ${ratio.toFixed(2)}:1 sur ${fond} — plancher ${PLANCHER}:1`,
      );
    }
    /*
     * ⚠️ ET LES DEUX ÉTATS DOIVENT RESTER DISTINCTS. Deux couleurs qui passent
     * chacune le plancher mais se ressemblent produiraient un motif qui ne
     * pulse plus visiblement.
     */
    const ecart = contraste(jeton(ouvre, "--loader-vive"), jeton(ouvre, "--loader-pale"));
    assert.ok(ecart >= 1.5, `thème ${nom} : les deux états ne se distinguent pas (${ecart.toFixed(2)}:1)`);
  }
});

await test("6ter. la DENSITÉ suit la taille — trois variantes, trois motifs", () => {
  /*
   * ⚠️ C'EST LE CŒUR DU CHANTIER, ET C'EST CONTRE-INTUITIF. Le motif complet
   * compte 120 points sur un canevas de 1080 : rendu à 28 px — la taille des
   * attentes de section avant ce chantier — chaque point mesurerait moins
   * d'un pixel. Rétrécir ce dessin, c'est le détruire.
   *
   * On ne rétrécit donc pas, on réduit la DENSITÉ. Ce test échoue si une
   * variante récupère un motif trop dense pour sa taille.
   */
  const compter = (variante: "plein" | "ligne" | "inline") => {
    const html = renderToStaticMarkup(createElement(Loader, { variante }));
    return {
      anneaux: (html.match(/class="seth-loader-anneau"/g) ?? []).length,
      disques: (html.match(/<circle/g) ?? []).length,
    };
  };
  const plein = compter("plein");
  const ligne = compter("ligne");
  const inline = compter("inline");

  assert.equal(plein.anneaux, DENSITE_COMPLETE.anneaux.length, "pleine page : le motif complet");
  assert.equal(plein.disques, 120, "pleine page : les 120 points du fichier");
  assert.equal(ligne.anneaux, DENSITE_REDUITE.anneaux.length, "bloc : motif réduit");
  assert.equal(inline.anneaux, DENSITE_MINIMALE.anneaux.length, "ligne de texte : motif minimal");
  assert.ok(
    plein.anneaux > ligne.anneaux && ligne.anneaux > inline.anneaux,
    "la densité doit décroître strictement avec la taille",
  );

  /*
   * ⚠️ ET LA TAILLE RENDUE DOIT SUIVRE. Un point doit mesurer au moins 3 px
   * pour être un point ; en dessous, c'est une bouillie grise. On vérifie que
   * chaque variante tient ce plancher à la largeur que lui donne le CSS.
   */
  const largeur = (selecteur: string) => {
    const regle = new RegExp(
      `${selecteur}\\s+\\.seth-loader-anneaux\\s*\\{[^}]*width:\\s*([\\d.]+)(rem|em)`,
    ).exec(REGLES);
    assert.ok(regle, `largeur introuvable pour ${selecteur}`);
    return Number(regle![1]) * 16;
  };
  const plancher = [
    { selecteur: "\\.seth-loader-plein", densite: DENSITE_COMPLETE },
    { selecteur: "\\.seth-loader-ligne", densite: DENSITE_REDUITE },
    { selecteur: "\\.seth-loader-inline", densite: DENSITE_MINIMALE },
  ];
  for (const { selecteur, densite } of plancher) {
    const px = largeur(selecteur);
    const plusPetit = Math.min(...densite.anneaux.flatMap((a) => [...a.diametres]));
    const rendu = (plusPetit / densite.boite) * px;
    assert.ok(
      rendu >= 3,
      `${selecteur} : le plus petit point ferait ${rendu.toFixed(2)} px à ${px} px de large — plancher 3 px`,
    );
  }
});

/* ═══════════════ 7-9. LA COUVERTURE ═══════════════ */

await test("7. le loader racine couvre la navigation", () => {
  assert.ok(existsSync(new URL("../../app/loading.tsx", import.meta.url)), "app/loading.tsx existe");
  const code = sansCommentaires(CHARGEMENT);
  assert.ok(code.includes("Loader"), "il monte le loader partagé");
  assert.ok(/export default function/.test(code), "et suit la convention Next.js");
});

await test("8. les états de chargement existants portent le même motif", () => {
  /*
   * ⚠️ UN SEUL SIGNAL SUR TOUT LE SITE. `/programmes` garde son squelette —
   * dessiner la forme du contenu attendu vaut mieux qu'un indicateur seul
   * quand on connaît cette forme — mais il doit montrer le MÊME motif,
   * sinon l'attente ne se reconnaît pas d'une page à l'autre.
   */
  const programmes = lire("../../app/programmes/loading.tsx");
  assert.ok(programmes.includes("Loader"), "/programmes affiche le motif lui aussi");
  assert.ok(
    !/role="status"[\s\S]{0,200}sr-only/.test(sansCommentaires(programmes)),
    "et ne double pas l'annonce du loader avec la sienne",
  );
});

await test("9. le loader ne dépend d'aucun état ni d'aucun réseau", () => {
  const code = sansCommentaires(LOADER);
  /*
   * Un indicateur de chargement qui aurait besoin d'être hydraté, ou d'aller
   * chercher quoi que ce soit, arriverait après ce qu'il annonce.
   */
  assert.ok(!/useState|useEffect|fetch\(/.test(code), "aucun état, aucun appel réseau");
  assert.ok(!/"use client"/.test(code), "composant serveur : il est rendu dans le HTML initial");
});

/* ═══════════ 10-14. LA COUVERTURE DE TOUTE L'APPLICATION ═══════════ */

/**
 * Tous les fichiers de l'interface, lus une fois.
 *
 * ⚠️ ON PARCOURT L'ARBORESCENCE PLUTÔT QUE D'ÉNUMÉRER DES CHEMINS. Une liste
 * écrite à la main vieillit : le fichier ajouté demain n'y serait pas, et le
 * test resterait vert en ne regardant rien.
 */
function fichiersInterface(): string[] {
  const trouves: string[] = [];
  const parcourir = (relatif: string) => {
    const dossier = new URL(relatif, import.meta.url);
    for (const entree of readdirSync(dossier, { withFileTypes: true })) {
      if (entree.name === "node_modules" || entree.name.startsWith(".")) continue;
      const chemin = `${relatif}${entree.name}`;
      if (entree.isDirectory()) parcourir(`${chemin}/`);
      else if (entree.name.endsWith(".tsx")) trouves.push(chemin);
    }
  };
  parcourir("../../app/");
  parcourir("../../components/");
  return trouves;
}

const INTERFACE = fichiersInterface().map((chemin) => ({ chemin, code: lire(chemin) }));

await test("10. AUCUN écran d'attente ne rend un « Chargement… » NU", () => {
  /*
   * ⚠️ LE MOTIF EXACT QUI TRAÎNAIT PARTOUT. Une cinquantaine d'endroits
   * rendaient un simple paragraphe gris — sur la Preview, ça donnait un
   * « Chargement… » perdu au milieu d'une page vide, sans rapport avec le
   * reste du site.
   *
   * On cherche donc la BALISE TEXTUELLE, pas le mot : le mot reste légitime
   * dans un `libelle`, dans un nom de variable ou dans un commentaire.
   *
   * ⚠️ ET « NU » EST LE MOT QUI COMPTE. Sur une action courte, la phrase a le
   * droit de rester — elle explique ce qu'on attend au moment où c'est utile.
   * Ce qui est interdit, c'est qu'elle soit SEULE. Une première version de ce
   * test rougissait sur `AddFoodSheet`, où la phrase est pourtant précédée de
   * l'emblème : elle mesurait la présence du texte au lieu de mesurer
   * l'absence du signal.
   */
  const fautifs: string[] = [];
  for (const { chemin, code } of INTERFACE) {
    const propre = sansCommentaires(code);
    const motif = /<(p|div|span)\b[^>]*>\s*Chargement[^<]*<\/\1>/g;
    for (const trouve of propre.matchAll(motif)) {
      // L'emblème accompagne-t-il la phrase, dans le même parent ?
      const voisinage = propre.slice(Math.max(0, trouve.index - 400), trouve.index);
      const accompagne = /aria-hidden/.test(trouve[0]) && /<Loader\b/.test(voisinage);
      if (accompagne) continue;
      fautifs.push(`${chemin} → ${trouve[0].slice(0, 80).replace(/\s+/g, " ")}`);
    }
  }
  assert.deepEqual(
    fautifs,
    [],
    `${fautifs.length} écran(s) d'attente encore textuels :\n  ${fautifs.join("\n  ")}`,
  );
});

await test("11. les `loading.tsx` de l'application montent tous le Loader", () => {
  const chargements = INTERFACE.filter(({ chemin }) => chemin.endsWith("/loading.tsx"));
  assert.ok(chargements.length >= 2, `au moins deux loading.tsx — ${chargements.length}`);
  for (const { chemin, code } of chargements) {
    assert.ok(
      sansCommentaires(code).includes("<Loader"),
      `${chemin} doit monter le Loader partagé`,
    );
  }
});

await test("12. aucun fallback Suspense ne laisse un écran vide ou un texte nu", () => {
  /*
   * ⚠️ `fallback={null}` EST UN PIÈGE SILENCIEUX. La page ne montre rien
   * pendant que Next.js lit les paramètres d'URL — un blanc qu'on lit comme
   * une erreur, pas comme une attente. Aucun grep sur « Chargement » ne
   * l'aurait trouvé.
   */
  const fautifs: string[] = [];
  for (const { chemin, code } of INTERFACE) {
    const propre = sansCommentaires(code);
    if (/fallback=\{null\}/.test(propre)) fautifs.push(`${chemin} → fallback={null}`);
    for (const t of propre.matchAll(/fallback=\{?\s*<(p|div|span)\b[^>]*>\s*Chargement/g)) {
      fautifs.push(`${chemin} → ${t[0].slice(0, 60)}`);
    }
  }
  assert.deepEqual(fautifs, [], `fallbacks à corriger :\n  ${fautifs.join("\n  ")}`);
});

/**
 * Le nœud à la position donnée est-il DANS un bouton ?
 *
 * ⚠️ ON MESURE UNE CONTENANCE, PAS UNE RESSEMBLANCE. La première version de
 * ce test cherchait un `min-h-[…]` à moins de 400 caractères devant le
 * spinner, en pariant qu'une hauteur minimale trahissait un conteneur de
 * section. Elle a signalé dix boutons : `min-h-[44px]`, c'est la cible
 * tactile réglementaire, exactement ce qu'un bouton porte. L'heuristique
 * mesurait la taille du doigt, pas la nature de l'attente.
 */
function dansUnBouton(source: string, position: number): boolean {
  const avant = source.slice(0, position);
  const ouverture = Math.max(avant.lastIndexOf("<button"), avant.lastIndexOf("<Button"));
  if (ouverture < 0) return false;
  const fermeture = Math.max(avant.lastIndexOf("</button>"), avant.lastIndexOf("</Button>"));
  if (ouverture < fermeture) return false;
  // ⚠️ UN BOUTON AUTO-FERMANT NE CONTIENT RIEN. `<Button … />` suivi d'un
  // spinner : le spinner est son VOISIN. On lit la fin de la balise
  // ouvrante en ignorant les `/>` des icônes imbriquées dans ses accolades.
  let profondeur = 0;
  for (let i = ouverture; i < position; i += 1) {
    const c = source[i];
    if (c === "{") profondeur += 1;
    else if (c === "}") profondeur -= 1;
    else if (c === ">" && profondeur === 0) return source[i - 1] !== "/";
  }
  return true;
}

/*
 * ⚠️ UNE SEULE EXCEPTION, ÉCRITE ICI PLUTÔT QUE DEVINÉE PAR UNE RÈGLE.
 * `FoodSearchPicker` pose son spinner À L'INTÉRIEUR du champ de recherche,
 * en `absolute right-3` : c'est l'indicateur de frappe d'un champ, de la
 * même nature et de la même durée qu'un spinner de bouton. L'y remplacer
 * par l'emblème mettrait le logo du site dans une barre de recherche.
 *
 * Elle est nommée. Tout NOUVEAU spinner hors bouton fera rougir ce test.
 */
const SPINNERS_DE_CHAMP = new Set(["../../components/admin/FoodSearchPicker.tsx"]);

await test("13. il n'existe qu'UNE identité de chargement à l'échelle d'une section", () => {
  /*
   * ⚠️ IL EN EXISTAIT DEUX. Un `Loader2` de lucide tournait au milieu du
   * calendrier admin et de la page de remerciement : un cercle générique,
   * sans rapport avec la marque, là où une SECTION entière attend.
   *
   * Les `Loader2` restés DANS DES BOUTONS ne sont pas visés — ce sont des
   * actions courtes, et un emblème de 14 px dans un bouton se lit moins bien
   * qu'un rond qui tourne. La règle porte sur ce qui déborde du bouton.
   */
  const fautifs: string[] = [];
  for (const { chemin, code } of INTERFACE) {
    if (SPINNERS_DE_CHAMP.has(chemin)) continue;
    const propre = sansCommentaires(code);
    for (const t of propre.matchAll(/<Loader2\b/g)) {
      if (dansUnBouton(propre, t.index)) continue;
      const extrait = propre.slice(t.index, t.index + 60).replace(/\s+/g, " ");
      fautifs.push(`${chemin} → ${extrait}…`);
    }
  }
  assert.deepEqual(fautifs, [], `spinners hors bouton à remplacer :\n  ${fautifs.join("\n  ")}`);
});

await test("14. le motif d'attente n'est animé qu'à UN seul endroit", () => {
  /*
   * ⚠️ UNE SEULE IDENTITÉ EN MOUVEMENT DANS TOUT LE DÉPÔT.
   *
   *   `double-star-allumage` est l'allumage en cascade de l'EMBLÈME sur une
   *   carte de séance — il ne se joue qu'une fois, à l'apparition ;
   *   `seth-loader-souffle` et `seth-loader-eclat` sont les DEUX moitiés de
   *   la boucle d'attente : l'échelle et la couleur, volontairement
   *   déphasées (voir 5bis). Elles vont par paire et comptent pour une.
   *
   * Une quatrième signifierait qu'on a redessiné le mouvement quelque part —
   * et deux boucles d'attente concurrentes, c'est une attente qui ne se
   * reconnaît plus d'une page à l'autre.
   *
   * ⚠️ `seth-loader-battement` A DISPARU, ET C'EST VOULU : c'était la boucle
   * de l'emblème-loader, remplacée le 14/09/2026 par le motif de
   * `brand/loading.json`. Sa réapparition signalerait une résurrection
   * partielle de l'ancien loader.
   */
  const animations = [...CSS.matchAll(/@keyframes\s+([\w-]+)/g)].map((m) => m[1]);
  const identite = animations.filter((n) => /star|loader/.test(n));
  assert.deepEqual(
    identite.sort(),
    ["double-star-allumage", "seth-loader-eclat", "seth-loader-souffle"],
    `animations d'identité inattendues : ${identite.join(", ")}`,
  );
});

console.log(`\n${réussis} réussis, ${échecs} échecs`);
if (échecs > 0) process.exit(1);
