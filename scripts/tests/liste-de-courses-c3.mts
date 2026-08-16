/**
 * Harnais — COURSES C3 : BUDGET ET ESTIMATION DE COÛT.
 *
 * ────────────────────────────────────────────────────────────────────────────
 * CE QUE CE FICHIER PROUVE
 * ────────────────────────────────────────────────────────────────────────────
 * L'arithmétique en centimes entiers, l'arrondi déterministe, le refus absolu
 * de convertir une unité, l'honnêteté de la couverture partielle, la lecture de
 * `checked` sans en changer le sens, et l'absence complète de magasin, de
 * promotion et de conditionnement.
 *
 * ⚠️ IL NE REDOUBLE NI C1, NI C1.1, NI C2. L'agrégation, la période, la liste
 * persistante et les cases y sont déjà mesurées.
 *
 * ⚠️ AUCUN ACCÈS RÉSEAU, AUCUNE BASE. La migration est éprouvée séparément par
 * `supabase/tests/courses_c3_budget_checklist.sql`.
 *
 * Lancement : npm run test:liste-de-courses-c3
 */
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { createElement } from "react";
import { renderToString } from "react-dom/server";

import { BlocBudget, centsDepuisSaisie } from "../../components/student/BlocBudget";
import { NBSP } from "../../lib/nutrition/basis-points";
import {
  calculerBudgetListe,
  calculerCoutLigne,
  formaterMontant,
  indexerPrix,
  libelleCouverture,
  pourcentageCouverture,
  type PrixEstime,
} from "../../lib/nutrition/budget-courses";
import type { LigneAffichee } from "../../lib/nutrition/liste-persistante";

const MIGRATION = readFileSync(
  new URL("../../supabase/migrations/20260916090000_c3_budget_et_prix_estimatifs.sql", import.meta.url),
  "utf8",
);
const MODULE_PUR = readFileSync(new URL("../../lib/nutrition/budget-courses.ts", import.meta.url), "utf8");
const MODULE_BASE = readFileSync(new URL("../../lib/supabase/prix-courses.ts", import.meta.url), "utf8");
const HOOK = readFileSync(new URL("../../hooks/useBudgetCourses.ts", import.meta.url), "utf8");
const BLOC = readFileSync(new URL("../../components/student/BlocBudget.tsx", import.meta.url), "utf8");
const ADMIN = readFileSync(
  new URL("../../components/admin/PrixEstimatifsAdmin.tsx", import.meta.url),
  "utf8",
);

/**
 * ⚠️ ON CHERCHE DU CODE, PAS DE LA PROSE — ET EN SQL, LA PROSE N'EST PAS
 * SEULEMENT DANS LES COMMENTAIRES. Les `comment on table … is '…'` de la
 * migration EXPLIQUENT qu'aucun magasin n'est modélisé, et contiennent donc le
 * mot « magasin ». Les compter reviendrait à faire rougir un test parce que la
 * documentation est bonne. Les littéraux entre apostrophes sont donc retirés
 * eux aussi — les valeurs de CHECK vraiment testées le sont par des assertions
 * qui les nomment explicitement, pas par ce balayage.
 */
function sansCommentaires(source: string): string {
  return source
    .replace(/\/\*[\s\S]*?\*\//g, " ")
    .replace(/(^|[^:])\/\/.*$/gm, "$1 ")
    .replace(/^\s*--.*$/gm, " ")
    .replace(/'(?:[^']|'')*'/g, "''");
}

/**
 * Le SQL sans ses commentaires, mais AVEC ses littéraux : c'est la forme dans
 * laquelle on vérifie les valeurs d'un CHECK, qui sont précisément des
 * littéraux.
 */
function sansProse(sql: string): string {
  return sql.replace(/^\s*--.*$/gm, " ");
}

/**
 * Le code d'un composant, SANS le texte affiché à l'écran.
 *
 * ⚠️ SANS CE FILTRE, LE BALAYAGE DES INTERDITS SE MORDRAIT LA QUEUE. Le bloc
 * budget écrit « sans tenir compte des conditionnements » et l'écran admin
 * « Aucun magasin, aucune promotion » : ces phrases sont exactement la preuve
 * que ces notions ne sont PAS implémentées, et les compter comme des
 * occurrences ferait rougir un test parce que l'interface est honnête. On
 * retire donc les nœuds de texte JSX — ce qui est entre `>` et `<` — pour ne
 * garder que des identifiants et des valeurs.
 */
function sansTexteAffiche(source: string): string {
  return sansCommentaires(source).replace(/>[^<>{}]*</g, "><");
}

function texteRendu(html: string): string {
  return html
    .replace(/<!--[\s\S]*?-->/g, "")
    .replace(/&nbsp;| | /g, " ")
    .replace(/&#x27;|&apos;/g, "'")
    .replace(/\s+/g, " ");
}

const F1 = "11111111-1111-4111-8111-111111111111";
const F2 = "22222222-2222-4222-8222-222222222222";
const P1 = "33333333-3333-4333-8333-333333333333";

const prixRiz: PrixEstime = {
  identityType: "catalog_food",
  identityId: F1,
  priceCents: 250,
  quantite: 1000,
  unite: "g",
};
const prixOeufs: PrixEstime = {
  identityType: "catalog_food",
  identityId: F2,
  priceCents: 480,
  quantite: 6,
  unite: "piece",
};

function lignePlan(over: Partial<LigneAffichee> = {}): LigneAffichee {
  return {
    id: "l1",
    source: "plan",
    cle: `catalog_food:${F1}|g`,
    libelle: "Riz",
    quantite: "1 000 g",
    colorKey: null,
    checked: false,
    ...over,
  };
}
function ligneManuelle(over: Partial<LigneAffichee> = {}): LigneAffichee {
  return {
    id: "m1",
    source: "manual",
    cle: "manual:m1",
    libelle: "Papier toilette",
    quantite: null,
    colorKey: null,
    checked: false,
    ...over,
  };
}

function chiffrer(
  lignes: readonly LigneAffichee[],
  prix: readonly PrixEstime[],
  budgetCents: number | null,
  besoins: Record<string, { quantite: number | null; unite: string | null }>,
  prixManuels: Record<string, number | null> = {},
) {
  return calculerBudgetListe(
    lignes,
    indexerPrix(prix),
    budgetCents,
    new Map(Object.entries(besoins)),
    new Map(Object.entries(prixManuels)),
  );
}

/* ══════════════════════════════════════════════════════════════════════════
 * C3-01 à C3-08 — LE MODÈLE : CENTIMES ENTIERS, IDENTITÉ, UNITÉS
 * ════════════════════════════════════════════════════════════════════════ */

test("C3-01 le budget est en CENTIMES ENTIERS, jamais un flottant en base", () => {
  const sql = sansCommentaires(MIGRATION);
  assert.ok(/budget_cents integer/.test(sql), "budget_cents doit être un integer");
  // ⚠️ AUCUN TYPE FLOTTANT NULLE PART DANS CETTE MIGRATION.
  for (const interdit of ["numeric(", " real", "double precision", "float"]) {
    assert.ok(!sql.includes(interdit), `type flottant monétaire : ${interdit}`);
  }
  assert.ok(/price_cents integer not null/.test(sql));
});

test("C3-02 un budget null est autorisé — et ce n'est pas zéro", () => {
  const sql = sansCommentaires(MIGRATION);
  assert.ok(/budget_cents is null\s*$|budget_cents is null/m.test(sql));
  const b = chiffrer([lignePlan()], [prixRiz], null, { l1: { quantite: 1000, unite: "g" } });
  assert.equal(b.budgetCents, null);
  // ⚠️ ÉCART `null`, ET SURTOUT PAS 0 : sans budget il n'y a pas de dépassement.
  assert.equal(b.ecartCents, null);
  assert.equal(b.depassement, false);
});

test("C3-03 un budget négatif est refusé par la base ET par la saisie", () => {
  assert.ok(sansCommentaires(MIGRATION).includes("budget_cents >= 0"));
  assert.equal(centsDepuisSaisie("-5"), null);
  assert.equal(centsDepuisSaisie("1001"), null, "au-delà du plafond de 1 000 €");
});

test("C3-04 l'élève ne peut écrire QUE budget_cents, sur SA liste", () => {
  const sql = sansCommentaires(MIGRATION);
  // Le grant de colonne : la serrure, avant toute policy.
  assert.ok(sql.includes("grant update (budget_cents) on table public.shopping_lists to authenticated"));
  assert.ok(!/grant update\s+on table public\.shopping_lists/.test(sql), "aucun grant update nu");
  // Et la policy, qui limite aux lignes de l'élève.
  assert.ok(sql.includes("shopping_lists_update_budget_own_student"));
  assert.ok(sql.includes("student_id = public.current_student_id()"));
  // ⚠️ AUCUNE SECONDE LOGIQUE D'IDENTITÉ.
  assert.ok(!sql.includes("auth.uid()"));
});

test("C3-05 un prix porte exactement UNE identité (XOR), jamais un nom", () => {
  const sql = sansCommentaires(MIGRATION);
  assert.ok(sql.includes("food_price_estimates_cible_unique"));
  assert.ok(/catalog_food_id is null then 0 else 1 end[\s\S]{0,120}product_id is null then 0 else 1 end\) = 1/.test(sql));
  // Aucune colonne de nom sur la table de prix.
  const bloc = sql.slice(sql.indexOf("create table if not exists public.food_price_estimates"));
  assert.ok(!/^\s+(name|label|libelle)\s/m.test(bloc.slice(0, bloc.indexOf(");"))));
});

test("C3-06 la quantité de référence est strictement positive", () => {
  assert.ok(sansCommentaires(MIGRATION).includes("quantity > 0"));
  // Une quantité nulle rendrait le rapport infini : refusée aussi en mémoire.
  assert.equal(calculerCoutLigne(100, "g", { ...prixRiz, quantite: 0 }).cents, null);
});

test("C3-07 price_cents est >= 0", () => {
  assert.ok(sansCommentaires(MIGRATION).includes("price_cents >= 0"));
});

test("C3-08 les unités de prix sont g, ml, piece — et rien d'autre", () => {
  // ⚠️ SUR LE SQL AVEC SES LITTÉRAUX : les valeurs d'un CHECK SONT des
  // littéraux, les dépouiller reviendrait à ne rien vérifier du tout.
  assert.ok(sansProse(MIGRATION).includes("unit in ('g', 'ml', 'piece')"));
  assert.ok(sansProse(MIGRATION).includes("source in ('manual_estimate')"));
  assert.ok(sansProse(MIGRATION).includes("status in ('active', 'archived')"));
});

/* ══════════════════════════════════════════════════════════════════════════
 * C3-09 à C3-15 — L'ARITHMÉTIQUE (§25 A → H)
 * ════════════════════════════════════════════════════════════════════════ */

test("C3-09 §25.A — 1000 g à 2,50 € / 1000 g = 2,50 €", () => {
  assert.equal(calculerCoutLigne(1000, "g", prixRiz).cents, 250);
});

test("C3-10 §25.B — 1500 g à 2,50 € / 1000 g = 3,75 €", () => {
  assert.equal(calculerCoutLigne(1500, "g", prixRiz).cents, 375);
});

test("C3-11 §25.C — 3 pièces à 4,80 € / 6 pièces = 2,40 €", () => {
  assert.equal(calculerCoutLigne(3, "piece", prixOeufs).cents, 240);
});

test("C3-12 §25.D — un besoin en g avec un prix en ml n'est PAS estimable", () => {
  const r = calculerCoutLigne(750, "g", { ...prixRiz, unite: "ml" });
  // ⚠️ `null`, ET SURTOUT PAS 0. Zéro serait un coût ; null est une absence.
  assert.equal(r.cents, null);
  assert.equal(r.raison, "unite_differente");
});

test("C3-13 aucune conversion n'existe dans le module pur", () => {
  const code = sansCommentaires(MODULE_PUR);
  for (const interdit of ["1000", "* 1000", "/ 1000", "'kg'", '"kg"', "'L'", "0.001"]) {
    assert.ok(!code.includes(interdit), `conversion suspecte : ${interdit}`);
  }
  // Une pièce ne devient jamais des grammes.
  assert.equal(calculerCoutLigne(3, "piece", prixRiz).cents, null);
  assert.equal(calculerCoutLigne(300, "g", prixOeufs).cents, null);
});

test("C3-14 l'arrondi au centime est déterministe, et documenté", () => {
  // 1 274 g à 250 c / 1000 g = 318,5 c exactement → 319 (demi supérieur).
  assert.equal(calculerCoutLigne(1274, "g", prixRiz).cents, 319);
  // Deux appels identiques donnent le même nombre : aucune part d'aléa.
  assert.equal(calculerCoutLigne(1274, "g", prixRiz).cents, calculerCoutLigne(1274, "g", prixRiz).cents);
  assert.equal(calculerCoutLigne(1, "g", prixRiz).cents, 0, "0,25 c s'arrondit à 0");
  assert.equal(calculerCoutLigne(3, "g", prixRiz).cents, 1, "0,75 c s'arrondit à 1");
});

test("C3-15 le total est la SOMME DES LIGNES ARRONDIES, pas l'arrondi de la somme", () => {
  // 3 lignes à 0,75 c chacune : arrondies → 1 + 1 + 1 = 3.
  // L'arrondi de la somme exacte (2,25 c) donnerait 2. C'est 3 qui doit sortir,
  // pour qu'un élève qui additionne les lignes affichées retrouve le total.
  const lignes = [
    lignePlan({ id: "a", cle: `catalog_food:${F1}|g` }),
    lignePlan({ id: "b", cle: `catalog_food:${F1}|g` }),
    lignePlan({ id: "c", cle: `catalog_food:${F1}|g` }),
  ];
  const b = chiffrer(lignes, [prixRiz], null, {
    a: { quantite: 3, unite: "g" },
    b: { quantite: 3, unite: "g" },
    c: { quantite: 3, unite: "g" },
  });
  assert.equal(b.estimeCents, 3);
  assert.equal(
    b.lignes.reduce((t, l) => t + (l.cout.cents ?? 0), 0),
    b.estimeCents,
  );
});

/* ══════════════════════════════════════════════════════════════════════════
 * C3-16 à C3-21 — COUVERTURE, BUDGET, COCHÉ
 * ════════════════════════════════════════════════════════════════════════ */

test("C3-16 §25.E — 20 articles, 15 prix : la couverture le dit", () => {
  const lignes: LigneAffichee[] = [];
  const besoins: Record<string, { quantite: number | null; unite: string | null }> = {};
  for (let i = 0; i < 20; i += 1) {
    const id = `l${i}`;
    lignes.push(lignePlan({ id, cle: i < 15 ? `catalog_food:${F1}|g` : `catalog_food:${P1}|g` }));
    besoins[id] = { quantite: 1000, unite: "g" };
  }
  const b = chiffrer(lignes, [prixRiz], null, besoins);
  assert.equal(b.articlesTotal, 20);
  assert.equal(b.articlesEstimes, 15);
  assert.equal(b.articlesSansPrix, 5);
  assert.equal(pourcentageCouverture(b), 75);
  assert.equal(libelleCouverture(b), `15${NBSP}/${NBSP}20 articles estimés`);
});

test("C3-17 une estimation partielle est SIGNALÉE, jamais présentée comme totale", () => {
  const b = chiffrer(
    [lignePlan({ id: "a" }), lignePlan({ id: "b", cle: `catalog_food:${P1}|g` })],
    [prixRiz],
    null,
    { a: { quantite: 1000, unite: "g" }, b: { quantite: 500, unite: "g" } },
  );
  assert.equal(b.partielle, true);
  const html = texteRendu(
    renderToString(createElement(BlocBudget, { budget: b, enCours: false, onDefinirBudget: () => {} })),
  );
  assert.ok(html.includes("Estimation partielle"));
  assert.ok(html.includes("1 article sans prix"));
  // ⚠️ LE MOT « TOTAL » NE DOIT PAS APPARAÎTRE quand tout n'est pas compté.
  assert.ok(!/\bTotal\b/.test(html));
});

test("C3-18 §25.F — budget 60 €, estimation 53 € → restant 7 €", () => {
  const b = chiffrer([lignePlan()], [{ ...prixRiz, priceCents: 5300 }], 6000, {
    l1: { quantite: 1000, unite: "g" },
  });
  assert.equal(b.estimeCents, 5300);
  assert.equal(b.ecartCents, 700);
  assert.equal(b.depassement, false);
  const html = texteRendu(
    renderToString(createElement(BlocBudget, { budget: b, enCours: false, onDefinirBudget: () => {} })),
  );
  assert.ok(html.includes("Budget restant"));
  assert.ok(html.includes(`7,00${NBSP}€`.replace(NBSP, " ")));
});

test("C3-19 §25.G — budget 50 €, estimation 53 € → dépassement 3 €", () => {
  const b = chiffrer([lignePlan()], [{ ...prixRiz, priceCents: 5300 }], 5000, {
    l1: { quantite: 1000, unite: "g" },
  });
  assert.equal(b.ecartCents, -300);
  assert.equal(b.depassement, true);
  const html = texteRendu(
    renderToString(createElement(BlocBudget, { budget: b, enCours: false, onDefinirBudget: () => {} })),
  );
  assert.ok(html.includes("Dépassement estimé"));
  // ⚠️ LA VALEUR ABSOLUE : on n'affiche jamais « −3,00 € » de dépassement.
  assert.ok(html.includes(`3,00${NBSP}€`.replace(NBSP, " ")));
  assert.ok(!html.includes("-3,00"));
});

test("C3-20 §25.H — coché = acheté", () => {
  const b = chiffrer(
    [lignePlan({ id: "a", checked: true }), lignePlan({ id: "b" })],
    [prixRiz],
    null,
    { a: { quantite: 4000, unite: "g" }, b: { quantite: 6000, unite: "g" } },
  );
  assert.equal(b.estimeCents, 2500);
  assert.equal(b.achetesCents, 1000);
  assert.equal(b.restantCents, 1500);
});

test("C3-21 non coché = reste — et acheté + reste = estimé, toujours", () => {
  const b = chiffrer(
    [lignePlan({ id: "a", checked: true }), lignePlan({ id: "b" }), lignePlan({ id: "c", checked: true })],
    [prixRiz],
    null,
    {
      a: { quantite: 1274, unite: "g" },
      b: { quantite: 333, unite: "g" },
      c: { quantite: 777, unite: "g" },
    },
  );
  assert.equal(b.achetesCents + b.restantCents, b.estimeCents);
});

/* ══════════════════════════════════════════════════════════════════════════
 * C3-22 à C3-26 — HONNÊTETÉ, ARTICLES MANUELS, DÉRIVATION
 * ════════════════════════════════════════════════════════════════════════ */

test("C3-22 un article sans prix n'invente rien — et ne vaut pas zéro", () => {
  const b = chiffrer([lignePlan()], [], null, { l1: { quantite: 1000, unite: "g" } });
  assert.equal(b.estimeCents, 0);
  assert.equal(b.articlesEstimes, 0);
  assert.equal(b.lignes[0].cout.cents, null);
  assert.equal(b.lignes[0].cout.raison, "aucun_prix");
  const html = texteRendu(
    renderToString(createElement(BlocBudget, { budget: b, enCours: false, onDefinirBudget: () => {} })),
  );
  assert.ok(html.includes("Aucune estimation disponible"));
});

test("C3-23 un article manuel est accepté sans prix, et chiffré au FORFAIT s'il en a un", () => {
  const sansPrix = chiffrer([ligneManuelle()], [], null, {});
  assert.equal(sansPrix.lignes[0].cout.cents, null);
  assert.equal(sansPrix.articlesSansPrix, 1);

  // ⚠️ FORFAITAIRE, JAMAIS AU PRORATA : « papier toilette 4,50 € », pas
  // « 4,50 € les 12 rouleaux ». Un article manuel n'a pas de quantité de
  // référence, donc aucune règle de trois n'est possible.
  const avecPrix = chiffrer([ligneManuelle()], [], null, {}, { m1: 450 });
  assert.equal(avecPrix.lignes[0].cout.cents, 450);
  assert.equal(avecPrix.estimeCents, 450);
});

test("C3-24 un prix global n'est jamais modifiable par un élève", () => {
  const sql = sansCommentaires(MIGRATION);
  // Lecture des ACTIFS seulement, aucune écriture.
  assert.ok(sql.includes("food_price_estimates_select_actifs"));
  assert.ok(/grant select on table public\.food_price_estimates to authenticated/.test(sql));
  assert.ok(
    !/grant (insert|update|delete)[^;]*food_price_estimates[^;]*authenticated/.test(sql),
    "aucune écriture accordée à authenticated",
  );
  // L'écriture passe par la policy admin, et par elle seule.
  assert.ok(sql.includes("food_price_estimates_manage_admin"));
  assert.ok(sql.includes("public.is_admin()"));
});

test("C3-25 l'estimation est DÉRIVÉE, jamais persistée", () => {
  const sql = sansCommentaires(MIGRATION);
  // Aucune colonne de total sur la liste : elle deviendrait fausse au premier
  // changement de prix.
  for (const interdit of ["estimated_total", "total_cents", "estimation_cents"]) {
    assert.ok(!sql.includes(interdit), `total persisté : ${interdit}`);
  }
  const code = sansCommentaires(MODULE_BASE);
  assert.ok(!code.includes("estimeCents"), "la couche base ne stocke aucun total");
});

test("C3-26 changer un prix change l'estimation, sans rien réécrire", () => {
  const besoins = { l1: { quantite: 1000, unite: "g" } };
  const avant = chiffrer([lignePlan()], [prixRiz], null, besoins);
  const apres = chiffrer([lignePlan()], [{ ...prixRiz, priceCents: 300 }], null, besoins);
  assert.equal(avant.estimeCents, 250);
  assert.equal(apres.estimeCents, 300);
});

/* ══════════════════════════════════════════════════════════════════════════
 * C3-27 à C3-35 — LES INTERDITS, ET CE QUE C3 N'A PAS TOUCHÉ
 * ════════════════════════════════════════════════════════════════════════ */

/**
 * Les six fichiers du lot, dépouillés de leurs commentaires, de leurs
 * littéraux SQL et de leur texte affiché — c'est-à-dire réduits à ce qui
 * s'exécute.
 */
const SOURCES_C3: readonly (readonly [string, string])[] = [
  ["migration", sansCommentaires(MIGRATION)],
  ["module pur", sansTexteAffiche(MODULE_PUR)],
  ["couche base", sansTexteAffiche(MODULE_BASE)],
  ["hook", sansTexteAffiche(HOOK)],
  ["bloc budget", sansTexteAffiche(BLOC)],
  ["admin prix", sansTexteAffiche(ADMIN)],
];

test("C3-27 aucune dépendance à un magasin ou à une enseigne", () => {
  for (const [nom, code] of SOURCES_C3) {
    for (const interdit of ["store", "retailer", "merchant", "enseigne", "magasin"]) {
      assert.ok(!new RegExp(`\\b${interdit}`, "i").test(code), `${nom} : ${interdit}`);
    }
  }
});

test("C3-28 aucune géolocalisation", () => {
  for (const [nom, code] of SOURCES_C3) {
    for (const interdit of ["latitude", "longitude", "geoloc", "distance", "coords"]) {
      assert.ok(!new RegExp(interdit, "i").test(code), `${nom} : ${interdit}`);
    }
  }
});

test("C3-29 aucune promotion, aucune disponibilité", () => {
  for (const [nom, code] of SOURCES_C3) {
    for (const interdit of ["promotion", "promo", "discount", "remise", "availability", "rupture"]) {
      assert.ok(!new RegExp(interdit, "i").test(code), `${nom} : ${interdit}`);
    }
  }
});

test("C3-30 aucune logique de conditionnement", () => {
  for (const [nom, code] of SOURCES_C3) {
    for (const interdit of ["packaging", "net_quantity", "Math.ceil"]) {
      assert.ok(!code.includes(interdit), `${nom} : ${interdit}`);
    }
  }
  // ⚠️ ET L'ÉCRAN LE DIT — taire l'approximation ferait passer l'estimation
  // pour un devis.
  const b = chiffrer([lignePlan()], [prixRiz], null, { l1: { quantite: 1274, unite: "g" } });
  const html = texteRendu(
    renderToString(createElement(BlocBudget, { budget: b, enCours: false, onDefinirBudget: () => {} })),
  );
  assert.ok(html.includes("sans tenir compte des conditionnements"));
});

test("C3-31 aucune heuristique de nom vers un prix ou une unité", () => {
  for (const [nom, code] of SOURCES_C3) {
    for (const interdit of ["jus", "sauce", "huile", "moyenne", "average", "estimer_depuis_nom"]) {
      assert.ok(!new RegExp(`["'\`]${interdit}`, "i").test(code), `${nom} : ${interdit}`);
    }
  }
  // Le coût n'est jamais trouvé par libellé : deux lignes homonymes de clés
  // différentes ne partagent aucun prix.
  const b = chiffrer(
    [lignePlan({ id: "a" }), lignePlan({ id: "b", cle: `catalog_food:${P1}|g`, libelle: "Riz" })],
    [prixRiz],
    null,
    { a: { quantite: 1000, unite: "g" }, b: { quantite: 1000, unite: "g" } },
  );
  assert.equal(b.articlesEstimes, 1, "l'homonyme n'hérite pas du prix");
});

test("C3-32 C2 intact : `checked` est LU, jamais écrit par C3", () => {
  for (const [nom, source] of [
    ["module pur", MODULE_PUR],
    ["couche base", MODULE_BASE],
    ["hook", HOOK],
    ["bloc budget", BLOC],
  ] as const) {
    const code = sansCommentaires(source);
    assert.ok(!/checked\s*[:=]\s*(true|false)/.test(code), `${nom} écrit checked`);
    assert.ok(!code.includes('update({ checked'), `${nom} écrit checked`);
  }
});

test("C3-33 C2 intact : C3 ne touche ni à la régénération ni aux lignes PLAN", () => {
  const sql = sansCommentaires(MIGRATION);
  assert.ok(!sql.includes("regenerer_liste_de_courses"), "la RPC C2 n'est pas redéfinie");
  // ⚠️ `drop policy if exists` EST LA CONVENTION DU PROJET pour rendre une
  // migration rejouable ; ce n'est pas une suppression de donnée. Ce qu'on
  // interdit, c'est de détruire une table, une fonction ou une colonne de C2.
  assert.ok(!/drop\s+(table|function|column)/i.test(sql), "C3 détruit un objet de C2");
  // Le grant de colonne de C2 n'est ni élargi ni remplacé.
  assert.ok(!/grant update\s*\([^)]*\)\s*on table public\.shopping_list_items/.test(sql));
  const code = sansCommentaires(MODULE_BASE);
  assert.ok(!code.includes('from("shopping_list_items")'), "C3 n'écrit pas les lignes en direct");
});

test("C3-34 aucun solveur, aucun second moteur d'agrégation", () => {
  for (const [nom, code] of SOURCES_C3) {
    for (const interdit of ["solve", "agreger", "agregerListeDeCourses"]) {
      assert.ok(!code.includes(interdit), `${nom} : ${interdit}`);
    }
  }
});

test("C3-35 aucune modification de planned_* ni de consumed_*", () => {
  const sql = sansCommentaires(MIGRATION);
  for (const table of ["planned_meals", "planned_meal_items", "consumed_meals", "meal_entries"]) {
    assert.ok(!sql.includes(table), `la migration C3 nomme ${table}`);
  }
  for (const [nom, code] of SOURCES_C3) {
    assert.ok(!code.includes("planned_meal"), `${nom} touche à la planification`);
    assert.ok(!code.includes("consumed_meal"), `${nom} touche à la consommation`);
  }
});

/* ══════════════════════════════════════════════════════════════════════════
 * C3-36 à C3-38 — LA SAISIE ET LE FORMATAGE
 * ════════════════════════════════════════════════════════════════════════ */

test("C3-36 la saisie en euros devient des centimes entiers, sans perte", () => {
  assert.equal(centsDepuisSaisie("60"), 6000);
  assert.equal(centsDepuisSaisie("60,50"), 6050);
  assert.equal(centsDepuisSaisie("60.5"), 6050);
  // ⚠️ LE PIÈGE DU FLOTTANT : 60.35 * 100 vaut 6034,999… en binaire.
  assert.equal(centsDepuisSaisie("60,35"), 6035);
  assert.equal(centsDepuisSaisie("0"), 0);
  for (const invalide of ["", "abc", "60,555", "1e3", "-1", "60 €"]) {
    assert.equal(centsDepuisSaisie(invalide), null, `refusé : ${invalide}`);
  }
});

test("C3-37 les montants sont formatés en français, avec le séparateur du projet", () => {
  assert.equal(formaterMontant(5340), `53,40${NBSP}€`);
  assert.equal(formaterMontant(0), `0,00${NBSP}€`);
  assert.equal(formaterMontant(100000), `1${NBSP}000,00${NBSP}€`);
});

test("C3-38 sans budget, l'écran propose d'en définir un — sans en imposer", () => {
  const b = chiffrer([lignePlan()], [prixRiz], null, { l1: { quantite: 1000, unite: "g" } });
  const html = texteRendu(
    renderToString(createElement(BlocBudget, { budget: b, enCours: false, onDefinirBudget: () => {} })),
  );
  assert.ok(html.includes("DÉFINIR UN BUDGET"));
  assert.ok(html.includes("Estimation"));
  assert.ok(!html.includes("Budget restant"));
  assert.ok(!html.includes("Dépassement"));
});

/* ══════════════════════════════════════════════════════════════════════════
 * C3-39 à C3-52 — L'AUDIT ADVERSE : LES DÉFAUTS TROUVÉS, ET LEURS GARDES
 * ════════════════════════════════════════════════════════════════════════ */

test("C3-39 D-1 — un prix NÉGATIF ne produit jamais un coût négatif", () => {
  // ⚠️ LE DÉFAUT ÉTAIT SILENCIEUX : une ligne au prix -100 c DIMINUAIT
  // l'estimation du panier, sans erreur ni signalement.
  const r = calculerCoutLigne(10, "g", { ...prixRiz, priceCents: -100 });
  assert.equal(r.cents, null);
  assert.equal(r.raison, "aucun_prix");
  // Et aucun total n'est jamais négatif.
  const b = chiffrer([lignePlan()], [{ ...prixRiz, priceCents: -100 }], null, {
    l1: { quantite: 10, unite: "g" },
  });
  assert.ok(b.estimeCents >= 0 && b.achetesCents >= 0 && b.restantCents >= 0);
});

test("C3-40 D-2 — au-delà de l'entier sûr, le coût devient NON ESTIMABLE", () => {
  // ⚠️ 1e12 g × 100 000 c donne 1e17 : au-delà de Number.MAX_SAFE_INTEGER, deux
  // entiers voisins sont le même flottant. Le résultat n'est pas faux de peu,
  // il est arbitraire — et un montant arbitraire affiché est pire qu'une absence.
  const r = calculerCoutLigne(1e12, "g", { ...prixRiz, priceCents: 100000, quantite: 1 });
  assert.equal(r.cents, null);
  assert.equal(r.raison, "aucun_prix");
  // La borne exacte : ce qui tient reste calculé.
  assert.equal(calculerCoutLigne(1000, "g", { ...prixRiz, priceCents: 100000, quantite: 1 }).cents, 100000000);
});

test("C3-41 §4 — la table des cas limites, valeur par valeur", () => {
  const t: [string, number | null][] = [
    // 1 g à 1 c / 3 g = 0,333 c → 0 ; 2 g = 0,666 c → 1.
    ["1/3", calculerCoutLigne(1, "g", { ...prixRiz, priceCents: 1, quantite: 3 }).cents],
    ["2/3", calculerCoutLigne(2, "g", { ...prixRiz, priceCents: 1, quantite: 3 }).cents],
    // Exactement 0,5 c → 1 (demi SUPÉRIEUR, la politique documentée).
    ["0,5", calculerCoutLigne(1, "g", { ...prixRiz, priceCents: 1, quantite: 2 }).cents],
    ["1,5", calculerCoutLigne(3, "g", { ...prixRiz, priceCents: 1, quantite: 2 }).cents],
    ["2,5", calculerCoutLigne(5, "g", { ...prixRiz, priceCents: 1, quantite: 2 }).cents],
    // Un prix de zéro est LÉGITIME (article offert) et vaut zéro, pas null.
    ["prix 0", calculerCoutLigne(1000, "g", { ...prixRiz, priceCents: 0 }).cents],
    // Une quantité de référence décimale est acceptée par le SQL (numeric).
    ["ref 0,5", calculerCoutLigne(1, "g", { ...prixRiz, priceCents: 250, quantite: 0.5 }).cents],
  ];
  assert.deepEqual(t, [
    ["1/3", 0], ["2/3", 1], ["0,5", 1], ["1,5", 2], ["2,5", 3], ["prix 0", 0], ["ref 0,5", 500],
  ]);
});

test("C3-42 §4 — NaN, Infinity et quantités non positives ne produisent jamais de nombre", () => {
  const invalides = [
    calculerCoutLigne(NaN, "g", prixRiz),
    calculerCoutLigne(Infinity, "g", prixRiz),
    calculerCoutLigne(-10, "g", prixRiz),
    calculerCoutLigne(0, "g", prixRiz),
    calculerCoutLigne(10, "g", { ...prixRiz, priceCents: NaN }),
    calculerCoutLigne(10, "g", { ...prixRiz, priceCents: Infinity }),
    calculerCoutLigne(10, "g", { ...prixRiz, quantite: NaN }),
    calculerCoutLigne(10, "g", { ...prixRiz, quantite: 0 }),
    calculerCoutLigne(10, "g", { ...prixRiz, quantite: -1 }),
  ];
  for (const r of invalides) {
    assert.equal(r.cents, null);
    assert.ok(r.raison !== null, "une absence est toujours motivée");
  }
});

test("C3-43 §4 — même entrée, même sortie : aucune part d'aléa", () => {
  for (let i = 0; i < 5; i += 1) {
    assert.equal(calculerCoutLigne(1274, "g", prixRiz).cents, 319);
  }
});

test("C3-44 §5 — la table de formatage, valeur par valeur", () => {
  const attendu: [number, string][] = [
    [0, `0,00${NBSP}€`],
    [1, `0,01${NBSP}€`],
    [5, `0,05${NBSP}€`],
    [99, `0,99${NBSP}€`],
    [100, `1,00${NBSP}€`],
    [700, `7,00${NBSP}€`],
    [5340, `53,40${NBSP}€`],
    [100000, `1${NBSP}000,00${NBSP}€`],
  ];
  for (const [cents, texte] of attendu) assert.equal(formaterMontant(cents), texte);
  // ⚠️ AUCUN FLOTTANT N'EST NÉCESSAIRE POUR AFFICHER : le module n'utilise ni
  // toFixed ni une division suivie d'un formatage décimal.
  const code = sansCommentaires(MODULE_PUR);
  assert.ok(!code.includes("toFixed"), "aucun toFixed dans le module pur");
  assert.ok(!code.includes("formatDecimalFr"), "aucun formatage décimal flottant");
});

test("C3-45 §6 — la couverture, article par article et cas par cas", () => {
  const vide = chiffrer([], [], null, {});
  // ⚠️ UNE LISTE VIDE N'A PAS UNE COUVERTURE DE 100 %. Elle n'en a aucune.
  assert.equal(pourcentageCouverture(vide), 0);
  assert.equal(vide.partielle, false, "rien à couvrir n'est pas une couverture partielle");

  // Quatre natures de ligne, une par une : PLAN pricé, PLAN non pricé,
  // MANUEL avec forfait, MANUEL sans prix.
  const lignes = [
    lignePlan({ id: "p1" }),
    lignePlan({ id: "p2", cle: `catalog_food:${P1}|g` }),
    ligneManuelle({ id: "m1" }),
    ligneManuelle({ id: "m2" }),
  ];
  const b = chiffrer(
    lignes,
    [prixRiz],
    null,
    { p1: { quantite: 1000, unite: "g" }, p2: { quantite: 1000, unite: "g" } },
    { m1: 450 },
  );
  assert.equal(b.articlesTotal, 4);
  assert.equal(b.articlesEstimes, 2, "le PLAN pricé et le MANUEL avec forfait");
  assert.equal(b.articlesSansPrix, 2);
  assert.equal(pourcentageCouverture(b), 50);

  // 1/3, 2/3, 3/3.
  const tiers = (n: number) => {
    const l = [0, 1, 2].map((i) =>
      lignePlan({ id: `t${i}`, cle: i < n ? `catalog_food:${F1}|g` : `catalog_food:${P1}|g` }),
    );
    return chiffrer(l, [prixRiz], null, {
      t0: { quantite: 1000, unite: "g" },
      t1: { quantite: 1000, unite: "g" },
      t2: { quantite: 1000, unite: "g" },
    });
  };
  assert.equal(pourcentageCouverture(tiers(1)), 33);
  assert.equal(pourcentageCouverture(tiers(2)), 67);
  assert.equal(pourcentageCouverture(tiers(3)), 100);
  assert.equal(tiers(3).partielle, false);
});

test("C3-46 §7 — cocher recalcule les trois montants, sans aucune écriture", () => {
  const besoins = { a: { quantite: 4000, unite: "g" }, b: { quantite: 6000, unite: "g" } };
  const avant = chiffrer([lignePlan({ id: "a", checked: true }), lignePlan({ id: "b" })], [prixRiz], null, besoins);
  assert.deepEqual(
    [avant.estimeCents, avant.achetesCents, avant.restantCents],
    [2500, 1000, 1500],
  );
  // On bascule la seconde : les trois valeurs suivent, et rien n'a été persisté.
  const apres = chiffrer(
    [lignePlan({ id: "a", checked: true }), lignePlan({ id: "b", checked: true })],
    [prixRiz],
    null,
    besoins,
  );
  assert.deepEqual([apres.estimeCents, apres.achetesCents, apres.restantCents], [2500, 2500, 0]);
});

test("C3-47 D-5 §7 — « budget restant » et « reste à acheter » ne se confondent pas", () => {
  // Deux notions, deux nombres, deux noms — et il faut que les DEUX soient à
  // l'écran en même temps sans qu'on puisse les prendre l'un pour l'autre.
  const b = chiffrer(
    [lignePlan({ id: "a", checked: true }), lignePlan({ id: "b" })],
    [prixRiz],
    6000,
    { a: { quantite: 4000, unite: "g" }, b: { quantite: 6000, unite: "g" } },
  );
  assert.equal(b.ecartCents, 3500, "budget restant = budget − estimation");
  assert.equal(b.restantCents, 1500, "reste à acheter = lignes non cochées");
  const html = texteRendu(
    renderToString(createElement(BlocBudget, { budget: b, enCours: false, onDefinirBudget: () => {} })),
  );
  assert.ok(html.includes("Budget restant"));
  assert.ok(html.includes("Reste à acheter"));
  assert.ok(!html.includes("Reste estimé"), "l'ancien libellé ambigu a disparu");
});

test("C3-48 D-4 §8 — un écart calculé sur une estimation PARTIELLE porte sa réserve", () => {
  const partiel = chiffrer(
    [lignePlan({ id: "a" }), lignePlan({ id: "b", cle: `catalog_food:${P1}|g` })],
    [prixRiz],
    6000,
    { a: { quantite: 1000, unite: "g" }, b: { quantite: 1000, unite: "g" } },
  );
  const html = texteRendu(
    renderToString(createElement(BlocBudget, { budget: partiel, enCours: false, onDefinirBudget: () => {} })),
  );
  // ⚠️ INTERDIT : « Budget restant » nu quand 1 article sur 2 n'a pas de prix.
  assert.ok(html.includes("Budget restant estimé sur 1 / 2 articles"));
  assert.ok(!/Budget restant\s*57/.test(html));

  // À 100 %, la formulation normale revient.
  const complet = chiffrer([lignePlan({ id: "a" })], [prixRiz], 6000, {
    a: { quantite: 1000, unite: "g" },
  });
  const htmlComplet = texteRendu(
    renderToString(createElement(BlocBudget, { budget: complet, enCours: false, onDefinirBudget: () => {} })),
  );
  assert.ok(htmlComplet.includes("Budget restant"));
  assert.ok(!htmlComplet.includes("estimé sur"));
});

test("C3-49 D-4 §8 — la même réserve vaut pour le DÉPASSEMENT", () => {
  const b = chiffrer(
    [lignePlan({ id: "a" }), lignePlan({ id: "b", cle: `catalog_food:${P1}|g` })],
    [{ ...prixRiz, priceCents: 9000 }],
    5000,
    { a: { quantite: 1000, unite: "g" }, b: { quantite: 1000, unite: "g" } },
  );
  assert.equal(b.depassement, true);
  const html = texteRendu(
    renderToString(createElement(BlocBudget, { budget: b, enCours: false, onDefinirBudget: () => {} })),
  );
  assert.ok(html.includes("Dépassement estimé sur 1 / 2 articles"));
});

test("C3-50 D-3 §2 — la page des prix est réservée à l'ADMIN", () => {
  const page = readFileSync(
    new URL("../../app/admin/nutrition/prix/page.tsx", import.meta.url),
    "utf8",
  );
  const code = sansCommentaires(page);
  assert.ok(code.includes("requireAdmin()"), "la page appelle la garde admin");
  assert.ok(!code.includes("requireAdminOrCoach"), "et surtout pas la garde élargie");
  // ⚠️ ET LA GARDE N'A PAS ÉTÉ OBTENUE EN ÉLARGISSANT LA RLS : la policy
  // continue d'exiger `is_admin()`, et elle seule protège la donnée.
  const sql = sansCommentaires(MIGRATION);
  assert.ok(sql.includes("food_price_estimates_manage_admin"));
  assert.ok(!sql.includes("is_coach"), "aucun droit d'écriture ouvert au coach");
});

test("C3-51 §12 — aucun calcul C3 ne lit le conditionnement", () => {
  for (const [nom, code] of SOURCES_C3) {
    for (const interdit of ["net_quantity", "net_unit"]) {
      assert.ok(!code.includes(interdit), `${nom} lit le conditionnement : ${interdit}`);
    }
  }
});

test("C3-52 §10 — changer le prix actif rechiffre la liste, sans la modifier", () => {
  const ligne = lignePlan();
  const besoins = { l1: { quantite: 1000, unite: "g" } };
  const avant = chiffrer([ligne], [{ ...prixRiz, priceCents: 200 }], null, besoins);
  const apres = chiffrer([ligne], [{ ...prixRiz, priceCents: 300 }], null, besoins);
  assert.equal(avant.estimeCents, 200);
  assert.equal(apres.estimeCents, 300);
  // ⚠️ LA LIGNE ELLE-MÊME N'A PAS BOUGÉ : aucun instantané de prix n'est caché
  // dans la liste, c'est ce qui rend le rechiffrage possible.
  assert.deepEqual(avant.lignes[0].ligne, apres.lignes[0].ligne);
  assert.equal(avant.lignes[0].ligne, ligne, "la ligne d'entrée est rendue telle quelle");
});
