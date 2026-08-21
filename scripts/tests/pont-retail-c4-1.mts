/**
 * Harnais — COURSES C4.1 : LE PONT ALIMENT CIQUAL → PRODUIT OFF RÉEL.
 *
 * ────────────────────────────────────────────────────────────────────────────
 * CE QUE CE FICHIER PROUVE
 * ────────────────────────────────────────────────────────────────────────────
 * Qu'un rapprochement se lit sur `food_id` et jamais sur `match_status` ; que
 * la recherche passe par le code Ciqual structuré et qu'aucun repli par nom
 * n'existe ; qu'un candidat réel mais non importable est montré plutôt que
 * masqué ou fabriqué ; que l'écriture reste réservée au serveur ; que les lots
 * Open Prices ne peuvent pas déclencher le piège des 98 caractères ; et
 * qu'aucun prix alimentaire ne se saisit plus.
 *
 * ⚠️ AUCUN ACCÈS RÉSEAU, AUCUNE BASE. Le transport est injecté, les réponses
 * sont des fixtures. La migration est éprouvée séparément par
 * `supabase/tests/courses_c4_1_pont_checklist.sql`.
 *
 * Lancement : npm run test:pont-retail-c4-1
 *             (NODE_OPTIONS="--conditions=react-server", comme les suites A3 :
 *              les modules réseau sont marqués `server-only`.)
 */
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

import {
  OPEN_PRICES_LOT_MAX_CARACTERES,
  OPEN_PRICES_LOT_MAX_CODES,
  STATUTS_REVUE,
  codeCiqualEstValide,
  decouperLotsCodesBarres,
  estRapproche,
  estStatutRevue,
  etatRapprochement,
  verifierReponseOpenPrices,
  type ProduitRapproche,
} from "../../lib/nutrition/pont-retail";
import {
  CIQUAL_PAYS,
  CIQUAL_TAG_PREFIX,
  OFF_CIQUAL_SEARCH_URL,
  candidatsDepuisReponse,
  urlRechercheParCodeCiqual,
} from "../../lib/open-food-facts/recherche-ciqual";
import { agregerApercus } from "../../lib/open-prices/apercu";
import { calculerBudgetListe, indexerPrix, type PrixEstime } from "../../lib/nutrition/budget-courses";
import type { LigneAffichee } from "../../lib/nutrition/liste-persistante";
import { verifierContratDesMigrations } from "./contrat-migrations.mjs";

const lire = (chemin: string) => readFileSync(new URL(chemin, import.meta.url), "utf8");

const MIGRATION_C4_1 = lire("../../supabase/migrations/20260917090000_c4_1_pont_retail.sql");
const MIGRATION_PRODUITS = lire("../../supabase/migrations/20260903090000_food_products.sql");
const MODULE_PUR = lire("../../lib/nutrition/pont-retail.ts");
const ADAPTATEUR = lire("../../lib/open-food-facts/recherche-ciqual.ts");
const APERCU = lire("../../lib/open-prices/apercu.ts");
const BASE = lire("../../lib/supabase/pont-retail.ts");
const ROUTE_CANDIDATS = lire("../../app/api/admin/food-bridge/candidates/route.ts");
const ROUTE_MATCH = lire("../../app/api/admin/food-bridge/match/route.ts");
const ROUTE_REVIEW = lire("../../app/api/admin/food-bridge/review/route.ts");
const SCHEMAS = lire("../../lib/api/schemas/food-bridge.ts");
const PAGE_PONT = lire("../../app/admin/nutrition/pont/page.tsx");
const PAGE_PRIX = lire("../../app/admin/nutrition/prix/page.tsx");
const UI = lire("../../components/admin/PontRetailAdmin.tsx");

const LOT_C4_1 = [MODULE_PUR, ADAPTATEUR, APERCU, BASE, ROUTE_CANDIDATS, ROUTE_MATCH, ROUTE_REVIEW, SCHEMAS, UI, PAGE_PONT];

/**
 * ⚠️ ON CHERCHE DU CODE, PAS DE LA PROSE. Ces fichiers EXPLIQUENT en commentaire
 * pourquoi il n'y a ni facteur cru/cuit ni saisie de prix — les mots
 * « yield_ratio », « prix » et « cuit » y figurent donc en toutes lettres.
 * Les compter ferait rougir un test parce que la documentation est bonne.
 */
function sansCommentaires(source: string): string {
  return source
    .replace(/\/\*[\s\S]*?\*\//g, " ")
    .replace(/(^|[^:])\/\/.*$/gm, "$1 ");
}
/** Retire aussi les textes affichés d'un JSX (`>…<`) et les littéraux. */
function sansProseAffichee(source: string): string {
  return sansCommentaires(source)
    .replace(/>[^<>{}]+</g, "><")
    .replace(/"[^"]*"/g, '""')
    .replace(/'[^']*'/g, "''")
    .replace(/`[^`]*`/g, "``");
}
/** Retire les commentaires SQL `--` et les littéraux entre apostrophes. */
function sqlNu(source: string): string {
  return source.replace(/--.*$/gm, " ").replace(/'[^']*'/g, "''");
}

// ════════════════════════════════════════════════════════════════════════════
// A. LA STRUCTURE : 1 ALIMENT → N PRODUITS
// ════════════════════════════════════════════════════════════════════════════

await test("C4.1-01 — 1 food_catalog → N food_products, sans structure nouvelle", () => {
  // `food_id` est porté par `food_products` : N lignes peuvent le partager.
  assert.match(
    MIGRATION_PRODUITS,
    /food_id uuid references public\.food_catalog \(id\) on delete set null/i,
    "la colonne de rapprochement doit rester celle de septembre",
  );
  // AUCUNE unicité ne restreint `food_id` : c'est ce qui autorise le N.
  assert.ok(
    !/unique[\s\S]{0,120}\(\s*food_id\s*\)/i.test(sqlNu(MIGRATION_PRODUITS)),
    "aucun index unique ne doit porter sur food_id, sinon un aliment n'aurait qu'un produit",
  );
  // Et C4.1 n'a créé AUCUNE table de liaison produit ↔ aliment.
  const tablesCreees = [...MIGRATION_C4_1.matchAll(/create table if not exists public\.(\w+)/gi)].map(
    (m) => m[1],
  );
  assert.deepEqual(
    tablesCreees,
    ["food_catalog_retail_review"],
    "C4.1 ne doit créer QUE la table de revue",
  );

  // Preuve fonctionnelle : trois produits, un seul aliment.
  const produits: ProduitRapproche[] = [
    { gtin: "3038359007224", foodId: "aliment-1", matchStatus: "manual" },
    { gtin: "3038359007217", foodId: "aliment-1", matchStatus: "manual" },
    { gtin: "3564700024164", foodId: "aliment-1", matchStatus: "manual" },
  ];
  assert.equal(etatRapprochement("aliment-1", produits, null), "matched");
  assert.equal(produits.filter(estRapproche).length, 3);
});

// ════════════════════════════════════════════════════════════════════════════
// B. LA CONDITION CANONIQUE DU MATCH
// ════════════════════════════════════════════════════════════════════════════

await test("C4.1-02 — food_id null + match_status 'manual' n'est PAS un match", () => {
  // ⚠️ L'ÉTAT EST LÉGAL EN BASE : `food_products_match_coherent` n'est écrite que
  // dans un sens, pour que `on delete set null` puisse vider `food_id`.
  const orphelin: ProduitRapproche = { gtin: "3017620422003", foodId: null, matchStatus: "manual" };
  assert.equal(estRapproche(orphelin), false);
  assert.equal(etatRapprochement("aliment-1", [orphelin], null), "unreviewed");

  // Et la chaîne vide n'est pas davantage un identifiant.
  assert.equal(estRapproche({ gtin: "x", foodId: "", matchStatus: "manual" }), false);

  // Le code de lecture ne doit jamais filtrer sur `match_status`.
  assert.ok(
    !/eq\(\s*["']match_status["']/.test(sansCommentaires(BASE)),
    "aucune lecture ne doit se fonder sur match_status",
  );
  assert.match(
    sansCommentaires(BASE),
    /eq\(\s*["']food_id["']/,
    "la lecture des produits rapprochés doit filtrer sur food_id",
  );
});

await test("C4.1-03 — food_id non nul EST un match, quel que soit match_status", () => {
  assert.equal(estRapproche({ gtin: "a", foodId: "aliment-1", matchStatus: "manual" }), true);
  assert.equal(estRapproche({ gtin: "b", foodId: "aliment-1", matchStatus: "auto" }), true);
  // Même un `unmatched` incohérent (impossible en base, mais lu défensivement)
  // ne doit pas faire disparaître un lien réel.
  assert.equal(estRapproche({ gtin: "c", foodId: "aliment-1", matchStatus: "unmatched" }), true);
});

// ════════════════════════════════════════════════════════════════════════════
// C. LA TABLE DE REVUE
// ════════════════════════════════════════════════════════════════════════════

await test("C4.1-04 — un aliment sans produit peut porter une revue", () => {
  assert.equal(
    etatRapprochement("aliment-2", [], { catalogFoodId: "aliment-2", status: "unsupported" }),
    "unsupported",
  );
  assert.equal(
    etatRapprochement("aliment-2", [], { catalogFoodId: "aliment-2", status: "needs_raw_redirect" }),
    "needs_raw_redirect",
  );
  assert.equal(etatRapprochement("aliment-2", [], null), "unreviewed");
  // La clé primaire est l'aliment : une décision courante, pas un journal.
  assert.match(
    MIGRATION_C4_1,
    /catalog_food_id uuid primary key\s*\n?\s*references public\.food_catalog \(id\) on delete cascade/i,
  );
});

await test("C4.1-05 — « matched » n'existe NULLE PART dans la revue", () => {
  // 1. Le CHECK de la base l'interdit.
  const check = /check \(status in \(([^)]*)\)\)/i.exec(MIGRATION_C4_1);
  assert.ok(check, "le CHECK sur status doit exister");
  assert.ok(!/matched/i.test(check![1]), `« matched » ne doit pas être une valeur : ${check![1]}`);
  // 2. Le type TypeScript l'interdit.
  assert.deepEqual([...STATUTS_REVUE], ["unsupported", "needs_raw_redirect", "needs_review"]);
  assert.equal(estStatutRevue("matched"), false);
  // 3. Le schéma de la route l'interdit — il dérive du même tableau.
  assert.match(sansCommentaires(SCHEMAS), /z\.enum\(STATUTS_REVUE\)/);
  // 4. Et la priorité rend un `matched` stocké inutile de toute façon : un
  //    produit lié écrase une revue périmée.
  assert.equal(
    etatRapprochement(
      "aliment-3",
      [{ gtin: "g", foodId: "aliment-3", matchStatus: "manual" }],
      { catalogFoodId: "aliment-3", status: "needs_review" },
    ),
    "matched",
    "un fait constaté doit primer sur une note d'intention",
  );
});

// ════════════════════════════════════════════════════════════════════════════
// D. LES CANDIDATS
// ════════════════════════════════════════════════════════════════════════════

const NUTRIMENTS_OK = { proteins_100g: 7.3, carbohydrates_100g: 78, fat_100g: 0.6 };

function fixtureOff(produits: readonly Record<string, unknown>[], count?: number) {
  return { count: count ?? produits.length, page: 1, page_size: 25, products: produits };
}

await test("C4.1-06 — un candidat sans code-barres valide est refusé", () => {
  const resultat = candidatsDepuisReponse(
    "9119",
    fixtureOff([
      { code: "", product_name: "Sans code", nutriments: NUTRIMENTS_OK },
      { product_name: "Code absent", nutriments: NUTRIMENTS_OK },
      { code: "12345", product_name: "Code trop court", nutriments: NUTRIMENTS_OK },
      { code: "3038359007224", product_name: "Riz basmati du Penjab", nutriments: NUTRIMENTS_OK },
    ]),
  );
  assert.equal(resultat.importables.length, 1);
  assert.equal(resultat.importables[0]!.gtin, "3038359007224");
  assert.equal(resultat.nonImportables.length, 3);
  assert.deepEqual(
    resultat.nonImportables.map((n) => n.refus).sort(),
    ["gtin_absent", "gtin_absent", "gtin_invalide"],
  );

  // Et le schéma de la route refuse aussi un GTIN hors forme, avant tout appel.
  assert.match(sansCommentaires(SCHEMAS), /\^\(\[0-9\]\{8\}\|\[0-9\]\{12,14\}\)\$/);
});

await test("C4.1-07 — la recherche OFF passe par ciqual-food-code-<N>", () => {
  const url = urlRechercheParCodeCiqual("9119");
  assert.ok(url.startsWith(OFF_CIQUAL_SEARCH_URL), `URL inattendue : ${url}`);
  assert.match(url, /categories_properties_tags=ciqual-food-code-9119/);
  assert.equal(CIQUAL_TAG_PREFIX, "ciqual-food-code-");

  // ⚠️ L'HÔTE EST world.openfoodfacts.org, PAS search.openfoodfacts.org.
  // Search-a-licious n'indexe pas `categories_properties_tags` : y filtrer ne
  // renverrait pas une erreur, mais des résultats NON filtrés.
  assert.ok(url.includes("world.openfoodfacts.org"), `hôte inattendu : ${url}`);
  assert.ok(
    !ADAPTATEUR.includes('"https://search.openfoodfacts.org'),
    "l'adaptateur Ciqual ne doit jamais viser Search-a-licious",
  );

  // Un code de forme invalide n'atteint jamais le réseau.
  assert.equal(codeCiqualEstValide("9119"), true);
  assert.equal(codeCiqualEstValide("abc"), false);
  assert.equal(codeCiqualEstValide(""), false);
  assert.equal(codeCiqualEstValide("9119; drop"), false);
  assert.throws(() => urlRechercheParCodeCiqual("pas-un-code"));
});

await test("C4.1-08 — aucun repli par recherche de nom", () => {
  const nu = LOT_C4_1.map(sansProseAffichee).join("\n");
  for (const interdit of [
    "chercherProduitsParTexte",
    "urlRechercheProduits",
    "echapperLucene",
    "product_name__like",
    "search.openfoodfacts.org",
  ]) {
    assert.ok(!nu.includes(interdit), `repli textuel détecté : ${interdit}`);
  }
  // Et la route rend explicitement zéro candidat quand le code Ciqual manque,
  // plutôt que de basculer sur autre chose.
  assert.match(sansCommentaires(ROUTE_CANDIDATS), /sansCodeCiqual:\s*true/);
});

await test("C4.1-09 — France uniquement", () => {
  assert.equal(CIQUAL_PAYS, "France");
  assert.match(urlRechercheParCodeCiqual("16403"), /countries_tags_en=France/);
});

await test("C4.1-10 — un candidat à nutrition incomplète est montré, jamais fabriqué", () => {
  const resultat = candidatsDepuisReponse(
    "19624",
    fixtureOff([
      { code: "3033491588136", product_name: "Hipro Vanille", nutriments: NUTRIMENTS_OK },
      { code: "3033491485756", product_name: "Yaourt à boire", nutriments: { proteins_100g: 3 } },
      { code: "4056489491217", product_name: "Skyr", no_nutrition_data: "on", nutriments: NUTRIMENTS_OK },
      { code: "3329770057234", nutriments: NUTRIMENTS_OK },
    ]),
  );

  assert.equal(resultat.importables.length, 1, "seul le produit complet est importable");
  assert.equal(resultat.nonImportables.length, 3);
  for (const rejete of resultat.nonImportables) {
    assert.equal(rejete.refus, "nutrition_incomplete");
    assert.ok(rejete.gtin !== null, "le candidat rejeté garde son code-barres, pour être affiché");
  }

  // ⚠️ AUCUN ZÉRO FABRIQUÉ. Le produit incomplet n'apparaît pas comme importable
  // avec des macros à 0 — ce serait une donnée nutritionnelle inventée.
  assert.ok(
    !resultat.importables.some((c) => c.produit.proteinPer100 === 0 && c.produit.carbPer100 === 0),
    "aucune macro ne doit être fabriquée à zéro",
  );

  // Et l'écran les affiche au lieu de les taire.
  assert.match(UI, /nonImportables/);
  assert.match(sansCommentaires(ROUTE_CANDIDATS), /nonImportables:/);
});

// ════════════════════════════════════════════════════════════════════════════
// E. LES DROITS
// ════════════════════════════════════════════════════════════════════════════

await test("C4.1-11 — les trois routes d'écriture et de lecture sont admin-only", () => {
  for (const [nom, source] of [
    ["candidates", ROUTE_CANDIDATS],
    ["match", ROUTE_MATCH],
    ["review", ROUTE_REVIEW],
  ] as const) {
    const nu = sansCommentaires(source);
    assert.match(nu, /import \{ requireAdmin \} from "@\/lib\/api\/authz"/, `${nom} : garde absente`);
    assert.match(nu, /const acces = await requireAdmin\(\);/, `${nom} : garde non appelée`);
    assert.match(nu, /if \(!acces\.ok\) return acces\.response;/, `${nom} : refus non renvoyé`);
    assert.ok(
      !/requireStaff|requireAdminOrCoach/.test(nu),
      `${nom} : une garde plus large que l'admin a été utilisée`,
    );
  }
  // La page double la garde côté affichage — sans jamais la remplacer.
  assert.match(PAGE_PONT, /await requireAdmin\(\)/);
  // ⚠️ La page EXPLIQUE en commentaire pourquoi ce n'est pas
  // `requireAdminOrCoach` : c'est le code qu'on inspecte, pas la prose.
  assert.ok(!/requireAdminOrCoach/.test(sansCommentaires(PAGE_PONT)));
});

await test("C4.1-12 / C4.1-13 — coach et élève refusés par la même garde", () => {
  // `requireAdmin` de `lib/api/authz` est la SEULE porte : elle refuse tout
  // rôle qui n'est pas exactement « admin ». On vérifie ici qu'aucune route du
  // lot n'introduit une seconde condition qui l'élargirait.
  const authz = sansCommentaires(lire("../../lib/api/authz.ts"));
  // `estAdmin` est calculé en UN endroit (`contexte()`), et vaut exactement
  // `role === "admin"` — jamais « admin ou coach ».
  assert.match(
    authz,
    /estAdmin:\s*role === "admin"/,
    "estAdmin doit valoir exactement role === admin",
  );
  assert.match(
    authz,
    /export async function requireAdmin\(\)[\s\S]{0,300}if \(!ctx\.estAdmin\) return refus\("Accès refusé\.", 403\);/,
    "requireAdmin doit refuser tout rôle autre qu'admin",
  );
  for (const source of [ROUTE_CANDIDATS, ROUTE_MATCH, ROUTE_REVIEW]) {
    const nu = sansCommentaires(source);
    assert.ok(
      !/role\s*===\s*["']coach["']/.test(nu) && !/estAdmin\s*\|\|/.test(nu),
      "aucune route ne doit rouvrir l'accès au coach",
    );
  }
  // La RLS de la table de revue est admin, et pas « authentifié ».
  assert.match(MIGRATION_C4_1, /for select to authenticated\s*\n\s*using \(public\.is_admin\(\)\)/i);
});

await test("C4.1-14 — AUCUN nouveau grant sur food_products", () => {
  const nu = sqlNu(MIGRATION_C4_1);
  assert.ok(
    !/food_products/i.test(nu),
    "la migration C4.1 ne doit pas mentionner food_products hors commentaire",
  );
  for (const verbe of ["insert", "update", "delete"]) {
    assert.ok(
      !new RegExp(`grant[^;]*${verbe}[^;]*food_products`, "i").test(nu),
      `un grant ${verbe} sur food_products a été ajouté`,
    );
  }
  // La serrure de septembre est toujours celle qu'on connaît.
  assert.match(MIGRATION_PRODUITS, /revoke all on table public\.food_products from authenticated;/i);
  assert.match(MIGRATION_PRODUITS, /grant select on table public\.food_products to authenticated;/i);

  // Et aucune RPC `security definer` n'a été créée pour contourner la serrure.
  const nuLot = LOT_C4_1.map(sansProseAffichee).join("\n");
  assert.ok(!/security definer/i.test(sqlNu(MIGRATION_C4_1)), "aucune RPC security definer");
  assert.ok(!/\.rpc\(/.test(nuLot), "aucune RPC appelée pour écrire le pont");
  // L'écriture passe par le client admin, depuis le serveur.
  assert.match(sansCommentaires(ROUTE_MATCH), /createSupabaseAdminClient\(\)/);
  assert.match(BASE, /import "server-only"|admin: TypedSupabaseClient/);
});

// ════════════════════════════════════════════════════════════════════════════
// F. OPEN PRICES — LE PIÈGE DES 98 CARACTÈRES
// ════════════════════════════════════════════════════════════════════════════

await test("C4.1-15 — jamais plus de 7 codes, ni plus de 97 caractères, par appel", () => {
  assert.equal(OPEN_PRICES_LOT_MAX_CODES, 7);
  assert.equal(OPEN_PRICES_LOT_MAX_CARACTERES, 97);

  const vingt = Array.from({ length: 20 }, (_, i) => String(3000000000000 + i));
  const lots = decouperLotsCodesBarres(vingt);
  assert.ok(lots.length >= 3, `20 codes doivent tenir en au moins 3 lots, vu ${lots.length}`);
  for (const lot of lots) {
    assert.ok(lot.length <= OPEN_PRICES_LOT_MAX_CODES, `lot de ${lot.length} codes`);
    assert.ok(
      lot.join(",").length <= OPEN_PRICES_LOT_MAX_CARACTERES,
      `lot de ${lot.join(",").length} caractères — au-delà, le filtre saute EN SILENCE`,
    );
  }
  // Tous les codes sont couverts, une fois chacun.
  assert.deepEqual([...new Set(lots.flat())].sort(), [...vingt].sort());

  // Les doublons ne gaspillent pas un emplacement.
  assert.deepEqual(decouperLotsCodesBarres(["111", "111", "222"]), [["111", "222"]]);

  // Le cas exact mesuré le 17/08/2026 : 8 codes EAN-13 = 111 caractères → 2 lots.
  const huit = Array.from({ length: 8 }, (_, i) => String(3181232220280 + i));
  const lotsHuit = decouperLotsCodesBarres(huit);
  assert.equal(lotsHuit.length, 2);
  assert.equal(lotsHuit[0]!.length, 7);
});

await test("C4.1-16 — une réponse Open Prices anormale est rejetée, pas utilisée", () => {
  const lot = ["3181232220286", "8076809523509"];

  // Cohérente : rien à signaler.
  assert.equal(
    verifierReponseOpenPrices({ total: 58, codesDemandes: lot, codesRendus: [...lot, lot[0]!] }),
    null,
  );

  // ⚠️ LE CAS RÉEL. Le filtre saute, l'API rend toute la table : un seul code
  // étranger suffit à le prouver, et c'est une CERTITUDE, pas une heuristique.
  assert.equal(
    verifierReponseOpenPrices({
      total: 290792,
      codesDemandes: lot,
      codesRendus: ["4104420222595", "4260446585431"],
    }),
    "codes_hors_lot",
  );

  // Filet de sécurité : même si la première page ne montrait, par hasard, que
  // des codes demandés, un total absurde reste refusé.
  assert.equal(
    verifierReponseOpenPrices({ total: 290792, codesDemandes: lot, codesRendus: lot }),
    "total_aberrant",
  );
  assert.equal(
    verifierReponseOpenPrices({ total: Number.NaN, codesDemandes: lot, codesRendus: [] }),
    "total_aberrant",
  );

  // Et l'appelant traite l'incohérence comme une panne : le lot est jeté.
  assert.match(sansCommentaires(APERCU), /incoherence !== null[\s\S]{0,200}continue;/);
});

await test("C4.1-16 bis — « aucun prix » et « on ne sait pas » ne se confondent pas", () => {
  const lot = ["111", "222"];
  // Réponse COMPLÈTE (total = nombre d'items) : l'absence est un fait.
  const complet = agregerApercus(lot, [{ product_code: "111", date: "2026-08-09" }], 1);
  assert.equal(complet.get("111")!.statut, "connu");
  assert.equal(complet.get("222")!.statut, "aucun");

  // Réponse TRONQUÉE : l'absence ne prouve rien.
  const tronque = agregerApercus(lot, [{ product_code: "111", date: "2026-08-09" }], 900);
  assert.equal(tronque.get("222")!.statut, "indetermine");

  // La date la PLUS RÉCENTE gagne (tri `-date`), et une ligne sans date ne
  // l'efface pas.
  const dates = agregerApercus(
    ["111"],
    [
      { product_code: "111", date: "2026-08-09", proof: { type: "PRICE_TAG" } },
      { product_code: "111", date: null, proof: { type: "RECEIPT" } },
      { product_code: "111", date: "2026-05-11", proof: { type: "PRICE_TAG" } },
    ],
    3,
  );
  assert.equal(dates.get("111")!.observeLe, "2026-08-09");
  assert.equal(dates.get("111")!.nombre, 3);
  assert.equal(dates.get("111")!.nombreCommunity, 2, "seules PRICE_TAG et SHOP_IMPORT sont COMMUNITY");
});

// ════════════════════════════════════════════════════════════════════════════
// G. CE QUE C4.1 N'A PAS LE DROIT DE CONTENIR
// ════════════════════════════════════════════════════════════════════════════

await test("C4.1-17 / 18 / 19 — aucun facteur cru/cuit, aucun code d'achat, aucun rendement", () => {
  const nuLot = LOT_C4_1.map(sansProseAffichee).join("\n");
  const nuSql = sqlNu(MIGRATION_C4_1);
  for (const interdit of [
    "yield_ratio",
    "yieldRatio",
    "purchase_ciqual_code",
    "purchaseCiqualCode",
    "cooking_factor",
    "cookingFactor",
    "facteurCuisson",
    "ratio_cru_cuit",
    "ratioCruCuit",
    "edible_portion",
    "retention_factor",
  ]) {
    assert.ok(!nuLot.includes(interdit), `identifiant interdit dans le code : ${interdit}`);
    assert.ok(!nuSql.includes(interdit), `colonne interdite en base : ${interdit}`);
  }
  // La forme cuite est SORTIE du flux, pas convertie : le seul traitement
  // possible est un statut.
  assert.ok(STATUTS_REVUE.includes("needs_raw_redirect"));
});

await test("C4.1-20 — aucun prix alimentaire ne peut être saisi dans le parcours C4.1", () => {
  const nuLot = [ROUTE_CANDIDATS, ROUTE_MATCH, ROUTE_REVIEW, SCHEMAS, UI, BASE]
    .map(sansProseAffichee)
    .join("\n");

  // Aucun champ de saisie monétaire.
  for (const interdit of [
    "price_cents",
    "priceCents",
    "estimated_price_cents",
    "centsDepuisSaisie",
    "publierPrix",
    "definirPrixArticleManuel",
    "food_price_estimates",
    "manual_estimate",
  ]) {
    assert.ok(!nuLot.includes(interdit), `saisie de prix détectée : ${interdit}`);
  }
  // Aucun `<input>` dans l'écran hors les cases à cocher.
  const inputs = [...UI.matchAll(/<input[\s\S]{0,120}?type="([a-z]+)"/g)].map((m) => m[1]);
  assert.deepEqual(inputs, ["checkbox"], `entrées inattendues dans l'écran : ${inputs.join(", ")}`);

  // Et l'ancienne page de saisie ne rend plus le formulaire.
  assert.ok(
    !/PrixEstimatifsAdmin/.test(sansCommentaires(PAGE_PRIX)),
    "la page /admin/nutrition/prix ne doit plus monter le formulaire de saisie",
  );
  assert.match(PAGE_PRIX, /await requireAdmin\(\)/, "la page reste gardée");
});

// ════════════════════════════════════════════════════════════════════════════
// H. NON-RÉGRESSION C3
// ════════════════════════════════════════════════════════════════════════════

function ligne(partiel: Partial<LigneAffichee> & { id: string }): LigneAffichee {
  return {
    source: "plan",
    cle: `catalog_food:${partiel.id}|g`,
    libelle: "Riz",
    quantite: "1 000 g",
    colorKey: null,
    checked: false,
    ...partiel,
  } as LigneAffichee;
}

await test("C4.1-21 — le budget C3 n'a pas régressé", () => {
  // ⚠️ LE MODULE PUR DE C3 N'EST PAS TOUCHÉ PAR CE LOT, et la forme `PrixEstime`
  // accueille sans modification un prix issu d'un PRODUIT RÉEL : un paquet de
  // 1 kg à 2,80 € s'écrit { quantite: 1000, unite: 'g', priceCents: 280 }.
  const prix: PrixEstime[] = [
    { identityType: "catalog_food", identityId: "riz", priceCents: 280, quantite: 1000, unite: "g" },
  ];
  const budget = calculerBudgetListe(
    [ligne({ id: "l1", cle: "catalog_food:riz|g" })],
    indexerPrix(prix),
    50000,
    new Map([["l1", { quantite: 1274, unite: "g" }]]),
    new Map(),
  );
  assert.equal(budget.estimeCents, 357, "1 274 g à 2,80 €/kg = 356,72 → 357 centimes");
  assert.equal(budget.articlesEstimes, 1);
  assert.equal(budget.partielle, false);
  assert.equal(budget.ecartCents, 50000 - 357);

  // Le module C3 est intact : ses garanties n'ont pas été rouvertes.
  const c3 = lire("../../lib/nutrition/budget-courses.ts");
  assert.match(c3, /Number\.isSafeInteger/, "la garde D-2 doit rester");
  assert.match(c3, /priceCents < 0/, "la garde D-1 doit rester");
});

await test("C4.1-22 — les articles MANUELS non alimentaires n'ont pas régressé", () => {
  // Un article manuel garde son prix forfaitaire : ce n'est pas un prix
  // ALIMENTAIRE, c'est du papier toilette, et le pivot ne le concerne pas.
  const budget = calculerBudgetListe(
    [ligne({ id: "m1", source: "manual", cle: "manual:m1", libelle: "Éponges", quantite: null })],
    new Map(),
    null,
    new Map(),
    new Map([["m1", 450]]),
  );
  assert.equal(budget.estimeCents, 450);
  assert.equal(budget.articlesSansPrix, 0);

  // La RPC et la colonne existent toujours — C4.1 ne les a pas retirées.
  const prixCourses = lire("../../lib/supabase/prix-courses.ts");
  assert.match(prixCourses, /export async function definirPrixArticleManuel/);
  assert.match(prixCourses, /export async function definirBudget/);
  const listePersistante = lire("../../lib/nutrition/liste-persistante.ts");
  assert.match(listePersistante, /estimatedPriceCents: number \| null/);
});

// ════════════════════════════════════════════════════════════════════════════
// I. LE CONTRAT DES MIGRATIONS
// ════════════════════════════════════════════════════════════════════════════

await test("C4.1-23 — contrat des migrations : C4.1 déclarée, historique figé", () => {
  verifierContratDesMigrations(assert);
  // La migration est ADDITIVE : elle ne modifie aucune table existante.
  const nu = sqlNu(MIGRATION_C4_1);
  for (const table of [
    "food_catalog",
    "food_products",
    "shopping_lists",
    "shopping_list_items",
    "food_price_estimates",
    "planned_meals",
    "consumed_meals",
  ]) {
    // ⚠️ `(?!_)` EST INDISPENSABLE : `food_catalog_retail_review` COMMENCE par
    // `food_catalog`. Sans lui, la table neuve ferait rougir le test qui
    // protège la table ancienne — et on aurait relâché la garde pour du vert.
    assert.ok(
      !new RegExp(`alter table (if exists )?(public\\.)?${table}(?![_a-z])`, "i").test(nu),
      `C4.1 ne doit pas altérer ${table}`,
    );
    assert.ok(
      !new RegExp(`drop (table|column)[^;]*\\b${table}(?![_a-z])`, "i").test(nu),
      `C4.1 ne doit rien supprimer sur ${table}`,
    );
  }
  // La seule référence tolérée à food_catalog est la clé étrangère.
  const references = [...nu.matchAll(/references (public|auth)\.(\w+)/gi)].map((m) => `${m[1]}.${m[2]}`);
  assert.deepEqual(
    [...new Set(references)].sort(),
    ["auth.users", "public.food_catalog"],
    "les seules clés étrangères sont l'aliment concerné et l'auteur de la décision",
  );
});
