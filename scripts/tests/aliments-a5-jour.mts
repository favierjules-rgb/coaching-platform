/**
 * Harnais — ALIMENTS A5.6 : RÉSUMÉ NUTRITIONNEL VISUEL ET NAVIGATION PAR JOUR.
 *
 * ────────────────────────────────────────────────────────────────────────────
 * CE QUI EST MESURÉ, ET CE QUI NE PEUT PAS L'ÊTRE
 * ────────────────────────────────────────────────────────────────────────────
 * Le dépôt n'a ni jsdom ni bibliothèque de test DOM : `renderToString` n'exécute
 * aucun effet et ne fait glisser aucun doigt. Prétendre « simuler un swipe »
 * ici serait mentir sur ce qui est mesuré.
 *
 * Les règles sont donc éprouvées là où elles vivent : `lib/nutrition/
 * progression.ts` — la géométrie, le plafonnement, la division par zéro, le
 * choix du jour — appelé pour de vrai, sur les cas qui cassent. Le RENDU est
 * vérifié par `renderToString` sur ce qui est visible au premier rendu. Et ce
 * qui ne se prouve qu'en lisant le code est assorti d'un contrôle négatif.
 *
 * ⚠️ LA RÈGLE LA PLUS FRAGILE DE CE LOT : le plafonnement ne concerne QUE le
 * dessin. Trois tests séparés la gardent (A5-DAY5, A5-DAY6, A5-DAY9).
 *
 * Lancement : npm run test:aliments-a5-jour
 */
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createElement } from "react";
import { renderToString } from "react-dom/server";
import test from "node:test";

import {
  CalorieRing,
  DailyNutritionProgress,
  MacroProgressBar,
} from "../../components/student/DailyNutritionProgress";
import { NutritionDayCarousel } from "../../components/student/NutritionDayCarousel";
import { formatIntegerFr } from "../../lib/nutrition/basis-points";
import type { MacroTotals } from "../../lib/nutrition/consumed";
import {
  anneau,
  calculerProgression,
  indexDuJour,
  indexParDefaut,
  largeurBarre,
} from "../../lib/nutrition/progression";

function lire(chemin: string): string {
  return readFileSync(new URL(chemin, import.meta.url), "utf8");
}
function sansProse(source: string): string {
  return source.replace(/\/\*[\s\S]*?\*\//g, " ").replace(/(^|[^:])\/\/.*$/gm, "$1 ");
}

const SOURCE_CARROUSEL = lire("../../components/student/NutritionDayCarousel.tsx");
const CODE_CARROUSEL = sansProse(SOURCE_CARROUSEL);
const CODE_PROGRESS = sansProse(lire("../../components/student/DailyNutritionProgress.tsx"));
const CODE_SEMAINE = sansProse(lire("../../components/student/StudentPrescribedWeek.tsx"));

const SEMAINE = [
  "2026-08-10",
  "2026-08-11",
  "2026-08-12",
  "2026-08-13",
  "2026-08-14",
  "2026-08-15",
  "2026-08-16",
];
const LIBELLES = ["Lundi", "Mardi", "Mercredi", "Jeudi", "Vendredi", "Samedi", "Dimanche"];

function totaux(kcal: number, p = 0, g = 0, l = 0): MacroTotals {
  return { kcal, proteinG: p, carbG: g, fatG: l };
}

/**
 * ⚠️ LE SÉPARATEUR DE MILLIERS N'EST PAS UNE ESPACE ORDINAIRE.
 *
 * `formatIntegerFr(1420)` rend « 1 420 » avec une ESPACE INSÉCABLE (U+00A0),
 * comme le veut la typographie française. Une assertion écrite avec une espace
 * normale échoue donc sur un affichage parfaitement correct — mesuré, ce piège
 * a rendu six tests rouges d'un coup.
 *
 * On compare donc à la sortie du MÊME formateur que le composant utilise.
 */
const nombre = (n: number) => formatIntegerFr(n);

function rendreCarrousel(aujourdHui: string): string {
  return renderToString(
    createElement(NutritionDayCarousel, {
      dates: SEMAINE,
      libellés: LIBELLES,
      aujourdHui,
      rendreJour: (i: number) => createElement("p", null, `jour ${i}`),
    }),
  );
}

/* ══════════════════════════════════════════════════════════════════════════
   A5-DAY1..3 — LE JOUR AFFICHÉ
   ══════════════════════════════════════════════════════════════════════════ */

await test("A5-DAY1. aujourd'hui est sélectionné automatiquement", () => {
  assert.equal(indexDuJour(SEMAINE, "2026-08-13"), 3);
  assert.equal(indexParDefaut(SEMAINE, "2026-08-13"), 3);

  const html = rendreCarrousel("2026-08-13");
  assert.ok(html.includes("Jeudi"), "le libellé du jour courant est affiché");
  assert.ok(html.includes("Aujourd"), "et il est nommé « Aujourd'hui »");

  // ⚠️ UNE SEMAINE PASSÉE N'A PAS D'« AUJOURD'HUI », et ce n'est pas une
  // erreur : on retombe sur le premier jour, jamais sur -1 — cet index pilote
  // un défilement, et un index invalide donnerait un écran vide.
  assert.equal(indexDuJour(SEMAINE, "2026-07-01"), null);
  assert.equal(indexParDefaut(SEMAINE, "2026-07-01"), 0);
  const passée = rendreCarrousel("2026-07-01");
  assert.ok(passée.includes("Lundi"));
  assert.ok(!passée.includes("Aujourd"), "aucun jour n'est marqué à tort");

  // Liste vide : aucun index hors bornes.
  assert.equal(indexParDefaut([], "2026-08-13"), 0);

  // ⚠️ COMPARAISON DE CHAÎNES, PAS DE `Date`. Construire un `Date` ferait
  // entrer le fuseau horaire dans une question qui n'en a pas.
  const code = sansProse(lire("../../lib/nutrition/progression.ts"));
  const bloc = code.slice(code.indexOf("export function indexDuJour"));
  assert.ok(!bloc.includes("new Date"), "aucune construction de Date");
});

await test("A5-DAY2. changer de jour ne change QUE le jour affiché", () => {
  // Ce composant n'a AUCUNE fonction d'écriture. Ce n'est pas une promesse
  // dans un commentaire : c'est vérifiable sur son source.
  for (const interdit of [
    "onAjouter",
    "onSupprimer",
    "onCorriger",
    "supabase",
    "rpc(",
    "insert",
    "update",
    "delete",
    "consumed_on",
    "consumedOn",
  ]) {
    assert.ok(!CODE_CARROUSEL.includes(interdit), `« ${interdit} » dans le carrousel`);
  }
  // Il ne reçoit qu'un rendu de jour, et rend des index.
  assert.ok(CODE_CARROUSEL.includes("rendreJour: (index: number) => React.ReactNode"));
  assert.ok(CODE_CARROUSEL.includes("setActif("));

  // CONTRÔLE NÉGATIF du dépouillement : le fichier n'est pas vide, et la prose
  // a bien été retirée — elle, elle parle de `consumed_on`.
  assert.ok(CODE_CARROUSEL.includes("export function NutritionDayCarousel"));
  assert.ok(SOURCE_CARROUSEL.includes("consumed_on"), "la prose l'évoque");
  assert.ok(CODE_CARROUSEL.length > 800);
});

await test("A5-DAY3. les consommations restent liées à LEUR date", () => {
  // C'est la date qui sélectionne les repas, et elle vient de `datesParJour` —
  // jamais de l'index du carrousel.
  assert.ok(CODE_SEMAINE.includes("suivi?.datesParJour[jour.day] ?? null"));
  assert.ok(CODE_SEMAINE.includes("suivi.meals.filter((r) => r.consumedOn === date)"));
  // Le carrousel ne reçoit AUCUN repas : il ne peut pas en déplacer un.
  assert.ok(!CODE_CARROUSEL.includes("meals"));
  assert.ok(!CODE_CARROUSEL.includes("entries"));
});

/* ══════════════════════════════════════════════════════════════════════════
   A5-DAY4..6 — LE CERCLE DES CALORIES
   ══════════════════════════════════════════════════════════════════════════ */

await test("A5-DAY4. le cercle reflète consommé / objectif", () => {
  const p = calculerProgression(1420, 1800);
  assert.equal(p.consomme, 1420);
  assert.equal(p.cible, 1800);
  assert.ok(Math.abs(p.part - 1420 / 1800) < 1e-12);
  assert.equal(p.restant, 380);
  assert.equal(p.depasse, false);

  // La géométrie : à part = 0 l'anneau est invisible, à part = 1 il est plein.
  const rayon = 52;
  const circonference = 2 * Math.PI * rayon;
  assert.ok(Math.abs(anneau(rayon, 0).dashOffset - circonference) < 1e-9);
  assert.ok(Math.abs(anneau(rayon, 1).dashOffset) < 1e-9);
  assert.ok(Math.abs(anneau(rayon, 0.5).dashOffset - circonference / 2) < 1e-9);

  const html = renderToString(
    createElement(DailyNutritionProgress, {
      objectif: totaux(1800, 120, 220, 65),
      consommé: totaux(1420, 92, 164, 51),
    }),
  );
  assert.ok(html.includes(nombre(1420)), "la vraie consommation est écrite");
  assert.ok(html.includes(nombre(1800)), "l'objectif aussi");
  assert.ok(html.includes(nombre(380)), "et le restant");
});

await test("A5-DAY5. en dépassement, le CERCLE est plafonné à 100 %", () => {
  const p = calculerProgression(1950, 1800);
  assert.equal(p.part, 1, "la part de TRACÉ est bornée à 1");
  assert.equal(anneau(52, p.part).dashOffset, 0, "l'anneau est plein, jamais plus");

  // Même à trois fois l'objectif, l'anneau ne fait qu'un tour.
  assert.equal(calculerProgression(5400, 1800).part, 1);
  // Et jamais négatif non plus.
  assert.equal(calculerProgression(-100, 1800).part, 0);
  assert.equal(anneau(52, -5).dashOffset, anneau(52, 0).dashOffset);
  assert.equal(anneau(52, 99).dashOffset, 0);
});

await test("A5-DAY6. mais les VRAIES kcal dépassées restent affichées", () => {
  // ⚠️ LA RÈGLE À NE JAMAIS CASSER. Plafonner la donnée plutôt que la géométrie
  // masquerait exactement l'information que l'élève est venu chercher.
  const p = calculerProgression(1950, 1800);
  assert.equal(p.consomme, 1950, "la consommation n'est PAS plafonnée");
  assert.equal(p.restant, -150, "le restant est négatif, et il le reste");
  assert.equal(p.depasse, true);

  const html = renderToString(
    createElement(CalorieRing, {
      consommé: 1950,
      cible: 1800,
      part: p.part,
      restant: p.restant,
      dépasse: true,
    }),
  );
  assert.ok(html.includes(nombre(1950)), "la vraie consommation est écrite");
  assert.ok(html.includes(`+${nombre(150)}`), "le dépassement est écrit, pas caché");
  assert.ok(html.includes("text-destructive"), "et signalé");

  // `destructive` NE SERT QU'À ÇA. Hors dépassement, le cercle est sobre.
  const sobre = renderToString(
    createElement(CalorieRing, {
      consommé: 1420,
      cible: 1800,
      part: 0.79,
      restant: 380,
      dépasse: false,
    }),
  );
  assert.ok(!sobre.includes("destructive"), "aucun rouge quand tout va bien");
});

/* ══════════════════════════════════════════════════════════════════════════
   A5-DAY7..9 — LES TROIS BARRES
   ══════════════════════════════════════════════════════════════════════════ */

function rendreBarre(libellé: string, court: string, consommé: number, cible: number | null) {
  return renderToString(createElement(MacroProgressBar, { libellé, court, consommé, cible }));
}

await test("A5-DAY7. la barre des protéines est juste", () => {
  const html = rendreBarre("Protéines", "P", 92, 120);
  assert.ok(html.includes("92"), "la valeur consommée");
  assert.ok(html.includes("120"), "et l'objectif");
  assert.ok(html.includes("Protéines"));
  assert.equal(largeurBarre(calculerProgression(92, 120).part), `${(92 / 120) * 100}%`);
});

await test("A5-DAY8. la barre des glucides est juste", () => {
  const html = rendreBarre("Glucides", "G", 164, 220);
  assert.ok(html.includes("164") && html.includes("220"));
  assert.equal(largeurBarre(calculerProgression(164, 220).part), `${(164 / 220) * 100}%`);
});

await test("A5-DAY9. la barre des lipides est juste — et le dépassement se voit", () => {
  const html = rendreBarre("Lipides", "L", 51, 65);
  assert.ok(html.includes("51") && html.includes("65"));

  // Dépassement : la LARGEUR est plafonnée, le TEXTE ne l'est pas.
  const dépassé = rendreBarre("Lipides", "L", 72, 65);
  assert.equal(largeurBarre(calculerProgression(72, 65).part), "100%");
  assert.ok(dépassé.includes("72"), "la vraie valeur reste affichée");
  assert.ok(dépassé.includes("destructive"), "et le dépassement est signalé");

  // ⚠️ LES TROIS MACROS PARTAGENT LA MÊME COULEUR. Leur distinction se lit dans
  // leur libellé, pas dans un code couleur : donner à chacune sa teinte fixe
  // rendrait le rouge illisible comme signal, puisqu'une barre serait rouge en
  // permanence.
  const p = rendreBarre("Protéines", "P", 10, 100);
  const g = rendreBarre("Glucides", "G", 10, 100);
  const l = rendreBarre("Lipides", "L", 10, 100);
  const classes = (h: string) => h.match(/class="h-full[^"]*"/)?.[0] ?? "";
  assert.equal(classes(p), classes(g));
  assert.equal(classes(g), classes(l));
  assert.ok(classes(p).includes("bg-foreground"), "sobre, pas coloré");
  for (const h of [p, g, l]) assert.ok(!h.includes("destructive"), "aucun rouge hors dépassement");
});

/* ══════════════════════════════════════════════════════════════════════════
   A5-DAY10..12 — LE RÉSUMÉ SUIT LE JOURNAL
   ══════════════════════════════════════════════════════════════════════════ */

const OBJECTIF = totaux(2000, 150, 200, 67);

function rendreRésumé(consommé: MacroTotals): string {
  return renderToString(createElement(DailyNutritionProgress, { objectif: OBJECTIF, consommé }));
}

await test("A5-DAY10. ajouter un aliment met à jour le cercle ET les barres", () => {
  const avant = rendreRésumé(totaux(0));
  const après = rendreRésumé(totaux(118, 1, 27, 0.5));
  assert.notEqual(avant, après, "le résumé a changé");
  assert.ok(avant.includes(`${nombre(2000)}\u00a0kcal restantes`));
  assert.ok(après.includes("118"), "la nouvelle consommation est affichée");

  // La géométrie a bougé, elle aussi : ce n'est pas qu'un chiffre.
  const offset = (h: string) => h.match(/stroke-dashoffset="([\d.]+)"/)?.[1] ?? "";
  assert.notEqual(offset(avant), offset(après));
  assert.ok(Number(offset(après)) < Number(offset(avant)), "l'anneau s'est rempli");
});

await test("A5-DAY11. supprimer un aliment met à jour le résumé", () => {
  // Une suppression est une soustraction : le résumé revient exactement à
  // l'état d'avant. Le composant ne garde AUCUN état — il n'a pas de `useState`.
  const vide = rendreRésumé(totaux(0));
  const avec = rendreRésumé(totaux(118, 1, 27, 0.5));
  const àNouveauVide = rendreRésumé(totaux(0));
  assert.equal(àNouveauVide, vide, "revenir à zéro redonne exactement l'écran de départ");
  assert.notEqual(avec, vide);
  assert.ok(!CODE_PROGRESS.includes("useState"), "aucun état local à désynchroniser");
});

await test("A5-DAY12. modifier une quantité met à jour le résumé", () => {
  const cent = rendreRésumé(totaux(500, 30, 60, 15));
  const deuxCents = rendreRésumé(totaux(1000, 60, 120, 30));
  assert.notEqual(cent, deuxCents);
  assert.ok(deuxCents.includes(nombre(1000)));

  // ⚠️ AUCUN CALCUL DE MACRO ICI. Le composant reçoit des totaux déjà établis
  // et n'en fait qu'une géométrie : réécrire le 4/4/9 créerait une TROISIÈME
  // implémentation, à côté de `kcalFromMacros` et de `consommation_du_jour`.
  for (const interdit of ["* 4", "* 9", "kcalFromMacros", "KCAL_PER_GRAM", "entries"]) {
    assert.ok(!CODE_PROGRESS.includes(interdit), `« ${interdit} » dans le résumé`);
  }
  // Et la source des deux nombres est bien celle qui existait déjà.
  assert.ok(CODE_SEMAINE.includes("consommé={totalsForDay(repasDuJour)}"));
  assert.ok(CODE_SEMAINE.includes("kcal: cibles.calories.totalCalories"));
});

/* ══════════════════════════════════════════════════════════════════════════
   A5-DAY13..15 — LES CAS LIMITES ET LE MOBILE
   ══════════════════════════════════════════════════════════════════════════ */

await test("A5-DAY13. un jour sans consommation fonctionne", () => {
  const p = calculerProgression(0, 2000);
  assert.equal(p.part, 0);
  assert.equal(p.restant, 2000);
  assert.equal(p.depasse, false);

  const html = rendreRésumé(totaux(0));
  assert.ok(html.includes(">0<"), "un zéro s'affiche, pas un vide");
  assert.ok(html.includes(nombre(2000)), "l'objectif reste visible");
  assert.ok(html.includes('style="width:0%"'), "les barres sont vides, pas absentes");
});

await test("A5-DAY14. un objectif nul ou absent ne produit JAMAIS NaN ni Infinity", () => {
  for (const cible of [null, 0, -100, Number.NaN, Number.POSITIVE_INFINITY]) {
    const p = calculerProgression(1200, cible as number | null);
    assert.equal(p.cible, null, `cible ${String(cible)} → aucun objectif`);
    assert.equal(p.part, 0);
    assert.equal(p.restant, null);
    assert.equal(p.depasse, false);
    assert.ok(Number.isFinite(p.part) && Number.isFinite(p.consomme));
  }

  // Et un consommé corrompu ne fait pas disparaître le tracé : un `NaN` dans
  // `stroke-dashoffset` efface le cercle entier, sans message d'erreur.
  for (const consommé of [Number.NaN, Number.POSITIVE_INFINITY, Number.NEGATIVE_INFINITY]) {
    const p = calculerProgression(consommé, 2000);
    assert.equal(p.consomme, 0);
    assert.ok(Number.isFinite(anneau(52, p.part).dashOffset));
  }
  assert.equal(largeurBarre(Number.NaN), "0%");
  assert.ok(Number.isFinite(anneau(Number.NaN, 0.5).dashOffset));

  // Le rendu SANS objectif : la consommation seule, aucun « / null ».
  const html = renderToString(
    createElement(DailyNutritionProgress, { objectif: null, consommé: totaux(1200, 80, 100, 40) }),
  );
  assert.ok(html.includes(nombre(1200)));
  assert.ok(!html.includes("NaN") && !html.includes("Infinity"));
  assert.ok(!html.includes("null"));
  assert.ok(!html.includes("restantes"), "aucun restant sans objectif");
});

await test("A5-DAY15. la navigation mobile est légère — scroll-snap, aucune bibliothèque", () => {
  assert.ok(CODE_CARROUSEL.includes("snap-x snap-mandatory"));
  assert.ok(CODE_CARROUSEL.includes("overflow-x-auto"));
  assert.ok(CODE_CARROUSEL.includes("snap-start"));

  // AUCUNE bibliothèque de carrousel, ni d'animation.
  const paquet = JSON.parse(lire("../../package.json")) as {
    dependencies: Record<string, string>;
  };
  for (const interdit of ["swiper", "framer-motion", "embla-carousel", "react-slick", "keen-slider"]) {
    assert.ok(!(interdit in paquet.dependencies), `« ${interdit} » installé`);
    assert.ok(!CODE_CARROUSEL.includes(interdit));
  }

  // `scrollTo` sur la PISTE, et non `scrollIntoView` sur l'enfant : ce dernier
  // fait aussi défiler la PAGE, ce qui ferait sauter l'écran à l'ouverture.
  assert.ok(CODE_CARROUSEL.includes("piste.scrollTo("));
  assert.ok(!CODE_CARROUSEL.includes("scrollIntoView"));

  // Le placement initial n'a lieu QU'UNE fois : sinon tout défilement de
  // l'élève serait annulé au rendu suivant.
  assert.ok(CODE_CARROUSEL.includes("if (placé.current) return"));

  // Aucune largeur fixe : sur 375 px comme sur un grand écran, un jour occupe
  // la largeur disponible et rien ne déborde horizontalement.
  assert.ok(CODE_CARROUSEL.includes("w-full flex-shrink-0"));
  assert.ok(!/w-\[\d+px\]/.test(CODE_CARROUSEL), "aucune largeur en pixels");

  // Et des flèches pour la souris, qui n'a pas de geste de glissement.
  const html = rendreCarrousel("2026-08-13");
  assert.ok(html.includes('aria-label="Jour précédent"'));
  assert.ok(html.includes('aria-label="Jour suivant"'));
});

/* ── Cohérence du harnais ──────────────────────────────────────────────── */

await test("A5-DAY-SUP. le dépouillement des commentaires n'a rien vidé", () => {
  assert.ok(CODE_PROGRESS.includes("export function DailyNutritionProgress"));
  assert.ok(CODE_PROGRESS.includes("export function CalorieRing"));
  assert.ok(CODE_PROGRESS.includes("export function MacroProgressBar"));
  assert.ok(CODE_PROGRESS.length > 2000);
  // Et il a bien retiré la prose : l'en-tête du fichier n'y est plus.
  const source = lire("../../components/student/DailyNutritionProgress.tsx");
  assert.ok(source.includes("UNE HIÉRARCHIE, PAS UN TABLEAU DE BORD"));
  assert.ok(!CODE_PROGRESS.includes("UNE HIÉRARCHIE, PAS UN TABLEAU DE BORD"));
  // ⚠️ ET LE MOT INTERDIT PAR A5-DAY12 N'EST PAS DANS LA PROSE NON PLUS : ce
  // contrôle-là serait vert pour la mauvaise raison si le fichier ne parlait
  // jamais de macros. Il en parle — « Aucun 4/4/9 n'est réécrit ici » — sans
  // jamais en calculer.
  assert.ok(source.includes("Aucun 4/4/9 n'est réécrit ici"));
  assert.ok(!source.includes("kcalFromMacros"), "le composant ne nomme même pas le calcul");
});
