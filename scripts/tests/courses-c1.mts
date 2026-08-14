/**
 * Harnais — COURSES C1 : GÉNÉRATION D'UNE LISTE SUR 1 À 7 JOURS.
 *
 * ────────────────────────────────────────────────────────────────────────────
 * TOUT EST APPELÉ POUR DE VRAI
 * ────────────────────────────────────────────────────────────────────────────
 * Le moteur C1 est PUR : ni React, ni Supabase, ni réseau. Ces tests
 * l'exécutent donc réellement — période, préférences, sélection, solveur,
 * agrégation — sur un banc de recettes construit à la main. Aucun test ne se
 * contente de relire le code là où il peut faire tourner la fonction.
 *
 * Le solveur, lui, n'est PAS simulé : `genererCourses` appelle le vrai
 * `solveRecipe`, avec ses bornes et ses unités. C'est ce qui rend C1-15 et
 * C1-16 probants.
 *
 * Lancement : npm run test:courses-c1
 */
import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";
import test from "node:test";

import {
  agregerCourses,
  cleAgregation,
  identiteDuBesoin,
  type BesoinBrut,
} from "../../lib/courses/agregation";
import {
  besoinDeLIngredient,
  genererCourses,
  modeRecommande,
  rayonDeLIngredient,
  uniteDepuisLibelle,
  type EntreeGeneration,
} from "../../lib/courses/besoins";
import {
  type PeriodeCourses,
  construirePeriode,
  joursDeLaPeriode,
  jourTypeDe,
  libellePeriode,
  totauxDeLaPeriode,
} from "../../lib/courses/periode";
import {
  PREFERENCES_VIDES,
  correspond,
  enviesNormalisees,
  estExclu,
  normaliserLibelle,
  type PreferencesCourses,
} from "../../lib/courses/preferences";
import { choisirRecette, classerRecettes, CONTEXTE_VIDE } from "../../lib/courses/selection";
import type { PlanV2Week } from "../../lib/nutrition/plan-v2-week";
import type { RecipeWithTags } from "../../lib/nutrition/recipe-rows";
import type { Recipe, RecipeIngredient } from "../../lib/nutrition/recipe-types";

function lire(chemin: string): string {
  return readFileSync(new URL(chemin, import.meta.url), "utf8");
}
/** Commentaires de LIGNE d'abord — voir la leçon `app/admin/**` d'A5.9. */
function sansProse(source: string): string {
  return source.replace(/(^|[^:])\/\/.*$/gm, "$1 ").replace(/\/\*[\s\S]*?\*\//g, " ");
}

const CODE_BESOINS = sansProse(lire("../../lib/courses/besoins.ts"));
const CODE_AGREGATION = sansProse(lire("../../lib/courses/agregation.ts"));
const CODE_PERIODE = sansProse(lire("../../lib/courses/periode.ts"));
const SOURCE_AGREGATION = lire("../../lib/courses/agregation.ts");

/* ══════════════════════════════════════════════════════════════════════════
   LE BANC — un plan à deux profils, quatre recettes
   ══════════════════════════════════════════════════════════════════════════ */

function ing(
  id: string,
  name: string,
  role: RecipeIngredient["role"],
  p: number,
  c: number,
  f: number,
  extra: Partial<RecipeIngredient> = {},
): RecipeIngredient {
  return {
    id,
    name,
    role,
    proteinPer100g: p,
    carbPer100g: c,
    fatPer100g: f,
    referenceGrams: 100,
    minGrams: 20,
    maxGrams: 400,
    ...extra,
  };
}

function recette(
  id: string,
  name: string,
  slot: RecipeWithTags["slotKey"],
  ingredients: readonly RecipeIngredient[],
): RecipeWithTags {
  const r: Recipe = { id, name, slot, ingredients };
  return {
    recipe: r,
    slotKey: slot,
    status: "active",
    tags: [],
    description: null,
    sourceKey: null,
    imagePath: null,
    updatedAt: "2026-08-14T00:00:00.000Z",
  };
}

const POULET_RIZ = recette("r-poulet", "Poulet riz", "lunch", [
  ing("i-poulet", "Poulet", "protein", 31, 0, 3.6),
  ing("i-riz", "Riz basmati", "carbohydrate", 2.7, 28, 0.3),
  ing("i-huile", "Huile d'olive", "fat", 0, 0, 100),
]);

const BOEUF_PATES = recette("r-boeuf", "Bœuf pâtes", "lunch", [
  ing("i-boeuf", "Bœuf 5 %", "protein", 26, 0, 5),
  ing("i-pates", "Pâtes", "carbohydrate", 12, 71, 1.5),
  ing("i-huile2", "Huile de colza", "fat", 0, 0, 100),
]);

const SAUMON_RIZ = recette("r-saumon", "Saumon riz", "lunch", [
  ing("i-saumon", "Saumon", "protein", 20, 0, 13),
  ing("i-riz2", "Riz basmati", "carbohydrate", 2.7, 28, 0.3),
  ing("i-huile3", "Huile d'olive", "fat", 0, 0, 100),
]);

const PANCAKES = recette("r-pancakes", "Pancakes protéinés", "breakfast", [
  ing("i-whey", "Whey", "protein", 80, 6, 6),
  ing("i-flocons", "Flocons d'avoine", "carbohydrate", 13, 60, 7),
  ing("i-beurre", "Beurre de cacahuète", "fat", 25, 12, 50),
]);

const RECETTES = [POULET_RIZ, BOEUF_PATES, SAUMON_RIZ, PANCAKES];

/** Deux profils, donc deux jours qui n'ont PAS les mêmes cibles. */
const SEMAINE: PlanV2Week = {
  planId: "plan-1",
  profiles: [
    {
      profileKey: "repos",
      dailyCalories: 2000,
      proteinBp: 3000,
      carbBp: 4000,
      fatBp: 3000,
      slots: [
        { slot: "breakfast", enabled: true, proteinBp: 4000, carbBp: 4000, fatBp: 4000, displayOrder: 0 },
        { slot: "lunch", enabled: true, proteinBp: 6000, carbBp: 6000, fatBp: 6000, displayOrder: 1 },
      ],
    },
    {
      profileKey: "entrainement",
      dailyCalories: 3000,
      proteinBp: 3000,
      carbBp: 4000,
      fatBp: 3000,
      slots: [
        { slot: "breakfast", enabled: true, proteinBp: 4000, carbBp: 4000, fatBp: 4000, displayOrder: 0 },
        { slot: "lunch", enabled: true, proteinBp: 6000, carbBp: 6000, fatBp: 6000, displayOrder: 1 },
      ],
    },
  ],
  days: (
    ["monday", "tuesday", "wednesday", "thursday", "friday", "saturday", "sunday"] as const
  ).map((jour, i) => ({
    id: `d-${jour}`,
    day: jour,
    // Un jour sur deux change de profil : c'est ce qui rend la moyenne fausse.
    profileKey: i % 2 === 0 ? "repos" : "entrainement",
    status: "non-commence" as const,
    meals: [],
  })),
};

function entree(partiel: Partial<EntreeGeneration> = {}): EntreeGeneration {
  const periode = construirePeriode("2026-08-14", 3);
  assert.ok(periode);
  return {
    jours: joursDeLaPeriode(periode, SEMAINE),
    week: SEMAINE,
    recettes: RECETTES,
    preferences: PREFERENCES_VIDES,
    favoris: [],
    habitudes: {},
    mode: "plan_envies",
    ...partiel,
  };
}

function avecEnvies(envies: Partial<PreferencesCourses["envies"]>, exclusions: string[] = []): PreferencesCourses {
  return {
    envies: { ...PREFERENCES_VIDES.envies, ...envies },
    exclusions,
  };
}

/* ══════════════════════════════════════════════════════════════════════════
   C1-01..C1-05 — LA PÉRIODE
   ══════════════════════════════════════════════════════════════════════════ */

await test("C1-01. 1 jour = 1 date exacte", () => {
  const p = construirePeriode("2026-08-14", 1);
  assert.ok(p);
  assert.deepEqual([...p.dates], ["2026-08-14"]);
  assert.equal(libellePeriode(p), "le 14 août");
  assert.equal(jourTypeDe("2026-08-14"), "friday");

  // Les bornes du §1 sont fermes des deux côtés.
  assert.equal(construirePeriode("2026-08-14", 0), null);
  assert.equal(construirePeriode("2026-08-14", 8), null);
  assert.equal(construirePeriode("2026-08-14", 1.5), null);
  // Et une date illisible ne fabrique pas une période imaginaire.
  assert.equal(construirePeriode("14/08/2026", 3), null);
  assert.equal(construirePeriode("2026-02-31", 3), null, "le 31 février est refusé");
});

await test("C1-02. 7 jours = 7 dates exactes", () => {
  const p = construirePeriode("2026-08-14", 7);
  assert.ok(p);
  assert.equal(p.dates.length, 7);
  assert.deepEqual(
    [...p.dates],
    ["2026-08-14", "2026-08-15", "2026-08-16", "2026-08-17", "2026-08-18", "2026-08-19", "2026-08-20"],
  );
  // ⚠️ Une période traverse les mois et les années sans arithmétique maison.
  assert.deepEqual([...(construirePeriode("2026-08-30", 3) as PeriodeCourses).dates], [
    "2026-08-30",
    "2026-08-31",
    "2026-09-01",
  ]);
  assert.deepEqual([...(construirePeriode("2026-12-30", 4) as PeriodeCourses).dates], [
    "2026-12-30",
    "2026-12-31",
    "2027-01-01",
    "2027-01-02",
  ]);
  // Le 29 février d'une année bissextile existe.
  assert.deepEqual([...(construirePeriode("2028-02-28", 2) as PeriodeCourses).dates], [
    "2028-02-28",
    "2028-02-29",
  ]);
});

await test("C1-03. la date de départ est personnalisable", () => {
  const lundi = construirePeriode("2026-08-17", 7);
  assert.ok(lundi);
  assert.equal(lundi.dates[0], "2026-08-17");
  assert.equal(lundi.dates[6], "2026-08-23");
  assert.equal(jourTypeDe("2026-08-17"), "monday");
  assert.equal(jourTypeDe("2026-08-23"), "sunday", "dimanche est le 7e jour, pas le 1er");

  // Une période peut commencer n'importe quel jour, y compris un dimanche.
  const dimanche = construirePeriode("2026-08-16", 3);
  assert.ok(dimanche);
  assert.deepEqual(
    joursDeLaPeriode(dimanche, SEMAINE).map((j) => j.jour),
    ["sunday", "monday", "tuesday"],
  );
});

await test("C1-04. chaque jour garde SES propres cibles", () => {
  const p = construirePeriode("2026-08-17", 3); // lundi, mardi, mercredi
  assert.ok(p);
  const jours = joursDeLaPeriode(p, SEMAINE);

  // Lundi = « repos » (2 000 kcal), mardi = « entrainement » (3 000).
  assert.equal(jours[0].cibles?.dailyCalories, 2000);
  assert.equal(jours[1].cibles?.dailyCalories, 3000);
  assert.equal(jours[2].cibles?.dailyCalories, 2000);
  assert.notEqual(jours[0].cibles?.grams.proteinGrams, jours[1].cibles?.grams.proteinGrams);
});

await test("C1-05. aucune moyenne hebdomadaire n'est inventée", () => {
  const p = construirePeriode("2026-08-17", 3);
  assert.ok(p);
  const jours = joursDeLaPeriode(p, SEMAINE);
  const totaux = totauxDeLaPeriode(jours);

  // La somme est celle des TROIS jours réels : 2 000 + 3 000 + 2 000.
  const attendu =
    (jours[0].cibles?.grams.proteinGrams ?? 0) +
    (jours[1].cibles?.grams.proteinGrams ?? 0) +
    (jours[2].cibles?.grams.proteinGrams ?? 0);
  assert.ok(Math.abs(totaux.proteinGrams - attendu) < 1e-9);

  // ⚠️ ET SURTOUT : ce n'est PAS le premier jour × 3.
  const moyenneFausse = (jours[0].cibles?.grams.proteinGrams ?? 0) * 3;
  assert.notEqual(Math.round(totaux.proteinGrams), Math.round(moyenneFausse));

  // Le module ne contient aucune multiplication par le nombre de jours.
  assert.ok(!/\*\s*nbJours/.test(CODE_PERIODE));
  assert.ok(!/nbJours\s*\*/.test(CODE_PERIODE));
  assert.ok(CODE_PERIODE.includes("jours.reduce"), "la somme est une addition");
});

/* ══════════════════════════════════════════════════════════════════════════
   C1-06..C1-12 — ENVIES, EXCLUSIONS, FAVORIS, HABITUDES
   ══════════════════════════════════════════════════════════════════════════ */

await test("C1-06. une préférence poulet influence réellement la sélection", () => {
  const sans = choisirRecette([POULET_RIZ, BOEUF_PATES, SAUMON_RIZ], CONTEXTE_VIDE);
  const avec = choisirRecette([POULET_RIZ, BOEUF_PATES, SAUMON_RIZ], {
    ...CONTEXTE_VIDE,
    envies: ["poulet"],
  });
  assert.equal(avec?.recette.recipe.id, "r-poulet");
  assert.ok(avec !== null && sans !== null);
  assert.ok(avec.score > sans.score, "l'envie a bien pesé");

  // Et elle a pesé par l'INGRÉDIENT, pas par le titre : une recette dont le nom
  // ne contient pas « poulet » mais qui en contient gagnerait de même.
  const déguisée = recette("r-x", "Bowl du sportif", "lunch", [
    ing("i-p", "Poulet", "protein", 31, 0, 3.6),
    ing("i-r", "Riz basmati", "carbohydrate", 2.7, 28, 0.3),
    ing("i-h", "Huile d'olive", "fat", 0, 0, 100),
  ]);
  const gagnante = choisirRecette([BOEUF_PATES, déguisée], { ...CONTEXTE_VIDE, envies: ["poulet"] });
  assert.equal(gagnante?.recette.recipe.id, "r-x", "le score regarde les ingrédients");
});

await test("C1-07. une préférence bœuf reste un FILTRE, jamais une identité", () => {
  const r = genererCourses(
    entree({ preferences: avecEnvies({ viandes: ["Bœuf"] }), mode: "plan_envies" }),
  );

  // Le bœuf a bien orienté le choix…
  assert.ok(r.repas.some((x) => x.recetteId === "r-boeuf"));
  // …mais AUCUNE ligne générique « Bœuf » n'a été inventée : la ligne porte le
  // libellé réel de l'ingrédient de la recette.
  const lignes = r.lignes.map((l) => l.label);
  assert.ok(lignes.includes("Bœuf 5 %"), "l'aliment réel, avec son libellé");
  assert.ok(!lignes.includes("Bœuf"), "aucune ligne inventée depuis l'envie");

  // Et toute ligne a une identité traçable, jamais « l'envie » elle-même.
  for (const l of r.lignes) {
    assert.ok(
      l.identity.startsWith("catalog_food:") ||
        l.identity.startsWith("product:") ||
        l.identity.startsWith("recipe_ingredient:"),
      `identité douteuse : ${l.identity}`,
    );
  }
  // Le moteur n'importe même pas les envies comme source de ligne.
  assert.ok(!CODE_BESOINS.includes("envies.map"));
});

await test("C1-08. une exclusion temporaire supprime un candidat", () => {
  const ctx = { ...CONTEXTE_VIDE, exclusions: ["poulet"] };
  const classées = classerRecettes([POULET_RIZ, BOEUF_PATES], ctx);
  assert.equal(classées.length, 1, "la recette au poulet a disparu");
  assert.equal(classées[0].recette.recipe.id, "r-boeuf");

  // Bout en bout : aucun poulet dans la liste finale.
  const r = genererCourses(
    entree({ preferences: { envies: PREFERENCES_VIDES.envies, exclusions: ["Poulet"] } }),
  );
  assert.ok(!r.lignes.some((l) => /poulet/i.test(l.label)));
  assert.ok(!r.repas.some((x) => x.recetteId === "r-poulet"));

  // ⚠️ ET L'EXCLUSION L'EMPORTE SUR L'ENVIE. Un élève qui exclut le poulet et
  // le coche par ailleurs a changé d'avis ; le refus est le choix sûr.
  const conflit = classerRecettes([POULET_RIZ], { ...CONTEXTE_VIDE, envies: ["poulet"], exclusions: ["poulet"] });
  assert.equal(conflit.length, 0);

  // La correspondance est par MOT ENTIER : « riz » n'exclut pas « chorizo ».
  assert.equal(estExclu("Chorizo", ["riz"]), false);
  assert.equal(estExclu("Riz basmati", ["riz"]), true);
  assert.equal(correspond("Bananes", "banane"), true, "le pluriel simple est toléré");
});

await test("C1-09. une exclusion ne modifie AUCUN profil", () => {
  // Structurel : le moteur n'importe aucune écriture, ni profil, ni allergie.
  for (const interdit of [
    "student_profiles",
    "allergie",
    "restrictions",
    "supabase",
    "rpc(",
    "insert",
    "update(",
    "delete(",
  ]) {
    assert.ok(!CODE_BESOINS.includes(interdit), `« ${interdit} » dans le moteur`);
  }
  // Les exclusions vivent dans l'objet de préférences, passé en argument, et
  // rien ne les écrit ailleurs.
  const prefs: PreferencesCourses = { envies: PREFERENCES_VIDES.envies, exclusions: ["Poulet"] };
  const avant = JSON.stringify(prefs);
  genererCourses(entree({ preferences: prefs }));
  assert.equal(JSON.stringify(prefs), avant, "les préférences reçues sont intactes");
  assert.deepEqual([...PREFERENCES_VIDES.exclusions], [], "le modèle vide n'a pas bougé");
});

await test("C1-10. un favori départage deux candidats compatibles", () => {
  const sans = classerRecettes([POULET_RIZ, BOEUF_PATES], CONTEXTE_VIDE);
  // Sans signal, l'ordre est alphabétique : « Bœuf pâtes » avant « Poulet riz ».
  assert.equal(sans[0].recette.recipe.id, "r-boeuf");

  const avec = choisirRecette([POULET_RIZ, BOEUF_PATES], { ...CONTEXTE_VIDE, favoris: ["Poulet"] });
  assert.equal(avec?.recette.recipe.id, "r-poulet", "le favori a départagé");
  assert.equal(avec?.favoris, 1);

  // ⚠️ MAIS UN FAVORI NE BAT PAS UNE ENVIE. La hiérarchie du §6 est un ordre,
  // pas une suggestion.
  const arbitrage = choisirRecette([POULET_RIZ, BOEUF_PATES], {
    ...CONTEXTE_VIDE,
    envies: ["boeuf"],
    favoris: ["Poulet"],
  });
  assert.equal(arbitrage?.recette.recipe.id, "r-boeuf", "l'envie l'emporte sur le favori");
});

await test("C1-11. une habitude départage quand aucune envie n'est exprimée", () => {
  const avec = choisirRecette([POULET_RIZ, BOEUF_PATES], {
    ...CONTEXTE_VIDE,
    habitudes: { poulet: 5 },
  });
  assert.equal(avec?.recette.recipe.id, "r-poulet");
  assert.equal(avec?.habitudes, 1);

  // ⚠️ UNE HABITUDE COMPTE POUR SA PRÉSENCE, PAS POUR SON VOLUME. Sans ce
  // plafonnement, un aliment consommé quarante fois écraserait une envie
  // explicite — l'inverse exact de la hiérarchie du §6.
  const contreEnvie = choisirRecette([POULET_RIZ, BOEUF_PATES], {
    ...CONTEXTE_VIDE,
    envies: ["boeuf"],
    habitudes: { poulet: 40, riz: 40, "huile d olive": 40 },
  });
  assert.equal(contreEnvie?.recette.recipe.id, "r-boeuf", "l'envie reste prioritaire");
});

await test("C1-12. « peu importe » fonctionne sans aucune préférence", () => {
  const r = genererCourses(entree({ preferences: PREFERENCES_VIDES, mode: "plan_habitudes" }));
  assert.ok(r.lignes.length > 0, "une liste est produite quand même");
  assert.ok(r.repas.length > 0);
  assert.equal(enviesNormalisees(PREFERENCES_VIDES).length, 0);

  // Le mode recommandé bascule tout seul, comme le veut le §9.
  assert.equal(modeRecommande(PREFERENCES_VIDES), "plan_habitudes");
  assert.equal(modeRecommande(avecEnvies({ viandes: ["Poulet"] })), "plan_envies");
});

/* ══════════════════════════════════════════════════════════════════════════
   MODE-1..MODE-4 — LE CONTRAT DES TROIS MODES
   ══════════════════════════════════════════════════════════════════════════ */

/**
 * Un banc taillé pour LE seul point qui compte ici : chaque signal doit, à lui
 * seul, faire basculer le choix. Sans envie, sans favori et sans habitude,
 * l'ordre est alphabétique — « Bœuf pâtes » gagne. Tout écart par rapport à ce
 * témoin est donc imputable au signal testé, et à rien d'autre.
 */
const TEMOIN_SANS_SIGNAL = "r-boeuf";

function choixDejeuner(mode: EntreeGeneration["mode"], partiel: Partial<EntreeGeneration>): string {
  const r = genererCourses(entree({ ...partiel, mode }));
  const d = r.repas.find((x) => x.slot === "lunch");
  assert.ok(d, "un déjeuner doit être retenu");
  return d.recetteId;
}

await test("MODE-1. une envie poulet influence plan_envies", () => {
  assert.equal(
    choixDejeuner("plan_envies", { preferences: avecEnvies({ viandes: ["Poulet"] }) }),
    "r-poulet",
  );
  // Témoin : sans le signal, ce n'est pas ce choix-là.
  assert.equal(choixDejeuner("plan_envies", {}), TEMOIN_SANS_SIGNAL);
});

await test("MODE-2. la MÊME envie n'influence PAS plan_habitudes", () => {
  // ⚠️ LE BUG CORRIGÉ PAR CE LOT. `plan_habitudes` écoutait encore les envies :
  // les deux modes rendaient donc la même liste dès qu'une envie était cochée,
  // et le choix offert à l'élève ne changeait rien à ce qu'il recevait.
  assert.equal(
    choixDejeuner("plan_habitudes", { preferences: avecEnvies({ viandes: ["Poulet"] }) }),
    TEMOIN_SANS_SIGNAL,
    "l'envie doit être ignorée en mode habitudes",
  );
  // Et la preuve que le banc discrimine : la même envie DÉPLACE bien le choix
  // dans l'autre mode.
  assert.notEqual(
    choixDejeuner("plan_habitudes", { preferences: avecEnvies({ viandes: ["Poulet"] }) }),
    choixDejeuner("plan_envies", { preferences: avecEnvies({ viandes: ["Poulet"] }) }),
  );
});

await test("MODE-3. favoris et habitudes influencent plan_habitudes", () => {
  assert.equal(choixDejeuner("plan_habitudes", { favoris: ["Poulet"] }), "r-poulet");
  assert.equal(choixDejeuner("plan_habitudes", { habitudes: { poulet: 5 } }), "r-poulet");
  // Les deux ensemble ne se contredisent pas.
  assert.equal(
    choixDejeuner("plan_habitudes", { favoris: ["Saumon"], habitudes: { saumon: 3 } }),
    "r-saumon",
  );
});

await test("MODE-4. ni envie, ni favori, ni habitude n'influencent plan_seul", () => {
  // Les trois signaux, ensemble, ne doivent RIEN changer.
  assert.equal(
    choixDejeuner("plan_seul", {
      preferences: avecEnvies({ viandes: ["Poulet"] }),
      favoris: ["Poulet"],
      habitudes: { poulet: 40 },
    }),
    TEMOIN_SANS_SIGNAL,
  );
  // Chacun séparément non plus.
  assert.equal(choixDejeuner("plan_seul", { favoris: ["Saumon"] }), TEMOIN_SANS_SIGNAL);
  assert.equal(choixDejeuner("plan_seul", { habitudes: { saumon: 9 } }), TEMOIN_SANS_SIGNAL);

  // ⚠️ MAIS LES EXCLUSIONS RESTENT ACTIVES, DANS LES TROIS MODES. « Éviter »
  // n'est pas une préférence de confort : c'est un refus, et l'ignorer en
  // « plan uniquement » mettrait sur la liste ce que l'élève vient d'écarter.
  const exclu = genererCourses(
    entree({
      mode: "plan_seul",
      preferences: { envies: PREFERENCES_VIDES.envies, exclusions: ["Bœuf 5 %"] },
    }),
  );
  assert.ok(!exclu.repas.some((x) => x.recetteId === "r-boeuf"));
  assert.ok(!exclu.lignes.some((l) => /bœuf/i.test(l.label)));
});

/* ══════════════════════════════════════════════════════════════════════════
   C1-CAT-01..08 — LE RAYON D'UN LIBELLÉ QUI DÉMENT SES PROPRES MOTS

   Défaut observé en Preview : « Pommes de terre (frites au four) » sortait au
   rayon FRUITS. La règle générique travaille mot à mot, et le mot « pommes »
   est réellement présent — aucun ordre entre règles génériques ne pouvait le
   corriger. Une couche d'expressions passe désormais avant elles.
   ══════════════════════════════════════════════════════════════════════════ */

/** Le rôle réel de ces ingrédients en base ; le libellé doit primer dessus. */
const rayon = (nom: string, role: RecipeIngredient["role"] = "fixed") =>
  rayonDeLIngredient({ role, name: nom });

await test("C1-CAT-01. « Pomme » reste un fruit", () => {
  assert.equal(rayon("Pomme"), "fruits");
});

await test("C1-CAT-02. « Pomme fraîche » reste un fruit", () => {
  assert.equal(rayon("Pomme fraîche"), "fruits");
});

await test("C1-CAT-03. « Pommes de terre » est un féculent", () => {
  assert.equal(rayon("Pommes de terre"), "feculents");
  // Le singulier aussi — le coach écrit l'un ou l'autre.
  assert.equal(rayon("Pomme de terre"), "feculents");
  assert.equal(rayon("Pomme de terre cuite"), "feculents");
});

await test("C1-CAT-04. « Pommes de terre (frites au four) » est un féculent", () => {
  assert.equal(rayon("Pommes de terre (frites au four)"), "feculents");
  // ⚠️ ET QUEL QUE SOIT LE RÔLE. Le libellé dit ce qu'est l'aliment ; un
  // ingrédient `fixed` n'a pas de rôle qui parle du rayon.
  for (const role of ["fixed", "free", "carbohydrate", "protein", "fat"] as const) {
    assert.equal(rayon("Pommes de terre (frites au four)", role), "feculents");
  }
});

await test("C1-CAT-05. « Pommes de terre (potatoes au four) » est un féculent", () => {
  assert.equal(rayon("Pommes de terre (potatoes au four)"), "feculents");
  assert.equal(rayon("Potatoes"), "feculents");
  assert.equal(rayon("Potato wedges"), "feculents");
});

await test("C1-CAT-06. « Patate douce » est un féculent", () => {
  assert.equal(rayon("Patate douce"), "feculents");
  assert.equal(rayon("Patates douces"), "feculents");
});

await test("C1-CAT-07. « Banane » reste un fruit", () => {
  assert.equal(rayon("Banane"), "fruits");
  assert.equal(rayon("Bananes"), "fruits");
});

await test("C1-CAT-08. « Riz basmati cru » reste un féculent", () => {
  // Son rôle en base EST `carbohydrate` : le rayon vient de là, et la couche
  // d'expressions ne l'a pas détourné.
  assert.equal(rayon("Riz basmati cru", "carbohydrate"), "feculents");
});

await test("C1-CAT-SUP. la reconnaissance porte sur des MOTS, pas des caractères", () => {
  // ⚠️ SONDE DU MÉCANISME, ET ELLE EST ASSUMÉE COMME TELLE. Un premier
  // contre-exemple (« Patatras », « Compomme ») avait été écrit ici : remplacer
  // la comparaison mot à mot par un `includes` de chaîne le laissait VERT, donc
  // il ne prouvait rien. « Terreau » est un vrai mot français, et il est le
  // seul à discriminer : en sous-chaîne, « pomme de terreau » contient
  // « pomme de terre » ; en mots entiers, « terreau » n'est pas « terre ».
  assert.equal(rayon("Pomme de terreau"), "fruits");
  assert.equal(rayon("Patatras"), "autres");
  // Et la règle générique des fruits reste intacte pour les autres fruits.
  assert.equal(rayon("Fraises"), "fruits");
  assert.equal(rayon("Myrtilles"), "fruits");
  // La table reste courte : c'est une liste d'exceptions, pas un dictionnaire.
  assert.ok(
    (CODE_BESOINS.match(/"feculents"\]/g) ?? []).length <= 12,
    "la table d'expressions grossit — elle deviendrait un second système",
  );
});

/* ══════════════════════════════════════════════════════════════════════════
   C1-13..C1-14 — VARIÉTÉ
   ══════════════════════════════════════════════════════════════════════════ */

await test("C1-13. la répétition est limitée quand des alternatives existent", () => {
  const r = genererCourses(entree({ jours: joursDeLaPeriode(construirePeriode("2026-08-17", 7)!, SEMAINE) }));
  const déjeuners = r.repas.filter((x) => x.slot === "lunch").map((x) => x.recetteId);
  assert.equal(déjeuners.length, 7);
  const distinctes = new Set(déjeuners);
  assert.ok(
    distinctes.size >= 2,
    `sept déjeuners identiques alors que trois recettes existent : ${[...distinctes].join(", ")}`,
  );
});

await test("C1-14. une préférence unique autorise la répétition", () => {
  // ⚠️ LA MOITIÉ FRAGILE DE LA RÈGLE. La pénalité de répétition est PLAFONNÉE
  // précisément pour ça : un élève qui ne veut que du poulet doit avoir du
  // poulet, pas une recette qu'il n'a pas demandée au 4e jour.
  const r = genererCourses(
    entree({
      jours: joursDeLaPeriode(construirePeriode("2026-08-17", 7)!, SEMAINE),
      preferences: avecEnvies({ viandes: ["Poulet"] }),
    }),
  );
  const déjeuners = r.repas.filter((x) => x.slot === "lunch");
  assert.equal(déjeuners.length, 7);
  assert.ok(
    déjeuners.every((x) => x.recetteId === "r-poulet"),
    `l'envie unique doit tenir les sept jours : ${déjeuners.map((x) => x.recetteId).join(", ")}`,
  );
});

/* ══════════════════════════════════════════════════════════════════════════
   C1-15..C1-16 — LE SOLVEUR
   ══════════════════════════════════════════════════════════════════════════ */

await test("C1-15. solveRecipe est réellement utilisé", () => {
  assert.ok(CODE_BESOINS.includes("solveRecipe(choisie.recette.recipe"));
  assert.ok(CODE_BESOINS.includes('from "@/lib/nutrition/recipe-solver"'));

  // ⚠️ ET AUCUNE FORMULE DE PORTION N'EST RÉÉCRITE. Un second moteur, même
  // « simple », divergerait du premier au premier ajustement de borne.
  for (const interdit of ["* 4", "* 9", "/ 100", "minGrams", "maxGrams", "referenceGrams"]) {
    assert.ok(!CODE_BESOINS.includes(interdit), `« ${interdit} » recalculé dans le moteur`);
  }
  // Les cibles viennent elles aussi de l'existant.
  assert.ok(CODE_BESOINS.includes("buildRecipeTargetForMealSlot(profil, slot)"));
});

await test("C1-16. la recette est adaptée à la cible DU repas", () => {
  const p = construirePeriode("2026-08-17", 2); // lundi 2 000, mardi 3 000
  assert.ok(p);
  // ⚠️ ON FORCE LA MÊME RECETTE LES DEUX JOURS, sinon la pénalité de variété
  // en choisit une autre le second jour — et on comparerait deux plats au lieu
  // de deux cibles. C'est ce qu'a montré la première version de ce test.
  const r = genererCourses(
    entree({ jours: joursDeLaPeriode(p, SEMAINE), preferences: avecEnvies({ viandes: ["Poulet"] }) }),
  );

  const lundi = r.repas.filter((x) => x.date === "2026-08-17" && x.slot === "lunch");
  const mardi = r.repas.filter((x) => x.date === "2026-08-18" && x.slot === "lunch");
  assert.equal(lundi.length, 1);
  assert.equal(mardi.length, 1);
  assert.equal(lundi[0].recetteId, mardi[0].recetteId, "la même recette les deux jours");

  // Les deux jours n'ont pas la même cible : les quantités doivent différer.
  const quantite = (date: string, label: string) =>
    r.lignes
      .find((l) => l.label === label)
      ?.provenance.filter((v) => v.date === date)
      .reduce((n, v) => n + v.quantite, 0) ?? 0;

  // ⚠️ ON COMPARE UN INGRÉDIENT QUI PEUT VARIER. Le riz de ce banc sature son
  // `maxGrams` les DEUX jours : ses quantités sont donc légitimement égales, et
  // l'asserter aurait fait échouer un solveur parfaitement correct. C'est ce
  // qu'a montré la première version de ce test — la borne, pas la cible.
  const pouletLundi = quantite("2026-08-17", "Poulet");
  const pouletMardi = quantite("2026-08-18", "Poulet");
  assert.ok(pouletLundi > 0 && pouletMardi > 0, "du poulet les deux jours");
  assert.notEqual(
    Math.round(pouletLundi),
    Math.round(pouletMardi),
    "une journée à 3 000 kcal ne peut pas demander la même quantité qu'une à 2 000",
  );
  assert.ok(pouletMardi > pouletLundi, "et c'est le jour le plus calorique qui en demande le plus");

  // Le total du jour suit la cible, lui aussi.
  const totalJour = (date: string) =>
    r.lignes.reduce(
      (n, l) => n + l.provenance.filter((v) => v.date === date).reduce((m, v) => m + v.quantite, 0),
      0,
    );
  assert.ok(totalJour("2026-08-18") > totalJour("2026-08-17"));
});

/* ══════════════════════════════════════════════════════════════════════════
   C1-17..C1-25 — AGRÉGATION, IDENTITÉS, UNITÉS
   ══════════════════════════════════════════════════════════════════════════ */

function besoin(partiel: Partial<BesoinBrut> = {}): BesoinBrut {
  return {
    source: "recipe_ingredient",
    label: "Riz basmati",
    quantite: 200,
    unite: "g",
    categorie: "feculents",
    provenance: {
      date: "2026-08-14",
      slot: "lunch",
      recetteId: "r-1",
      recetteNom: "R",
      quantite: 200,
      unite: "g",
    },
    ...partiel,
  };
}

await test("C1-17. deux quantités en grammes s'additionnent", () => {
  const l = agregerCourses([besoin({ quantite: 200 }), besoin({ quantite: 300 })]);
  assert.equal(l.length, 1);
  assert.equal(l[0].quantite, 500);
  assert.equal(l[0].unite, "g");
  // Et la casse ou les accents du libellé ne créent pas deux lignes.
  const l2 = agregerCourses([besoin({ label: "Riz Basmati" }), besoin({ label: "riz  basmati" })]);
  assert.equal(l2.length, 1);
  assert.equal(l2[0].quantite, 400);
});

await test("C1-18. deux quantités en millilitres s'additionnent", () => {
  const l = agregerCourses([
    besoin({ label: "Lait", unite: "ml", quantite: 200 }),
    besoin({ label: "Lait", unite: "ml", quantite: 250 }),
  ]);
  assert.equal(l.length, 1);
  assert.equal(l[0].quantite, 450);
  assert.equal(l[0].unite, "ml");
});

await test("C1-19. deux quantités en pièces s'additionnent", () => {
  const l = agregerCourses([
    besoin({ label: "Œuf", unite: "piece", quantite: 2 }),
    besoin({ label: "Œuf", unite: "piece", quantite: 4 }),
  ]);
  assert.equal(l.length, 1);
  assert.equal(l[0].quantite, 6);
  assert.equal(l[0].unite, "piece");
});

await test("C1-20. g et ml ne sont JAMAIS fusionnés", () => {
  const l = agregerCourses([
    besoin({ label: "Lait", unite: "g", quantite: 200 }),
    besoin({ label: "Lait", unite: "ml", quantite: 200 }),
  ]);
  assert.equal(l.length, 2, "deux unités, deux lignes");
  assert.deepEqual(l.map((x) => x.unite).sort(), ["g", "ml"]);
  assert.ok(l.every((x) => x.quantite === 200), "aucune addition entre les deux");

  // C'est la CLÉ qui l'empêche, pas une précaution ailleurs.
  assert.notEqual(
    cleAgregation(besoin({ unite: "g" })),
    cleAgregation(besoin({ unite: "ml" })),
  );
  assert.ok(CODE_AGREGATION.includes("`${identiteDuBesoin(besoin)}|${besoin.unite}`"));
  // Aucune densité, aucun facteur de conversion nulle part.
  for (const interdit of ["densite", "density", "convert", "1.03", "mlVersG"]) {
    assert.ok(!CODE_AGREGATION.includes(interdit), `« ${interdit} » dans l'agrégation`);
  }
});

await test("C1-21. deux GTIN différents ne sont JAMAIS fusionnés", () => {
  // Le pire cas : libellé identique au mot près, deux fiches produit.
  const l = agregerCourses([
    besoin({ source: "product", productId: "p-500", gtin: "3001", label: "Yaourt nature", quantite: 500 }),
    besoin({ source: "product", productId: "p-1kg", gtin: "3002", label: "Yaourt nature", quantite: 1000 }),
  ]);
  assert.equal(l.length, 2, "deux produits, deux lignes — malgré le même nom");
  assert.deepEqual(l.map((x) => x.gtin).sort(), ["3001", "3002"]);

  // L'identité d'un produit est son identifiant, jamais son nom.
  assert.equal(identiteDuBesoin(besoin({ productId: "p-1" })), "product:p-1");
  assert.notEqual(
    identiteDuBesoin(besoin({ productId: "p-1", label: "X" })),
    identiteDuBesoin(besoin({ productId: "p-2", label: "X" })),
  );
});

await test("C1-22. deux catalog_food différents ne sont JAMAIS fusionnés", () => {
  const l = agregerCourses([
    besoin({ source: "catalog_food", catalogFoodId: "f-blanc", label: "Riz", quantite: 100 }),
    besoin({ source: "catalog_food", catalogFoodId: "f-complet", label: "Riz", quantite: 100 }),
  ]);
  assert.equal(l.length, 2);

  // Le TYPE est en préfixe : un même uuid dans deux tables reste deux choses.
  const même = "00000000-0000-4000-8000-000000000001";
  assert.notEqual(
    identiteDuBesoin(besoin({ catalogFoodId: même })),
    identiteDuBesoin(besoin({ productId: même })),
  );
});

await test("C1-23. la normalisation par libellé est BORNÉE aux ingrédients de recette", () => {
  // ⚠️ LE PIS-ALLER ASSUMÉ. Il existe parce qu'un ingrédient de recette n'a
  // aucune identité partagée — mesuré : 16 libellés présents dans plusieurs
  // recettes sur la base réelle. Il ne doit contaminer ni A3 ni A5.
  assert.equal(
    identiteDuBesoin(besoin({ source: "recipe_ingredient", label: "Riz basmati" })),
    "recipe_ingredient:riz basmati",
  );
  // Un catalog_food ou un product ne descend JAMAIS au libellé, même sans nom.
  assert.equal(
    identiteDuBesoin(besoin({ catalogFoodId: "f-1", label: "Riz basmati" })),
    "catalog_food:f-1",
  );
  assert.equal(
    identiteDuBesoin(besoin({ productId: "p-1", label: "Riz basmati" })),
    "product:p-1",
  );
  // La priorité est écrite dans cet ordre, et l'identifiant gagne toujours.
  assert.ok(CODE_AGREGATION.includes("if (besoin.catalogFoodId) return `catalog_food:"));
  assert.ok(CODE_AGREGATION.includes("if (besoin.productId) return `product:"));
});

await test("C1-24. 2 wraps + 4 wraps = 6 wraps", () => {
  const l = agregerCourses([
    besoin({ label: "Wrap", unite: "wrap", quantite: 2, categorie: "feculents" }),
    besoin({ label: "Wrap", unite: "wrap", quantite: 4, categorie: "feculents" }),
  ]);
  assert.equal(l.length, 1);
  assert.equal(l[0].quantite, 6);
  assert.equal(l[0].unite, "wrap");

  // Le nom d'unité est extrait du libellé du solveur, au singulier.
  assert.equal(uniteDepuisLibelle("2 wraps (64 g)"), "wrap");
  assert.equal(uniteDepuisLibelle("1 pain (60 g)"), "pain");
  assert.equal(uniteDepuisLibelle("3 tranches"), "tranche");
});

await test("C1-25. aucune conversion artificielle wraps → g", () => {
  const l = agregerCourses([
    besoin({ label: "Wrap", unite: "wrap", quantite: 2 }),
    besoin({ label: "Wrap", unite: "g", quantite: 64 }),
  ]);
  assert.equal(l.length, 2, "les wraps et les grammes restent séparés");

  // Un ingrédient quantifié en unités sort en unités, pas en grammes.
  const enUnites = besoinDeLIngredient(
    {
      ingredientId: "i", name: "Wrap", role: "fixed", grams: 64, displayGrams: 64,
      units: 2, unitLabel: "2 wraps (64 g)", eggCount: null,
      proteinGrams: 0, carbGrams: 0, fatGrams: 0, calories: 0,
      boundHit: null, pinned: false, linkedTo: null,
    },
    { date: "2026-08-14", slot: "lunch", recetteId: "r", recetteNom: "R" },
  );
  assert.equal(enUnites?.quantite, 2);
  assert.equal(enUnites?.unite, "wrap");
  assert.ok(!CODE_BESOINS.includes("gramsParUnite"));
});

/* ══════════════════════════════════════════════════════════════════════════
   C1-26..C1-30 — PÉRIMÈTRE, INNOCUITÉ, PROVENANCE, CAS VIDES
   ══════════════════════════════════════════════════════════════════════════ */

await test("C1-26. une période de 3 jours n'utilise jamais le jour 4", () => {
  const p = construirePeriode("2026-08-17", 3);
  assert.ok(p);
  const r = genererCourses(entree({ jours: joursDeLaPeriode(p, SEMAINE) }));

  assert.deepEqual([...r.dates], ["2026-08-17", "2026-08-18", "2026-08-19"]);
  const datesVues = new Set(r.repas.map((x) => x.date));
  assert.deepEqual([...datesVues].sort(), ["2026-08-17", "2026-08-18", "2026-08-19"]);

  // Aucune provenance ne cite le 20.
  for (const l of r.lignes) {
    for (const v of l.provenance) {
      assert.ok(r.dates.includes(v.date), `provenance hors période : ${v.date}`);
    }
  }
});

await test("C1-27. la génération ne modifie JAMAIS le plan du coach", () => {
  const avant = JSON.stringify(SEMAINE);
  const avantRecettes = JSON.stringify(RECETTES);
  genererCourses(entree({ preferences: avecEnvies({ viandes: ["Poulet"] }, ["Saumon"]) }));
  assert.equal(JSON.stringify(SEMAINE), avant, "le plan est intact");
  assert.equal(JSON.stringify(RECETTES), avantRecettes, "les recettes aussi");

  // Structurel : aucune table du plan n'est même nommée dans le moteur.
  for (const interdit of [
    "nutrition_plans",
    "nutrition_plan_profiles",
    "nutrition_meal_slot_targets",
    "nutrition_days",
    "meals",
    "save_nutrition",
  ]) {
    assert.ok(!CODE_BESOINS.includes(interdit), `« ${interdit} » dans le moteur`);
  }
});

await test("C1-28. la génération ne modifie JAMAIS l'historique alimentaire", () => {
  for (const interdit of [
    "consumed_meals",
    "meal_entries",
    "ajouter_aliment",
    "consumedOn =",
    "supprimer",
  ]) {
    assert.ok(!CODE_BESOINS.includes(interdit), `« ${interdit} » dans le moteur`);
  }
  // Le moteur ne lit l'historique que sous forme de RÉSUMÉ déjà agrégé, passé
  // en argument : il n'a même pas accès aux entrées.
  assert.ok(CODE_BESOINS.includes("readonly habitudes: Readonly<Record<string, number>>"));
});

await test("C1-29. la provenance des quantités est conservée", () => {
  const p = construirePeriode("2026-08-17", 3);
  assert.ok(p);
  const r = genererCourses(entree({ jours: joursDeLaPeriode(p, SEMAINE) }));

  const ligne = r.lignes.find((l) => l.provenance.length > 1);
  assert.ok(ligne, "au moins une ligne agrège plusieurs repas");

  // ⚠️ LA SOMME DES PROVENANCES EST EXACTEMENT LA QUANTITÉ. Si elle divergeait,
  // la ligne mentirait sur son origine — et C2 ne pourrait pas retirer un jour.
  const somme = ligne.provenance.reduce((n, v) => n + v.quantite, 0);
  assert.ok(Math.abs(somme - ligne.quantite) < 1e-9, `${somme} ≠ ${ligne.quantite}`);

  for (const v of ligne.provenance) {
    assert.ok(v.date !== "" && v.slot !== "" && v.recetteNom !== "");
    assert.equal(v.unite, ligne.unite, "chaque provenance porte la même unité que la ligne");
  }
});

await test("C1-30. l'absence de plan ou de recette est gérée proprement", () => {
  // Aucun plan : un avertissement, pas une exception, pas une liste inventée.
  const sansPlan = genererCourses(entree({ week: null }));
  assert.deepEqual([...sansPlan.lignes], []);
  assert.deepEqual([...sansPlan.repas], []);
  assert.ok(sansPlan.avertissements.some((a) => a.code === "aucun_plan"));

  // Aucune recette : la période reste connue, la liste est vide et le dit.
  const sansRecette = genererCourses(entree({ recettes: [] }));
  assert.equal(sansRecette.lignes.length, 0);
  assert.equal(sansRecette.dates.length, 3);
  assert.ok(sansRecette.avertissements.some((a) => a.code === "aucune_recette"));

  // Tout exclu : un avertissement distinct — « rien ne convient » n'est pas
  // « rien n'existe ».
  const toutExclu = genererCourses(
    entree({
      preferences: {
        envies: PREFERENCES_VIDES.envies,
        exclusions: ["Poulet", "Bœuf 5 %", "Saumon", "Whey"],
      },
    }),
  );
  assert.ok(toutExclu.avertissements.some((a) => a.code === "tout_exclu"));
  assert.ok(!toutExclu.avertissements.some((a) => a.code === "aucune_recette"));

  // Une quantité nulle ou absurde ne crée pas de ligne fantôme.
  assert.equal(agregerCourses([besoin({ quantite: 0 })]).length, 0);
  assert.equal(agregerCourses([besoin({ quantite: Number.NaN })]).length, 0);
  assert.equal(agregerCourses([besoin({ quantite: -5 })]).length, 0);
});

/* ══════════════════════════════════════════════════════════════════════════
   COHÉRENCE DU LOT
   ══════════════════════════════════════════════════════════════════════════ */

await test("C1-SUP. moteur pur, aucune migration, dépouillement honnête", () => {
  // PUR : aucun React, aucun Supabase, aucun réseau dans les cinq modules.
  for (const fichier of ["periode", "preferences", "selection", "agregation", "besoins"]) {
    const code = sansProse(lire(`../../lib/courses/${fichier}.ts`));
    for (const interdit of ["react", "useState", "createSupabaseBrowserClient", "fetch("]) {
      assert.ok(!code.toLowerCase().includes(interdit.toLowerCase()), `« ${interdit} » dans ${fichier}`);
    }
  }

  // AUCUNE MIGRATION : le compte est inchangé depuis A5.
  const migrations = readdirSync(new URL("../../supabase/migrations/", import.meta.url)).filter(
    (f) => f.endsWith(".sql"),
  );
  assert.equal(migrations.length, 72, "72 fichiers de migration, comme avant C1");
  assert.deepEqual(migrations.filter((f) => f.slice(0, 14) > "20260905090100"), []);
  // Et aucune table « courses » n'a été inventée.
  const sql = migrations
    .map((f) => lire(`../../supabase/migrations/${f}`))
    .join("\n")
    .toLowerCase();
  assert.ok(!sql.includes("create table public.courses"));
  assert.ok(!sql.includes("grocery"));

  // CONTRÔLE NÉGATIF DU DÉPOUILLEMENT : la prose nomme bien les mots interdits
  // ailleurs, et le dépouillement les a retirés — sans quoi les interdictions
  // ci-dessus seraient vertes sur un fichier vidé.
  assert.ok(SOURCE_AGREGATION.includes("densité") || SOURCE_AGREGATION.includes("densite"));
  assert.ok(!CODE_AGREGATION.includes("densite"));
  assert.ok(CODE_AGREGATION.includes("export function agregerCourses"));
  assert.ok(CODE_AGREGATION.length > 1200);
  assert.ok(CODE_BESOINS.includes("export function genererCourses"));
  assert.ok(CODE_BESOINS.length > 2000);

  // Le rayon vient du LIBELLÉ, et du rôle seulement à défaut — c'est l'ordre
  // réel du code, et C1-CAT-01..08 le gardent.
  assert.equal(rayonDeLIngredient({ role: "protein", name: "Poulet" }), "proteines");
  assert.equal(rayonDeLIngredient({ role: "carbohydrate", name: "Riz" }), "feculents");
  assert.equal(rayonDeLIngredient({ role: "free", name: "Banane" }), "fruits");
  assert.equal(normaliserLibelle("Bœuf 5 %"), "boeuf 5");
});
