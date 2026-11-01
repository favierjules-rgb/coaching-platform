/*
 * ════════════════════════════════════════════════════════════════════════════
 * NUTRITION SUR IPHONE — AUCUN DÉBORDEMENT HORIZONTAL
 * ════════════════════════════════════════════════════════════════════════════
 * ⚠️ CE QUE CETTE SUITE EXISTE POUR EMPÊCHER. Un élément flex porte
 * `min-width: auto` par défaut : il REFUSE de descendre sous la largeur
 * minimale de son contenu. Un nom d'aliment Ciqual — « Crème dessert à base de
 * crème légère 4 % MG environ, fluide ou épaisse » — imposait donc sa largeur à
 * toute la ligne, étoile comprise. Et comme la zone défilante de la feuille
 * déclare `overflow-y: auto` en laissant `overflow-x` à `visible`, la
 * spécification impose de calculer ce dernier en `auto` : au lieu d'être
 * rognée, la feuille se mettait à défiler latéralement.
 *
 * Ces règles ne se voient pas dans une capture d'écran de test unitaire : elles
 * se lisent dans les classes. On les vérifie donc là où elles sont écrites,
 * avec à chaque fois la raison qui les rend nécessaires.
 *
 * ⚠️ ON VÉRIFIE AUSSI CE QU'ON N'A PAS FAIT. Masquer le défaut par un
 * `overflow-x: hidden` global sur le `body` aurait caché la cause partout
 * ailleurs : un contrôle l'interdit explicitement.
 */
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const RACINE = new URL("../../", import.meta.url).pathname;
const lire = (chemin: string) => readFileSync(`${RACINE}${chemin}`, "utf8");

/** Le code sans les commentaires — indispensable avant « ce mot n'apparaît pas ». */
function sansProse(source: string): string {
  return source.replace(/\/\*[\s\S]*?\*\//g, " ").replace(/(^|[^:])\/\/.*$/gm, "$1 ");
}

const FEUILLE = lire("components/student/AddFoodSheet.tsx");
const FEUILLE_CODE = sansProse(FEUILLE);
const PAGE_NUTRITION = lire("app/(student)/nutrition/page.tsx");
const STYLES = lire("app/globals.css");

/* ═══════════ A. LA FEUILLE D'AJOUT ═══════════ */

await test("A1. la zone défilante ne peut plus devenir un défileur HORIZONTAL", () => {
  /*
   * ⚠️ LA CAUSE LA PLUS SOURNOISE. `overflow-y-auto` seul laisse `overflow-x`
   * à `visible`, que la spécification recalcule alors en `auto`. Le contenu
   * trop large n'était donc pas rogné : il devenait défilable, et la feuille
   * glissait hors de l'écran.
   */
  assert.match(FEUILLE_CODE, /flex-1 overflow-y-auto overflow-x-hidden/,
    "la zone de contenu déclare explicitement qu'elle ne défile pas latéralement");
});

await test("A2. les DEUX listes ont exactement les mêmes contraintes de largeur", () => {
  /*
   * ⚠️ L'ASYMÉTRIE ÉTAIT LE DÉFAUT. La ligne de résultat enveloppait déjà son
   * bouton dans un `min-w-0 flex-1` ; la ligne de favoris, non. Deux listes qui
   * affichent la même chose doivent rétrécir de la même façon.
   */
  // Favoris et récents.
  assert.match(FEUILLE_CODE, /<li key=\{cleAlimentRapide\(élément\)\} className="flex min-w-0 items-stretch gap-2">/,
    "la ligne de favoris peut rétrécir");
  assert.match(FEUILLE_CODE, /className="pressable flex min-h-\[48px\] min-w-0 flex-1 items-center gap-3 rounded-control/,
    "et le bouton qui porte le nom aussi");
  // Résultats de recherche.
  assert.match(FEUILLE_CODE, /<div className="flex min-w-0 items-stretch gap-2">/,
    "la ligne de résultat peut rétrécir");
  assert.match(FEUILLE_CODE, /<div className="min-w-0 flex-1">\{ligne\}<\/div>/,
    "et l'enveloppe de son bouton aussi");
  assert.match(FEUILLE_CODE, /className="pressable flex min-h-\[56px\] w-full min-w-0 items-center gap-3/,
    "`w-full` ne suffit pas : sans `min-w-0`, la largeur minimale du contenu l'emporte");
});

await test("A3. un nom long est tronqué, jamais étalé", () => {
  const troncatures = [...FEUILLE_CODE.matchAll(/className="truncate text-sm font-semibold text-foreground"/g)];
  assert.ok(troncatures.length >= 2,
    `le nom de l'aliment est tronqué dans les deux listes (${troncatures.length} trouvées)`);
  const secondaires = [...FEUILLE_CODE.matchAll(/className="truncate text-\[11px\] uppercase tracking-wide text-muted-foreground"/g)];
  assert.ok(secondaires.length >= 2, "la ligne secondaire aussi");
});

await test("A4. l'étoile garde une taille stable et ne peut pas être écrasée", () => {
  /*
   * ⚠️ `flex-shrink-0` ET une largeur fixe, les deux. Sans l'un, le bouton
   * s'écraserait sous le texte ; sans l'autre, il s'étirerait avec lui.
   */
  const etoiles = [...FEUILLE_CODE.matchAll(/w-12 flex-shrink-0 items-center justify-center rounded-control/g)];
  assert.ok(etoiles.length >= 1, "ligne de résultat : étoile de largeur fixe");
  assert.match(FEUILLE_CODE, /min-h-\[48px\] w-12 flex-shrink-0 items-center justify-center rounded-control/,
    "ligne de favoris : étoile de largeur fixe et de hauteur tactile");
});

await test("A5. les champs de quantité peuvent rétrécir sous leur largeur intrinsèque", () => {
  /*
   * ⚠️ UN `<input>` N'EST PAS UNE `<div>`. Il porte une largeur intrinsèque
   * (attribut `size`, une vingtaine de caractères) qui, avec
   * `min-width: auto`, l'empêche de rétrécir : à 320 px, le champ et ses
   * boutons d'unité débordaient la feuille. `w-full` n'y change rien.
   */
  const champs = [...FEUILLE_CODE.matchAll(/min-h-\[48px\] w-full min-w-0 rounded-control border border-border bg-background/g)];
  assert.equal(champs.length, 5,
    "les cinq champs de la feuille : recherche, nom, les trois macros, quantité manuelle et quantité choisie");
  /* ⚠️ ET LA CELLULE DE GRILLE AUSSI. Une cellule de `grid-cols-3` porte
     `min-width: auto` exactement comme un élément flex : sans elle, les trois
     champs de macros réclamaient chacun la largeur intrinsèque d'un `<input>`,
     soit bien plus que la largeur d'un iPhone. */
  assert.match(FEUILLE_CODE, /<div className="min-w-0">\s*\n\s*<label htmlFor=\{id\}/,
    "la cellule qui porte un champ de macro peut rétrécir");
  assert.doesNotMatch(FEUILLE_CODE, /min-h-\[48px\] w-full rounded-control border border-border bg-background/,
    "aucun champ de quantité ne doit rester sans `min-w-0`");
});

await test("A6. le mobilier fixe d'une ligne tient dans 320 px", () => {
  /*
   * Le seul calcul vraiment vérifiable sans navigateur : la somme des largeurs
   * QUI NE RÉTRÉCISSENT PAS. Si elle dépasse la place disponible, aucun
   * `min-w-0` ne sauvera la mise en page.
   *
   * 320 px d'écran, moins `p-5` de chaque côté (20 px) = 280 px utiles.
   */
  const utile = 320 - 20 * 2;

  // Ligne d'aliment : bouton (rétrécissable) + gap-2 + étoile w-12.
  const ligneAliment = 8 + 48;
  assert.ok(ligneAliment < utile, `ligne d'aliment : ${ligneAliment} px incompressibles`);

  // Étape quantité, cas le plus large : trois unités `min-w-[56px]`, gap-1
  // entre elles, gap-2 avant le groupe.
  const groupeUnites = 3 * 56 + 2 * 4;
  const ligneQuantite = 8 + groupeUnites;
  assert.ok(ligneQuantite < utile,
    `étape quantité : ${ligneQuantite} px incompressibles, il resterait ${utile - ligneQuantite} px au champ`);
  /* 80 px, c'est `px-4` de chaque côté (32 px) plus de quoi lire quatre
     chiffres : le minimum honnête, pas un chiffre rond choisi après coup. */
  assert.ok(utile - ligneQuantite >= 80,
    `il ne resterait que ${utile - ligneQuantite} px au champ de quantité`);

  // Saisie manuelle : trois colonnes de macros, `gap-3` entre elles.
  const colonnesMacros = (utile - 2 * 12) / 3;
  assert.ok(colonnesMacros >= 72, `colonnes de macros : ${Math.round(colonnesMacros)} px chacune`);
});

await test("A7. le panneau ne dépasse jamais la largeur de l'écran", () => {
  assert.match(FEUILLE_CODE, /flex max-h-\[92vh\] w-full max-w-full flex-col overflow-hidden rounded-t-card/,
    "le panneau est borné à la largeur disponible, sur mobile comme sur ordinateur");
  assert.match(FEUILLE_CODE, /min-h-\[48px\] min-w-0 flex-1 items-center justify-center gap-2 border-b-2/,
    "les deux onglets peuvent rétrécir plutôt que d'élargir la feuille");
});

await test("A8. le défaut n'est PAS masqué par un overflow global", () => {
  /*
   * ⚠️ LE RACCOURCI INTERDIT. `overflow-x: hidden` sur `body` ou `html` aurait
   * fait disparaître le symptôme partout — y compris là où un conteneur doit
   * réellement défiler horizontalement, comme le rail de séance — et aurait
   * laissé la cause en place.
   */
  const regles = sansProse(STYLES);
  assert.doesNotMatch(regles, /\bbody\s*\{[^}]*overflow-x\s*:\s*hidden/,
    "aucun masquage global sur le body");
  assert.doesNotMatch(regles, /\bhtml\s*\{[^}]*overflow-x\s*:\s*hidden/,
    "ni sur html");
  // Et le rail de séance garde son défilement horizontal, qui est voulu.
  const rail = sansProse(lire("components/student/SessionCarousel.tsx"));
  assert.match(rail, /overflow-x-auto/, "le parcours de séance défile toujours latéralement");
});

/* ═══════════ B. LES CARTES DE PLANS ALIMENTAIRES ═══════════ */

await test("B1. les cartes de plan utilisent les jetons de forme de la page", () => {
  /*
   * ⚠️ LES JETONS EXISTANTS, PAS DE NOUVELLES VALEURS. `rounded-card` (1 rem)
   * est exactement le rayon des cartes « Recettes » et « Générer ma liste de
   * course », juste au-dessus sur la même page.
   */
  assert.match(PAGE_NUTRITION, /flex flex-col gap-4 rounded-card border border-border bg-card p-6 shadow-soft/,
    "la carte d'un plan a les coins et l'ombre des autres cartes");
  const lien = lire("components/student/RecipesHighlightLink.tsx");
  assert.match(lien, /rounded-card/, "la carte « Recettes » emploie bien le même jeton");
  assert.match(STYLES, /--radius-card: 1rem;/,
    "le jeton existait déjà : aucune valeur nouvelle n'a été introduite pour ce correctif");
});

await test("B2. le bouton « Voir le plan » suit le système de boutons de l'espace élève", () => {
  assert.match(PAGE_NUTRITION, /pressable mt-2 flex min-h-\[44px\] items-center justify-center rounded-control border border-primary/,
    "coins `rounded-control`, cible tactile de 44 px, et l'anneau de focus habituel");
  assert.match(PAGE_NUTRITION, /focus-visible:ring-2 focus-visible:ring-primary\/40/);
});

await test("B3. aucune carte carrée ne subsiste sur la page Nutrition", () => {
  /*
   * Le but du lot : une seule identité visuelle sur la page. On cherche donc le
   * motif de l'ancienne carte — bordure et fond, sans rayon.
   */
  const carrees = [...PAGE_NUTRITION.matchAll(/className="[^"]*\bborder border-border bg-card p-6/g)].filter(
    (m) => !m[0].includes("rounded-card"),
  );
  assert.deepEqual(carrees.map((m) => m[0]), [], "il reste des cartes à coins carrés");
});

await test("B4. les valeurs, les liens et les calculs sont INCHANGÉS", () => {
  /*
   * ⚠️ C'EST UN CORRECTIF DE PRÉSENTATION. Ce contrôle est là pour que la
   * prochaine retouche visuelle ne déplace pas une valeur au passage.
   */
  for (const expression of [
    /\{plan\.caloriesPerDay\}/,
    /\{plan\.protein\}g/,
    /\{plan\.carbs\}g/,
    /\{plan\.fat\}g/,
    /href=\{`\/nutrition\/\$\{plan\.id\}`\}/,
    /<StatusBadge status=\{plan\.status\} \/>/,
  ]) {
    assert.match(PAGE_NUTRITION, expression, `${expression} doit rester tel quel`);
  }
});

await test("B5. un nom de plan long ne pousse pas la pastille hors de la carte", () => {
  assert.match(PAGE_NUTRITION, /min-w-0 flex-1 truncate font-heading text-lg font-bold uppercase/,
    "le titre rétrécit et se tronque au lieu d'élargir la carte");
});
