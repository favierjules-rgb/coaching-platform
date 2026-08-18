/**
 * Harnais — COURSES C4.5 : CONDITIONNEMENTS ET QUANTITÉS ACHETÉES.
 *
 * ────────────────────────────────────────────────────────────────────────────
 * CE QUE CE FICHIER PROUVE
 * ────────────────────────────────────────────────────────────────────────────
 * Qu'un besoin nutritionnel et un conditionnement réel donnent un NOMBRE DE
 * PAQUETS, un surplus et un coût — exacts, en arithmétique entière ; qu'une
 * référence inexploitable garde une RAISON plutôt que de disparaître ; qu'aucune
 * conversion entre dimensions n'est tentée ; et qu'aucun produit n'est élu.
 *
 * ⚠️ AUCUN ACCÈS RÉSEAU, AUCUNE BASE, AUCUNE CURATION RÉELLE. Open Food Facts
 * peut rester en panne : tout est fixture.
 *
 * Lancement : npm run test:conditionnements-c4-5
 */
import assert from "node:assert/strict";
import { readdirSync, readFileSync } from "node:fs";
import test from "node:test";

import {
  type Conditionnement,
  type ScenarioAchat,
  dimensionDe,
  quantiteMilliDepuis,
  scenariosAchat,
} from "../../lib/nutrition/conditionnements";
import type { ObservationPrix } from "../../lib/nutrition/prix-observes";

const lire = (chemin: string) => readFileSync(new URL(chemin, import.meta.url), "utf8");
const PUR = lire("../../lib/nutrition/conditionnements.ts");
const BASE = lire("../../lib/supabase/conditionnements.ts");
const MIGRATION_PRODUITS = lire("../../supabase/migrations/20260903090000_food_products.sql");
const MIGRATION_C2 = lire("../../supabase/migrations/20260915090000_c2_liste_de_courses_persistante.sql");

function sansCommentaires(source: string): string {
  return source.replace(/\/\*[\s\S]*?\*\//g, " ").replace(/(^|[^:])\/\/.*$/gm, "$1 ");
}

const MAGASIN = 12345;

/** Une observation C4.4 bien formée — `pricePer` NUL, comme tout `type=PRODUCT`. */
function observation(
  gtin: string,
  montantMilli: number,
  priceId: number,
  surcharge: Partial<ObservationPrix> = {},
): ObservationPrix {
  return {
    priceId,
    gtin,
    montantMilli,
    devise: "EUR",
    observeLe: "2026-08-01",
    createdLe: "2026-08-02T10:00:00.123456Z",
    opLocationId: MAGASIN,
    pricePer: null,
    ...surcharge,
  };
}

/**
 * Des millièmes → la chaîne décimale EXACTE que porterait `numeric` en base.
 *
 * ⚠️ `milli / 1000` EN FLOTTANT NE CONVIENT PAS pour les valeurs extrêmes :
 * 9007199254740991 / 1000 ne se représente pas exactement, et la fixture
 * testerait alors autre chose que ce qu'elle annonce. On compose la chaîne.
 */
function qte(milli: number): string {
  return `${Math.floor(milli / 1000)}.${String(milli % 1000).padStart(3, "0")}`;
}

const cond = (netQuantity: number, netUnit: "g" | "ml"): Conditionnement => ({
  netQuantity,
  netUnit,
});

function calculable(s: readonly unknown[], i: number): ScenarioAchat {
  const scenario = s[i] as ScenarioAchat;
  assert.equal(scenario.calculable, true, `le scénario ${i} devait être calculable`);
  return scenario;
}

// ════════════════════════════════════════════════════════════════════════════
// A. LE CAS OBLIGATOIRE : 500 g, TROIS RÉFÉRENCES, AUCUN GAGNANT
// ════════════════════════════════════════════════════════════════════════════

const A = "3560070976478";
const B = "20087090";
const C = "3596710352104";

await test("C4.5-01 — besoin 500 g : A(375 g) · B(500 g) · C(1 kg) → TROIS scénarios", () => {
  const scenarios = scenariosAchat({
    besoin: { quantite: 500, unite: "g" },
    observations: [observation(A, 1690, 1), observation(B, 2190, 2), observation(C, 3590, 3)],
    conditionnements: new Map([
      [A, cond(375, "g")],
      [B, cond(500, "g")],
      [C, cond(1000, "g")],
    ]),
  });

  assert.equal(scenarios.length, 3, "trois références, trois scénarios");

  const a = calculable(scenarios, 0);
  assert.equal(a.gtin, A);
  assert.equal(a.nombreConditionnements, 2, "375 g ne couvre pas 500 g : il en faut deux");
  assert.equal(a.quantiteAcheteeMilli, 750_000, "750 g achetés");
  assert.equal(a.surplusMilli, 250_000, "250 g de surplus");
  assert.equal(a.coutTotalMilli, 3380, "2 × 1,690 € = 3,380 €");

  const b = calculable(scenarios, 1);
  assert.equal(b.nombreConditionnements, 1);
  assert.equal(b.quantiteAcheteeMilli, 500_000);
  assert.equal(b.surplusMilli, 0, "division exacte : aucun surplus");
  assert.equal(b.coutTotalMilli, 2190);

  const c = calculable(scenarios, 2);
  assert.equal(c.nombreConditionnements, 1);
  assert.equal(c.quantiteAcheteeMilli, 1_000_000);
  assert.equal(c.surplusMilli, 500_000);
  assert.equal(c.coutTotalMilli, 3590);
});

await test("C4.5-02 — AUCUNE élection, AUCUNE moyenne, AUCUN classement", () => {
  const scenarios = scenariosAchat({
    besoin: { quantite: 500, unite: "g" },
    observations: [observation(A, 1690, 1), observation(B, 2190, 2), observation(C, 3590, 3)],
    conditionnements: new Map([
      [A, cond(375, "g")],
      [B, cond(500, "g")],
      [C, cond(1000, "g")],
    ]),
  });

  // ⚠️ B EST LE MOINS CHER (2,190 € contre 3,380 € et 3,590 €). C4.5 le sait
  // — et ne le dit pas. L'élection appartient au lot suivant.
  const brut = scenarios as unknown as Record<string, unknown>;
  for (const interdit of [
    "meilleur",
    "moinsCher",
    "retenu",
    "gagnant",
    "moyenne",
    "prixMin",
    "recommande",
  ]) {
    assert.equal(brut[interdit], undefined, `aucun champ « ${interdit} »`);
    for (const s of scenarios) {
      assert.equal((s as unknown as Record<string, unknown>)[interdit], undefined);
    }
  }
  // L'ORDRE D'ENTRÉE EST CONSERVÉ : celui de C4.4, jamais un tri par prix.
  assert.deepEqual(scenarios.map((s) => s.gtin), [A, B, C]);

  // Et le module ne contient aucun classement.
  const nu = sansCommentaires(PUR);
  for (const motif of [/\.sort\(/, /Math\.min\(/, /Math\.max\(/, /reduce\(/]) {
    assert.ok(!motif.test(nu), `le module ne doit pas porter ${motif}`);
  }
});

// ════════════════════════════════════════════════════════════════════════════
// B. L'ARITHMÉTIQUE
// ════════════════════════════════════════════════════════════════════════════

await test("C4.5-03 — besoin égal, inférieur, supérieur, multiple du paquet", () => {
  const cas: ReadonlyArray<readonly [number, number, number, number]> = [
    // besoin g, paquet g, nb attendu, surplus g
    [500, 500, 1, 0], // exactement égal
    [200, 500, 1, 300], // inférieur : on achète quand même UN paquet
    [600, 500, 2, 400], // supérieur
    [1500, 500, 3, 0], // multiple exact
    [1501, 500, 4, 499], // un gramme de plus ⇒ un paquet de plus
    [1, 1000, 1, 999], // besoin minuscule
  ];
  for (const [besoin, paquet, nb, surplus] of cas) {
    const [s] = scenariosAchat({
      besoin: { quantite: besoin, unite: "g" },
      observations: [observation(A, 1000, 1)],
      conditionnements: new Map([[A, cond(paquet, "g")]]),
    });
    const ok = calculable([s], 0);
    assert.equal(ok.nombreConditionnements, nb, `${besoin} g / ${paquet} g`);
    assert.equal(ok.surplusMilli, surplus * 1000, `surplus de ${besoin} g / ${paquet} g`);
    assert.ok(ok.surplusMilli >= 0, "le surplus n'est JAMAIS négatif");
    assert.equal(ok.quantiteAcheteeMilli, nb * paquet * 1000);
  }
});

await test("C4.5-04 — le coût est un ENTIER de millièmes, multiplié exactement", () => {
  // ⚠️ AUCUN FLOTTANT, AUCUN `Math.round` MONÉTAIRE. `montantMilli` vient de
  // C4.4 en millièmes entiers ; le coût total est une multiplication entière.
  const [s] = scenariosAchat({
    besoin: { quantite: 1000, unite: "g" },
    observations: [observation(A, 1690, 1)],
    conditionnements: new Map([[A, cond(375, "g")]]),
  });
  const ok = calculable([s], 0);
  assert.equal(ok.nombreConditionnements, 3);
  assert.equal(ok.coutTotalMilli, 5070, "3 × 1690");
  assert.ok(Number.isInteger(ok.coutTotalMilli));

  // Un montant à trois décimales survit intact à la multiplication.
  const [s2] = scenariosAchat({
    besoin: { quantite: 1000, unite: "g" },
    observations: [observation(A, 2999, 1)],
    conditionnements: new Map([[A, cond(400, "g")]]),
  });
  assert.equal(calculable([s2], 0).coutTotalMilli, 8997, "3 × 2999, sans perte");

  // Aucun flottant ni arrondi monétaire dans le module.
  const nu = sansCommentaires(PUR);
  for (const motif of [/Math\.round\(/, /toFixed\(/, /parseFloat\(/, /\* 0\.\d/]) {
    assert.ok(!motif.test(nu), `arithmétique approximative interdite : ${motif}`);
  }
});

await test("C4.5-05 — `quantiteMilliDepuis` : entier exact ou refus, jamais d'arrondi", () => {
  assert.equal(quantiteMilliDepuis(500), 500_000);
  assert.equal(quantiteMilliDepuis("375"), 375_000);
  assert.equal(quantiteMilliDepuis("12.5"), 12_500);
  assert.equal(quantiteMilliDepuis("0.001"), 1);
  // Au-delà de trois décimales, notre représentation ne suffit plus : on REFUSE
  // plutôt que de tronquer en silence.
  for (const mauvais of [0, -1, "0", "-5", "1.2345", "", "abc", null, undefined, NaN, Infinity, {}]) {
    assert.equal(quantiteMilliDepuis(mauvais), null, `${String(mauvais)} doit être refusé`);
  }
});

// ════════════════════════════════════════════════════════════════════════════
// C. LES DIMENSIONS — AUCUNE CONVERSION INVENTÉE
// ════════════════════════════════════════════════════════════════════════════

await test("C4.5-06 — trois dimensions, et le vocabulaire est celui de la plateforme", () => {
  assert.equal(dimensionDe("g"), "masse");
  assert.equal(dimensionDe("ml"), "volume");
  assert.equal(dimensionDe("piece"), "compte");
  for (const inconnue of ["kg", "l", "cl", "mg", "portion", "", null, undefined, 12]) {
    assert.equal(dimensionDe(inconnue), null, `${String(inconnue)} n'est pas une unité de courses`);
  }

  // ⚠️ CE VOCABULAIRE N'EST PAS UN CHOIX DE C4.5 : IL EST EN BASE.
  assert.match(
    MIGRATION_C2,
    /shopping_list_items_unit_check[\s\S]{0,200}unit in \('g', 'ml', 'piece'\)/,
    "le besoin ne connaît que g, ml et piece",
  );
  assert.match(
    MIGRATION_PRODUITS,
    /food_products_net_unit_check[\s\S]{0,120}net_unit in \('g', 'ml'\)/,
    "un conditionnement ne connaît que g et ml",
  );
});

await test("C4.5-07 — masse contre volume : INCALCULABLE, jamais 1 ml = 1 g", () => {
  const [s] = scenariosAchat({
    besoin: { quantite: 500, unite: "g" },
    observations: [observation(A, 1690, 1)],
    conditionnements: new Map([[A, cond(500, "ml")]]),
  });
  assert.equal(s!.calculable, false);
  assert.equal(s!.calculable === false ? s!.raison : null, "unite_incompatible");

  const [inverse] = scenariosAchat({
    besoin: { quantite: 500, unite: "ml" },
    observations: [observation(A, 1690, 1)],
    conditionnements: new Map([[A, cond(500, "g")]]),
  });
  assert.equal(inverse!.calculable, false);

  // ⚠️ AUCUNE DENSITÉ, NULLE PART. Ni constante, ni table, ni « à peu près ».
  const nu = sansCommentaires(PUR) + sansCommentaires(BASE);
  for (const motif of [/densit/i, /density/i, /1\s*ml\s*=\s*1\s*g/i, /poidsMoyen/i, /gramsPerMl/i]) {
    assert.ok(!motif.test(nu), `aucune densité implicite : ${motif}`);
  }
});

await test("C4.5-08 — un besoin en PIÈCES : trou de COUVERTURE, pas conflit de dimension", () => {
  // ⚠️ LA RAISON N'EST PAS `unite_incompatible`, ET C'EST TOUT L'OBJET DE CE
  // TEST. « 6 œufs » n'est pas un problème de densité : c'est une donnée
  // MANQUANTE. Aucun conditionnement n'est exprimé en unités commerciales.
  for (const unite of ["g", "ml"] as const) {
    const [s2] = scenariosAchat({
      besoin: { quantite: 6, unite: "piece" },
      observations: [observation(A, 1690, 1)],
      conditionnements: new Map([[A, cond(500, unite)]]),
    });
    assert.equal(s2!.calculable, false);
    assert.equal(
      s2!.calculable === false ? s2!.raison : null,
      "conditionnement_unitaire_absent",
      "un besoin en pièces ne doit JAMAIS être rangé sous unite_incompatible",
    );
  }

  // Et réciproquement : masse contre volume reste `unite_incompatible`. Les
  // deux refus ne doivent jamais fusionner.
  const [masseVolume] = scenariosAchat({
    besoin: { quantite: 500, unite: "g" },
    observations: [observation(A, 1690, 1)],
    conditionnements: new Map([[A, cond(500, "ml")]]),
  });
  assert.equal(
    masseVolume!.calculable === false ? masseVolume!.raison : null,
    "unite_incompatible",
  );
});

await test("C4.5-08b — « 1 pièce = 1 conditionnement » est IMPOSSIBLE, aujourd'hui et demain", () => {
  // ⚠️ LE RACCOURCI À INTERDIRE POUR DE BON. Le jour où quelqu'un voudra
  // « faire marcher les pièces », le geste le plus tentant sera de décréter
  // qu'un conditionnement vaut une pièce. Ce test le rend rouge.

  // 1. La base ne peut PAS produire un conditionnement en pièces.
  assert.match(
    MIGRATION_PRODUITS,
    /food_products_net_unit_check[\s\S]{0,120}net_unit in \('g', 'ml'\)/,
    "'piece' est absent du CHECK, et doit le rester",
  );
  assert.ok(
    !/net_unit[\s\S]{0,80}'piece'/.test(MIGRATION_PRODUITS),
    "aucune migration ne doit ouvrir net_unit à 'piece'",
  );

  // 2. Même si une lecture future en fabriquait un, le calcul le REFUSE.
  const [force] = scenariosAchat({
    besoin: { quantite: 6, unite: "piece" },
    observations: [observation(A, 1690, 1)],
    conditionnements: new Map([[A, { netQuantity: 1, netUnit: "piece" as "g" }]]),
  });
  assert.equal(force!.calculable, false, "6 pièces ne deviennent pas 6 paquets");
  assert.equal(
    force!.calculable === false ? force!.raison : null,
    "conditionnement_unitaire_absent",
  );

  // 3. Et aucune valeur par défaut ne traîne dans le module.
  const nu = sansCommentaires(PUR);
  for (const motif of [
    /piece[\s\S]{0,40}=\s*1\b/i,
    /netUnit\s*[:=]\s*"piece"/,
    /uniteConditionnement\s*[:=]\s*"piece"/,
    /poidsMoyen|poids_moyen|nombreUnites|unitesParLot|itemsPerPack/i,
  ]) {
    assert.ok(!motif.test(nu), `aucune invention unitaire : ${motif}`);
  }

  // 4. Et le texte libre `quantity` d'OFF n'est analysé nulle part.
  assert.ok(
    !/\bquantity\b/.test(sansCommentaires(PUR) + sansCommentaires(BASE)),
    "aucun parsing du texte libre `quantity`",
  );
});

// ════════════════════════════════════════════════════════════════════════════
// C bis. LES FRONTIÈRES DE L'ENTIER SÛR
// ════════════════════════════════════════════════════════════════════════════

const MAX_SUR = Number.MAX_SAFE_INTEGER; // 2^53 − 1

await test("C4.5-16 — `ceil` entier reste EXACT jusqu'à la borne", () => {
  // ⚠️ LA DÉMONSTRATION EST DANS LE MODULE ; ce test en vérifie les cas
  // limites. `Math.floor(a/b)` ne peut pas franchir un entier par arrondi
  // tant que a ≤ 2^53−1 — on l'éprouve sur les valeurs les plus hostiles.
  const cas: ReadonlyArray<readonly [number, number, number]> = [
    [MAX_SUR, 1, MAX_SUR], // division exacte à la borne
    [MAX_SUR, MAX_SUR, 1], // a = b
    [MAX_SUR - 1, MAX_SUR, 1], // a juste en dessous de b
    [MAX_SUR, MAX_SUR - 1, 2], // un reste de 1 tout en haut
    [999_999_999_999_999, 3, 333_333_333_333_333], // divisible, gros
    [1_000_000_000_000_000, 3, 333_333_333_333_334], // reste 1, gros
  ];
  let eprouves = 0;
  for (const [a, b, attendu] of cas) {
    const [s2] = scenariosAchat({
      besoin: { quantite: qte(a), unite: "g" },
      observations: [observation(A, 0, 1)],
      conditionnements: new Map([[A, { netQuantity: qte(b), netUnit: "g" }]]),
    });
    // ⚠️ CERTAINS DE CES PRODUITS DÉBORDENT (c'est l'objet de C4.5-17) ; on
    // n'éprouve `ceil` que là où le scénario est calculable, mais on EXIGE
    // qu'au moins la moitié des cas le soit — sinon ce test ne prouverait rien.
    if (s2!.calculable) {
      eprouves += 1;
      assert.equal((s2 as ScenarioAchat).nombreConditionnements, attendu, `ceil(${a}/${b})`);
    }
  }
  assert.ok(eprouves >= 3, `trop peu de cas calculables éprouvés : ${eprouves}`);
});

await test("C4.5-17 — quantité achetée hors entier sûr → depassement_exactitude", () => {
  // a = 2^53−1 millièmes, b = 2^53−2 millièmes ⇒ n = 2, n×b = 2^54−4 : au-delà
  // de la borne. Le calcul ne doit ni saturer, ni arrondir, ni passer.
  const [s2] = scenariosAchat({
    besoin: { quantite: qte(MAX_SUR), unite: "g" },
    observations: [observation(A, 1690, 1)],
    conditionnements: new Map([[A, { netQuantity: qte(MAX_SUR - 1), netUnit: "g" }]]),
  });
  assert.equal(s2!.calculable, false);
  assert.ok(
    s2!.calculable === false &&
      (s2!.raison === "depassement_exactitude" || s2!.raison === "conditionnement_invalide"),
    `raison inattendue : ${s2!.calculable === false ? s2!.raison : "calculable"}`,
  );
});

await test("C4.5-18 — coût total hors entier sûr → depassement_exactitude, jamais Infinity", () => {
  // Un besoin énorme sur un paquet minuscule : le NOMBRE de paquets est sûr,
  // mais son produit par le montant ne l'est plus.
  const [s2] = scenariosAchat({
    besoin: { quantite: 9_000_000_000, unite: "g" }, // 9e12 millièmes
    observations: [observation(A, 9_999_999_999, 1)], // le plafond amont
    conditionnements: new Map([[A, cond(0.001, "g")]]), // 1 millième
  });
  assert.equal(s2!.calculable, false);
  assert.equal(s2!.calculable === false ? s2!.raison : null, "depassement_exactitude");
});

await test("C4.5-19 — juste SOUS la borne, tout reste exact et calculable", () => {
  // ⚠️ LE PENDANT INDISPENSABLE : une garde qui refuserait TOUT passerait les
  // deux tests précédents sans rien protéger.
  const [s2] = scenariosAchat({
    besoin: { quantite: 1_000_000, unite: "g" }, // 1e9 millièmes
    observations: [observation(A, 1690, 1)],
    conditionnements: new Map([[A, cond(1000, "g")]]), // 1e6 millièmes
  });
  const ok = calculable([s2], 0);
  assert.equal(ok.nombreConditionnements, 1000);
  assert.equal(ok.quantiteAcheteeMilli, 1_000_000_000);
  assert.equal(ok.surplusMilli, 0);
  assert.equal(ok.coutTotalMilli, 1_690_000);
  for (const v of [
    ok.besoinMilli,
    ok.conditionnementMilli,
    ok.nombreConditionnements,
    ok.quantiteAcheteeMilli,
    ok.surplusMilli,
    ok.coutTotalMilli,
  ]) {
    assert.ok(Number.isSafeInteger(v), `${v} doit être un entier sûr`);
  }
});

await test("C4.5-20 — TOUT résultat calculable porte des entiers sûrs, surplus ≥ 0", () => {
  // Balayage : quelques centaines de combinaisons, et l'invariant tient partout.
  const besoins = [1, 7, 250, 500, 999, 1000, 123_456, 9_999_999];
  const paquets = [1, 3, 125, 375, 500, 1000, 2500, 100_000];
  const montants = [0, 1, 1690, 2190, 9_999_999_999];
  let calculables = 0;
  for (const b of besoins) {
    for (const p of paquets) {
      for (const m of montants) {
        const [s2] = scenariosAchat({
          besoin: { quantite: b, unite: "g" },
          observations: [observation(A, m, 1)],
          conditionnements: new Map([[A, cond(p, "g")]]),
        });
        if (!s2!.calculable) continue;
        calculables += 1;
        const o = s2 as ScenarioAchat;
        assert.ok(Number.isSafeInteger(o.nombreConditionnements));
        assert.ok(Number.isSafeInteger(o.quantiteAcheteeMilli));
        assert.ok(Number.isSafeInteger(o.coutTotalMilli));
        assert.ok(o.surplusMilli >= 0, "le surplus n'est jamais négatif");
        assert.ok(Number.isSafeInteger(o.surplusMilli));
        assert.equal(o.quantiteAcheteeMilli, o.nombreConditionnements * o.conditionnementMilli);
        assert.equal(o.surplusMilli, o.quantiteAcheteeMilli - o.besoinMilli);
        assert.ok(
          o.quantiteAcheteeMilli >= o.besoinMilli,
          "la quantité achetée COUVRE toujours le besoin",
        );
      }
    }
  }
  assert.ok(calculables > 300, `balayage trop maigre : ${calculables} scénarios`);
});

await test("C4.5-21 — aucune saturation, aucun clamp, aucun BigInt", () => {
  const nu = sansCommentaires(PUR);
  for (const motif of [/BigInt|\d+n\b/, /clamp/i, /Math\.min\(/, /Math\.max\(/, /\|\| 0\b/]) {
    assert.ok(!motif.test(nu), `interdit dans le calcul : ${motif}`);
  }
  // Et la garde d'exactitude est bien là, sur LES DEUX produits.
  assert.match(nu, /Number\.isSafeInteger\(quantiteAcheteeMilli\)/);
  assert.match(nu, /Number\.isSafeInteger\(coutTotalMilli\)/);
});

// ════════════════════════════════════════════════════════════════════════════
// D. CE QUI N'EST PAS CALCULABLE GARDE UNE RAISON
// ════════════════════════════════════════════════════════════════════════════

await test("C4.5-09 — conditionnement ABSENT : raison explicite, jamais « 1 unité »", () => {
  // ⚠️ LE CAS LE PLUS FRÉQUENT. `net_quantity` est nullable et Open Food Facts
  // ne le publie pas toujours. Absent veut dire INCONNU — pas « un paquet ».
  for (const manquant of [null, undefined]) {
    const scenarios = scenariosAchat({
      besoin: { quantite: 500, unite: "g" },
      observations: [observation(A, 1690, 1)],
      conditionnements: manquant === null ? new Map([[A, null]]) : new Map(),
    });
    assert.equal(scenarios.length, 1, "la référence n'est PAS jetée");
    assert.equal(scenarios[0]!.calculable, false);
    assert.equal(
      scenarios[0]!.calculable === false ? scenarios[0]!.raison : null,
      "conditionnement_absent",
    );
  }
});

await test("C4.5-10 — conditionnement INVALIDE : zéro, négatif, unité inconnue", () => {
  const mauvais: readonly Conditionnement[] = [
    { netQuantity: 0, netUnit: "g" },
    { netQuantity: -500, netUnit: "g" },
    { netQuantity: Number.NaN, netUnit: "g" },
    { netQuantity: 500, netUnit: "kg" as "g" },
    { netQuantity: 500, netUnit: "piece" as "g" },
  ];
  for (const c of mauvais) {
    const [s] = scenariosAchat({
      besoin: { quantite: 500, unite: "g" },
      observations: [observation(A, 1690, 1)],
      conditionnements: new Map([[A, c]]),
    });
    assert.equal(s!.calculable, false, JSON.stringify(c));
    assert.ok(
      s!.calculable === false &&
        (s!.raison === "conditionnement_invalide" || s!.raison === "unite_incompatible"),
      `raison attendue pour ${JSON.stringify(c)}`,
    );
  }
});

await test("C4.5-11 — besoin nul, négatif ou illisible : REFUSÉ", () => {
  for (const quantite of [0, -1, -0.5, Number.NaN, Infinity, "", "abc", null, undefined]) {
    const [s] = scenariosAchat({
      besoin: { quantite, unite: "g" },
      observations: [observation(A, 1690, 1)],
      conditionnements: new Map([[A, cond(500, "g")]]),
    });
    assert.equal(s!.calculable, false, `besoin=${String(quantite)}`);
    assert.equal(s!.calculable === false ? s!.raison : null, "besoin_invalide");
  }
  // Une unité de besoin inconnue est refusée de la même façon.
  const [u] = scenariosAchat({
    besoin: { quantite: 500, unite: "kg" },
    observations: [observation(A, 1690, 1)],
    conditionnements: new Map([[A, cond(500, "g")]]),
  });
  assert.equal(u!.calculable === false ? u!.raison : null, "besoin_invalide");
});

await test("C4.5-12 — `pricePer` non nul : base de prix NON SUPPORTÉE, jamais extrapolée", () => {
  // ⚠️ VÉRIFIÉ SUR LA SOURCE AMONT, PAS SUPPOSÉ. `validate_price_price_rules`
  // impose : price_per « Should not be set if `product_code` is filled ». Un
  // prix `type=PRODUCT` a donc TOUJOURS `price_per = null`, et c'est ce qui en
  // fait un prix de CONDITIONNEMENT exploitable.
  //
  // Une observation `type=PRODUCT` qui porterait malgré tout UNIT ou KILOGRAM
  // contredirait la validation amont : nous ne savons pas ce qu'elle vaut, et
  // « 500 g × 3,50 €/kg » n'est PAS un passage en caisse.
  for (const pricePer of ["UNIT", "KILOGRAM"] as const) {
    const [s] = scenariosAchat({
      besoin: { quantite: 500, unite: "g" },
      observations: [observation(A, 3500, 1, { pricePer })],
      conditionnements: new Map([[A, cond(500, "g")]]),
    });
    assert.equal(s!.calculable, false, pricePer);
    assert.equal(s!.calculable === false ? s!.raison : null, "base_prix_non_supportee");
  }
  // `null` — le seul cas exploitable — passe.
  const [ok] = scenariosAchat({
    besoin: { quantite: 500, unite: "g" },
    observations: [observation(A, 2190, 1, { pricePer: null })],
    conditionnements: new Map([[A, cond(500, "g")]]),
  });
  assert.equal(ok!.calculable, true);
});

// ════════════════════════════════════════════════════════════════════════════
// E. N-GTIN, N OBSERVATIONS, ET CE QUI EST CONSERVÉ
// ════════════════════════════════════════════════════════════════════════════

await test("C4.5-13 — DEUX observations d'un même GTIN → DEUX scénarios", () => {
  // ⚠️ C4.5 NE CHOISIT PAS LE RELEVÉ LE PLUS RÉCENT. Une observation, un
  // scénario : la sélection appartient au lot suivant.
  const scenarios = scenariosAchat({
    besoin: { quantite: 500, unite: "g" },
    observations: [
      observation(A, 1690, 10, { observeLe: "2026-08-10" }),
      observation(A, 1590, 11, { observeLe: "2026-08-01" }),
    ],
    conditionnements: new Map([[A, cond(375, "g")]]),
  });
  assert.equal(scenarios.length, 2);
  assert.deepEqual(scenarios.map((s) => s.priceId), [10, 11]);
  assert.equal(calculable(scenarios, 0).coutTotalMilli, 3380);
  assert.equal(calculable(scenarios, 1).coutTotalMilli, 3180);
});

await test("C4.5-14 — date, createdLe et devise traversent intacts", () => {
  const [s] = scenariosAchat({
    besoin: { quantite: 500, unite: "g" },
    observations: [
      observation(A, 2190, 7, {
        observeLe: "2026-03-14",
        createdLe: "2026-03-15T08:09:10.000001Z",
      }),
    ],
    conditionnements: new Map([[A, cond(500, "g")]]),
  });
  const ok = calculable([s], 0);
  assert.equal(ok.observeLe, "2026-03-14", "la date d'observation reste affichable");
  assert.equal(ok.createdLe, "2026-03-15T08:09:10.000001Z");
  assert.equal(ok.devise, "EUR");
  assert.equal(ok.priceId, 7);
});

await test("C4.5-15 — un multipack est acheté ENTIER : 4 × 125 g est un paquet de 500 g", () => {
  // ⚠️ AUCUNE DÉCOMPOSITION, ET AUCUN CHAMP NE LA PERMETTRAIT. `net_quantity`
  // porte le POIDS NET DE CE QUI EST VENDU SOUS CE CODE-BARRES : un lot de
  // quatre pots de 125 g y vaut 500. Il n'existe NI compteur d'unités, NI
  // quantité unitaire dans `food_products` — donc rien à décomposer, et surtout
  // pas 125 g qui ne s'achète pas seul.
  const [s] = scenariosAchat({
    besoin: { quantite: 700, unite: "g" },
    observations: [observation(A, 2500, 1)],
    conditionnements: new Map([[A, cond(500, "g")]]),
  });
  const ok = calculable([s], 0);
  assert.equal(ok.nombreConditionnements, 2, "deux LOTS complets");
  assert.equal(ok.quantiteAcheteeMilli, 1_000_000);
  assert.equal(ok.surplusMilli, 300_000);
  assert.equal(ok.coutTotalMilli, 5000);

  // La preuve que rien n'existe à décomposer : la table ne porte que la paire.
  assert.ok(
    !/product_quantity_count|unit_count|items_per_pack|nombre_unites/i.test(MIGRATION_PRODUITS),
    "aucun compteur d'unités n'existe en base",
  );
});

// ════════════════════════════════════════════════════════════════════════════
// F. PÉRIMÈTRE
// ════════════════════════════════════════════════════════════════════════════

await test("PERIMETRE-C4.5 — lecture seule, aucun réseau, aucun budget", () => {
  const nu = sansCommentaires(PUR) + sansCommentaires(BASE);
  for (const motif of [
    /\.insert\(/,
    /\.update\(/,
    /\.upsert\(/,
    /\.delete\(/,
    /\.rpc\(/,
    /fetch\(/,
    /openfoodfacts/i,
    /budget/i,
    /food_price_estimates/,
    /price_cents/,
    /stock/i,
    /disponibilit/i,
  ]) {
    assert.ok(!motif.test(nu), `C4.5 ne doit pas porter ${motif}`);
  }
  // Le module pur ne parle à personne : aucun import de base ni de réseau.
  assert.ok(
    !/@\/lib\/supabase|@\/lib\/open-prices|@\/lib\/open-food-facts|server-only/.test(PUR),
    "la logique de C4.5 doit rester pure",
  );
  // Aucune migration ajoutée.
  const migrations = readdirSync(new URL("../../supabase/migrations/", import.meta.url))
    .filter((f) => f.endsWith(".sql"))
    .sort();
  assert.equal(
    migrations[migrations.length - 1],
    "20260918090000_c4_2_magasins.sql",
    "C4.5 n'ajoute aucune migration",
  );
});

await test("PERIMETRE-C4.5b — C4.4 et C3 restent intacts", () => {
  // C4.5 CONSOMME les observations de C4.4 ; il ne les réécrit pas.
  assert.ok(!/prix-observes/.test(sansCommentaires(BASE)), "la lecture C4.5 est indépendante");
  assert.ok(
    !/etatPrixObserves|trierObservations|lireObservationsPrix/.test(sansCommentaires(PUR)),
    "C4.5 ne rejoue aucune logique de C4.4",
  );
  // Et il ne touche pas au budget de C3.
  assert.ok(!/budget-courses|calculerBudgetListe|indexerPrix/.test(PUR + BASE));
});

console.log("\n✅ C4.5 — conditionnements et quantités achetées : suite verte.");
