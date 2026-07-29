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

test("RÉGRESSION : le repli en flux normal n'enferme pas le CONTENU dans une hauteur de viewport", () => {
  // La bande décorative des étoiles porte, elle, `overflow-hidden` (pour
  // que les étoiles sortent par ses bords sans créer de défilement
  // horizontal) : la garde porte donc sur le contenu, pas sur la chaîne
  // brute. On isole ce qui suit la bande — titre + grille des piliers.
  const apresBande = flowHtml.slice(flowHtml.indexOf("Ma méthode"));
  for (const classe of ["h-screen", "overflow-hidden", "sticky", "pinned-scene"]) {
    assert.ok(!apresBande.includes(classe), `« ${classe} » ne doit pas contraindre le contenu en flux`);
  }
  assert.ok(
    !/style="[^"]*height:/.test(apresBande),
    "aucune hauteur inline ne doit contraindre le titre ni les piliers",
  );
  // Et la section elle-même reste dimensionnée par son contenu.
  assert.ok(!flowHtml.includes("pinned-scene-track"), "aucune piste de scène ancrée dans le repli");
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
    "<StarPair sepT={sepT} />",
    "useSectionScrollProgress",
  ]) {
    assert.ok(source.includes(marqueur), `la scène desktop doit conserver « ${marqueur} »`);
  }
  assert.ok(source.includes("usePinnedSceneViewport"), "l'ancrage reste conditionné à la place disponible");
  assert.ok(source.includes("reducedMotion || !canPinScene"), "le flux sert reduced-motion ET les écrans trop courts");
});

test("NON-RÉGRESSION : les deux variantes partagent le même markup de contenu", () => {
  // Un seul composant produit le titre + la grille : impossible que les
  // rendus mobile et desktop divergent en textes ou en ordre.
  assert.equal((source.match(/function PillarsContent/g) ?? []).length, 1);
  assert.equal((source.match(/<PillarsContent \/>/g) ?? []).length, 2, "utilisé par les deux variantes");
  assert.equal((source.match(/methodPillars\.map/g) ?? []).length, 1, "une seule boucle sur les piliers");
});

/* ─── Étoiles : animation universelle, sans ciblage d'appareil ─── */
/*
 * Bug du 29/07/2026 : animation correcte sur iPhone 16 Pro Max, figée sur
 * iPhone 14. Cause — `usePinnedSceneViewport` conditionnait l'ANIMATION à
 * `(min-height: 700px)`, seuil situé entre la hauteur réellement visible
 * d'un iPhone 14 sous Safari (~664px) et celle d'un grand iPhone (~776px).
 * Les gardes ci-dessous verrouillent chacun des points qui ont permis
 * cette divergence.
 */

const css = readFileSync(new URL("../../app/globals.css", import.meta.url), "utf8");
const hookAncrage = readFileSync(new URL("../../hooks/usePinnedSceneViewport.ts", import.meta.url), "utf8");

/**
 * Source débarrassée de ses commentaires. Les commentaires de ce chantier
 * citent nommément « iPhone 14 » pour expliquer le bug : la garde
 * anti-détection d'appareil doit porter sur le CODE, pas sur la prose.
 */
function sansCommentaires(texte: string): string {
  return texte.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^[ \t]*\/\/.*$/gm, "");
}

/** Chaque bloc `@media` de la feuille, délimité par comptage d'accolades. */
function blocsMedia(feuille: string): { condition: string; corps: string }[] {
  const blocs: { condition: string; corps: string }[] = [];
  const regex = /@media([^{]*)\{/g;
  let m: RegExpExecArray | null;
  while ((m = regex.exec(feuille)) !== null) {
    let profondeur = 1;
    let i = regex.lastIndex;
    while (i < feuille.length && profondeur > 0) {
      if (feuille[i] === "{") profondeur += 1;
      else if (feuille[i] === "}") profondeur -= 1;
      i += 1;
    }
    blocs.push({ condition: m[1].trim(), corps: feuille.slice(regex.lastIndex, i - 1) });
  }
  return blocs;
}
/** Bloc CSS dédié au motif, isolé pour être inspecté règle par règle. */
const debutMotif = css.indexOf(".method-stars-scene,");
const finMotif = css.indexOf("/* Fin motif étoiles */");
assert.ok(debutMotif > -1 && finMotif > debutMotif, "le bloc CSS du motif doit être délimité dans globals.css");
const blocEtoiles = css.slice(debutMotif, finMotif);

test("GARDE : aucune media query ne désactive l'animation des étoiles", () => {
  // Le seul `matchMedia` du composant sert à choisir la MISE EN PAGE.
  // Le geste, lui, n'est plus derrière aucune condition : les deux
  // variantes montent `StarPair`.
  assert.equal((source.match(/<StarPair sepT=\{sepT\} \/>/g) ?? []).length, 2, "les deux variantes animent les étoiles");
  assert.ok(!/animation:\s*none/.test(blocEtoiles), "aucune règle `animation: none` sur le motif");
  assert.ok(!/transition:\s*none/.test(blocEtoiles), "aucune règle `transition: none` sur le motif");
  // Aucune règle du motif ne vit dans une media query de largeur. Les
  // blocs sont extraits par comptage d'accolades plutôt que par une
  // expression régulière approximative.
  for (const bloc of blocsMedia(css)) {
    if (!/width/.test(bloc.condition)) continue;
    assert.ok(
      !bloc.corps.includes("method-stars"),
      `le motif ne doit pas dépendre de « ${bloc.condition} »`,
    );
  }
  // Le seul palier de largeur du projet reste celui de l'ANCRAGE, et il
  // porte sur la place disponible, pas sur une classe d'appareil.
  assert.ok(
    hookAncrage.includes("(min-width: 1024px) and (min-height: 560px), (min-height: 700px)"),
    "le seuil d'ancrage est explicite et documenté",
  );
  assert.ok(
    !sansCommentaires(hookAncrage).includes("StarPair"),
    "le hook d'ancrage ne doit rien savoir des étoiles",
  );
});

test("GARDE : les étoiles ne sont jamais masquées, en particulier sous 400px", () => {
  for (const interdit of ["display: none", "display:none", "visibility: hidden", "visibility:hidden"]) {
    assert.ok(!blocEtoiles.includes(interdit), `« ${interdit} » ne doit pas s'appliquer au motif`);
  }
  // Le composant n'a qu'une opacité, constante et non nulle.
  const opacite = source.match(/const STAR_OPACITY = ([\d.]+);/);
  assert.ok(opacite, "l'opacité des étoiles doit rester explicite");
  assert.ok(Number(opacite[1]) > 0, "les étoiles ne doivent jamais être rendues transparentes");
  assert.ok(!/hidden|opacity-0/.test(source.slice(source.indexOf("function StarPair"), source.indexOf("function PillarsContent"))),
    "aucun masquage dans le rendu des étoiles");
  // Rendu serveur (le HTML que reçoit un téléphone avant hydratation) :
  // les deux tracés sont bien là.
  const tracesEtoiles = (flowHtml.match(/viewBox="(-5\.25|216\.92)/g) ?? []).length;
  assert.equal(tracesEtoiles, 2, "les deux étoiles doivent être dans le HTML servi, avant tout JavaScript");
});

test("GARDE : reduced-motion conserve un rendu statique VISIBLE", () => {
  // `immobile` fige la progression à 0 — position de repos, étoiles
  // assemblées — sans jamais les retirer du rendu.
  assert.ok(
    /const sepT = immobile\s*\?\s*0/.test(source),
    "reduced-motion doit figer la progression, pas supprimer les étoiles",
  );
  assert.ok(source.includes("<MethodPillarsFlow immobile={reducedMotion} />"), "le repli reçoit bien l'information");
  assert.ok(
    !/reducedMotion[^\n]*return null/.test(source),
    "reduced-motion ne doit jamais aboutir à un rendu vide",
  );
});

test("GARDE : aucune détection d'appareil, d'agent utilisateur ni de largeur en JavaScript", () => {
  for (const fichier of [sansCommentaires(source), sansCommentaires(hookAncrage)]) {
    for (const interdit of ["userAgent", "navigator.platform", "iPhone", "iPad", "isMobile", "window.innerWidth"]) {
      assert.ok(!fichier.includes(interdit), `détection interdite : « ${interdit} »`);
    }
  }
  // La géométrie est résolue par le navigateur, pas calculée en JS à
  // partir d'une taille d'écran lue une fois.
  assert.ok(blocEtoiles.includes("min("), "la taille du motif passe par min()");
  assert.ok(blocEtoiles.includes("max("), "l'amplitude passe par max()");
});

test("GARDE : aucune largeur fixe ne peut provoquer de débordement horizontal", () => {
  // Toute la géométrie est bornée par la largeur du viewport (`vw`) et
  // les étoiles sont confinées par un conteneur qui coupe le dépassement.
  assert.ok(/--method-star-h:\s*min\([^)]*vw\)/.test(blocEtoiles), "la hauteur d'étoile est bornée par la largeur");
  assert.ok(/--method-col-half:\s*min\(640px,/.test(blocEtoiles), "la demi-colonne suit la largeur réelle du viewport");
  assert.ok(source.includes("method-stars-band relative mb-12 overflow-hidden"), "la bande coupe le dépassement");
  assert.ok(source.includes("pinned-scene-viewport sticky top-0 w-full overflow-hidden"), "la scène ancrée aussi");
  // Aucune coordonnée en pixels en dur dans le transform des étoiles.
  const rendu = source.slice(source.indexOf("function StarPair"), source.indexOf("function PillarsContent"));
  assert.ok(!/\d+px/.test(rendu), "aucune coordonnée fixe en pixels dans le déplacement des étoiles");
  assert.ok(rendu.includes("pointer-events-none"), "le motif ne capte jamais le pointeur");
  assert.ok(rendu.includes('transformOrigin: "center"'), "origine de transformation explicite");
  assert.ok(!/top:|left:/.test(rendu), "le déplacement passe par transform, jamais par top/left");
});

test("GARDE : la scène est mesurée en svh, avec repli vh, pour la barre d'adresse mobile", () => {
  assert.ok(css.includes("@supports (height: 100svh)"), "les valeurs svh restent derrière un @supports");
  assert.ok(/--method-star-h:\s*min\(92vh/.test(css), "repli vh présent");
  assert.ok(/--method-star-h:\s*min\(92svh/.test(css), "valeur svh présente");
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
