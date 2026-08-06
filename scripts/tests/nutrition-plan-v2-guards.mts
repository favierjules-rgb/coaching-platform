/**
 * Harnais — feat/nutrition-adaptive-recipes, PR 1, volets G et H,
 * MIS À JOUR PAR LA PR C.1.
 *
 * MATRICE DE COMPATIBILITÉ v1 / v2, telle qu'elle est RÉELLEMENT appliquée
 * depuis la PR C.1 :
 *
 *   écriture v1 sur plan v1 ........................ N'EXISTE PLUS
 *   écriture v1 sur plan v2 ........................ N'EXISTE PLUS
 *   RPC v2 sur plan v2 ............................. autorisée
 *   RPC v2 sur plan v1 (conversion explicite) ...... autorisée
 *   conversion automatique au chargement ........... jamais
 *
 * CE QUI A CHANGÉ, ET POURQUOI CES TESTS ONT ÉTÉ RÉÉCRITS PLUTÔT QUE
 * SUPPRIMÉS. Les cas 6, 7 et 8 vérifiaient qu'une garde EMPÊCHAIT le chemin
 * d'écriture historique d'abîmer un plan v2. Depuis la migration
 * 20260811090000, `nutrition_days.profile_key` est NOT NULL avec clé
 * étrangère composite : ce chemin ne peut plus écrire une ligne valide, et
 * il a été supprimé de lib/supabase/nutrition.ts (PR C.1). Une garde sur un
 * chemin inexistant ne prouve plus rien ; les trois cas vérifient donc
 * désormais la garantie PLUS FORTE qui l'a remplacée : il n'existe plus
 * AUCUN chemin applicatif capable d'insérer une journée ou un repas hors de
 * la RPC `save_nutrition_plan_v2`.
 *
 * La règle v1/v2 elle-même n'a pas disparu : elle vit dans le module pur
 * lib/nutrition/plan-v2-guards.ts et reste couverte à l'identique par les
 * cas 1 à 5.
 *
 * Aucun réseau : les cas 6 à 8 lisent les sources du dépôt et interrogent
 * les exports réels du module, sans client Supabase.
 *
 * Lancement : npx tsx scripts/tests/nutrition-plan-v2-guards.mts
 */
import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";

import {
  LEGACY_WRITE_ON_V2_MESSAGE_FR,
  NUTRITION_MODEL_VERSION_LEGACY,
  NUTRITION_MODEL_VERSION_STRUCTURED,
  evaluateLegacyWrite,
  evaluateStructuredWrite,
  isLegacyPlan,
  isStructuredPlan,
  shouldConvertOnRead,
} from "../../lib/nutrition/plan-v2-guards";
import { createEmptyAllocations, distributeRemainingEqually } from "../../lib/nutrition/meal-distribution";
import * as coucheNutrition from "../../lib/supabase/nutrition";
import {
  buildLegacyDailyTarget,
  buildSaveNutritionPlanV2Payload,
  composeProfile,
  parseCanonicalRpcResult,
} from "../../lib/supabase/nutrition-v2";

let réussis = 0;
let échecs = 0;
function test(nom: string, fn: () => void | Promise<void>) {
  return Promise.resolve()
    .then(fn)
    .then(() => {
      réussis += 1;
      console.log(`ok - ${nom}`);
    })
    .catch((erreur) => {
      échecs += 1;
      console.error(`ÉCHEC - ${nom}`);
      console.error(erreur);
    });
}

function lire(chemin: string): string {
  return readFileSync(new URL(chemin, import.meta.url), "utf8");
}

/* ─────────────── Balayage des sources applicatives ─────────────── */

const RACINES_APPLICATIVES = ["app", "components", "hooks", "lib"] as const;

/** Tous les fichiers .ts/.tsx des quatre racines applicatives. */
function fichiersApplicatifs(): { chemin: string; code: string }[] {
  const trouvés: { chemin: string; code: string }[] = [];
  const parcourir = (relatif: string) => {
    const url = new URL(`../../${relatif}`, import.meta.url);
    for (const entrée of readdirSync(url, { withFileTypes: true })) {
      if (entrée.name === "node_modules" || entrée.name.startsWith(".")) continue;
      const suivant = `${relatif}/${entrée.name}`;
      if (entrée.isDirectory()) parcourir(suivant);
      else if (/\.(ts|tsx)$/.test(entrée.name)) trouvés.push({ chemin: suivant, code: lire(`../../${suivant}`) });
    }
  };
  for (const racine of RACINES_APPLICATIVES) parcourir(racine);
  return trouvés;
}

/**
 * Toutes les opérations enchaînées derrière `.from("<table>")` dans un
 * fichier. On coupe au prochain `.from(` ou au prochain `;` : suffisant pour
 * une couche d'accès écrite en chaînes courtes, et volontairement plus
 * bavard que précis — un faux positif fait échouer le test, jamais l'inverse.
 */
function opérationsSurTable(code: string, table: string): string[] {
  const opérations: string[] = [];
  const motif = new RegExp(`\\.from\\(\\s*["'\`]${table}["'\`]\\s*\\)`, "g");
  for (const correspondance of code.matchAll(motif)) {
    const début = (correspondance.index ?? 0) + correspondance[0].length;
    const suite = code.slice(début, début + 400);
    const fin = Math.min(
      ...[suite.indexOf(".from("), suite.indexOf(";")].filter((i) => i >= 0).concat([suite.length]),
    );
    for (const op of ["insert", "upsert", "update", "delete"]) {
      if (new RegExp(`\\.${op}\\s*\\(`).test(suite.slice(0, fin))) opérations.push(op);
    }
  }
  return opérations;
}

/* ─────────────── 1-5. La matrice, à l'état pur ─────────────── */

await test("1. écriture v1 sur plan v1 : autorisée", () => {
  const décision = evaluateLegacyWrite(NUTRITION_MODEL_VERSION_LEGACY);
  assert.equal(décision.allowed, true);
  assert.equal(isLegacyPlan(1), true);
  assert.equal(isStructuredPlan(1), false);
  // Une version absente vaut v1 : DEFAULT 1, aucun backfill.
  assert.equal(evaluateLegacyWrite(null).allowed, true);
  assert.equal(evaluateLegacyWrite(undefined).allowed, true);
});

await test("2. écriture v1 sur plan v2 : refus explicite", () => {
  const décision = evaluateLegacyWrite(NUTRITION_MODEL_VERSION_STRUCTURED);
  assert.equal(décision.allowed, false);
  if (!décision.allowed) {
    assert.equal(décision.reason, "legacy_write_on_v2_plan");
    assert.equal(décision.message, LEGACY_WRITE_ON_V2_MESSAGE_FR);
  }
});

await test("3. RPC v2 sur plan v2 : autorisée, sans conversion", () => {
  const décision = evaluateStructuredWrite(NUTRITION_MODEL_VERSION_STRUCTURED);
  assert.equal(décision.allowed, true);
  assert.equal(décision.allowed && décision.conversion, false);
});

await test("4. RPC v2 sur plan v1 : autorisée, marquée comme conversion explicite", () => {
  const décision = evaluateStructuredWrite(NUTRITION_MODEL_VERSION_LEGACY);
  assert.equal(décision.allowed, true);
  assert.equal(décision.allowed && décision.conversion, true);
});

await test("5. aucune conversion automatique au chargement", () => {
  assert.equal(shouldConvertOnRead(), false);
  // Une version inconnue n'est jamais interprétée « au mieux ».
  assert.equal(evaluateLegacyWrite(3).allowed, false);
  assert.equal(evaluateStructuredWrite(99).allowed, false);
});

/* ─────────────── 6-8. Le chemin d'écriture v1 n'existe plus ─────────────── */

await test("6. la couche nutrition n'exporte plus AUCUNE écriture de structure", () => {
  // Interrogation des exports RÉELS du module, pas de son texte : une
  // fonction réintroduite serait détectée même renommée dans un commentaire.
  const exports = Object.keys(coucheNutrition);
  for (const disparue of [
    "createNutritionPlan",
    "updateNutritionPlan",
    "insertNutritionStructure",
    "evaluateLegacyWriteForPlan",
  ]) {
    assert.ok(!exports.includes(disparue), `${disparue} ne doit plus être exportée`);
  }
  // Les lectures et les deux écritures encore légitimes restent en place.
  for (const conservée of [
    "getNutritionPlans",
    "getAssignedNutritionPlansForStudent",
    "getAssignedNutritionPlanForStudent",
    "getAssignedNutritionPlanIdsByStudent",
    "updateNutritionPlanStatus",
    "setNutritionAssignment",
    "STATUS_APP_TO_DB",
  ]) {
    assert.ok(exports.includes(conservée), `${conservée} doit rester exportée`);
  }
  // Et le module ne touche plus du tout à la structure.
  const source = lire("../../lib/supabase/nutrition.ts");
  assert.deepEqual(opérationsSurTable(source, "nutrition_days"), []);
  assert.deepEqual(opérationsSurTable(source, "meals"), []);
  // Le seul `update` restant sur les plans est celui du statut.
  assert.ok(!source.includes("daily_target:"), "plus aucune écriture de daily_target");
});

await test("7. aucun fichier applicatif n'insère de journée ni de repas", () => {
  const coupables: string[] = [];
  for (const { chemin, code } of fichiersApplicatifs()) {
    for (const table of ["nutrition_days", "meals"]) {
      const opérations = opérationsSurTable(code, table);
      if (opérations.length > 0) coupables.push(`${chemin} → ${table}.${opérations.join("/")}`);
    }
  }
  assert.deepEqual(
    coupables,
    [],
    `écriture directe interdite (passer par save_nutrition_plan_v2) : ${coupables.join(" | ")}`,
  );
});

await test("8. la sauvegarde complète d'un plan passe UNIQUEMENT par save_nutrition_plan_v2", () => {
  // Un seul appelant de RPC pour l'enregistrement d'un plan, un seul nom.
  const couche = lire("../../lib/supabase/nutrition-v2.ts");
  assert.ok(couche.includes(`rpc("save_nutrition_plan_v2"`), "la RPC v2 doit rester l'unique écriture");

  // Les deux seuls écrans qui enregistrent un plan l'appellent.
  for (const page of ["../../app/admin/nutrition/nouveau/page.tsx", "../../app/admin/nutrition/[planId]/page.tsx"]) {
    const code = lire(page);
    assert.ok(code.includes("saveNutritionPlanV2("), `${page} doit enregistrer via la RPC v2`);
  }

  // Et personne n'appelle une autre RPC d'écriture de plan.
  for (const { chemin, code } of fichiersApplicatifs()) {
    for (const appel of code.matchAll(/\.rpc\(\s*["'`]([a-z0-9_]+)["'`]/g)) {
      const nom = appel[1];
      if (nom.includes("nutrition_plan") && nom !== "save_nutrition_plan_v2") {
        assert.ok(
          ["assign_nutrition_plan", "unassign_nutrition_plan"].includes(nom),
          `RPC d'écriture de plan inattendue dans ${chemin} : ${nom}`,
        );
      }
    }
  }
});

/* ─────────────── 9-11. daily_target de compatibilité ─────────────── */

await test("9. le daily_target dérivé a exactement la forme attendue par le code actuel", () => {
  const cible = buildLegacyDailyTarget({
    profileKey: "default",
    dailyCalories: 1700,
    proteinBp: 2800,
    carbBp: 4800,
    fatBp: 2400,
    slots: [],
  });
  assert.deepEqual(Object.keys(cible).sort(), ["calories", "carbs", "fat", "protein"]);
  assert.deepEqual(cible, { calories: 1700, protein: 119, carbs: 204, fat: 45 });
  for (const valeur of Object.values(cible)) {
    assert.equal(typeof valeur, "number");
  }
});

await test("10. la formule TypeScript et la formule SQL de la RPC sont identiques", () => {
  const migration = lire("../../supabase/migrations/20260804090000_nutrition_plan_profiles_v2.sql");
  // Les quatre clés, dans le format lu par mapNutritionPlanRow.
  assert.ok(migration.includes("'calories', round(v_daily_calories)"));
  assert.ok(migration.includes("'protein',  round(v_protein_g)"));
  assert.ok(migration.includes("'carbs',    round(v_carb_g)"));
  assert.ok(migration.includes("'fat',      round(v_fat_g)"));
  // Mêmes diviseurs qu'en TypeScript : 10 000 puis 4 / 4 / 9.
  assert.ok(migration.includes("v_daily_calories * v_protein_bp / 10000.0 / 4.0"));
  assert.ok(migration.includes("v_daily_calories * v_carb_bp    / 10000.0 / 4.0"));
  assert.ok(migration.includes("v_daily_calories * v_fat_bp     / 10000.0 / 9.0"));
  // Et le nom de colonne réellement lu par lib/supabase/nutrition.ts.
  const couche = lire("../../lib/supabase/nutrition.ts");
  assert.ok(couche.includes("dailyTarget.calories"));
  assert.ok(couche.includes("dailyTarget.protein"));
  assert.ok(couche.includes("dailyTarget.carbs"));
  assert.ok(couche.includes("dailyTarget.fat"));
});

await test("11. le daily_target n'est jamais une deuxième source éditable", () => {
  const migration = lire("../../supabase/migrations/20260804090000_nutrition_plan_profiles_v2.sql");
  // La RPC RÉÉCRIT daily_target à chaque sauvegarde, sans jamais le relire
  // comme entrée : il est construit uniquement à partir du profil.
  assert.ok(migration.includes("daily_target = v_daily_target"));
  assert.ok(!/v_daily_calories\s*:=\s*[^;]*daily_target/.test(migration));
});

/* ─────────────── 12-15. Payload, retour canonique, lecture ─────────────── */

await test("12. le payload de la RPC porte les six créneaux et le profil default", () => {
  const répartition = distributeRemainingEqually(createEmptyAllocations(), "protein");
  assert.ok(répartition.ok);
  const payload = buildSaveNutritionPlanV2Payload({
    planId: null,
    name: "Nouveau plan",
    dailyCalories: 1700,
    proteinBp: 2800,
    carbBp: 4800,
    fatBp: 2400,
    slots: répartition.allocations,
  }) as {
    plan_id: string | null;
    profile: { profile_key: string; daily_calories: number };
    slots: { slot: string; protein_bp: number; display_order: number }[];
  };
  assert.equal(payload.plan_id, null);
  assert.equal(payload.profile.profile_key, "default");
  assert.equal(payload.profile.daily_calories, 1700);
  assert.equal(payload.slots.length, 6);
  assert.deepEqual(
    payload.slots.map((s) => s.slot),
    ["breakfast", "morning_snack", "lunch", "afternoon_snack", "dinner", "dessert"],
  );
  assert.equal(payload.slots[0].protein_bp, 1667);
  assert.equal(payload.slots[5].display_order, 5);
});

await test("13. le retour canonique de la RPC est relu sans perte", () => {
  const résultat = parseCanonicalRpcResult({
    plan: { id: "plan-1", name: "Plan v2", nutrition_model_version: 2, converted: true },
    profile: {
      id: "profil-1",
      plan_id: "plan-1",
      profile_key: "default",
      daily_calories: 1700,
      protein_bp: 2800,
      carb_bp: 4800,
      fat_bp: 2400,
    },
    slots: [
      { profile_id: "profil-1", slot: "breakfast", enabled: true, protein_bp: 1667, carb_bp: 1667, fat_bp: 1667, display_order: 0 },
      { profile_id: "profil-1", slot: "lunch", enabled: true, protein_bp: 3000, carb_bp: 3000, fat_bp: 3000, display_order: 2 },
    ],
    daily_target: { calories: 1700, protein: 119, carbs: 204, fat: 45 },
  });
  assert.equal(résultat.ok, true);
  if (!résultat.ok) return;
  assert.equal(résultat.converted, true);
  assert.equal(résultat.plan.nutritionModelVersion, 2);
  assert.equal(résultat.plan.profiles.length, 1);
  // Les six créneaux sont TOUJOURS matérialisés, même absents en base.
  assert.equal(résultat.plan.profiles[0].slots.length, 6);
  const dessert = résultat.plan.profiles[0].slots.find((s) => s.slot === "dessert");
  assert.equal(dessert?.enabled, false);
  assert.equal(dessert?.proteinBp, 0);
  assert.deepEqual(résultat.dailyTarget, { calories: 1700, protein: 119, carbs: 204, fat: 45 });
});

await test("14. un retour illisible ou incomplet est rejeté sans exception", () => {
  assert.equal(parseCanonicalRpcResult(null).ok, false);
  assert.equal(parseCanonicalRpcResult("bonjour").ok, false);
  assert.equal(parseCanonicalRpcResult({ plan: { id: "x" } }).ok, false);
});

await test("15. la composition d'un profil trie les créneaux par ordre d'affichage", () => {
  const profil = composeProfile(
    {
      id: "p",
      plan_id: "plan",
      profile_key: "default",
      daily_calories: 1700,
      protein_bp: 2800,
      carb_bp: 4800,
      fat_bp: 2400,
    },
    [
      { profile_id: "p", slot: "dinner", enabled: true, protein_bp: 100, carb_bp: 0, fat_bp: 0, display_order: 4 },
      { profile_id: "p", slot: "breakfast", enabled: true, protein_bp: 200, carb_bp: 0, fat_bp: 0, display_order: 0 },
    ],
  );
  assert.deepEqual(
    profil.slots.map((s) => s.slot),
    ["breakfast", "morning_snack", "lunch", "afternoon_snack", "dinner", "dessert"],
  );
  assert.equal(profil.slots[0].proteinBp, 200);
  assert.equal(profil.slots[4].proteinBp, 100);
});

/* ─────────────── 16-18. Gardes textuelles sur la migration ─────────────── */

await test("16. la migration est strictement additive : aucun backfill, DEFAULT 1", () => {
  const migration = lire("../../supabase/migrations/20260804090000_nutrition_plan_profiles_v2.sql");
  assert.ok(
    migration.includes("add column if not exists nutrition_model_version integer not null default 1"),
  );
  // Aucune écriture de masse sur les plans existants.
  assert.ok(
    !/update\s+public\.nutrition_plans\s+set[\s\S]{0,400}?where\s+true/i.test(migration),
    "un backfill non ciblé a été introduit",
  );
  assert.ok(!/insert\s+into\s+public\.nutrition_plan_profiles\s*\([^)]*\)\s*select/i.test(migration),
    "un backfill par SELECT a été introduit");
  // Aucune table de recettes : elles appartiennent à la PR 3.
  for (const table of ["recipes", "recipe_ingredients", "recipe_steps", "recipe_meal_slots", "recipe_substitutions"]) {
    assert.ok(
      !new RegExp(`create table[^;]*public\\.${table}\\b`, "i").test(migration),
      `la table ${table} appartient à la PR 3`,
    );
  }
});

await test("17. la RPC respecte les conventions de sécurité du dépôt", () => {
  const migration = lire("../../supabase/migrations/20260804090000_nutrition_plan_profiles_v2.sql");
  assert.ok(migration.includes("security invoker"), "la RPC doit être security invoker");
  assert.ok(migration.includes("set search_path = ''"), "search_path doit être verrouillé");
  assert.ok(migration.includes("if not public.is_coach_or_admin() then"), "garde staff absente");
  assert.ok(migration.includes("revoke all on function public.save_nutrition_plan_v2(jsonb) from public"));
  assert.ok(migration.includes("revoke execute on function public.save_nutrition_plan_v2(jsonb) from anon"));
  assert.ok(migration.includes("grant execute on function public.save_nutrition_plan_v2(jsonb) to authenticated"));
  assert.ok(
    !/grant execute on function public\.save_nutrition_plan_v2\(jsonb\) to (public|anon)/i.test(migration),
    "EXECUTE ne doit jamais être accordé à public ni anon",
  );
  // Toutes les relations manipulées sont qualifiées.
  const corps = migration.slice(migration.indexOf("create or replace function public.save_nutrition_plan_v2"));
  for (const relation of ["nutrition_plans", "nutrition_plan_profiles", "nutrition_meal_slot_targets"]) {
    const nonQualifiées = corps.match(new RegExp(`(?<!public\\.)\\b${relation}\\b`, "g")) ?? [];
    // Les seules occurrences non préfixées admises sont dans les commentaires
    // et les messages : on vérifie qu'aucune ne suit un mot-clé SQL.
    for (const motCle of ["from", "into", "update", "join", "delete from"]) {
      assert.ok(
        !new RegExp(`${motCle}\\s+${relation}\\b`, "i").test(corps),
        `relation non qualifiée après « ${motCle} » : ${relation} (${nonQualifiées.length} occurrences brutes)`,
      );
    }
  }
});

await test("18. les tables v2 sont protégées par RLS, anon n'a aucun privilège", () => {
  const migration = lire("../../supabase/migrations/20260804090000_nutrition_plan_profiles_v2.sql");
  for (const table of ["nutrition_plan_profiles", "nutrition_meal_slot_targets"]) {
    assert.ok(migration.includes(`alter table public.${table} enable row level security`));
    assert.ok(migration.includes(`revoke all on table public.${table} from anon`));
    assert.ok(migration.includes(`revoke all on table public.${table} from public`));
    assert.ok(migration.includes(`grant select, insert, update, delete on table public.${table} to authenticated`));
    assert.ok(migration.includes(`"${table}_manage_staff" on public.${table}`));
    assert.ok(migration.includes(`"${table}_select_assigned" on public.${table}`));
  }
  // L'élève ne dispose QUE d'un select ; aucune policy d'écriture pour lui.
  assert.ok(!/nutrition_plan_profiles_(insert|update|delete)_self/i.test(migration));
  assert.ok(!/nutrition_meal_slot_targets_(insert|update|delete)_self/i.test(migration));
});

console.log(`\n${réussis} réussis, ${échecs} échecs`);
if (échecs > 0) process.exit(1);
