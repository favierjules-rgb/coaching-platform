/**
 * Harnais — COURSES C4.3c : L'ÉCRITURE D'UN MAGASIN PAR SON IDENTITÉ OSM.
 *
 * ────────────────────────────────────────────────────────────────────────────
 * CE QUE CE FICHIER PROUVE
 * ────────────────────────────────────────────────────────────────────────────
 * Que la clé canonique est le COUPLE `(osm_type, osm_id)` et jamais
 * `op_location_id` ; qu'un pont connu n'est JAMAIS effacé parce qu'une lecture
 * a échoué ; qu'un 404 et une panne ne produisent pas la même écriture ; qu'une
 * divergence d'identité se refuse au lieu de se résoudre en silence ; et qu'un
 * tag absent aujourd'hui ne détruit pas une valeur connue hier.
 *
 * ⚠️ AUCUNE BASE RÉELLE. Le client est simulé, en mémoire.
 *
 * Lancement : npm run test:upsert-osm-c4-3c
 */
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

import type { MagasinOsm } from "../../lib/nutrition/magasins-osm";
import { type PontConnu, upserterMagasinOsm } from "../../lib/supabase/magasins-osm";

const lire = (chemin: string) => readFileSync(new URL(chemin, import.meta.url), "utf8");
const ECRITURE = lire("../../lib/supabase/magasins-osm.ts");

function sansCommentaires(source: string): string {
  return source.replace(/\/\*[\s\S]*?\*\//g, " ").replace(/(^|[^:])\/\/.*$/gm, "$1 ");
}

/* ── Une base simulée, minuscule et honnête ──────────────────────────────── */

type Ligne = Record<string, unknown>;

/**
 * ⚠️ ELLE N'IMITE QUE CE QUE LE CODE UTILISE — et elle échoue bruyamment sur
 * tout le reste. Une fausse base trop complaisante laisserait passer une
 * requête que la vraie refuserait.
 */
function fausseBase(initiales: readonly Ligne[]) {
  const table: Ligne[] = initiales.map((l) => ({ ...l }));
  const journal: Array<{ op: string; charge?: Ligne; id?: unknown }> = [];
  let idSuivant = 100;
  let erreurAInjecter: { message: string; code?: string } | null = null;

  const constructeur = () => {
    const filtres: Array<[string, unknown]> = [];
    let action: "select" | "insert" | "update" = "select";
    let charge: Ligne | null = null;

    const chaine = {
      select() {
        return chaine;
      },
      eq(colonne: string, valeur: unknown) {
        filtres.push([colonne, valeur]);
        if (action === "update") return finaliser();
        return chaine;
      },
      insert(valeurs: Ligne) {
        action = "insert";
        charge = valeurs;
        return chaine;
      },
      update(valeurs: Ligne) {
        action = "update";
        charge = valeurs;
        return chaine;
      },
      maybeSingle() {
        return finaliser();
      },
      then(resoudre: (v: unknown) => unknown) {
        return Promise.resolve(finaliser()).then(resoudre);
      },
    };

    function correspond(l: Ligne): boolean {
      return filtres.every(([c, v]) => l[c] === v);
    }

    function finaliser() {
      if (erreurAInjecter !== null) {
        const e = erreurAInjecter;
        erreurAInjecter = null;
        journal.push({ op: `${action}:erreur` });
        return Promise.resolve({ data: null, error: e });
      }
      if (action === "insert") {
        const ligne = { id: `store-${idSuivant++}`, ...charge };
        table.push(ligne);
        journal.push({ op: "insert", charge: charge ?? {} });
        return Promise.resolve({ data: { id: ligne["id"] }, error: null });
      }
      if (action === "update") {
        const cible = table.find(correspond);
        if (cible) Object.assign(cible, charge);
        journal.push({ op: "update", charge: charge ?? {}, id: filtres[0]?.[1] });
        return Promise.resolve({ data: null, error: null });
      }
      const trouvee = table.find(correspond) ?? null;
      journal.push({ op: "select" });
      return Promise.resolve({ data: trouvee, error: null });
    }

    return chaine;
  };

  return {
    client: { from: () => constructeur() } as unknown as Parameters<typeof upserterMagasinOsm>[0],
    table,
    journal,
    injecterErreur(e: { message: string; code?: string }) {
      erreurAInjecter = e;
    },
    ecritures: () => journal.filter((j) => j.op === "insert" || j.op === "update"),
  };
}

/* ── Fixtures ────────────────────────────────────────────────────────────── */

const NATURALIA: MagasinOsm = {
  osmType: "NODE",
  osmId: 9928912836,
  name: "Naturalia",
  brand: "Naturalia",
  brandWikidata: "Q3336090",
  operatorWikidata: null,
  city: "Toulon",
  postcode: "83000",
  countryCode: "FR",
  lat: 43.1242,
  lon: 5.928,
  distanceKm: null,
};

const PONTE: PontConnu = { statut: "ponte", opLocationId: 4877 };
const ABSENT: PontConnu = { statut: "absent" };
const INDETERMINE: PontConnu = { statut: "indetermine" };

const ligneExistante = (surcharge: Ligne = {}): Ligne => ({
  id: "store-1",
  osm_type: "NODE",
  osm_id: 9928912836,
  op_location_id: null,
  name: "Naturalia",
  brand: "Naturalia",
  brand_wikidata: null,
  operator_wikidata: null,
  city: "Toulon",
  postcode: "83000",
  country_code: "FR",
  lat: 43.1242,
  lon: 5.928,
  ...surcharge,
});

// ════════════════════════════════════════════════════════════════════════════
// CAS 1 — L'IDENTITÉ OSM EST INCONNUE : ON INSÈRE
// ════════════════════════════════════════════════════════════════════════════

await test("UPS-cas1 — magasin inconnu, sans pont prouvé → insertion avec op_location_id NULL", async () => {
  const base = fausseBase([]);
  const r = await upserterMagasinOsm(base.client, NATURALIA, ABSENT);

  assert.equal(r.divergence, false);
  assert.equal(r.erreur, null);
  assert.ok(r.storeId !== null, "un identifiant doit être rendu");

  const insere = base.journal.find((j) => j.op === "insert")!.charge!;
  assert.equal(insere["osm_type"], "NODE");
  assert.equal(insere["osm_id"], 9928912836);
  // ⚠️ `null`, ET C'EST TOUT L'OBJET DE LA MIGRATION C4.3c. Avant elle, la
  // colonne était NOT NULL : ce magasin — réel, cartographié, choisi — n'aurait
  // simplement PAS PU entrer dans le référentiel.
  assert.equal(insere["op_location_id"], null);
  assert.equal(insere["brand_wikidata"], "Q3336090");
  assert.equal(insere["name"], "Naturalia");
});

await test("UPS-cas1b — magasin inconnu, pont prouvé → insertion avec l'identifiant amont", async () => {
  const base = fausseBase([]);
  const r = await upserterMagasinOsm(base.client, NATURALIA, PONTE);
  assert.equal(r.opLocationId, 4877);
  assert.equal(base.journal.find((j) => j.op === "insert")!.charge!["op_location_id"], 4877);
});

await test("UPS-cas1c — magasin inconnu, pont indéterminé → insertion SANS pont, jamais 0", async () => {
  const base = fausseBase([]);
  const r = await upserterMagasinOsm(base.client, NATURALIA, INDETERMINE);
  assert.equal(r.erreur, null);
  assert.ok(r.storeId !== null, "une panne du pont n'empêche pas d'enregistrer le magasin");
  assert.equal(base.journal.find((j) => j.op === "insert")!.charge!["op_location_id"], null);
});

// ════════════════════════════════════════════════════════════════════════════
// CAS 2 — ENRICHISSEMENT
// ════════════════════════════════════════════════════════════════════════════

await test("UPS-cas2/46 — pont NULL + pont prouvé → enrichissement", async () => {
  const base = fausseBase([ligneExistante({ op_location_id: null })]);
  const r = await upserterMagasinOsm(base.client, NATURALIA, PONTE);

  assert.equal(r.storeId, "store-1", "l'identité OSM retrouve SA ligne");
  assert.equal(r.divergence, false);
  const maj = base.journal.find((j) => j.op === "update")!.charge!;
  assert.equal(maj["op_location_id"], 4877, "le pont est ajouté");
  assert.equal(base.table[0]!["op_location_id"], 4877);
  // ⚠️ ET L'IDENTITÉ N'EST JAMAIS RÉÉCRITE. Les colonnes OSM sont absentes de
  // la mise à jour : il n'existe aucun chemin par lequel une identité
  // divergente pourrait être « corrigée » en passant.
  assert.equal("osm_type" in maj, false);
  assert.equal("osm_id" in maj, false);
});

// ════════════════════════════════════════════════════════════════════════════
// CAS 3 & 4 — UN PONT CONNU NE S'EFFACE PAS
// ════════════════════════════════════════════════════════════════════════════

await test("UPS-cas3/47 — pont connu + 404 amont → le pont connu est CONSERVÉ", async () => {
  const base = fausseBase([ligneExistante({ op_location_id: 4877 })]);
  const r = await upserterMagasinOsm(base.client, NATURALIA, ABSENT);

  assert.equal(r.divergence, false);
  assert.equal(r.opLocationId, 4877);
  assert.equal(base.table[0]!["op_location_id"], 4877, "jamais effacé");
  for (const e of base.ecritures()) {
    assert.equal("op_location_id" in (e.charge ?? {}), false, "le pont n'est même pas réécrit");
  }
});

await test("UPS-cas4/64 — pont connu + panne amont → le pont connu est CONSERVÉ", async () => {
  const base = fausseBase([ligneExistante({ op_location_id: 4877 })]);
  const r = await upserterMagasinOsm(base.client, NATURALIA, INDETERMINE);

  assert.equal(r.opLocationId, 4877);
  assert.equal(base.table[0]!["op_location_id"], 4877);
  // ⚠️ UN 404 ET UNE PANNE NE SONT PAS ÉQUIVALENTS — mais ici ils produisent
  // volontairement la MÊME écriture : aucune. La différence entre les deux se
  // joue ailleurs (ce qu'on affiche), jamais sur la destruction d'une donnée.
  for (const e of base.ecritures()) {
    assert.equal("op_location_id" in (e.charge ?? {}), false);
  }
});

// ════════════════════════════════════════════════════════════════════════════
// CAS 5 — DIVERGENCE : ON REFUSE, ON NE TRANCHE PAS
// ════════════════════════════════════════════════════════════════════════════

await test("UPS-cas5/48 — l'identifiant amont appartient à une AUTRE identité OSM → divergence", async () => {
  const base = fausseBase([
    ligneExistante({ id: "store-1", op_location_id: null }),
    {
      id: "store-2",
      osm_type: "WAY",
      osm_id: 274420431,
      op_location_id: 4877,
      name: "Un autre magasin",
    },
  ]);
  const r = await upserterMagasinOsm(base.client, NATURALIA, PONTE);

  // ⚠️ DEUX LIGNES, UN SEUL `op_location_id` : la contrainte UNIQUE de C4.2
  // refuserait de toute façon. Mais échouer sur une contrainte donnerait une
  // erreur technique illisible ; on nomme le problème AVANT de l'écrire.
  assert.equal(r.divergence, true);
  assert.equal(r.storeId, null);
  assert.deepEqual(base.ecritures(), [], "AUCUNE mutation silencieuse");
});

await test("UPS-cas5b — un pont qui contredit celui déjà connu → divergence", async () => {
  const base = fausseBase([ligneExistante({ op_location_id: 1111 })]);
  const r = await upserterMagasinOsm(base.client, NATURALIA, { statut: "ponte", opLocationId: 4877 });

  // Le remplacer silencieusement changerait les PRIX d'un magasin que des
  // élèves ont déjà choisi, sans que rien ne l'annonce.
  assert.equal(r.divergence, true);
  assert.deepEqual(base.ecritures(), []);
});

await test("UPS-cas5c — le même pont déjà en place n'est PAS une divergence", async () => {
  const base = fausseBase([ligneExistante({ op_location_id: 4877 })]);
  const r = await upserterMagasinOsm(base.client, NATURALIA, PONTE);
  assert.equal(r.divergence, false);
  assert.equal(r.storeId, "store-1");
});

// ════════════════════════════════════════════════════════════════════════════
// CAS 6 — LES MÉTADONNÉES SE RAFRAÎCHISSENT SANS SE DÉTRUIRE
// ════════════════════════════════════════════════════════════════════════════

await test("UPS-cas6/65 — un tag absent aujourd'hui n'efface pas la valeur connue hier", async () => {
  const base = fausseBase([
    ligneExistante({
      brand: "Naturalia",
      brand_wikidata: "Q3336090",
      city: "Toulon",
      postcode: "83000",
    }),
  ]);

  // OSM a perdu la marque, le wikidata et le code postal — un contributeur les
  // a retirés, ou l'export est partiel.
  const appauvri: MagasinOsm = {
    ...NATURALIA,
    name: "Naturalia Mourillon",
    brand: null,
    brandWikidata: null,
    postcode: null,
    city: "Toulon",
  };
  await upserterMagasinOsm(base.client, appauvri, ABSENT);

  const l = base.table[0]!;
  // ⚠️ CE QUI EST CONNU AUJOURD'HUI REMPLACE : le nom a changé, il change.
  assert.equal(l["name"], "Naturalia Mourillon");
  // ⚠️ CE QUI EST ABSENT AUJOURD'HUI NE DÉTRUIT PAS. Un tag manquant n'est pas
  // une information : c'est une absence d'information. Écraser « Naturalia »
  // par `null` ferait perdre à TOUS les élèves une donnée que personne n'a
  // décidé de retirer. La suppression volontaire d'une marque dans OSM mérite
  // une doctrine explicite — elle n'existe pas encore, on ne l'invente pas ici.
  assert.equal(l["brand"], "Naturalia", "la marque connue survit");
  assert.equal(l["brand_wikidata"], "Q3336090", "l'identifiant d'enseigne survit");
  assert.equal(l["postcode"], "83000", "le code postal survit");

  const maj = base.journal.find((j) => j.op === "update")!.charge!;
  assert.equal("brand" in maj, false, "on n'écrit même pas la colonne");
  assert.equal("brand_wikidata" in maj, false);
});

await test("UPS-cas6b — une métadonnée nouvelle est bien écrite", async () => {
  const base = fausseBase([ligneExistante({ brand_wikidata: null, operator_wikidata: null })]);
  await upserterMagasinOsm(
    base.client,
    { ...NATURALIA, operatorWikidata: "Q151954" },
    ABSENT,
  );
  assert.equal(base.table[0]!["brand_wikidata"], "Q3336090");
  assert.equal(base.table[0]!["operator_wikidata"], "Q151954");
});

// ════════════════════════════════════════════════════════════════════════════
// ROBUSTESSE
// ════════════════════════════════════════════════════════════════════════════

await test("UPS-erreur — une panne de base est remontée, jamais avalée", async () => {
  const base = fausseBase([]);
  base.injecterErreur({ message: "connexion perdue" });
  const r = await upserterMagasinOsm(base.client, NATURALIA, ABSENT);
  assert.equal(r.storeId, null);
  assert.equal(r.erreur, "connexion perdue");
  assert.equal(r.divergence, false, "une panne n'est pas une divergence d'identité");
});

await test("UPS-perimetre — la clé canonique est l'identité OSM, jamais l'identifiant amont", () => {
  const nu = sansCommentaires(ECRITURE);
  // La lecture d'entrée se fait sur le COUPLE.
  assert.ok(/\.eq\("osm_type"/.test(nu) && /\.eq\("osm_id"/.test(nu), "lecture par identité OSM");
  // ⚠️ ET AUCUN `upsert` POSTGREST AVEC `onConflict`. Il choisirait tout seul
  // quoi écraser, y compris un pont connu — exactement ce que les cas 3 et 4
  // interdisent.
  assert.equal(/\.upsert\(/.test(nu), false, "aucun upsert aveugle");
  assert.equal(/onConflict/.test(nu), false);
  assert.equal(/\.delete\(/.test(nu), false, "rien n'est supprimé");
  // Et le module n'appelle personne : il reçoit le pont déjà établi.
  for (const motif of [/fetch\(/, /open-prices/i, /overpass/i, /interrogerOverpass/]) {
    assert.equal(motif.test(nu), false, `l'écriture n'appelle personne : ${motif}`);
  }
});

console.log("\n✅ C4.3c — écriture par identité OSM : suite verte.");
