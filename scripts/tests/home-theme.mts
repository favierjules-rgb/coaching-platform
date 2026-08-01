/**
 * Harnais de non-régression — thème clair/sombre de la page d'accueil et
 * modernisation des sections (chantier `feat/home-apple-refresh-light-dark`).
 *
 * Chaque garde protège un comportement réel qui a déjà cassé ou pourrait
 * casser silencieusement : l'isolation du thème home vis-à-vis de l'admin,
 * la survie des deux étoiles en thème clair, l'inertie des couches
 * décoratives, et l'intégrité fonctionnelle des sections restylées.
 *
 * Lancement : npx tsx scripts/tests/home-theme.mts
 */
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

import { createElement } from "react";
import { renderToString } from "react-dom/server";

import { HomeThemeSwitch, HOME_THEME_STORAGE_KEY, homeThemeAntiFlashScript } from "../../components/home/HomeThemeSwitch";
import { THEME_ENABLED_PREFIXES } from "../../components/theme/ThemeProvider";

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

const lire = (chemin: string) => readFileSync(new URL(chemin, import.meta.url), "utf8");

const page = lire("../../app/page.tsx");
const css = lire("../../app/globals.css");
const étoilesMark = lire("../../components/brand/SethStarsMark.tsx");
const piliers = lire("../../components/sections/MethodStorytelling.tsx");
const switchSource = lire("../../components/home/HomeThemeSwitch.tsx");
const switchHtml = renderToString(createElement(HomeThemeSwitch));

/* ─── 1-2. Les deux étoiles ─── */

test("1. les deux étoiles sont toujours rendues, et visibles dans les deux thèmes", () => {
  assert.ok(/star="A"/.test(piliers) && /star="B"/.test(piliers), "les étoiles A et B doivent être montées");
  assert.ok(/fill="currentColor"/.test(étoilesMark), "les tracés héritent de la couleur du texte");
  assert.ok(!/fill="#fff"/.test(étoilesMark), "plus aucun blanc codé en dur : invisible en thème clair");
  assert.ok(/<SethStarsMark[^>]*className="text-foreground/.test(piliers),
    "dans les piliers, les étoiles suivent le token — noires en clair, blanches en sombre");
  const hero = lire("../../components/sections/Hero.tsx");
  assert.ok(/<SethStarsMark[^>]*className="text-white/.test(hero),
    "sur la photo du héro, les étoiles restent épinglées blanches");
});

test("2. les classes et hooks de l'animation des étoiles sont intacts", () => {
  for (const motif of ["StarPair", "method-stars-overlay", "method-stars-scene", "usePinnedSceneViewport", "useSectionScrollProgress"]) {
    assert.ok(piliers.includes(motif), `« ${motif} » doit rester présent`);
  }
  const cssÉtoiles = css.slice(css.indexOf(".method-stars-scene"));
  assert.ok(/--method-star-h/.test(cssÉtoiles), "variables de géométrie des étoiles conservées");
});

/* ─── 3-4. Le switch ─── */

test("3. le switch n'est rendu que sur la page d'accueil", () => {
  assert.ok(page.includes("<HomeThemeSwitch />"), "monté sur la home");
  const layout = lire("../../app/layout.tsx");
  assert.ok(!layout.includes("HomeThemeSwitch"), "jamais dans le layout racine");
});

test("4. le switch est un vrai bouton accessible", () => {
  assert.ok(/<button[^>]*type="button"/.test(switchHtml), "un <button>, pas une div cliquable");
  assert.ok(/aria-label="Activer le thème (clair|sombre)"/.test(switchHtml), "aria-label explicite");
  assert.ok(/aria-pressed/.test(switchHtml), "état courant annoncé");
  const cssSwitch = css.slice(css.indexOf(".home-theme-switch"));
  assert.ok(/width: 2\.75rem/.test(cssSwitch) && /height: 2\.75rem/.test(cssSwitch),
    "cible tactile de 44px (2.75rem)");
  assert.ok(/env\(safe-area-inset-right\)/.test(cssSwitch), "safe area iPhone respectée");
});

/* ─── 5-6. Scope du thème ─── */

test("5. les variables du thème sont scopées à la home, jamais à :root", () => {
  const racine = css.slice(css.indexOf(":root {"), css.indexOf(".light,"));
  assert.ok(!/--home-/.test(racine), "aucune variable --home-* dans :root");
  const blocAccueil = css.slice(css.indexOf("#accueil {"), css.indexOf("}", css.indexOf("#accueil {")));
  assert.ok(blocAccueil.includes("--home-line"), "variables déclarées sous #accueil");
  assert.ok(/#accueil\[data-home-theme="light"\]/.test(css), "variantes claires sous l'attribut du conteneur");
});

test("6. le thème home ne peut pas fuiter vers l'admin ni l'inverse", () => {
  // Clés localStorage distinctes : un choix sur la home ne change pas l'admin.
  assert.equal(HOME_THEME_STORAGE_KEY, "seth-home-theme");
  assert.ok((HOME_THEME_STORAGE_KEY as string) !== "seth-theme", "clé distincte de celle de ThemeProvider");
  // La home n'entre pas dans la liste des routes thémables de l'admin.
  assert.ok(!THEME_ENABLED_PREFIXES.some((p) => (p as string) === "/"), "la home reste hors de ThemeProvider");
  // Le switch écrit sur #accueil, jamais sur <html>.
  assert.ok(!/documentElement/.test(switchSource), "le switch ne touche jamais <html>");
  assert.ok(/getElementById\("accueil"\)/.test(switchSource), "le switch cible le conteneur home");
});

/* ─── 7. Sections dans le DOM ─── */

test("7. les sept sections restent montées, dans l'ordre", () => {
  const ordre = ["<Hero />", "<MethodStorytelling />", "<Transformations />", "<FreeAssessment />", "<PublicPrograms />", "<Newsletter />", "<PersonalStory />"];
  let position = -1;
  for (const balise of ordre) {
    const i = page.indexOf(balise);
    assert.ok(i > position, `${balise} doit être présent et dans l'ordre`);
    position = i;
  }
});

/* ─── 8-9. Couches décoratives ─── */

/** Tous les corps de règle du sélecteur donné (l'override clair précède le
 *  bloc d'origine : il faut examiner chaque occurrence, pas la première). */
function corpsDeRègle(sélecteur: string): string[] {
  const corps: string[] = [];
  let i = css.indexOf(sélecteur);
  while (i >= 0) {
    corps.push(css.slice(i, css.indexOf("}", i)));
    i = css.indexOf(sélecteur, i + 1);
  }
  return corps;
}

test("8. les couches décoratives sont inertes (pointer-events: none)", () => {
  for (const bloc of [".bilan-highlight::before", ".bilan-card::before", ".histoire::before", ".histoire-photo::after"]) {
    const occurrences = corpsDeRègle(bloc);
    assert.ok(occurrences.length > 0, `${bloc} présent`);
    assert.ok(occurrences.some((c) => c.includes("pointer-events: none")), `${bloc} doit être inerte`);
  }
  assert.ok(/pointer-events-none/.test(piliers), "l'overlay des étoiles reste inerte");
});

test("9. aucun halo n'utilise de largeur fixe (pas d'overflow horizontal)", () => {
  for (const bloc of [".bilan-highlight::before", ".histoire::before"]) {
    const occurrences = corpsDeRègle(bloc);
    assert.ok(occurrences.every((c) => !/width:\s*\d+px/.test(c)), `${bloc} : pas de largeur en pixels`);
    assert.ok(occurrences.some((c) => /inset:\s*0/.test(c)), `${bloc} : dimensionné par inset, pas par width`);
  }
});

/* ─── 10-12. Intégrité fonctionnelle ─── */

test("10. aucun handler fonctionnel n'a changé dans les sections restylées", () => {
  const form = lire("../../components/marketing/NewsletterSignupForm.tsx");
  for (const motif of ["onSubmit", 'role="alert"', 'role="status"', "useState", "fetch("]) {
    assert.ok(form.includes(motif), `NewsletterSignupForm : « ${motif} » toujours présent`);
  }
  const marquee = lire("../../components/sections/TransformationsMarquee.tsx");
  assert.ok(/marquee-pausable/.test(marquee), "le bandeau Transformations garde son mécanisme");
  const programmes = lire("../../components/sections/PublicPrograms.tsx");
  assert.ok(/getPublicPrograms/.test(programmes), "la source de données des programmes est intacte");
});

test("11. les liens et CTA restent identiques", () => {
  const carte = lire("../../components/sections/PublicProgramCard.tsx");
  assert.ok(carte.includes("href={`/programmes/${program.id}`}"), "destination des cartes inchangée");
  const programmes = lire("../../components/sections/PublicPrograms.tsx");
  assert.ok(programmes.includes('href="/programmes"'), "lien bibliothèque inchangé");
  assert.ok(carte.includes("formatAmountCents"), "affichage des prix inchangé");
});

test("12. la newsletter conserve sa soumission et son HTML sémantique", () => {
  const form = lire("../../components/marketing/NewsletterSignupForm.tsx");
  assert.ok(/<form/.test(form), "élément <form> conservé");
  assert.ok(/type="email"/.test(form), "champ email sémantique conservé");
  assert.ok(/consent|consentement/i.test(form), "consentement conservé");
});

/* ─── 13. Persistance sans flash ─── */

test("13. le choix est persisté et appliqué avant la première peinture", () => {
  assert.ok(homeThemeAntiFlashScript.includes("localStorage.getItem"), "lecture du choix mémorisé");
  assert.ok(homeThemeAntiFlashScript.includes("try{"), "échec de stockage silencieux (navigation privée)");
  assert.ok(homeThemeAntiFlashScript.includes("data-home-theme"), "le script pose l'attribut du conteneur");
  assert.ok(page.includes("suppressHydrationWarning"), "divergence d'attribut couverte côté React");
  assert.ok(page.includes("homeThemeAntiFlashScript"), "script monté en premier enfant du conteneur");
  assert.ok(page.indexOf("homeThemeAntiFlashScript") < page.indexOf("<Hero />"),
    "le script précède tout contenu peint");
  // Sombre par défaut : l'attribut initial du serveur est « dark ».
  assert.ok(page.includes('data-home-theme="dark"'), "sombre par défaut sans choix mémorisé");
});

/* ─── 14-15. Visibilité des voisines ─── */

test("14. le thème clair ne masque aucune section", () => {
  const clair = [...css.matchAll(/#accueil\[data-home-theme="light"\][^{]*\{[^}]*\}/g)].map((m) => m[0]).join("\n");
  assert.ok(clair.length > 0, "bloc clair présent");
  assert.ok(!/display:\s*none/.test(clair), "aucun display:none en thème clair");
  assert.ok(!/visibility:\s*hidden/.test(clair), "aucune section rendue invisible");
  assert.ok(!/content-visibility|contain:/.test(clair), "aucune propriété de rendu risquée sur WebKit");
});

test("15. aucun effet des piliers ne recouvre les sections voisines", () => {
  // L'overlay des étoiles reste clippé par sa propre couche.
  assert.ok(/method-stars-overlay/.test(piliers), "clippeur de l'overlay conservé");
  assert.ok(/method-stars-overlay sticky top-0 overflow-hidden/.test(piliers),
    "l'overlay coupe son propre débordement (classe portée par le composant)");
  // Le panneau modernisé des piliers ne crée pas de conteneur de défilement.
  assert.ok(piliers.includes("overflow-clip"), "panneau des piliers en overflow-clip (pas de scroll container)");
  // Aucune nouvelle combinaison dangereuse introduite par le thème.
  const blocThème = css.slice(css.indexOf("Thème de la page d'accueil — début"), css.indexOf("Thème de la page d'accueil — fin"));
  for (const dangereux of ["backdrop-filter", "position: sticky", "z-index: -", "contain:", "filter:"]) {
    assert.ok(!blocThème.includes(dangereux), `bloc thème : « ${dangereux} » proscrit`);
  }
});

console.log(`\n${réussis} test(s) réussi(s), ${échecs} échec(s).`);
if (échecs > 0) process.exit(1);
