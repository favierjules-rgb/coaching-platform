/**
 * P13-A — ISOLATION RLS DU CŒUR NUTRITION ENTRE COACHS
 *
 *   npm run test:rls-nutrition-isolation
 *
 * CE QUE CES TESTS PROUVENT, ET CE QU'ILS NE PROUVENT PAS
 * ───────────────────────────────────────────────────────
 * Ils tiennent en deux moitiés, et la distinction est importante :
 *
 *   1. UNE SIMULATION SÉMANTIQUE (section « MATRICE »). La règle de propriété
 *      est réimplémentée ici en TypeScript, puis exécutée contre une base
 *      fictive comportant DEUX coachs, trois élèves (dont un sans coach) et
 *      six plans — y compris le plan incohérent que porte la vraie base. La
 *      matrice vérifie les quatre commandes SQL pour six identités. C'est la
 *      règle elle-même qui est testée, pas sa présence dans un fichier.
 *
 *   2. DES ASSERTIONS STATIQUES sur la migration (sections « CONTRAT »), qui
 *      vérifient que le SQL encode bien CETTE règle-là, et pas une autre.
 *
 * Ce que ces tests NE prouvent PAS : que PostgreSQL applique effectivement
 * ces policies. Aucun moteur Postgres n'est lancé ici. La preuve réelle est
 * portée par supabase/tests/nutrition_isolation_multi_coachs_checklist.sql,
 * qui exécute de vraies requêtes sous le rôle `authenticated` avec six JWT
 * distincts, et qui doit être lancée séparément contre une base. Les deux
 * moitiés sont complémentaires : la checklist SQL prouve le comportement, ces
 * tests-ci empêchent la régression silencieuse du contrat et tournent sans
 * base de données.
 */

import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const ICI = dirname(fileURLToPath(import.meta.url));
const RACINE = join(ICI, "../..");
const lire = (chemin: string) => readFileSync(join(RACINE, chemin), "utf8");

const CHEMIN_MIGRATION =
  "supabase/migrations/20261002090000_rls_nutrition_isolation_multi_coachs.sql";

/**
 * Retire les commentaires SQL. INDISPENSABLE : cette migration DÉCRIT
 * longuement la faille qu'elle ferme, et cite donc `is_coach_or_admin()`,
 * « USING (true) » et les noms des policies supprimées dans sa prose. Une
 * recherche naïve retomberait sur ces explications et déclarerait la faille
 * toujours présente — ou, pire, déclarerait le correctif absent parce qu'on
 * aurait cessé de le documenter.
 */
function sansCommentairesSql(source: string): string {
  const sansBlocs = source.replace(/\/\*[\s\S]*?\*\//g, " ");
  return sansBlocs
    .split("\n")
    .map((ligne) => {
      const i = ligne.indexOf("--");
      return i === -1 ? ligne : ligne.slice(0, i);
    })
    .join("\n");
}

const MIGRATION_BRUTE = lire(CHEMIN_MIGRATION);
const SQL = sansCommentairesSql(MIGRATION_BRUTE);
const SQL_PLAT = SQL.replace(/\s+/g, " ").toLowerCase();

let passed = 0;
let failed = 0;
function test(nom: string, fn: () => void): void {
  try {
    fn();
    passed += 1;
    console.log(`ok - ${nom}`);
  } catch (error) {
    failed += 1;
    console.error(`ÉCHEC - ${nom}`);
    console.error(error);
  }
}

// ════════════════════════════════════════════════════════════════════════════
// LES HUIT TABLES DU CŒUR NUTRITION
// ════════════════════════════════════════════════════════════════════════════

/**
 * Liste FERMÉE, relevée dans pg_policies sur la base réelle : ce sont les huit
 * tables qui portaient une policy de gestion `FOR ALL` dont le prédicat était
 * `is_coach_or_admin()` seul. Elle est volontairement figée ici : si une
 * neuvième table du domaine apparaissait avec le même défaut, ce test ne la
 * verrait pas — mais la checklist SQL la compterait (contrôle de recensement).
 */
const TABLES_COEUR = [
  "nutrition_plans",
  "nutrition_days",
  "nutrition_plan_profiles",
  "nutrition_meal_slot_targets",
  "meals",
  "meal_choice_slots",
  "meal_choice_options",
  "nutrition_daily_logs",
] as const;

/** Les anciennes policies trop larges, avec leur nom EXACT en base. */
const POLICIES_TROP_LARGES: Record<string, string> = {
  nutrition_plans: "nutrition_plans_manage_staff",
  nutrition_days: "nutrition_days_manage_staff",
  nutrition_plan_profiles: "nutrition_plan_profiles_manage_staff",
  nutrition_meal_slot_targets: "nutrition_meal_slot_targets_manage_staff",
  meals: "meals_manage_staff",
  meal_choice_slots: "meal_choice_slots_manage_staff",
  meal_choice_options: "meal_choice_options_manage_staff",
  nutrition_daily_logs: "nutrition_daily_logs_student_or_staff",
};

/**
 * Les policies de lecture élève, qui sont le modèle de référence du domaine et
 * ne doivent PAS être touchées par ce chantier.
 */
const POLICIES_ELEVE_INTOUCHABLES = [
  "nutrition_plans_select_self_or_assigned",
  "nutrition_days_select_self_or_assigned",
  "nutrition_days_update_self",
  "nutrition_plan_profiles_select_assigned",
  "nutrition_meal_slot_targets_select_assigned",
  "meals_select_self_or_assigned",
  "meal_choice_slots_select_assigned",
  "meal_choice_options_select_assigned",
];

// ════════════════════════════════════════════════════════════════════════════
// MATRICE — SIMULATION SÉMANTIQUE À DEUX COACHS
// ════════════════════════════════════════════════════════════════════════════

type Identite = {
  nom: string;
  /** `coaches.id` du coach courant, ou null — c'est `current_coach_id()`. */
  coachId: string | null;
  /** `students.id` de l'élève courant, ou null — c'est `current_student_id()`. */
  studentId: string | null;
  admin: boolean;
};

type Eleve = { id: string; coachId: string | null };
type Plan = { id: string; studentId: string | null; coachId: string | null };

const ELEVES: Record<string, Eleve> = {
  eleveA: { id: "eleveA", coachId: "coachA" },
  eleveB: { id: "eleveB", coachId: "coachB" },
  // Le cas que la vraie base contient (2 élèves) et que la règle doit traiter :
  // un élève sans coach n'appartient à AUCUN coach.
  eleveOrphelin: { id: "eleveOrphelin", coachId: null },
};

const PLANS: Record<string, Plan> = {
  planA: { id: "planA", studentId: "eleveA", coachId: "coachA" },
  planB: { id: "planB", studentId: "eleveB", coachId: "coachB" },
  modeleA: { id: "modeleA", studentId: null, coachId: "coachA" },
  modeleB: { id: "modeleB", studentId: null, coachId: "coachB" },
  planOrphelin: { id: "planOrphelin", studentId: "eleveOrphelin", coachId: null },
  /**
   * LE PLAN INCOHÉRENT. Il existe réellement en base (1 ligne) : son
   * `coach_id` désigne un coach, mais l'élève qu'il porte a `coach_id IS NULL`.
   * La règle retenue dit que l'ÉLÈVE tranche — ce plan n'appartient donc à
   * AUCUN coach, pas même à celui inscrit dessus.
   */
  planIncoherent: { id: "planIncoherent", studentId: "eleveOrphelin", coachId: "coachA" },
};

const IDENTITES: Record<string, Identite> = {
  coachA: { nom: "coach A", coachId: "coachA", studentId: null, admin: false },
  coachB: { nom: "coach B", coachId: "coachB", studentId: null, admin: false },
  admin: { nom: "admin", coachId: null, studentId: null, admin: true },
  // Un administrateur qui possède AUSSI une fiche coach : c'est l'état réel de
  // la base (coaches contient 1 ligne, dont le user_id est celui de l'admin).
  adminCoach: { nom: "admin+coach A", coachId: "coachA", studentId: null, admin: true },
  eleveA: { nom: "élève A", coachId: null, studentId: "eleveA", admin: false },
  eleveB: { nom: "élève B", coachId: null, studentId: "eleveB", admin: false },
};

/** `is_coach_of_student()` — exige students.coach_id IS NOT NULL. */
function estCoachDeLEleve(moi: Identite, eleveId: string | null): boolean {
  if (eleveId === null || moi.coachId === null) return false;
  const eleve = ELEVES[eleveId];
  if (!eleve) return false;
  return eleve.coachId !== null && eleve.coachId === moi.coachId;
}

/**
 * LA RÈGLE DE PROPRIÉTÉ D'UN PLAN, pour un coach (hors admin).
 * Transcription littérale du prédicat des policies `nutrition_plans_*_own_coach`.
 */
function coachPossedeLePlan(moi: Identite, plan: Plan): boolean {
  if (plan.studentId !== null) {
    // L'élève d'abord. Le coach_id du plan n'est PAS consulté.
    return estCoachDeLEleve(moi, plan.studentId);
  }
  // Plan modèle : le coach propriétaire, avec coach_id IS NOT NULL explicite.
  return plan.coachId !== null && moi.coachId !== null && plan.coachId === moi.coachId;
}

type Commande = "select" | "insert" | "update" | "delete";

/** Accès d'une identité à une ligne de `nutrition_plans`. */
function accesPlan(moi: Identite, plan: Plan, cmd: Commande): boolean {
  if (moi.admin) return true; // nutrition_plans_manage_admin
  if (cmd === "delete") {
    // nutrition_plans_delete_own_coach : propriété ET aucun élève affecté.
    return plan.studentId === null && plan.coachId !== null && plan.coachId === moi.coachId;
  }
  if (coachPossedeLePlan(moi, plan)) return true;
  if (cmd === "select") {
    // nutrition_plans_select_self_or_assigned (policy élève, inchangée).
    return moi.studentId !== null && plan.studentId === moi.studentId;
  }
  return false;
}

/** Accès staff à une table fille, résolu par le plan parent. */
function accesFille(moi: Identite, plan: Plan): boolean {
  if (moi.admin) return true;
  return coachPossedeLePlan(moi, plan);
}

/**
 * Un UPDATE est autorisé seulement si USING accepte la ligne de DÉPART **et**
 * WITH CHECK la ligne d'ARRIVÉE. C'est ce double test qui ferme les
 * contournements par réécriture de `student_id` ou de `coach_id`.
 */
function updateAutorise(moi: Identite, avant: Plan, apres: Plan): boolean {
  return accesPlan(moi, avant, "update") && accesPlan(moi, apres, "update");
}

// ── Tests positifs ─────────────────────────────────────────────────────────

test("MATRICE POSITIF 1. l'admin lit les données nutrition des deux coachs", () => {
  for (const plan of Object.values(PLANS)) {
    assert.ok(accesPlan(IDENTITES.admin, plan, "select"), `admin doit lire ${plan.id}`);
    assert.ok(accesFille(IDENTITES.admin, plan), `admin doit lire les filles de ${plan.id}`);
  }
});

test("MATRICE POSITIF 2. l'admin modifie les données autorisées", () => {
  for (const plan of Object.values(PLANS)) {
    assert.ok(accesPlan(IDENTITES.admin, plan, "update"), `admin doit modifier ${plan.id}`);
    assert.ok(accesPlan(IDENTITES.admin, plan, "insert"), `admin doit insérer sur ${plan.id}`);
  }
});

test("MATRICE POSITIF 3. l'admin garde un accès global même aux plans orphelins", () => {
  assert.ok(accesPlan(IDENTITES.admin, PLANS.planOrphelin, "select"));
  assert.ok(accesPlan(IDENTITES.admin, PLANS.planIncoherent, "select"));
  assert.ok(accesPlan(IDENTITES.admin, PLANS.planIncoherent, "delete"));
});

test("MATRICE POSITIF 4. le coach A lit les données de SES élèves", () => {
  assert.ok(accesPlan(IDENTITES.coachA, PLANS.planA, "select"));
  assert.ok(accesFille(IDENTITES.coachA, PLANS.planA));
  assert.ok(accesPlan(IDENTITES.coachB, PLANS.planB, "select"));
  assert.ok(accesFille(IDENTITES.coachB, PLANS.planB));
});

test("MATRICE POSITIF 5. le coach A opère sur les plans de ses élèves", () => {
  for (const cmd of ["select", "insert", "update"] as Commande[]) {
    assert.ok(accesPlan(IDENTITES.coachA, PLANS.planA, cmd), `coach A doit pouvoir ${cmd}`);
  }
});

test("MATRICE POSITIF 6. le coach A gère son propre plan modèle, DELETE compris", () => {
  for (const cmd of ["select", "insert", "update", "delete"] as Commande[]) {
    assert.ok(accesPlan(IDENTITES.coachA, PLANS.modeleA, cmd), `coach A doit pouvoir ${cmd}`);
  }
});

test("MATRICE POSITIF 7. l'élève conserve l'accès à ses propres données", () => {
  assert.ok(accesPlan(IDENTITES.eleveA, PLANS.planA, "select"));
  assert.ok(accesPlan(IDENTITES.eleveB, PLANS.planB, "select"));
});

test("MATRICE POSITIF 8. l'admin porteur d'une fiche coach garde l'accès global", () => {
  // C'est la configuration RÉELLE de la base. Si elle régressait, l'interface
  // coach actuelle tomberait en panne : ce test-ci le dirait.
  for (const plan of Object.values(PLANS)) {
    assert.ok(accesPlan(IDENTITES.adminCoach, plan, "select"), `doit lire ${plan.id}`);
    assert.ok(accesPlan(IDENTITES.adminCoach, plan, "update"), `doit modifier ${plan.id}`);
  }
});

// ── Tests négatifs : le scénario critique à deux coachs ────────────────────

test("MATRICE NÉGATIF 1. le coach B ne fait AUCUNE des 4 opérations sur le plan de l'élève A", () => {
  for (const cmd of ["select", "insert", "update", "delete"] as Commande[]) {
    assert.equal(
      accesPlan(IDENTITES.coachB, PLANS.planA, cmd),
      false,
      `coach B ne doit PAS pouvoir ${cmd} le plan de l'élève A`,
    );
  }
});

test("MATRICE NÉGATIF 2. réciproquement, le coach A n'atteint pas le plan de l'élève B", () => {
  for (const cmd of ["select", "insert", "update", "delete"] as Commande[]) {
    assert.equal(accesPlan(IDENTITES.coachA, PLANS.planB, cmd), false, `interdit : ${cmd}`);
  }
});

test("MATRICE NÉGATIF 3. le coach B n'atteint pas les tables FILLES du plan de l'élève A", () => {
  // Jour, profil, cible de créneau, repas, créneau de choix, option : toutes
  // résolvent leur propriété par ce même plan.
  assert.equal(accesFille(IDENTITES.coachB, PLANS.planA), false);
  assert.equal(accesFille(IDENTITES.coachA, PLANS.planB), false);
});

test("MATRICE NÉGATIF 4. un élève sans coach n'est visible d'AUCUN coach", () => {
  for (const id of [IDENTITES.coachA, IDENTITES.coachB]) {
    for (const cmd of ["select", "insert", "update", "delete"] as Commande[]) {
      assert.equal(
        accesPlan(id, PLANS.planOrphelin, cmd),
        false,
        `${id.nom} ne doit PAS ${cmd} le plan d'un élève sans coach`,
      );
    }
  }
});

test("MATRICE NÉGATIF 5. le plan INCOHÉRENT n'appartient pas au coach inscrit dessus", () => {
  // coach_id = coachA, mais l'élève porté a coach_id IS NULL. L'élève tranche.
  // C'est précisément le cas qui, traité en OU sur coach_id, aurait rouvert la
  // faille.
  for (const cmd of ["select", "insert", "update", "delete"] as Commande[]) {
    assert.equal(
      accesPlan(IDENTITES.coachA, PLANS.planIncoherent, cmd),
      false,
      `coach A ne doit PAS ${cmd} le plan incohérent`,
    );
  }
  assert.ok(accesPlan(IDENTITES.admin, PLANS.planIncoherent, "select"), "l'admin, si");
});

test("MATRICE NÉGATIF 6. CONTOURNEMENT — déplacer student_id vers l'élève d'un autre coach", () => {
  // Le coach A part de SON plan modèle et tente de l'affecter à l'élève B.
  const avant = PLANS.modeleA;
  const apres: Plan = { ...PLANS.modeleA, studentId: "eleveB" };
  assert.ok(accesPlan(IDENTITES.coachA, avant, "update"), "la ligne de départ est bien à lui");
  assert.equal(
    updateAutorise(IDENTITES.coachA, avant, apres),
    false,
    "WITH CHECK doit refuser la ligne d'arrivée",
  );
});

test("MATRICE NÉGATIF 7. CONTOURNEMENT — déplacer student_id vers un élève sans coach", () => {
  const apres: Plan = { ...PLANS.modeleA, studentId: "eleveOrphelin" };
  assert.equal(updateAutorise(IDENTITES.coachA, PLANS.modeleA, apres), false);
});

test("MATRICE NÉGATIF 8. CONTOURNEMENT — s'approprier un plan en réécrivant coach_id", () => {
  // Le coach B tente `UPDATE … SET coach_id = coachB` sur le plan modèle de A.
  const avant = PLANS.modeleA;
  const apres: Plan = { ...PLANS.modeleA, coachId: "coachB" };
  assert.equal(
    accesPlan(IDENTITES.coachB, avant, "update"),
    false,
    "USING doit déjà rendre la ligne de départ inaccessible",
  );
  assert.equal(updateAutorise(IDENTITES.coachB, avant, apres), false);
});

test("MATRICE NÉGATIF 9. CONTOURNEMENT — créer un plan au nom d'un autre coach", () => {
  const nouveau: Plan = { id: "nouveau", studentId: null, coachId: "coachB" };
  assert.equal(
    accesPlan(IDENTITES.coachA, nouveau, "insert"),
    false,
    "coach A ne doit pas insérer un plan appartenant à coach B",
  );
});

test("MATRICE NÉGATIF 10. CONTOURNEMENT — créer un plan pour l'élève d'un autre coach", () => {
  const nouveau: Plan = { id: "nouveau", studentId: "eleveB", coachId: "coachA" };
  assert.equal(accesPlan(IDENTITES.coachA, nouveau, "insert"), false);
});

test("MATRICE NÉGATIF 11. CONTOURNEMENT — rattacher une ligne fille au plan d'un autre coach", () => {
  // Un jour, un repas, un créneau ou une option déplacé vers le plan de B :
  // le WITH CHECK de la table fille évalue le plan d'ARRIVÉE.
  assert.ok(accesFille(IDENTITES.coachA, PLANS.modeleA), "départ : son plan");
  assert.equal(accesFille(IDENTITES.coachA, PLANS.planB), false, "arrivée : refusée");
});

test("MATRICE NÉGATIF 12. CONTOURNEMENT — DELETE direct du plan d'un autre coach", () => {
  assert.equal(accesPlan(IDENTITES.coachB, PLANS.planA, "delete"), false);
  assert.equal(accesPlan(IDENTITES.coachB, PLANS.modeleA, "delete"), false);
});

test("MATRICE NÉGATIF 13. CONTOURNEMENT — DELETE direct d'un plan AFFECTÉ, même le sien", () => {
  // C'est la protection que seule la RPC portait : `nutrition_plan_deletion_block`
  // renvoie « assigned ». Elle est désormais dans la policy DELETE.
  assert.equal(
    accesPlan(IDENTITES.coachA, PLANS.planA, "delete"),
    false,
    "un plan affecté ne se supprime pas directement, même par son propriétaire",
  );
  assert.ok(
    accesPlan(IDENTITES.coachA, PLANS.planA, "update"),
    "mais il reste modifiable : seul le DELETE est resserré",
  );
});

test("MATRICE NÉGATIF 14. un élève n'atteint pas le plan d'un autre élève", () => {
  assert.equal(accesPlan(IDENTITES.eleveA, PLANS.planB, "select"), false);
  assert.equal(accesPlan(IDENTITES.eleveB, PLANS.planA, "select"), false);
  assert.equal(accesPlan(IDENTITES.eleveA, PLANS.modeleA, "select"), false);
});

test("MATRICE NÉGATIF 15. un élève n'écrit pas dans le plan prescrit", () => {
  for (const cmd of ["insert", "update", "delete"] as Commande[]) {
    assert.equal(accesPlan(IDENTITES.eleveA, PLANS.planA, cmd), false, `interdit : ${cmd}`);
  }
});

test("MATRICE CONTRÔLE DU CONTRÔLE. la matrice échouerait si la règle redevenait permissive", () => {
  // Sans ce contrôle, une règle qui renverrait `true` partout ferait passer
  // tous les tests positifs et seuls les négatifs tomberaient — on vérifie
  // donc explicitement que les deux sens discriminent.
  const permissif: Identite = { nom: "faux coach", coachId: "coachB", studentId: null, admin: false };
  assert.equal(
    accesPlan(permissif, PLANS.planA, "select"),
    false,
    "un coach étranger ne doit jamais lire ce plan",
  );
  assert.ok(
    accesPlan(IDENTITES.coachA, PLANS.planA, "select"),
    "et le coach légitime doit toujours le lire : la règle discrimine bien",
  );
});

// ════════════════════════════════════════════════════════════════════════════
// CONTRAT — LA MIGRATION ENCODE-T-ELLE CETTE RÈGLE ?
// ════════════════════════════════════════════════════════════════════════════

test("CONTRAT 1. la migration P13-A existe et n'est pas vide", () => {
  assert.ok(MIGRATION_BRUTE.length > 2000, "migration suspectement courte");
  assert.ok(
    readdirSync(join(RACINE, "supabase/migrations")).includes(
      "20261002090000_rls_nutrition_isolation_multi_coachs.sql",
    ),
  );
});

test("CONTRAT 2. les huit policies trop larges sont explicitement supprimées", () => {
  for (const [table, policy] of Object.entries(POLICIES_TROP_LARGES)) {
    const attendu = `drop policy if exists "${policy}" on public.${table};`.toLowerCase();
    assert.ok(
      SQL_PLAT.includes(attendu.replace(/\s+/g, " ")),
      `la migration doit supprimer ${policy} sur ${table}`,
    );
  }
});

test("CONTRAT 3. AUCUNE policy créée par cette migration ne repose sur is_coach_or_admin()", () => {
  // Le cœur du chantier. On découpe sur `create policy` et on inspecte chaque
  // bloc : la fonction ne doit apparaître dans AUCUN prédicat.
  const blocs = SQL.split(/create\s+policy/i).slice(1);
  assert.ok(blocs.length >= 18, `trop peu de policies créées : ${blocs.length}`);
  for (const bloc of blocs) {
    const corps = bloc.slice(0, bloc.indexOf(";") === -1 ? bloc.length : bloc.indexOf(";"));
    const nom = (corps.match(/"([^"]+)"/) ?? ["", "(sans nom)"])[1];
    assert.ok(
      !/is_coach_or_admin\s*\(/i.test(corps),
      `la policy ${nom} repose encore sur is_coach_or_admin()`,
    );
  }
});

test("CONTRAT 4. aucun prédicat permissif (USING true / WITH CHECK true)", () => {
  assert.ok(!/using\s*\(\s*true\s*\)/i.test(SQL), "USING (true) interdit");
  assert.ok(!/with\s+check\s*\(\s*true\s*\)/i.test(SQL), "WITH CHECK (true) interdit");
});

test("CONTRAT 5. chaque table du cœur reçoit une policy admin nommée", () => {
  for (const table of TABLES_COEUR) {
    const attendu = `create policy "${table}_manage_admin" on public.${table}`.toLowerCase();
    assert.ok(SQL_PLAT.includes(attendu), `${table}_manage_admin manquante`);
  }
});

test("CONTRAT 6. chaque table du cœur reçoit une policy coach cloisonnée", () => {
  for (const table of TABLES_COEUR) {
    if (table === "nutrition_plans") {
      // Elle est découpée par commande, parce que le DELETE est plus strict.
      for (const cmd of ["select", "insert", "update", "delete"]) {
        assert.ok(
          SQL_PLAT.includes(`"nutrition_plans_${cmd}_own_coach"`),
          `nutrition_plans_${cmd}_own_coach manquante`,
        );
      }
      continue;
    }
    assert.ok(SQL_PLAT.includes(`"${table}_manage_own_coach"`), `${table}_manage_own_coach manquante`);
  }
});

test("CONTRAT 7. la propriété d'un plan passe par l'ÉLÈVE avant le coach_id", () => {
  // On isole les policies de nutrition_plans et on vérifie que les deux
  // branches sont là, dans le bon ordre de priorité.
  // `.slice(1)` est INDISPENSABLE : sans lui, l'élément [0] du découpage est
  // tout ce qui précède le premier `create policy` — en-tête et instructions
  // `drop policy` comprises. Ce bloc-là cite les noms des policies et passait
  // le filtre, faisant porter l'assertion sur une policy SUPPRIMÉE.
  const blocs = SQL.split(/create\s+policy/i)
    .slice(1)
    .filter((b) => /nutrition_plans_\w+_own_coach/.test(b));
  assert.ok(blocs.length >= 3, "les policies coach de nutrition_plans sont introuvables");
  for (const bloc of blocs) {
    const nom = (bloc.match(/"([^"]+)"/) ?? ["", "?"])[1];
    if (nom === "nutrition_plans_delete_own_coach") continue; // cas traité à part
    assert.ok(
      /student_id\s+is\s+not\s+null\s+and\s+public\.is_coach_of_student\s*\(\s*student_id\s*\)/i.test(bloc),
      `${nom} : la branche « élève d'abord » est absente`,
    );
    // On ne se contente PAS de constater que les deux motifs existent quelque
    // part dans le bloc : un USING vidé pendant qu'un WITH CHECK reste intact
    // satisferait cette lecture naïve. Chaque occurrence de « student_id is
    // null » employée comme branche de propriété doit porter la garde
    // complète, et on le vérifie par COMPTAGE.
    const platBloc = bloc.replace(/\s+/g, " ").toLowerCase();
    const branchesModele = (platBloc.match(/student_id is null/g) ?? []).length;
    const branchesCompletes = (
      platBloc.match(
        /student_id is null and coach_id is not null and coach_id = public\.current_coach_id\(\)/g,
      ) ?? []
    ).length;
    assert.ok(branchesModele > 0, `${nom} : la branche « plan modèle » est absente`);
    assert.equal(
      branchesCompletes,
      branchesModele,
      `${nom} : ${branchesModele - branchesCompletes} branche(s) « student_id is null » sans la garde « coach_id is not null and coach_id = current_coach_id() »`,
    );
    // La branche « élève d'abord » doit elle aussi être présente AUTANT de
    // fois : une par prédicat (USING et/ou WITH CHECK).
    const branchesEleve = (
      platBloc.match(/student_id is not null and public\.is_coach_of_student\(student_id\)/g) ?? []
    ).length;
    assert.equal(
      branchesEleve,
      branchesModele,
      `${nom} : ${branchesModele} branche(s) « plan modèle » mais ${branchesEleve} branche(s) « élève d'abord » — un prédicat a été vidé`,
    );
  }
});

test("CONTRAT 7b. INSERT et UPDATE de nutrition_plans portent bien un WITH CHECK", () => {
  // Sans WITH CHECK, un UPDATE n'est jugé que sur la ligne de DÉPART : la
  // réécriture de student_id vers l'élève d'un autre coach redevient possible.
  // C'est le contournement central du chantier, et son absence doit rougir.
  for (const cmd of ["insert", "update"]) {
    const i = SQL.indexOf(`create policy "nutrition_plans_${cmd}_own_coach"`);
    assert.ok(i !== -1, `policy ${cmd} absente`);
    const bloc = SQL.slice(i, SQL.indexOf(";", i));
    assert.ok(
      /with\s+check\s*\(/i.test(bloc),
      `nutrition_plans_${cmd}_own_coach n'a PAS de WITH CHECK : la ligne d'arrivée n'est pas jugée`,
    );
    assert.ok(
      /is_coach_of_student/i.test(bloc.slice(bloc.search(/with\s+check/i))),
      `nutrition_plans_${cmd}_own_coach : le WITH CHECK n'oppose pas la propriété de l'élève`,
    );
  }
  // Et toute policy d'écriture des tables filles aussi.
  for (const table of TABLES_COEUR) {
    if (table === "nutrition_plans") continue;
    const i = SQL.indexOf(`create policy "${table}_manage_own_coach"`);
    const bloc = SQL.slice(i, SQL.indexOf(";", i));
    assert.ok(
      /with\s+check\s*\(/i.test(bloc),
      `${table}_manage_own_coach n'a pas de WITH CHECK`,
    );
  }
});

test("CONTRAT 8. le coach_id du plan n'est JAMAIS opposé en OU à l'élève", () => {
  // Le contournement à ne pas réintroduire : `is_coach_of_student(student_id)
  // OR coach_id = current_coach_id()` rendrait l'élève atteignable par le coach
  // inscrit sur le plan. La branche coach_id doit être gardée par
  // `student_id is null`.
  const blocs = SQL.split(/create\s+policy/i)
    .slice(1)
    .filter((b) => /nutrition_plans_\w+_own_coach/.test(b));
  for (const bloc of blocs) {
    const nom = (bloc.match(/"([^"]+)"/) ?? ["", "?"])[1];
    // Chaque comparaison de `coach_id` doit être gardée. On compare les
    // COMPTES : s'il y a plus de comparaisons que de gardes, l'une d'elles
    // s'applique sans condition sur `student_id` — et la faille est rouverte.
    const platBloc = bloc.replace(/\s+/g, " ").toLowerCase();
    const comparaisons = (platBloc.match(/coach_id = public\.current_coach_id\(\)/g) ?? []).length;
    const gardees = (
      platBloc.match(
        /student_id is null and coach_id is not null and coach_id = public\.current_coach_id\(\)/g,
      ) ?? []
    ).length;
    assert.equal(
      gardees,
      comparaisons,
      `${nom} : ${comparaisons - gardees} comparaison(s) de coach_id sans la garde « student_id is null » — un coach inscrit sur le plan atteindrait l'élève d'un autre`,
    );
  }
});

test("CONTRAT 9. le DELETE direct exige la propriété ET l'absence d'élève affecté", () => {
  const i = SQL.indexOf('create policy "nutrition_plans_delete_own_coach"');
  assert.ok(i !== -1, "policy DELETE absente");
  const bloc = SQL.slice(i, SQL.indexOf(";", i));
  assert.ok(/for\s+delete/i.test(bloc), "ce n'est pas une policy DELETE");
  assert.ok(/student_id\s+is\s+null/i.test(bloc), "la garde « aucun élève affecté » manque");
  assert.ok(
    /coach_id\s+is\s+not\s+null\s+and\s+coach_id\s*=\s*public\.current_coach_id/i.test(bloc),
    "la garde de propriété manque",
  );
  assert.ok(!/is_coach_or_admin/i.test(bloc), "le DELETE ne doit pas retomber sur le rôle seul");
});

/** Les trois fonctions de propriété, et les objets que leurs corps citent. */
const FONCTIONS_PROPRIETE = [
  "can_manage_nutrition_plan",
  "can_manage_nutrition_day",
  "can_manage_meal",
] as const;

/**
 * Tout ce qui, dans ces corps, doit être qualifié par `public.`. Les relations
 * ET les fonctions : une référence qualifiée ignore le search_path par
 * construction, ce qui protège même si la déclaration était modifiée plus tard.
 */
const OBJETS_A_QUALIFIER = [
  "nutrition_plans",
  "nutrition_days",
  "meals",
  "is_coach_of_student",
  "current_coach_id",
  "can_manage_nutrition_plan",
  "can_manage_nutrition_day",
] as const;

/** Le corps d'une fonction de la migration, commentaires retirés. */
function corpsFonction(nom: string): string {
  const i = SQL.indexOf(`create or replace function public.${nom}(`);
  assert.ok(i !== -1, `fonction ${nom} absente de la migration`);
  const fin = SQL.indexOf("$$;", i);
  assert.ok(fin !== -1, `fonction ${nom} : corps non terminé`);
  return SQL.slice(i, fin);
}

test("CONTRAT 10. les trois fonctions sont STABLE SECURITY DEFINER à search_path figé", () => {
  for (const fn of FONCTIONS_PROPRIETE) {
    const corps = corpsFonction(fn);
    assert.ok(/security\s+definer/i.test(corps), `${fn} doit être SECURITY DEFINER`);
    assert.ok(/\bstable\b/i.test(corps), `${fn} doit être STABLE`);
    assert.ok(/set\s+search_path\s*=/i.test(corps), `${fn} doit figer son search_path`);
    assert.ok(
      !/is_coach_or_admin/i.test(corps),
      `${fn} ne doit pas retomber sur is_coach_or_admin()`,
    );
  }
});

test("CONTRAT 10b. pg_temp est nommé EXPLICITEMENT et placé EN DERNIER", () => {
  // Le point de sécurité central pour une fonction SECURITY DEFINER. `pg_temp`
  // n'est jamais absent du chemin : non listé, PostgreSQL le cherche EN
  // PREMIER pour les noms de relations et de types — avant même pg_catalog.
  // Ni `= 'public'` ni `= ''` ne le retirent. Seul le fait de le NOMMER, en
  // dernier, le relègue. `authenticated` a le droit TEMP sur cette base : un
  // porteur de jeton peut donc créer `pg_temp.nutrition_plans` et, sans cette
  // garde, faire résoudre une fonction s'exécutant en `postgres` vers sa
  // propre table.
  for (const fn of FONCTIONS_PROPRIETE) {
    const corps = corpsFonction(fn);
    const m = corps.match(/set\s+search_path\s*=\s*([^\n;]+)/i);
    assert.ok(m, `${fn} : aucune déclaration search_path lisible`);
    const chemin = m![1]
      .trim()
      .split(",")
      .map((e) => e.trim().replace(/^'|'$/g, "").toLowerCase())
      .filter((e) => e.length > 0);

    assert.ok(
      chemin.includes("pg_temp"),
      `${fn} : pg_temp n'est pas nommé dans le search_path (« ${m![1].trim()} ») — il serait donc cherché EN PREMIER`,
    );
    assert.equal(
      chemin[chemin.length - 1],
      "pg_temp",
      `${fn} : pg_temp doit être le DERNIER élément du search_path, il est en position ${chemin.indexOf("pg_temp") + 1}/${chemin.length} (« ${m![1].trim()} »)`,
    );
    // Et le schéma applicatif doit précéder pg_temp, sinon la fonction ne
    // résoudrait plus rien d'utile.
    assert.ok(
      chemin.indexOf("public") !== -1 && chemin.indexOf("public") < chemin.indexOf("pg_temp"),
      `${fn} : public doit figurer AVANT pg_temp (« ${m![1].trim()} »)`,
    );
  }
});

test("CONTRAT 10c. aucune référence non qualifiée dans les trois corps", () => {
  // Deuxième rideau, indépendant du search_path. On compte : chaque occurrence
  // d'un objet sensible doit être précédée de `public.`. Un seul `from
  // nutrition_plans` non qualifié suffirait à rendre la résolution dépendante
  // du chemin de recherche.
  for (const fn of FONCTIONS_PROPRIETE) {
    const corps = corpsFonction(fn);
    // On ne garde que le corps exécutable, pas l'en-tête de déclaration.
    const debut = corps.indexOf("$$");
    const executable = debut === -1 ? corps : corps.slice(debut);
    for (const objet of OBJETS_A_QUALIFIER) {
      const total = (executable.match(new RegExp(`\\b${objet}\\b`, "g")) ?? []).length;
      const qualifiees = (
        executable.match(new RegExp(`\\bpublic\\.${objet}\\b`, "g")) ?? []
      ).length;
      assert.equal(
        qualifiees,
        total,
        `${fn} : ${total - qualifiees} référence(s) non qualifiée(s) à « ${objet} » — la résolution dépendrait du search_path`,
      );
    }
    // Tout FROM et tout JOIN doivent viser public.
    for (const m of executable.matchAll(/\b(from|join)\s+([a-z_][a-z0-9_.]*)/gi)) {
      assert.ok(
        m[2].toLowerCase().startsWith("public."),
        `${fn} : « ${m[1]} ${m[2]} » n'est pas qualifié par public.`,
      );
    }
  }
});

test("CONTRAT 11. can_manage_nutrition_plan applique la règle « élève d'abord »", () => {
  const corps = corpsFonction("can_manage_nutrition_plan");
  assert.ok(/p\.student_id\s+is\s+not\s+null\s+and\s+public\.is_coach_of_student\s*\(\s*p\.student_id\s*\)/i.test(corps));
  assert.ok(/p\.student_id\s+is\s+null/i.test(corps));
  assert.ok(/p\.coach_id\s+is\s+not\s+null/i.test(corps));
});

test("CONTRAT 12. le droit d'exécution des fonctions est retiré à public et anon", () => {
  for (const fn of ["can_manage_nutrition_plan", "can_manage_nutrition_day", "can_manage_meal"]) {
    assert.ok(
      SQL_PLAT.includes(`revoke all on function public.${fn}(uuid) from public;`),
      `${fn} : revoke public manquant`,
    );
    assert.ok(
      SQL_PLAT.includes(`revoke all on function public.${fn}(uuid) from anon;`),
      `${fn} : revoke anon manquant`,
    );
    assert.ok(
      SQL_PLAT.includes(`grant execute on function public.${fn}(uuid) to authenticated;`),
      `${fn} : grant authenticated manquant`,
    );
  }
});

test("CONTRAT 13. AUCUNE policy de lecture élève n'est supprimée", () => {
  for (const policy of POLICIES_ELEVE_INTOUCHABLES) {
    assert.ok(
      !SQL_PLAT.includes(`drop policy if exists "${policy}"`),
      `la migration ne doit pas toucher ${policy}`,
    );
    assert.ok(
      !SQL_PLAT.includes(`create policy "${policy}"`),
      `la migration ne doit pas recréer ${policy}`,
    );
  }
});

test("CONTRAT 14. l'accès de l'élève à son journal quotidien est reporté à l'identique", () => {
  const i = SQL.indexOf('create policy "nutrition_daily_logs_manage_own_student"');
  assert.ok(i !== -1, "la branche élève du journal a disparu");
  const bloc = SQL.slice(i, SQL.indexOf(";", i));
  assert.ok(/student_id\s*=\s*public\.current_student_id\s*\(\s*\)/i.test(bloc));
  // Et la branche coach du journal passe bien par l'élève.
  const j = SQL.indexOf('create policy "nutrition_daily_logs_manage_own_coach"');
  const blocCoach = SQL.slice(j, SQL.indexOf(";", j));
  assert.ok(/is_coach_of_student\s*\(\s*student_id\s*\)/i.test(blocCoach));
});

test("CONTRAT 15. la garde source_list_id de meal_choice_slots est conservée", () => {
  const i = SQL.indexOf('create policy "meal_choice_slots_manage_own_coach"');
  assert.ok(i !== -1);
  const bloc = SQL.slice(i, SQL.indexOf(";", i));
  assert.ok(/source_list_id\s+is\s+null/i.test(bloc), "la garde a disparu");
  assert.ok(/food_lists/i.test(bloc) && /fl\.coach_id\s*=\s*public\.current_coach_id/i.test(bloc));
});

test("CONTRAT 16. aucune RPC n'est supprimée ni redéfinie par cette migration", () => {
  assert.ok(!/drop\s+function/i.test(SQL), "aucun DROP FUNCTION attendu");
  for (const rpc of [
    "delete_nutrition_plan",
    "nutrition_plan_deletion_block",
    "assign_nutrition_plan",
    "unassign_nutrition_plan",
    "save_nutrition_plan_v2",
  ]) {
    assert.ok(
      !new RegExp(`create\\s+or\\s+replace\\s+function\\s+public\\.${rpc}\\s*\\(`, "i").test(SQL),
      `${rpc} ne doit pas être réécrite par P13-A`,
    );
  }
});

test("CONTRAT 17. aucun changement de schéma ni de grant de table", () => {
  assert.ok(!/alter\s+table/i.test(SQL), "aucun ALTER TABLE attendu");
  assert.ok(!/create\s+table/i.test(SQL), "aucun CREATE TABLE attendu");
  assert.ok(!/add\s+column|drop\s+column/i.test(SQL), "aucune colonne touchée");
  // Les grants de TABLE ne sont pas touchés : seuls ceux des 3 fonctions le sont.
  // On inspecte instruction par instruction plutôt qu'avec une expression
  // régulière globale : le mot « function » contient lui-même « on », et une
  // classe gourmande suivie d'un `on` littéral s'y fait piéger.
  const instructionsDroits = SQL.split(";")
    .map((i) => i.trim().replace(/\s+/g, " "))
    .filter((i) => /^(grant|revoke)\b/i.test(i));
  assert.ok(instructionsDroits.length > 0, "aucune instruction de droits trouvée");
  const horsFonction = instructionsDroits.filter((i) => !/\bon function\b/i.test(i));
  assert.equal(
    horsFonction.length,
    0,
    `droits accordés ou retirés hors fonction : ${horsFonction.join(" | ")}`,
  );
  // Et exactement les trois fonctions de propriété, personne d'autre.
  for (const i of instructionsDroits) {
    assert.ok(
      /can_manage_nutrition_plan|can_manage_nutrition_day|can_manage_meal/.test(i),
      `instruction de droits sur un objet hors P13-A : ${i}`,
    );
  }
});

test("CONTRAT 18. toutes les policies créées ciblent le rôle authenticated", () => {
  const blocs = SQL.split(/create\s+policy/i).slice(1);
  for (const bloc of blocs) {
    const corps = bloc.slice(0, bloc.indexOf(";") === -1 ? bloc.length : bloc.indexOf(";"));
    const nom = (corps.match(/"([^"]+)"/) ?? ["", "?"])[1];
    assert.ok(/\bto\s+authenticated\b/i.test(corps), `${nom} ne cible pas authenticated`);
  }
});

test("CONTRAT 19. la migration est idempotente : tout CREATE POLICY est précédé d'un DROP", () => {
  const crees = [...SQL.matchAll(/create\s+policy\s+"([^"]+)"/gi)].map((m) => m[1]);
  assert.ok(crees.length >= 18, `seulement ${crees.length} policies créées`);
  for (const nom of crees) {
    assert.ok(
      SQL_PLAT.includes(`drop policy if exists "${nom.toLowerCase()}"`),
      `${nom} est créée sans DROP IF EXISTS préalable : la migration n'est pas rejouable`,
    );
  }
});

test("CONTRAT 20. la checklist SQL à deux coachs existe et couvre les 4 commandes", () => {
  const checklist = lire("supabase/tests/nutrition_isolation_multi_coachs_checklist.sql");
  assert.ok(checklist.length > 4000, "checklist suspectement courte");
  const sansProse = sansCommentairesSql(checklist).toLowerCase();
  for (const motif of ["select", "insert", "update", "delete"]) {
    assert.ok(sansProse.includes(motif), `la checklist ne teste pas ${motif}`);
  }
  const checklistSansProse = sansCommentairesSql(checklist);

  // DEUX identités de coach DISTINCTES, réellement posées dans le JWT. Un
  // test qui passerait parce qu'il n'existe qu'un seul coach ne prouverait
  // rien ; on vérifie donc la présence des deux `sub`.
  const subs = [
    ...checklistSansProse.matchAll(/"sub"\s*:\s*"([0-9a-f-]{36})"/gi),
  ].map((m) => m[1].toLowerCase());
  const subsDistincts = new Set(subs);
  assert.ok(
    subsDistincts.size >= 5,
    `la checklist ne simule que ${subsDistincts.size} identités distinctes (coach A, coach B, élève A, élève B, admin attendus)`,
  );
  const COACH_A = "13a00000-0000-4000-8000-00000000c0a1";
  const COACH_B = "13a00000-0000-4000-8000-00000000c0b1";
  assert.ok(subsDistincts.has(COACH_A), "l'identité du coach A est absente");
  assert.ok(subsDistincts.has(COACH_B), "l'identité du coach B est absente");
  assert.ok(
    subs.filter((x) => x === COACH_B).length >= 3,
    "le coach B n'est endossé que trop rarement pour couvrir lecture, écriture et suppression",
  );

  /**
   * ET SURTOUT — l'invariant structurel. Tout bloc qui endosse le rôle
   * `authenticated` DOIT poser des claims JWT. Sans claims, `auth.uid()` est
   * nul, `current_coach_id()` rend NULL, et TOUS les contrôles négatifs
   * passent au vert sans rien démontrer : les lignes sont invisibles parce
   * qu'il n'y a personne, pas parce que le cloisonnement fonctionne. C'est le
   * faux positif le plus dangereux de toute la checklist.
   */
  const blocs = checklistSansProse.split(/\bdo\s*\$\$/i).slice(1);
  let blocsAvecRole = 0;
  for (const bloc of blocs) {
    const corps = bloc.split(/end\s*\$\$/i)[0];
    if (!/set\s+local\s+role\s+authenticated/i.test(corps)) continue;
    blocsAvecRole += 1;
    const roles = (corps.match(/set\s+local\s+role\s+authenticated/gi) ?? []).length;
    const claims = (corps.match(/request\.jwt\.claims/g) ?? []).length;
    const extrait = corps.replace(/\s+/g, " ").slice(0, 90);
    assert.ok(
      claims >= roles,
      `un bloc endosse ${roles} fois le rôle authenticated pour seulement ${claims} jeu(x) de claims — les requêtes y tourneraient sans identité : « ${extrait}… »`,
    );
  }
  assert.ok(blocsAvecRole >= 6, `trop peu de blocs sous identité : ${blocsAvecRole}`);
});

test("CONTRAT 21. le décor de la checklist respecte l'invariant un-plan-par-élève", () => {
  // `nutrition_plans_one_plan_per_student` (migration 20260806090000) est un
  // index unique PARTIEL sur `(student_id) where student_id is not null`.
  // Un décor qui assigne deux plans au même élève échoue à l'INSERT, avant
  // tout contrôle — la checklist ne prouve alors plus rien du tout, et c'est
  // précisément ce qui est arrivé. Ce test le constate sans base de données.
  const checklist = sansCommentairesSql(
    lire("supabase/tests/nutrition_isolation_multi_coachs_checklist.sql"),
  );
  const i = checklist.indexOf("insert into public.nutrition_plans");
  assert.ok(i !== -1, "le décor n'insère aucun plan");
  const bloc = checklist.slice(i, checklist.indexOf(";", i));

  // Chaque tuple de plan se termine par (student_id, coach_id).
  const eleves: string[] = [];
  for (const m of bloc.matchAll(
    /(?:'(13a05700-[0-9a-f-]+)'::uuid|null)\s*,\s*(?:'(13a0c0ac-[0-9a-f-]+)'::uuid|null)\s*\)/gi,
  )) {
    if (m[1]) eleves.push(m[1].toLowerCase());
  }
  assert.ok(eleves.length >= 4, `trop peu de plans assignés détectés : ${eleves.length}`);

  const vus = new Map<string, number>();
  for (const e of eleves) vus.set(e, (vus.get(e) ?? 0) + 1);
  const doublons = [...vus.entries()].filter(([, n]) => n > 1);
  assert.equal(
    doublons.length,
    0,
    `élève(s) portant plusieurs plans assignés : ${doublons.map(([e, n]) => `${e} (${n})`).join(", ")} — viole nutrition_plans_one_plan_per_student`,
  );

  /**
   * ET LA CIBLE DES CONTRÔLES D'APPROPRIATION. Un `update … set student_id =
   * <élève>` dont la cible porte DÉJÀ un plan assigné peut mourir sur l'index
   * unique AU LIEU d'être refusé par la RLS — le contrôle passe alors au vert
   * sans rien démontrer. Toute cible d'une réécriture de `student_id` doit donc
   * être un élève libre de tout plan dans le décor.
   */
  const porteursDePlan = new Set(eleves);
  const cibles = [
    ...checklist.matchAll(/set\s+student_id\s*=\s*'(13a05700-[0-9a-f-]+)'::uuid/gi),
  ].map((m) => m[1].toLowerCase());
  assert.ok(cibles.length > 0, "aucun contrôle de réécriture de student_id trouvé");
  for (const cible of cibles) {
    assert.ok(
      !porteursDePlan.has(cible),
      `le contrôle « set student_id = ${cible} » vise un élève qui porte déjà un plan assigné : le refus pourrait venir de nutrition_plans_one_plan_per_student et non de la RLS`,
    );
  }
});

test("CONTRAT 22. ecriture_refusee() ne confond pas une contrainte avec un refus RLS", () => {
  // Une écriture qui heurte une contrainte a été LAISSÉE PASSER par la RLS.
  // La compter comme un refus rendrait vert n'importe quel contrôle négatif.
  const checklist = lire("supabase/tests/nutrition_isolation_multi_coachs_checklist.sql");
  const i = checklist.indexOf("create or replace function pg_temp.ecriture_refusee");
  assert.ok(i !== -1, "l'aide ecriture_refusee a disparu");
  const corps = sansCommentairesSql(checklist.slice(i, checklist.indexOf("end $$;", i)));

  // Les deux seuls refus acceptés.
  assert.ok(
    /when\s+insufficient_privilege\s+then\s+return\s+true/i.test(corps.replace(/\s+/g, " ")),
    "42501 doit rester un refus valable",
  );
  assert.ok(/row_count/i.test(corps) && /return\s+true/i.test(corps), "0 ligne doit rester un refus");

  /**
   * Chaque branche du bloc `exception`, isolée. Une fenêtre de taille fixe
   * déborderait sur la branche SUIVANTE, dont le `return false` suffirait à
   * satisfaire l'assertion : la branche sabotée passerait inaperçue. On borne
   * donc sur le prochain `when … then`.
   */
  function branche(code: string): string {
    const debut = corps.indexOf(`when ${code} then`);
    assert.ok(debut !== -1, `${code} n'est pas traité explicitement`);
    const apresEntete = debut + `when ${code} then`.length;
    const suivant = corps.slice(apresEntete).search(/\bwhen\s+[a-z_]+\s+then\b/i);
    return suivant === -1 ? corps.slice(apresEntete) : corps.slice(apresEntete, apresEntete + suivant);
  }

  // Les causes qui doivent faire ÉCHOUER le contrôle.
  for (const [code, nom] of [
    ["unique_violation", "23505"],
    ["foreign_key_violation", "23503"],
    ["others", "cause inattendue"],
  ] as const) {
    const b = branche(code);
    assert.ok(
      /return\s+false/i.test(b),
      `${code} (${nom}) doit faire ÉCHOUER le contrôle : « return false » absent de sa branche`,
    );
    assert.ok(
      !/return\s+true/i.test(b),
      `${code} (${nom}) rend « true » : une écriture arrêtée par une contrainte serait comptée comme un refus RLS alors que la RLS l'a laissée passer`,
    );
  }
});

// ════════════════════════════════════════════════════════════════════════════

console.log(`\n${passed} réussis, ${failed} échecs`);
if (failed > 0) process.exit(1);
