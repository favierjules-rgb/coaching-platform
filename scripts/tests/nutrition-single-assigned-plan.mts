/**
 * Harnais — fix/nutrition-single-assigned-plan.
 *
 * BUG CORRIGÉ. Deux plans nutritionnels pouvaient être assignés au même
 * élève, tous deux affichés « ACTIF » côté élève. Trois causes cumulées :
 *   1. `setNutritionAssignment` faisait un UPDATE sur le SEUL plan ciblé ;
 *   2. la garde validait « ce plan est-il complet ? », jamais « cet élève
 *      a-t-il déjà un plan ? » ;
 *   3. la base ne portait AUCUN invariant sur `nutrition_plans.student_id`.
 *
 * OÙ CHAQUE EXIGENCE EST PROUVÉE.
 *   - Ce fichier prouve l'ORCHESTRATION : routage de toutes les écritures
 *     vers la RPC unique, absence d'enchaînement client « désassigner puis
 *     assigner », choix unique dans les modales, traduction des refus,
 *     contenu de la migration, non-régression programmes/documents.
 *   - Le comportement TRANSACTIONNEL réel (verrouillage, atomicité, index
 *     unique, rollback) est prouvé sur un vrai PostgreSQL par
 *     supabase/tests/nutrition_single_assigned_plan_checklist.sql.
 *
 * Lancement : npx tsx scripts/tests/nutrition-single-assigned-plan.mts
 */
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

import {
  planSingleAssignmentWrites,
  terminerAssignation,
  terminerAssignationUnique,
  toggleSingleSelection,
  toggleStudentSelection,
} from "../../lib/assignment-selection";
import {
  ASSIGN_REFUSED_BY_DATABASE_FR,
  ASSIGN_REFUSED_INCOMPLETE_FR,
  assignNutritionPlan,
  describeNutritionAssignmentError,
  parseNutritionAssignmentResult,
  unassignNutritionPlan,
} from "../../lib/supabase/nutrition-assignment";
import { setNutritionAssignment } from "../../lib/supabase/nutrition";

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
function sansCommentaires(source: string): string {
  return source.replace(/\/\*[\s\S]*?\*\//g, "").replace(/\/\/[^\n]*/g, "");
}
/** Retire les commentaires SQL (`-- …`) : on assertionne le CODE, pas la prose. */
function sansCommentairesSql(source: string): string {
  return source
    .split("\n")
    .map((ligne) => ligne.replace(/--.*$/, ""))
    .join("\n");
}

const MIGRATION = lire("../../supabase/migrations/20260806090000_assign_nutrition_plan_unique.sql");
const CHECKLIST = lire("../../supabase/tests/nutrition_single_assigned_plan_checklist.sql");
const COUCHE_NUTRITION = lire("../../lib/supabase/nutrition.ts");
const COUCHE_ASSIGNATION = lire("../../lib/supabase/nutrition-assignment.ts");
const MODALE_CONTENU = lire("../../components/admin/AssignContentToStudentModal.tsx");
const MODALE_ELEVES = lire("../../components/admin/AssignStudentsModal.tsx");
const HOOK_CONTENU = lire("../../hooks/useContentAssignment.ts");
const HOOK_GARDE = lire("../../hooks/useGuardedNutritionAssignment.ts");
const PAGE_ELEVE_NUTRITION = lire("../../app/(student)/nutrition/page.tsx");
const HOOK_ELEVE = lire("../../hooks/useSupabaseNutritionForStudent.ts");
const CINQ_POINTS = {
  "/admin/nutrition": lire("../../app/admin/nutrition/page.tsx"),
  "/admin/nutrition/[planId]": lire("../../app/admin/nutrition/[planId]/page.tsx"),
  "/admin/nutrition/nouveau": lire("../../app/admin/nutrition/nouveau/page.tsx"),
  "/admin/eleves": lire("../../app/admin/eleves/page.tsx"),
  "/admin/eleves/[studentId]": lire("../../app/admin/eleves/[studentId]/page.tsx"),
};

/* ──────────────────────────────────────────────────────────────────────────
   BASE SIMULÉE — modèle fidèle des RPC et de l'index unique partiel
   ────────────────────────────────────────────────────────────────────────── */

interface PlanRow {
  id: string;
  name: string;
  student_id: string | null;
  status: string;
  nutrition_model_version: number;
  /** false = plan v2 incomplet : la RPC doit refuser. */
  assignable: boolean;
}

/**
 * Reproduit le contrat de la migration 20260806090000 : validation AVANT
 * écriture, retrait des autres plans de l'élève puis assignation, le tout
 * appliqué d'un bloc (aucun état intermédiaire observable), et l'index
 * unique partiel vérifié après coup.
 */
function créerBaseSimulée(plans: PlanRow[]) {
  const appels: string[] = [];
  const état = plans.map((p) => ({ ...p }));

  function vérifierInvariant(instant: string) {
    const vus = new Map<string, number>();
    for (const p of état) {
      if (!p.student_id) continue;
      vus.set(p.student_id, (vus.get(p.student_id) ?? 0) + 1);
    }
    for (const [élève, n] of vus) {
      if (n > 1) {
        throw new Error(
          `VIOLATION nutrition_plans_one_plan_per_student (${instant}) : ${n} plans pour l'élève ${élève}`,
        );
      }
    }
  }

  const rpc = async (fn: string, args: Record<string, unknown>) => {
    appels.push(`rpc:${fn}`);
    if (fn === "assign_nutrition_plan") {
      const planId = args.p_plan_id as string;
      const studentId = args.p_student_id as string;
      const plan = état.find((p) => p.id === planId);
      if (!plan) return { data: null, error: { message: "PLAN_NOT_FOUND: " + planId } };
      // VALIDATION AVANT TOUTE ÉCRITURE.
      if (plan.nutrition_model_version === 2 && !plan.assignable) {
        return { data: null, error: { message: "PLAN_NOT_ASSIGNABLE: protein_split_incomplete" } };
      }
      // Retrait des autres, PUIS assignation — d'un seul bloc.
      const retirés = état.filter((p) => p.student_id === studentId && p.id !== planId);
      for (const p of retirés) p.student_id = null;
      plan.student_id = studentId;
      vérifierInvariant("assign");
      return {
        data: {
          plan: { id: plan.id, name: plan.name, status: plan.status, student_id: plan.student_id, nutrition_model_version: plan.nutrition_model_version },
          unassigned_plan_ids: retirés.map((p) => p.id),
          assigned: true,
        },
        error: null,
      };
    }
    if (fn === "unassign_nutrition_plan") {
      const planId = args.p_plan_id as string;
      const plan = état.find((p) => p.id === planId);
      if (!plan) return { data: null, error: { message: "PLAN_NOT_FOUND: " + planId } };
      plan.student_id = null;
      vérifierInvariant("unassign");
      return {
        data: {
          plan: { id: plan.id, name: plan.name, status: plan.status, student_id: null, nutrition_model_version: plan.nutrition_model_version },
          unassigned_plan_ids: [],
          assigned: false,
        },
        error: null,
      };
    }
    return { data: null, error: { message: "UNKNOWN_RPC" } };
  };

  // `from()` ne sert qu'aux lectures annexes (nom du plan, journal
  // d'activité). Toute tentative d'UPDATE sur nutrition_plans est ENREGISTRÉE
  // pour être assertée absente.
  const from = (table: string) => {
    const chaîne = {
      select: () => chaîne,
      eq: () => chaîne,
      insert: () => {
        appels.push(`insert:${table}`);
        return Promise.resolve({ data: null, error: null });
      },
      update: () => {
        appels.push(`UPDATE:${table}`);
        return chaîne;
      },
      maybeSingle: () => Promise.resolve({ data: { name: "Plan" }, error: null }),
      then: (r: (v: unknown) => unknown) => Promise.resolve({ data: [], error: null }).then(r),
    };
    return chaîne;
  };

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const supabase = { rpc, from } as any;
  return {
    supabase,
    appels,
    assignés: (studentId: string) => état.filter((p) => p.student_id === studentId).map((p) => p.id),
    plan: (id: string) => état.find((p) => p.id === id)!,
    état,
  };
}

const PLANS: PlanRow[] = [
  { id: "A", name: "Plan A", student_id: null, status: "actif", nutrition_model_version: 1, assignable: true },
  { id: "B", name: "Plan B", student_id: null, status: "actif", nutrition_model_version: 2, assignable: true },
  { id: "C", name: "Plan C incomplet", student_id: null, status: "prochain", nutrition_model_version: 2, assignable: false },
];
const ÉLÈVE = "eleve-1";

/* ────────────────────── 1 à 12 — comportement produit ────────────────────── */

await test("1. un élève sans plan peut recevoir un plan valide", async () => {
  const db = créerBaseSimulée(PLANS);
  assert.deepEqual(db.assignés(ÉLÈVE), [], "état de départ : aucun plan");
  const ok = await setNutritionAssignment(db.supabase, ÉLÈVE, "A", true);
  assert.equal(ok, true);
  assert.deepEqual(db.assignés(ÉLÈVE), ["A"]);
});

await test("2. un élève avec un plan A reçoit un plan B valide", async () => {
  const db = créerBaseSimulée(PLANS);
  await setNutritionAssignment(db.supabase, ÉLÈVE, "A", true);
  const ok = await setNutritionAssignment(db.supabase, ÉLÈVE, "B", true);
  assert.equal(ok, true, "l'assignation de B doit réussir");
});

await test("3. après succès, A est désassigné et B est le SEUL assigné", async () => {
  const db = créerBaseSimulée(PLANS);
  await setNutritionAssignment(db.supabase, ÉLÈVE, "A", true);
  await setNutritionAssignment(db.supabase, ÉLÈVE, "B", true);
  assert.deepEqual(db.assignés(ÉLÈVE), ["B"], "un seul plan assigné");
  assert.equal(db.plan("A").student_id, null, "A a bien été désassigné");
});

await test("4. un plan B incomplet est refusé", async () => {
  const db = créerBaseSimulée(PLANS);
  const résultat = await assignNutritionPlan(db.supabase, "C", ÉLÈVE);
  assert.equal(résultat.ok, false);
  assert.equal(résultat.ok === false && résultat.code, "plan_not_assignable");
  assert.equal(résultat.ok === false && résultat.message, ASSIGN_REFUSED_INCOMPLETE_FR);
});

await test("5. après ce refus, A reste assigné — AUCUNE ligne modifiée", async () => {
  const db = créerBaseSimulée(PLANS);
  await setNutritionAssignment(db.supabase, ÉLÈVE, "A", true);
  const avant = JSON.stringify(db.état);
  const ok = await setNutritionAssignment(db.supabase, ÉLÈVE, "C", true);
  assert.equal(ok, false, "l'écriture doit échouer");
  assert.deepEqual(db.assignés(ÉLÈVE), ["A"], "A reste assigné");
  assert.equal(JSON.stringify(db.état), avant, "aucune ligne n'a bougé");
});

await test("6. aucune fenêtre sans plan : une SEULE écriture part au remplacement", async () => {
  // Le cœur du correctif côté client : quand un nouveau plan est choisi,
  // AUCUN retrait n'est émis — la RPC s'en charge dans sa transaction.
  const plan = planSingleAssignmentWrites(["A"], ["B"]);
  assert.equal(plan.assign, "B");
  assert.deepEqual(plan.unassign, [], "aucun retrait client : pas de fenêtre sans plan");

  const écritures: Array<[string, boolean]> = [];
  const r = await terminerAssignationUnique(["A"], ["B"], (id, assigned) => {
    écritures.push([id, assigned]);
    return true;
  });
  assert.equal(r.ok, true);
  assert.deepEqual(écritures, [["B", true]], "exactement une écriture, une assignation");
});

await test("7. aucune possibilité d'avoir deux plans avec le même student_id", async () => {
  const db = créerBaseSimulée(PLANS);
  await setNutritionAssignment(db.supabase, ÉLÈVE, "A", true);
  await setNutritionAssignment(db.supabase, ÉLÈVE, "B", true);
  await setNutritionAssignment(db.supabase, ÉLÈVE, "A", true);
  assert.equal(db.assignés(ÉLÈVE).length, 1, "jamais plus d'un plan");
  // L'invariant est aussi posé EN BASE, pas seulement dans le code.
  assert.ok(
    MIGRATION.includes("create unique index if not exists nutrition_plans_one_plan_per_student"),
    "l'index unique partiel doit exister",
  );
  assert.ok(MIGRATION.includes("on public.nutrition_plans (student_id)"));
  assert.ok(MIGRATION.includes("where student_id is not null"));
});

await test("8. rejeu de l'assignation du même plan : idempotent", async () => {
  const db = créerBaseSimulée(PLANS);
  await setNutritionAssignment(db.supabase, ÉLÈVE, "B", true);
  const r1 = await assignNutritionPlan(db.supabase, "B", ÉLÈVE);
  const r2 = await assignNutritionPlan(db.supabase, "B", ÉLÈVE);
  assert.equal(r1.ok && r2.ok, true);
  assert.deepEqual(db.assignés(ÉLÈVE), ["B"]);
  assert.deepEqual(r2.ok && r2.unassignedPlanIds, [], "un rejeu ne retire rien");
  // Le SQL exclut explicitement le plan cible du retrait.
  assert.ok(MIGRATION.includes("and np.id <> p_plan_id"), "le plan cible est exclu du retrait");
});

await test("9. désassignation volontaire autorisée, même sur un plan invalide", async () => {
  const db = créerBaseSimulée(PLANS);
  db.plan("C").student_id = ÉLÈVE;
  const résultat = await unassignNutritionPlan(db.supabase, "C");
  assert.equal(résultat.ok, true, "un plan invalide doit pouvoir être retiré");
  assert.deepEqual(db.assignés(ÉLÈVE), []);
  // La RPC de retrait ne fait AUCUNE validation v2, volontairement.
  const corpsRetrait = MIGRATION.slice(MIGRATION.indexOf("function public.unassign_nutrition_plan"));
  assert.ok(!corpsRetrait.includes("nutrition_plan_v2_blocking_issue"), "aucune validation au retrait");
});

await test("10. plan v1 toujours assignable", async () => {
  const db = créerBaseSimulée(PLANS);
  assert.equal(db.plan("A").nutrition_model_version, 1);
  const résultat = await assignNutritionPlan(db.supabase, "A", ÉLÈVE);
  assert.equal(résultat.ok, true);
  // Le SQL ne valide que la version 2.
  assert.ok(MIGRATION.includes("if v_plan.nutrition_model_version = 2 then"));
});

await test("11. plan v2 complet assignable", async () => {
  const db = créerBaseSimulée(PLANS);
  assert.equal(db.plan("B").nutrition_model_version, 2);
  const résultat = await assignNutritionPlan(db.supabase, "B", ÉLÈVE);
  assert.equal(résultat.ok, true);
  assert.deepEqual(db.assignés(ÉLÈVE), ["B"]);
});

await test("12. plan v2 incomplet refusé, avec un message exploitable", async () => {
  const db = créerBaseSimulée(PLANS);
  const résultat = await assignNutritionPlan(db.supabase, "C", ÉLÈVE);
  assert.equal(résultat.ok, false);
  assert.match(résultat.ok === false ? résultat.message : "", /répartition/i);
  // Les règles SQL reproduisent bien validatePlanV2Assignable.
  for (const code of [
    "missing_default_profile",
    "calories_not_positive",
    "daily_split_incomplete",
    "no_enabled_slot",
    "disabled_slot_with_allocation",
    "protein_split_incomplete",
    "carb_split_incomplete",
    "fat_split_incomplete",
  ]) {
    assert.ok(MIGRATION.includes(`'${code}'`), `la validation SQL doit couvrir ${code}`);
  }
});

/* ────────────────── 13 — les cinq points d'entrée réels ────────────────── */

await test("13a. les cinq points d'entrée passent par la garde puis par la RPC", () => {
  for (const [chemin, source] of Object.entries(CINQ_POINTS)) {
    assert.ok(
      source.includes("useGuardedNutritionAssignment"),
      `${chemin} doit utiliser la garde d'assignation`,
    );
    assert.ok(
      source.includes("useContentAssignment"),
      `${chemin} doit passer par useContentAssignment`,
    );
  }
  // useContentAssignment route la nutrition vers setNutritionAssignment…
  assert.ok(HOOK_CONTENU.includes("nutrition: setNutritionAssignment"));
  // …qui ne fait plus AUCUNE écriture directe : elle délègue aux RPC.
  assert.ok(COUCHE_NUTRITION.includes("assignNutritionPlan(supabase, planId, studentId)"));
  assert.ok(COUCHE_NUTRITION.includes("unassignNutritionPlan(supabase, planId)"));
});

await test("13b. plus AUCUNE écriture directe de nutrition_plans.student_id", () => {
  const sansCom = sansCommentaires(COUCHE_NUTRITION);
  assert.ok(
    !/student_id\s*:\s*assigned/.test(sansCom),
    "l'ancien UPDATE { student_id: assigned ? … } doit avoir disparu",
  );
  assert.ok(!/\.update\(\{\s*student_id/.test(sansCom), "aucun update direct de student_id");
  // Recherche exhaustive : aucun fichier applicatif n'écrit la colonne.
  for (const [nom, source] of Object.entries({
    "nutrition.ts": COUCHE_NUTRITION,
    "nutrition-assignment.ts": COUCHE_ASSIGNATION,
    "useContentAssignment.ts": HOOK_CONTENU,
    "useGuardedNutritionAssignment.ts": HOOK_GARDE,
    ...CINQ_POINTS,
  })) {
    assert.ok(
      !/\.update\(\s*\{[\s\S]*?student_id/.test(sansCommentaires(source)),
      `${nom} ne doit pas écrire student_id directement`,
    );
  }
});

await test("13c. la RPC est bien appelée, et JAMAIS un UPDATE sur nutrition_plans", async () => {
  const db = créerBaseSimulée(PLANS);
  await setNutritionAssignment(db.supabase, ÉLÈVE, "B", true);
  assert.ok(db.appels.includes("rpc:assign_nutrition_plan"), "la RPC d'assignation doit être appelée");
  assert.ok(
    !db.appels.some((a) => a.startsWith("UPDATE:nutrition_plans")),
    `aucun UPDATE direct attendu — appels : ${db.appels.join(", ")}`,
  );
  const db2 = créerBaseSimulée(PLANS);
  await setNutritionAssignment(db2.supabase, ÉLÈVE, "B", false);
  assert.ok(db2.appels.includes("rpc:unassign_nutrition_plan"), "le retrait passe aussi par une RPC");
  assert.ok(!db2.appels.some((a) => a.startsWith("UPDATE:nutrition_plans")));
});

await test("13d. le journal d'activité reste alimenté à l'assignation", async () => {
  const db = créerBaseSimulée(PLANS);
  await setNutritionAssignment(db.supabase, ÉLÈVE, "B", true);
  assert.ok(db.appels.includes("insert:activity_events"), "l'évènement d'activité doit rester écrit");
});

/* ───────────── 14 — programmes et documents non régressés ───────────── */

await test("14a. programmes et documents gardent la sélection MULTIPLE", () => {
  assert.deepEqual(toggleStudentSelection(["s1"], "s2", true), ["s1", "s2"], "multi-sélection conservée");
  assert.deepEqual(toggleSingleSelection(["s1"], "s2", true), ["s2"], "nutrition : choix unique");
  assert.deepEqual(toggleSingleSelection(["s1"], "s1", false), [], "décocher vide la sélection");
  // Immuabilité : jamais de mutation du tableau reçu.
  const source = ["s1"];
  assert.notEqual(toggleSingleSelection(source, "s2", true), source);
});

await test("14b. programmes et documents gardent l'enchaînement retrait + ajout", async () => {
  const écritures: Array<[string, boolean]> = [];
  await terminerAssignation(["p1"], ["p2"], (id, assigned) => {
    écritures.push([id, assigned]);
    return true;
  });
  assert.deepEqual(
    écritures,
    [["p2", true], ["p1", false]],
    "le diff historique des programmes/documents reste inchangé",
  );
});

await test("14c. les modales n'appliquent le choix unique QU'À la nutrition", () => {
  assert.ok(MODALE_CONTENU.includes('type === "nutrition" ? toggleSingleSelection : toggleStudentSelection'));
  assert.ok(MODALE_CONTENU.includes('type === "nutrition" ? terminerAssignationUnique : terminerAssignation'));
  assert.ok(MODALE_ELEVES.includes('contentType === "nutrition"'));
  // Aucune table d'assignation des programmes ou documents n'est touchée
  // par le CODE de la migration (les commentaires, eux, les mentionnent).
  const sql = sansCommentairesSql(MIGRATION);
  assert.ok(!/\bassignments\b/.test(sql), "la migration ne touche pas la table assignments");
  assert.ok(!/\bdocument_assignments\b/.test(sql), "ni document_assignments");
  assert.ok(!/\bprograms\b/.test(sql), "ni la table programs");
});

/* ──────────── 15 — l'espace élève n'affiche qu'un seul plan actif ──────────── */

await test("15a. l'espace élève ne peut plus recevoir qu'un seul plan assigné", async () => {
  const db = créerBaseSimulée(PLANS);
  await setNutritionAssignment(db.supabase, ÉLÈVE, "A", true);
  await setNutritionAssignment(db.supabase, ÉLÈVE, "B", true);
  const vus = db.état.filter((p) => p.student_id === ÉLÈVE);
  assert.equal(vus.length, 1, "une seule ligne remonte à l'espace élève");
  const actifs = vus.filter((p) => p.status === "actif");
  assert.ok(actifs.length <= 1, "au plus un badge ACTIF");
});

await test("15b. le choix du plan affiché n'est plus arbitraire", () => {
  // `activePlan` reste `find(status==='actif') ?? plans[0]`, mais la liste
  // ne peut plus contenir qu'un élément : le choix devient déterministe.
  assert.ok(HOOK_ELEVE.includes('plans.find((p) => p.status === "actif") ?? plans[0]'));
  assert.ok(PAGE_ELEVE_NUTRITION.includes("plans.map("));
  assert.ok(
    MIGRATION.includes("nutrition_plans_one_plan_per_student"),
    "l'unicité est garantie en base, pas par le rendu",
  );
});

/* ──────────────── Migration : contrat, sécurité, prudence ──────────────── */

await test("16. la migration valide AVANT d'écrire, et verrouille", () => {
  const corps = MIGRATION.slice(MIGRATION.indexOf("function public.assign_nutrition_plan"));
  const posVerrou = corps.indexOf("for update");
  const posValidation = corps.indexOf("PLAN_NOT_ASSIGNABLE");
  const posRetrait = corps.indexOf("set student_id = null");
  const posAssignation = corps.indexOf("set student_id = p_student_id");
  assert.ok(posVerrou > 0, "les lignes concernées sont verrouillées");
  assert.ok(posValidation > posVerrou, "la validation vient après le verrou");
  assert.ok(posRetrait > posValidation, "AUCUNE écriture avant la validation complète");
  assert.ok(posAssignation > posRetrait, "retrait des autres AVANT l'assignation (index unique)");
  assert.ok(corps.includes("order by np.id"), "ordre de verrouillage stable : pas d'interblocage");
});

await test("17. sécurité et privilèges conformes au projet", () => {
  for (const signature of [
    "public.assign_nutrition_plan(uuid, uuid)",
    "public.unassign_nutrition_plan(uuid)",
    "public.nutrition_plan_v2_blocking_issue(uuid)",
  ]) {
    assert.ok(MIGRATION.includes(`alter function ${signature} owner to postgres;`), `owner de ${signature}`);
    assert.ok(MIGRATION.includes(`revoke all on function ${signature} from public;`), `revoke public ${signature}`);
    assert.ok(MIGRATION.includes(`revoke execute on function ${signature} from anon;`), `revoke anon ${signature}`);
    assert.ok(
      MIGRATION.includes(`grant execute on function ${signature} to authenticated;`),
      `grant authenticated ${signature}`,
    );
  }
  // Lignes de DÉCLARATION uniquement : les `comment on function` citent aussi
  // « security invoker » dans leur texte, ce qui fausserait un simple compte.
  const lignes = sansCommentairesSql(MIGRATION).split("\n").map((l) => l.trim());
  assert.equal(
    lignes.filter((l) => l === "security invoker").length,
    3,
    "les trois fonctions sont déclarées security invoker",
  );
  assert.equal(
    lignes.filter((l) => l === "set search_path = ''").length,
    3,
    "search_path verrouillé sur les trois fonctions",
  );
  const sql = sansCommentairesSql(MIGRATION);
  assert.ok(!/security definer/i.test(sql), "aucune fonction en security definer");
  assert.equal(
    sql.split("if not public.is_coach_or_admin() then").length - 1,
    2,
    "les deux RPC d'écriture sont gardées par is_coach_or_admin",
  );
  assert.ok(
    !/grant execute on function public\.(assign|unassign)_nutrition_plan[^;]*to (public|anon)/i.test(MIGRATION),
    "jamais de grant à public ou anon",
  );
});

await test("18. la migration ne choisit ni ne supprime aucune ligne en cas de doublon", () => {
  assert.ok(MIGRATION.includes("MIGRATION IMPOSSIBLE"), "elle échoue clairement");
  assert.ok(MIGRATION.includes("having count(*) > 1"), "elle détecte les doublons existants");
  const sansCom = sansCommentaires(MIGRATION);
  assert.ok(!/\bdelete\s+from\b/i.test(sansCom), "aucune suppression de ligne");
  assert.ok(!/\blimit\s+1\b/i.test(sansCom), "aucun choix arbitraire d'une ligne");
  // La détection précède la création de l'index.
  assert.ok(
    MIGRATION.indexOf("MIGRATION IMPOSSIBLE") < MIGRATION.indexOf("create unique index"),
    "la vérification passe AVANT la création de l'index",
  );
});

await test("19. la traduction des refus est complète et française", () => {
  assert.equal(describeNutritionAssignmentError("NOT_AUTHORIZED").code, "not_authorized");
  assert.equal(describeNutritionAssignmentError("PLAN_NOT_FOUND: x").code, "plan_not_found");
  assert.equal(describeNutritionAssignmentError("STUDENT_NOT_FOUND: x").code, "student_not_found");
  assert.equal(describeNutritionAssignmentError("PLAN_NOT_ASSIGNABLE: no_enabled_slot").code, "plan_not_assignable");
  assert.equal(
    describeNutritionAssignmentError('duplicate key value violates unique constraint "nutrition_plans_one_plan_per_student"').code,
    "duplicate_assignment",
  );
  assert.equal(describeNutritionAssignmentError(null).code, "unknown");
  for (const brut of ["NOT_AUTHORIZED", "PLAN_NOT_FOUND: x", null]) {
    const { message } = describeNutritionAssignmentError(brut);
    assert.ok(message.length > 10 && !/[A-Z_]{6,}/.test(message), `message lisible attendu : ${message}`);
  }
  assert.ok(HOOK_GARDE.includes("ASSIGN_REFUSED_BY_DATABASE_FR"), "un refus de la base est affiché à l'écran");
  assert.equal(typeof ASSIGN_REFUSED_BY_DATABASE_FR, "string");
});

await test("20. le retour canonique des RPC est lu sans supposition", () => {
  const bon = parseNutritionAssignmentResult({
    plan: { id: "B", student_id: "eleve-1" },
    unassigned_plan_ids: ["A"],
    assigned: true,
  });
  assert.equal(bon.ok && bon.planId, "B");
  assert.deepEqual(bon.ok && bon.unassignedPlanIds, ["A"]);
  assert.equal(parseNutritionAssignmentResult(null).ok, false, "un retour vide n'est pas un succès");
  assert.equal(parseNutritionAssignmentResult({ plan: {} }).ok, false);
  const sansListe = parseNutritionAssignmentResult({ plan: { id: "B" }, assigned: true });
  assert.deepEqual(sansListe.ok && sansListe.unassignedPlanIds, [], "liste absente ⇒ tableau vide, pas une erreur");
});

await test("21. la checklist PostgreSQL couvre RPC, privilèges, unicité, atomicité et propreté", () => {
  for (const attendu of [
    "rollback;",
    "nutrition_plans_one_plan_per_student",
    "public.assign_nutrition_plan",
    "public.unassign_nutrition_plan",
    "has_function_privilege('anon'",
    "has_function_privilege('authenticated'",
    "prosecdef",
    "search_path",
    "unique_violation",
    "AUCUN état partiel",
    "aucune donnée de test persistante après le ROLLBACK",
  ]) {
    assert.ok(CHECKLIST.includes(attendu), `la checklist doit couvrir : ${attendu}`);
  }
  assert.ok(/^rollback;$/m.test(CHECKLIST), "la checklist se termine par un ROLLBACK");
  assert.ok(CHECKLIST.indexOf("begin;") < CHECKLIST.indexOf("\nrollback;"), "tout tient dans une transaction");
});

await test("22. la migration est déclarée au manifeste et comptée", () => {
  const manifeste = JSON.parse(lire("../../supabase/baseline/manifest.json"));
  const attendues = manifeste.migrations_post_baseline_attendues as string[];
  assert.equal(attendues.length, 20);
  assert.ok(attendues.includes("20260806090000_assign_nutrition_plan_unique.sql"));
  const secu = lire("../../scripts/tests/security-hardening.mts");
  assert.ok(secu.includes(".length, 47,"), "le compteur de migrations suit les migrations réelles");
  assert.ok(secu.includes("assert.equal(attendues.length, 20);"));
});

console.log(`\n${réussis} réussis, ${échecs} échecs`);
if (échecs > 0) process.exit(1);
