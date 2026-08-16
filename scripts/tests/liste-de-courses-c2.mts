/**
 * Harnais — COURSES C2 : LA LISTE DE COURSES PERSISTANTE.
 *
 * ────────────────────────────────────────────────────────────────────────────
 * CE QUE CE FICHIER PROUVE
 * ────────────────────────────────────────────────────────────────────────────
 * La clé d'une ligne persistée, la détection de changement canonique (§14),
 * l'assemblage PLAN + MANUEL pour l'écran, la progression, la charge utile
 * envoyée à la RPC, l'écran « MA LISTE DE COURSES » et ses règles (§9 à §13),
 * et enfin la migration SQL elle-même : contraintes, index partiels, RLS,
 * privilège de colonne, absence d'heuristique d'unité.
 *
 * ⚠️ IL NE REDOUBLE NI `liste-de-courses-c1` NI `liste-de-courses-ux`.
 * L'agrégation, la période et le parcours y sont déjà mesurés.
 *
 * ⚠️ AUCUN ACCÈS RÉSEAU, AUCUNE BASE. Les fonctions mesurées ici sont pures ou
 * rendues en mémoire. La migration est éprouvée séparément par le banc SQL
 * local (`banc-c2/checklist.sql`, 45 assertions, 8 contrôles négatifs) : une
 * suite Node qui écrirait en base serait une suite qui écrit en PRODUCTION le
 * jour où quelqu'un l'exécute avec les bonnes variables d'environnement.
 *
 * Lancement : npm run test:liste-de-courses-c2
 */
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { createElement } from "react";
import { renderToString } from "react-dom/server";

import { ListeDeCoursesPersistante } from "../../components/student/ListeDeCoursesPersistante";
import type { LigneDeCourses } from "../../lib/nutrition/liste-de-courses";
import {
  cleDeLignePersistee,
  etatDeLaListe,
  lignesAAfficher,
  lignesPourRpc,
  progression,
  signatureDeLaListe,
  signatureDuPlan,
  type LignePersistee,
  type ListePersistee,
} from "../../lib/nutrition/liste-persistante";
import { NBSP } from "../../lib/nutrition/basis-points";
import { construirePeriode } from "../../lib/nutrition/periode-courses";

const MIGRATION = readFileSync(
  new URL("../../supabase/migrations/20260915090000_c2_liste_de_courses_persistante.sql", import.meta.url),
  "utf8",
);
const MODULE_PUR = readFileSync(new URL("../../lib/nutrition/liste-persistante.ts", import.meta.url), "utf8");
const MODULE_BASE = readFileSync(new URL("../../lib/supabase/liste-de-courses.ts", import.meta.url), "utf8");
const HOOK = readFileSync(new URL("../../hooks/useListePersistante.ts", import.meta.url), "utf8");
const ECRAN = readFileSync(
  new URL("../../components/student/ListeDeCoursesPersistante.tsx", import.meta.url),
  "utf8",
);

/**
 * ⚠️ ON CHERCHE DU CODE, PAS DE LA PROSE. Un commentaire qui dit « on ne
 * convertit jamais kg en g » contient le mot « kg » : chercher dans le fichier
 * entier ferait passer un test qui ne mesure qu'une bonne intention.
 */
function sansCommentaires(source: string): string {
  return source
    .replace(/\/\*[\s\S]*?\*\//g, " ")
    .replace(/(^|[^:])\/\/.*$/gm, "$1 ")
    .replace(/^\s*--.*$/gm, " ");
}

/** `renderToString` insère `<!-- -->` autour des interpolations. */
function texteRendu(html: string): string {
  return html
    .replace(/<!--[\s\S]*?-->/g, "")
    .replace(/&nbsp;| | /g, " ")
    .replace(/&#x27;|&apos;/g, "'")
    .replace(/\s+/g, " ");
}

const F1 = "11111111-1111-4111-8111-111111111111";
const F2 = "22222222-2222-4222-8222-222222222222";
const P1 = "33333333-3333-4333-8333-333333333333";

function lignePlan(over: Partial<LignePersistee> = {}): LignePersistee {
  return {
    id: "l1",
    source: "plan",
    catalogFoodId: F1,
    productId: null,
    label: null,
    quantity: 300,
    unit: "g",
    checked: false,
    creeLe: "2026-03-02T10:00:00Z",
    ...over,
  };
}

function ligneManuelle(over: Partial<LignePersistee> = {}): LignePersistee {
  return {
    id: "m1",
    source: "manual",
    catalogFoodId: null,
    productId: null,
    label: "Éponges",
    quantity: null,
    unit: null,
    checked: false,
    creeLe: "2026-03-02T11:00:00Z",
    ...over,
  };
}

function liste(lignes: readonly LignePersistee[]): ListePersistee {
  return { id: "L", debut: "2026-03-02", fin: "2026-03-04", majLe: "2026-03-02T12:00:00Z", lignes };
}

function duPlan(over: Partial<LigneDeCourses> = {}): LigneDeCourses {
  return {
    cle: `catalog_food:${F1}|g`,
    identityType: "catalog_food",
    identityId: F1,
    unit: "g",
    quantite: 300,
    displayName: "Poulet",
    colorKey: null,
    sources: [],
    ...over,
  };
}

/* ══════════════════════════════════════════════════════════════════════════
 * C2-01 à C2-06 — LA CLÉ D'UNE LIGNE PERSISTÉE
 * ════════════════════════════════════════════════════════════════════════ */

test("C2-01 la clé d'une ligne PLAN est EXACTEMENT celle de C1", () => {
  assert.equal(cleDeLignePersistee(lignePlan()), `catalog_food:${F1}|g`);
  assert.equal(
    cleDeLignePersistee(lignePlan({ catalogFoodId: null, productId: P1 })),
    `product:${P1}|g`,
  );
});

test("C2-02 l'unité fait partie de la clé : deux unités, deux clés", () => {
  const enG = cleDeLignePersistee(lignePlan({ unit: "g" }));
  const enPiece = cleDeLignePersistee(lignePlan({ unit: "piece" }));
  assert.notEqual(enG, enPiece);
});

test("C2-03 un article MANUEL n'a pas de clé d'agrégation", () => {
  assert.equal(cleDeLignePersistee(ligneManuelle()), null);
});

test("C2-04 une ligne PLAN à deux cibles, ou à zéro, est écartée", () => {
  assert.equal(cleDeLignePersistee(lignePlan({ productId: P1 })), null);
  assert.equal(cleDeLignePersistee(lignePlan({ catalogFoodId: null })), null);
});

test("C2-05 une ligne PLAN sans unité est écartée", () => {
  assert.equal(cleDeLignePersistee(lignePlan({ unit: null })), null);
});

test("C2-06 le module pur ne convertit AUCUNE unité", () => {
  const code = sansCommentaires(MODULE_PUR);
  for (const interdit of ["1000", "* 1000", "/ 1000", "'kg'", '"kg"', "'L'"]) {
    assert.ok(!code.includes(interdit), `conversion suspecte : ${interdit}`);
  }
});

/* ══════════════════════════════════════════════════════════════════════════
 * C2-07 à C2-13 — §14 : LA DÉTECTION DE CHANGEMENT
 * ════════════════════════════════════════════════════════════════════════ */

test("C2-07 une liste identique au plan est « à jour »", () => {
  assert.equal(etatDeLaListe(liste([lignePlan()]), [duPlan()]), "a_jour");
});

test("C2-08 aucune liste = « absente », et surtout pas « à jour »", () => {
  assert.equal(etatDeLaListe(null, [duPlan()]), "absente");
});

test("C2-09 une quantité qui change déclenche « à mettre à jour »", () => {
  assert.equal(etatDeLaListe(liste([lignePlan()]), [duPlan({ quantite: 400 })]), "a_mettre_a_jour");
});

test("C2-10 un aliment qui disparaît du plan déclenche « à mettre à jour »", () => {
  assert.equal(etatDeLaListe(liste([lignePlan()]), []), "a_mettre_a_jour");
});

test("C2-11 un LIBELLÉ qui change ne déclenche RIEN (§14 : pas de comparaison par nom)", () => {
  assert.equal(
    etatDeLaListe(liste([lignePlan()]), [duPlan({ displayName: "Poulet, cuit, filet" })]),
    "a_jour",
  );
});

test("C2-12 l'ordre de lecture n'a aucune influence : la signature est triée", () => {
  const a = signatureDuPlan([duPlan(), duPlan({ cle: `catalog_food:${F2}|g`, identityId: F2 })]);
  const b = signatureDuPlan([duPlan({ cle: `catalog_food:${F2}|g`, identityId: F2 }), duPlan()]);
  assert.equal(a, b);
});

test("C2-13 les articles MANUELS ne comptent pas dans la signature", () => {
  assert.equal(
    signatureDeLaListe(liste([lignePlan(), ligneManuelle()])),
    signatureDeLaListe(liste([lignePlan()])),
  );
});

/* ══════════════════════════════════════════════════════════════════════════
 * C2-14 à C2-19 — L'ASSEMBLAGE POUR L'ÉCRAN
 * ════════════════════════════════════════════════════════════════════════ */

test("C2-14 les lignes PLAN sont hydratées depuis l'agrégation du jour", () => {
  const [ligne] = lignesAAfficher(liste([lignePlan()]), [duPlan()]);
  assert.equal(ligne.libelle, "Poulet");
  assert.equal(ligne.source, "plan");
});

test("C2-15 une ligne PLAN sans correspondance n'invente AUCUN nom", () => {
  const [ligne] = lignesAAfficher(liste([lignePlan()]), []);
  assert.equal(ligne.libelle, "Article à rafraîchir");
});

test("C2-16 un article manuel garde son libellé, et n'a pas de couleur", () => {
  const affichees = lignesAAfficher(liste([ligneManuelle()]), []);
  assert.equal(affichees[0].libelle, "Éponges");
  assert.equal(affichees[0].colorKey, null);
  assert.equal(affichees[0].quantite, null);
});

test("C2-17 les manuels sont TOUJOURS après les lignes de plan", () => {
  const affichees = lignesAAfficher(
    liste([ligneManuelle({ label: "AAA" }), lignePlan()]),
    [duPlan({ displayName: "ZZZ" })],
  );
  assert.deepEqual(
    affichees.map((l) => l.source),
    ["plan", "manual"],
  );
});

test("C2-18 la progression compte les cochées SANS les retirer du total (§9)", () => {
  const affichees = lignesAAfficher(
    liste([lignePlan({ checked: true }), lignePlan({ id: "l2", catalogFoodId: F2 }), ligneManuelle()]),
    [duPlan(), duPlan({ cle: `catalog_food:${F2}|g`, identityId: F2, displayName: "Riz" })],
  );
  const p = progression(affichees);
  assert.equal(p.total, 3);
  assert.equal(p.coches, 1);
  assert.equal(p.libelle, `1${NBSP}/${NBSP}3 articles`);
});

test("C2-19 la charge utile RPC ne porte NI nom NI couleur", () => {
  const [ligne] = lignesPourRpc([duPlan({ displayName: "Poulet", colorKey: "green" })]);
  assert.deepEqual(Object.keys(ligne).sort(), ["catalog_food_id", "product_id", "quantity", "unit"]);
  assert.equal(ligne.catalog_food_id, F1);
  assert.equal(ligne.product_id, null);
});

/* ══════════════════════════════════════════════════════════════════════════
 * C2-20 à C2-23 — L'ÉCRAN
 * ════════════════════════════════════════════════════════════════════════ */

const PERIODE = construirePeriode("2026-03-02", 3);

test("C2-20 l'écran porte le titre « MA LISTE DE COURSES »", () => {
  const html = renderToString(
    createElement(ListeDeCoursesPersistante, {
      periode: PERIODE,
      lignesDuPlan: [],
      studentId: null,
      restants: 0,
    }),
  );
  assert.ok(texteRendu(html).includes("MA LISTE DE COURSES"));
});

test("C2-21 sans liste, l'écran propose « GÉNÉRER MA LISTE » et rien d'autre", () => {
  const html = texteRendu(
    renderToString(
      createElement(ListeDeCoursesPersistante, {
        periode: PERIODE,
        lignesDuPlan: [duPlan()],
        studentId: null,
        restants: 0,
      }),
    ),
  );
  assert.ok(html.includes("GÉNÉRER MA LISTE"));
  assert.ok(!html.includes("METTRE À JOUR MA LISTE"));
  // §13 : pas de bouton d'ajout tant qu'il n'y a pas de liste où ajouter.
  assert.ok(!html.includes("+ AJOUTER UN ARTICLE"));
});

test("C2-22 les repas restant à composer sont signalés, pas dissimulés", () => {
  const html = texteRendu(
    renderToString(
      createElement(ListeDeCoursesPersistante, {
        periode: PERIODE,
        lignesDuPlan: [],
        studentId: null,
        restants: 2,
      }),
    ),
  );
  assert.ok(html.includes("2 repas restent à composer"));
});

test("C2-23 l'écran ne rend rien sans période", () => {
  const html = renderToString(
    createElement(ListeDeCoursesPersistante, {
      periode: null,
      lignesDuPlan: [],
      studentId: null,
      restants: 0,
    }),
  );
  assert.equal(html, "");
});

/* ══════════════════════════════════════════════════════════════════════════
 * C2-24 à C2-28 — LA MIGRATION, ET LES INTERDITS
 * ════════════════════════════════════════════════════════════════════════ */

test("C2-24 les deux index d'unicité PLAN sont PARTIELS et portent l'unité", () => {
  const sql = sansCommentaires(MIGRATION);
  for (const cible of ["catalog_food_id, unit)", "product_id, unit)"]) {
    assert.ok(sql.includes(cible), `index attendu sur ${cible}`);
  }
  assert.equal((sql.match(/where source = 'plan' and \w+ is not null/g) ?? []).length, 2);
});

test("C2-25 le privilège d'UPDATE du client est réduit à la colonne `checked`", () => {
  const sql = sansCommentaires(MIGRATION);
  assert.ok(sql.includes("grant update (checked)"));
  // Aucun `grant update` NU sur la table : ce serait §12 rouvert en grand.
  assert.ok(!/grant update\s+on table public\.shopping_list_items/.test(sql));
});

test("C2-26 la réconciliation compare avec `is not distinct from`, jamais avec `=`", () => {
  const sql = sansCommentaires(MIGRATION);
  // Trois comparaisons d'identité (delete, update, insert) × 2 colonnes = 6.
  assert.equal((sql.match(/is not distinct from/g) ?? []).length, 6);
  assert.ok(!/l\.catalog_food_id = i\.catalog_food_id/.test(sql));
  assert.ok(!/l\.product_id\s+= i\.product_id/.test(sql));
});

test("C2-27 la mise à jour n'écrit JAMAIS `checked`, et la RLS passe par le helper unique", () => {
  const sql = sansCommentaires(MIGRATION);
  const debut = sql.indexOf("update public.shopping_list_items i");
  const fin = sql.indexOf("insert into public.shopping_list_items", debut);
  assert.ok(debut > 0 && fin > debut);
  assert.ok(!sql.slice(debut, fin).includes("checked"));
  assert.ok(sql.includes("public.current_student_id()"));
  // ⚠️ AUCUNE SECONDE LOGIQUE D'IDENTITÉ (§15).
  assert.ok(!sql.includes("auth.uid()"));
});

test("C2-28 aucune heuristique d'unité, nulle part (§21)", () => {
  for (const [nom, source] of [
    ["migration", MIGRATION],
    ["module pur", MODULE_PUR],
    ["couche base", MODULE_BASE],
    ["hook", HOOK],
    ["écran", ECRAN],
  ] as const) {
    const code = sansCommentaires(source);
    for (const interdit of ["jus", "sauce", "huile", "boisson", "liquide"]) {
      assert.ok(
        !new RegExp(`["'\`]${interdit}`, "i").test(code),
        `${nom} : heuristique de nom vers unité (${interdit})`,
      );
    }
  }
});

test("C2-29 aucune régénération silencieuse : le hook n'appelle la RPC que sur geste", () => {
  const code = sansCommentaires(HOOK);
  const debutEffet = code.indexOf("useEffect(");
  const finEffet = code.indexOf("}, [charger, rafraichissement]);");
  assert.ok(debutEffet > 0 && finEffet > debutEffet);
  assert.ok(!code.slice(debutEffet, finEffet).includes("regenerer"));
});

test("C2-30 la couche base n'agrège rien et n'a aucun second moteur", () => {
  const code = sansCommentaires(MODULE_BASE);
  for (const interdit of ["agreger", "reduce(", ".sum", "cleDeLigne("]) {
    assert.ok(!code.includes(interdit), `moteur dupliqué : ${interdit}`);
  }
});
