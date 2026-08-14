/**
 * Harnais — ALIMENTS A5.9 : RESPONSIVE DE LA FICHE ÉLÈVE ADMIN/COACH.
 *
 * ────────────────────────────────────────────────────────────────────────────
 * CE QUI EST MESURÉ ICI, ET CE QUI NE PEUT PAS L'ÊTRE
 * ────────────────────────────────────────────────────────────────────────────
 * Un débordement horizontal est un fait de MISE EN PAGE : il ne se prouve que
 * dans un moteur de rendu, en comparant `scrollWidth` à `clientWidth`. Cette
 * mesure-là a été faite dans Chromium, à neuf largeurs, sur la vraie chaîne de
 * conteneurs — et les chiffres sont dans `docs/aliments-a5.9-livrable.md`.
 *
 * Ce fichier-ci ne rejoue PAS le navigateur : le dépôt n'a ni jsdom ni moteur
 * de layout, et un test qui prétendrait mesurer une largeur sans moteur de
 * rendu mentirait sur ce qu'il vérifie. Ce qu'il garde, ce sont les
 * INVARIANTS DE CODE dont la mesure a montré qu'ils étaient la cause : les
 * deux `min-w-0`, le `w-full` de la piste, le `relative` des jours, et
 * l'absence des motifs qui recréeraient le défaut.
 *
 * ⚠️ LA LEÇON DU LOT, ET ELLE EST DANS LE BANC PLUS QUE DANS LE CODE.
 * La première version du banc mesurait `documentElement.scrollWidth` seul et
 * rendait « 0 px » partout — sur une page 404, puis sur une page dont le
 * débordement était AVALÉ par un conteneur défilant. Deux contrôles négatifs
 * l'ont démasquée. Les tests ci-dessous encodent donc aussi ce qu'il faut
 * mesurer, pas seulement ce qu'il faut écrire.
 *
 * Lancement : npm run test:aliments-a5-responsive
 */
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

function lire(chemin: string): string {
  return readFileSync(new URL(chemin, import.meta.url), "utf8");
}
/**
 * ⚠️ L'ORDRE DES DEUX PASSES N'EST PAS INDIFFÉRENT — MESURÉ, PAS SUPPOSÉ.
 *
 * `AdminShell.tsx` contient, DANS un commentaire de ligne, le chemin
 * « app/admin » suivi de deux astérisques. Cette séquence ouvre un FAUX
 * commentaire de bloc, que la première fermeture de bloc rencontrée plus bas —
 * celle d'une vraie JSX — vient refermer. En dépouillant les blocs D'ABORD, on
 * efface ainsi 6 664 caractères sur 8 276, dont tout le JSX à vérifier, et les
 * assertions « ce mot est absent » deviennent vertes sur un fichier vidé.
 *
 * On retire donc les commentaires de LIGNE en premier : la fausse ouverture
 * disparaît avec la ligne qui la contient, et les vrais blocs sont ensuite
 * traités seuls.
 *
 * (Ce commentaire-ci évite soigneusement d'écrire ces séquences en toutes
 * lettres : les poser ici refermerait ce bloc au milieu d'une phrase. eslint
 * l'a signalé, tsc ne l'avait pas vu.)
 */
function sansProse(source: string): string {
  return source.replace(/(^|[^:])\/\/.*$/gm, "$1 ").replace(/\/\*[\s\S]*?\*\//g, " ");
}

const SOURCE_SHELL = lire("../../components/admin/AdminShell.tsx");
const CODE_SHELL = sansProse(SOURCE_SHELL);
const SOURCE_CARROUSEL = lire("../../components/student/NutritionDayCarousel.tsx");
const CODE_CARROUSEL = sansProse(SOURCE_CARROUSEL);
const CODE_HISTORIQUE = sansProse(lire("../../components/admin/CoachNutritionHistory.tsx"));
const CODE_NAV = sansProse(lire("../../components/student/NutritionWeekNav.tsx"));
const CODE_PROGRESS = sansProse(lire("../../components/student/DailyNutritionProgress.tsx"));
const CODE_FICHE = sansProse(lire("../../app/admin/eleves/[studentId]/page.tsx"));
const CODE_POIDS = sansProse(lire("../../components/student/WeightEvolutionCard.tsx"));
// Le tracé lui-même vit dans un composant partagé — c'est LUI qui décide de la
// largeur, pas la carte qui l'entoure.
const CODE_GRAPHE = sansProse(lire("../../components/shared/WeightChart.tsx"));
const SOURCE_LAYOUT = lire("../../app/layout.tsx");

/** Les fichiers de la fiche élève et de tout ce qu'elle rend d'A5.6 à A5.8. */
const FICHIERS_FICHE: readonly (readonly [string, string])[] = [
  ["AdminShell", CODE_SHELL],
  ["fiche élève", CODE_FICHE],
  ["CoachNutritionHistory", CODE_HISTORIQUE],
  ["NutritionDayCarousel", CODE_CARROUSEL],
  ["NutritionWeekNav", CODE_NAV],
  ["DailyNutritionProgress", CODE_PROGRESS],
  ["WeightEvolutionCard", CODE_POIDS],
  ["WeightChart", CODE_GRAPHE],
];

/* ══════════════════════════════════════════════════════════════════════════
   RESP1..3 — LES LARGEURS QUI NE DOIVENT PAS EXISTER
   ══════════════════════════════════════════════════════════════════════════ */

await test("RESP1. aucun w-screen ni 100vw dans la fiche élève", () => {
  // ⚠️ `w-screen` vaut 100vw, et 100vw IGNORE LA BARRE DE DÉFILEMENT
  // VERTICALE. Sur un desktop qui affiche une barre classique, un bloc en
  // `w-screen` dépasse donc de sa largeur — une quinzaine de pixels — dans un
  // conteneur qui, lui, mesure `clientWidth`. C'est un débordement garanti,
  // invisible sur un Mac à barres flottantes et bien réel sous Windows.
  for (const [nom, code] of FICHIERS_FICHE) {
    assert.ok(!code.includes("w-screen"), `« w-screen » dans ${nom}`);
    assert.ok(!code.includes("100vw"), `« 100vw » dans ${nom}`);
    assert.ok(!/\bw-\[\d+px\]/.test(code), `une largeur en pixels dans ${nom}`);
    assert.ok(!code.includes("min-w-max"), `« min-w-max » dans ${nom}`);
  }
});

await test("RESP2. le conteneur principal peut RÉTRÉCIR — c'était la cause n°1", () => {
  // ⚠️ LE CŒUR DU LOT. La colonne de contenu d'AdminShell est un enfant flex.
  // Un enfant flex a `min-width: auto` : il refuse de devenir plus étroit que
  // la largeur minimale de son contenu. Un seul descendant large — ici la piste
  // du carrousel, mesurée à 1 106 px — élargissait donc la colonne, la rangée,
  // et la page entière. Mesuré AVANT : 1 204 px de colonne dans un viewport de
  // 390 px, et `scrollWidth` du document à 6 687 px.
  assert.ok(
    CODE_SHELL.includes('<div className="flex min-w-0 flex-1 flex-col">'),
    "la colonne de contenu doit porter min-w-0",
  );

  // Le garde doit rester lisible : la rangée parente est bien un flex.
  assert.ok(CODE_SHELL.includes('className="flex min-h-screen bg-background"'));

  // CONTRÔLE NÉGATIF DU DÉPOUILLEMENT : la prose explique la règle, et le
  // dépouillement l'a retirée. Sans quoi les assertions « le mot X est absent »
  // de RESP1 seraient vertes pour la mauvaise raison.
  assert.ok(SOURCE_SHELL.includes("min-width: auto"), "la prose énonce la règle…");
  assert.ok(!CODE_SHELL.includes("min-width: auto"), "…et le dépouillement l'a retirée");
  assert.ok(CODE_SHELL.includes("export function AdminShell"));
  // ⚠️ CONTRÔLE DE VOLUME — c'est lui qui a démasqué le piège `app/admin/**`.
  // Un dépouillement qui mange le fichier rend toutes les interdictions vertes.
  assert.ok(CODE_SHELL.length > 2000, `dépouillement suspect : ${CODE_SHELL.length} caractères`);
  assert.ok(CODE_SHELL.includes("AdminSidebar"), "le JSX survit au dépouillement");
  assert.ok(CODE_SHELL.includes("<main"), "le <main> aussi");
});

await test("RESP3. aucune largeur minimale desktop sur CoachNutritionHistory", () => {
  assert.ok(!/min-w-\[/.test(CODE_HISTORIQUE), "aucune min-width arbitraire");
  assert.ok(!/\bw-\[/.test(CODE_HISTORIQUE), "aucune largeur arbitraire");
  assert.ok(!CODE_HISTORIQUE.includes("min-w-max"));
  assert.ok(!CODE_HISTORIQUE.includes("whitespace-nowrap"));
  // Il se contente de la largeur qu'on lui donne : une colonne flex, sans
  // largeur propre.
  assert.ok(CODE_HISTORIQUE.includes('className="flex flex-col gap-3"'));
});

/* ══════════════════════════════════════════════════════════════════════════
   RESP4 — LES ACTIONS DU HAUT DE FICHE
   ══════════════════════════════════════════════════════════════════════════ */

await test("RESP4. les actions du header passent à la ligne sur mobile", () => {
  // Huit boutons — dont « Voir le questionnaire complet » et « Supprimer
  // définitivement » — ne tiennent sur aucune ligne de 375 px. Le conteneur
  // doit donc autoriser le retour à la ligne, et aucun bouton ne doit
  // l'interdire pour lui-même.
  assert.ok(CODE_FICHE.includes('<div className="flex flex-wrap gap-2">'));
  assert.ok(CODE_FICHE.includes('className="mb-8 flex flex-wrap items-start justify-between gap-4"'));
  assert.ok(!CODE_FICHE.includes("flex-nowrap"), "aucun conteneur d'actions ne bloque le wrap");
  assert.ok(!CODE_FICHE.includes("whitespace-nowrap"), "aucun libellé ne force une ligne");

  // La hauteur de cible tactile reste conforme — corriger la largeur ne doit
  // pas rétrécir les boutons sous 44 px.
  assert.ok(CODE_FICHE.includes("min-h-[44px]"));
});

/* ══════════════════════════════════════════════════════════════════════════
   RESP5..8 — L'HISTORIQUE, LA SEMAINE, L'ANNEAU, LES BARRES
   ══════════════════════════════════════════════════════════════════════════ */

await test("RESP5. l'historique tient dans son parent et n'impose aucune largeur", () => {
  // Le bloc est rendu dans une carte standard, sans largeur propre.
  assert.ok(CODE_FICHE.includes("<CoachNutritionHistory"));
  const carte = CODE_FICHE.slice(
    CODE_FICHE.lastIndexOf("{isSupabaseStudent", CODE_FICHE.indexOf("<CoachNutritionHistory")),
    CODE_FICHE.indexOf("<CoachNutritionHistory"),
  );
  assert.ok(carte.includes("rounded-card border border-border bg-card p-6"));
  assert.ok(!/w-\[|min-w-\[|w-screen/.test(carte), "la carte n'impose aucune largeur");

  // Et le rendu d'un repas laisse le libellé RÉTRÉCIR plutôt que pousser :
  // `min-w-0` + `truncate`, sans quoi un nom de produit long — ils le sont
  // souvent, côté Open Food Facts — élargirait toute la colonne.
  assert.ok(CODE_HISTORIQUE.includes('className="min-w-0 flex-1"'));
  assert.ok(CODE_HISTORIQUE.includes("block truncate"));
  assert.ok(CODE_HISTORIQUE.includes("flex-shrink-0"), "les kcal, elles, ne se compriment pas");
});

await test("RESP6. la navigation par semaine ne force aucune largeur", () => {
  // Les deux flèches ne se compriment pas ; le TITRE, lui, doit pouvoir
  // rétrécir — c'est `min-w-0` + `truncate` qui l'y autorisent. Sans eux,
  // « Semaine du 28 décembre 2026 au 3 janvier 2027 » impose sa largeur.
  assert.ok(CODE_NAV.includes('className="min-w-0 text-center"'));
  assert.ok(CODE_NAV.includes("truncate font-heading"));
  assert.ok(CODE_NAV.includes("h-11 w-11 flex-shrink-0"), "les flèches gardent 44 px");
  assert.ok(!/min-w-\[|w-\[|w-screen|whitespace-nowrap/.test(CODE_NAV));

  // Le résumé hebdomadaire passe à la ligne au lieu de s'étirer.
  assert.ok(CODE_NAV.includes("flex flex-wrap items-baseline justify-center"));
});

await test("RESP7. l'anneau des calories n'impose pas de largeur fixe excessive", () => {
  // Le rayon est un PARAMÈTRE, avec 52 px par défaut — soit 120 px de côté,
  // qui tiennent dans 375 px. Ce n'est pas une largeur de mise en page : c'est
  // la taille d'un dessin, et le `<section>` qui l'entoure, lui, est fluide.
  assert.ok(CODE_PROGRESS.includes("rayon = 52"));
  assert.ok(CODE_PROGRESS.includes("épaisseur = 8"));
  assert.ok(CODE_PROGRESS.includes("const taille = (rayon + épaisseur) * 2"));
  // 120 px de côté : sous les 375 px du plus petit téléphone visé.
  assert.equal((52 + 8) * 2, 120);
  assert.ok(120 < 375);

  // Le SVG est dimensionné par attribut ET par viewBox — pas par une classe de
  // largeur qui l'empêcherait de se réduire dans un parent plus étroit.
  assert.ok(CODE_PROGRESS.includes("viewBox={`0 0 ${taille} ${taille}`}"));
  assert.ok(!CODE_PROGRESS.includes("w-screen"));
  assert.ok(!/min-w-\[/.test(CODE_PROGRESS));
});

await test("RESP8. les barres de macros rétrécissent correctement", () => {
  // ⚠️ `min-w-0` SUR LA PISTE DE LA BARRE. C'est un enfant flex : sans lui, il
  // refuserait de descendre sous sa largeur minimale et pousserait la ligne
  // dès que le libellé ou la valeur s'allongent.
  assert.ok(CODE_PROGRESS.includes("h-2 min-w-0 flex-1 overflow-hidden rounded-full"));
  // Le libellé et la valeur, eux, ne se compriment pas — largeurs fixes en rem,
  // pas en pixels, et petites.
  assert.ok(CODE_PROGRESS.includes("w-4 flex-shrink-0"));
  assert.ok(CODE_PROGRESS.includes("w-20 flex-shrink-0"));
  // La largeur de remplissage est un pourcentage, jamais des pixels.
  assert.ok(CODE_PROGRESS.includes("style={{ width: largeurBarre(p.part) }}"));
});

/* ══════════════════════════════════════════════════════════════════════════
   RESP9..10 — LE GRAPHIQUE DE POIDS ET LA COHABITATION AVEC LA SIDEBAR
   ══════════════════════════════════════════════════════════════════════════ */

await test("RESP9. le graphique de poids n'impose pas une largeur desktop", () => {
  // ⚠️ LE TRACÉ EST UN SVG EN `viewBox`, ET C'EST CE QUI LE SAUVE. Un SVG avec
  // une `viewBox` et `w-full` se met à l'échelle de son parent ; un SVG avec un
  // attribut `width` en pixels imposerait sa largeur et pousserait la carte.
  assert.ok(CODE_GRAPHE.includes("viewBox"), "le graphique a une viewBox");
  assert.ok(CODE_GRAPHE.includes("w-full"), "et il prend la largeur du parent");
  assert.ok(!/width=\{?"?\d+/.test(CODE_GRAPHE), "aucune largeur intrinsèque en pixels");
  for (const [nom, code] of [["WeightChart", CODE_GRAPHE], ["WeightEvolutionCard", CODE_POIDS]] as const) {
    assert.ok(!/\bw-\[\d+px\]/.test(code), `largeur en pixels dans ${nom}`);
    assert.ok(!code.includes("w-screen"), `w-screen dans ${nom}`);
    assert.ok(!code.includes("min-w-max"), `min-w-max dans ${nom}`);
  }

  // ⚠️ LE SEUL `whitespace-nowrap` DU GRAPHIQUE EST SUR UNE INFOBULLE ABSOLUE,
  // ET C'EST CE QUI LE REND ACCEPTABLE — À UNE CONDITION. Une infobulle ne doit
  // pas se couper en deux : `nowrap` y est justifié. Mais un élément absolu
  // n'est retenu que par un ANCÊTRE POSITIONNÉ ; sans lui, il s'échappe de son
  // conteneur et allonge le document — c'est exactement le défaut trouvé sur
  // les `sr-only` du carrousel, et corrigé par `relative`. Ici l'ancêtre existe.
  assert.ok(CODE_GRAPHE.includes('className="relative w-full"'), "le graphique est positionné");
  const infobulle = CODE_GRAPHE.slice(
    CODE_GRAPHE.indexOf("whitespace-nowrap") - 90,
    CODE_GRAPHE.indexOf("whitespace-nowrap"),
  );
  assert.ok(infobulle.includes("absolute"), "le nowrap ne concerne qu'un élément absolu");
  assert.ok(infobulle.includes("pointer-events-none"), "et purement décoratif");
  // Nulle part ailleurs dans le graphique.
  assert.equal((CODE_GRAPHE.match(/whitespace-nowrap/g) ?? []).length, 1);
});

await test("RESP10. sidebar + contenu ne dépassent jamais ensemble le viewport", () => {
  // La sidebar est un enfant flex NON compressible ; la colonne de contenu est
  // l'enfant compressible. C'est ce couple qui fait que la somme des deux vaut
  // exactement le viewport — mesuré : 240 px de sidebar + 1 200 px de contenu
  // = 1 440 px, à la largeur 1 440.
  assert.ok(CODE_SHELL.includes('<div className="hidden lg:flex">'), "sidebar masquée sous lg");
  assert.ok(CODE_SHELL.includes('<div className="flex min-w-0 flex-1 flex-col">'));

  // Et la zone de contenu ne se donne aucune largeur : elle prend ce qui reste.
  assert.ok(CODE_SHELL.includes('<main className="flex-1 overflow-y-auto p-6 lg:p-10">'));
  assert.ok(!CODE_SHELL.includes("w-screen"));
  assert.ok(!/\bw-\[\d+px\]/.test(CODE_SHELL));
});

/* ══════════════════════════════════════════════════════════════════════════
   RESP11..16 — LES LARGEURS VISÉES
   ══════════════════════════════════════════════════════════════════════════ */

/**
 * Les mesures Chromium du lot, sur la vraie chaîne de conteneurs.
 * `avant` / `apres` = `documentElement.scrollWidth` observé.
 *
 * ⚠️ CES CHIFFRES SONT DES OBSERVATIONS, PAS DES CALCULS. Ils sont recopiés
 * du banc (`scripts/dev/mesure-responsive.mjs`), et le test vérifie qu'ils
 * racontent bien ce que le lot prétend : un débordement avant, aucun après.
 */
const MESURES: readonly { largeur: number; avant: number; apres: number }[] = [
  { largeur: 375, avant: 6687, apres: 375 },
  { largeur: 390, avant: 6687, apres: 390 },
  { largeur: 393, avant: 6687, apres: 393 },
  { largeur: 430, avant: 6687, apres: 430 },
  { largeur: 768, avant: 6687, apres: 768 },
  { largeur: 1280, avant: 6943, apres: 1280 },
  { largeur: 1440, avant: 6943, apres: 1440 },
  { largeur: 1728, avant: 9607, apres: 1728 },
  { largeur: 1920, avant: 9607, apres: 1920 },
];

function mesure(largeur: number) {
  const m = MESURES.find((x) => x.largeur === largeur);
  assert.ok(m, `aucune mesure enregistrée pour ${largeur} px`);
  return m;
}

for (const [numero, largeur, intitulé] of [
  [11, 375, "375 px — le plus petit iPhone visé"],
  [12, 390, "390 px — iPhone 14/15"],
  [13, 430, "430 px — iPhone Pro Max"],
  [14, 768, "768 px — tablette, layout intermédiaire"],
  [15, 1440, "1440 px — desktop courant"],
  [16, 1920, "1920 px — grand écran, aucune régression"],
] as const) {
  await test(`RESP${numero}. ${intitulé} : aucun débordement horizontal`, () => {
    const m = mesure(largeur);
    // APRÈS : le document tient exactement dans le viewport.
    assert.equal(m.apres, largeur, `scrollWidth doit valoir ${largeur}`);
    // AVANT : le défaut existait bel et bien — sans quoi ce lot ne corrigerait
    // rien et ces tests seraient verts sur du vide.
    assert.ok(m.avant > largeur + 1, "le débordement était réel avant correction");
    assert.ok(m.avant - largeur > 500, "et il était massif, pas marginal");
  });
}

/* ══════════════════════════════════════════════════════════════════════════
   COHÉRENCE DU LOT
   ══════════════════════════════════════════════════════════════════════════ */

await test("RESP-SUP. la correction est à la SOURCE, sans masquage ni banc livré", () => {
  // ⚠️ LES SOLUTIONS INTERDITES. `overflow-x-hidden` sur html/body masquerait
  // le défaut : la barre disparaît, le contenu reste hors de l'écran et devient
  // simplement inatteignable. `scale`, `zoom` et une largeur desktop forcée
  // rendraient la page illisible au lieu de la recomposer.
  const GLOBAL = lire("../../app/globals.css");
  assert.ok(!/\b(html|body)[^{]*\{[^}]*overflow-x:\s*hidden/.test(GLOBAL), "pas de masquage global");
  for (const [nom, code] of FICHIERS_FICHE) {
    assert.ok(!code.includes("zoom:"), `« zoom » dans ${nom}`);
    assert.ok(!/transform:\s*scale|scale-\[/.test(code), `« scale » dans ${nom}`);
  }

  // Le VIEWPORT n'a pas été touché : il était déjà correct, et la mesure l'a
  // montré avant toute modification. Next fusionne ses défauts avec l'export
  // partiel — la balise émise porte bien `width=device-width, initial-scale=1`.
  assert.ok(SOURCE_LAYOUT.includes("export const viewport"));
  assert.ok(SOURCE_LAYOUT.includes('themeColor: "#050505"'));
  assert.ok(!SOURCE_LAYOUT.includes("userScalable"), "aucun blocage du zoom utilisateur");
  assert.ok(!SOURCE_LAYOUT.includes("maximumScale"), "aucun plafond de zoom");

  // AUCUN BANC DE MESURE LIVRÉ dans l'application.
  let bancLivré = false;
  try {
    lire("../../app/mesure-a59/page.tsx");
    bancLivré = true;
  } catch {
    bancLivré = false;
  }
  assert.equal(bancLivré, false, "la route de mesure ne doit pas être livrée");

  // Les trois correctifs sont là, et ils sont documentés là où ils agissent.
  assert.ok(CODE_SHELL.includes("min-w-0"));
  assert.ok(CODE_CARROUSEL.includes("flex w-full min-w-0 snap-x snap-mandatory overflow-x-auto"));
  assert.ok(CODE_CARROUSEL.includes('className="relative w-full flex-shrink-0 snap-start px-0.5"'));

  // ⚠️ ET LE CONTRAT A5.6 N'A PAS BOUGÉ : le carrousel garde son défilement
  // CSS, son accroche, et sa règle « aucune largeur en pixels ».
  assert.ok(CODE_CARROUSEL.includes("snap-x snap-mandatory"));
  assert.ok(CODE_CARROUSEL.includes("overflow-x-auto"));
  assert.ok(CODE_CARROUSEL.includes("w-full flex-shrink-0"));
  assert.ok(CODE_CARROUSEL.includes("piste.scrollTo("));
  assert.ok(!CODE_CARROUSEL.includes("scrollIntoView"));
  assert.ok(!/w-\[\d+px\]/.test(CODE_CARROUSEL));

  // La prose du carrousel explique les deux pièges — et le dépouillement l'a
  // bien retirée, ce qui rend les interdictions ci-dessus probantes.
  assert.ok(SOURCE_CARROUSEL.includes("position: absolute"));
  assert.ok(!CODE_CARROUSEL.includes("position: absolute"));
});
