/**
 * Harnais — COURSES C4.6 : LE MINIMUM OBSERVÉ D'UNE LISTE DE COURSES.
 *
 * ────────────────────────────────────────────────────────────────────────────
 * CE QUE CE FICHIER PROUVE
 * ────────────────────────────────────────────────────────────────────────────
 * Que l'élection se fait en DEUX étapes nommées et testées — le relevé le plus
 * récent par GTIN, puis le coût total minimal entre GTIN — et jamais par
 * `scenarios[0]` ; que le départage est TOTAL ; qu'une ligne n'est `resolue`
 * que si le minimum est PROUVÉ, pas seulement connu ; qu'un total partiel n'est
 * jamais présenté comme complet ; et que C3 n'est ni lu, ni modifié, ni utilisé
 * comme repli.
 *
 * ⚠️ AUCUN ACCÈS RÉSEAU, AUCUNE BASE, AUCUNE CURATION RÉELLE. Tout est fixture.
 *
 * Lancement : npm run test:budget-observe-c4-6
 */
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { createServer } from "node:http";
import { existsSync, readdirSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import test from "node:test";

import esbuild from "esbuild";

import {
  type EntreeLigne,
  type ResolutionLigne,
  budgetMilliDepuisCents,
  budgetObserve,
  comparerAuBudget,
  elireScenarioMinimal,
  formaterMontantMilli,
  resoudreLigne,
  selectionnerDernierScenarioParGtin,
} from "../../lib/nutrition/budget-observe";
import type { Scenario, ScenarioAchat } from "../../lib/nutrition/conditionnements";

const lire = (chemin: string) => readFileSync(new URL(chemin, import.meta.url), "utf8");
const sceau = (chemin: string) =>
  createHash("sha256").update(lire(chemin)).digest("hex").slice(0, 16);

const PUR = lire("../../lib/nutrition/budget-observe.ts");
const HOOK = lire("../../hooks/useBudgetObserve.ts");
const ROUTE = lire("../../app/api/student/shopping-list/observed-prices/route.ts");
const UI = lire("../../components/student/BlocMinimumObserve.tsx");
const LOT = [PUR, HOOK, ROUTE, UI];
const NOMS = [
  "lib/nutrition/budget-observe.ts",
  "hooks/useBudgetObserve.ts",
  "app/api/student/shopping-list/observed-prices/route.ts",
  "components/student/BlocMinimumObserve.tsx",
];

function sansCommentaires(source: string): string {
  return source.replace(/\/\*[\s\S]*?\*\//g, " ").replace(/(^|[^:])\/\/.*$/gm, "$1 ");
}
function sansProseAffichee(source: string): string {
  return sansCommentaires(source)
    .replace(/>[^<>{}]+</g, "><")
    .replace(/"[^"]*"/g, '""')
    .replace(/'[^']*'/g, "''")
    .replace(/`[^`]*`/g, "``");
}

// ── FIXTURES ────────────────────────────────────────────────────────────────

const A = "3560070976478";
const B = "20087090";
const C = "3596710352104";

function scenario(params: {
  gtin: string;
  priceId: number;
  coutTotalMilli: number;
  surplusMilli?: number;
  observeLe?: string;
  createdLe?: string;
  nombre?: number;
}): ScenarioAchat {
  return {
    calculable: true,
    gtin: params.gtin,
    priceId: params.priceId,
    besoinMilli: 500_000,
    uniteBesoin: "g",
    conditionnementMilli: 500_000,
    uniteConditionnement: "g",
    nombreConditionnements: params.nombre ?? 1,
    quantiteAcheteeMilli: 500_000 + (params.surplusMilli ?? 0),
    surplusMilli: params.surplusMilli ?? 0,
    coutTotalMilli: params.coutTotalMilli,
    devise: "EUR",
    observeLe: params.observeLe ?? "2026-08-01",
    createdLe: params.createdLe ?? "2026-08-02T10:00:00.000000Z",
  };
}

const impossible = (gtin: string, priceId: number, raison: Scenario extends { raison: infer R } ? R : never): Scenario =>
  ({ calculable: false, gtin, priceId, raison }) as Scenario;

function ligne(params: Partial<EntreeLigne> & { ligneId: string }): EntreeLigne {
  return {
    origine: "plan",
    etat: "releves",
    tronque: false,
    ignores: 0,
    raisonIndisponible: null,
    scenarios: [],
    ...params,
  };
}

function resolue(r: ResolutionLigne): Extract<ResolutionLigne, { statut: "resolue" }> {
  assert.equal(r.statut, "resolue", `attendu resolue, reçu ${r.statut}`);
  return r as Extract<ResolutionLigne, { statut: "resolue" }>;
}

// ════════════════════════════════════════════════════════════════════════════
// A. ÉTAPE 1 — LE RELEVÉ LE PLUS RÉCENT, PAR GTIN
// ════════════════════════════════════════════════════════════════════════════

await test("C4.6-01 — un GTIN, une observation → resolue", () => {
  const r = resoudreLigne(
    ligne({ ligneId: "L1", scenarios: [scenario({ gtin: A, priceId: 1, coutTotalMilli: 2190 })] }),
  );
  assert.equal(resolue(r).coutRetenuMilli, 2190);
  assert.equal(resolue(r).scenarioRetenu.gtin, A);
});

await test("C4.6-02 — un GTIN, plusieurs observations → la PLUS RÉCENTE est retenue", () => {
  // ⚠️ ET ELLE N'EST PAS LA MOINS CHÈRE. Prendre le minimum ici rouvrirait
  // l'option « minimum récent » écartée au cadrage C4.4 : un comportement de
  // comparateur, qui répond à « quel est le meilleur prix vu ici » et non à
  // « combien ça coûte ici ».
  const retenus = selectionnerDernierScenarioParGtin([
    scenario({ gtin: A, priceId: 1, coutTotalMilli: 3000, observeLe: "2026-07-01" }),
    scenario({ gtin: A, priceId: 2, coutTotalMilli: 5000, observeLe: "2026-08-10" }),
    scenario({ gtin: A, priceId: 3, coutTotalMilli: 1000, observeLe: "2026-06-01" }),
  ]);
  assert.equal(retenus.length, 1, "un seul candidat par GTIN");
  assert.equal(retenus[0]!.priceId, 2, "le 10/08, pas le moins cher");
});

await test("C4.6-03 — l'élection n'est JAMAIS `scenarios[0]`", () => {
  // Entrée délibérément DÉSORDONNÉE : le premier élément n'est ni le plus
  // récent, ni le moins cher. Une implémentation qui prendrait l'indice 0
  // rendrait priceId 9.
  const desordre = [
    scenario({ gtin: A, priceId: 9, coutTotalMilli: 9999, observeLe: "2026-01-01" }),
    scenario({ gtin: A, priceId: 4, coutTotalMilli: 2190, observeLe: "2026-08-20" }),
  ];
  assert.equal(selectionnerDernierScenarioParGtin(desordre)[0]!.priceId, 4);

  // Et le module ne contient aucun accès direct au premier élément.
  const nu = sansCommentaires(PUR);
  for (const motif of [/scenarios\[0\]/, /candidats\[0\]/, /\.at\(0\)/, /\[0\]!/]) {
    assert.ok(!motif.test(nu), `accès implicite interdit : ${motif}`);
  }
  // Les deux étapes existent, NOMMÉES.
  assert.match(PUR, /export function selectionnerDernierScenarioParGtin/);
  assert.match(PUR, /export function elireScenarioMinimal/);
});

// ════════════════════════════════════════════════════════════════════════════
// B. ÉTAPE 2 — LE COÛT TOTAL MINIMAL, ET SON DÉPARTAGE
// ════════════════════════════════════════════════════════════════════════════

await test("C4.6-04/05 — c'est le COÛT DE COUVERTURE qui gagne, pas le prix paquet", () => {
  // ⚠️ LE CAS QUI JUSTIFIE TOUT LE LOT. A est le paquet le MOINS CHER
  // (1,690 € contre 2,190 €), et il PERD : il en faut deux pour couvrir 500 g.
  const gagnant = elireScenarioMinimal([
    scenario({ gtin: A, priceId: 1, coutTotalMilli: 3380, nombre: 2, surplusMilli: 250_000 }),
    scenario({ gtin: B, priceId: 2, coutTotalMilli: 2190, nombre: 1, surplusMilli: 0 }),
    scenario({ gtin: C, priceId: 3, coutTotalMilli: 3590, nombre: 1, surplusMilli: 500_000 }),
  ]);
  assert.equal(gagnant!.gtin, B);
  assert.equal(gagnant!.coutTotalMilli, 2190);

  // Le comparateur ne doit nommer NI le montant du paquet, NI un prix au kilo.
  const nu = sansCommentaires(PUR);
  assert.ok(!/montantMilli/.test(nu), "le prix paquet ne doit pas entrer dans l'élection");
  assert.ok(!/pricePer|prixKilo|prix_kg/i.test(nu));
});

await test("C4.6-05b — l'étape 1 s'applique DANS `resoudreLigne`, pas seulement à part", () => {
  // ⚠️ CETTE FAILLE A ÉTÉ TROUVÉE PAR LE SABOTAGE S5, ET ELLE ÉTAIT RÉELLE :
  // tous mes cas de `resoudreLigne` n'avaient qu'UNE observation par GTIN, si
  // bien que sauter la réduction ne changeait rien. Ici le MÊME GTIN porte un
  // relevé ANCIEN et BON MARCHÉ et un relevé RÉCENT et CHER : chercher le
  // minimum sans réduire d'abord retiendrait 1,000 € au lieu de 5,000 €.
  const r = resoudreLigne(
    ligne({
      ligneId: "L1",
      scenarios: [
        scenario({ gtin: A, priceId: 1, coutTotalMilli: 1000, observeLe: "2026-01-01" }),
        scenario({ gtin: A, priceId: 2, coutTotalMilli: 5000, observeLe: "2026-08-15" }),
      ],
    }),
  );
  const ok = resolue(r);
  assert.equal(ok.coutRetenuMilli, 5000, "le relevé RÉCENT de ce GTIN, pas le moins cher");
  assert.equal(ok.scenarioRetenu.priceId, 2);
  // Et un seul candidat subsiste pour ce GTIN : la réduction a bien eu lieu.
  assert.equal(ok.alternatives.length, 1);

  // Le même piège, avec DEUX GTIN : B doit gagner sur son relevé récent, et
  // le vieux relevé bradé de A ne doit jamais entrer dans la comparaison.
  const deux = resoudreLigne(
    ligne({
      ligneId: "L2",
      scenarios: [
        scenario({ gtin: A, priceId: 1, coutTotalMilli: 500, observeLe: "2026-01-01" }),
        scenario({ gtin: A, priceId: 2, coutTotalMilli: 9000, observeLe: "2026-08-15" }),
        scenario({ gtin: B, priceId: 3, coutTotalMilli: 2190, observeLe: "2026-08-14" }),
      ],
    }),
  );
  assert.equal(resolue(deux).coutRetenuMilli, 2190, "500 € était périmé : il ne concourt pas");
  assert.equal(resolue(deux).scenarioRetenu.gtin, B);
});

await test("C4.6-06 — égalité de coût → surplus le plus FAIBLE", () => {
  const gagnant = elireScenarioMinimal([
    scenario({ gtin: A, priceId: 1, coutTotalMilli: 2190, surplusMilli: 400_000 }),
    scenario({ gtin: B, priceId: 2, coutTotalMilli: 2190, surplusMilli: 10_000 }),
  ]);
  assert.equal(gagnant!.gtin, B);
});

await test("C4.6-07 — égalité coût + surplus → observeLe le plus RÉCENT", () => {
  const gagnant = elireScenarioMinimal([
    scenario({ gtin: A, priceId: 1, coutTotalMilli: 2190, observeLe: "2026-01-01" }),
    scenario({ gtin: B, priceId: 2, coutTotalMilli: 2190, observeLe: "2026-08-01" }),
  ]);
  assert.equal(gagnant!.gtin, B);
});

await test("C4.6-08 — puis createdLe le plus récent", () => {
  const gagnant = elireScenarioMinimal([
    scenario({ gtin: A, priceId: 1, coutTotalMilli: 2190, createdLe: "2026-08-02T08:00:00.000000Z" }),
    scenario({ gtin: B, priceId: 2, coutTotalMilli: 2190, createdLe: "2026-08-02T09:00:00.000000Z" }),
  ]);
  assert.equal(gagnant!.gtin, B);
  // ⚠️ La comparaison passe par la clé canonisée de C4.4 : une fraction de
  // seconde omise ne doit pas inverser l'ordre.
  const inverse = elireScenarioMinimal([
    scenario({ gtin: A, priceId: 1, coutTotalMilli: 2190, createdLe: "2026-08-02T08:00:00Z" }),
    scenario({ gtin: B, priceId: 2, coutTotalMilli: 2190, createdLe: "2026-08-02T08:00:00.000001Z" }),
  ]);
  assert.equal(inverse!.gtin, B, "08:00:00,000001 est POSTÉRIEUR à 08:00:00,000000");
});

await test("C4.6-09 — puis priceId décroissant", () => {
  const gagnant = elireScenarioMinimal([
    scenario({ gtin: A, priceId: 5, coutTotalMilli: 2190 }),
    scenario({ gtin: B, priceId: 9, coutTotalMilli: 2190 }),
  ]);
  assert.equal(gagnant!.priceId, 9);
});

await test("C4.6-10 — puis GTIN lexical croissant, et l'ordre TOTAL est prouvé", () => {
  const zzz = "9999999999999";
  const aaa = "1111111111111";
  const gagnant = elireScenarioMinimal([
    scenario({ gtin: zzz, priceId: 7, coutTotalMilli: 2190 }),
    scenario({ gtin: aaa, priceId: 7, coutTotalMilli: 2190 }),
  ]);
  assert.equal(gagnant!.gtin, aaa);

  // ⚠️ ORDRE TOTAL : trois permutations d'un même ensemble élisent le MÊME
  // scénario. Sans cela, le gagnant dépendrait de l'ordre d'un `Map` ou du
  // réseau — et le même écran donnerait deux budgets.
  const jeu = [
    scenario({ gtin: A, priceId: 1, coutTotalMilli: 2190, surplusMilli: 0, observeLe: "2026-08-01" }),
    scenario({ gtin: B, priceId: 2, coutTotalMilli: 2190, surplusMilli: 0, observeLe: "2026-08-01" }),
    scenario({ gtin: C, priceId: 3, coutTotalMilli: 2190, surplusMilli: 0, observeLe: "2026-08-01" }),
  ];
  const attendu = elireScenarioMinimal(jeu)!.gtin;
  for (const permutation of [
    [jeu[2]!, jeu[0]!, jeu[1]!],
    [jeu[1]!, jeu[2]!, jeu[0]!],
    [jeu[2]!, jeu[1]!, jeu[0]!],
  ]) {
    assert.equal(elireScenarioMinimal(permutation)!.gtin, attendu, "élection instable");
  }
});

// ════════════════════════════════════════════════════════════════════════════
// C. MINIMUM CONNU ≠ MINIMUM PROUVÉ
// ════════════════════════════════════════════════════════════════════════════

await test("C4.6-11/12 — aucun produit relié · aucun relevé → sans_prix, raison distincte", () => {
  const sansProduit = resoudreLigne(ligne({ ligneId: "L1", etat: "aucun_produit_relie" }));
  assert.equal(sansProduit.statut, "sans_prix");
  assert.equal(sansProduit.statut === "sans_prix" ? sansProduit.raison : null, "aucun_produit_relie");

  const sansReleve = resoudreLigne(ligne({ ligneId: "L1", etat: "aucun_releve" }));
  assert.equal(sansReleve.statut, "sans_prix");
  assert.equal(sansReleve.statut === "sans_prix" ? sansReleve.raison : null, "aucun_releve");
});

await test("C4.6-13/14 — indetermine et indisponible ne se confondent avec rien", () => {
  const indet = resoudreLigne(ligne({ ligneId: "L1", etat: "indetermine" }));
  assert.equal(indet.statut, "indeterminee");
  assert.notEqual(indet.statut, "sans_prix");

  for (const raison of ["rate_limited", "unavailable"] as const) {
    const indispo = resoudreLigne(
      ligne({ ligneId: "L1", etat: "indisponible", raisonIndisponible: raison }),
    );
    assert.equal(indispo.statut, "indisponible");
    assert.equal(indispo.statut === "indisponible" ? indispo.raison : null, raison);
  }
});

await test("C4.6-15 — CAS B : relevés présents mais réponse TRONQUÉE → indeterminee", () => {
  // Un relevé moins cher peut se trouver hors borne : le minimum n'est pas
  // PROUVÉ, seulement CONNU.
  const r = resoudreLigne(
    ligne({
      ligneId: "L1",
      tronque: true,
      scenarios: [scenario({ gtin: A, priceId: 1, coutTotalMilli: 2190 })],
    }),
  );
  assert.equal(r.statut, "indeterminee");
  assert.notEqual(r.statut, "resolue");
  assert.equal(r.statut === "indeterminee" ? r.minimumConnuMilli : null, 2190);
  assert.ok(
    r.statut === "indeterminee" && r.raisons.includes("lecture_tronquee"),
    "la cause du doute est nommée",
  );
});

await test("C4.6-16 — CAS C : relevés présents mais lignes ÉCARTÉES → indeterminee", () => {
  const r = resoudreLigne(
    ligne({
      ligneId: "L1",
      ignores: 2,
      scenarios: [scenario({ gtin: A, priceId: 1, coutTotalMilli: 2190 })],
    }),
  );
  assert.equal(r.statut, "indeterminee");
  assert.equal(r.statut === "indeterminee" ? r.minimumConnuMilli : null, 2190);
  assert.ok(r.statut === "indeterminee" && r.raisons.includes("observations_ecartees"));
});

await test("C4.6-17 — CAS D : un GTIN calculable + un GTIN NON calculable → indeterminee", () => {
  // ⚠️ LE CAS LE PLUS SUBTIL. Nous savons que A coûte 2,190 €. Nous ne savons
  // PAS si C, dont le conditionnement manque, aurait coûté moins. Le minimum
  // n'est donc pas prouvé — et le déclarer `resolue` serait affirmer un
  // classement sur une donnée absente.
  const r = resoudreLigne(
    ligne({
      ligneId: "L1",
      scenarios: [
        scenario({ gtin: A, priceId: 1, coutTotalMilli: 2190 }),
        scenario({ gtin: B, priceId: 2, coutTotalMilli: 3380 }),
        impossible(C, 3, "conditionnement_absent" as never),
      ],
    }),
  );
  assert.equal(r.statut, "indeterminee");
  assert.notEqual(r.statut, "resolue");
  assert.equal(r.statut === "indeterminee" ? r.minimumConnuMilli : null, 2190);
  assert.ok(
    r.statut === "indeterminee" && r.raisons.includes("candidat_non_calculable"),
    "la référence non calculable est NOMMÉE, jamais ignorée",
  );
  // Le scénario du minimum connu reste identifiable.
  assert.equal(r.statut === "indeterminee" ? r.scenarioMinimumConnu?.gtin : null, A);
});

await test("C4.6-18 — CAS E : des prix, mais AUCUN scénario calculable → non_calculable", () => {
  const r = resoudreLigne(
    ligne({
      ligneId: "L1",
      scenarios: [
        impossible(A, 1, "conditionnement_absent" as never),
        impossible(B, 2, "unite_incompatible" as never),
      ],
    }),
  );
  assert.equal(r.statut, "non_calculable");
  assert.notEqual(r.statut, "sans_prix", "des prix EXISTENT : ce n'est pas une absence");
  assert.deepEqual(
    r.statut === "non_calculable" ? [...r.raisons].sort() : [],
    ["conditionnement_absent", "unite_incompatible"],
  );
});

await test("C4.6-19 — `piece` reste non calculable, jamais transformé en paquet", () => {
  const r = resoudreLigne(
    ligne({
      ligneId: "L1",
      scenarios: [impossible(A, 1, "conditionnement_unitaire_absent" as never)],
    }),
  );
  assert.equal(r.statut, "non_calculable");
  assert.ok(
    r.statut === "non_calculable" && r.raisons.includes("conditionnement_unitaire_absent"),
  );
  // Aucune conversion unitaire nulle part dans le lot.
  for (const [i, source] of LOT.entries()) {
    assert.ok(
      !/piece[\s\S]{0,40}=\s*1\b|poidsMoyen|nombreUnites/i.test(sansProseAffichee(source)),
      `${NOMS[i]} ne doit inventer aucune unité`,
    );
  }
});

await test("C4.6-CAS-A — lecture COMPLÈTE et tous les candidats calculables → resolue", () => {
  const r = resoudreLigne(
    ligne({
      ligneId: "L1",
      tronque: false,
      ignores: 0,
      scenarios: [
        scenario({ gtin: A, priceId: 1, coutTotalMilli: 3380, surplusMilli: 250_000, nombre: 2 }),
        scenario({ gtin: B, priceId: 2, coutTotalMilli: 2190 }),
        scenario({ gtin: C, priceId: 3, coutTotalMilli: 3590, surplusMilli: 500_000 }),
      ],
    }),
  );
  const ok = resolue(r);
  assert.equal(ok.coutRetenuMilli, 2190);
  assert.equal(ok.scenarioRetenu.gtin, B);
});

// ════════════════════════════════════════════════════════════════════════════
// D. CE QUE LA RÉSOLUTION CONSERVE
// ════════════════════════════════════════════════════════════════════════════

await test("C4.6-32/33/34/35/36 — gtin, priceId, dates et ALTERNATIVES sont conservés", () => {
  const r = resoudreLigne(
    ligne({
      ligneId: "L1",
      scenarios: [
        scenario({
          gtin: A,
          priceId: 11,
          coutTotalMilli: 3380,
          observeLe: "2026-03-14",
          createdLe: "2026-03-15T08:09:10.000001Z",
        }),
        scenario({ gtin: B, priceId: 22, coutTotalMilli: 2190, observeLe: "2026-02-02" }),
      ],
    }),
  );
  const ok = resolue(r);
  assert.equal(ok.scenarioRetenu.gtin, B);
  assert.equal(ok.scenarioRetenu.priceId, 22);
  assert.equal(ok.scenarioRetenu.observeLe, "2026-02-02");

  // ⚠️ LES ALTERNATIVES SURVIVENT. L'écran doit pouvoir expliquer POURQUOI B,
  // et C4.7 comparera sans relancer la lecture.
  assert.equal(ok.alternatives.length, 2, "le gagnant ET les autres candidats");
  const a = ok.alternatives.find((s) => s.gtin === A);
  assert.ok(a && a.calculable);
  assert.equal(a!.calculable ? a!.observeLe : null, "2026-03-14");
  assert.equal(a!.calculable ? a!.createdLe : null, "2026-03-15T08:09:10.000001Z");
  assert.equal(a!.priceId, 11);
});

// ════════════════════════════════════════════════════════════════════════════
// E. LE BUDGET DE LA LISTE
// ════════════════════════════════════════════════════════════════════════════

const L_RESOLUE = (id: string, cout: number) =>
  ligne({ ligneId: id, scenarios: [scenario({ gtin: A, priceId: 1, coutTotalMilli: cout })] });

await test("C4.6-20 — toutes les lignes résolues → COMPLET", () => {
  const b = budgetObserve([L_RESOLUE("L1", 2190), L_RESOLUE("L2", 2400), L_RESOLUE("L3", 1000)]);
  assert.equal(b.statut, "complet");
  assert.equal(b.totalConnuMilli, 5590);
  assert.equal(b.lignesResolues, 3);
  assert.equal(b.lignesTotal, 3);
  assert.equal(b.lignesNonResolues, 0);
});

await test("C4.6-21/23/24 — 2/3 résolues → PARTIEL, et le minimum connu N'ENTRE PAS au total", () => {
  // ⚠️ L'EXEMPLE DU CADRAGE. L3 n'est pas calculable ; L2 porte un minimum
  // CONNU de 9 999 qui ne doit surtout pas gonfler le total.
  const b = budgetObserve([
    L_RESOLUE("L1", 2190),
    ligne({
      ligneId: "L2",
      tronque: true,
      scenarios: [scenario({ gtin: A, priceId: 1, coutTotalMilli: 9999 })],
    }),
    ligne({ ligneId: "L3", scenarios: [impossible(C, 3, "conditionnement_unitaire_absent" as never)] }),
  ]);
  assert.equal(b.statut, "partiel");
  assert.equal(b.totalConnuMilli, 2190, "9 999 est CONNU, pas PROUVÉ : hors total");
  assert.equal(b.lignesResolues, 1);
  assert.equal(b.lignesNonResolues, 2);
  // Les raisons des lignes non résolues sont conservées, jamais perdues.
  assert.ok(b.raisonsNonResolues.length >= 2, "chaque ligne non résolue dit pourquoi");
});

await test("C4.6-22 — 0 ligne résolue sur une liste NON VIDE → INDETERMINE", () => {
  const b = budgetObserve([
    ligne({ ligneId: "L1", etat: "aucun_releve" }),
    ligne({ ligneId: "L2", etat: "indisponible", raisonIndisponible: "unavailable" }),
  ]);
  assert.equal(b.statut, "indetermine");
  assert.equal(b.totalConnuMilli, 0);
  assert.equal(b.lignesResolues, 0);
  // ⚠️ ZÉRO EST UNE VALEUR D'ARITHMÉTIQUE, PAS UN MONTANT À AFFICHER.
  assert.equal(b.lignesTotal, 2);
});

await test("C4.6-EMPTY — liste vide : le comportement de C3 est préservé", () => {
  // C3 sur liste vide : `partielle = false`, `articlesEstimes = 0`, et l'écran
  // affiche « — » parce qu'il teste `articlesEstimes === 0` AVANT le montant.
  // On reproduit exactement : pas de « partiel » fantôme, et c'est l'UI qui
  // garde le zéro hors de l'écran.
  const b = budgetObserve([]);
  assert.equal(b.lignesTotal, 0);
  assert.equal(b.lignesResolues, 0);
  assert.equal(b.totalConnuMilli, 0);
  assert.notEqual(b.statut, "partiel", "une liste vide n'est pas une couverture partielle");
});

await test("C4.6-25 — total hors entier sûr → refus explicite, jamais saturation", () => {
  const enorme = Math.floor(Number.MAX_SAFE_INTEGER / 2) + 10;
  const b = budgetObserve([L_RESOLUE("L1", enorme), L_RESOLUE("L2", enorme), L_RESOLUE("L3", enorme)]);
  assert.equal(b.debordement, true);
  assert.equal(b.statut, "indetermine", "un total inexact n'est pas un total");
  const nu = sansCommentaires(PUR);
  for (const motif of [/Math\.min\(/, /clamp/i, /BigInt/]) {
    assert.ok(!motif.test(nu), `aucune saturation : ${motif}`);
  }

  // ⚠️ FAILLE TROUVÉE PAR LE SABOTAGE S15, ET ELLE ÉTAIT RÉELLE. Le cas
  // ci-dessus déborde AVANT la dernière addition, si bien que le contrôle du
  // total ACCUMULÉ suffisait à lever le drapeau — et retirer le contrôle de la
  // SOMME passait inaperçu. Ici le total reste sûr jusqu'au bout, et c'est
  // l'addition finale qui franchit la borne : seul le second garde peut le voir.
  const juste = budgetObserve([
    L_RESOLUE("L1", Number.MAX_SAFE_INTEGER - 5),
    L_RESOLUE("L2", 100),
  ]);
  assert.equal(juste.debordement, true, "le débordement de la DERNIÈRE addition doit être vu");
  assert.equal(juste.statut, "indetermine");
  assert.ok(
    Number.isSafeInteger(juste.totalConnuMilli),
    "le total rendu reste un entier exact, jamais une valeur saturée",
  );
});

// ════════════════════════════════════════════════════════════════════════════
// E bis. LES ARTICLES MANUELS
// ════════════════════════════════════════════════════════════════════════════

const L_MANUELLE = (id: string) => ligne({ ligneId: id, origine: "manuel" });

await test("C4.6-M1 — 2 lignes plan résolues + 1 manuelle → partiel, 2/3", () => {
  // ⚠️ LE CAS QUI FERME LE LOT. Le dénominateur est celui de l'ÉCRAN : trois
  // articles sont visibles, trois articles sont comptés.
  const b = budgetObserve([L_RESOLUE("L1", 2190), L_RESOLUE("L2", 2400), L_MANUELLE("L3")]);
  assert.equal(b.statut, "partiel");
  assert.notEqual(b.statut, "complet", "une liste dont un article n'est pas chiffré n'est pas complète");
  assert.equal(b.lignesTotal, 3, "l'article manuel ne disparaît pas du dénominateur");
  assert.equal(b.lignesResolues, 2);
  assert.equal(b.lignesNonResolues, 1);
  assert.equal(b.totalConnuMilli, 4590, "la somme des DEUX lignes résolues, et d'elles seules");
});

await test("C4.6-M2 — liste UNIQUEMENT manuelle → indetermine, jamais « vide », jamais 0 €", () => {
  const b = budgetObserve([L_MANUELLE("L1"), L_MANUELLE("L2")]);
  assert.equal(b.statut, "indetermine");
  assert.notEqual(b.statut, "complet");
  assert.equal(b.lignesTotal, 2, "deux articles existent : la liste n'est PAS vide");
  assert.equal(b.lignesResolues, 0);
  // `totalConnuMilli` vaut 0 pour l'arithmétique — c'est l'ÉCRAN qui garde ce
  // zéro hors de la vue, et son garde-fou est éprouvé plus bas (C4.6-43/44/45).
  assert.equal(b.totalConnuMilli, 0);
});

await test("C4.6-M3 — le prix C3 d'un article manuel N'ENTRE PAS dans le minimum observé", () => {
  // ⚠️ UN ARTICLE MANUEL PEUT PORTER `estimated_price_cents` — « papier
  // toilette : 4,00 € ». C3 l'affiche, et c'est légitime : ce n'est pas un
  // prix alimentaire saisi à la main, c'est un forfait sur un article sans
  // identité. Mais ce n'est PAS un prix observé, et il ne doit pas gonfler un
  // nombre présenté comme le minimum relevé en magasin.
  const b = budgetObserve([L_RESOLUE("L1", 2190), L_MANUELLE("L2")]);
  assert.equal(b.totalConnuMilli, 2190, "aucun forfait C3 ne s'ajoute");

  // La preuve structurelle : la route ne LIT même pas la colonne.
  //
  // ⚠️ COMMENTAIRES RETIRÉS AVANT DE BALAYER — la route EXPLIQUE en toutes
  // lettres qu'elle ne sélectionne pas `estimated_price_cents`, et un balayage
  // naïf accuserait la phrase qui interdit la chose. On vérifie donc le
  // `select` lui-même, puis on exige que l'explication reste écrite.
  assert.ok(
    !/estimated_price_cents/.test(sansCommentaires(ROUTE)),
    "la route ne doit pas sélectionner le prix forfaitaire C3",
  );
  const select = /\.select\("([^"]*)"\)[\s\S]{0,120}shopping_list_items|from\("shopping_list_items"\)[\s\S]{0,200}?\.select\("([^"]*)"\)/.exec(
    sansCommentaires(ROUTE),
  );
  assert.ok(select, "le select des lignes doit rester lisible");
  assert.ok(
    !/estimated_price_cents/.test(select![0]),
    "la colonne de prix forfaitaire n'est pas demandée",
  );
  assert.match(ROUTE, /estimated_price_cents/, "et la route DIT pourquoi elle ne la lit pas");
  assert.ok(
    !/estimated_price_cents|prixManuel|definirPrixArticleManuel/.test(sansCommentaires(PUR)),
    "le calcul observé ignore totalement le modèle de prix manuel",
  );
});

await test("C4.6-M4 — la raison est EXPLICITE, et distincte des deux autres absences", () => {
  const r = resoudreLigne(L_MANUELLE("L1"));
  assert.equal(r.statut, "sans_prix");
  const raison = r.statut === "sans_prix" ? r.raison : null;
  assert.equal(raison, "article_manuel");
  // ⚠️ NI L'UNE NI L'AUTRE : le diagnostic doit rester vrai.
  assert.notEqual(raison, "aucun_produit_relie", "des éponges n'attendent pas d'être curées");
  assert.notEqual(raison, "aucun_releve", "on n'a jamais interrogé ce magasin pour cet article");
  assert.notEqual(r.statut, "indisponible", "rien n'est en panne");
  assert.notEqual(r.statut, "non_calculable", "il n'y a pas de prix à ne pas savoir calculer");

  // Et la raison remonte dans le budget, jamais avalée.
  const b = budgetObserve([L_RESOLUE("L1", 2190), L_MANUELLE("L2")]);
  const motif = b.raisonsNonResolues.find((x) => x.ligneId === "L2");
  assert.ok(motif, "la ligne manuelle apparaît dans les raisons");
  assert.deepEqual(motif!.details, ["article_manuel"]);
});

await test("C4.6-M5 — une ligne manuelle ne dépend NI du magasin, NI de la lecture", () => {
  // Aucun magasin, lecture tronquée, observations écartées : rien de tout cela
  // ne change le sort d'un article sans identité — et surtout, aucun de ces
  // diagnostics ne doit lui être emprunté.
  for (const variante of [
    { etat: "aucun_magasin" as const },
    { etat: "indisponible" as const, raisonIndisponible: "unavailable" as const },
    { tronque: true },
    { ignores: 5 },
  ]) {
    const r = resoudreLigne({ ...L_MANUELLE("L1"), ...variante });
    assert.equal(r.statut, "sans_prix", JSON.stringify(variante));
    assert.equal(r.statut === "sans_prix" ? r.raison : null, "article_manuel");
  }
});

await test("C4.6-M6 — le périmètre de la route est celui de l'ÉCRAN, pas celui des identités", () => {
  // La route ne doit PAS filtrer sur `source === "plan"` avant de compter.
  assert.ok(
    !/filter\(\(l\) => l\.source === "plan"\)[\s\S]{0,200}entrees/.test(sansCommentaires(ROUTE)),
    "les lignes manuelles ne doivent pas être écartées avant le budget",
  );
  assert.match(sansCommentaires(ROUTE), /visibles\.map/, "le budget parcourt les lignes VISIBLES");
  assert.match(sansCommentaires(ROUTE), /origine: "manuel"/, "une ligne manuelle est marquée comme telle");
  // Et C3 garde son propre périmètre : la route n'y touche pas.
  assert.ok(!/budget-courses|calculerBudgetListe/.test(ROUTE));
});

// ════════════════════════════════════════════════════════════════════════════
// F. ARITHMÉTIQUE ET COMPARAISON AU BUDGET
// ════════════════════════════════════════════════════════════════════════════

await test("C4.6-26/27 — budgetCents × 10, exact, avec garde d'entier sûr", () => {
  assert.equal(budgetMilliDepuisCents(5000), 50_000);
  assert.equal(budgetMilliDepuisCents(0), 0);
  for (const mauvais of [null, -1, 1.5, Number.NaN, Infinity, Number.MAX_SAFE_INTEGER, "500"]) {
    assert.equal(budgetMilliDepuisCents(mauvais as never), null, `${String(mauvais)} refusé`);
  }
  // ⚠️ LA CONVERSION VA DANS CE SENS ET PAS L'AUTRE. `totalMilli / 10` jetterait
  // la troisième décimale d'Open Prices — mais SEULEMENT si cela arrive dans la
  // LOGIQUE MÉTIER. Le formateur, lui, a le droit de diviser : c'est sa
  // fonction, et `formaterMontantMilli` est la frontière déclarée entre le
  // calcul et l'affichage. On coupe donc le module à cette frontière plutôt
  // que d'interdire un chiffre dans tout le fichier — un balayage qui
  // accuserait le formateur serait un balayage qu'on finirait par relâcher.
  const frontiere = PUR.indexOf("// 7. L'AFFICHAGE D'UN MONTANT EN MILLIÈMES");
  assert.ok(frontiere > 0, "la frontière calcul / affichage doit rester repérable");
  const metier = sansCommentaires(PUR.slice(0, frontiere));
  assert.ok(!/\/\s*10\b/.test(metier), "aucune division par 10 dans le calcul");
  assert.ok(!/\/\s*100\b/.test(metier), "aucune conversion en centimes dans le calcul");
  assert.ok(!/Math\.round\(/.test(metier), "aucun arrondi monétaire dans le calcul");
  // Et la multiplication attendue est bien là, en toutes lettres.
  assert.match(metier, /budgetCents \* 10/, "budget_cents → millièmes, par multiplication");
});

await test("C4.6-CMP — la comparaison au budget n'existe QUE si la couverture est complète", () => {
  const complet = budgetObserve([L_RESOLUE("L1", 2190), L_RESOLUE("L2", 2400)]);
  const c = comparerAuBudget(complet, 5000);
  assert.equal(c.disponible, true);
  assert.equal(c.budgetMilli, 50_000);
  assert.equal(c.margeMilli, 50_000 - 4590);
  assert.equal(c.depassement, false);

  // ⚠️ PARTIEL ⇒ AUCUN ÉCART. C'est le défaut D-4 de C3, qui ne doit pas
  // renaître ici : « il te reste 6,60 € » alors que 5 articles ne sont pas
  // comptés est un mensonge arithmétiquement exact.
  const partiel = budgetObserve([L_RESOLUE("L1", 2190), ligne({ ligneId: "L2", etat: "aucun_releve" })]);
  const p = comparerAuBudget(partiel, 5000);
  assert.equal(p.disponible, false);
  assert.equal(p.raison, "couverture_partielle");
  assert.equal(p.margeMilli, null);

  // Sans budget posé, il n'y a pas d'écart non plus — et ce n'est pas zéro.
  const sansBudget = comparerAuBudget(complet, null);
  assert.equal(sansBudget.disponible, false);
  assert.equal(sansBudget.raison, "budget_absent");
  assert.equal(sansBudget.margeMilli, null);
});

await test("C4.6-FMT — le formatage garde la troisième décimale quand elle existe", () => {
  assert.match(formaterMontantMilli(2190), /^2,19 €$/);
  assert.match(formaterMontantMilli(1690), /^1,69 €$/);
  assert.match(formaterMontantMilli(1691), /^1,691 €$/);
  assert.match(formaterMontantMilli(0), /^0,00 €$/);
  assert.match(formaterMontantMilli(1_234_560), /1 234,56 €$/);
});

// ════════════════════════════════════════════════════════════════════════════
// G. PÉRIMÈTRE
// ════════════════════════════════════════════════════════════════════════════

await test("C4.6-28/29 — AUCUN repli C3, et `food_price_estimates` n'est jamais lu", () => {
  for (const [i, source] of LOT.entries()) {
    const nu = sansCommentaires(source);
    for (const motif of [
      /food_price_estimates/,
      /lirePrixEstimes/,
      /budget-courses/,
      /calculerBudgetListe/,
      /PrixEstime\b/,
      /price_cents/,
      /estimatedPriceCents/,
    ]) {
      assert.ok(!motif.test(nu), `${NOMS[i]} ne doit pas toucher au modèle C3 : ${motif}`);
    }
  }
});

await test("C4.6-30/31 — aucun stock, aucun seuil de fraîcheur inventé", () => {
  for (const [i, source] of LOT.entries()) {
    const nu = sansProseAffichee(source);
    for (const motif of [/stock/i, /disponibilit/i, /\b(30|60|90)\s*jours?\b/i, /cutoff/i, /perime/i]) {
      assert.ok(!motif.test(nu), `${NOMS[i]} ne doit pas porter ${motif}`);
    }
  }
});

await test("C4.6-37/38/39 — C4.4, C4.5 et le budget C3 sont SCELLÉS", () => {
  // ⚠️ CINQ SCEAUX, ET C4.6 N'A AUCUNE RAISON DE LES REMONTER. Le lot consomme
  // ces modules ; il ne les réécrit pas.
  //
  // ⚠️ UN SEUL A ÉTÉ REMONTÉ, ET PAR C4.3c, PAS PAR C4.6. `prix-observes.ts`
  // passe de `270353a621aa645b` à `9d60bec4c140ef75` parce que C4.3c y a ajouté
  // l'état `magasin_sans_couverture_prix` et remplacé le paramètre
  // `opLocationId: number | null` par une `CouvertureMagasin` discriminée. Le
  // sceau a rougi exactement quand il devait rougir ; on le REDÉCLARE, on ne
  // le retire pas.
  //
  // ⚠️ ET LES QUATRE AUTRES N'ONT PAS BOUGÉ D'UN OCTET. C'est ce qui prouve que
  // C4.3c s'est arrêté là où il devait : ni le budget C3, ni les
  // conditionnements C4.5, ni l'adaptateur réseau de C4.4 n'ont été touchés
  // pour faire passer ce lot.
  assert.equal(sceau("../../lib/nutrition/budget-courses.ts"), "becd06ded213d14a", "C3 modifié");
  assert.equal(sceau("../../lib/nutrition/prix-observes.ts"), "9d60bec4c140ef75", "C4.4 modifié hors C4.3c");
  assert.equal(sceau("../../lib/nutrition/conditionnements.ts"), "99b7f5a9cd91c332", "C4.5 modifié");
  assert.equal(sceau("../../lib/open-prices/observations.ts"), "6269628e0e994f9d", "C4.4 adaptateur modifié");
  assert.equal(sceau("../../lib/supabase/conditionnements.ts"), "3ff60b0e286cb940", "C4.5 lecture modifiée");
});

await test("C4.6-40/41 — aucune écriture, aucune migration, aucun nouvel appel OFF", () => {
  for (const [i, source] of LOT.entries()) {
    const nu = sansCommentaires(source);
    for (const motif of [/\.insert\(/, /\.update\(/, /\.upsert\(/, /\.delete\(/, /\.rpc\(/]) {
      assert.ok(!motif.test(nu), `${NOMS[i]} ne doit rien écrire : ${motif}`);
    }
    assert.ok(!/openfoodfacts|recherche-ciqual|chercherProduits/i.test(nu), `${NOMS[i]} : aucun appel OFF`);
  }
  const migrations = readdirSync(new URL("../../supabase/migrations/", import.meta.url))
    .filter((f) => f.endsWith(".sql"))
    .sort();
  // ⚠️ C4.3c A DEPUIS AJOUTÉ UNE MIGRATION, ET CE CONTRÔLE NE SE RELÂCHE PAS
  // POUR AUTANT. Ce qu'il prouve n'a jamais été « le dossier n'a pas bougé » —
  // il bougera à chaque lot — mais « C4.6 n'y a rien déposé ». La dernière
  // migration connue est donc nommée, ET une seconde assertion interdit
  // SÉPARÉMENT toute migration portant le sujet de C4.6 : c'est celle-là qui
  // porte l'intention, et elle ne dépend d'aucun lot futur.
  assert.equal(
    migrations[migrations.length - 1],
    "20260919090000_c4_3c_magasins_osm.sql",
    "la dernière migration connue est celle de C4.3c",
  );
  assert.deepEqual(
    migrations.filter((f) => /_c4_6|budget_observ|observed_budget|minimum_observ/i.test(f)),
    [],
    "C4.6 n'ajoute aucune migration",
  );
});

await test("C4.6-42 — le module de calcul est PUR : ni React, ni base, ni réseau", () => {
  assert.ok(
    !/@\/lib\/supabase|@\/lib\/open-prices|server-only|use client|fetch\(/.test(PUR),
    "budget-observe.ts doit rester une feuille",
  );
});

// ════════════════════════════════════════════════════════════════════════════
// H. L'ÉCRAN
// ════════════════════════════════════════════════════════════════════════════

await test("C4.6-43/44/45 — l'écran dit « minimum observé », jamais un prix garanti", () => {
  // Le vocabulaire imposé : le nombre affiché est une BORNE, pas un budget.
  assert.match(UI, /[Mm]inimum observé/, "le libellé doit porter la notion de minimum observé");
  // ⚠️ ON CHERCHE L'AFFIRMATION, PAS LA PHRASE QUI L'INTERDIT — la leçon
  // payée cinq fois pendant C4.1b. L'écran dit « pas un prix garanti », et
  // c'est exactement ce qu'on veut y lire : un balayage naïf de « prix
  // garanti » ferait rougir le test parce que le libellé est bon.
  //
  // Deux nettoyages, dans cet ordre, et chacun a sa raison :
  //   1. les COMMENTAIRES partent — le grand encadré du fichier énumère
  //      justement « ni un prix garanti, ni un prix d'aujourd'hui » pour dire
  //      ce que le nombre n'est pas ;
  //   2. dans la prose AFFICHÉE qui reste, les tournures NÉGATIVES sont
  //      neutralisées — « pas un prix garanti » est le libellé souhaité.
  // Ce qui subsiste après ces deux passes est une AFFIRMATION, et seule une
  // affirmation peut mentir.
  const affirmations = sansCommentaires(UI)
    .replace(/pas un prix garanti/gi, "«négation»")
    .replace(/prix du jour serait une promesse/gi, "«négation»");
  for (const interdit of [
    /prix garanti/i,
    /prix actuel/i,
    /budget réel/i,
    /en stock/i,
    /disponible en rayon/i,
    /prix du jour(?! serait)/i,
  ]) {
    assert.ok(!interdit.test(affirmations), `libellé interdit : ${interdit}`);
  }
  // Et la négation, elle, doit RESTER : c'est elle qui porte l'honnêteté.
  assert.match(UI, /pas un prix garanti/i, "l'écran doit dire ce que le nombre n'est pas");
  // PARTIEL : la couverture est dite, et l'écart global n'est pas affiché.
  assert.match(UI, /lignesResolues/, "la couverture doit être affichée");
  assert.match(UI, /comparaison\.disponible|disponible/, "l'écart est conditionné");
  // 0 résolu : jamais un montant.
  assert.match(
    UI,
    /lignesResolues === 0/,
    "l'écran doit tester explicitement l'absence de ligne résolue",
  );
  // Et la liste vide passe par le même garde-fou que C3.
  assert.match(UI, /lignesTotal === 0/, "liste vide : « — », comme en C3");
});

await test("C4.6-UI2 — le bloc C4 et le bloc C3 restent deux notions séparées", () => {
  // ⚠️ AUCUNE VALEUR C3 NE PEUT ENTRER DANS LE BLOC C4. Le composant ne connaît
  // ni `BudgetDeLaListe`, ni `formaterMontant` (qui compte en centimes), ni le
  // moindre champ du modèle d'estimation.
  //
  // ⚠️ SUR LE CODE, PAS SUR LES COMMENTAIRES. Le grand encadré du composant
  // CITE la doctrine de C3 (« `aucuneEstimation` y garde déjà le zéro hors de
  // l'écran ») pour expliquer d'où vient son propre garde-fou. Accuser cette
  // phrase reviendrait à punir le fichier d'être documenté.
  const codeUI = sansCommentaires(UI);
  for (const motif of [
    /BudgetDeLaListe/,
    /budget-courses/,
    /formaterMontant\b/,
    /estimeCents|articlesEstimes|articlesSansPrix|budgetCents/,
    /[Ee]stimation/,
  ]) {
    assert.ok(!motif.test(codeUI), `le bloc observé ne doit pas porter ${motif}`);
  }
  // Et la prose AFFICHÉE ne dit jamais « estimation » non plus : ce serait le
  // vocabulaire de C3 sur un nombre qui n'en est pas une.
  const proseAffichee = [...sansCommentaires(UI).matchAll(/>([^<>{}]+)</g)]
    .map((m) => m[1]!)
    .join(" ");
  assert.ok(!/[Ee]stimation/.test(proseAffichee), "le mot « estimation » appartient à C3");
  // Il ne formate QUE des millièmes.
  assert.match(UI, /formaterMontantMilli/);

  // Et l'écran monte bien les DEUX blocs, l'un ne remplaçant pas l'autre.
  const ECRAN = lire("../../components/student/ListeDeCoursesPersistante.tsx");
  assert.match(ECRAN, /<BlocBudget/, "l'estimation C3 reste affichée");
  assert.match(ECRAN, /<BlocMinimumObserve/, "le minimum observé s'ajoute");
  // Le bloc C4 ne dépend pas de `argent.ok` : une panne C3 ne doit pas le
  // masquer, et réciproquement.
  assert.ok(
    !/argent\.ok && \(\s*<BlocMinimumObserve/.test(ECRAN),
    "les deux blocs ont des conditions d'affichage indépendantes",
  );
});


/* ══════════════════════════════════════════════════════════════════════════
   LE CÂBLAGE : CHANGER DE MAGASIN RELIT LES PRIX — DANS UN VRAI NAVIGATEUR
   ══════════════════════════════════════════════════════════════════════════ */

/**
 * L'ATELIER NAVIGATEUR — construit UNE fois, partagé par les deux preuves.
 *
 * ⚠️ CES CAS NE PEUVENT PAS SE PROUVER SUR DU TEXTE SOURCE. `ChoixMagasinProche`
 * appelait déjà `onMagasinChoisi` ; ce qui manquait, c'est que quelqu'un le
 * BRANCHE. Un rappel vide — `onMagasinChoisi={() => {}}` — passerait n'importe
 * quelle vérification d'existence, et l'élève continuerait de lire les relevés
 * de son ancien magasin.
 *
 * On monte donc le VRAI `ListeDeCoursesPersistante`, on CLIQUE, et on compte
 * les lectures de `/observed-prices`. Seules la source de la liste et le client
 * Supabase sont substitués : le câblage testé est celui de production.
 */
async function ouvrirAtelier() {
  const RACINE = join(dirname(fileURLToPath(import.meta.url)), "..", "..");
  const DOSSIER = join(RACINE, "scripts", "tests", "magasin-prix-render");
  const executable = [
    process.env.CHROMIUM_PATH,
    "/opt/pw-browsers/chromium",
    "/usr/bin/chromium",
    "/usr/bin/chromium-browser",
    "/usr/bin/google-chrome",
    "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
    "/Applications/Chromium.app/Contents/MacOS/Chromium",
  ].find((c): c is string => Boolean(c) && existsSync(c as string));
  assert.ok(executable, "aucun navigateur trouvé — pose CHROMIUM_PATH");

  // ⚠️ DEUX SUBSTITUTIONS, ET PAS UNE DE PLUS. La source de la liste et le
  // client Supabase du navigateur : tout le reste du graphe — les trois
  // composants, les trois hooks, et LE CÂBLAGE ENTRE EUX — est le code de
  // production. Substituer davantage reviendrait à tester le harnais.
  const substitutions: esbuild.Plugin = {
    name: "substitutions-harnais",
    setup(build) {
      build.onResolve({ filter: /^@\/hooks\/useListePersistante$/ }, () => ({
        path: join(DOSSIER, "liste-figee.ts"),
      }));
      build.onResolve({ filter: /^@\/lib\/supabase\/browser$/ }, () => ({
        path: join(DOSSIER, "supabase-absent.ts"),
      }));
    },
  };

  const construction = await esbuild.build({
    entryPoints: [join(DOSSIER, "entree.tsx")],
    bundle: true,
    write: false,
    format: "esm",
    platform: "browser",
    target: "es2022",
    jsx: "automatic",
    tsconfig: join(RACINE, "tsconfig.json"),
    plugins: [substitutions],
    define: { "process.env.NODE_ENV": '"development"' },
    banner: { js: "globalThis.process ??= { env: {} };" },
    logLevel: "silent",
  });
  const paquet = construction.outputFiles![0]!.text;

  const PAGE = `<!doctype html><html lang="fr"><head><meta charset="utf-8"><title>prix</title></head>
<body><div id="racine"></div><script type="module" src="/paquet.js"></script></body></html>`;
  const serveur = createServer((requete, reponse) => {
    if ((requete.url ?? "/").startsWith("/paquet.js")) {
      reponse.writeHead(200, { "content-type": "text/javascript; charset=utf-8" }).end(paquet);
      return;
    }
    reponse.writeHead(200, { "content-type": "text/html; charset=utf-8" }).end(PAGE);
  });
  await new Promise<void>((ok) => serveur.listen(0, "127.0.0.1", ok));
  const adresse = serveur.address();
  const origine = `http://127.0.0.1:${typeof adresse === "object" && adresse ? adresse.port : 0}`;

  const { chromium } = await import("playwright-core");
  const navigateur = await chromium.launch({
    executablePath: executable,
    args: ["--no-sandbox", "--disable-dev-shm-usage"],
  });

  /**
   * ⚠️ UN CONTEXTE NEUF PAR CAS. Les deux situations partagent le paquet, mais
   * jamais l'état : chacune repart d'un compteur d'appels vide et d'un DOM
   * neuf, sinon la seconde hériterait des lectures de la première.
   */
  async function ouvrir(chemin: string) {
    const contexte = await navigateur.newContext();
    const page = await contexte.newPage();
    const erreurs: string[] = [];
    page.on("pageerror", (e) => erreurs.push(e.message));
    await page.goto(`${origine}${chemin}`);
    await page.waitForFunction(() => "__harnais" in window);
    const lectures = () =>
      page.evaluate(() =>
        (window as unknown as { __harnais: { lectures: (f: string) => number } }).__harnais.lectures(
          "/observed-prices",
        ),
      );
    return { page, erreurs, lectures, fermer: () => contexte.close() };
  }

  return {
    ouvrir,
    fermer: async () => {
      await navigateur.close();
      await new Promise<void>((ok) => serveur.close(() => ok()));
    },
  };
}

const atelier = await ouvrirAtelier();

await test("C4.6-CABLAGE — après un changement de magasin, la zone des prix est RELUE", async () => {
  const { page, erreurs, lectures, fermer } = await atelier.ouvrir("/");
  try {

    // 1. Une première lecture a lieu à l'ouverture, et l'écran dit qu'il manque
    //    un magasin — l'état `aucun_magasin`, jamais confondu avec « 0,00 € ».
    await page.waitForFunction(() => document.body.innerText.includes("PRIX OBSERVÉS"));
    await page.waitForFunction(
      () =>
        (window as unknown as { __harnais: { lectures: (f: string) => number } }).__harnais.lectures(
          "/observed-prices",
        ) >= 1,
    );
    const avant = await lectures();
    assert.equal(avant, 1, "une lecture à l'ouverture, pas davantage");
    assert.match(await page.innerText("body"), /aucun magasin choisi/);
    assert.match(await page.innerText("body"), /Choisis un magasin/);

    // 2. Le panneau est REPLIÉ : les commandes complètes n'occupent pas l'écran.
    assert.equal(
      await page.getByText("Trouver un magasin près de moi").count(),
      0,
      "les commandes de recherche ne doivent pas être visibles au repos",
    );

    // 3. On ouvre, on cherche par ville — sans passer par la géolocalisation.
    await page.getByRole("button", { name: "Choisir un magasin" }).click();
    await page.getByLabel("Ville").fill("Toulon");
    await page.getByRole("button", { name: "Rechercher" }).click();
    await page.waitForFunction(() => document.body.innerText.includes("Lidl"));

    // ⚠️ ET « LidlLidl » N'EXISTE PLUS. La marque qui répète le nom ne
    // s'affiche pas deux fois — c'est `marqueAAfficher`, à l'écran.
    const texteListe = await page.innerText("body");
    assert.equal(/LidlLidl/.test(texteListe), false, "la marque ne doit pas doubler le nom");
    assert.equal(/NaturaliaNaturalia/.test(texteListe), false);

    // 4. LE GESTE. On choisit un magasin.
    await page.getByRole("button", { name: /Lidl/ }).first().click();
    await page.waitForFunction(
      (n) =>
        (window as unknown as { __harnais: { lectures: (f: string) => number } }).__harnais.lectures(
          "/observed-prices",
        ) > (n as number),
      avant,
      { timeout: 5_000 },
    );

    // ⚠️ LA PREUVE. Une seconde lecture a bien eu lieu APRÈS la sélection.
    const apres = await lectures();
    assert.ok(apres > avant, `la zone des prix doit être relue (${avant} → ${apres})`);

    // 5. Et l'écran a suivi : le panneau s'est refermé, le magasin s'affiche,
    //    les résultats ont disparu, et l'état de couverture a changé.
    const final = await page.innerText("body");
    assert.match(final, /Magasin\s*:\s*Lidl/, "le magasin choisi s'affiche");
    assert.match(final, /Changer/, "et le bouton propose d'en changer");
    assert.equal(/Trouver un magasin près de moi/.test(final), false, "le panneau s'est refermé");
    assert.equal(/Naturalia/.test(final), false, "les résultats de recherche ont été vidés");
    assert.match(
      final,
      /pas encore de prix observés|Minimum observé|—/,
      "l'état de couverture affiché suit la relecture",
    );
    assert.equal(/aucun magasin choisi/.test(final), false);

    assert.deepEqual(erreurs, [], "aucune erreur de page");
  } finally {
    await fermer();
  }
});

await test("C4.6-SANS-LISTE — pas encore de liste : le sélecteur reste, et RIEN n'est lu", async () => {
  // ⚠️ L'ARBITRAGE QUE CE CAS FIGE. Le bloc des prix portait la garde
  // `etat.liste !== null` ; le sélecteur de magasin, monté dedans, disparaissait
  // donc tant qu'aucune liste n'existait — c'est-à-dire au moment précis où
  // l'élève prépare ses courses et veut désigner son magasin.
  const { page, erreurs, lectures, fermer } = await atelier.ouvrir("/?sansListe");
  try {
    await page.waitForFunction(() => document.body.innerText.includes("PRIX OBSERVÉS"));

    // 1. LE SÉLECTEUR EST LÀ, sans liste.
    const depart = await page.innerText("body");
    assert.match(depart, /Aucune liste pour cette période/, "on est bien sans liste");
    assert.match(depart, /Magasin\s*:\s*aucun magasin choisi/, "le sélecteur reste visible");
    assert.equal(await page.getByRole("button", { name: "Choisir un magasin" }).count(), 1);

    // ⚠️ ET LE BLOC NE PRÉTEND RIEN SUR LES PRIX. Pas « choisis un magasin »
    // (il peut le faire, mais ce n'est pas ce qui manque), pas « 0,00 € », pas
    // « indisponible » : il n'y a simplement rien à chiffrer.
    assert.match(depart, /Génère ta liste pour voir les prix observés\./);
    assert.equal(/Minimum observé/.test(depart), false);
    assert.equal(/Choisis un magasin pour voir le minimum/.test(depart), false);

    // 2. AUCUNE LECTURE DES RELEVÉS. C'est la moitié silencieuse de
    // l'arbitrage : afficher le sélecteur ne doit pas faire parler l'amont.
    assert.equal(await lectures(), 0, "aucune requête /observed-prices sans liste");

    // 3. LE PANNEAU S'OUVRE, avec ses deux chemins.
    await page.getByRole("button", { name: "Choisir un magasin" }).click();
    assert.equal(await page.getByRole("button", { name: "Trouver un magasin près de moi" }).count(), 1);
    assert.equal(await page.getByLabel("Ville").count(), 1, "la saisie manuelle reste offerte");

    // 4. ET LE MAGASIN EST RÉELLEMENT SÉLECTIONNABLE.
    await page.getByLabel("Ville").fill("Toulon");
    await page.getByRole("button", { name: "Rechercher" }).click();
    await page.waitForFunction(() => document.body.innerText.includes("Lidl"));
    await page.getByRole("button", { name: /Lidl/ }).first().click();
    await page.waitForFunction(() => /Magasin\s*:\s*Lidl/.test(document.body.innerText));

    const apres = await page.innerText("body");
    assert.match(apres, /Magasin\s*:\s*Lidl/, "le choix est enregistré et affiché");
    assert.match(apres, /Changer/, "et l'élève peut en changer");
    assert.match(apres, /Génère ta liste pour voir les prix observés\./, "le message tient");

    // ⚠️ 5. ET TOUJOURS AUCUNE LECTURE. `observe.recharger` est bien branché —
    // il l'est aussi ici — mais sans identifiant de liste il n'y a rien à
    // lire, et le hook ne part pas sur le réseau pour rien.
    assert.equal(await lectures(), 0, "changer de magasin sans liste ne lit rien non plus");

    assert.deepEqual(erreurs, [], "aucune erreur de page");
  } finally {
    await fermer();
  }
});

await atelier.fermer();

console.log("\n✅ C4.6 — minimum observé : suite verte.");
