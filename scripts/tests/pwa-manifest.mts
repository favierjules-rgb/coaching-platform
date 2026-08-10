import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

import type { MetadataRoute } from "next";

// C'est le module RÉEL qui est chargé — celui que Next.js sert —, pas une
// copie de ses valeurs.
import * as moduleManifeste from "../../app/manifest";
import { exportDefaut } from "./helpers/export-defaut";
import { lirePng } from "./helpers/png";

const manifest = exportDefaut<() => MetadataRoute.Manifest>(moduleManifeste, "app/manifest.ts");

/**
 * PWA — LE MANIFESTE ET LES ICÔNES, TELS QU'ILS SONT SUR LE DISQUE.
 *
 * Un manifeste se vérifie mal à l'œil : ses conséquences n'apparaissent que
 * sur un vrai téléphone, plusieurs jours plus tard, et une erreur y est
 * silencieuse — pas d'exception, pas de log, simplement une application qui
 * ne s'installe pas ou une icône rognée.
 *
 * Ces tests OUVRENT donc les fichiers PNG et regardent les pixels. Le
 * contrôle qui compte est le dernier : sur l'icône « maskable », aucun
 * pixel d'emblème ne doit sortir du cercle de sécurité de 80 %, parce que
 * c'est exactement ce qu'Android rogne.
 */

const RACINE = fileURLToPath(new URL("../..", import.meta.url));
const FOND: [number, number, number] = [5, 5, 5]; // --background, thème sombre

let réussis = 0;
let échecs = 0;

function test(nom: string, fn: () => void) {
  try {
    fn();
    réussis += 1;
    console.log(`ok - ${nom}`);
  } catch (erreur) {
    échecs += 1;
    console.error(`ÉCHEC - ${nom}`);
    console.error(erreur);
  }
}

const M = manifest();

/* ════════════════════════════════════════════════════════════════════════
 * I. LE LANCEMENT
 * ════════════════════════════════════════════════════════════════════════ */

test("M1. l'application démarre dans l'espace élève, jamais sur la vitrine", () => {
  // Un `start_url` remis à "/" ferait traverser le Hero, les transformations
  // et la newsletter à chaque lancement.
  assert.equal(M.display, "standalone");
  assert.equal(M.start_url, "/entrainement");
});

test("M1bis. LE POINT DE LANCEMENT DOIT ÊTRE UNE COQUILLE MISE EN CACHE", () => {
  // Sans cela, le lancement depuis l'icône en mode avion tombe sur la page
  // « Pas de connexion » : l'élève voit son application et ne peut pas y
  // entrer. C'est ce que faisait /connexion, qui dépend du cookie de session
  // et n'a donc rien à faire dans un cache.
  const sw = readFileSync(new URL("public/sw.js", `file://${RACINE}`), "utf8");
  const debut = sw.indexOf("const COQUILLES_ELEVE = [");
  const motifs = sw
    .slice(debut, sw.indexOf("];", debut))
    .split("\n")
    .map((l) => l.trim())
    .filter((l) => l.startsWith("/^"))
    .map((l) => new RegExp(l.replace(/,$/, "").slice(1, -1)));
  assert.ok(
    motifs.some((motif) => motif.test(String(M.start_url))),
    `start_url ${M.start_url} n'est pas une coquille mise en cache`,
  );
});

test("M2. le scope couvre tout le site", () => {
  // Restreint à /dashboard, le premier lien vers les CGV éjecterait l'élève
  // dans le navigateur, sans moyen de revenir à l'application.
  assert.equal(M.scope, "/");
});

test("M3. `id` est figé et distinct de `start_url`", () => {
  // Sans `id`, l'identité de l'application EST son `start_url` : le jour où
  // l'écran de lancement change, les navigateurs voient une NOUVELLE
  // application et laissent l'ancienne installée à côté.
  assert.equal(M.id, "/");
  assert.notEqual(M.id, M.start_url);
});

test("M4. aucune couleur décorative", () => {
  // Identité noir / blanc / gris (CLAUDE.md). Ces deux couleurs sont celles
  // de l'écran de démarrage et de la barre système : ce sont les seules du
  // site qu'on ne peut pas corriger sans réinstaller.
  assert.equal(M.background_color, "#050505");
  assert.equal(M.theme_color, "#050505");
});

test("M5. l'orientation n'est pas verrouillée", () => {
  // Verrouiller en portrait empêcherait de filmer sa technique en paysage
  // (F4) et de regarder la réponse du coach dans le bon sens (F5).
  assert.equal(M.orientation, undefined);
});

/* ════════════════════════════════════════════════════════════════════════
 * II. LES ICÔNES DÉCLARÉES EXISTENT VRAIMENT
 * ════════════════════════════════════════════════════════════════════════ */

test("M6. chaque icône déclarée est présente, carrée et à la taille annoncée", () => {
  const icones = M.icons ?? [];
  assert.ok(icones.length >= 3, "il en faut au moins trois : 192, 512, et une maskable");

  for (const icone of icones) {
    const chemin = new URL(`public${icone.src}`, `file://${RACINE}`);
    assert.ok(existsSync(chemin), `fichier manquant : ${icone.src}`);

    const image = lirePng(fileURLToPath(chemin));
    const [largeurAnnoncee, hauteurAnnoncee] = String(icone.sizes)
      .split("x")
      .map((n) => Number(n));
    assert.equal(image.largeur, largeurAnnoncee, `${icone.src} : largeur`);
    assert.equal(image.hauteur, hauteurAnnoncee, `${icone.src} : hauteur`);
    assert.equal(image.largeur, image.hauteur, `${icone.src} : doit être carrée`);
  }
});

test("M7. l'icône Apple existe au bon endroit et à la bonne taille", () => {
  // Convention de fichier Next.js : `app/apple-icon.png` produit seul le
  // <link rel="apple-touch-icon">. Elle n'est PAS dans le manifeste — iOS
  // ne lit pas les icônes du manifeste pour l'écran d'accueil.
  const chemin = fileURLToPath(new URL("app/apple-icon.png", `file://${RACINE}`));
  assert.ok(existsSync(chemin), "app/apple-icon.png est absent : iOS afficherait une capture de la page");
  const image = lirePng(chemin);
  assert.equal(image.largeur, 180);
  assert.equal(image.hauteur, 180);
});

test("M8. `any` et `maskable` sont deux fichiers DIFFÉRENTS", () => {
  // Déclarer le même fichier pour les deux usages est l'erreur la plus
  // courante : soit il est rogné et perd ses pointes, soit il est affiché
  // entier et paraît minuscule à côté des autres applications.
  const icones = M.icons ?? [];
  const any = icones.filter((i) => String(i.purpose ?? "any").includes("any")).map((i) => i.src);
  const maskable = icones.filter((i) => String(i.purpose ?? "").includes("maskable")).map((i) => i.src);
  assert.ok(any.length >= 1 && maskable.length >= 1);
  for (const src of maskable) {
    assert.ok(!any.includes(src), `${src} est déclaré à la fois any et maskable`);
  }
});

/* ════════════════════════════════════════════════════════════════════════
 * III. CE QUE LE LANCEUR VA VRAIMENT AFFICHER
 * ════════════════════════════════════════════════════════════════════════ */

/** Boîte englobant tout ce qui n'est pas le fond. */
function boiteEmbleme(chemin: string) {
  const image = lirePng(chemin);
  let xMin = image.largeur;
  let xMax = -1;
  let yMin = image.hauteur;
  let yMax = -1;
  for (let y = 0; y < image.hauteur; y += 1) {
    for (let x = 0; x < image.largeur; x += 1) {
      const [r, v, b] = image.pixel(x, y);
      // Tolérance de 12 : les bords de l'emblème sont lissés, un pixel
      // presque noir appartient encore au fond.
      const estFond =
        Math.abs(r - FOND[0]) <= 12 && Math.abs(v - FOND[1]) <= 12 && Math.abs(b - FOND[2]) <= 12;
      if (estFond) continue;
      if (x < xMin) xMin = x;
      if (x > xMax) xMax = x;
      if (y < yMin) yMin = y;
      if (y > yMax) yMax = y;
    }
  }
  return { image, xMin, xMax, yMin, yMax };
}

test("M9. le fond des icônes est plein — jamais transparent ni blanc", () => {
  // Une icône transparente disparaît sur un lanceur clair ; une icône
  // blanche jure avec le reste de l'identité.
  for (const src of ["/icons/icon-192.png", "/icons/icon-512.png", "/icons/icon-maskable-512.png"]) {
    const image = lirePng(fileURLToPath(new URL(`public${src}`, `file://${RACINE}`)));
    for (const [x, y] of [
      [0, 0],
      [image.largeur - 1, 0],
      [0, image.hauteur - 1],
      [image.largeur - 1, image.hauteur - 1],
    ]) {
      const [r, v, b] = image.pixel(x, y);
      assert.deepEqual([r, v, b], FOND, `${src} : le coin (${x},${y}) devrait être le fond`);
    }
  }
});

test("M10. L'ICÔNE MASKABLE TIENT DANS LE CERCLE DE SÉCURITÉ DE 80 %", () => {
  // LE test de ce fichier. Android rogne les icônes maskable selon la forme
  // du lanceur — cercle, squircle, goutte. La seule zone garantie est le
  // cercle centré de diamètre 80 %. Un emblème qui déborde perd ses pointes
  // sur certains téléphones et pas sur d'autres, sans le moindre message.
  const chemin = fileURLToPath(new URL("public/icons/icon-maskable-512.png", `file://${RACINE}`));
  const { image, xMin, xMax, yMin, yMax } = boiteEmbleme(chemin);
  assert.ok(xMax > 0, "aucun pixel d'emblème trouvé : l'icône est-elle vide ?");

  const centre = image.largeur / 2;
  const rayonSur = (image.largeur * 0.8) / 2;
  // Il suffit de tester les quatre coins de la boîte : ce sont les points
  // les plus éloignés du centre.
  for (const [x, y] of [
    [xMin, yMin],
    [xMax, yMin],
    [xMin, yMax],
    [xMax, yMax],
  ]) {
    const distance = Math.hypot(x + 0.5 - centre, y + 0.5 - centre);
    assert.ok(
      distance <= rayonSur,
      `le coin (${x},${y}) est à ${distance.toFixed(1)} px du centre, au-delà du rayon sûr de ${rayonSur}`,
    );
  }
});

test("M11. l'icône `any` remplit davantage le carré que la maskable", () => {
  // Elles n'ont pas le même métier : `any` est affichée telle quelle et doit
  // occuper l'espace, `maskable` est rognée et doit se retenir. Les
  // interchanger donne une icône minuscule ou une icône coupée.
  const any = boiteEmbleme(fileURLToPath(new URL("public/icons/icon-512.png", `file://${RACINE}`)));
  const mask = boiteEmbleme(
    fileURLToPath(new URL("public/icons/icon-maskable-512.png", `file://${RACINE}`)),
  );
  const hauteurAny = any.yMax - any.yMin;
  const hauteurMask = mask.yMax - mask.yMin;
  assert.ok(
    hauteurAny > hauteurMask,
    `any (${hauteurAny} px) devrait être plus grande que maskable (${hauteurMask} px)`,
  );
  assert.ok(hauteurAny / 512 > 0.65, "l'icône `any` ne doit pas être perdue au milieu du carré");
});

test("M12. l'emblème est centré", () => {
  for (const src of ["/icons/icon-192.png", "/icons/icon-512.png", "/icons/icon-maskable-512.png"]) {
    const chemin = fileURLToPath(new URL(`public${src}`, `file://${RACINE}`));
    const { image, xMin, xMax, yMin, yMax } = boiteEmbleme(chemin);
    const ecartX = Math.abs((xMin + xMax) / 2 - image.largeur / 2);
    const ecartY = Math.abs((yMin + yMax) / 2 - image.hauteur / 2);
    // 1,5 % du côté : de quoi absorber l'arrondi au pixel, pas un décalage.
    const tolerance = image.largeur * 0.015;
    assert.ok(ecartX <= tolerance, `${src} : décalé de ${ecartX.toFixed(1)} px horizontalement`);
    assert.ok(ecartY <= tolerance, `${src} : décalé de ${ecartY.toFixed(1)} px verticalement`);
  }
});

console.log(`\n${réussis} réussis, ${échecs} échecs`);
if (échecs > 0) process.exit(1);
