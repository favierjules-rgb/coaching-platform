/**
 * Harnais — ALIMENTS A1, FONDATIONS DATA.
 *
 * Ce que ce fichier PROUVE et ce qu'il ne prouve PAS.
 *
 * Il lit le TEXTE de la migration, de la checklist et des couches d'accès
 * existantes, et vérifie ce qui est décidable sans base : le périmètre, les
 * non-régressions, le vocabulaire des contraintes, la déclaration au
 * manifeste, les compteurs de migrations.
 *
 * Il ne prouve RIEN sur le comportement réel de la RLS ni des contraintes :
 * cela se joue sur un vrai PostgreSQL, et c'est le rôle de
 * supabase/tests/aliments_a1_checklist.sql — 117 contrôles, dont les six
 * scénarios coach A / coach B / élève A / élève B / élève sans coach /
 * administrateur. Un test statique qui prétendrait le contraire serait un
 * faux vert.
 *
 * Lancement : npx tsx scripts/tests/aliments-a1.mts
 */
import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";
import test from "node:test";

function lire(chemin: string): string {
  return readFileSync(new URL(chemin, import.meta.url), "utf8");
}
/**
 * Retire la PROSE d'un fichier SQL : on assertionne le CODE, jamais le texte.
 *
 * Deux passes, et la seconde n'est pas cosmétique. Les lignes `--` suffisent
 * dans les autres harnais, mais cette migration documente ses interdictions
 * dans des `comment on … is '…'` — qui sont du SQL exécutable. Sans cette
 * passe, « aucune dépendance à pg_trgm » échouait parce que le commentaire
 * de `food_slug` EXPLIQUE que pg_trgm n'est pas installée, et « ne nomme pas
 * nutrition_daily_logs » échouait parce que le commentaire de `meal_entries`
 * la cite pour dire en quoi elle en diffère. Quatre tests rouges pour la
 * mauvaise raison — l'inverse exact du faux vert, mais le même défaut.
 */
function sansCommentairesSql(source: string): string {
  const sansLignes = source.split("\n").map((l) => l.replace(/--.*$/, "")).join("\n");
  return sansLignes.replace(/comment\s+on\s+[\s\S]*?\bis\s+'(?:''|[^'])*'\s*;/gi, "");
}
function sansCommentairesTs(source: string): string {
  return source.replace(/\/\*[\s\S]*?\*\//g, "").replace(/\/\/[^\n]*/g, "");
}

const NOM_MIGRATION = "20260831090000_food_catalog_and_meal_entries.sql";
const MIGRATION = lire(`../../supabase/migrations/${NOM_MIGRATION}`);
const SQL = sansCommentairesSql(MIGRATION);
const CHECKLIST = lire("../../supabase/tests/aliments_a1_checklist.sql");

await test("1. les trois tables, et rien de plus", () => {
  for (const table of ["food_catalog", "food_aliases", "meal_entries"]) {
    assert.ok(
      new RegExp(`create table if not exists public\\.${table}\\b`, "i").test(SQL),
      `${table} est créée`,
    );
  }
  const creees = [...SQL.matchAll(/create table if not exists public\.(\w+)/gi)].map((m) => m[1]);
  assert.deepEqual(creees.sort(), ["food_aliases", "food_catalog", "meal_entries"]);

  // Le périmètre exclu par l'énoncé, vérifié table par table.
  for (const interdite of ["food_products", "food_favorites", "food_recents", "shopping_lists"]) {
    assert.ok(!new RegExp(`\\b${interdite}\\b`, "i").test(SQL), `${interdite} n'apparaît pas`);
  }
});

await test("2. aucune donnée insérée, aucune extension installée", () => {
  assert.ok(!/\binsert\s+into\b/i.test(SQL), "la migration n'insère aucune ligne");
  assert.ok(!/\bcreate\s+extension\b/i.test(SQL), "la migration n'installe aucune extension");
  // pg_trgm n'est pas installée sur le distant : la stratégie de recherche de
  // ce lot ne doit donc pas s'y adosser, même « au cas où ».
  assert.ok(!/pg_trgm|unaccent|citext|similarity\s*\(|%>|<->/i.test(SQL),
    "aucune dépendance à une extension de recherche floue");
});

await test("3. nutrition_daily_logs est strictement intacte (décision B1)", () => {
  assert.ok(
    !/(alter|drop|insert into|update|delete from)\s+(table\s+)?public\.nutrition_daily_logs\b/i.test(SQL),
    "la migration ne touche pas à l'outil 1",
  );
  assert.ok(!/nutrition_daily_logs/.test(SQL), "elle ne la nomme même pas dans son code");
  // Et il n'y a AUCUNE double écriture : rien dans la migration ne relie les
  // deux tables, ni par clé étrangère, ni par trigger, ni par vue.
  assert.ok(!/nutrition_plan_id/i.test(SQL), "meal_entries n'hérite pas de nutrition_plan_id");
  assert.ok(!/\bcreate\s+(or\s+replace\s+)?view\b/i.test(SQL), "aucune vue de compatibilité prématurée");
});

await test("4. nutrition_recipe_ingredients n'acquiert AUCUN food_id (décision Q2)", () => {
  assert.ok(
    !/alter\s+table\s+(only\s+)?public\.nutrition_recipe_ingredients/i.test(SQL),
    "la table des ingrédients n'est pas altérée",
  );
  // Le raisonnement est dans l'en-tête, la garantie est ici : aucune des
  // trois RPC qui font DELETE + INSERT n'est redéfinie par ce lot.
  for (const rpc of [
    "save_nutrition_recipe",
    "duplicate_nutrition_recipe",
    "import_nutrition_recipes",
    "delete_nutrition_recipe",
  ]) {
    assert.ok(!new RegExp(`function public\\.${rpc}\\b`, "i").test(SQL), `${rpc} n'est pas redéfinie`);
  }
});

await test("5. le moteur nutrition n'est pas touché", () => {
  const solveur = sansCommentairesTs(lire("../../lib/nutrition/recipe-solver.ts"));
  assert.ok(!/food_catalog|food_aliases|meal_entries|food_id/.test(solveur),
    "le solveur ne lit aucune table du référentiel");
  const lignes = sansCommentairesTs(lire("../../lib/nutrition/recipe-rows.ts"));
  assert.ok(!/food_catalog|food_id/.test(lignes), "la projection des ingrédients est inchangée");
  const logs = sansCommentairesTs(lire("../../lib/supabase/nutrition-logs.ts"));
  assert.ok(!/meal_entries|food_catalog/.test(logs), "la couche de l'outil 1 ignore les nouvelles tables");
});

await test("6. food_catalog : hybride, sans calories, macros contraintes", () => {
  assert.ok(/owner_coach_id uuid references public\.coaches \(id\) on delete restrict/i.test(SQL),
    "owner_coach_id est nullable et en restrict");
  // Aucune colonne d'énergie : le 4/4/9 reste dérivé, jamais stocké.
  const corpsCatalogue = SQL.split("create table if not exists public.food_catalog")[1]
    .split("create table if not exists public.food_aliases")[0];
  assert.ok(!/(calor|kcal|energ)/i.test(corpsCatalogue), "aucune colonne de calories");
  for (const colonne of ["protein_per_100", "carb_per_100", "fat_per_100"]) {
    assert.ok(new RegExp(`${colonne} numeric not null`).test(corpsCatalogue), `${colonne} est NOT NULL`);
  }
  assert.ok(/food_catalog_macros_non_negative[\s\S]{0,160}protein_per_100 >= 0/.test(SQL));
  assert.ok(/food_catalog_nutrition_unit_check[\s\S]{0,80}'g', 'ml'/.test(SQL));
  assert.ok(/food_catalog_status_check[\s\S]{0,80}'active', 'archived'/.test(SQL));

  // piece_weight_g : la place de « 1 banane ≈ 120 g » est prise MAINTENANT,
  // parce qu'une colonne nullable sur une table vide ne coûte rien, alors
  // qu'une migration de plus sur une table peuplée en coûte. Aucun code de
  // ce lot ne la lit — c'est une préparation, pas une fonctionnalité.
  assert.ok(/piece_weight_g numeric,/.test(SQL), "piece_weight_g est posée, nullable");
  assert.ok(!/piece_weight_g numeric not null|piece_weight_g numeric default/i.test(SQL),
    "ni NOT NULL ni valeur par défaut : NULL veut dire « pas de pièce »");
  assert.ok(/food_catalog_piece_weight_positive[\s\S]{0,120}piece_weight_g is null or piece_weight_g > 0/.test(SQL));
  // Et personne ne la lit encore, nulle part dans le dépôt.
  for (const fichier of [
    "../../lib/nutrition/recipe-solver.ts",
    "../../lib/nutrition/recipe-rows.ts",
    "../../lib/rpe.ts",
    "../../lib/nutrition/plan-v2-week-form.ts",
  ]) {
    assert.ok(!/piece_weight_g/.test(lire(fichier)), `${fichier} lit déjà piece_weight_g`);
  }
});

await test("7. le slug est une colonne GÉNÉRÉE, unique dans deux espaces disjoints", () => {
  assert.ok(/slug text generated always as \(public\.food_slug\(name\)\) stored/i.test(SQL),
    "le slug ne peut pas être désynchronisé par l'application");
  assert.ok(/create unique index if not exists food_catalog_slug_global_unique[\s\S]{0,120}where owner_coach_id is null/i.test(SQL));
  assert.ok(/create unique index if not exists food_catalog_slug_coach_unique[\s\S]{0,140}where owner_coach_id is not null/i.test(SQL));
});

await test("8. food_slug ne dépend d'aucune collation", () => {
  const corps = SQL.split("create or replace function public.food_slug")[1]
    .split("alter function public.food_slug")[0];
  // `lower()` est déclarée immutable par PostgreSQL mais son résultat dépend
  // de la collation : sur une base en locale C, « Œuf » n'était pas replié et
  // le slug devenait « uf-entier ». Mesuré, puis corrigé par translate().
  assert.ok(!/\blower\s*\(/i.test(corps), "aucun appel à lower()");
  assert.ok(/translate\(/i.test(corps), "le repli de casse passe par translate()");
  assert.ok(/'ABCDEFGHIJKLMNOPQRSTUVWXYZ'/.test(corps), "l'alphabet ASCII est replié explicitement");
  assert.ok(/immutable/i.test(corps) && /strict/i.test(corps),
    "immutable et strict : c'est ce qui autorise la colonne générée");
  assert.ok(/set search_path = ''/.test(corps), "search_path verrouillé");
});

await test("9. meal_entries : instantané indépendant de sa source, états impossibles", () => {
  for (const colonne of ["label text not null", "quantity numeric not null", "unit text not null",
    "protein_g numeric not null", "carb_g numeric not null", "fat_g numeric not null"]) {
    assert.ok(SQL.includes(colonne), `${colonne} fait partie de l'instantané`);
  }

  // Le gel porte sur la SOURCE, pas sur la ligne. Une version précédente
  // posait un trigger qui refusait tout UPDATE des six colonnes : il
  // confondait « ne suit pas sa source » et « ne bouge jamais », et rendait
  // impossible la correction d'une simple faute de quantité. Il est retiré,
  // et le `drop` reste pour que la migration soit correcte si elle est
  // rejouée sur une base où il aurait été posé.
  assert.ok(!/create or replace function public\.meal_entries_freeze_snapshot/i.test(SQL),
    "aucune fonction de gel n'est créée");
  assert.ok(!/create trigger meal_entries_freeze_snapshot/i.test(SQL),
    "aucun trigger de gel n'est posé");
  assert.ok(!/MEAL_ENTRY_SNAPSHOT_FROZEN/.test(SQL), "l'erreur de gel n'existe plus");
  assert.ok(/drop trigger if exists meal_entries_freeze_snapshot on public\.meal_entries;/.test(SQL));
  assert.ok(/drop function if exists public\.meal_entries_freeze_snapshot\(\);/.test(SQL));

  // Le seul trigger d'UPDATE de meal_entries reste l'horodatage : c'est ce
  // qui garantit que le schéma n'interdit pas l'UX de correction de A2.
  const triggersUpdate = [...SQL.matchAll(/create trigger (\w+)\s+before update on public\.meal_entries/gi)]
    .map((m) => m[1]);
  assert.deepEqual(triggersUpdate, ["set_updated_at"],
    "l'horodatage est le SEUL trigger d'UPDATE — MEAL-A12 s'appuie dessus, MEAL-A5 le vérifie en base");

  // Les pointeurs sont en `set null` — l'instantané survit à la disparition
  // de sa source — et les contraintes sont écrites dans le sens compatible.
  assert.ok(/recipe_id uuid references public\.nutrition_recipes \(id\) on delete set null/i.test(SQL));
  assert.ok(/food_id uuid references public\.food_catalog \(id\) on delete set null/i.test(SQL));
  assert.ok(/meal_entries_recipe_id_coherent[\s\S]{0,120}recipe_id is null or source_type = 'recipe'/.test(SQL));
  assert.ok(/meal_entries_food_id_coherent[\s\S]{0,120}food_id is null or source_type = 'catalog_food'/.test(SQL));
  // Le piège évité : « source_type = 'recipe' ⇒ recipe_id not null » aurait
  // rendu impossible la suppression d'une recette référencée.
  assert.ok(!/source_type = 'recipe'[\s\S]{0,80}recipe_id is not null/.test(SQL),
    "l'implication n'est pas écrite dans le sens qui casse ON DELETE SET NULL");

  assert.ok(/meal_entries_source_type_check[\s\S]{0,140}'recipe', 'catalog_food', 'product', 'free'/.test(SQL));
  assert.ok(/meal_entries_quantity_positive[\s\S]{0,60}quantity > 0/.test(SQL));
});

await test("10. RLS : élève, coach strict, administrateur", () => {
  // L'élève : CRUD sur les siennes, et c'est tout. `for all` — donc UPDATE
  // compris : sans lui, corriger une saisie serait impossible et l'UX de A2
  // se réduirait à « supprimer puis ressaisir ».
  const eleve = SQL.split('create policy "meal_entries_crud_own_student"')[1].split("drop policy")[0];
  assert.ok(/for all to authenticated/i.test(eleve), "l'élève a bien les quatre verbes");
  assert.ok(/using\s+\(student_id = public\.current_student_id\(\)\)/.test(eleve));
  assert.ok(/with check \(student_id = public\.current_student_id\(\)\)/.test(eleve),
    "le with check empêche de déplacer une entrée vers un autre élève");
  // Et la table porte bien le privilège UPDATE, pas seulement la policy.
  assert.ok(SQL.includes("grant select, insert, update, delete on table public.meal_entries to authenticated;"));
  // Le coach : SELECT seulement, et à travers le helper relationnel.
  const coach = SQL.split('create policy "meal_entries_select_own_coach"')[1].split("drop policy")[0];
  assert.ok(/for select/i.test(coach), "la policy coach est en lecture seule");
  assert.ok(/public\.is_coach_of_student\(student_id\)/.test(coach));
  // Le point de la décision Q1 : jamais is_coach_or_admin() sur cette table.
  assert.ok(!/is_coach_or_admin/.test(SQL),
    "is_coach_or_admin() donnerait à tout futur coach le journal de tous les élèves");
  assert.ok(/create policy "meal_entries_manage_admin"[\s\S]{0,160}public\.is_admin\(\)/.test(SQL));

  // Aucun trou côté catalogue : l'élève n'a AUCUNE policy d'écriture.
  const politiquesCatalogue = [...SQL.matchAll(/create policy "(food_catalog_\w+)"/g)].map((m) => m[1]);
  assert.deepEqual(politiquesCatalogue.sort(),
    ["food_catalog_manage_admin", "food_catalog_manage_own_coach", "food_catalog_select_global"]);
  assert.ok(/create policy "food_catalog_select_global"[\s\S]{0,140}for select to authenticated[\s\S]{0,80}owner_coach_id is null/.test(SQL));
  assert.ok(/create policy "food_catalog_manage_own_coach"[\s\S]{0,320}owner_coach_id is not null and owner_coach_id = public\.current_coach_id\(\)/.test(SQL));
});

await test("11. le prédicat vrai pour anon est explicitement borné à authenticated", () => {
  // Les policies dont le prédicat est vrai sans session DOIVENT porter la
  // clause `TO`, sinon la confidentialité ne tiendrait qu'au privilège.
  const politiques = [...SQL.matchAll(/create policy "(\w+)" on public\.(food_catalog|food_aliases|meal_entries)([\s\S]*?)(?=\n\ndrop policy|\n\n-- |\nrevoke all)/g)];
  assert.ok(politiques.length >= 9, "les neuf policies sont trouvées");
  for (const [, nom, , corps] of politiques) {
    assert.ok(/to authenticated/i.test(corps), `${nom} borne son audience à authenticated`);
  }
});

await test("12. privilèges : revoke AVANT grant, aucun TRUNCATE pour authenticated", () => {
  for (const table of ["food_catalog", "food_aliases", "meal_entries"]) {
    const revoke = SQL.indexOf(`revoke all on table public.${table} from authenticated;`);
    const grant = SQL.indexOf(`grant select, insert, update, delete on table public.${table} to authenticated;`);
    assert.ok(revoke > -1, `${table} : le revoke existe`);
    assert.ok(grant > -1, `${table} : le grant existe`);
    assert.ok(revoke < grant, `${table} : le revoke PRÉCÈDE le grant (sinon TRUNCATE reste, et il contourne la RLS)`);
    assert.ok(SQL.includes(`grant all on table public.${table} to service_role;`));
  }
  assert.ok(!/grant\s+all\s+on\s+table\s+public\.(food_catalog|food_aliases|meal_entries)\s+to\s+(anon|authenticated)/i.test(SQL));
});

await test("13. is_coach_of_student : definer, search_path fixé, anon révoqué", () => {
  const corps = SQL.split("create or replace function public.is_coach_of_student")[1]
    .split("create table if not exists public.food_catalog")[0];
  assert.ok(/security definer/i.test(corps), "definer : la RLS de students filtrerait un invoker");
  assert.ok(/set search_path = public/i.test(corps));
  assert.ok(/s\.coach_id = public\.current_coach_id\(\)/.test(corps));
  assert.ok(/revoke execute on function public\.is_coach_of_student\(uuid\) from anon/i.test(corps));
  assert.ok(/grant execute on function public\.is_coach_of_student\(uuid\) to authenticated, service_role/i.test(corps));
  // Aucun rattachement deviné : la fonction lit students.coach_id, elle ne
  // l'écrit pas, et elle ne se rabat sur aucun « coach unique du cabinet ».
  assert.ok(!/update\s+public\.students/i.test(SQL), "aucun rattachement automatique des élèves orphelins");
});

await test("14. la checklist PostgreSQL couvre les identifiants exigés", () => {
  for (const identifiant of [
    "FOOD-A1", "FOOD-A2", "FOOD-A3", "FOOD-A4", "FOOD-A5", "FOOD-A6", "FOOD-A7", "FOOD-A8",
    "MEAL-A1", "MEAL-A2", "MEAL-A3", "MEAL-A4", "MEAL-A5", "MEAL-A6", "MEAL-A7",
    "FOOD-A9",
    "MEAL-A8", "MEAL-A9", "MEAL-A10", "MEAL-A11", "MEAL-A12",
    "RECIPE-A1", "RECIPE-A2",
  ]) {
    assert.ok(CHECKLIST.includes(identifiant), `la checklist couvre ${identifiant}`);
  }
  // Les six identités synthétiques, dont l'élève sans coach.
  assert.ok(CHECKLIST.includes("Coach A") && CHECKLIST.includes("Coach B"));
  assert.ok(/coach_id is NULL|Orphelin/i.test(CHECKLIST), "l'élève sans rattachement est éprouvé");
  // Elle se termine par un rollback, et refuse de finir verte en cas d'échec.
  assert.ok(CHECKLIST.includes("rollback;"));
  assert.ok(/raise exception 'CHECKLIST EN ÉCHEC/.test(CHECKLIST));
  // Aucune donnée réelle : les comptes sont synthétiques et le domaine est
  // réservé par la RFC 2606.
  assert.ok(!/@gmail|favierjules|sk_live/i.test(CHECKLIST), "aucune donnée réelle dans la checklist");
  assert.ok(CHECKLIST.includes("test.invalid"));
  assert.ok(/⚠️ NE JAMAIS exécuter sur la Production/.test(CHECKLIST));
});

await test("15. la migration est déclarée au manifeste et comptée partout", () => {
  const manifeste = JSON.parse(lire("../../supabase/baseline/manifest.json"));
  const attendues = manifeste.migrations_post_baseline_attendues as string[];
  // 37 depuis 20260830090000 (RPE par demi-point). 36 après ALIMENTS A1.
  assert.equal(attendues.length, 38);
  assert.ok(attendues.includes(NOM_MIGRATION), "A1 est déclarée au manifeste");

  const presentes = readdirSync(new URL("../../supabase/migrations", import.meta.url).pathname)
    .filter((f) => f.endsWith(".sql"));
  assert.equal(presentes.length, 65, "65 migrations sur le disque");

  // Les compteurs vivent dans NEUF fichiers, dont six qui vérifient le TEXTE
  // de security-hardening.mts. Les oublier rendrait rouges des suites vertes
  // qui n'ont rien à voir avec ce chantier — c'est arrivé au lot précédent.
  const secu = lire("../../scripts/tests/security-hardening.mts");
  assert.ok(secu.includes(".length, 65,"), "security-hardening compte 65 migrations");
  assert.ok(secu.includes("assert.equal(attendues.length, 38);"));
  for (const fichier of [
    "nutrition-plan-v2-builder", "nutrition-recipes-admin", "nutrition-recipes",
    "nutrition-single-assigned-plan", "nutrition-v2-unified", "training-movement-patterns",
    "nutrition-recipe-images", "student-feedback-video",
  ]) {
    const source = lire(`../../scripts/tests/${fichier}.mts`);
    assert.ok(!/attendues\.length, 3[56]\b/.test(source), `${fichier} : compteur non mis à jour`);
    assert.ok(!/\.length, 6[23],/.test(source), `${fichier} : compteur non mis à jour`);
  }
});

await test("16. l'en-tête déclare le périmètre exclu, et le code le respecte", () => {
  assert.ok(/⚠️ NE PAS exécuter en Production sans runbook validé/.test(MIGRATION));
  assert.ok(/CE QU'ELLE NE FAIT PAS/.test(MIGRATION));
  // Un en-tête peut mentir : on revérifie chaque promesse sur le CODE.
  assert.ok(!/\bdrop\s+table\b/i.test(SQL), "aucune table supprimée");
  assert.ok(!/\bdrop\s+column\b/i.test(SQL), "aucune colonne supprimée");
  assert.ok(!/\btruncate\b/i.test(SQL), "aucun TRUNCATE");
  // Les `drop` autorisés : les policies et triggers du gabarit, que la
  // migration recrée aussitôt, plus le nettoyage de la fonction de gel
  // abandonnée. Rien d'autre — et surtout aucun objet préexistant.
  const drops = [...SQL.matchAll(/drop\s+(\w+)\s+if\s+exists/gi)].map((m) => m[1].toLowerCase());
  assert.deepEqual([...new Set(drops)].sort(), ["function", "policy", "trigger"]);
  const fonctionsSupprimees = [...SQL.matchAll(/drop\s+function\s+if\s+exists\s+public\.(\w+)/gi)]
    .map((m) => m[1]);
  assert.deepEqual(fonctionsSupprimees, ["meal_entries_freeze_snapshot"],
    "la seule fonction supprimée est celle que ce lot a lui-même abandonnée");
});
