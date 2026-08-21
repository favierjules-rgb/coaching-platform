/**
 * Harnais — COURSES C4.3c : LA COUCHE PURE OPENSTREETMAP.
 *
 * ────────────────────────────────────────────────────────────────────────────
 * CE QUE CE FICHIER PROUVE
 * ────────────────────────────────────────────────────────────────────────────
 * Qu'un élément brut d'Overpass devient un magasin exploitable OU rien du tout ;
 * que la catégorie vient du TAG et jamais du nom ; que l'exclusion des cavistes
 * est DÉLIBÉRÉE et non un oubli de recopie ; que `shop=organic` — déprécié —
 * n'est plus une porte d'entrée ; et que l'identité d'un magasin est la PAIRE
 * `(osm_type, osm_id)`, jamais l'identifiant seul.
 *
 * ⚠️ AUCUN ACCÈS RÉSEAU, AUCUNE BASE. Overpass n'est jamais appelé ici : tout
 * est fixture. Ce fichier teste la couche pure, pas l'adaptateur.
 *
 * ⚠️ AVEU DE PROCÉDÉ, ÉCRIT ICI POUR NE PAS ÊTRE OUBLIÉ AILLEURS.
 * `lib/nutrition/magasins-osm.ts` A ÉTÉ ÉCRIT AVANT CETTE SUITE. La consigne
 * était « tests AVANT code » et elle n'a pas été tenue sur ce module. La
 * conséquence est réelle : ces cas ont été écrits en connaissant
 * l'implémentation, donc ils prouvent moins qu'ils ne le paraîtraient. C'est
 * précisément pour cela que la section Z rejoue les cas contre des fixtures
 * choisies pour casser le code TEL QU'IL EST écrit, et non pour le confirmer.
 *
 * Lancement : npm run test:magasins-osm-c4-3c
 */
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

import {
  type CouvertureMagasin,
  AUCUN_MAGASIN,
  magasinChoisi,
} from "../../lib/nutrition/couverture-magasin";
import { budgetObserve, resoudreLigne, type EntreeLigne } from "../../lib/nutrition/budget-observe";
import { etatPrixObserves } from "../../lib/nutrition/prix-observes";
import { lireCouvertureDuMagasinChoisi } from "../../lib/supabase/prix-observes";
import {
  type ElementOverpass,
  type MagasinOsm,
  SHOP_ALCOOL_EXCLUS,
  SHOP_ALIMENTAIRES,
  cleIdentiteOsm,
  dedupliquerParIdentiteOsm,
  estCommerceAlimentaireOsm,
  identifiantWikidataValide,
  normaliserElementOsm,
  marqueAAfficher,
  typeOsmDepuis,
} from "../../lib/nutrition/magasins-osm";

const lire = (chemin: string) => readFileSync(new URL(chemin, import.meta.url), "utf8");
const PUR = lire("../../lib/nutrition/magasins-osm.ts");
const COUVERTURE = lire("../../lib/nutrition/couverture-magasin.ts");
const LECTURE_BASE = lire("../../lib/supabase/prix-observes.ts");
const ROUTE = lire("../../app/api/student/shopping-list/observed-prices/route.ts");
const HOOK = lire("../../hooks/useBudgetObserve.ts");
const ECRAN = lire("../../components/student/BlocMinimumObserve.tsx");
const C4_4 = lire("../../lib/nutrition/prix-observes.ts");
const C4_6 = lire("../../lib/nutrition/budget-observe.ts");

function sansCommentaires(source: string): string {
  return source.replace(/\/\*[\s\S]*?\*\//g, " ").replace(/(^|[^:])\/\/.*$/gm, "$1 ");
}

/* ── Fixtures ─────────────────────────────────────────────────────────────── */

/** Un nœud Overpass bien formé — Toulon, coordonnées réelles de la ville. */
function noeud(tags: Record<string, unknown>, surcharge: Partial<ElementOverpass> = {}): ElementOverpass {
  return { type: "node", id: 9928912836, lat: 43.1242, lon: 5.928, tags, ...surcharge };
}

/** Un chemin Overpass — pas de `lat`/`lon`, un `center` calculé par `out center`. */
function chemin(tags: Record<string, unknown>, surcharge: Partial<ElementOverpass> = {}): ElementOverpass {
  return { type: "way", id: 274420431, center: { lat: 43.128, lon: 5.9301 }, tags, ...surcharge };
}

function relation(tags: Record<string, unknown>, surcharge: Partial<ElementOverpass> = {}): ElementOverpass {
  return { type: "relation", id: 1834502, center: { lat: 43.1201, lon: 5.9377 }, tags, ...surcharge };
}

function retenu(element: ElementOverpass, message: string): MagasinOsm {
  const magasin = normaliserElementOsm(element);
  assert.ok(magasin !== null, message);
  return magasin;
}

// ════════════════════════════════════════════════════════════════════════════
// A. CE QU'EST UN COMMERCE ALIMENTAIRE — LA CATÉGORIE VIENT DU TAG
// ════════════════════════════════════════════════════════════════════════════

await test("OSM-08 — shop=supermarket est accepté", () => {
  const m = retenu(noeud({ shop: "supermarket", name: "Naturalia" }), "un supermarché est un commerce alimentaire");
  assert.equal(m.name, "Naturalia");
  assert.equal(estCommerceAlimentaireOsm({ shop: "supermarket" }), true);
});

await test("OSM-09 — shop=convenience est accepté", () => {
  retenu(noeud({ shop: "convenience", name: "Proxi Mourillon" }), "une supérette est un commerce alimentaire");
  assert.equal(estCommerceAlimentaireOsm({ shop: "convenience" }), true);
});

await test("OSM-10 — shop=bakery est accepté", () => {
  retenu(noeud({ shop: "bakery", name: "Boulangerie du Port" }), "une boulangerie est un commerce alimentaire");
  assert.equal(estCommerceAlimentaireOsm({ shop: "bakery" }), true);
});

await test("OSM-11 — shop=pastry est accepté", () => {
  // ⚠️ `pastry` faisait partie des HUIT MANQUES comblés par l'audit C4.3c :
  // la liste de C4.3a l'ignorait, et une pâtisserie disparaissait donc de la
  // recherche sans qu'aucun message ne le dise.
  retenu(noeud({ shop: "pastry", name: "Pâtisserie Bérard" }), "une pâtisserie est un commerce alimentaire");
  assert.equal(estCommerceAlimentaireOsm({ shop: "pastry" }), true);
});

await test("OSM-12 — shop=newsagent est rejeté", () => {
  // Le cas MESURÉ : sur les deux lieux Open Prices de Toulon, l'un est un
  // Relay étiqueté `shop=newsagent`. OSM le classe en kiosque / commerce
  // général, pas en alimentation. Le refuser n'est pas une perte : c'est la
  // raison pour laquelle la mesure toulonnaise ne comptait qu'UN magasin.
  assert.equal(normaliserElementOsm(noeud({ shop: "newsagent", name: "Relay" })), null);
  assert.equal(estCommerceAlimentaireOsm({ shop: "newsagent" }), false);
  assert.equal(SHOP_ALIMENTAIRES.has("newsagent"), false);
});

await test("OSM-13 — le caviste est exclu, et l'exclusion est délibérée", () => {
  for (const shop of ["alcohol", "wine", "brewing_supplies"]) {
    assert.equal(
      normaliserElementOsm(noeud({ shop, name: `Caviste ${shop}` })),
      null,
      `${shop} ne doit pas être proposé comme magasin de courses`,
    );
    assert.equal(SHOP_ALIMENTAIRES.has(shop), false);
    // ⚠️ LA PREUVE QUE C'EST UN CHOIX ET NON UN OUBLI : la valeur est NOMMÉE
    // dans l'ensemble des exclusions. Un oubli de recopie ne laisse pas de
    // trace ; une doctrine, si.
    assert.equal(SHOP_ALCOOL_EXCLUS.has(shop), true, `${shop} doit être explicitement exclu`);
  }
  // Les deux ensembles sont disjoints — sinon l'un des deux mentirait.
  for (const shop of SHOP_ALCOOL_EXCLUS) {
    assert.equal(SHOP_ALIMENTAIRES.has(shop), false, `${shop} ne peut être à la fois accepté et exclu`);
  }
});

await test("OSM-14 — organic=yes sur un supermarket est accepté", () => {
  const m = retenu(
    noeud({ shop: "supermarket", organic: "yes", name: "Biocoop Toulon" }),
    "un magasin bio entre par sa catégorie principale",
  );
  assert.equal(m.name, "Biocoop Toulon");
  // Et l'attribut n'a servi à rien : il n'est ni lu, ni conservé.
  assert.equal(Object.prototype.hasOwnProperty.call(m, "organic"), false);
});

await test("OSM-15 — le vieux shop=organic n'est pas une catégorie primaire", () => {
  // `shop=organic` est DÉPRÉCIÉ par OSM au profit de `organic=yes` posé en plus
  // d'un `shop=*` réel. L'accepter comme catégorie ferait entrer un tag mort et
  // dispenserait les contributeurs de la correction que le wiki demande.
  assert.equal(normaliserElementOsm(noeud({ shop: "organic", name: "Vieux bio" })), null);
  assert.equal(SHOP_ALIMENTAIRES.has("organic"), false);
  // Le module ne lit jamais la clé `organic` : ni comme entrée, ni comme appoint.
  assert.equal(/\borganic\b/.test(sansCommentaires(PUR)), false, "`organic` ne doit apparaître dans aucun code");
});

// ════════════════════════════════════════════════════════════════════════════
// B. LES TROIS GÉOMÉTRIES D'OVERPASS
// ════════════════════════════════════════════════════════════════════════════

await test("OSM-16 — un node est normalisé depuis lat/lon", () => {
  const m = retenu(noeud({ shop: "supermarket", name: "Naturalia" }), "un node porte ses propres coordonnées");
  assert.equal(m.osmType, "NODE");
  assert.equal(m.osmId, 9928912836);
  assert.equal(m.lat, 43.1242);
  assert.equal(m.lon, 5.928);
  assert.equal(m.distanceKm, null, "hors recherche géographique, il n'existe aucun point de départ");
});

await test("OSM-17 — un way est normalisé depuis center", () => {
  const m = retenu(chemin({ shop: "supermarket", name: "Carrefour Grand Var" }), "un way porte un center");
  assert.equal(m.osmType, "WAY");
  assert.equal(m.osmId, 274420431);
  assert.equal(m.lat, 43.128);
  assert.equal(m.lon, 5.9301);
});

await test("OSM-18 — une relation est normalisée depuis center", () => {
  const m = retenu(relation({ shop: "supermarket", name: "Centre Mayol" }), "une relation porte un center");
  assert.equal(m.osmType, "RELATION");
  assert.equal(m.osmId, 1834502);
  assert.equal(m.lat, 43.1201);
  assert.equal(m.lon, 5.9377);
});

await test("OSM-19 — un même osm_id en NODE et en WAY donne DEUX magasins", () => {
  // ⚠️ OpenStreetMap numérote nœuds, chemins et relations dans TROIS espaces
  // séparés. Le nœud 4242 et le chemin 4242 sont deux objets sans rapport.
  // Dédupliquer sur l'identifiant seul en fusionnerait un jour deux — et
  // `stores` porte `unique (osm_type, osm_id)` pour exactement cette raison.
  const a = retenu(noeud({ shop: "bakery", name: "Boulangerie A" }, { id: 4242 }), "node 4242");
  const b = retenu(chemin({ shop: "bakery", name: "Boulangerie B" }, { id: 4242 }), "way 4242");
  assert.equal(a.osmId, b.osmId);
  assert.notEqual(a.osmType, b.osmType);

  const garde = dedupliquerParIdentiteOsm([a, b]);
  assert.equal(garde.length, 2, "deux identités distinctes ne se fondent pas");
  assert.equal(cleIdentiteOsm(a), "NODE/4242");
  assert.equal(cleIdentiteOsm(b), "WAY/4242");
  assert.notEqual(cleIdentiteOsm(a), cleIdentiteOsm(b));

  // Et la même identité, elle, fusionne — en gardant la PREMIÈRE apparition.
  const doublon = dedupliquerParIdentiteOsm([a, { ...a, name: "Doublon tardif" }, b]);
  assert.equal(doublon.length, 2);
  assert.equal(doublon[0]!.name, "Boulangerie A");
});

await test("OSM-20 — des coordonnées absentes sont refusées", () => {
  // Sans `lat`/`lon` ni `center`, il n'y a rien à afficher sur une carte et
  // rien à comparer à la position de l'élève. Le ramener à 0/0 placerait un
  // supermarché toulonnais au large du golfe de Guinée.
  assert.equal(
    normaliserElementOsm({ type: "node", id: 1, tags: { shop: "supermarket", name: "Sans lieu" } }),
    null,
    "un node sans lat/lon est écarté",
  );
  assert.equal(
    normaliserElementOsm({ type: "way", id: 2, center: null, tags: { shop: "supermarket", name: "Sans centre" } }),
    null,
    "un way sans center est écarté",
  );
  assert.equal(
    normaliserElementOsm({ type: "way", id: 3, center: { lat: 43.1 }, tags: { shop: "supermarket", name: "Demi" } }),
    null,
    "un center à moitié rempli est écarté",
  );
  // Et surtout : aucune coordonnée de repli n'est écrite dans le module.
  assert.equal(/lat:\s*0\b|lon:\s*0\b|\?\?\s*0/.test(sansCommentaires(PUR)), false, "aucun repli 0/0");
});

// ════════════════════════════════════════════════════════════════════════════
// C. CE QUI EST CONSERVÉ DE L'ÉLÉMENT BRUT
// ════════════════════════════════════════════════════════════════════════════

await test("OSM-21 — la marque est conservée", () => {
  const m = retenu(noeud({ shop: "supermarket", name: "Naturalia Toulon", brand: "Naturalia" }), "brand");
  assert.equal(m.brand, "Naturalia");
  // Absente, elle vaut `null` — jamais le nom recopié en guise de marque.
  const sans = retenu(noeud({ shop: "supermarket", name: "Épicerie du coin" }), "sans brand");
  assert.equal(sans.brand, null);
});

await test("OSM-22 — brand:wikidata est conservé", () => {
  const m = retenu(
    noeud({ shop: "supermarket", name: "Naturalia Toulon", "brand:wikidata": "Q3336090" }),
    "brand:wikidata",
  );
  assert.equal(m.brandWikidata, "Q3336090");
  // ⚠️ ET C'EST LUI L'IDENTIFIANT D'ENSEIGNE, PAS LE NOM. « Carrefour City »,
  // « Carrefour Market » et « Carrefour Contact » portent des noms différents
  // et le même item Wikidata. Comparer des chaînes de nom rapprocherait mal.
  const forme = retenu(noeud({ shop: "supermarket", name: "X", "brand:wikidata": "  Q151954  " }), "espaces");
  assert.equal(forme.brandWikidata, "Q151954", "les espaces sont rognés");
});

await test("OSM-23 — operator:wikidata est conservé", () => {
  const m = retenu(
    noeud({ shop: "supermarket", name: "Carrefour Market", "operator:wikidata": "Q151954" }),
    "operator:wikidata",
  );
  assert.equal(m.operatorWikidata, "Q151954");
  // Marque et exploitant sont DEUX champs : un franchisé exploite une enseigne
  // qu'il ne possède pas. Les confondre effacerait cette distinction.
  const deux = retenu(
    noeud({ shop: "supermarket", name: "Y", "brand:wikidata": "Q3336090", "operator:wikidata": "Q151954" }),
    "les deux",
  );
  assert.equal(deux.brandWikidata, "Q3336090");
  assert.equal(deux.operatorWikidata, "Q151954");
});

await test("OSM-24 — l'adresse est conservée", () => {
  const m = retenu(
    noeud({
      shop: "supermarket",
      name: "Naturalia Toulon",
      "addr:city": "Toulon",
      "addr:postcode": "83000",
      "addr:country": "fr",
    }),
    "adresse",
  );
  assert.equal(m.city, "Toulon");
  assert.equal(m.postcode, "83000");
  assert.equal(m.countryCode, "FR", "ISO-3166-1 alpha-2 en majuscules, comme stores_country_code_iso l'exige");

  const sans = retenu(noeud({ shop: "supermarket", name: "Sans adresse" }), "sans adresse");
  assert.equal(sans.city, null);
  assert.equal(sans.postcode, null);
  assert.equal(sans.countryCode, null);
});


// ════════════════════════════════════════════════════════════════════════════
// D. LA COUVERTURE PRIX — LE `number | null` QUI MENTAIT EST MORT
// ════════════════════════════════════════════════════════════════════════════

const PONTE: CouvertureMagasin = {
  etat: "magasin_ponte",
  storeId: "11111111-1111-4111-8111-111111111111",
  osmType: "NODE",
  osmId: 9928912836,
  opLocationId: 4877,
};

const SANS_PONT: CouvertureMagasin = {
  etat: "magasin_sans_couverture_prix",
  storeId: "22222222-2222-4222-8222-222222222222",
  osmType: "WAY",
  osmId: 274420431,
};

function ligne(etat: EntreeLigne["etat"]): EntreeLigne {
  return {
    ligneId: "L1",
    origine: "plan",
    etat,
    tronque: false,
    ignores: 0,
    raisonIndisponible: null,
    scenarios: [],
  };
}

await test("COUV-01 — trois cas nommés, et AUCUN accesseur ne les remet en un seul", () => {
  assert.equal(AUCUN_MAGASIN.etat, "aucun_magasin");
  assert.equal(magasinChoisi(AUCUN_MAGASIN), false);
  assert.equal(magasinChoisi(SANS_PONT), true);
  assert.equal(magasinChoisi(PONTE), true);

  // ⚠️ `opLocationId` N'EXISTE QUE DANS LA BRANCHE PONTÉE. C'est le compilateur
  // qui l'impose ; ce test le constate aussi à l'exécution, pour qu'un `any`
  // glissé un jour ne le contourne pas en silence.
  assert.equal(Object.prototype.hasOwnProperty.call(SANS_PONT, "opLocationId"), false);
  assert.equal(Object.prototype.hasOwnProperty.call(AUCUN_MAGASIN, "opLocationId"), false);

  // Et le module ne fournit aucune fonction qui reconstituerait le `number | null`.
  const nu = sansCommentaires(COUVERTURE);
  assert.equal(/opLocationIdOuNull|opLocationIdDe|toOpLocationId/.test(nu), false);
  assert.equal(/: number \| null/.test(nu), false, "aucun `number | null` ne revient par la porte");
});

await test("COUV-02 — C4.4 : aucun magasin reste aucun_magasin", () => {
  const r = etatPrixObserves({ couverture: AUCUN_MAGASIN, gtins: ["a", "b"], lecture: null });
  assert.equal(r.etat, "aucun_magasin");
  assert.deepEqual(r.observations, []);
});

await test("COUV-03 — C4.4 : magasin sans pont a son propre état, AVANT la curation", () => {
  // Avec des codes-barres reliés…
  assert.equal(
    etatPrixObserves({ couverture: SANS_PONT, gtins: ["3017620422003"], lecture: null }).etat,
    "magasin_sans_couverture_prix",
  );
  // …et sans. ⚠️ L'ORDRE EST LA RÈGLE : `aucun_produit_relie` accuserait la
  // curation d'un manque qui vient du magasin.
  assert.equal(
    etatPrixObserves({ couverture: SANS_PONT, gtins: [], lecture: null }).etat,
    "magasin_sans_couverture_prix",
  );
  // Et il ne se confond avec AUCUN des six autres.
  for (const autre of ["aucun_magasin", "aucun_produit_relie", "aucun_releve", "indetermine", "releves", "indisponible"]) {
    assert.notEqual("magasin_sans_couverture_prix", autre);
  }
});

await test("COUV-04 — C4.4 : un magasin PONTÉ ne masque pas l'absence de pont produit", () => {
  assert.equal(
    etatPrixObserves({ couverture: PONTE, gtins: [], lecture: null }).etat,
    "aucun_produit_relie",
  );
  // Et une panne reste une panne, jamais une absence de couverture magasin.
  assert.equal(
    etatPrixObserves({ couverture: PONTE, gtins: ["a"], lecture: null }).etat,
    "indisponible",
  );
  assert.equal(
    etatPrixObserves({
      couverture: PONTE,
      gtins: ["a"],
      lecture: { ok: true, observations: [], tronque: false, ignores: 0 },
    }).etat,
    "aucun_releve",
  );
  assert.equal(
    etatPrixObserves({
      couverture: PONTE,
      gtins: ["a"],
      lecture: { ok: true, observations: [], tronque: true, ignores: 0 },
    }).etat,
    "indetermine",
  );
});

await test("COUV-05 — C4.6 : la ligne est INDÉTERMINÉE, avec sa raison propre", () => {
  const r = resoudreLigne(ligne("magasin_sans_couverture_prix"));
  assert.equal(r.statut, "indeterminee");
  if (r.statut !== "indeterminee") throw new Error("statut inattendu");
  assert.deepEqual(r.raisons, ["magasin_sans_couverture_prix"]);
  assert.equal(r.minimumConnuMilli, null, "aucun montant n'est affirmé");
  assert.equal(r.scenarioMinimumConnu, null);
  assert.deepEqual(r.alternatives, []);
});

await test("COUV-06 — C4.6 : jamais sans_prix, jamais resolue, jamais 0", () => {
  const r = resoudreLigne(ligne("magasin_sans_couverture_prix"));
  // ⚠️ `sans_prix` AFFIRMERAIT « ce magasin ne vend pas cet article ». Nous
  // n'avons interrogé personne : nous n'en savons rien.
  assert.notEqual(r.statut, "sans_prix");
  assert.notEqual(r.statut, "resolue");
  assert.notEqual(r.statut, "indisponible");

  // Et le budget qui en découle ne compte AUCUNE ligne résolue et n'invente
  // aucun total — surtout pas zéro présenté comme un montant.
  const budget = budgetObserve([ligne("magasin_sans_couverture_prix")]);
  assert.equal(budget.lignesTotal, 1, "la ligne compte au dénominateur");
  assert.equal(budget.lignesResolues, 0);
  assert.notEqual(budget.statut, "complet");
});

await test("COUV-07 — C4.6 : aucun repli sur le budget estimatif de C3", () => {
  const nu = sansCommentaires(C4_6) + sansCommentaires(ROUTE);
  for (const motif of [/budget-courses/, /calculerBudgetListe/, /estimated_price/, /price_cents/, /indexerPrix/]) {
    assert.equal(motif.test(nu), false, `aucun repli C3 : ${motif}`);
  }
});

await test("COUV-08 — l'écran dit la phrase juste, et aucune des quatre fausses", () => {
  assert.ok(
    ECRAN.includes("Ce magasin n&apos;a pas encore de prix observés."),
    "la phrase exacte doit être à l'écran",
  );

  // ⚠️ ON ISOLE LA BRANCHE, PLUTÔT QUE DE BALAYER TOUT LE FICHIER. Les autres
  // phrases existent légitimement ailleurs dans ce composant ; ce qui serait
  // faux, c'est de les servir DANS CE CAS-LÀ.
  const debut = ECRAN.indexOf('if (couvertureMagasin === "magasin_sans_couverture_prix")');
  assert.ok(debut > 0, "la branche doit exister");
  const branche = ECRAN.slice(debut, ECRAN.indexOf("\n  }\n", debut));
  for (const fausse of [
    "Choisis un magasin",
    "0,00",
    "indisponible",
    "n'a pu être chiffré",
    "réessay",
  ]) {
    assert.equal(
      branche.toLowerCase().includes(fausse.toLowerCase()),
      false,
      `la branche « magasin sans pont » ne doit pas dire : ${fausse}`,
    );
  }
});

await test("COUV-09 — la route transmet l'ÉTAT, le hook n'accepte que trois valeurs", () => {
  // ⚠️ UN BOOLÉEN `magasinChoisi` RÉINTRODUIRAIT L'AMBIGUÏTÉ EN UNE LIGNE :
  // « magasin sans pont » y vaudrait `true`, et l'écran n'aurait plus rien
  // pour le distinguer d'un magasin pontté sans relevés.
  const routeNue = sansCommentaires(ROUTE);
  assert.ok(/couvertureMagasin:\s*couverture\.etat/.test(routeNue), "la route transmet l'état");
  assert.equal(/magasinChoisi/.test(routeNue), false, "aucun booléen ne subsiste dans la route");

  const hookNu = sansCommentaires(HOOK);
  assert.ok(/"magasin_ponte"/.test(hookNu) && /"magasin_sans_couverture_prix"/.test(hookNu));
  assert.ok(/"aucun_magasin"/.test(hookNu), "le repli du hook est l'état qui n'affirme rien");

  // Et la lecture en base ne rend plus jamais un bigint nu.
  const baseNue = sansCommentaires(LECTURE_BASE);
  assert.equal(/lireOpLocationIdDuMagasinChoisi/.test(baseNue), false, "l'ancienne lecture est retirée");
  assert.ok(/lireCouvertureDuMagasinChoisi/.test(baseNue));
  assert.ok(/Promise<CouvertureMagasin>/.test(baseNue), "elle rend une couverture, pas un nombre");
});

await test("COUV-10 — une panne, ou un identifiant douteux, ne rend JAMAIS magasin_ponte", async () => {
  // ⚠️ CE CAS EST TESTÉ SUR LE COMPORTEMENT, PAS SUR LE TEXTE DU FICHIER. Une
  // première version de ce test lisait la source et comparait deux `indexOf` ;
  // en supprimant la garde, `indexOf` rendait −1, la comparaison restait vraie,
  // et le sabotage passait au VERT. Le test avait l'air sévère et ne l'était
  // pas. On appelle donc la vraie fonction, avec un faux client.
  const client = (reponse: { data: unknown; error: unknown }) =>
    ({
      from: () => ({
        select: () => ({ eq: () => ({ maybeSingle: async () => reponse }) }),
      }),
    }) as unknown as Parameters<typeof lireCouvertureDuMagasinChoisi>[0];

  const magasin = (opLocationId: unknown) => ({
    data: {
      store_id: "33333333-3333-4333-8333-333333333333",
      stores: { op_location_id: opLocationId, osm_type: "NODE", osm_id: 9928912836 },
    },
    error: null,
  });

  const lire = (reponse: { data: unknown; error: unknown }) =>
    lireCouvertureDuMagasinChoisi(client(reponse), "eleve");

  // ── Le cas nominal, pour que les refus ci-dessous veuillent dire quelque chose.
  const ponte = await lire(magasin(4877));
  assert.equal(ponte.etat, "magasin_ponte");
  if (ponte.etat !== "magasin_ponte") throw new Error("état inattendu");
  assert.equal(ponte.opLocationId, 4877);
  assert.equal(ponte.osmType, "NODE");
  assert.equal(ponte.osmId, 9928912836);

  // ── Un `bigint` arrivé en chaîne : PostgREST le fait, et c'est un pont valide.
  const chaine = await lire(magasin("4877"));
  assert.equal(chaine.etat, "magasin_ponte");

  // ── TOUT identifiant douteux devient « sans couverture », JAMAIS un pont.
  // ⚠️ Le fabriquer à 0 enverrait une requête Open Prices sur le lieu de
  // personne, et l'écran présenterait le résultat comme celui du magasin choisi.
  for (const douteux of [null, undefined, 0, -1, 1.5, "abc", "", 2 ** 53, Number.NaN, {}, true]) {
    const r = await lire(magasin(douteux));
    assert.equal(
      r.etat,
      "magasin_sans_couverture_prix",
      `op_location_id ${String(douteux)} ne doit pas produire de pont`,
    );
  }

  // ── Une panne, ou aucune sélection : `aucun_magasin`, et surtout pas un pont.
  assert.equal((await lire({ data: null, error: null })).etat, "aucun_magasin");
  assert.equal((await lire({ data: null, error: { message: "boom" } })).etat, "aucun_magasin");
  // ⚠️ UNE ERREUR AVEC DES DONNÉES EST ENCORE UNE ERREUR. PostgREST peut rendre
  // les deux ; s'en remettre aux données « puisqu'elles sont là » reviendrait à
  // interroger Open Prices sur le résultat d'une requête qui a échoué. Ce cas
  // manquait au premier jet, et un sabotage retirant `error ||` est passé au
  // VERT — c'est lui qui l'a fait écrire.
  assert.equal(
    (await lire({ ...magasin(4877), error: { message: "boom" } })).etat,
    "aucun_magasin",
  );
  assert.equal((await lire({ data: { store_id: "x", stores: null }, error: null })).etat, "aucun_magasin");

  // ── Une identité OSM inexploitable : on n'invente pas de magasin.
  for (const identite of [
    { osm_type: "area", osm_id: 1 },
    { osm_type: "NODE", osm_id: 0 },
    { osm_type: "NODE", osm_id: 2 ** 53 },
    { osm_type: null, osm_id: 5 },
  ]) {
    const r = await lire({
      data: { store_id: "s", stores: { op_location_id: 4877, ...identite } },
      error: null,
    });
    assert.equal(r.etat, "aucun_magasin", `identité ${JSON.stringify(identite)} refusée`);
  }
});

await test("COUV-11 — C4.4 porte bien SEPT états, ni six ni huit", () => {
  const decl = /export type EtatPrixObserves =([\s\S]*?);/.exec(C4_4);
  assert.ok(decl !== null, "la déclaration doit être trouvable");
  const etats = [...decl[1]!.matchAll(/"([a-z_]+)"/g)].map((m) => m[1]);
  assert.deepEqual(etats.sort(), [
    "aucun_magasin",
    "aucun_produit_relie",
    "aucun_releve",
    "indetermine",
    "indisponible",
    "magasin_sans_couverture_prix",
    "releves",
  ]);
});

// ════════════════════════════════════════════════════════════════════════════
// Z. LES CAS CHOISIS POUR CASSER LE CODE, PAS POUR LE CONFIRMER
//
// ⚠️ CETTE SECTION EXISTE PARCE QUE LA SUITE A ÉTÉ ÉCRITE APRÈS LE MODULE.
// Écrits en connaissance de l'implémentation, les cas A–C ci-dessus risquaient
// de n'en être que le reflet. Ceux-ci ont été choisis à l'inverse : chacun vise
// une façon plausible de se tromper.
// ════════════════════════════════════════════════════════════════════════════

await test("Z-01 — un magasin sans nom est écarté, et aucun nom n'est fabriqué", () => {
  assert.equal(normaliserElementOsm(noeud({ shop: "supermarket" })), null, "sans name");
  assert.equal(normaliserElementOsm(noeud({ shop: "supermarket", name: "   " })), null, "un nom blanc n'est pas un nom");
  // La tentation exacte : « Magasin #9928912836 ». Elle donnerait à l'élève une
  // ligne qu'il ne peut ni reconnaître ni choisir, et ferait entrer dans un
  // référentiel PARTAGÉ un libellé que personne n'a écrit.
  const nu = sansCommentaires(PUR);
  assert.equal(/Magasin\s*#|`Magasin|Sans nom|Commerce\s*#/i.test(nu), false, "aucun nom de repli");
});

await test("Z-02 — un identifiant non entier sûr est refusé", () => {
  // ⚠️ `Number.isSafeInteger`, jamais `Number.isInteger` : au-delà de 2⁵³−1,
  // `JSON.parse` arrondit EN SILENCE, et l'on écrirait dans `stores`
  // l'identifiant de quelqu'un d'autre.
  for (const id of [0, -1, 1.5, Number.NaN, 2 ** 53, "9928912836", null, undefined]) {
    assert.equal(
      normaliserElementOsm(noeud({ shop: "supermarket", name: "X" }, { id })),
      null,
      `id ${String(id)} doit être refusé`,
    );
  }
  assert.ok(/isSafeInteger/.test(PUR), "la garde doit être isSafeInteger");
  assert.equal(/Number\.isInteger\(/.test(sansCommentaires(PUR)), false, "isInteger seul ne suffit pas");
});

await test("Z-03 — des coordonnées hors bornes sont refusées", () => {
  const cas: ReadonlyArray<Partial<ElementOverpass>> = [
    { lat: 91, lon: 5.9 },
    { lat: -91, lon: 5.9 },
    { lat: 43.1, lon: 181 },
    { lat: 43.1, lon: -181 },
    { lat: Number.NaN, lon: 5.9 },
    { lat: Number.POSITIVE_INFINITY, lon: 5.9 },
    { lat: "43.1", lon: 5.9 },
  ];
  for (const surcharge of cas) {
    assert.equal(
      normaliserElementOsm(noeud({ shop: "supermarket", name: "X" }, surcharge)),
      null,
      `coordonnées ${JSON.stringify(surcharge)} refusées`,
    );
  }
  // Mais 0/0 reste une coordonnée VALIDE si OSM l'affirme : nous refusons de
  // l'INVENTER, pas de la lire.
  const golfe = retenu(noeud({ shop: "supermarket", name: "Null Island" }, { lat: 0, lon: 0 }), "0/0 déclaré");
  assert.equal(golfe.lat, 0);
  assert.equal(golfe.lon, 0);
});

await test("Z-04 — le type OSM est traduit une seule fois, et borné", () => {
  // Overpass écrit en minuscules ; `stores_osm_type_check` exige des majuscules ;
  // Open Prices attend le type dans l'URL du pont. Une seule traduction.
  assert.equal(typeOsmDepuis("node"), "NODE");
  assert.equal(typeOsmDepuis("WAY"), "WAY");
  assert.equal(typeOsmDepuis("  relation  "), "RELATION");
  for (const mauvais of ["area", "changeset", "", "nodes", 1, null, undefined, {}]) {
    assert.equal(typeOsmDepuis(mauvais), null, `${String(mauvais)} n'est pas un type OSM`);
  }
  assert.equal(normaliserElementOsm({ type: "area", id: 5, lat: 43, lon: 5, tags: { shop: "supermarket", name: "X" } }), null);
});

await test("Z-05 — un wikidata mal formé est refusé, jamais stocké « au cas où »", () => {
  for (const bon of ["Q42", "Q151954", "Q1"]) {
    assert.equal(identifiantWikidataValide(bon), true, `${bon} est une forme valide`);
  }
  for (const mauvais of ["Q0", "Q042", "42", "q42", "Q", "Q-1", "Q4 2", "Qabc", "", " ", null, 42, {}]) {
    assert.equal(identifiantWikidataValide(mauvais), false, `${String(mauvais)} n'est pas une forme valide`);
  }
  // Et un tag malformé ne contamine pas la fiche : il vaut `null`, il ne la rejette pas.
  const m = retenu(
    noeud({ shop: "supermarket", name: "X", "brand:wikidata": "carrefour", "operator:wikidata": "Q042" }),
    "tags wikidata malformés",
  );
  assert.equal(m.brandWikidata, null);
  assert.equal(m.operatorWikidata, null);
  assert.equal(m.name, "X", "le magasin reste exploitable");
});

await test("Z-06 — la catégorie vient du tag, jamais du nom", () => {
  // Le nom crie « supermarché » ; le tag dit « coiffeur ». Le tag gagne.
  assert.equal(normaliserElementOsm(noeud({ shop: "hairdresser", name: "Supermarché Coiffure" })), null);
  assert.equal(normaliserElementOsm(noeud({ name: "Carrefour Market" })), null, "sans shop, on ne sait pas");
  // Un tag sale reste lisible — un espace ou une majuscule n'est pas un refus.
  assert.equal(estCommerceAlimentaireOsm({ shop: "  SuperMarket " }), true);
  // ⚠️ ET AUCUNE ENSEIGNE N'EST ÉCRITE DANS LE MODULE. Un test de nom marche sur
  // les exemples qu'on a sous les yeux et échoue sur le reste du pays.
  const nu = sansCommentaires(PUR);
  for (const enseigne of [
    "Carrefour", "Lidl", "Auchan", "Leclerc", "Intermarché", "Intermarche",
    "Casino", "Monoprix", "Franprix", "Naturalia", "Biocoop", "Aldi", "Super U", "Picard",
  ]) {
    assert.equal(
      new RegExp(enseigne, "i").test(nu),
      false,
      `aucune enseigne ne doit être codée en dur : ${enseigne}`,
    );
  }
});

await test("Z-07 — la découverte ne connaît pas Open Prices", () => {
  // ⚠️ LE PONT SE FAIT À LA SÉLECTION, PAS À LA DÉCOUVERTE. Porter un
  // `opLocationId` ici obligerait à interroger Open Prices une fois par
  // résultat — cinquante appels pour afficher une liste — et à décider quoi
  // faire des quarante-neuf lieux qui n'y sont pas.
  const m = retenu(noeud({ shop: "supermarket", name: "Naturalia" }), "magasin");
  assert.equal(Object.prototype.hasOwnProperty.call(m, "opLocationId"), false);
  const nu = sansCommentaires(PUR);
  assert.equal(/opLocationId|op_location_id|openprices|open-prices/i.test(nu), false, "aucun couplage Open Prices");
  assert.equal(/price|prix/i.test(nu), false, "la découverte ne parle pas de prix");
});

// ════════════════════════════════════════════════════════════════════════════
// PÉRIMÈTRE
// ════════════════════════════════════════════════════════════════════════════

await test("PERIMETRE-C4.3c — le module OSM ne parle à personne", () => {
  const nu = sansCommentaires(PUR);
  for (const motif of [
    /fetch\(/,
    // ⚠️ LE NOM `ElementOverpass` EST LÉGITIME — il décrit la FORME de l'entrée,
    // pas un appel. Ce qui est interdit ici, c'est de PARLER à Overpass : une
    // URL, un point d'entrée, un hôte. On bannit donc le réseau, pas le mot.
    /overpass-api|overpass\.|\/interpreter|https?:\/\//i,
    /@\/lib\/supabase/,
    /@\/lib\/open-prices/,
    /@\/lib\/open-food-facts/,
    /openfoodfacts/i,
    /server-only/,
    /\.insert\(/,
    /\.update\(/,
    /\.upsert\(/,
    /\.delete\(/,
    /\.rpc\(/,
    /budget/i,
    /console\./,
    /process\.env/,
  ]) {
    assert.equal(motif.test(nu), false, `la couche pure C4.3c ne doit pas porter ${motif}`);
  }
});


/* ══════════════════════════════════════════════════════════════════════════
   LA MARQUE AFFICHÉE — LE DÉFAUT « LidlLidl »
   ══════════════════════════════════════════════════════════════════════════ */

await test("OSM-MARQUE — une marque qui répète le nom ne s'affiche pas deux fois", () => {
  // ⚠️ LE DÉFAUT MESURÉ EN PREVIEW. L'écran rendait `name` puis `brand`, sans
  // séparateur, et OpenStreetMap porte très souvent les DEUX avec la même
  // valeur : un Lidl s'appelle Lidl, et sa marque est Lidl. L'élève lisait
  // « LidlLidl ». Ce n'est pas un problème de mise en page — c'est une
  // information affichée deux fois.
  assert.equal(marqueAAfficher("Lidl", "Lidl"), null);
  assert.equal(marqueAAfficher("E.Leclerc", "E.Leclerc"), null);
  assert.equal(marqueAAfficher("Carrefour", "Carrefour"), null);

  // ⚠️ ET LA MARQUE N'EST PAS SUPPRIMÉE POUR AUTANT. « Carrefour Market » de
  // marque « Carrefour » dit deux choses différentes : l'enseigne du groupe et
  // le format du magasin. Effacer la seconde parce qu'elle RESSEMBLE à la
  // première ferait disparaître une information vraie — c'est exactement ce
  // qu'une règle « plus maligne » (préfixe, distance d'édition) produirait.
  assert.equal(marqueAAfficher("Carrefour Market", "Carrefour"), "Carrefour");
  assert.equal(marqueAAfficher("Carrefour City", "Carrefour"), "Carrefour");
  assert.equal(marqueAAfficher("Naturalia", "Monoprix"), "Monoprix");

  // Casse et espaces de bord : la source est saisie à la main, elle varie.
  assert.equal(marqueAAfficher("Lidl", "lidl"), null);
  assert.equal(marqueAAfficher("LIDL", "Lidl"), null);
  assert.equal(marqueAAfficher(" Lidl ", "Lidl"), null);
  assert.equal(marqueAAfficher("Lidl", "  Lidl  "), null);
  assert.equal(marqueAAfficher("Casino Shop", "  Casino  "), "Casino", "la valeur rendue est nettoyée");

  // Rien à afficher quand il n'y a rien.
  for (const vide of [null, undefined, "", "   ", "\t\n"]) {
    assert.equal(marqueAAfficher("Lidl", vide as string | null), null, JSON.stringify(vide));
  }

  // ⚠️ ET AUCUN DÉPOUILLEMENT DES ACCENTS. « Casino » et « Cásino » ne sont pas
  // le même mot ; les rapprocher masquerait une vraie différence de saisie chez
  // la source, et nous n'avons aucune raison de trancher à sa place.
  assert.equal(marqueAAfficher("Casino", "Cásino"), "Cásino");
});

await test("OSM-MARQUE-UI — l'écran APPELLE la règle, il ne la réécrit pas", () => {
  // ⚠️ UNE RÈGLE RECOPIÉE DANS LE JSX SERAIT UNE SECONDE RÈGLE. Elle
  // divergerait de celle-ci au premier ajustement, et c'est précisément ce que
  // la fonction pure existe pour empêcher.
  const ui = lire("../../components/student/ChoixMagasinProche.tsx").replace(/\/\*[\s\S]*?\*\//g, " ");
  assert.match(ui, /marqueAAfficher\(magasin\.name, magasin\.brand\)/, "l'écran appelle la règle pure");
  assert.equal(
    /\{magasin\.brand \?/.test(ui),
    false,
    "l'ancien rendu direct de la marque ne doit plus exister",
  );
  assert.equal(
    /toLowerCase\(\)/.test(ui),
    false,
    "aucune comparaison de marque réécrite dans le composant",
  );
});

console.log("\n✅ C4.3c — couche pure OpenStreetMap : suite verte.");
