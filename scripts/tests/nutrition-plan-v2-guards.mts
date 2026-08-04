/**
 * Harnais — feat/nutrition-adaptive-recipes, PR 1, volets G et H.
 *
 * MATRICE DE COMPATIBILITÉ v1 / v2 :
 *
 *   écriture v1 sur plan v1 ........................ autorisée
 *   écriture v1 sur plan v2 ........................ REFUSÉE, sans écriture
 *   RPC v2 sur plan v2 ............................. autorisée
 *   RPC v2 sur plan v1 (conversion explicite) ...... autorisée
 *   conversion automatique au chargement ........... jamais
 *
 * Vérifie aussi la parité du `daily_target` de compatibilité entre le
 * TypeScript et la formule de la RPC (migration 20260804090000), et la
 * lecture canonique d'un plan v2.
 *
 * Aucun réseau : le client Supabase est remplacé par un double qui journalise
 * les appels, ce qui permet de prouver qu'un refus n'écrit RIEN.
 *
 * Lancement : npx tsx scripts/tests/nutrition-plan-v2-guards.mts
 */
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

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
import { evaluateLegacyWriteForPlan, updateNutritionPlan } from "../../lib/supabase/nutrition";
import {
  buildLegacyDailyTarget,
  buildSaveNutritionPlanV2Payload,
  composeProfile,
  parseCanonicalRpcResult,
} from "../../lib/supabase/nutrition-v2";
import type { NutritionPlanBuilderData } from "../../components/admin/NutritionPlanBuilder";

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

/* ─────────────── Double de client Supabase ─────────────── */

type LigneVersion = { nutrition_model_version: number } | null;

/**
 * Double minimal : journalise chaque opération pour PROUVER qu'un refus
 * n'entraîne aucune écriture. Toute méthode de chaînage renvoie le même
 * objet, comme le fait le vrai client.
 */
function clientDouble(version: LigneVersion, journal: string[]) {
  const chaîne = {
    select: () => chaîne,
    eq: () => chaîne,
    in: () => chaîne,
    order: () => chaîne,
    maybeSingle: async () => ({ data: version, error: null }),
    single: async () => ({ data: version, error: null }),
    then: undefined,
  };
  const client = {
    from(table: string) {
      journal.push(`from:${table}`);
      return {
        ...chaîne,
        update: (valeurs: Record<string, unknown>) => {
          journal.push(`update:${table}:${Object.keys(valeurs).sort().join(",")}`);
          return { eq: async () => ({ error: null }) };
        },
        delete: () => {
          journal.push(`delete:${table}`);
          return { eq: async () => ({ error: null }) };
        },
        insert: (valeurs: unknown) => {
          journal.push(`insert:${table}`);
          void valeurs;
          return {
            select: () => ({ single: async () => ({ data: { id: "id-factice" }, error: null }) }),
          };
        },
      };
    },
  };
  return client as unknown as Parameters<typeof evaluateLegacyWriteForPlan>[0];
}

const DONNEES_V1: NutritionPlanBuilderData = {
  name: "Plan historique",
  goalType: "maintien",
  caloriesPerDay: 1700,
  protein: 119,
  carbs: 204,
  fat: 45,
  weeklyTargetCalories: 11900,
  status: "brouillon",
  coachNotes: "",
  hydrationTip: "",
  supplements: [],
  shoppingList: [],
  days: [],
};

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

/* ─────────────── 6-8. La matrice, branchée sur la couche Supabase ────── */

await test("6. la garde lit bien nutrition_model_version avant toute écriture", async () => {
  const journal: string[] = [];
  const décision = await evaluateLegacyWriteForPlan(
    clientDouble({ nutrition_model_version: 2 }, journal),
    "plan-v2",
  );
  assert.equal(décision.allowed, false);
  assert.equal(décision.message, LEGACY_WRITE_ON_V2_MESSAGE_FR);
  assert.deepEqual(journal, ["from:nutrition_plans"]);
});

await test("7. updateNutritionPlan refuse un plan v2 SANS écrire une seule ligne", async () => {
  const journal: string[] = [];
  const ok = await updateNutritionPlan(clientDouble({ nutrition_model_version: 2 }, journal), "plan-v2", DONNEES_V1);
  assert.equal(ok, false);
  assert.deepEqual(journal, ["from:nutrition_plans"], `journal inattendu : ${journal.join(" | ")}`);
  assert.ok(!journal.some((l) => l.startsWith("update:")), "aucun UPDATE ne doit partir");
  assert.ok(!journal.some((l) => l.startsWith("delete:")), "aucun DELETE ne doit partir");
  assert.ok(!journal.some((l) => l.startsWith("insert:")), "aucun INSERT ne doit partir");
});

await test("8. updateNutritionPlan écrit normalement sur un plan v1", async () => {
  const journal: string[] = [];
  const ok = await updateNutritionPlan(clientDouble({ nutrition_model_version: 1 }, journal), "plan-v1", DONNEES_V1);
  assert.equal(ok, true);
  assert.ok(journal.some((l) => l.startsWith("update:nutrition_plans")), journal.join(" | "));
  assert.ok(journal.some((l) => l.startsWith("delete:nutrition_days")), journal.join(" | "));
  // Le chemin v1 continue bien d'écrire daily_target — c'est sa raison d'être.
  assert.ok(journal.some((l) => l.includes("daily_target")), journal.join(" | "));
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
