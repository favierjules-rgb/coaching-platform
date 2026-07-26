/**
 * Harnais de RÉGRESSION — section d'accueil « Les piliers de la
 * transformation » (components/sections/MethodStorytelling.tsx).
 *
 * Bug corrigé le 26/07/2026, visible sur téléphone uniquement : la scène
 * ancrée enfermait le contenu dans un conteneur `h-screen` +
 * `overflow-hidden` + `justify-center`. Sous 1024px, la grille passe sur 1
 * ou 2 colonnes et devient bien plus haute que le viewport : centrée puis
 * rognée, elle perdait son titre et le haut du pilier 01 en haut, la fin du
 * pilier 04 en bas — d'où l'impression que « Résultats réels » remontait
 * sur la section.
 *
 * Ces tests montent réellement les deux variantes (react-dom/server) et
 * vérifient le contenu ET les conteneurs, plutôt qu'un snapshot large qui
 * n'aurait rien dit de la cause.
 *
 * Lancement : npx tsx scripts/tests/home-method-pillars.mts
 * (sans la condition react-server — react-dom/server est requis.)
 */
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";

import { MethodStorytelling } from "../../components/sections/MethodStorytelling";
import { Transformations } from "../../components/sections/Transformations";
import { methodPillars } from "../../data/mock";

let passed = 0;
let failed = 0;
function test(name: string, fn: () => void) {
  try {
    fn();
    passed += 1;
    console.log(`ok - ${name}`);
  } catch (error) {
    failed += 1;
    console.error(`ÉCHEC - ${name}`);
    console.error(error);
  }
}

/**
 * Rendu serveur du composant. `usePinnedSceneViewport` et
 * `usePrefersReducedMotion` retombent tous deux sur `false` hors
 * navigateur : c'est donc la variante « flux normal », celle que reçoivent
 * les écrans trop courts pour la scène ancrée, et le premier HTML servi à
 * tout le monde — il doit être lisible tel quel.
 */
const flowHtml = renderToStaticMarkup(createElement(MethodStorytelling));
const source = readFileSync(new URL("../../components/sections/MethodStorytelling.tsx", import.meta.url), "utf8");

/* ─── Contenu : les 4 piliers, entiers et dans l'ordre ─── */

test("les quatre numéros 01 → 04 sont présents", () => {
  for (const numero of ["01", "02", "03", "04"]) {
    assert.ok(flowHtml.includes(`>${numero}<`), `numéro ${numero} absent du rendu`);
  }
});

test("les quatre titres sont présents, y compris le premier et le dernier", () => {
  assert.equal(methodPillars.length, 4, "la section doit compter exactement 4 piliers");
  for (const { title } of methodPillars) {
    // Les apostrophes typographiques sont échappées par React (&#x27;).
    const escaped = title.replace(/'/g, "&#x27;");
    assert.ok(flowHtml.includes(escaped), `titre « ${title} » absent du rendu`);
  }
  assert.ok(flowHtml.includes("Analyse du profil"), "pilier 01 : titre visible");
  assert.ok(flowHtml.includes("Apprentissage"), "pilier 04 : titre visible");
});

test("chaque pilier porte aussi sa description et son icône", () => {
  for (const { description } of methodPillars) {
    const debut = description.slice(0, 24).replace(/'/g, "&#x27;");
    assert.ok(flowHtml.includes(debut), `description manquante : « ${debut}… »`);
  }
  // Une icône lucide par pilier + la marque étoilée décorative.
  const svgCount = (flowHtml.match(/<svg/g) ?? []).length;
  assert.ok(svgCount >= methodPillars.length, `attendu ≥ ${methodPillars.length} svg, trouvé ${svgCount}`);
});

test("ordre correct : 01 avant 02 avant 03 avant 04, et chaque numéro précède son titre", () => {
  const positions = ["01", "02", "03", "04"].map((n) => flowHtml.indexOf(`>${n}<`));
  for (let i = 1; i < positions.length; i += 1) {
    assert.ok(positions[i] > positions[i - 1], `le pilier 0${i + 1} doit suivre le pilier 0${i}`);
  }
  methodPillars.forEach(({ title }, index) => {
    const numeroPos = flowHtml.indexOf(`>0${index + 1}<`);
    const titrePos = flowHtml.indexOf(title.replace(/'/g, "&#x27;"));
    assert.ok(numeroPos < titrePos, `le numéro 0${index + 1} doit précéder son titre`);
  });
});

test("le titre de section reste présent au-dessus des piliers", () => {
  assert.ok(flowHtml.includes("Ma méthode"));
  assert.ok(flowHtml.includes("4 piliers."));
  assert.ok(flowHtml.indexOf("4 piliers.") < flowHtml.indexOf("Analyse du profil"));
});

/* ─── Mise en page : plus aucune contrainte de hauteur sur mobile ─── */

test("RÉGRESSION : le repli en flux normal n'enferme pas le contenu dans une hauteur de viewport", () => {
  for (const classe of ["h-screen", "overflow-hidden", "sticky", "pinned-scene"]) {
    assert.ok(!flowHtml.includes(classe), `« ${classe} » ne doit pas apparaître dans le rendu en flux`);
  }
  // Aucune hauteur imposée en style inline non plus (l'ancienne scène en
  // posait une de 220vh).
  assert.ok(!/style="[^"]*height:/.test(flowHtml), "aucune hauteur inline ne doit contraindre la section");
});

test("la scène ancrée mesure sa hauteur en svh, jamais en vh brut", () => {
  // `vh` ignore les barres du navigateur mobile : la scène déborderait de
  // la zone visible et rognerait à nouveau les piliers extrêmes.
  assert.ok(source.includes("pinned-scene-track"), "la piste de scroll passe par la classe utilitaire");
  assert.ok(source.includes("pinned-scene-viewport"), "la fenêtre ancrée passe par la classe utilitaire");
  assert.ok(!/height: `\$\{SECTION_HEIGHT_VH\}vh`/.test(source), "plus de hauteur inline en vh");
  const css = readFileSync(new URL("../../app/globals.css", import.meta.url), "utf8");
  assert.ok(css.includes(".pinned-scene-track"), "classes définies dans globals.css");
  assert.ok(css.includes("220svh") && css.includes("100svh"), "hauteurs exprimées en svh");
  assert.ok(css.includes("height: 220vh") && css.includes("height: 100vh"), "repli vh conservé");
});

test("densité compacte sous lg : les 4 piliers tiennent dans une hauteur d'écran", () => {
  // Padding, marges, tailles de texte et d'icône réduits en mobile, valeurs
  // desktop reprises telles quelles derrière `lg:`.
  for (const [compact, desktop] of [
    ["p-3.5", "lg:p-8"],
    ["mb-1.5", "lg:mb-6"],
    ["h-5 w-5", "lg:h-7 lg:w-7"],
    ["text-base", "lg:text-xl"],
    ["text-xs", "lg:text-sm"],
    ["leading-snug", "lg:leading-relaxed"],
  ]) {
    assert.ok(flowHtml.includes(compact), `densité mobile : « ${compact} » attendu`);
    assert.ok(source.includes(desktop), `valeur desktop « ${desktop} » conservée`);
  }
});

test("RÉGRESSION : la hauteur vient du contenu (padding vertical, pas de vh)", () => {
  assert.ok(flowHtml.includes("py-24"), "la section doit garder son rythme vertical normal");
  assert.ok(!/\b(h|min-h)-\[\d+(vh|svh|dvh)\]/.test(flowHtml), "aucune hauteur en unités de viewport");
});

test("le contenu mobile est visible immédiatement (aucune opacité nulle héritée de l'animation)", () => {
  assert.ok(!/style="[^"]*opacity:\s*0[;"]/.test(flowHtml), "le contenu ne doit pas être rendu transparent");
  assert.ok(!/style="[^"]*scale\(0\.96\)/.test(flowHtml), "aucun scale d'entrée figé sur mobile");
});

/* ─── Section suivante ─── */

test("« Résultats réels » se rend après les piliers, dans une section distincte", () => {
  const pageHtml =
    renderToStaticMarkup(createElement(MethodStorytelling)) + renderToStaticMarkup(createElement(Transformations));
  const dernierPilier = pageHtml.indexOf("Apprentissage");
  const sectionSuivante = pageHtml.indexOf("Résultats réels");
  assert.ok(dernierPilier > -1 && sectionSuivante > -1);
  assert.ok(sectionSuivante > dernierPilier, "« Résultats réels » doit venir APRÈS le pilier 04");
  assert.ok(pageHtml.includes('id="transformations"'), "la section suivante garde son ancre");
});

/* ─── Non-régression desktop ─── */

test("NON-RÉGRESSION desktop : la scène ancrée et l'écartement des étoiles sont conservés dans le code", () => {
  for (const marqueur of [
    "pinned-scene-viewport sticky top-0",
    "starATransform",
    "starBTransform",
    "GROWTH_X_VW",
    "useSectionScrollProgress",
  ]) {
    assert.ok(source.includes(marqueur), `la scène desktop doit conserver « ${marqueur} »`);
  }
  // La bascule se fait au breakpoint lg, et le repli reste actif pour
  // prefers-reduced-motion.
  assert.ok(source.includes("usePinnedSceneViewport"), "la scène doit être conditionnée à la place disponible");
  assert.ok(source.includes("reducedMotion || !canPinScene"), "le flux sert reduced-motion ET les écrans trop courts");
});

test("NON-RÉGRESSION : les deux variantes partagent le même markup de contenu", () => {
  // Un seul composant produit le titre + la grille : impossible que les
  // rendus mobile et desktop divergent en textes ou en ordre.
  assert.equal((source.match(/function PillarsContent/g) ?? []).length, 1);
  assert.equal((source.match(/<PillarsContent \/>/g) ?? []).length, 2, "utilisé par les deux variantes");
  assert.equal((source.match(/methodPillars\.map/g) ?? []).length, 1, "une seule boucle sur les piliers");
});

test("le titre reste lisible sur les petits écrans (pas de débordement horizontal)", () => {
  // « 1 transformation. » dépasse une colonne de 320px en text-4xl : la
  // taille de base est réduite, les paliers sm/md sont conservés.
  assert.ok(flowHtml.includes("text-[1.6rem]"), "taille de base réduite sous sm");
  assert.ok(flowHtml.includes("sm:text-4xl"), "palier sm conservé");
  assert.ok(flowHtml.includes("md:text-6xl"), "palier desktop d'origine conservé");
});

console.log(`\n${passed} test(s) réussi(s), ${failed} échec(s).`);
if (failed > 0) process.exit(1);
