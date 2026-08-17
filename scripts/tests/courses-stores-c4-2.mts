/**
 * Harnais — COURSES C4.2 : LE MODÈLE DU MAGASIN, ET LE MAGASIN CHOISI.
 *
 * ────────────────────────────────────────────────────────────────────────────
 * CE QUE CE FICHIER PROUVE
 * ────────────────────────────────────────────────────────────────────────────
 * Que l'identité d'un magasin est empruntée à ses sources — l'identifiant
 * Open Prices et le couple OpenStreetMap — et jamais fabriquée par nous ; que
 * « un seul magasin actif par élève » est une CLÉ PRIMAIRE et non une règle
 * applicative ; que le catalogue canonique est fermé à l'écriture cliente ;
 * et que ce lot n'a introduit NI prix, NI disponibilité, NI géolocalisation,
 * NI le moindre appel réseau.
 *
 * ────────────────────────────────────────────────────────────────────────────
 * CE QU'IL NE PROUVE PAS, ET QUI LE PROUVE À SA PLACE
 * ────────────────────────────────────────────────────────────────────────────
 * Il lit le TEXTE de la migration. Il ne dit RIEN de ce qu'un rôle est
 * réellement capable de faire : la RLS, les clés étrangères et l'unicité se
 * jouent sur un vrai PostgreSQL, et c'est le rôle de
 * `supabase/tests/courses_c4_2_magasins_checklist.sql`. Un test statique qui
 * prétendrait le contraire serait un faux vert.
 *
 * ⚠️ AUCUN ACCÈS RÉSEAU, AUCUNE BASE, AUCUNE FIXTURE OPEN PRICES. C4.2 ne
 * parle à personne : c'est C4.3a qui fera entrer un magasin dans la table.
 *
 * Lancement : npm run test:courses-stores-c4-2
 */
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { existsSync, readFileSync, readdirSync } from "node:fs";
import test from "node:test";

import {
  MIGRATION_C4_2,
  verifierContratDesMigrations,
  verifierManifesteDesMigrations,
} from "./contrat-migrations.mjs";

const lire = (chemin: string) => readFileSync(new URL(chemin, import.meta.url), "utf8");

/**
 * ⚠️ LECTURE TOLÉRANTE, ET C'EST LE MÉCANISME DU ROUGE INITIAL. En TDD, ce
 * fichier existe AVANT la migration : une lecture stricte lèverait `ENOENT` au
 * chargement du module et tuerait la suite entière, ne montrant qu'une seule
 * erreur illisible. Ici, chaque contrôle rougit SÉPARÉMENT et NOMME ce qui
 * manque. La toute première assertion, C4.2-01, dit explicitement que le
 * fichier est absent — c'est le rouge attendu, pas un contournement.
 */
function lireOuVide(chemin: string): string {
  const url = new URL(chemin, import.meta.url);
  return existsSync(url) ? readFileSync(url, "utf8") : "";
}

const CHEMIN_MIGRATION = `../../supabase/migrations/${MIGRATION_C4_2}`;
const CHEMIN_CHECKLIST = "../../supabase/tests/courses_c4_2_magasins_checklist.sql";

const MIGRATION = lireOuVide(CHEMIN_MIGRATION);
const CHECKLIST = lireOuVide(CHEMIN_CHECKLIST);

/** Retire les commentaires `--` ET les `comment on … is '…'`, puis les littéraux. */
function sqlNu(source: string): string {
  return source
    .replace(/--.*$/gm, " ")
    .replace(/comment on [\s\S]*?';/gi, " ")
    .replace(/'[^']*'/g, "''");
}

const CODE = sqlNu(MIGRATION);

/**
 * ⚠️ SECOND DÉPOUILLEMENT, ET IL N'EST PAS REDONDANT. `sqlNu` retire les
 * littéraux entre apostrophes — or le gabarit d'installation d'un trigger du
 * dépôt passe par `execute '…'`. Tout ce que ce gabarit contient serait donc
 * INVISIBLE au balayage, y compris son `drop trigger`. Cette version conserve
 * les littéraux et ne retire que la prose.
 */
const SANS_PROSE = MIGRATION.replace(/--.*$/gm, " ").replace(/comment on [\s\S]*?';/gi, " ");

const empreinte = (source: string) => createHash("sha256").update(source).digest("hex").slice(0, 16);

/* ══════════════════════════════════════════════════════════════════════════
   A — LA MIGRATION EXISTE, ET ELLE NE CRÉE QUE DEUX TABLES
   ══════════════════════════════════════════════════════════════════════════ */

await test("C4.2-01 — la migration et sa checklist existent", () => {
  assert.notEqual(MIGRATION, "", `migration absente : supabase/migrations/${MIGRATION_C4_2}`);
  assert.notEqual(CHECKLIST, "", "checklist absente : supabase/tests/courses_c4_2_magasins_checklist.sql");
});

await test("C4.2-02 — EXACTEMENT deux tables créées : stores et student_selected_store", () => {
  const tables = [...MIGRATION.matchAll(/create table if not exists public\.(\w+)/gi)].map((m) => m[1]);
  assert.deepEqual(
    tables,
    ["stores", "student_selected_store"],
    "C4.2 ne doit créer QUE le référentiel des magasins et la sélection de l'élève",
  );
  // Et elle est ADDITIVE : elle ne défait rien de ce qui existe.
  assert.ok(!/\bdrop\s+table\b/i.test(CODE), "aucune table supprimée");
  assert.ok(!/\bdrop\s+column\b/i.test(CODE), "aucune colonne supprimée");
  assert.ok(!/\btruncate\b/i.test(CODE), "aucun TRUNCATE");
  assert.ok(!/\binsert\s+into\b/i.test(CODE), "aucune donnée insérée par la migration");
  // Les seuls `drop … if exists` autorisés sont ceux du gabarit de policy, que
  // la migration recrée immédiatement — jamais un objet préexistant.
  // ⚠️ ON BALAIE `SANS_PROSE`, PAS `CODE` : le `drop trigger` du gabarit vit à
  // l'intérieur d'un `execute '…'`, donc dans un littéral. Le chercher sur
  // `CODE` aurait donné un vert qui ne prouve rien.
  const drops = [...SANS_PROSE.matchAll(/drop\s+(\w+)\s+if\s+exists/gi)].map((m) =>
    m[1].toLowerCase(),
  );
  assert.deepEqual(
    [...new Set(drops)].sort(),
    ["policy", "trigger"],
    `drop inattendu : ${drops.join(", ")}`,
  );
  // ⚠️ AUCUNE TABLE EXISTANTE N'EST ALTÉRÉE. Le seul `alter table` autorisé
  // est l'activation de la RLS sur les deux tables neuves.
  const alteres = [...CODE.matchAll(/alter table public\.(\w+)/gi)].map((m) => m[1]);
  assert.deepEqual(
    [...new Set(alteres)].sort(),
    ["stores", "student_selected_store"],
    `une table hors périmètre est altérée : ${alteres.join(", ")}`,
  );
});

/* ══════════════════════════════════════════════════════════════════════════
   B — L'IDENTITÉ DU MAGASIN EST EMPRUNTÉE, JAMAIS FABRIQUÉE
   ══════════════════════════════════════════════════════════════════════════ */

await test("C4.2-03 — clé primaire interne en uuid, sur le gabarit du dépôt", () => {
  assert.match(
    CODE,
    /id uuid primary key default gen_random_uuid\(\)/i,
    "la PK interne doit suivre la convention du dépôt (uuid + gen_random_uuid)",
  );
});

await test("C4.2-04 — l'identifiant Open Prices est un BIGINT unique et non nul", () => {
  // ⚠️ C'est l'identifiant que `GET /api/v1/prices?location_id=…` attend. Sans
  // lui, C4.4 n'a aucun moyen de demander les prix d'un magasin.
  //
  // ⚠️ ET IL EST 64 BITS. Le modèle amont ne déclare pas sa clé primaire : elle
  // vient de `DEFAULT_AUTO_FIELD = "django.db.models.BigAutoField"`. Un
  // `integer` marcherait aujourd'hui et déborderait en silence le jour où
  // l'amont dépasse 2 147 483 647. On exige donc le TYPE, nommément — pas
  // « un entier ».
  assert.match(
    CODE,
    /op_location_id bigint not null unique/i,
    "op_location_id doit être BIGINT NOT NULL UNIQUE",
  );
  assert.ok(
    !/op_location_id\s+(integer|int4|int\b|smallint|serial)/i.test(CODE),
    "op_location_id ne doit JAMAIS être déclaré en 32 bits : l'identité amont est un BigAutoField",
  );
  // Et il reste un entier : le passer en `text` perdrait l'ordre et
  // accepterait « 12 » et « 012 » comme deux lieux différents.
  assert.ok(!/op_location_id\s+(text|varchar|uuid)/i.test(CODE), "op_location_id doit rester numérique");
});

await test("C4.2-05 — l'identité OSM est le couple (osm_type, osm_id), et il est unique", () => {
  // Le type et les valeurs viennent du modèle amont, pas d'une supposition :
  // `osm_id` y est un PositiveBigIntegerField, `osm_type` un choix fermé.
  assert.match(CODE, /osm_id bigint not null/i, "osm_id doit être bigint (PositiveBigInteger en amont)");
  assert.match(CODE, /osm_type text not null/i, "osm_type doit être text NOT NULL");
  assert.match(
    CODE,
    /unique \(\s*osm_type\s*,\s*osm_id\s*\)/i,
    "le couple OSM doit porter une contrainte d'unicité",
  );
  // Les trois seules valeurs qu'Open Prices connaît.
  assert.match(
    MIGRATION,
    /check \(\s*osm_type in \('NODE',\s*'WAY',\s*'RELATION'\)\)/i,
    "osm_type doit être borné à NODE, WAY, RELATION — les valeurs réelles d'Open Prices",
  );
});

await test("C4.2-06 — NI le nom NI l'enseigne n'entrent dans une contrainte d'identité", () => {
  // ⚠️ LE CŒUR DU LOT. `osm_brand` est très souvent nul en amont, et deux
  // magasins de la même enseigne dans la même ville sont DEUX magasins. Faire
  // porter l'identité au nom ou à l'enseigne fusionnerait deux commerces réels.
  const contraintes = [
    ...CODE.matchAll(/(?:unique|primary key)\s*\(([^)]*)\)/gi),
    ...CODE.matchAll(/create unique index[^(]*\(([^)]*)\)/gi),
  ].map((m) => m[1]);
  for (const colonnes of contraintes) {
    for (const interdit of ["name", "brand", "city", "postcode", "lat", "lon"]) {
      assert.ok(
        !new RegExp(`\\b${interdit}\\b`).test(colonnes),
        `« ${interdit} » ne doit apparaître dans AUCUNE contrainte d'identité : ${colonnes.trim()}`,
      );
    }
  }
  // Et le nom reste obligatoire — un magasin sans nom est inchoisissable.
  assert.match(CODE, /name text not null/i, "name doit être NOT NULL : un magasin sans nom ne s'affiche pas");
  // ...mais l'enseigne, elle, est nullable : la mesure amont dit qu'elle l'est.
  assert.ok(
    !/brand text not null/i.test(CODE),
    "brand ne doit PAS être NOT NULL : osm_brand est nul pour beaucoup de magasins réels",
  );
});

await test("C4.2-07 — les coordonnées sont celles du MAGASIN, au format exact de l'amont", () => {
  // `DecimalField(max_digits=11, decimal_places=7)` en amont → numeric(11,7)
  // ici. Un `double precision` réintroduirait une dérive binaire sur une
  // donnée qui est, chez la source, décimale.
  assert.match(CODE, /lat numeric\(11,\s*7\) not null/i, "lat doit être numeric(11,7)");
  assert.match(CODE, /lon numeric\(11,\s*7\) not null/i, "lon doit être numeric(11,7)");
  assert.ok(!/\b(float|double precision|real)\b/i.test(CODE), "aucune coordonnée en flottant");
  // ⚠️ ET AUCUNE COORDONNÉE D'ÉLÈVE. La position d'une personne n'a rien à
  // faire dans un référentiel de commerces — ni ici, ni ailleurs.
  for (const interdit of ["student_lat", "student_lon", "user_lat", "user_lon", "latitude", "longitude"]) {
    assert.ok(!new RegExp(`\\b${interdit}\\b`, "i").test(CODE), `« ${interdit} » est interdit`);
  }
});

/* ══════════════════════════════════════════════════════════════════════════
   C — « UN SEUL MAGASIN ACTIF » EST UNE CLÉ PRIMAIRE
   ══════════════════════════════════════════════════════════════════════════ */

await test("C4.2-08 — la PK de student_selected_store est student_id, SEUL", () => {
  // ⚠️ L'INVARIANT CENTRAL, ET IL EST STRUCTUREL. Une PK `(student_id,
  // store_id)` autoriserait N magasins et exigerait du code applicatif pour
  // garantir qu'il n'y en a qu'un. Une contrainte ne s'oublie pas ; un `if`, si.
  assert.match(
    CODE,
    /student_id uuid primary key\s+references public\.students \(id\) on delete cascade/i,
    "student_id doit être la clé primaire ET référencer public.students",
  );
  assert.ok(
    !/primary key \(\s*student_id\s*,/i.test(CODE),
    "une PK composite autoriserait plusieurs magasins actifs",
  );
});

await test("C4.2-09 — store_id est une VRAIE clé étrangère, non nulle, en restrict", () => {
  assert.match(
    CODE,
    /store_id uuid not null\s+references public\.stores \(id\) on delete restrict/i,
    "store_id doit référencer public.stores et refuser la suppression d'un magasin choisi",
  );
});

await test("C4.2-09b — la date du choix est écrite par la BASE, jamais par l'appelant", () => {
  // ⚠️ LE DÉFAUT CORRIGÉ ICI ÉTAIT UNE DOCUMENTATION QUI MENTAIT. La colonne
  // s'appelait `selected_at` et se disait « réécrite à chaque changement » —
  // alors qu'un `update … set store_id = …` la laissait telle quelle. Les
  // tests ne le voyaient pas : ils écrivaient eux-mêmes `selected_at = now()`,
  // c'est-à-dire qu'ils prouvaient leur propre discipline, pas celle du schéma.
  assert.match(CODE, /updated_at timestamptz not null default now\(\)/i,
    "la date du choix doit être `updated_at`, avec un défaut posé par la base");
  assert.ok(!/selected_at/i.test(SANS_PROSE),
    "`selected_at` ne doit plus exister : son nom promettait ce que rien ne tenait");

  // 1ʳᵉ moitié de la serrure : le TRIGGER du dépôt, pas une fonction neuve.
  assert.match(SANS_PROSE, /create trigger set_updated_at before update on public\.student_selected_store/i,
    "le trigger set_updated_at du dépôt doit être installé sur la table");
  assert.match(SANS_PROSE, /for each row execute function public\.set_updated_at\(\)/i,
    "il doit appeler la fonction EXISTANTE du dépôt");
  assert.ok(!/create (or replace )?function/i.test(SANS_PROSE),
    "aucune fonction ne doit être créée : le mécanisme existe déjà");
  // Le gabarit gardé de `food_products` — la migration ne suppose pas la
  // fonction présente, elle le vérifie.
  assert.match(SANS_PROSE, /proname = ''set_updated_at''|proname = 'set_updated_at'/i,
    "l'installation doit être gardée, comme partout ailleurs dans le dépôt");

  // 2ᵈᵉ moitié : LE GRANT DE COLONNE, SUR LES DEUX VERBES D'ÉCRITURE.
  //
  // ⚠️ NE RESTREINDRE QUE L'UPDATE ÉTAIT UN TROU. Un `grant insert` au niveau
  // de la TABLE autorise l'écriture de toutes les colonnes : l'élève pouvait
  // poser la date lui-même à l'insertion, sur SA ligne, donc sans heurter la
  // RLS — et le trigger, `before UPDATE`, ne voit pas les insertions.
  assert.match(
    CODE,
    /grant insert \(student_id, store_id\) on table public\.student_selected_store to authenticated/i,
    "l'INSERT de l'élève doit être limité à student_id et store_id",
  );
  assert.match(
    CODE,
    /grant update \(store_id\)\s+on table public\.student_selected_store to authenticated/i,
    "l'UPDATE de l'élève doit être limité à store_id",
  );

  // ⚠️ ET AUCUN GRANT SANS PARENTHÈSES sur les verbes d'écriture. La regex
  // `[^;()]*` ne franchit pas une liste de colonnes : elle ne voit donc QUE
  // les grants de table, qui sont précisément ceux qu'on interdit.
  const grantsTable = [
    ...CODE.matchAll(/grant\s+([^;()]*?)\s+on table public\.student_selected_store to authenticated/gi),
  ].map((m) => m[1].toLowerCase());
  for (const liste of grantsTable) {
    for (const verbe of ["insert", "update", "all"]) {
      assert.ok(
        !new RegExp(`\\b${verbe}\\b`).test(liste),
        `« ${verbe} » accordé au niveau de la TABLE (« ${liste} ») : toutes les colonnes deviennent écrivables`,
      );
    }
  }

  // Et `updated_at` n'est nommée dans AUCUNE liste de colonnes accordée.
  const colonnesAccordees = [
    ...CODE.matchAll(/grant\s+\w+\s+\(([^)]*)\)\s+on table public\.student_selected_store to authenticated/gi),
  ].map((m) => m[1]);
  assert.ok(colonnesAccordees.length >= 2, "insert et update doivent tous deux nommer leurs colonnes");
  for (const liste of colonnesAccordees) {
    assert.ok(
      !/updated_at/.test(liste),
      `updated_at ne doit être accordée à aucun verbe d'écriture client : « ${liste} »`,
    );
  }
});

await test("C4.2-10 — rien de ce qui prépare C4.7 n'existe", () => {
  for (const interdit of [
    "position",
    "favorite",
    "favori",
    "is_active",
    "actif",
    "rang",
    "ordre",
    "priority",
    "history",
    "historique",
    "selected_at",
    "archived",
  ]) {
    assert.ok(
      !new RegExp(`\\b${interdit}\\b`, "i").test(CODE),
      `« ${interdit} » prépare prématurément le multi-magasins`,
    );
  }
  // Une seule table de sélection, et une seule colonne de magasin dedans.
  assert.equal(
    (CODE.match(/store_id/g) ?? []).length >= 1,
    true,
    "la sélection doit nommer store_id",
  );
});

/* ══════════════════════════════════════════════════════════════════════════
   D — LES SERRURES : LE CATALOGUE EST FERMÉ, LA SÉLECTION EST PRIVÉE
   ══════════════════════════════════════════════════════════════════════════ */

await test("C4.2-11 — RLS activée sur les deux tables", () => {
  for (const table of ["stores", "student_selected_store"]) {
    assert.match(
      CODE,
      new RegExp(`alter table public\\.${table} enable row level security`, "i"),
      `la RLS doit être activée sur ${table}`,
    );
  }
});

await test("C4.2-12 — stores : lecture pour tous, écriture pour PERSONNE", () => {
  // ⚠️ MÊME DOCTRINE QUE `food_products`, ET POUR LA MÊME RAISON. Une policy
  // dit quelles LIGNES ; c'est le PRIVILÈGE qui ferme l'écriture, et son refus
  // tombe avant toute évaluation de policy. Un élève qui pourrait insérer un
  // magasin pourrait en fabriquer un faux et s'y rattacher.
  for (const role of ["public", "anon", "authenticated"]) {
    assert.match(
      CODE,
      new RegExp(`revoke all on table public\\.stores from ${role}`, "i"),
      `revoke all … from ${role} manquant sur stores`,
    );
  }
  // L'ordre compte : le revoke PRÉCÈDE le grant.
  const posRevoke = CODE.search(/revoke all on table public\.stores from public/i);
  const posGrant = CODE.search(/grant select on table public\.stores to authenticated/i);
  assert.ok(posRevoke >= 0 && posGrant >= 0, "revoke et grant doivent exister sur stores");
  assert.ok(posRevoke < posGrant, "le revoke doit PRÉCÉDER le grant, sinon un privilège hérité survit");

  // SELECT SEUL pour authenticated. La liste est exhaustive à dessein.
  const grantsStores = [...CODE.matchAll(/grant ([\w\s,]+?) on table public\.stores to (\w+)/gi)];
  const versAuthenticated = grantsStores
    .filter((m) => m[2].toLowerCase() === "authenticated")
    .map((m) => m[1].trim().toLowerCase());
  assert.deepEqual(versAuthenticated, ["select"], "authenticated ne doit avoir QUE select sur stores");
  assert.ok(
    grantsStores.some((m) => m[2].toLowerCase() === "service_role"),
    "service_role doit pouvoir écrire le catalogue",
  );
});

await test("C4.2-13 — la sélection est privée, et lue par le SEUL helper du dépôt", () => {
  // `public.current_student_id()` ET RIEN D'AUTRE — le helper unique du projet
  // (`food_favorites`, `planned_meals`, `consumed_meals`, `shopping_lists`).
  // ⚠️ `\s+` et non un espace : le dépôt met le `on …` à la ligne quand le nom
  // de policy est long. Exiger l'espace simple ferait rougir la mise en forme.
  const policies = [
    ...MIGRATION.matchAll(/create policy "([^"]+)"\s+on public\.student_selected_store/gi),
  ].map((m) => m[1]);
  assert.ok(policies.length > 0, "student_selected_store doit porter des policies");
  for (const p of policies) {
    assert.match(p, /^student_selected_store_/, `nom de policy hors convention : ${p}`);
  }
  const bloc = MIGRATION.slice(MIGRATION.indexOf("student_selected_store_select"));
  assert.match(bloc, /student_id = public\.current_student_id\(\)/, "la RLS doit passer par current_student_id()");
  assert.ok(
    !/auth\.uid\(\)/.test(CODE),
    "aucune seconde logique d'identité : auth.uid() direct est interdit ici",
  );
  // ⚠️ AUCUNE POLICY COACH, exactement comme `shopping_lists` : où un élève
  // fait ses courses n'est pas un fait d'entraînement. L'ajouter est une ligne ;
  // retirer une exposition déjà en production est une correction.
  assert.ok(!/is_coach|coach_id|coaches/i.test(CODE), "aucune capacité coach n'est introduite");
  // L'admin, lui, utilise la capacité qui existe déjà.
  assert.match(CODE, /public\.is_admin\(\)/, "l'administration doit passer par is_admin(), déjà en place");
});

/* ══════════════════════════════════════════════════════════════════════════
   E — C4.2-PERIMETRE : CE QUE CE LOT N'A PAS LE DROIT D'INTRODUIRE
   ══════════════════════════════════════════════════════════════════════════ */

/**
 * ⚠️ CONTRAT NOMINATIF ET FALSIFIABLE. Chaque mot ci-dessous nomme un lot
 * ULTÉRIEUR ; le trouver dans le code de C4.2 signifie que le lot a débordé.
 * On balaie le CODE, jamais la PROSE : la migration EXPLIQUE en commentaire
 * pourquoi elle ne porte ni prix ni disponibilité, et l'accuser pour cela
 * serait punir la documentation.
 */
const INTERDITS_C4_2: ReadonlyArray<readonly [string, string]> = [
  ["price", "C4.4 — prix observés"],
  ["prix", "C4.4 — prix observés"],
  ["cents", "C4.4 — montants"],
  ["milli", "C4.4 — montants"],
  ["currency", "C4.4 — montants"],
  ["euro", "C4.4 — montants"],
  ["discount", "C4.4 — promotions"],
  ["promotion", "C4.4 — promotions"],
  ["promo", "C4.4 — promotions"],
  ["stock", "aucun lot — la donnée n'existe pas chez Open Prices"],
  ["availability", "aucun lot — la donnée n'existe pas chez Open Prices"],
  ["available", "aucun lot — la donnée n'existe pas chez Open Prices"],
  ["in_stock", "aucun lot — la donnée n'existe pas chez Open Prices"],
  ["out_of_stock", "aucun lot — la donnée n'existe pas chez Open Prices"],
  ["disponib", "aucun lot — la donnée n'existe pas chez Open Prices"],
  ["inventory", "aucun lot — la donnée n'existe pas chez Open Prices"],
  ["price_count", "C4.3 — signal de découverte, transitoire"],
  ["nearby", "C4.3a — découverte"],
  ["radius_km", "C4.3a — découverte"],
  ["geoloc", "C4.3a — découverte"],
  ["distance", "C4.3a — découverte"],
  ["preferred_unit", "supprimée par le CONTRACT"],
  ["quantity_unit", "hors périmètre : C4.2 ne parle d'aucune unité"],
  ["package", "C4.5 — conditionnement"],
  ["ceil", "C4.5 — conditionnement"],
  ["compare", "C4.7 — comparaison"],
];

await test("C4.2-PERIMETRE — la migration n'introduit rien qui appartienne à un autre lot", () => {
  const coupables: string[] = [];
  for (const [mot, lot] of INTERDITS_C4_2) {
    if (new RegExp(mot, "i").test(CODE)) coupables.push(`${mot} (→ ${lot})`);
  }
  assert.deepEqual(coupables, [], `C4.2 a débordé sur un autre lot : ${coupables.join(", ")}`);
});

await test("C4.2-PERIMETRE — aucun code applicatif, aucun réseau, aucune géolocalisation", () => {
  // C4.2 est un lot de SCHÉMA. Il n'a ni route, ni composant, ni adaptateur :
  // c'est C4.3a qui fera entrer un magasin dans la table, et lui seul parlera
  // à Open Prices. Ces chemins ne doivent pas exister encore.
  const chemins = [
    "../../lib/open-prices/locations.ts",
    "../../lib/open-prices/nearby.ts",
    "../../app/api/student/stores",
    "../../app/api/student/store",
  ];
  for (const chemin of chemins) {
    assert.ok(!existsSync(new URL(chemin, import.meta.url)), `${chemin} appartient à C4.3a, pas à C4.2`);
  }
  // Et aucun fichier du dépôt n'a gagné un appel vers Open Prices dans ce lot :
  // le seul module qui connaît ce domaine reste celui de C4.1.
  const APERCU = lire("../../lib/open-prices/apercu.ts");
  assert.ok(APERCU.includes("prices.openfoodfacts.org"), "le module C4.1 doit rester intact");
  const modulesOpenPrices = readdirSync(new URL("../../lib/open-prices/", import.meta.url)).sort();
  assert.deepEqual(modulesOpenPrices, ["apercu.ts"], "C4.2 ne doit ajouter aucun module Open Prices");
});

await test("C4.2-PERIMETRE — budget-courses.ts est SCELLÉ, à l'octet près", () => {
  // ⚠️ CE N'EST PAS UN COMPTEUR FIGÉ. C'est le sceau d'un fichier que CE lot
  // s'interdit de toucher : le magasin est un FILTRE DE CHARGEMENT, jamais une
  // dimension du calcul. Le lot qui aura une raison légitime de modifier ce
  // fichier — C4.5, le conditionnement — remontera ce sceau DÉLIBÉRÉMENT, et
  // devra le justifier. C'est exactement ce qu'on veut d'un sceau.
  assert.equal(
    empreinte(lire("../../lib/nutrition/budget-courses.ts")),
    "becd06ded213d14a",
    "budget-courses.ts a été modifié : C4.2 n'a AUCUNE raison d'y toucher",
  );
});

await test("C4.2-PERIMETRE — aucune migration existante n'a été retouchée", () => {
  // « Toute correction DB est une NOUVELLE migration additive » : ce contrôle
  // en est l'accusé de réception, migration par migration, sur le contenu.
  const scelles: ReadonlyArray<readonly [string, string]> = [
    ["20260915090000_c2_liste_de_courses_persistante.sql", "287fe940aeaa7e8d"],
    ["20260916090000_c3_budget_et_prix_estimatifs.sql", "39310c1a9f64f187"],
    ["20260917090000_c4_1_pont_retail.sql", "187e9d382f4d2ab2"],
  ];
  for (const [nom, sceau] of scelles) {
    assert.equal(
      empreinte(lire(`../../supabase/migrations/${nom}`)),
      sceau,
      `${nom} a été MODIFIÉE — une migration appliquée ne se réécrit jamais`,
    );
  }
});

await test("C4.2-PERIMETRE — UX-24 est intact, ni supprimé ni élargi", () => {
  const UX = lire("../../scripts/tests/liste-de-courses-ux.mts");
  assert.match(UX, /UX-24\. budget et magasins ne sont PAS implémentés/, "UX-24 a été supprimé ou renommé");
  // Son périmètre reste les CINQ fichiers de C1.1 — ni plus (élargir le ferait
  // rougir artificiellement), ni moins (le rétrécir le viderait de son sens).
  const bloc = /const CHEMINS_C11 = \[([\s\S]*?)\] as const;/.exec(UX);
  assert.ok(bloc, "CHEMINS_C11 a disparu");
  assert.equal(
    (bloc![1].match(/"\.\.\//g) ?? []).length,
    5,
    "le périmètre de UX-24 doit rester les cinq fichiers de C1.1",
  );
  // Et sa liste de mots interdits n'a pas maigri.
  for (const mot of ["budget", "prix", "magasin", "store", "geoloc", "latitude", "promotion"]) {
    assert.ok(new RegExp(`"${mot}"`).test(UX), `UX-24 ne surveille plus « ${mot} »`);
  }
});

/* ══════════════════════════════════════════════════════════════════════════
   F — LES CONTRATS PARTAGÉS
   ══════════════════════════════════════════════════════════════════════════ */

await test("C4.2-14 — le contrat des migrations et le manifeste tiennent", () => {
  verifierContratDesMigrations(assert);
  verifierManifesteDesMigrations(assert);
});

await test("C4.2-15 — l'horodatage est POSTÉRIEUR à C4.1, sans être une date", () => {
  // ⚠️ L'HORODATAGE EST UN COMPTEUR D'ORDRE MONOTONE, PAS UNE DATE. Le dépôt
  // porte déjà vingt migrations « dans le futur » ; le seul critère est
  // l'ordre lexicographique, parce que c'est celui que `supabase db push`
  // applique. Renommer pour « corriger la date » casserait cet ordre.
  const t = /^(\d{14})_/.exec(MIGRATION_C4_2);
  assert.ok(t, "la migration C4.2 doit être horodatée");
  assert.ok(
    Number(t![1]) > 20260917090000,
    `${MIGRATION_C4_2} doit être POSTÉRIEURE à la migration C4.1`,
  );
});

await test("C4.2-16 — la checklist SQL couvre les scénarios exigés", () => {
  // Le comportement réel se prouve dans PostgreSQL ; ici on vérifie seulement
  // que la checklist EXISTE et qu'elle nomme chacun des scénarios exigés — un
  // fichier qui les oublierait passerait vert en ne prouvant rien.
  for (const scenario of [
    "A-01",
    "sélection initiale",
    "remplacement",
    "deux élèves",
    "magasin inexistant",
    "élève B",
    "bigint",
    "updated_at",
    "trigger",
  ]) {
    assert.ok(
      CHECKLIST.toLowerCase().includes(scenario.toLowerCase()),
      `la checklist SQL ne couvre pas « ${scenario} »`,
    );
  }
  assert.match(CHECKLIST, /rollback/i, "la checklist doit se terminer par un ROLLBACK");
  assert.ok(
    !/prices\.openfoodfacts\.org|http/i.test(CHECKLIST),
    "la checklist ne doit dépendre d'aucun réseau",
  );
});
