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
// PERF — LA MIGRATION 20261003090000 REFORMULE LES POLICIES SANS CHANGER LA RÈGLE
// ════════════════════════════════════════════════════════════════════════════
//
// Elle existe parce que la forme retenue par P13-A coûtait trop cher : un
// prédicat qui DÉPEND DE LA LIGNE (`can_manage_meal(meal_id)`) s'évalue une
// fois par ligne, là où l'ancien `is_coach_or_admin()` — sans argument — était
// hissé en « One-Time Filter » et évalué une seule fois. Mesuré en production :
// 5,6 ms contre 1 786 ms sur les mêmes 3 312 lignes, et 5 311 ms pour lire
// `meal_choice_options` (25 191 lignes). D'où le 57014 à la sauvegarde.
//
// La correction revient à un prédicat SANS ARGUMENT — `x in (select …_geres())`
// — donc de nouveau hissable. Ces tests vérifient que la REFORMULATION n'a rien
// cédé : mêmes policies, même règle, mêmes gardes.

const CHEMIN_MIGRATION_PERF =
  "supabase/migrations/20261003090000_p13a_perf_rls_nutrition.sql";
const PERF = sansCommentairesSql(lire(CHEMIN_MIGRATION_PERF));
const PERF_PLAT = PERF.replace(/\s+/g, " ").toLowerCase();

/** Les six ensembles gérables, tous sans argument. */
const FONCTIONS_ENSEMBLES = [
  "nutrition_plan_ids_geres",
  "nutrition_day_ids_geres",
  "meal_ids_geres",
  "meal_choice_slot_ids_geres",
  "nutrition_plan_profile_ids_geres",
  "student_ids_geres",
] as const;

/** Extrait les policies d'une migration : nom -> {table, commande, rôle, corps}. */
function policiesDe(sql: string): Map<string, { table: string; cmd: string; role: string; corps: string }> {
  const out = new Map<string, { table: string; cmd: string; role: string; corps: string }>();
  for (const m of sql.matchAll(
    /create policy\s+"([^"]+)"\s+on\s+public\.(\w+)\s+for\s+(\w+)\s+to\s+(\w+)([\s\S]*?);(?=\s*(?:\n|$))/gi,
  )) {
    out.set(m[1], {
      table: m[2].toLowerCase(),
      cmd: m[3].toLowerCase(),
      role: m[4].toLowerCase(),
      corps: m[5].replace(/\s+/g, " ").trim().toLowerCase(),
    });
  }
  return out;
}

test("PERF 1. la migration de performance existe et ne touche ni schéma ni droits de table", () => {
  assert.ok(PERF.length > 2000, "migration suspectement courte");
  assert.ok(!/alter\s+table/i.test(PERF), "aucun ALTER TABLE attendu");
  assert.ok(!/create\s+table/i.test(PERF), "aucun CREATE TABLE attendu");
  assert.ok(!/drop\s+function/i.test(PERF), "aucune fonction supprimée");
  assert.ok(!/grant\s+[a-z, ]+on\s+table/i.test(PERF), "aucun grant de table");
  assert.ok(!/revoke\s+[a-z, ]+on\s+table/i.test(PERF), "aucun revoke de table");
});

test("PERF 2. elle reprend EXACTEMENT les 20 policies de P13-A, même table/commande/rôle", () => {
  // Le risque d'une réécriture de policies est d'en perdre une en chemin, ou
  // d'en élargir la portée. On compare les deux migrations terme à terme.
  const avant = policiesDe(SQL);
  const apres = policiesDe(PERF);
  assert.equal(apres.size, avant.size, `${avant.size} policies dans P13-A, ${apres.size} ici`);
  for (const [nom, a] of avant) {
    const b = apres.get(nom);
    assert.ok(b, `la policy ${nom} de P13-A n'est pas reprise`);
    assert.equal(b!.table, a.table, `${nom} : table changée`);
    assert.equal(b!.cmd, a.cmd, `${nom} : commande changée (${a.cmd} -> ${b!.cmd})`);
    assert.equal(b!.role, a.role, `${nom} : rôle changé (${a.role} -> ${b!.role})`);
  }
  for (const nom of apres.keys()) {
    assert.ok(avant.has(nom), `policy ${nom} inconnue de P13-A — portée élargie ?`);
  }
});

test("PERF 3. aucune policy ne retombe sur is_coach_or_admin() ni sur un prédicat permissif", () => {
  for (const [nom, p] of policiesDe(PERF)) {
    assert.ok(!/is_coach_or_admin\s*\(/.test(p.corps), `${nom} repose sur is_coach_or_admin()`);
    assert.ok(!/using\s*\(\s*true\s*\)/.test(p.corps), `${nom} : USING (true)`);
    assert.ok(!/with check\s*\(\s*true\s*\)/.test(p.corps), `${nom} : WITH CHECK (true)`);
  }
});

test("PERF 4. les six fonctions d'ensemble sont SANS ARGUMENT — c'est tout l'objet du correctif", () => {
  // Une fonction qui prend un argument dépendant de la ligne ne peut pas être
  // hissée : elle s'exécute une fois par ligne. C'est précisément ce qui a
  // causé le timeout. Si quelqu'un leur ajoute un paramètre, le correctif est
  // annulé en silence — et ce test doit le dire.
  for (const fn of FONCTIONS_ENSEMBLES) {
    const i = PERF.indexOf(`create or replace function public.${fn}(`);
    assert.ok(i !== -1, `fonction ${fn} absente`);
    const entete = PERF.slice(i, PERF.indexOf("as $$", i));
    const args = (entete.match(new RegExp(`${fn}\\(([^)]*)\\)`)) ?? ["", "?"])[1].trim();
    assert.equal(args, "", `${fn} prend un argument « ${args} » : le prédicat redeviendrait évalué par ligne`);
    assert.ok(/returns setof uuid/i.test(entete), `${fn} doit rendre un ensemble d'uuid`);
    assert.ok(/\bstable\b/i.test(entete), `${fn} doit être STABLE`);
    assert.ok(/security definer/i.test(entete), `${fn} doit être SECURITY DEFINER`);
  }
});

test("PERF 5. leur search_path nomme pg_temp, en dernier", () => {
  for (const fn of FONCTIONS_ENSEMBLES) {
    const i = PERF.indexOf(`create or replace function public.${fn}(`);
    const entete = PERF.slice(i, PERF.indexOf("as $$", i));
    const m = entete.match(/set\s+search_path\s*=\s*([^\n]+)/i);
    assert.ok(m, `${fn} : pas de search_path`);
    const chemin = m![1].trim().split(",").map((e) => e.trim().replace(/^'|'$/g, "").toLowerCase());
    assert.ok(chemin.includes("pg_temp"), `${fn} : pg_temp non nommé — il serait cherché EN PREMIER`);
    assert.equal(chemin[chemin.length - 1], "pg_temp", `${fn} : pg_temp doit être en dernier`);
  }
});

test("PERF 6. leur droit d'exécution est retiré à public et anon", () => {
  // La migration les traite en boucle : on vérifie que la liste de la boucle
  // contient bien les six noms, et que les trois ordres y figurent.
  for (const fn of FONCTIONS_ENSEMBLES) {
    assert.ok(PERF_PLAT.includes(`'${fn}'`), `${fn} absente de la boucle de droits`);
  }
  for (const ordre of ["revoke all on function public.%i() from public",
                       "revoke all on function public.%i() from anon",
                       "grant execute on function public.%i() to authenticated"]) {
    assert.ok(PERF_PLAT.includes(ordre), `ordre manquant : ${ordre}`);
  }
});

test("PERF 7. la règle de propriété est la MÊME : élève d'abord, coach_id gardé", () => {
  // `student_ids_geres()` doit être la forme ensembliste de is_coach_of_student :
  // même garde `coach_id is not null`, même égalité avec current_coach_id().
  const i = PERF.indexOf("create or replace function public.student_ids_geres(");
  const corps = PERF.slice(i, PERF.indexOf("$$;", i));
  assert.ok(/s\.coach_id is not null/i.test(corps), "student_ids_geres : garde IS NOT NULL absente");
  assert.ok(/s\.coach_id = public\.current_coach_id\(\)/i.test(corps), "student_ids_geres : égalité absente");

  // Et le plan : élève d'abord, branche modèle gardée par student_id is null.
  const j = PERF.indexOf("create or replace function public.nutrition_plan_ids_geres(");
  const plan = PERF.slice(j, PERF.indexOf("$$;", j)).replace(/\s+/g, " ").toLowerCase();
  assert.ok(
    /p\.student_id is not null and public\.is_coach_of_student\(p\.student_id\)/.test(plan),
    "nutrition_plan_ids_geres : branche « élève d'abord » absente",
  );
  const modele = (plan.match(/p\.student_id is null and p\.coach_id is not null and p\.coach_id = public\.current_coach_id\(\)/g) ?? []).length;
  const comparaisons = (plan.match(/p\.coach_id = public\.current_coach_id\(\)/g) ?? []).length;
  assert.equal(modele, comparaisons,
    "nutrition_plan_ids_geres : coach_id comparé sans la garde « student_id is null »");
});

test("PERF 8. nutrition_plans garde ses quatre commandes, et le DELETE reste le plus strict", () => {
  const ps = policiesDe(PERF);
  for (const cmd of ["select", "insert", "update", "delete"]) {
    const p = ps.get(`nutrition_plans_${cmd}_own_coach`);
    assert.ok(p, `nutrition_plans_${cmd}_own_coach absente`);
    assert.equal(p!.cmd, cmd);
  }
  const del = ps.get("nutrition_plans_delete_own_coach")!;
  assert.ok(/student_id is null/.test(del.corps), "le DELETE perd la garde « aucun élève affecté »");
  assert.ok(/coach_id is not null/.test(del.corps), "le DELETE perd la garde de propriété");
  // INSERT et UPDATE doivent conserver un WITH CHECK.
  for (const cmd of ["insert", "update"]) {
    assert.ok(/with check/.test(ps.get(`nutrition_plans_${cmd}_own_coach`)!.corps),
      `nutrition_plans_${cmd}_own_coach : WITH CHECK absent`);
  }
});

test("PERF 9. chaque policy coach des tables filles garde un WITH CHECK", () => {
  // Sans WITH CHECK, un UPDATE n'est jugé que sur la ligne de départ : on
  // pourrait déplacer une ligne vers le plan d'un autre coach.
  for (const [nom, p] of policiesDe(PERF)) {
    if (!nom.endsWith("_own_coach") && !nom.endsWith("_own_student")) continue;
    if (nom === "nutrition_plans_select_own_coach" || nom === "nutrition_plans_delete_own_coach") continue;
    assert.ok(/with check/.test(p.corps), `${nom} : WITH CHECK absent`);
  }
});

test("PERF 10. is_admin() est hissé par (select …) dans les huit policies admin", () => {
  for (const table of TABLES_COEUR) {
    const p = policiesDe(PERF).get(`${table}_manage_admin`);
    assert.ok(p, `${table}_manage_admin absente`);
    assert.ok(
      /\(\s*select public\.is_admin\(\)\s*\)/.test(p!.corps),
      `${table}_manage_admin : is_admin() non hissé — il serait appelé une fois par ligne`,
    );
  }
});

test("PERF 11. la garde source_list_id de meal_choice_slots est conservée", () => {
  const p = policiesDe(PERF).get("meal_choice_slots_manage_own_coach")!;
  assert.ok(/source_list_id is null/.test(p.corps), "la garde a disparu");
  assert.ok(/food_lists/.test(p.corps) && /fl\.coach_id = \(\s*select public\.current_coach_id\(\)\s*\)/.test(p.corps),
    "la garde ne compare plus la liste au coach courant");
});

test("PERF 12. aucune policy de lecture élève n'est touchée", () => {
  for (const policy of POLICIES_ELEVE_INTOUCHABLES) {
    assert.ok(!PERF_PLAT.includes(`drop policy if exists "${policy.toLowerCase()}"`),
      `la migration de perf ne doit pas toucher ${policy}`);
    assert.ok(!PERF_PLAT.includes(`create policy "${policy.toLowerCase()}"`),
      `la migration de perf ne doit pas recréer ${policy}`);
  }
});

test("PERF 13. la migration est rejouable : tout CREATE POLICY est précédé d'un DROP", () => {
  const crees = [...PERF.matchAll(/create policy\s+"([^"]+)"/gi)].map((m) => m[1]);
  assert.equal(crees.length, 20, `${crees.length} policies créées au lieu de 20`);
  for (const nom of crees) {
    assert.ok(PERF_PLAT.includes(`drop policy if exists "${nom.toLowerCase()}"`),
      `${nom} créée sans DROP IF EXISTS préalable`);
  }
});

test("PERF 14. le statement_timeout manuel est retiré, et SEULEMENT lui", () => {
  assert.ok(
    /alter function public\.save_nutrition_plan_v2\(jsonb\) reset statement_timeout/i.test(PERF),
    "le reset du statement_timeout posé à la main est absent",
  );
  assert.ok(!/reset\s+all/i.test(PERF),
    "RESET ALL effacerait aussi le search_path='' de save_nutrition_plan_v2");
  assert.ok(!/alter function public\.save_nutrition_plan_v2\(jsonb\)\s+set\s+search_path/i.test(PERF),
    "le search_path de save_nutrition_plan_v2 ne doit pas être modifié");
  // `\b` AVANT « set » est indispensable : sans lui, le motif retrouve le
  // « set » de « re-set » et l'assertion échoue sur le reset qu'elle est
  // justement censée approuver.
  assert.ok(!/\bset\s+statement_timeout/i.test(PERF),
    "aucun délai ne doit être POSÉ par cette migration (seul un reset est permis)");
});

test("PERF 15. les fonctions can_manage_* de P13-A ne sont ni supprimées ni réécrites", () => {
  for (const fn of FONCTIONS_PROPRIETE) {
    assert.ok(!new RegExp(`create or replace function public\\.${fn}\\(`, "i").test(PERF),
      `${fn} ne doit pas être réécrite par la migration de perf`);
  }
  assert.ok(!/drop function/i.test(PERF), "aucune fonction supprimée");
});

test("PERF 16. la checklist reconnaît les fonctions ensemblistes comme propriété", () => {
  // J3 listait les marqueurs de propriété en dur. La reformulation du
  // 20261003090000 a introduit six noms qu'il ne connaissait pas : il
  // déclarait 7 tables « sans propriété » alors qu'elles en avaient une.
  // Un FAUX NÉGATIF — le contrôle accusait du vide.
  const checklist = sansCommentairesSql(
    lire("supabase/tests/nutrition_isolation_multi_coachs_checklist.sql"),
  );
  for (const fn of FONCTIONS_ENSEMBLES) {
    assert.ok(
      checklist.includes(`'${fn}'`),
      `J3 ne reconnaît pas ${fn} comme marqueur de propriété`,
    );
  }
  // Et les marqueurs de P13-A restent reconnus : la checklist doit valider les
  // DEUX formes, pour qu'une base non encore migrée passe aussi.
  for (const fn of FONCTIONS_PROPRIETE) {
    assert.ok(checklist.includes(`'${fn}'`), `J3 ne reconnaît plus ${fn}`);
  }
});

test("PERF 17. J3 n'est pas devenu plus permissif : il exige une propriété RÉELLE", () => {
  // Le risque, en allongeant une liste de noms acceptés, est de transformer un
  // contrôle en formalité. On vérifie que J3 refuse explicitement qu'un
  // `is_admin()` seul tienne lieu de policy de propriété, et qu'il reste
  // conditionnel (un `v_n = 0` à satisfaire, pas un `true` constant).
  const checklist = sansCommentairesSql(
    lire("supabase/tests/nutrition_isolation_multi_coachs_checklist.sql"),
  );
  const i = checklist.indexOf("J3. les 8 tables du cœur portent une policy de propriété");
  assert.ok(i !== -1, "le contrôle J3 a disparu");
  // Le bloc J3 va de la déclaration des marqueurs au noter() qui le conclut.
  const debut = checklist.lastIndexOf("c_marqueurs constant text[]", i);
  assert.ok(debut !== -1 && debut < i, "J3 ne déclare plus de liste de marqueurs");
  const bloc = checklist.slice(debut, checklist.indexOf("v_n = 0);", i) + 9);

  assert.ok(/not in \('is_admin\(\)'/.test(bloc.replace(/\s+/g, " ")),
    "J3 n'exclut plus la policy administrateur : un is_admin() seul le satisferait");
  assert.ok(/v_n = 0\)/.test(bloc), "J3 n'est plus conditionnel");
  assert.ok(!/noter\('J',\s*format\([^)]*\),\s*true\)/.test(bloc.replace(/\s+/g, " ")),
    "J3 est devenu inconditionnel (passé à true)");
});

test("PERF 18. la checklist sépare accès admin, accès coach et accès élève", () => {
  const checklist = sansCommentairesSql(
    lire("supabase/tests/nutrition_isolation_multi_coachs_checklist.sql"),
  );
  // J3b : une policy admin DISTINCTE par table.
  assert.ok(checklist.includes("J3b."), "le contrôle J3b (policy admin distincte) est absent");
  assert.ok(/_manage_admin/.test(checklist.slice(checklist.indexOf("J3b.") - 900, checklist.indexOf("J3b."))),
    "J3b ne vérifie pas la policy _manage_admin");
  // J3c : admin et élève jamais fondus dans un même prédicat.
  assert.ok(checklist.includes("J3c."), "le contrôle J3c (admin ≠ élève) est absent");
  const j3c = checklist.slice(checklist.indexOf("J3c.") - 900, checklist.indexOf("J3c."));
  assert.ok(/is_admin\(\)/.test(j3c) && /current_student_id\(\)/.test(j3c),
    "J3c ne croise pas is_admin() et current_student_id()");
  // J3d : contrôle du contrôle — les marqueurs doivent exister en base.
  assert.ok(checklist.includes("J3d."), "le contrôle J3d (marqueurs existants) est absent");
  // J3e : la séparation lecture/écriture, ajoutée par P13-B/4.
  assert.ok(checklist.includes("J3e."), "le contrôle J3e (lecture ≠ écriture) est absent");
  const j3e = checklist.slice(checklist.indexOf("J3e.") - 1200, checklist.indexOf("J3e."));
  assert.ok(/_lecture\(\)/.test(j3e) && /_ecriture\(\)/.test(j3e),
    "J3e ne compare pas un ensemble de lecture à un ensemble d'écriture");

  // ⚠️ CHAQUE ÉTIQUETTE EST UNIQUE. Deux contrôles nommés pareil rendent le
  // bilan ambigu, et ce test-ci localise un contrôle PAR SON NOM : un doublon
  // le ferait inspecter le mauvais bloc. C'est exactement ce qui est arrivé
  // quand la séparation lecture/écriture a été ajoutée sous le nom « J3c ».
  for (const etiquette of ["J3.", "J3b.", "J3c.", "J3d.", "J3e."]) {
    const occurrences = checklist.split(`'${etiquette}`).length - 1 + (checklist.split(`"${etiquette}`).length - 1);
    assert.equal(occurrences, 1, `l'étiquette ${etiquette} apparaît ${occurrences} fois — chaque contrôle doit être unique`);
  }
});

test("PERF 19. le script de mesure exerce la RPC, pas un SELECT, et ne laisse rien", () => {
  const mesure = lire("supabase/tests/p13a_perf_sauvegarde_mesure.sql");
  const sansProse = sansCommentairesSql(mesure);
  // La RPC complète, deux fois : création puis réécriture (le cas qui échouait).
  const appels = (sansProse.match(/save_nutrition_plan_v2\(/g) ?? []).length;
  assert.ok(appels >= 2,
    `la mesure n'appelle la RPC que ${appels} fois : il faut la création ET la réécriture`);
  // CHAQUE appel de la RPC doit avoir son propre garde-fou 57014, et chacun
  // doit LEVER. Se contenter de constater que « query_canceled » apparaît
  // quelque part laisserait passer un gestionnaire vidé sur l'un des deux.
  const branches = [...sansProse.matchAll(/when\s+query_canceled\s+then([\s\S]*?)(?=\bwhen\s+\w+\s+then\b|\bend\b)/gi)];
  assert.ok(
    branches.length >= appels,
    `${appels} appel(s) à la RPC mais seulement ${branches.length} gestionnaire(s) de 57014`,
  );
  for (const b of branches) {
    assert.ok(
      /raise\s+exception/i.test(b[1]),
      "un gestionnaire de 57014 n'échoue pas : un timeout passerait pour un succès",
    );
  }
  assert.ok(/clock_timestamp\(\)/.test(sansProse), "aucun chronométrage");
  // Identité d'un coach autorisé, pas l'admin.
  assert.ok(/set local role authenticated/.test(sansProse), "la mesure ne pose pas le rôle");
  assert.ok(/request\.jwt\.claims/.test(sansProse), "la mesure ne pose pas d'identité");
  // Tout est annulé, et on le vérifie après coup.
  assert.ok(/^rollback;/m.test(sansProse), "la mesure ne finit pas par un rollback");

  // Les contrôles de survie se jugent APRÈS le rollback, et chacun doit lever.
  // Chercher « Perf plan P13-A » dans tout le fichier ne prouverait rien : la
  // chaîne figure aussi dans la charge utile.
  const apresRollback = sansProse.slice(sansProse.search(/^rollback;/m));
  for (const [motif, quoi] of [
    [/auth\.users[\s\S]*?perf\.%@test\.local/, "les comptes"],
    [/nutrition_plans[\s\S]*?Perf plan P13-A/, "le plan"],
    [/food_catalog[\s\S]*?Perf aliment/, "les aliments"],
  ] as const) {
    assert.ok(motif.test(apresRollback), `aucun contrôle de survie pour ${quoi} après le ROLLBACK`);
  }
  const levees = (apresRollback.match(/raise exception/g) ?? []).length;
  assert.ok(levees >= 3,
    `seulement ${levees} contrôle(s) de survie lèvent après le ROLLBACK : il en faut un par famille de données`);
});

test("PERF 20. le script de mesure vérifie le cloisonnement et l'équivalence des deux formes", () => {
  const mesure = sansCommentairesSql(lire("supabase/tests/p13a_perf_sauvegarde_mesure.sql"));
  // Deux coachs + admin réellement endossés.
  const subs = new Set([...mesure.matchAll(/"sub"\s*:\s*"([0-9a-f-]{36})"/gi)].map((m) => m[1]));
  assert.ok(subs.size >= 2, `la mesure n'endosse que ${subs.size} identité(s)`);
  assert.ok(/noter_perf/.test(mesure), "aucun contrôle de cloisonnement n'est consigné");
  // L'équivalence ancienne forme / nouvelle forme, en différence symétrique.
  assert.ok(/can_manage_nutrition_plan/.test(mesure) && /nutrition_plan_ids_geres/.test(mesure),
    "la mesure ne compare pas les deux formes de la règle");
  // On ne cherche PAS un motif « (select … except … ) union all ( … ) » : les
  // opérandes contiennent eux-mêmes des parenthèses (appels de fonction), et
  // une classe `[^()]*` ne peut pas les traverser. On exprime donc l'intention
  // directement : de part et d'autre de chaque `union all`, l'opérande doit
  // être PARENTHÉSÉ — sinon `A except B union all B except A` s'associe à
  // gauche et ne calcule pas une différence symétrique.
  const plat = mesure.replace(/\s+/g, " ");
  const unions = [...plat.matchAll(/union all/gi)];
  assert.ok(unions.length > 0, "aucune comparaison des deux formes");
  for (const u of unions) {
    const avantU = plat.slice(0, u.index).trimEnd();
    const apresU = plat.slice(u.index! + "union all".length).trimStart();
    assert.ok(
      avantU.endsWith(")") && apresU.startsWith("("),
      "la différence symétrique n'est pas parenthésée : `A except B union all B except A` s'associe à gauche et masquerait les écarts",
    );
  }
  // Et le contrôle du contrôle contre un vert par vacuité.
  assert.ok(/CONTRÔLE VIDE/.test(mesure),
    "rien n'empêche un « aucun écart » vrai par vacuité");
});

/** Le script de mesure, commentaires retirés. */
const MESURE = sansCommentairesSql(lire("supabase/tests/p13a_perf_sauvegarde_mesure.sql"));

test("PERF 21. la comparaison nomme explicitement la colonne de retour des deux côtés", () => {
  // `…_ids_geres()` est `returns setof uuid` : un type SCALAIRE. Dans un FROM,
  // PostgreSQL nomme sa colonne d'après LA FONCTION, pas `id`. Écrire
  // `select id from public.nutrition_plan_ids_geres()` lève « column "id" does
  // not exist » — ce qui a cassé le contrôle d'équivalence.
  assert.ok(
    !/select\s+id\s+from\s+public\.\w*_ids_geres\s*\(\s*\)/i.test(MESURE),
    "la comparaison lit encore une colonne « id » inexistante sur une fonction setof uuid",
  );
  // Chaque lecture dans un FROM doit porter un alias de colonne explicite.
  for (const m of MESURE.matchAll(/from\s+public\.(\w*_ids_geres)\s*\(\s*\)([^\n]*)/gi)) {
    assert.ok(
      /\bas\s+\w+\s*\(\s*\w+\s*\)/i.test(m[2]),
      `${m[1]}() est lue sans alias de colonne explicite : « ${m[0].trim()} »`,
    );
  }
  // Et les deux directions de l'EXCEPT sont toujours là.
  assert.equal(
    (MESURE.match(/\bexcept\b/gi) ?? []).length,
    2,
    "la comparaison n'a plus ses deux directions",
  );
});

test("PERF 22. la limite de 8 s est imposée au NIVEAU SUPÉRIEUR, hors des blocs do $$", () => {
  // Même règle que pour l'`alter function … set statement_timeout` : PostgreSQL
  // arme le minuteur au démarrage d'une instruction de plus haut niveau. Un
  // `set local` écrit DANS un `do $$` ne protégerait pas ce bloc, puisque le
  // bloc est lui-même l'instruction déjà armée.
  const lignes = lire("supabase/tests/p13a_perf_sauvegarde_mesure.sql").split("\n");
  let dansCorps = false;
  let trouve = false;
  for (const l of lignes) {
    const code = l.includes("--") ? l.slice(0, l.indexOf("--")) : l;
    const pos = code.search(/set\s+local\s+statement_timeout/i);
    if (pos !== -1) {
      // Les `$$` qui PRÉCÈDENT le SET sur la même ligne comptent : un
      // `do $$ begin set local … end $$;` tient sur une ligne, et tester
      // l'état d'avant la ligne le déclarerait à tort au niveau supérieur.
      const ouvertsAvant = (code.slice(0, pos).match(/\$\$/g) ?? []).length;
      const dedansIci = ouvertsAvant % 2 === 1 ? !dansCorps : dansCorps;
      assert.ok(!dedansIci,
        "le SET LOCAL statement_timeout est à l'intérieur d'un corps $$ : il n'armerait pas le minuteur du bloc");
      assert.ok(/'8s'/.test(code), `la limite posée n'est pas 8s : « ${code.trim()} »`);
      trouve = true;
    }
    for (let i = 0; i < (code.match(/\$\$/g) ?? []).length; i += 1) dansCorps = !dansCorps;
  }
  assert.ok(trouve, "la mesure n'impose aucune limite : elle tournerait sans garde-fou");

  // Elle doit être LOCALE — jamais un SET global ni un ALTER ROLE/DATABASE.
  assert.ok(!/^\s*set\s+statement_timeout/im.test(MESURE),
    "un SET non-LOCAL fuirait hors de la transaction");
  assert.ok(!/alter\s+(role|database|system)/i.test(MESURE),
    "la mesure ne doit toucher ni rôle, ni base, ni configuration serveur");

  // Un garde-fou doit refuser de mesurer si la limite n'a pas pris.
  assert.ok(/LIMITE NON IMPOSÉE/.test(lire("supabase/tests/p13a_perf_sauvegarde_mesure.sql")),
    "rien n'empêche de présenter comme valide une mesure faite sans limite");

  // La valeur effective est constatée juste avant CHAQUE appel.
  const avantAppels = (MESURE.match(/current_setting\('statement_timeout'\)/g) ?? []).length;
  assert.ok(avantAppels >= 4,
    `statement_timeout n'est constaté que ${avantAppels} fois : il faut la vérification initiale, puis avant chaque appel`);

  // Chaque appel RPC dans son propre bloc, pour que chacun ait le même budget
  // qu'en production (un appel PostgREST = une instruction).
  const blocs = MESURE.split(/\bdo \$\$/).filter((b) => /save_nutrition_plan_v2\(/.test(b));
  assert.equal(blocs.length, 2,
    `les deux appels doivent être dans deux blocs distincts (trouvé ${blocs.length})`);
  // Et UN SEUL appel par bloc : deux appels dans le même bloc partageraient un
  // unique budget de 8 s, alors qu'en production chacun a le sien.
  for (const b of blocs) {
    const n = (b.match(/save_nutrition_plan_v2\(/g) ?? []).length;
    assert.equal(n, 1,
      `un bloc contient ${n} appels à la RPC : ils partageraient le même budget de 8 s`);
  }
});

test("PERF 23. le compteur de policies ensemblistes attend le bon nombre, pour la bonne raison", () => {
  const brut = lire("supabase/tests/p13a_perf_sauvegarde_mesure.sql");
  // Il doit compter qual ET with_check : une policy FOR INSERT n'a pas de
  // `qual`, PostgreSQL ne lui stocke qu'un `with_check`.
  const i = brut.indexOf("policies_en_forme_ensembliste");
  const bloc = brut.slice(Math.max(0, i - 700), i);
  assert.ok(/coalesce\(qual/.test(bloc) && /coalesce\(with_check/.test(bloc),
    "le compteur ignore with_check : il manquera nutrition_plans_insert_own_coach");

  // L'attendu affiché doit être 10, calculé — pas un nombre posé au jugé.
  assert.ok(/Attendu après 20261003090000\s*:\s*6\s*\|\s*10\s*\|/.test(brut),
    "l'attendu affiché ne vaut pas 10");

  // Et il doit valoir 10 d'après la migration elle-même : on recompte ici.
  const policies = [...PERF.matchAll(
    /create policy\s+"([^"]+)"\s+on\s+public\.(\w+)\s+for\s+(\w+)\s+to\s+\w+([\s\S]*?);(?=\s*(?:\n|$))/gi,
  )];
  const ensemblistes = policies.filter((m) => /_ids_geres/.test(m[4]));
  assert.equal(ensemblistes.length, 10,
    `la migration contient ${ensemblistes.length} policies ensemblistes, l'attendu dit 10`);

  // Les 10 autres ne DOIVENT PAS l'être : les y faire entrer signifierait que
  // l'accès admin ou l'accès élève passe par la propriété coach.
  const autres = policies.filter((m) => !/_ids_geres/.test(m[4])).map((m) => m[1]);
  assert.equal(autres.length, 10, `${autres.length} policies hors forme ensembliste au lieu de 10`);
  for (const nom of autres) {
    assert.ok(
      nom.endsWith("_manage_admin")
        || nom === "nutrition_plans_delete_own_coach"
        || nom === "nutrition_daily_logs_manage_own_student",
      `${nom} n'utilise pas la forme ensembliste sans raison connue`,
    );
  }
});


// ════════════════════════════════════════════════════════════════════════════
// GARDE ADMIN SUR LE CHEMIN D'ÉCRITURE — migration 20261003190000
// ════════════════════════════════════════════════════════════════════════════
// 20261003090000 a réglé la LECTURE (ensembles hachés, une évaluation par
// instruction) mais a laissé l'ÉCRITURE en l'état : pour un INSERT d'une seule
// ligne, l'ensemble entier est recalculé afin de valider cette ligne — 46 ms
// mesurés sur la production, soit bien au-delà du budget de 8 s pour le
// millier de lignes d'un plan complet. La garde `not (select
// public.is_admin()) and (…)` court-circuite la branche coach pour l'admin :
// 9,9 ms pour le même INSERT. Ces tests verrouillent cette garde — et surtout
// verrouillent ce qu'elle NE DOIT PAS toucher.

const CHEMIN_MIGRATION_GARDE =
  "supabase/migrations/20261003190000_p13a_perf_garde_admin_ecriture.sql";
const GARDE_BRUTE = lire(CHEMIN_MIGRATION_GARDE);
const GARDE = sansCommentairesSql(GARDE_BRUTE);
const GARDE_PLAT = GARDE.replace(/\s+/g, " ").toLowerCase();

/** Les 11 policies coach de P13-A, avec les clauses que chacune possède. */
const POLICIES_COACH_GARDEES: Record<string, { using: boolean; check: boolean }> = {
  nutrition_plans_select_own_coach: { using: true, check: false },
  nutrition_plans_insert_own_coach: { using: false, check: true },
  nutrition_plans_update_own_coach: { using: true, check: true },
  nutrition_plans_delete_own_coach: { using: true, check: false },
  nutrition_days_manage_own_coach: { using: true, check: true },
  nutrition_plan_profiles_manage_own_coach: { using: true, check: true },
  nutrition_meal_slot_targets_manage_own_coach: { using: true, check: true },
  meals_manage_own_coach: { using: true, check: true },
  meal_choice_slots_manage_own_coach: { using: true, check: true },
  meal_choice_options_manage_own_coach: { using: true, check: true },
  nutrition_daily_logs_manage_own_coach: { using: true, check: true },
};

/** Le prédicat de propriété attendu dans chaque policy, APRÈS la garde. */
const PROPRIETE_ATTENDUE: Record<string, RegExp> = {
  nutrition_plans_select_own_coach: /student_ids_geres\(\)[\s\S]*current_coach_id\(\)/,
  nutrition_plans_insert_own_coach: /student_ids_geres\(\)[\s\S]*current_coach_id\(\)/,
  nutrition_plans_update_own_coach: /student_ids_geres\(\)[\s\S]*current_coach_id\(\)/,
  nutrition_plans_delete_own_coach: /student_id is null[\s\S]*current_coach_id\(\)/,
  nutrition_days_manage_own_coach: /plan_id in \(select public\.nutrition_plan_ids_geres\(\)\)/,
  nutrition_plan_profiles_manage_own_coach: /plan_id in \(select public\.nutrition_plan_ids_geres\(\)\)/,
  nutrition_meal_slot_targets_manage_own_coach: /profile_id in \(select public\.nutrition_plan_profile_ids_geres\(\)\)/,
  meals_manage_own_coach: /nutrition_day_id in \(select public\.nutrition_day_ids_geres\(\)\)/,
  meal_choice_slots_manage_own_coach: /meal_id in \(select public\.meal_ids_geres\(\)\)/,
  meal_choice_options_manage_own_coach: /slot_id in \(select public\.meal_choice_slot_ids_geres\(\)\)/,
  nutrition_daily_logs_manage_own_coach: /student_id in \(select public\.student_ids_geres\(\)\)/,
};

/**
 * Extrait l'expression parenthésée qui suit `depuis`, en comptant les
 * parenthèses. Une recherche par regex gloutonne attraperait la clause
 * suivante ; une recherche paresseuse s'arrêterait à la première parenthèse
 * fermante interne, et ces expressions en contiennent plusieurs niveaux.
 */
function expressionParenthesee(source: string, depuis: number): string {
  const debut = source.indexOf("(", depuis);
  if (debut === -1) throw new Error("aucune parenthèse ouvrante après l'indice donné");
  let niveau = 0;
  for (let i = debut; i < source.length; i += 1) {
    if (source[i] === "(") niveau += 1;
    else if (source[i] === ")") {
      niveau -= 1;
      if (niveau === 0) return source.slice(debut, i + 1);
    }
  }
  throw new Error("parenthèse jamais refermée");
}

/** Les `alter policy` de la migration, découpés et indexés par nom. */
const ALTERS_GARDE = (() => {
  const trouves = new Map<string, { table: string; corps: string }>();
  const re = /alter policy\s+"([^"]+)"\s+on\s+public\.(\w+)([\s\S]*?);(?=\s*(?:\n|$))/gi;
  for (const m of GARDE.matchAll(re)) {
    trouves.set(m[1], { table: m[2], corps: m[3] });
  }
  return trouves;
})();

/** Les clauses d'un corps d'`alter policy`, par type. */
function clausesDe(corps: string): { using?: string; check?: string } {
  const out: { using?: string; check?: string } = {};
  const iCheck = corps.search(/\bwith\s+check\b/i);
  // `using` doit être cherché HORS de la clause with check : l'expression du
  // with check peut elle-même contenir le mot dans un sous-select.
  const zoneUsing = iCheck === -1 ? corps : corps.slice(0, iCheck);
  const iUsing = zoneUsing.search(/\busing\b/i);
  if (iUsing !== -1) out.using = expressionParenthesee(zoneUsing, iUsing);
  if (iCheck !== -1) out.check = expressionParenthesee(corps, iCheck);
  return out;
}

test("GARDE 1. la migration de garde admin existe et ne touche ni schéma, ni droits, ni délais", () => {
  assert.ok(GARDE.trim().length > 0, "la migration de garde est vide");
  for (const interdit of [
    "create table", "alter table", "drop table", "add column", "drop column",
    "grant ", "revoke ", "create or replace function", "drop function",
    "statement_timeout", "search_path", "alter role", "alter database",
    "enable row level security", "disable row level security", "force row level security",
  ]) {
    assert.ok(!GARDE_PLAT.includes(interdit),
      `la migration de garde contient « ${interdit} » : elle doit se limiter aux prédicats des policies`);
  }
});

test("GARDE 2. c'est un delta pur : 11 ALTER POLICY, aucun CREATE ni DROP de policy", () => {
  assert.ok(!/\bcreate\s+policy\b/i.test(GARDE),
    "la migration recrée une policy : un ALTER suffit et évite de perdre une clause en route");
  assert.ok(!/\bdrop\s+policy\b/i.test(GARDE),
    "la migration supprime une policy : une fenêtre sans protection s'ouvrirait entre le DROP et le CREATE");
  assert.equal(ALTERS_GARDE.size, 11,
    `${ALTERS_GARDE.size} ALTER POLICY au lieu des 11 policies coach de P13-A`);
  for (const nom of Object.keys(POLICIES_COACH_GARDEES)) {
    assert.ok(ALTERS_GARDE.has(nom), `${nom} n'est pas gardée : son chemin d'écriture reste lent`);
  }
});

test("GARDE 3. chaque clause de chaque policy coach commence par la garde admin", () => {
  for (const [nom, attendu] of Object.entries(POLICIES_COACH_GARDEES)) {
    const alt = ALTERS_GARDE.get(nom);
    assert.ok(alt, `${nom} absente`);
    const clauses = clausesDe(alt.corps);
    assert.equal(clauses.using !== undefined, attendu.using,
      `${nom} : présence de USING inattendue (attendu ${attendu.using})`);
    assert.equal(clauses.check !== undefined, attendu.check,
      `${nom} : présence de WITH CHECK inattendue (attendu ${attendu.check})`);
    for (const [type, expr] of Object.entries(clauses)) {
      const plat = (expr as string).replace(/\s+/g, " ").toLowerCase();
      // La garde doit être le PREMIER opérande du `and` : placée après, elle
      // ne court-circuiterait rien, les sous-plans ayant déjà été évalués.
      assert.ok(/^\(\s*not \(select public\.is_admin\(\)\)\s+and\b/.test(plat),
        `${nom} (${type}) ne commence pas par « not (select public.is_admin()) and » : ${plat.slice(0, 90)}`);
    }
  }
});

test("GARDE 4. la garde est hissable : (select …) et non un appel nu par ligne", () => {
  // `not public.is_admin()` sans sous-select est évalué À CHAQUE LIGNE :
  // la garde coûterait alors ce qu'elle prétend économiser.
  const nus = [...GARDE_PLAT.matchAll(/not\s+public\.is_admin\(\)/g)];
  assert.equal(nus.length, 0,
    `${nus.length} appel(s) nu(s) à is_admin() : sans (select …) il n'y a pas d'InitPlan, donc pas de court-circuit`);
  const gardes = [...GARDE_PLAT.matchAll(/not \(select public\.is_admin\(\)\)/g)];
  assert.equal(gardes.length, 19,
    `${gardes.length} gardes trouvées au lieu de 19 (11 policies : 9 USING + 10 WITH CHECK)`);
});

test("GARDE 5. la règle de propriété est AJOUTÉE À, jamais remplacée", () => {
  for (const [nom, motif] of Object.entries(PROPRIETE_ATTENDUE)) {
    const alt = ALTERS_GARDE.get(nom);
    assert.ok(alt, `${nom} absente`);
    const clauses = clausesDe(alt.corps);
    for (const [type, expr] of Object.entries(clauses)) {
      const plat = (expr as string).replace(/\s+/g, " ").toLowerCase();
      assert.ok(motif.test(plat),
        `${nom} (${type}) a perdu son prédicat de propriété : la garde doit s'ajouter, pas se substituer`);
    }
  }
});

test("GARDE 6. aucune policy ADMIN n'est gardée — ce serait lui retirer son accès", () => {
  // `not is_admin() and is_admin()` est toujours faux : appliquer la garde à
  // une policy `_manage_admin` couperait l'admin de la table.
  for (const table of TABLES_COEUR) {
    assert.ok(!ALTERS_GARDE.has(`${table}_manage_admin`),
      `${table}_manage_admin est modifiée : la garde la rendrait contradictoire`);
  }
  assert.ok(!/_manage_admin/.test(GARDE),
    "une policy _manage_admin est nommée dans le SQL de la migration");
});

test("GARDE 7. aucune policy ÉLÈVE n'est touchée", () => {
  assert.ok(!ALTERS_GARDE.has("nutrition_daily_logs_manage_own_student"),
    "la policy élève du journal est gardée : l'élève n'est pas admin, la garde n'y a aucun sens et ajoute un appel");
  for (const nom of POLICIES_ELEVE_INTOUCHABLES) {
    assert.ok(!GARDE.includes(nom), `${nom} est nommée dans la migration de garde`);
  }
  assert.ok(!/current_student_id/.test(GARDE),
    "la migration de garde manipule l'identité élève");
});

test("GARDE 8. la garde source_list_id de meal_choice_slots survit, DANS la branche coach", () => {
  const alt = ALTERS_GARDE.get("meal_choice_slots_manage_own_coach");
  assert.ok(alt, "meal_choice_slots_manage_own_coach absente");
  const clauses = clausesDe(alt.corps);
  const plat = (clauses.check ?? "").replace(/\s+/g, " ").toLowerCase();
  assert.ok(/source_list_id is null/.test(plat) && /food_lists fl/.test(plat)
    && /fl\.coach_id = \(select public\.current_coach_id\(\)\)/.test(plat),
    "le WITH CHECK a perdu la garde source_list_id : un coach pourrait pointer la liste d'un autre");
  // Elle doit rester DANS la branche coach : hors de la garde, elle serait
  // évaluée pour l'admin aussi, et c'est précisément le coût qu'on retire.
  assert.ok(/^\(\s*not \(select public\.is_admin\(\)\)\s+and\b/.test(plat),
    "la garde source_list_id n'est pas sous la garde admin");
});

test("GARDE 9. CONTRÔLE DU CONTRÔLE — ces tests échouent si la garde disparaît", () => {
  // Une migration identique dont on retire la garde doit faire tomber GARDE 3.
  const sansGarde = GARDE.replace(/not \(select public\.is_admin\(\)\)\s+and\s+/gi, "");
  const re = /alter policy\s+"([^"]+)"\s+on\s+public\.(\w+)([\s\S]*?);(?=\s*(?:\n|$))/gi;
  let vues = 0;
  let gardees = 0;
  for (const m of sansGarde.matchAll(re)) {
    vues += 1;
    const clauses = clausesDe(m[3]);
    for (const expr of Object.values(clauses)) {
      const plat = (expr as string).replace(/\s+/g, " ").toLowerCase();
      if (/^\(\s*not \(select public\.is_admin\(\)\)\s+and\b/.test(plat)) gardees += 1;
    }
  }
  assert.equal(vues, 11, `le découpage de contrôle a vu ${vues} policies au lieu de 11`);
  assert.equal(gardees, 0,
    "la détection de la garde reste positive sur un texte d'où elle a été retirée : elle ne teste rien");
});


// ════════════════════════════════════════════════════════════════════════════
// LECTURE ÉLÈVE EN FORME ENSEMBLISTE — migration 20261003200000
// ════════════════════════════════════════════════════════════════════════════
// Les policies élève étaient des EXISTS corrélés traversant jusqu'à quatre
// tables, dont chacune réapplique sa propre RLS : le plan d'un UPDATE de neuf
// lignes atteignait ~576 nœuds et 107 ms de PLANIFICATION, replanifiés cinq
// fois par plpgsql avant bascule en plan générique. Comme PostgreSQL exige de
// pouvoir LIRE une ligne pour la modifier, un administrateur payait ce prix à
// chacune des ~1 300 instructions d'une réécriture de plan. Ces tests
// verrouillent la forme ensembliste, et surtout ce qu'elle ne doit pas
// toucher.

const CHEMIN_MIGRATION_ELEVE =
  "supabase/migrations/20261003200000_p13a_perf_lecture_eleve_ensembliste.sql";
const ELEVE_BRUT = lire(CHEMIN_MIGRATION_ELEVE);
const ELEVE = sansCommentairesSql(ELEVE_BRUT);
const ELEVE_PLAT = ELEVE.replace(/\s+/g, " ").toLowerCase();

/** Les cinq ensembles élève, tous sans argument. */
const FONCTIONS_ENSEMBLES_ELEVE = [
  "nutrition_plan_ids_eleve",
  "nutrition_day_ids_eleve",
  "nutrition_plan_profile_ids_eleve",
  "meal_ids_eleve",
  "meal_choice_slot_ids_eleve",
] as const;

/** Les 8 policies élève et le prédicat de propriété attendu dans chacune. */
const POLICIES_ELEVE_ENSEMBLISTES: Record<string, RegExp> = {
  // Pas de jointure à faire : le plan porte student_id directement.
  nutrition_plans_select_self_or_assigned:
    /student_id = \(select public\.current_student_id\(\)\)[\s\S]*status <> 'prochain'/,
  nutrition_days_select_self_or_assigned:
    /plan_id in \(select public\.nutrition_plan_ids_eleve\(\)\)/,
  nutrition_days_update_self:
    /plan_id in \(select public\.nutrition_plan_ids_eleve\(\)\)/,
  nutrition_plan_profiles_select_assigned:
    /plan_id in \(select public\.nutrition_plan_ids_eleve\(\)\)/,
  nutrition_meal_slot_targets_select_assigned:
    /profile_id in \(select public\.nutrition_plan_profile_ids_eleve\(\)\)/,
  meals_select_self_or_assigned:
    /nutrition_day_id in \(select public\.nutrition_day_ids_eleve\(\)\)/,
  meal_choice_slots_select_assigned:
    /meal_id in \(select public\.meal_ids_eleve\(\)\)/,
  meal_choice_options_select_assigned:
    /slot_id in \(select public\.meal_choice_slot_ids_eleve\(\)\)/,
};

/** Les `alter policy` de la migration élève, indexés par nom. */
const ALTERS_ELEVE = (() => {
  const trouves = new Map<string, { table: string; corps: string }>();
  const re = /alter policy\s+"([^"]+)"\s+on\s+public\.(\w+)([\s\S]*?);(?=\s*(?:\n|$))/gi;
  for (const m of ELEVE.matchAll(re)) trouves.set(m[1], { table: m[2], corps: m[3] });
  return trouves;
})();

test("ÉLÈVE 1. la migration existe et ne touche ni schéma, ni droits de table, ni délais", () => {
  assert.ok(ELEVE.trim().length > 0, "la migration est vide");
  for (const interdit of [
    "create table", "alter table", "drop table", "add column", "drop column",
    "grant select", "grant insert", "grant update", "grant delete", "grant all",
    "statement_timeout", "alter role", "alter database",
    "enable row level security", "disable row level security", "force row level security",
  ]) {
    assert.ok(!ELEVE_PLAT.includes(interdit),
      `la migration contient « ${interdit} » : elle doit se limiter aux fonctions d'ensemble et aux prédicats`);
  }
});

test("ÉLÈVE 2. delta pur : 8 ALTER POLICY, aucun CREATE ni DROP de policy", () => {
  assert.ok(!/\bcreate\s+policy\b/i.test(ELEVE), "la migration recrée une policy");
  assert.ok(!/\bdrop\s+policy\b/i.test(ELEVE),
    "la migration supprime une policy : une fenêtre sans protection s'ouvrirait");
  assert.equal(ALTERS_ELEVE.size, 8,
    `${ALTERS_ELEVE.size} ALTER POLICY au lieu des 8 policies élève`);
  for (const nom of Object.keys(POLICIES_ELEVE_ENSEMBLISTES)) {
    assert.ok(ALTERS_ELEVE.has(nom), `${nom} n'est pas reprise : son chemin reste coûteux`);
  }
});

test("ÉLÈVE 3. les cinq ensembles élève sont SANS ARGUMENT — c'est tout l'objet du correctif", () => {
  for (const f of FONCTIONS_ENSEMBLES_ELEVE) {
    const re = new RegExp(
      `create (?:or replace )?function\\s+public\\.${f}\\s*\\(([^)]*)\\)\\s*returns\\s+setof\\s+uuid`, "i");
    const m = ELEVE.match(re);
    assert.ok(m, `${f} absente, mal nommée, ou ne renvoie pas setof uuid`);
    assert.equal(m[1].trim(), "",
      `${f} prend un argument : elle serait de nouveau évaluée une fois PAR LIGNE`);
  }
  assert.equal(
    [...ELEVE.matchAll(/create (?:or replace )?function\s+public\.(\w+)/gi)].length,
    FONCTIONS_ENSEMBLES_ELEVE.length,
    "la migration crée un nombre de fonctions différent des cinq ensembles attendus",
  );
});

test("ÉLÈVE 4. elles sont STABLE SECURITY DEFINER et nomment pg_temp EN DERNIER", () => {
  for (const f of FONCTIONS_ENSEMBLES_ELEVE) {
    const i = ELEVE.indexOf(`public.${f}()`);
    assert.ok(i !== -1, `${f} absente`);
    const entete = ELEVE.slice(i, i + 220).replace(/\s+/g, " ").toLowerCase();
    assert.ok(/stable security definer/.test(entete),
      `${f} n'est pas STABLE SECURITY DEFINER : sans DEFINER elle retraverserait la RLS`);
    const sp = entete.match(/set search_path = ([^a]*?as \$)/);
    assert.ok(sp, `${f} ne fige pas son search_path`);
    const chemins = sp[1].replace(/as \$$/, "").trim().split(",").map((x) => x.trim());
    assert.equal(chemins[chemins.length - 1], "pg_temp",
      `${f} : pg_temp n'est pas en dernier — non nommé il passe EN TÊTE, et un objet temporaire masquerait les tables`);
  }
});

test("ÉLÈVE 5. leur droit d'exécution est retiré à public et anon", () => {
  // `anon` a le droit TEMP : lui laisser EXECUTE exposerait la liste des
  // identifiants d'un élève à un appelant non authentifié.
  assert.ok(/revoke all on function public\.%I\(\) from public/i.test(ELEVE)
    || FONCTIONS_ENSEMBLES_ELEVE.every((f) => new RegExp(`revoke all on function public\\.${f}\\(\\) from public`, "i").test(ELEVE)),
    "le droit d'exécution n'est pas retiré à public");
  assert.ok(/revoke all on function public\.%I\(\) from anon/i.test(ELEVE)
    || FONCTIONS_ENSEMBLES_ELEVE.every((f) => new RegExp(`revoke all on function public\\.${f}\\(\\) from anon`, "i").test(ELEVE)),
    "le droit d'exécution n'est pas retiré à anon");
  const liste = ELEVE.match(/foreach f in array array\[([\s\S]*?)\]/i);
  if (liste) {
    for (const f of FONCTIONS_ENSEMBLES_ELEVE) {
      assert.ok(liste[1].includes(`'${f}'`), `${f} est absente de la boucle de révocation`);
    }
  }
});

test("ÉLÈVE 6. chaque policy élève commence par la garde hissée current_student_id()", () => {
  for (const nom of Object.keys(POLICIES_ELEVE_ENSEMBLISTES)) {
    const alt = ALTERS_ELEVE.get(nom);
    assert.ok(alt, `${nom} absente`);
    const clauses = clausesDe(alt.corps);
    assert.ok(clauses.using !== undefined, `${nom} ne réécrit pas son USING`);
    const plat = clauses.using.replace(/\s+/g, " ").toLowerCase();
    // La garde doit être le PREMIER opérande : placée après, elle
    // n'économiserait rien, l'ensemble ayant déjà été construit.
    assert.ok(/^\(\s*\(select public\.current_student_id\(\)\) is not null\s+and\b/.test(plat),
      `${nom} ne commence pas par « (select public.current_student_id()) is not null and » : ${plat.slice(0, 100)}`);
  }
});

test("ÉLÈVE 7. la règle de propriété élève est PRÉSERVÉE, pas remplacée", () => {
  for (const [nom, motif] of Object.entries(POLICIES_ELEVE_ENSEMBLISTES)) {
    const alt = ALTERS_ELEVE.get(nom);
    assert.ok(alt, `${nom} absente`);
    const plat = (clausesDe(alt.corps).using ?? "").replace(/\s+/g, " ").toLowerCase();
    assert.ok(motif.test(plat),
      `${nom} a perdu son prédicat de propriété élève : ${plat.slice(0, 120)}`);
  }
  // Le filtre de statut survit : sans lui, un plan « prochain » deviendrait
  // lisible par l'élève avant l'heure. Il est désormais DANS les fonctions.
  const occurrences = [...ELEVE_PLAT.matchAll(/status <> 'prochain'/g)].length;
  assert.ok(occurrences >= FONCTIONS_ENSEMBLES_ELEVE.length,
    `« status <> 'prochain' » n'apparaît que ${occurrences} fois : une fonction d'ensemble l'a perdu`);
  for (const f of FONCTIONS_ENSEMBLES_ELEVE) {
    const i = ELEVE.indexOf(`public.${f}()`);
    const corps = ELEVE.slice(i, ELEVE.indexOf("$f$;", i));
    assert.ok(/current_student_id\(\)/.test(corps) && /status <> 'prochain'/.test(corps),
      `${f} n'applique pas « élève courant ET statut <> prochain »`);
  }
});

test("ÉLÈVE 8. aucune policy ADMIN ni COACH n'est touchée par cette migration", () => {
  for (const nom of ALTERS_ELEVE.keys()) {
    assert.ok(!/_manage_admin$/.test(nom), `${nom} est une policy administrateur`);
    assert.ok(!/_own_coach$/.test(nom), `${nom} est une policy coach`);
  }
  assert.ok(!/is_admin/.test(ELEVE),
    "la migration élève manipule is_admin() : les deux chantiers doivent rester séparables");
  assert.ok(!/_ids_geres/.test(ELEVE),
    "la migration élève touche aux ensembles COACH");
  assert.ok(!ALTERS_ELEVE.has("nutrition_daily_logs_manage_own_student"),
    "le journal quotidien est repris alors que son prédicat est déjà direct");
});

test("ÉLÈVE 9. aucun WITH CHECK n'est réécrit — seule la LECTURE est reformulée", () => {
  // `nutrition_days_update_self` a un WITH CHECK : le réécrire ici, sans le
  // dire, changerait ce que l'élève a le droit d'écrire.
  for (const [nom, alt] of ALTERS_ELEVE) {
    assert.ok(clausesDe(alt.corps).check === undefined,
      `${nom} réécrit un WITH CHECK : hors périmètre de cette migration`);
  }
});

test("ÉLÈVE 10. CONTRÔLE DU CONTRÔLE — ces tests échouent si la forme régresse", () => {
  // (a) Sans la garde, ÉLÈVE 6 doit tomber.
  const sansGarde = ELEVE.replace(
    /\(select public\.current_student_id\(\)\) is not null\s+and\s+/gi, "");
  const re = /alter policy\s+"([^"]+)"\s+on\s+public\.\w+([\s\S]*?);(?=\s*(?:\n|$))/gi;
  let gardees = 0;
  let vues = 0;
  for (const m of sansGarde.matchAll(re)) {
    vues += 1;
    const plat = (clausesDe(m[2]).using ?? "").replace(/\s+/g, " ").toLowerCase();
    if (/^\(\s*\(select public\.current_student_id\(\)\) is not null\s+and\b/.test(plat)) gardees += 1;
  }
  assert.equal(vues, 8, `le découpage de contrôle a vu ${vues} policies au lieu de 8`);
  assert.equal(gardees, 0, "la détection de la garde reste positive sur un texte d'où elle a été retirée");

  // (b) Le retour à un EXISTS corrélé doit être visible : c'est LA forme que
  // cette migration supprime, et la seule qui réapplique la RLS traversée.
  assert.ok(!/\bexists\s*\(/i.test(ELEVE),
    "un EXISTS corrélé subsiste dans la migration : la chaîne de RLS n'est pas rompue");
});


// ════════════════════════════════════════════════════════════════════════════
// P13-B — CLOISONNEMENT PAR RÔLE ET PAR CATÉGORIE
// ════════════════════════════════════════════════════════════════════════════
// P13-A avait cloisonné les 8 tables du cœur nutrition. Il restait 72 policies
// sur 48 tables opposant `is_coach_or_admin()`, c'est-à-dire aucun
// cloisonnement : n'importe quel compte du staff lisait, modifiait et
// supprimait les élèves de tous les coachs. Ces tests verrouillent la fermeture
// de ce trou — et surtout ce qu'elle ne doit PAS emporter au passage.

const CHEMIN_P13B_MODELE =
  "supabase/migrations/20261011090000_p13b_modele_droits_collaborateurs.sql";
const CHEMIN_P13B_POLICIES =
  "supabase/migrations/20261011100000_p13b_policies_cloisonnees.sql";
const CHEMIN_P13B_FONCTIONS =
  "supabase/migrations/20261011110000_p13b_durcissement_fonctions_definer.sql";
const CHEMIN_P13B_NUTRITION =
  "supabase/migrations/20261011120000_p13b_integration_nutrition.sql";
const CHEMIN_P13B_PROVISION =
  "supabase/migrations/20261011130000_p13b_garde_provision_program_copy.sql";
const CHEMIN_P13B_RESERVATION =
  "supabase/migrations/20261013090000_p13b_cloisonner_surface_reservation.sql";
const CHEMIN_P13B_ADMIN_REEL =
  "supabase/migrations/20261013100000_p13b_admin_reel_est_staff_global.sql";
const CHEMIN_P13B_INSERT =
  "supabase/migrations/20261013110000_p13b_corriger_policies_insert.sql";
const CHEMIN_P13B_AUTOREF =
  "supabase/migrations/20261013120000_p13b_policies_non_auto_referentielles.sql";

const P13B_MODELE = sansCommentairesSql(lire(CHEMIN_P13B_MODELE));
const P13B_POLICIES = sansCommentairesSql(lire(CHEMIN_P13B_POLICIES));
const P13B_FONCTIONS = sansCommentairesSql(lire(CHEMIN_P13B_FONCTIONS));
const P13B_NUTRITION = sansCommentairesSql(lire(CHEMIN_P13B_NUTRITION));
const P13B_PROVISION = sansCommentairesSql(lire(CHEMIN_P13B_PROVISION));
/** Le texte BRUT de la 5e migration : ses gardes citent l'ancienne règle, commentaires compris. */
const P13B_PROVISION_BRUT = lire(CHEMIN_P13B_PROVISION);
const P13B_RESERVATION = sansCommentairesSql(lire(CHEMIN_P13B_RESERVATION));
const P13B_ADMIN_REEL = sansCommentairesSql(lire(CHEMIN_P13B_ADMIN_REEL));
const P13B_INSERT = sansCommentairesSql(lire(CHEMIN_P13B_INSERT));
const P13B_AUTOREF = sansCommentairesSql(lire(CHEMIN_P13B_AUTOREF));


const CATEGORIES = ["entrainement", "suivi_eleve", "agenda_communication", "nutrition"] as const;

/** Les 48 tables, avec la catégorie qui les gouverne. */
const CARTE_P13B: Record<string, string> = {
  activity_events: "suivi_eleve", body_measurements: "suivi_eleve",
  custom_measurements: "suivi_eleve", legal_consents: "suivi_eleve",
  progress_photos: "suivi_eleve", student_profiles: "suivi_eleve",
  weight_entries: "suivi_eleve", coach_notes: "suivi_eleve",
  students: "suivi_eleve", documents: "documents",
  document_assignments: "documents", document_levels: "global",
  assignments: "entrainement", exercise_feedback: "entrainement",
  exercise_set_feedback: "entrainement", training_change_history: "entrainement",
  workout_feedback: "entrainement", programs: "entrainement",
  program_weeks: "entrainement", program_exercise_progression: "entrainement",
  program_review_flags: "entrainement", workout_sessions: "entrainement",
  training_blocks: "entrainement", workout_exercises: "entrainement",
  training_prescriptions: "entrainement", exercise_library: "entrainement",
  session_templates: "entrainement", appointments: "agenda_communication",
  notification_campaign_targets: "agenda_communication",
  coach_availabilities: "agenda_communication",
  coach_unavailabilities: "agenda_communication",
  appointment_email_logs: "global", booking_settings: "global",
  newsletter_subscribers: "global", email_logs: "global",
  notification_campaigns: "global", notification_occurrences: "global",
  notification_deliveries: "global", push_subscriptions: "global",
  billing_customers: "admin_seul", billing_events: "admin_seul",
  payments: "admin_seul", payment_entries: "admin_seul",
  stripe_payments: "admin_seul", subscriptions: "admin_seul",
  subscription_templates: "admin_seul", coaches: "admin_seul",
  profiles: "admin_seul",
};

/** Les policies créées par la migration, découpées par commande. */
interface PolicieP13B { nom: string; table: string; cmd: string; corps: string }
const POLICIES_P13B: PolicieP13B[] = (() => {
  const out: PolicieP13B[] = [];
  const re = /create policy\s+(\S+)\s*\n?\s*on public\.(\w+)\s+for\s+(\w+)\s+to\s+\w+([\s\S]*?);(?=\s*(?:\n|$))/gi;
  for (const m of P13B_POLICIES.matchAll(re)) {
    out.push({ nom: m[1], table: m[2], cmd: m[3].toLowerCase(), corps: m[4] });
  }
  return out;
})();

test("P13B 1. les neuf migrations existent et sont ordonnées", () => {
  for (const [n, s] of [
    ["modèle", P13B_MODELE],
    ["policies", P13B_POLICIES],
    ["fonctions", P13B_FONCTIONS],
    ["nutrition", P13B_NUTRITION],
    ["provision", P13B_PROVISION],
    ["réservation", P13B_RESERVATION],
    ["admin réel", P13B_ADMIN_REEL],
    ["insert", P13B_INSERT],
    ["auto-référence", P13B_AUTOREF],
  ] as const) {
    assert.ok(s.trim().length > 0, `la migration ${n} est vide`);
  }
  // L'ordre des horodatages EST la dépendance : les policies appellent les
  // fonctions d'ensemble du modèle, les fonctions durcies aussi, et
  // l'intégration nutrition appelle `student_ids_nutrition_<niveau>()` et
  // `est_staff_global()`, posées par le modèle.
  assert.ok(CHEMIN_P13B_MODELE < CHEMIN_P13B_POLICIES, "le modèle doit précéder les policies");
  assert.ok(CHEMIN_P13B_POLICIES < CHEMIN_P13B_FONCTIONS, "les policies doivent précéder le durcissement");
  assert.ok(CHEMIN_P13B_FONCTIONS < CHEMIN_P13B_NUTRITION, "le durcissement doit précéder l'intégration nutrition");
  // La 5e appelle `student_ids_entrainement_ecriture()`, posée par le modèle.
  assert.ok(CHEMIN_P13B_NUTRITION < CHEMIN_P13B_PROVISION, "l'intégration nutrition doit précéder la garde de provision");
});

test("P13B 2. les 48 tables sont couvertes, sans oubli ni doublon", () => {
  const touchees = new Set(POLICIES_P13B.map((p) => p.table));
  const attendues = new Set(Object.keys(CARTE_P13B));
  const oubliees = [...attendues].filter((t) => !touchees.has(t));
  const inattendues = [...touchees].filter((t) => !attendues.has(t));
  assert.deepEqual(oubliees, [], `tables cartographiées sans policy : ${oubliees.join(", ")}`);
  assert.deepEqual(inattendues, [], `tables touchées hors cartographie : ${inattendues.join(", ")}`);
  assert.equal(attendues.size, 48, `la cartographie compte ${attendues.size} tables au lieu de 48`);
});

test("P13B 3. CORRESPONDANCE COMMANDE ↔ NIVEAU : une lecture seule n'écrit jamais", () => {
  // C'est l'invariant central du modèle. Une policy FOR ALL n'a qu'un USING,
  // qui gouverne SELECT, UPDATE et DELETE : y mettre l'ensemble de lecture
  // laissait un collaborateur en lecture seule SUPPRIMER des lignes.
  const fautes: string[] = [];
  for (const p of POLICIES_P13B) {
    const plat = p.corps.replace(/\s+/g, " ").toLowerCase();
    if (["insert", "update", "delete"].includes(p.cmd) && /_lecture\(\)/.test(plat)) {
      fautes.push(`${p.table}.${p.nom} [${p.cmd}] oppose un ensemble de LECTURE`);
    }
    if (p.cmd === "insert" && /\busing\s*\(/.test(plat)) {
      fautes.push(`${p.table}.${p.nom} [insert] porte un USING`);
    }
    if (p.cmd === "delete" && /with check\s*\(/.test(plat)) {
      fautes.push(`${p.table}.${p.nom} [delete] porte un WITH CHECK`);
    }
    if (p.cmd === "update" && !/\busing\s*\(/.test(plat)) {
      fautes.push(`${p.table}.${p.nom} [update] sans USING`);
    }
    if (p.cmd === "update" && !/with check\s*\(/.test(plat)) {
      fautes.push(`${p.table}.${p.nom} [update] sans WITH CHECK`);
    }
  }
  assert.deepEqual(fautes, [], fautes.join(" | "));
});

test("P13B 4. aucune policy ne retombe sur is_coach_or_admin()", () => {
  const executables = P13B_POLICIES.split("\n").filter(
    (l) => /is_coach_or_admin/.test(l) && !/like '%is_coach_or_admin%'/.test(l));
  assert.deepEqual(executables, [],
    `is_coach_or_admin() subsiste : ${executables.join(" | ")}`);
  // Et la migration doit refuser de s'appliquer s'il en reste une en base.
  assert.ok(/raise exception[\s\S]{0,120}policies encore trop larges/i.test(P13B_POLICIES),
    "la migration ne vérifie pas, à l'application, qu'aucune policy trop large ne subsiste");
});

test("P13B 5. `coach_id is null` n'autorise JAMAIS un collaborateur", () => {
  // Relevé en base : coach_id est NUL sur 100 % des lignes de 7 tables. Un
  // prédicat `coach_id in (…)` aurait valu faux et coupé l'administrateur de
  // 142 exercices et 25 programmes ; un `coach_id is null or …` aurait fait de
  // ces lignes une ressource partagée avec tous les collaborateurs.
  const tablesCoach = ["exercise_library", "session_templates", "coach_availabilities", "coach_unavailabilities"];
  for (const t of tablesCoach) {
    const pols = POLICIES_P13B.filter((p) => p.table === t);
    assert.ok(pols.length > 0, `${t} n'a aucune policy`);
    for (const p of pols) {
      const plat = p.corps.replace(/\s+/g, " ").toLowerCase();
      assert.ok(/est_staff_global\(\)/.test(plat),
        `${t}.${p.nom} ne réserve pas les lignes sans propriétaire au staff global`);
      assert.ok(/coach_id is not null/.test(plat),
        `${t}.${p.nom} n'exige pas un propriétaire EXPLICITE pour la branche collaborateur`);
      assert.ok(!/coach_id is null\s+or/.test(plat),
        `${t}.${p.nom} traite coach_id nul comme une autorisation`);
    }
  }
});

test("P13B 6. les tables ADMIN SEUL ne s'ouvrent par aucune catégorie", () => {
  const adminSeul = Object.entries(CARTE_P13B).filter(([, c]) => c === "admin_seul").map(([t]) => t);
  assert.equal(adminSeul.length, 9, `${adminSeul.length} tables admin_seul au lieu de 9`);
  for (const t of adminSeul) {
    for (const p of POLICIES_P13B.filter((x) => x.table === t)) {
      const plat = p.corps.replace(/\s+/g, " ").toLowerCase();
      for (const c of CATEGORIES) {
        assert.ok(!plat.includes(`'${c}'`),
          `${t}.${p.nom} cite la catégorie ${c} : la facturation deviendrait accordable`);
      }
      assert.ok(!/student_ids_|coach_ids_portee|categories_/.test(plat),
        `${t}.${p.nom} passe par un ensemble de portée au lieu de is_admin()`);
      assert.ok(/is_admin\(\)/.test(plat), `${t}.${p.nom} n'oppose pas is_admin()`);
    }
  }
});

test("P13B 7. les tables GLOBALES restent hors de portée d'un collaborateur", () => {
  const globales = Object.entries(CARTE_P13B).filter(([, c]) => c === "global").map(([t]) => t);
  assert.equal(globales.length, 9, `${globales.length} tables globales au lieu de 9`);
  for (const t of globales) {
    for (const p of POLICIES_P13B.filter((x) => x.table === t)) {
      const plat = p.corps.replace(/\s+/g, " ").toLowerCase();
      assert.ok(/est_staff_global\(\)/.test(plat),
        `${t}.${p.nom} n'est pas réservée à l'administration et aux assistants`);
      assert.ok(!/categories_(lecture|ecriture)\(\)/.test(plat),
        `${t}.${p.nom} s'ouvre par une catégorie alors qu'aucun élève ne s'y rattache`);
    }
  }
});

test("P13B 8. les DOCUMENTS sont routés par leur catégorie ET par l'affectation", () => {
  const i = P13B_MODELE.indexOf("document_ids_");
  assert.ok(i !== -1, "les ensembles de documents sont absents du modèle");
  const bloc = P13B_MODELE.slice(i, i + 1400);
  assert.ok(/join public\.document_assignments/.test(bloc),
    "un document est atteint sans passer par une affectation d'élève");
  for (const [cat, ensemble] of [
    ["nutrition", "student_ids_nutrition"],
    ["entrainement", "student_ids_entrainement"],
    ["administratif", "student_ids_suivi_eleve"],
  ] as const) {
    assert.ok(new RegExp(`'${cat}'[\\s\\S]{0,120}${ensemble}`).test(bloc),
      `la catégorie « ${cat} » n'est pas routée vers ${ensemble}`);
  }
  // `document_assignments` ne doit pas offrir de voie parallèle : elle
  // interroge le MÊME ensemble que `documents`.
  for (const p of POLICIES_P13B.filter((x) => x.table === "document_assignments")) {
    const plat = p.corps.replace(/\s+/g, " ").toLowerCase();
    if (/student_id = current_student_id/.test(plat) && p.cmd === "select") continue;
    assert.ok(/document_ids_(lecture|ecriture)\(\)/.test(plat),
      `document_assignments.${p.nom} contourne le routage par catégorie`);
  }
});

test("P13B 9. `students` : identité lisible dans la portée, écriture derrière suivi_eleve", () => {
  const sel = POLICIES_P13B.find((p) => p.table === "students" && p.cmd === "select");
  assert.ok(sel, "students n'a pas de policy SELECT");
  assert.ok(/student_ids_portee\(\)/.test(sel.corps),
    "la lecture de l'identité n'est pas ouverte à la simple portée");
  for (const p of POLICIES_P13B.filter((x) => x.table === "students" && x.cmd !== "select")) {
    assert.ok(/student_ids_suivi_eleve_ecriture\(\)/.test(p.corps),
      `students.${p.nom} [${p.cmd}] n'exige pas suivi_eleve en écriture`);
  }
});

test("P13B 10. les 10 fonctions SECURITY DEFINER sont durcies, chacune à sa règle", () => {
  const attendues: Record<string, RegExp> = {
    protect_students_ownership_columns: /staff_role\(\), ''\) in \('admin', 'assistant'\)/,
    protect_student_profiles_access_columns: /staff_role\(\), ''\) not in \('admin', 'assistant'\)/,
    protect_nutrition_days_coach_columns: /'nutrition' in \(select public\.categories_ecriture\(\)\)/,
    create_appointment_atomic: /student_ids_agenda_communication_ecriture\(\)/,
    cancel_appointment_atomic: /student_ids_agenda_communication_ecriture\(\)/,
    reschedule_appointment_atomic: /student_ids_agenda_communication_ecriture\(\)/,
    create_coach_event_atomic: /'agenda_communication' not in \(select public\.categories_ecriture\(\)\)/,
    update_coach_event_atomic: /v_coach_id = public\.current_staff_id\(\)/,
  };
  for (const [nom, motif] of Object.entries(attendues)) {
    const i = P13B_FONCTIONS.indexOf(`function public.${nom}(`);
    assert.ok(i !== -1, `${nom} n'est pas réécrite`);
    const corps = P13B_FONCTIONS.slice(i, P13B_FONCTIONS.indexOf("$f$;", i));
    assert.ok(motif.test(corps), `${nom} ne porte pas la règle attendue`);
    assert.ok(!/is_coach_or_admin/.test(corps), `${nom} oppose encore is_coach_or_admin()`);
    assert.ok(/set search_path = public, pg_temp/.test(corps),
      `${nom} ne nomme pas pg_temp en dernier`);
  }
  // Les deux enforce_* sont trop longues pour être recopiées : la substitution
  // est CIBLÉE sur une ligne unique, et gardée.
  for (const nom of ["enforce_exercise_feedback_write", "enforce_workout_feedback_write"]) {
    assert.ok(P13B_FONCTIONS.includes(`'${nom}'`), `${nom} n'est pas traitée`);
  }
  assert.ok(/v_n <> 1[\s\S]{0,200}raise exception/.test(P13B_FONCTIONS),
    "la substitution ciblée n'exige pas exactement une occurrence du motif");
  assert.ok(/raise exception[\s\S]{0,160}SECURITY DEFINER opposant encore/i.test(P13B_FONCTIONS),
    "la migration ne vérifie pas qu'aucune fonction DEFINER ne reste ouverte");

  // Une indisponibilité créée sans `coach_id` naîtrait SANS PROPRIÉTAIRE et
  // retomberait dans le lot historique que personne ne peut gérer. C'est le
  // défaut d'origine de cette fonction : il doit rester fermé.
  const iCree = P13B_FONCTIONS.indexOf("function public.create_coach_event_atomic(");
  const corpsCree = P13B_FONCTIONS.slice(iCree, P13B_FONCTIONS.indexOf("$f$;", iCree));
  assert.ok(/insert into public\.coach_unavailabilities\s*\n?\s*\(coach_id,/.test(corpsCree),
    "create_coach_event_atomic n'écrit pas coach_id : la ligne naîtrait sans propriétaire");
  assert.ok(/values\s*\n?\s*\(v_staff,/.test(corpsCree),
    "create_coach_event_atomic ne pose pas current_staff_id() comme propriétaire");
});

test("P13B 11. un collaborateur ne peut pas s'approprier un élève", () => {
  const i = P13B_FONCTIONS.indexOf("function public.protect_students_ownership_columns(");
  const corps = P13B_FONCTIONS.slice(i, P13B_FONCTIONS.indexOf("$f$;", i));
  // Les quatre colonnes de rattachement doivent être RESTAURÉES pour qui n'est
  // ni administrateur ni assistant — un collaborateur comme un élève.
  for (const col of ["coach_id", "access_type", "status", "user_id"]) {
    assert.ok(new RegExp(`new\\.${col} := old\\.${col};`).test(corps),
      `protect_students_ownership_columns ne restaure pas ${col}`);
  }
  assert.ok(!/'collaborateur'/.test(corps),
    "la fonction prévoit une branche collaborateur : le rattachement doit lui être fermé, sans exception");
});

test("P13B 12. `profiles.role` n'est pas touchée, `coaches.role` accueille le rôle", () => {
  // Sept gardes applicatives testent `role === 'admin' || role === 'coach'`.
  // Ajouter une quatrième valeur à profiles.role ferait rejeter le
  // collaborateur par chacune : il se connecterait et serait renvoyé sur
  // /acces-refuse.
  assert.ok(!/alter table public\.profiles[\s\S]{0,200}role/.test(P13B_MODELE),
    "la migration touche profiles.role");
  assert.ok(/coaches_role_check[\s\S]{0,160}'collaborateur'/.test(P13B_MODELE),
    "coaches.role n'accueille pas le rôle collaborateur");
  assert.ok(/'admin','assistant','collaborateur'/.test(P13B_MODELE.replace(/\s/g, "")),
    "la contrainte coaches.role ne conserve pas admin et assistant");
});

test("P13B 13. le niveau n'existe qu'en deux valeurs, l'absence valant refus", () => {
  assert.ok(/niveau text not null check \(niveau = any \(array\['lecture','ecriture'\]\)\)/
    .test(P13B_MODELE.replace(/\s+/g, " ")),
    "le niveau admet autre chose que lecture et ecriture");
  assert.ok(!/'aucun'/.test(P13B_MODELE),
    "un niveau « aucun » existe : deux façons de dire la même chose, donc un état divergent possible");
  assert.ok(/collaborateur_permissions_unique unique \(collaborateur_id, categorie\)/
    .test(P13B_MODELE.replace(/\s+/g, " ")),
    "deux lignes de niveaux différents peuvent coexister pour une même catégorie");
  assert.ok(/collaborateur_eleves_unique unique \(collaborateur_id, student_id\)/
    .test(P13B_MODELE.replace(/\s+/g, " ")),
    "une affectation peut être posée deux fois");

  // La liste des catégories accordables doit être EXACTEMENT les quatre.
  // En ajouter une — « facturation » par exemple — rendrait accordable ce que
  // la cartographie réserve à l'administration, et aucune policy ne le verrait.
  const mCat = P13B_MODELE.replace(/\s+/g, " ").match(/categorie text not null\s*check \(categorie = any \(array\[([^\]]*)\]\)\)/);
  assert.ok(mCat, "la contrainte sur `categorie` est introuvable");
  const listees = mCat[1].split(",").map((x) => x.trim().replace(/'/g, ""));
  assert.deepEqual(listees.slice().sort(), [...CATEGORIES].sort(),
    `catégories accordables : ${listees.join(", ")} — il doit y en avoir exactement quatre`);
});

test("P13B 14. une catégorie n'ouvre jamais les autres", () => {
  // Chaque policy ne doit citer QUE la catégorie de sa table. Une policy
  // d'entraînement qui interrogerait l'ensemble nutrition ferait d'une
  // permission la clé d'une autre.
  const fautes: string[] = [];
  for (const p of POLICIES_P13B) {
    const cat = CARTE_P13B[p.table];
    if (!CATEGORIES.includes(cat as typeof CATEGORIES[number])) continue;
    for (const autre of CATEGORIES) {
      if (autre === cat) continue;
      if (new RegExp(`student_ids_${autre}_|'${autre}'`).test(p.corps)) {
        fautes.push(`${p.table}.${p.nom} (${cat}) cite ${autre}`);
      }
    }
  }
  assert.deepEqual(fautes, [], fautes.join(" | "));
});

test("P13B 15. CONTRÔLE DU CONTRÔLE — les tests tombent si la règle régresse", () => {
  // (a) Si une policy d'écriture reprenait l'ensemble de lecture, P13B 3 doit
  // le voir. On le vérifie sur un texte fabriqué, pas sur la migration.
  const faux = `create policy x_delete\n  on public.activity_events for delete to public\n  using (student_id in (select public.student_ids_suivi_eleve_lecture()));`;
  const m = /create policy\s+(\S+)\s*\n?\s*on public\.(\w+)\s+for\s+(\w+)\s+to\s+\w+([\s\S]*?);/i.exec(faux);
  assert.ok(m, "le découpage de contrôle ne reconnaît pas une policy");
  assert.ok(/_lecture\(\)/.test(m[4]) && m[3].toLowerCase() === "delete",
    "la détection « DELETE sur un ensemble de lecture » ne fonctionne pas");

  // (b) Le découpage doit voir toutes les policies : un compte nul rendrait
  // P13B 2, 3, 5, 6, 7 et 14 silencieusement verts.
  assert.ok(POLICIES_P13B.length >= 180,
    `le découpage n'a vu que ${POLICIES_P13B.length} policies, 180 attendues`);
  assert.ok(new Set(POLICIES_P13B.map((p) => p.cmd)).size === 4,
    "le découpage ne distingue pas les quatre commandes");
});

// ════════════════════════════════════════════════════════════════════════════
// P13B-APP — L'INTÉGRATION APPLICATIVE DU MODÈLE
//
// La RLS ne protège que ce qui passe par PostgreSQL. Ces contrôles portent
// sur la couche API et l'interface : ils échouent si l'application cesse de
// dire la même chose que la base — par exemple si une garde laisse repasser
// un collaborateur, ou si l'interface invente un niveau que la contrainte
// CHECK n'accepte pas.
// ════════════════════════════════════════════════════════════════════════════

const AUTHZ_APP = lire("lib/api/authz.ts");
const ACCES_APP = lire("lib/supabase/collaborateurs.ts");
const MODALE_APP = lire("components/admin/CollaborateurAccesModal.tsx");
const PAGE_PARAMETRES = lire("app/admin/parametres/page.tsx");

/** Retire commentaires de bloc et de ligne d'un source TypeScript. */
function sansCommentairesTs(source: string): string {
  return source.replace(/\/\*[\s\S]*?\*\//g, " ").replace(/^\s*\/\/.*$/gm, "");
}

test("P13B-APP 1. la garde API lit les deux tables du modèle, et rien d'autre", () => {
  const code = sansCommentairesTs(AUTHZ_APP);
  assert.ok(/from\("collaborateur_eleves"\)/.test(code), "l'affectation explicite n'est pas vérifiée côté API");
  assert.ok(/from\("collaborateur_permissions"\)/.test(code), "la permission de catégorie n'est pas vérifiée côté API");
  // Aucune autre table de droits inventée côté application.
  const tables = [...new Set([...code.matchAll(/from\("([a-z_]+)"\)/g)].map((m) => m[1]))].sort();
  assert.deepEqual(tables, ["coaches", "collaborateur_eleves", "collaborateur_permissions", "profiles", "students"],
    `tables lues par la garde : ${tables.join(", ")}`);
});

test("P13B-APP 2. la garde API reproduit la fiche de portée du SQL", () => {
  // `current_staff_id()` / `staff_role()` prennent la première fiche ACTIVE,
  // triée par created_at puis id. L'API doit désigner la même, sinon les deux
  // couches peuvent attribuer deux périmètres différents au même compte.
  const code = sansCommentairesTs(AUTHZ_APP);
  const bloc = code.slice(code.indexOf("async function fichesStaff"));
  const corps = bloc.slice(0, bloc.indexOf("\n}\n"));
  assert.ok(/status === "actif"/.test(corps), "la fiche de portée doit être l'active, comme en SQL");
  assert.ok(/order\("created_at", \{ ascending: true \}\)/.test(corps), "le tri created_at doit être le même qu'en SQL");
  assert.ok(/order\("id", \{ ascending: true \}\)/.test(corps), "le tri de départage par id doit être le même qu'en SQL");
  const modele = P13B_MODELE.replace(/\s+/g, " ");
  assert.ok(/where c\.user_id = auth\.uid\(\) and c\.status = 'actif' order by c\.created_at, c\.id limit 1/.test(modele),
    "la fonction SQL de référence a changé de critère : l'API ne la reflète plus");
});

test("P13B-APP 3. aucune catégorie accordable n'est administrative", () => {
  // Les quatre catégories de l'application doivent être EXACTEMENT celles de
  // la contrainte CHECK. Une cinquième (« facturation », « comptes ») rendrait
  // accordable ce qui ne doit jamais l'être.
  const types = lire("types/index.ts");
  const m = types.match(/export type CategorieDroit =\s*([^;]+);/);
  assert.ok(m, "CategorieDroit est introuvable");
  const declarees = [...m[1].matchAll(/"([a-z_]+)"/g)].map((x) => x[1]).sort();
  assert.deepEqual(declarees, [...CATEGORIES].sort(), `catégories applicatives : ${declarees.join(", ")}`);
  for (const interdite of ["facturation", "paiement", "abonnement", "coaches", "profiles", "admin"]) {
    assert.ok(!declarees.some((d) => d === interdite), `catégorie administrative accordable : ${interdite}`);
  }
});

test("P13B-APP 4. deux niveaux seulement, et « aucun accès » reste une absence", () => {
  const types = lire("types/index.ts");
  assert.ok(/export type NiveauDroit = "lecture" \| "ecriture";/.test(types),
    "les niveaux applicatifs ne correspondent plus à la contrainte CHECK");
  // L'interface propose trois choix, mais le troisième ne s'écrit pas : il
  // supprime la ligne.
  assert.ok(/if \(niveau === null\)[\s\S]{0,240}\.delete\(\)/.test(ACCES_APP),
    "retirer une catégorie doit supprimer la ligne, pas écrire un troisième niveau");
  assert.ok(!/"aucun"|'aucun'/.test(sansCommentairesTs(ACCES_APP) + sansCommentairesTs(MODALE_APP)),
    "un niveau « aucun » apparaît côté application : la base ne l'accepte pas");
});

test("P13B-APP 5. l'interface n'écrit jamais students.coach_id", () => {
  // La règle « un collaborateur ne s'approprie jamais un élève » est portée en
  // base par le trigger `protect_students_ownership` (réécrit par la migration
  // de durcissement P13-B). Côté application, aucune écriture ne doit même
  // tenter de toucher cette colonne.
  const durcissement = P13B_FONCTIONS.replace(/\s+/g, " ");
  assert.ok(/new\.coach_id := old\.coach_id;/.test(durcissement),
    "le trigger ne restaure plus coach_id : un collaborateur pourrait s'approprier un élève");
  assert.ok(/in \('admin', 'assistant'\)/.test(durcissement),
    "le trigger doit traiter le collaborateur comme NON propriétaire");
  // Sans commentaires : les deux fichiers EXPLIQUENT que `students.coach_id`
  // n'est jamais touché. Échouer parce qu'on l'a documenté serait un mauvais
  // contrôle — c'est le code qui est vérifié, pas la prose.
  for (const [nom, source] of [["collaborateurs.ts", ACCES_APP], ["CollaborateurAccesModal.tsx", MODALE_APP]] as const) {
    assert.ok(!/coach_id/.test(sansCommentairesTs(source)), `${nom} manipule coach_id : l'affectation doit rester explicite`);
  }
});

test("P13B-APP 6. l'écriture des droits passe par la RLS, jamais par le service role", () => {
  assert.ok(!/createSupabaseAdminClient|SERVICE_ROLE/.test(ACCES_APP),
    "la couche d'accès aux droits contournerait les policies ..._manage_admin");
  // Les policies qui rendent le verdict existent bien, et sont réservées à
  // l'administrateur.
  const modele = P13B_MODELE.replace(/\s+/g, " ");
  for (const table of ["collaborateur_eleves", "collaborateur_permissions"]) {
    assert.ok(new RegExp(`create policy "${table}_manage_admin" on public\\.${table} for all to authenticated using \\(\\(select public\\.is_admin\\(\\)\\)\\) with check \\(\\(select public\\.is_admin\\(\\)\\)\\)`)
      .test(modele), `${table} : la policy d'administration a changé de forme`);
  }
});

test("P13B-APP 7. l'interface affiche les droits enregistrés, sans valeur par défaut", () => {
  // Un dictionnaire pré-rempli ferait croire à un accès non accordé.
  assert.ok(/const permissions: PermissionsCollaborateur = \{\};/.test(ACCES_APP),
    "getPermissions doit partir d'un dictionnaire vide");
  assert.ok(/permissions\[ligne\.categorie\] = ligne\.niveau;/.test(ACCES_APP),
    "l'affichage doit refléter la ligne telle qu'elle est enregistrée");
  assert.ok(/permissions\[categorie\] \?\? ""/.test(MODALE_APP),
    "une catégorie absente doit s'afficher comme « aucun accès », pas comme un niveau");
  // En cas de refus, l'état est rechargé : l'écran ne montre pas un droit qui
  // n'a pas été enregistré.
  const hook = lire("hooks/useCollaborateurAcces.ts");
  assert.ok(/if \(!resultat\.ok\) \{[\s\S]{0,200}await recharger\(\);/.test(hook),
    "après un refus, l'interface doit recharger l'état réel");
});

test("P13B-APP 8. la configuration des droits est réservée aux collaborateurs", () => {
  // Un admin a les droits globaux, un coach autonome gère ses propres élèves :
  // ni l'un ni l'autre ne passe par `collaborateur_permissions`.
  // La garde est cherchée JUSTE AVANT le bouton, et non n'importe où dans le
  // fichier : la même condition sert aussi à la ligne de résumé, et une
  // recherche globale resterait verte si seul le bouton perdait sa garde.
  const iBouton = PAGE_PARAMETRES.indexOf("setDroitsCoachId(coach.id)");
  assert.ok(iBouton > 0, "le bouton d'ouverture de la modale des droits est introuvable");
  const avantBouton = PAGE_PARAMETRES.slice(Math.max(0, iBouton - 500), iBouton);
  assert.ok(/coach\.role === "collaborateur" && \(/.test(avantBouton),
    "le bouton de configuration des droits doit être conditionné au rôle collaborateur");
  assert.ok(/CATEGORIES_DROITS\.map/.test(MODALE_APP),
    "les quatre catégories doivent être réglées une par une, depuis la liste partagée");
  // Affectation ET révocation explicites.
  assert.ok(/affecterEleve/.test(lire("hooks/useCollaborateurAcces.ts")), "l'affectation explicite est absente");
  assert.ok(/revoquerEleve/.test(lire("hooks/useCollaborateurAcces.ts")), "la révocation explicite est absente");
});

test("P13B-APP 9. l'identité staff de l'appelant passe par les fonctions du modèle", () => {
  // Un collaborateur ne peut PAS lire sa propre ligne `coaches` : la policy la
  // réserve à l'administrateur, et le contrôle B6 de la checklist vérifie
  // qu'il y compte zéro ligne. La seule voie ouverte est
  // `current_staff_id()` / `staff_role()`, SECURITY DEFINER, qui ne renvoient
  // que l'identité de l'appelant.
  const contexte = sansCommentairesTs(lire("hooks/useStaffContext.ts"));
  assert.ok(/rpc\("staff_role"\)/.test(contexte), "le rôle staff doit venir de la fonction du modèle");
  assert.ok(/rpc\("current_staff_id"\)/.test(contexte), "l'id de fiche doit venir de la fonction du modèle");
  assert.ok(!/from\("coaches"\)/.test(contexte), "aucun select sur coaches : il serait vide pour un collaborateur");

  // Et la résolution du coach propriétaire essaie la fonction AVANT le select,
  // sinon un collaborateur retombe sur un `coaches` vide et ne peut rien créer.
  const courant = sansCommentairesTs(lire("hooks/useCurrentCoachId.ts"));
  const iFonction = courant.indexOf('rpc("current_staff_id")');
  const iSelect = courant.indexOf('from("coaches")');
  assert.ok(iFonction > 0, "current_staff_id() n'est pas utilisée");
  assert.ok(iSelect > iFonction, "le select sur coaches doit rester un REPLI, après la fonction");

  // Les deux fonctions sont bien exécutables par `authenticated`, et retirées
  // à `anon` : un appelant non authentifié ne doit rien pouvoir en tirer.
  const modele = P13B_MODELE.replace(/\s+/g, " ");
  assert.ok(/'current_staff_id','staff_role'/.test(modele), "les deux fonctions doivent figurer dans la liste des droits");
  assert.ok(/revoke all on function public\.%I\(\) from anon/.test(modele), "anon doit perdre execute");
  assert.ok(/grant execute on function public\.%I\(\) to authenticated/.test(modele), "authenticated doit garder execute");
});

test("P13B-APP 10. la gestion des coachs reste à l'administrateur, et le doute ne masque rien", () => {
  // « Le coach ne gère jamais globalement les coachs » (règle H-3, reprise
  // par P13-B) : la section est masquée dès que le rôle est CONNU et n'est pas
  // admin. Un rôle inconnu (migrations non appliquées) conserve l'affichage
  // d'avant — masquer sur un doute cacherait la section au compte principal.
  assert.ok(/roleStaff === null \|\| roleStaff === "admin"/.test(PAGE_PARAMETRES),
    "la décision d'affichage doit distinguer « inconnu » de « pas admin »");
  assert.ok(/\{peutGererLesCoachs && \(/.test(PAGE_PARAMETRES),
    "la section des coachs doit être conditionnée");
  // Et cet affichage ne remplace rien : les deux routes restent admin-only.
  for (const relatif of ["app/api/admin/coaches/route.ts", "app/api/admin/coaches/[coachId]/route.ts"]) {
    assert.ok(/requireAdmin\(\)/.test(lire(relatif)),
      `${relatif} : la sécurité réelle doit rester côté serveur`);
  }
});

test("P13B-APP 11. la navigation est cloisonnée par une fonction PURE, pas par le composant", () => {
  // La sidebar ne doit décider de rien elle-même : la règle vit dans
  // lib/admin-shell-nav.ts, testée sans DOM dans admin-shell-nav.mts.
  const sidebar = sansCommentairesTs(lire("components/admin/AdminSidebar.tsx"));
  assert.ok(/sectionAdminVisible\(href, droits\)/.test(sidebar),
    "la sidebar doit déléguer la décision à sectionAdminVisible");
  assert.ok(/groupeAdminVisible\(/.test(sidebar),
    "le groupe Programmation doit disparaître quand aucun enfant ne reste");
  assert.ok(!/categoriesLecture\.includes|roleStaff === "collaborateur"/.test(sidebar),
    "aucune règle d'accès ne doit être réimplémentée dans le composant");

  // Et elle lit les droits par les fonctions du modèle, jamais par un select.
  assert.ok(/useStaffContext\(\)/.test(sidebar), "les droits doivent venir du hook dédié");
  assert.ok(!/from\("coaches"\)|from\("collaborateur_/.test(sidebar),
    "la sidebar ne doit lire aucune table de droits directement");
});

test("P13B-APP 12. la catégorie de chaque section suit les tables que la migration range", () => {
  const nav = lire("lib/admin-shell-nav.ts");
  const bloc = nav.slice(nav.indexOf("CATEGORIES_PAR_SECTION_ADMIN"));
  const table = bloc.slice(0, bloc.indexOf("};"));
  const lire_section = (href: string): string[] => {
    const m = new RegExp(`"${href.replace(/\//g, "\\/")}": \\[([^\\]]*)\\]`).exec(table);
    assert.ok(m, `section non classée : ${href}`);
    return [...m[1].matchAll(/"([a-z_]+)"/g)].map((x) => x[1]);
  };

  // Les sections globales : liste VIDE, et c'est vérifié contre la migration —
  // `est_staff_global()` et `is_admin()` ne sont vrais pour aucun
  // collaborateur, donc aucune catégorie ne peut les ouvrir.
  const policies = P13B_POLICIES.replace(/\s+/g, " ");
  const modele = P13B_MODELE.replace(/\s+/g, " ");
  const globales: [string, string, string][] = [
    ["/admin/emails", "email_logs", policies],
    ["/admin/notifications", "notification_campaigns", policies],
    ["/admin/newsletter", "newsletter_subscribers", policies],
    ["/admin/paiements", "payments", policies],
    ["/admin/abonnements", "subscription_templates", policies],
    ["/admin/parametres", "coaches", policies],
  ];
  for (const [href, table_sql, source] of globales) {
    assert.deepEqual(lire_section(href), [], `${href} ne doit s'ouvrir par aucune catégorie`);
    // La propriété réelle : la policy de LECTURE de cette table n'oppose que
    // `est_staff_global()` / `is_admin()` (plus, parfois, l'élève sur sa
    // propre ligne), et JAMAIS un ensemble de catégorie. Si elle citait un
    // `student_ids_<cat>_*` ou un `categories_*`, un collaborateur pourrait y
    // accéder et la section devrait être reclassée, pas masquée.
    const m = new RegExp(`on public\\.${table_sql} for select to \\w+ using \\(([\\s\\S]*?)\\);`).exec(source);
    assert.ok(m, `${href} : policy de lecture de ${table_sql} introuvable`);
    const condition = m[1];
    assert.ok(
      /est_staff_global\(\)|is_admin\(\)/.test(condition),
      `${href} : ${table_sql} n'est plus réservée au staff global / à l'admin — la cartographie a changé`,
    );
    assert.ok(
      !/student_ids_|coach_ids_portee|categories_(lecture|ecriture)|document_ids_|program_ids_/.test(condition),
      `${href} : ${table_sql} est devenue accessible par une catégorie — la section doit être reclassée, pas masquée`,
    );
  }

  // Les sections catégorisées, vérifiées contre l'ensemble que la policy oppose.
  const attendus: [string, string, string][] = [
    ["/admin/eleves", "suivi_eleve", "student_ids_portee"],
    ["/admin/programmes", "entrainement", "program_ids_lecture"],
    ["/admin/calendrier", "agenda_communication", "student_ids_agenda_communication_lecture"],
    // `/admin/nutrition` a longtemps été la section la plus trompeuse : la
    // catégorie était bien accordée, et la page restait vide. Les huit tables
    // du cœur opposaient encore `nutrition_plan_ids_geres()` (P13-A), fondée
    // sur `students.coach_id`. La 4e migration (20261011120000) les fait
    // opposer `nutrition_plan_ids_<niveau>()`, qui part de
    // `student_ids_nutrition_<niveau>()` : la section montre enfin ce que la
    // permission promet. Mesuré sur PostgreSQL 16 local — 0 plan avant, 1
    // après, pour le même collaborateur affecté.
    ["/admin/nutrition", "nutrition", "student_ids_nutrition_lecture"],
    ["/admin/retours", "entrainement", "student_ids_entrainement_lecture"],
  ];
  for (const [href, categorie, ensemble] of attendus) {
    assert.deepEqual(lire_section(href), [categorie], `${href} doit relever de ${categorie}`);
    // L'ensemble est cherché dans les DEUX migrations : les policies pour la
    // plupart des tables, le modèle pour les fonctions générées par boucle
    // (`student_ids_<cat>_<niveau>`), que les policies citent parfois
    // indirectement via `document_ids_*` ou `program_ids_*`.
    assert.ok(
      policies.includes(ensemble) || modele.includes(ensemble) || modele.includes(ensemble.replace(/_(lecture|ecriture)$/, "_%1$s")),
      `l'ensemble ${ensemble} a disparu des migrations P13-B`,
    );
  }

  // `/admin/retours` : la table réellement lue est `workout_feedback`, rangée
  // sous entrainement. Si la migration la déplaçait, ce contrôle rougirait.
  assert.ok(
    /on public\.workout_feedback for select to public using \(\(\(student_id = current_student_id\(\)\) OR student_id in \(select public\.student_ids_entrainement_lecture\(\)\)\)\)/.test(policies),
    "workout_feedback ne relève plus de entrainement : /admin/retours doit être reclassée",
  );

  // `/admin/documents` porte TROIS catégories, parce que la migration route
  // les documents sur `documents.category`.
  assert.deepEqual(lire_section("/admin/documents").slice().sort(),
    ["entrainement", "nutrition", "suivi_eleve"], "/admin/documents doit porter les trois catégories routables");
  assert.ok(/administratif/.test(modele) || /administratif/.test(policies),
    "le routage des documents par catégorie a disparu");
});

test("P13B-APP 13. l'espace admin ne lit plus `coaches` dans le navigateur pour un champ mort", () => {
  // /admin/calendrier appelait getPrimaryCoachInfo depuis le navigateur pour
  // remplir coachName/coachEmail — jamais affichés, jamais transmis (seul
  // `appointmentId` quitte le navigateur) et désormais vides pour un
  // non-admin. La correction est de ne rien lire.
  const calendrier = sansCommentairesTs(lire("app/admin/calendrier/page.tsx"));
  assert.ok(!/getPrimaryCoachInfo/.test(calendrier),
    "le calendrier admin ne doit plus résoudre le coach principal côté navigateur");
  assert.ok(!/from\("coaches"\)/.test(calendrier), "aucune lecture directe de coaches");
  assert.ok(!/"Ton coach"/.test(calendrier),
    "le repli trompeur « Ton coach » ne doit plus exister côté admin");

  // Le serveur reste la seule autorité : la route relit le coach au service role.
  const route = lire("app/api/email/appointment-notification/route.ts");
  assert.ok(/getPrimaryCoachInfo\(adminSupabase\)/.test(route),
    "la route d'envoi doit continuer de résoudre le coach avec le client service role");
  // Et seul l'identifiant du rendez-vous quitte le navigateur.
  const emails = lire("lib/email/appointment-emails.ts");
  assert.ok(/body: JSON\.stringify\(\{ appointmentId \}\)/.test(emails),
    "le navigateur ne doit envoyer que appointmentId");
});

test("P13B-APP 14. provisionner sa ligne `coaches` reste réservé à l'administrateur", () => {
  const coaches = sansCommentairesTs(lire("lib/supabase/coaches.ts"));
  const corps = coaches.slice(coaches.indexOf("export async function ensureSelfCoachRow"));
  const posProfil = corps.indexOf('from("profiles")');
  const posCoaches = corps.indexOf('from("coaches")');
  assert.ok(posProfil > 0 && posCoaches > posProfil,
    "le rôle doit être lu AVANT toute requête sur coaches (sinon select vide + insert refusé)");
  assert.ok(/profile\?\.role !== "admin"/.test(corps),
    "la garde doit valoir exactement is_admin(), c'est-à-dire profiles.role = 'admin'");
  assert.ok(!/createSupabaseAdminClient|service_role/.test(coaches),
    "aucun contournement par service role");
  // La policy qui justifie cette garde doit toujours être celle-là.
  assert.ok(/create policy coaches_manage_admin_insert on public\.coaches for insert to public with check \(\(select public\.is_admin\(\)\)\)/
    .test(P13B_POLICIES.replace(/\s+/g, " ")),
    "l'écriture de coaches n'est plus réservée à l'admin : la garde applicative doit être revue");
});

// ════════════════════════════════════════════════════════════════════════════
// P13B/4 — LE CŒUR NUTRITION ENTRE DANS LE MODÈLE
//
// La checklist SQL (supabase/tests/p13b_roles_collaborateurs_checklist.sql,
// section G) prouve le COMPORTEMENT sur une vraie base. Ces contrôles-ci
// gardent le CONTRAT du texte : ils rougissent si la migration cesse de dire
// ce qu'elle dit, sans qu'aucune base soit nécessaire.
// ════════════════════════════════════════════════════════════════════════════

/** Les huit tables du cœur, et la colonne par laquelle chacune est bornée. */
const COEUR_NUTRITION: Record<string, string> = {
  nutrition_plans: "id",
  nutrition_plan_profiles: "plan_id",
  nutrition_meal_slot_targets: "profile_id",
  nutrition_days: "plan_id",
  meals: "nutrition_day_id",
  meal_choice_slots: "meal_id",
  meal_choice_options: "slot_id",
  nutrition_daily_logs: "student_id",
};

/** Les cinq tables dépendantes : lecture seule pour le staff, toujours. */
const DEPENDANTES_LECTURE_SEULE = [
  "consumed_meals",
  "meal_entries",
  "planned_meals",
  "planned_meal_items",
  "planned_meal_skipped_slots",
];

/** Découpage des policies de la 4e migration, par table et par commande. */
const POLICIES_NUTRITION = [
  ...P13B_NUTRITION.matchAll(
    /create policy\s+"?([\w]+)"?\s*\n?\s*on public\.(\w+)\s+for\s+(\w+)\s+to\s+\w+([\s\S]*?);/gi,
  ),
].map((m) => ({ nom: m[1], table: m[2], cmd: m[3].toUpperCase(), corps: m[4] }));

test("P13B/4 1. dix fonctions de portée, générées par niveau depuis une source unique", () => {
  const compact = P13B_NUTRITION.replace(/\s+/g, " ");
  // Boucle sur les deux niveaux : `lecture` et `ecriture` ne peuvent pas
  // diverger autrement que par le niveau lui-même.
  assert.ok(/foreach n in array array\['lecture','ecriture'\] loop/.test(compact),
    "les deux niveaux doivent être générés par une seule boucle");
  for (const base of [
    "nutrition_plan_ids",
    "nutrition_plan_profile_ids",
    "nutrition_day_ids",
    "meal_ids",
    "meal_choice_slot_ids",
  ]) {
    assert.ok(new RegExp(`create or replace function public\\.${base}_%1\\$s\\(\\)`).test(compact),
      `${base}_<niveau>() n'est pas générée`);
  }
  // Et les dix noms figurent nommément dans la pose des droits.
  for (const n of ["lecture", "ecriture"]) {
    for (const base of ["nutrition_plan_ids", "nutrition_plan_profile_ids", "nutrition_day_ids", "meal_ids", "meal_choice_slot_ids"]) {
      assert.ok(compact.includes(`'${base}_${n}'`), `${base}_${n} n'est pas dans la liste des droits`);
    }
  }
});

test("P13B/4 2. les fonctions de PROPRIÉTÉ de P13-A ne sont ni modifiées ni supprimées", () => {
  // C'est le cœur de la décision : étendre `nutrition_plan_ids_geres()` aurait
  // accordé l'écriture en même temps que la lecture, puisqu'un seul ensemble
  // était opposé aux deux. Les anciennes restent la définition de la
  // propriété (food_lists, nutrition_recipes, can_manage_* s'en servent).
  for (const f of [
    "nutrition_plan_ids_geres",
    "nutrition_day_ids_geres",
    "meal_ids_geres",
    "meal_choice_slot_ids_geres",
    "nutrition_plan_profile_ids_geres",
    "student_ids_geres",
    "is_coach_of_student",
    "can_manage_nutrition_plan",
    "can_manage_nutrition_day",
    "can_manage_meal",
  ]) {
    assert.ok(
      !new RegExp(`create or replace function public\\.${f}\\s*\\(`).test(P13B_NUTRITION),
      `${f} est redéfinie par la 4e migration : la propriété P13-A ne doit pas être élargie`,
    );
    assert.ok(!new RegExp(`drop function[^;]*${f}`).test(P13B_NUTRITION), `${f} est supprimée`);
  }
  // Aucune migration P13-A n'est réécrite : la 4e ne touche à aucun fichier,
  // elle ne fait que poser de nouveaux objets. Vérifié par l'absence de
  // `drop policy` visant une policy d'une AUTRE table que le cœur nutrition.
  const tablesTouchees = new Set(
    [...P13B_NUTRITION.matchAll(/drop policy if exists[^;]*on public\.(\w+)/gi)].map((m) => m[1]),
  );
  const autorisees = new Set([...Object.keys(COEUR_NUTRITION), ...DEPENDANTES_LECTURE_SEULE]);
  const hors = [...tablesTouchees].filter((t) => !autorisees.has(t));
  assert.deepEqual(hors, [], `la 4e migration touche des tables hors du cœur nutrition : ${hors.join(", ")}`);
});

test("P13B/4 3. chaque table du cœur : SELECT sur lecture, écritures sur ecriture", () => {
  for (const [table, colonne] of Object.entries(COEUR_NUTRITION)) {
    const dePolicies = POLICIES_NUTRITION.filter((p) => p.table === table);
    assert.ok(dePolicies.length >= 4, `${table} : ${dePolicies.length} policies au lieu de 4`);
    assert.deepEqual(
      [...new Set(dePolicies.map((p) => p.cmd))].sort(),
      ["DELETE", "INSERT", "SELECT", "UPDATE"],
      `${table} : les quatre commandes doivent être séparées`,
    );
    for (const p of dePolicies) {
      // ⚠️ UNE SEULE EXEMPTION, ET ELLE EST PLUS STRICTE, PAS PLUS LARGE :
      // `nutrition_plans` DELETE n'oppose PAS l'ensemble d'écriture, parce que
      // supprimer le plan d'un élève n'était permis à AUCUN coach avant P13-B
      // — seul l'administrateur le fait. Lui donner `_ecriture()` aurait
      // élargi un droit au passage. Le contrôle P13B/4 5 vérifie la règle
      // réellement appliquée à cette policy.
      if (table === "nutrition_plans" && p.cmd === "DELETE") {
        assert.ok(!p.corps.includes("_ecriture()") && !p.corps.includes("_lecture()"),
          "la suppression d'un plan ne doit suivre aucun ensemble de portée");
        continue;
      }
      const attendu = p.cmd === "SELECT" ? "_lecture()" : "_ecriture()";
      const interdit = p.cmd === "SELECT" ? "_ecriture()" : "_lecture()";
      assert.ok(p.corps.includes(attendu), `${table}.${p.nom} (${p.cmd}) doit opposer un ensemble ${attendu}`);
      assert.ok(!p.corps.includes(interdit), `${table}.${p.nom} (${p.cmd}) oppose ${interdit} : niveaux croisés`);
      // La colonne de rattachement ne change pas : une policy qui changerait
      // de colonne changerait d'ensemble sans le dire.
      if (p.cmd !== "INSERT") {
        assert.ok(p.corps.includes(colonne), `${table}.${p.nom} doit se borner par ${colonne}`);
      }
    }
    // Et aucune policy FOR ALL ne subsiste côté coach : c'est elle qui
    // faisait d'une permission `lecture` un droit d'écriture.
    assert.ok(
      !new RegExp(`on public\\.${table} for all`, "i").test(P13B_NUTRITION),
      `${table} : une policy FOR ALL est recréée`,
    );
  }
});

test("P13B/4 4. le plan MODÈLE n'est ouvert par aucune catégorie", () => {
  // Un plan sans élève n'est atteint par aucune affectation. Sa branche doit
  // exiger `est_staff_global()` — admin de cabinet ou coach autonome — en plus
  // de la propriété. Avant la 4e migration, un collaborateur pouvait en créer.
  const compact = P13B_NUTRITION.replace(/\s+/g, " ");
  const branches = [...compact.matchAll(/student_id is null and coach_id is not null and coach_id = \(select public\.current_coach_id\(\)\) and public\.est_staff_global\(\)/g)];
  assert.ok(branches.length >= 3, `la branche du plan modèle doit exiger est_staff_global() partout (vu ${branches.length} fois)`);
  // Dans la FONCTION d'ensemble aussi, pas seulement dans les policies.
  assert.ok(/p\.student_id is null and p\.coach_id is not null and p\.coach_id = public\.current_coach_id\(\) and public\.est_staff_global\(\)/
    .test(compact), "la fonction d'ensemble doit réserver le plan modèle au staff global");
  // Jamais de `student_ids_nutrition_*` sur la branche modèle : une catégorie
  // ne doit pas suffire à créer un plan qui n'appartient à aucun élève.
  const insertPlans = POLICIES_NUTRITION.find((p) => p.table === "nutrition_plans" && p.cmd === "INSERT");
  assert.ok(insertPlans, "la policy d'insertion des plans est introuvable");
  const modele = insertPlans.corps.slice(insertPlans.corps.indexOf("student_id is null"));
  assert.ok(!/student_ids_nutrition/.test(modele), "la branche modèle ne doit pas dépendre d'une catégorie");
});

test("P13B/4 5. la suppression d'un plan d'élève n'est accordée à personne", () => {
  const del = POLICIES_NUTRITION.find((p) => p.table === "nutrition_plans" && p.cmd === "DELETE");
  assert.ok(del, "la policy de suppression des plans est introuvable");
  // La règle de P13-A est reprise telle quelle : seule la branche du plan
  // MODÈLE est permise. `ecriture` ne l'élargit pas.
  assert.ok(/student_id is null/.test(del.corps), "seul un plan sans élève peut être supprimé par un coach");
  assert.ok(/est_staff_global\(\)/.test(del.corps), "et seulement par le staff global");
  assert.ok(!/nutrition_plan_ids_ecriture/.test(del.corps),
    "la suppression ne doit pas suivre l'ensemble d'écriture : elle n'était permise à aucun coach");
});

test("P13B/4 6. les cinq tables dépendantes restent en LECTURE SEULE", () => {
  for (const table of DEPENDANTES_LECTURE_SEULE) {
    const dePolicies = POLICIES_NUTRITION.filter((p) => p.table === table);
    assert.deepEqual(dePolicies.map((p) => p.cmd), ["SELECT"],
      `${table} : le niveau ecriture ne doit ouvrir aucune écriture (c'est l'élève qui saisit)`);
    assert.ok(dePolicies[0].corps.includes("student_ids_nutrition_lecture()"),
      `${table} : la lecture doit suivre la catégorie nutrition`);
  }
});

test("P13B/4 7. le propriétaire d'un plan ne se choisit pas", () => {
  const compact = P13B_NUTRITION.replace(/\s+/g, " ");
  // À l'insertion : un appelant non staff global voit `coach_id` forcé à
  // `students.coach_id` plutôt que refusé — même discipline que
  // protect_students_ownership_columns.
  assert.ok(/create or replace function public\.nutrition_plans_fill_coach_id\(\)/.test(compact),
    "le trigger de remplissage doit être réécrit");
  assert.ok(/not public\.est_staff_global\(\) and new\.student_id is not null/.test(compact),
    "un non-staff-global ne doit pas pouvoir désigner le propriétaire d'un plan d'élève");
  // À la mise à jour : la colonne est restaurée, pas espérée non écrite.
  assert.ok(/create or replace function public\.protect_nutrition_plans_owner_columns\(\)/.test(compact),
    "le trigger de protection de coach_id doit exister");
  assert.ok(/new\.coach_id := old\.coach_id;/.test(compact), "coach_id doit être restauré depuis l'ancienne ligne");
  assert.ok(/create trigger protect_nutrition_plans_owner before update on public\.nutrition_plans/.test(compact),
    "le trigger doit être posé sur nutrition_plans");
  // Le service role et l'admin gardent le comportement d'avant.
  assert.ok(/auth\.uid\(\) is null or coalesce\(auth\.role\(\), ''\) = 'service_role'/.test(compact),
    "le service role doit rester libre");
});

test("P13B/4 8. l'étiquette `coaches.role` ne vaut plus pouvoir global", () => {
  const compact = P13B_NUTRITION.replace(/\s+/g, " ");
  // Le défaut 'admin' faisait de toute fiche créée sans rôle un
  // administrateur de cabinet sous P13-B. Deux correctifs, les deux présents.
  assert.ok(/alter table public\.coaches alter column role set default 'assistant'/.test(compact),
    "le défaut de coaches.role doit devenir 'assistant'");
  assert.ok(/create or replace function public\.student_ids_portee\(\)/.test(compact),
    "student_ids_portee() doit être redéfinie");
  const portee = compact.slice(compact.indexOf("create or replace function public.student_ids_portee()"));
  const corpsPortee = portee.slice(0, portee.indexOf("$$;"));
  assert.ok(/where public\.is_admin\(\)/.test(corpsPortee),
    "les droits globaux doivent suivre public.is_admin(), pas staff_role() = 'admin'");
  assert.ok(/not public\.is_admin\(\) and public\.staff_role\(\) in \('admin','assistant'\)/.test(corpsPortee),
    "une fiche 'admin' qui n'est pas l'administrateur applicatif doit redevenir un coach autonome");
  // Aucune donnée n'est réécrite pour contourner une permission.
  assert.ok(!/^\s*update public\.coaches/im.test(P13B_NUTRITION), "aucune ligne coaches ne doit être réécrite");
});

test("P13B/4 9. fonctions SECURITY DEFINER : search_path, pg_temp en dernier, anon sans EXECUTE", () => {
  const definitions = [...P13B_NUTRITION.matchAll(/create or replace function public\.(\w+)\(\)[\s\S]*?\$body\$|create or replace function public\.(\w+)\(\)[\s\S]*?\$\$;/g)];
  assert.ok(definitions.length > 0, "aucune définition de fonction trouvée");
  // Chaque définition déclare definer ET search_path = public, pg_temp.
  const sansSearchPath = definitions.filter((d) => !/set search_path = public, pg_temp/.test(d[0]));
  assert.deepEqual(sansSearchPath.map((d) => d[1] ?? d[2]), [],
    "toute fonction definer doit figer search_path avec pg_temp EN DERNIER");
  const sansDefiner = definitions.filter((d) => !/security definer/.test(d[0]));
  assert.deepEqual(sansDefiner.map((d) => d[1] ?? d[2]), [], "toute fonction de portée doit être SECURITY DEFINER");
  // Les droits : retirés à public et anon, accordés au seul authenticated.
  const compact = P13B_NUTRITION.replace(/\s+/g, " ");
  assert.ok(/revoke all on function public\.%I\(\) from anon/.test(compact), "anon doit perdre EXECUTE");
  assert.ok(/grant execute on function public\.%I\(\) to authenticated/.test(compact),
    "authenticated doit être le seul à garder EXECUTE");
  // Les deux triggers ne sont appelables par personne : un trigger exécutable
  // à la main contournerait la RLS qu'il protège.
  for (const f of ["nutrition_plans_fill_coach_id", "protect_nutrition_plans_owner_columns"]) {
    assert.ok(new RegExp(`revoke all on function public\\.${f}\\(\\) from authenticated`).test(compact),
      `${f} ne doit pas être exécutable par authenticated`);
  }
});

test("P13B/4 10. la migration refuse de passer pour verte si la règle régresse", () => {
  const compact = P13B_NUTRITION.replace(/\s+/g, " ");
  // Garde 1 : plus aucune policy du cœur ne repose sur la propriété P13-A.
  assert.ok(/policies encore fondées sur la propriété P13-A/.test(compact),
    "la garde « propriété P13-A résiduelle » a disparu");
  // Garde 2 : plus aucune policy FOR ALL côté coach.
  assert.ok(/policies FOR ALL restantes côté coach/.test(compact),
    "la garde « FOR ALL résiduel » a disparu");
  assert.ok((compact.match(/raise exception/g) ?? []).length >= 2, "les deux gardes doivent lever");
});

test("P13B/4 11. CONTRÔLE DU CONTRÔLE — le découpage voit les policies", () => {
  // Sans ce garde-fou, une regexp cassée rendrait les contrôles 3, 5 et 6
  // silencieusement verts sur zéro policy.
  assert.ok(POLICIES_NUTRITION.length >= 37,
    `le découpage n'a vu que ${POLICIES_NUTRITION.length} policies, 37 attendues (8 tables × 4 + 5 lectures)`);
  assert.equal(new Set(POLICIES_NUTRITION.map((p) => p.cmd)).size, 4,
    "le découpage ne distingue pas les quatre commandes");
  // Et il doit détecter un croisement de niveaux sur un texte fabriqué.
  const faux = `create policy x_select\n  on public.meals for select to authenticated\n  using (nutrition_day_id in (select public.nutrition_day_ids_ecriture()));`;
  const m = /create policy\s+"?([\w]+)"?\s*\n?\s*on public\.(\w+)\s+for\s+(\w+)\s+to\s+\w+([\s\S]*?);/i.exec(faux);
  assert.ok(m && m[3].toUpperCase() === "SELECT" && m[4].includes("_ecriture()"),
    "la détection « SELECT sur un ensemble d'écriture » ne fonctionne pas");
});

// ════════════════════════════════════════════════════════════════════════════
// P13B/5 — LA GARDE DE provision_program_copy
//
// La section H de supabase/tests/p13b_roles_collaborateurs_checklist.sql
// prouve le COMPORTEMENT sur une vraie base, effets compris (programmes et
// affectations réellement créés ou non). Ces contrôles-ci empêchent la
// RÉINTRODUCTION silencieuse de l'ancienne règle, sans base de données.
// ════════════════════════════════════════════════════════════════════════════

test("P13B/5 1. l'ancienne garde ne peut pas revenir dans une migration", () => {
  // `profiles.role in ('admin','coach')` était juste AVANT P13-B : 'coach' y
  // désignait un staff forcément global. Depuis, c'est la valeur de TOUT le
  // staff non administrateur — collaborateurs compris. Aucune migration
  // POSTÉRIEURE à P13-B ne doit rétablir cette règle sur une fonction
  // `SECURITY DEFINER`.
  const fichiers = readdirSync(join(RACINE, "supabase/migrations"))
    .filter((f) => f.endsWith(".sql"))
    .filter((f) => f >= "20261011090000");
  assert.ok(fichiers.length >= 5, `seulement ${fichiers.length} migration(s) P13-B vues`);
  // ⚠️ LA 5e MIGRATION EST EXCLUE DU BALAYAGE, ET C'EST NÉCESSAIRE : elle
  // CITE le motif qu'elle remplace, dans sa constante de substitution. Son
  // cas est couvert juste en dessous, et plus sévèrement — par la garde
  // qu'elle exécute en fin de migration, qui lit la fonction EN BASE.
  const nomProvision = CHEMIN_P13B_PROVISION.split("/").pop();
  for (const f of fichiers.filter((x) => x !== nomProvision)) {
    const code = sansCommentairesSql(readFileSync(join(RACINE, "supabase/migrations", f), "utf8"));
    assert.ok(
      !/not in \('service', ?'admin', ?'coach'\)/.test(code),
      `${f} : l'ancienne garde profiles.role in (service, admin, coach) est réintroduite`,
    );
  }
  assert.ok(fichiers.includes(nomProvision!), "la 5e migration doit être dans le balayage");
  // Et la 5e migration l'enlève explicitement : elle contient le motif dans
  // sa CONSTANTE de substitution (donc dans le texte brut), et sa garde
  // finale refuse de passer si le motif survit en base.
  assert.ok(/not in \('service', 'admin', 'coach'\)/.test(P13B_PROVISION_BRUT),
    "la 5e migration doit citer le motif qu'elle remplace");
  assert.ok(/l''ancienne garde profiles\.role in \(admin, coach\) est encore en place/.test(P13B_PROVISION_BRUT),
    "la garde de fin de migration doit rougir si l'ancienne règle survit");
});

test("P13B/5 2. la nouvelle garde : service_role, is_admin(), puis la portée", () => {
  const compact = P13B_PROVISION.replace(/\s+/g, " ");
  // Les quatre chemins, dans l'ordre, et aucun autre.
  assert.ok(/if coalesce\(auth\.role\(\), ''\) = 'service_role' then/.test(compact),
    "le chemin service_role doit rester en premier et inchangé");
  assert.ok(/elsif auth\.uid\(\) is null then/.test(compact),
    "un appelant sans identité doit être refusé explicitement");
  assert.ok(/elsif coalesce\(public\.is_admin\(\), false\) then/.test(compact),
    "les droits globaux doivent suivre public.is_admin(), pas profiles.role = 'coach'");
  assert.ok(/elsif p_student_id is null then/.test(compact),
    "un identifiant d'élève NULL doit être refusé AVANT le test d'appartenance");
  assert.ok(/elsif coalesce\( p_student_id in \(select public\.student_ids_entrainement_ecriture\(\)\), false \) then/.test(compact),
    "l'appartenance doit être testée sur la portée entrainement/ecriture, en fail-closed");
  // Trois refus explicites : sans identité, élève NULL, et le `else` final.
  // ⚠️ LE COMPTE SE FAIT DANS LA CONSTANTE DE REMPLACEMENT, et non sur tout
  // le fichier : le MOTIF retiré contient lui aussi un `raise exception`, et
  // compter sur l'ensemble en trouvait quatre — un contrôle qui mesure le
  // mauvais texte.
  const iNeuf = P13B_PROVISION_BRUT.indexOf("v_neuf  constant text := $neuf$");
  assert.ok(iNeuf > 0, "la constante de remplacement est introuvable");
  const neuf = P13B_PROVISION_BRUT.slice(iNeuf, P13B_PROVISION_BRUT.indexOf("$neuf$;", iNeuf));
  assert.equal((neuf.match(/raise exception 'provision_program_copy : accès refusé'/g) ?? []).length, 3,
    "la nouvelle garde doit porter exactement trois refus explicites");
  // Et elle n'accorde que par les trois chemins prévus : un seul `if`, deux
  // `elsif` autorisants, deux `elsif` refusants, un `else` refusant.
  assert.equal((neuf.match(/^\s*null;$/gm) ?? []).length, 3,
    "exactement trois branches autorisantes : service_role, is_admin(), portée");
  // Aucune branche ne doit lire profiles directement : c'est la faute
  // d'origine. ⚠️ LE CONTRÔLE PORTE SUR LE CODE, PAS SUR LES COMMENTAIRES :
  // l'en-tête de la garde CITE l'ancienne règle pour expliquer pourquoi elle
  // disparaît, et une recherche naïve de « profiles » trouvait ce rappel —
  // un contrôle qui mesure le mauvais texte. On retire donc les commentaires
  // SQL avant de mesurer, et on vérifie en plus qu'aucune lecture de table
  // ne subsiste sous quelque forme que ce soit.
  const neufCode = neuf
    .split("\n")
    .map((l) => l.replace(/--.*$/, ""))
    .join("\n");
  assert.ok(/is_admin/.test(neufCode),
    "le découpage du code doit conserver la garde elle-même");
  assert.ok(!/profiles/.test(neufCode),
    "la garde ne doit plus lire profiles directement");
  assert.ok(!/\bfrom\s+public\.\w+/i.test(neufCode.replace(/select public\.\w+\(\)/g, "")),
    "la garde ne doit lire aucune table directement : elle appelle les fonctions de portée");
  assert.ok(!/\brole\b\s*(::|=|in\b)/i.test(neufCode.replace(/auth\.role\(\)/g, "")),
    "aucune décision ne doit se fonder sur une colonne role lue en direct");
});

test("P13B/5 3. seule la garde change : le corps de la copie est repris, pas réécrit", () => {
  // La migration ne recopie pas 200 lignes : elle substitue, et la
  // substitution est gardée. C'est ce qui évite de perdre au passage les
  // prescriptions (20260802190000) et le RPE recommandé (20260803190000).
  const compact = P13B_PROVISION.replace(/\s+/g, " ");
  assert.ok(/select pg_get_functiondef\(p\.oid\) into v_def/.test(compact),
    "la définition en place doit être lue, pas retapée");
  assert.ok(/if v_n <> 1 then/.test(compact), "la substitution doit exiger exactement une occurrence");
  assert.ok(/execute replace\(v_def, v_motif, v_neuf\)/.test(compact), "la substitution doit être exécutée");
  // Rejouable : si la garde est déjà posée, la migration ne réécrit rien.
  assert.ok(/if position\(v_neuf in v_def\) > 0 then/.test(compact), "la migration doit être rejouable");
  // Elle ne touche à aucun autre objet : pas de create/drop de table, de
  // policy ni d'autre fonction.
  for (const interdit of [/create table/i, /drop table/i, /create policy/i, /drop policy/i,
                          /alter table/i, /create or replace function/i]) {
    assert.ok(!interdit.test(P13B_PROVISION), `la 5e migration ne doit rien faire d'autre : ${interdit}`);
  }
  // Et elle vérifie que le corps a survécu.
  for (const marqueur of ["pg_advisory_xact_lock", "source_checkout_session_id", "training_prescriptions", "recommended_rpe"]) {
    assert.ok(compact.includes(marqueur), `la garde finale doit vérifier la présence de ${marqueur}`);
  }
});

test("P13B/5 4. les droits EXECUTE sont réaffirmés, et anon reste exclu", () => {
  const compact = P13B_PROVISION.replace(/\s+/g, " ");
  assert.ok(/alter function public\.provision_program_copy\(uuid, uuid, text\) owner to postgres/.test(compact),
    "le propriétaire doit être réaffirmé");
  assert.ok(/revoke execute on function public\.provision_program_copy\(uuid, uuid, text\) from anon/.test(compact),
    "anon doit perdre EXECUTE");
  assert.ok(/grant execute on function public\.provision_program_copy\(uuid, uuid, text\) to authenticated, service_role/.test(compact),
    "authenticated et service_role doivent garder EXECUTE");
  assert.ok(/anon peut exécuter provision_program_copy/.test(P13B_PROVISION_BRUT),
    "la garde finale doit rougir si anon récupère EXECUTE");
  // La signature ne change pas : les appelants TypeScript passent trois
  // arguments nommés, et `lib/supabase/programs.ts` n'est pas touché.
  const programs = lire("lib/supabase/programs.ts");
  assert.ok(/rpc\("provision_program_copy", \{/.test(programs), "l'appel applicatif doit rester inchangé");
  for (const arg of ["p_program_id", "p_student_id", "p_checkout_session_id"]) {
    assert.ok(programs.includes(arg), `l'argument ${arg} doit rester dans l'appel`);
  }
});

test("P13B/5 5. la checklist couvre les cas de refus ET le cas autorisé", () => {
  const checklist = lire("supabase/tests/p13b_roles_collaborateurs_checklist.sql");
  for (const etiquette of ["H1.", "H2.", "H3.", "H4.", "H5.", "H6.", "H7.", "H8.", "H9.", "H10.", "H11.", "H12.", "H13."]) {
    assert.ok(checklist.includes(etiquette), `le contrôle ${etiquette} est absent de la checklist`);
  }
  // Le cas AUTORISÉ est indispensable : tout fermer rendrait la checklist
  // verte sans que la fonctionnalité marche.
  assert.ok(/H5\. entrainement\/ECRITURE \+ affectation : autorisé/.test(checklist),
    "le cas autorisé doit être testé, sinon fermer tout suffirait");
  // Et les contrôles mesurent les EFFETS en base, pas le texte de la garde.
  assert.ok(/select count\(\*\) into v_prog from public\.programs/.test(checklist),
    "les contrôles doivent compter les programmes réellement créés");
  assert.ok(/select count\(\*\) into v_aff from public\.assignments/.test(checklist),
    "les contrôles doivent compter les affectations réellement créées");
  assert.ok(/v_ok := v_refuse and v_prog = 0 and v_aff = 0/.test(checklist),
    "un refus doit exiger zéro ligne créée");
  assert.ok(/v_ok := \(not v_refuse\) and v_id is not null and v_prog = 1 and v_aff = 1/.test(checklist),
    "une autorisation doit exiger la ligne attendue");
});

// ════════════════════════════════════════════════════════════════════════════


/* ══════════════════════════════════════════════════════════════════════════
 * P13B/6 — LA SURFACE DE RÉSERVATION
 * ══════════════════════════════════════════════════════════════════════════
 * Anomalie constatée sur Vercel Preview le 13/10/2026 : avec
 * `agenda_communication = aucun accès`, un collaborateur lisait les créneaux
 * de disponibilité, les réglages de réservation et les bornes occupées.
 *
 * ⚠️ LA LEÇON QUE CES TESTS GARDENT. Les policies PERMISSIVES de PostgreSQL se
 * combinent en **OU**. La migration 20261011100000 a ajouté des policies
 * catégorisées À CÔTÉ des policies héritées du parcours de réservation
 * (`auth.role() = 'authenticated'`) : ajouter une clause stricte à côté d'une
 * clause ouverte ne referme RIEN. C'est le trou que la 6e migration ferme, et
 * le motif que ces contrôles interdisent de réintroduire.
 * ══════════════════════════════════════════════════════════════════════════ */

test("P13B/6 1. aucune policy SELECT ouverte à tout authentifié ne peut revenir", () => {
  // Balayage sur TOUTES les migrations P13-B : une policy `auth.role() =
  // 'authenticated'` sur la surface de réservation rouvrirait le trou.
  // ⚠️ LA 6e MIGRATION EST EXCLUE DU BALAYAGE : elle CITE la policy ouverte
  // dans son `drop policy if exists`, c'est précisément son travail.
  const nomReservation = CHEMIN_P13B_RESERVATION.split("/").pop();
  const balayees = [
    CHEMIN_P13B_MODELE, CHEMIN_P13B_POLICIES, CHEMIN_P13B_FONCTIONS,
    CHEMIN_P13B_NUTRITION, CHEMIN_P13B_PROVISION,
  ];
  for (const chemin of balayees) {
    const sql = sansCommentairesSql(lire(chemin));
    assert.ok(
      !/create policy[\s\S]{0,400}?auth\.role\(\)\s*=\s*'authenticated'/i.test(sql),
      `${chemin} : une policy ouverte à tout authentifié y est créée`,
    );
  }
  assert.ok(nomReservation && nomReservation.length > 0, "la 6e migration doit être nommée");
  assert.ok(
    balayees.every((c) => !c.endsWith(nomReservation!)),
    "la 6e migration ne doit pas figurer dans le balayage : elle cite la policy ouverte pour la retirer",
  );
  assert.ok(
    /drop policy if exists coach_availabilities_select_authenticated/.test(P13B_RESERVATION),
    "la 6e migration doit retirer la policy ouverte des disponibilités",
  );
  assert.ok(
    /drop policy if exists booking_settings_select_authenticated/.test(P13B_RESERVATION),
    "la 6e migration doit retirer la policy ouverte des réglages",
  );
});

test("P13B/6 2. le parcours élève est préservé, et explicitement", () => {
  // ⚠️ LA MOITIÉ DU CORRECTIF. Sans les créneaux, les réglages et les bornes
  // occupées, un élève ne peut plus réserver — ou réserve un créneau déjà
  // pris par un autre élève (voir getAvailableSlots).
  const compact = P13B_RESERVATION.replace(/\s+/g, " ");
  assert.ok(
    /create policy coach_availabilities_select_eleve on public\.coach_availabilities for select using \(\(select public\.current_student_id\(\)\) is not null\)/.test(compact),
    "l'élève doit garder les créneaux, par current_student_id()",
  );
  assert.ok(
    /create policy booking_settings_select_eleve on public\.booking_settings for select using \(\(select public\.current_student_id\(\)\) is not null\)/.test(compact),
    "l'élève doit garder les réglages de réservation",
  );
  assert.ok(/public\.current_student_id\(\) is not null/.test(compact),
    "la fonction gardée doit laisser passer le parcours élève");
});

test("P13B/6 3. la garde de get_busy_ranges exige la catégorie ET la portée", () => {
  const compact = P13B_RESERVATION.replace(/\s+/g, " ");
  assert.ok(/security definer/.test(compact), "la fonction reste SECURITY DEFINER");
  assert.ok(/set search_path = public, pg_temp/.test(compact),
    "search_path figé, pg_temp en dernier — convention P13-A/P13-B");
  assert.ok(
    /'agenda_communication' in \(select public\.categories_lecture\(\)\)/.test(compact),
    "la catégorie doit être exigée au niveau lecture",
  );
  assert.ok(
    /and exists \(select 1 from public\.coach_ids_portee\(\)\)/.test(compact),
    "la permission SEULE ne doit jamais suffire : la portée est exigée en plus",
  );
  assert.ok(/coalesce\(/.test(compact), "logique fail-closed sur les NULL");
  assert.ok(/coalesce\(auth\.role\(\), ''\) = 'service_role'/.test(compact),
    "service_role (webhook, cron) doit rester inchangé");
  assert.ok(/coalesce\(public\.est_staff_global\(\), false\)/.test(compact),
    "l'administrateur et le coach autonome passent par est_staff_global()");
  // Le corps n'est pas amputé : mêmes tables, mêmes statuts bloquants.
  assert.ok(/from public\.appointments a/.test(compact) && /from public\.coach_unavailabilities u/.test(compact),
    "les deux sources de bornes doivent rester");
  assert.ok(/a\.status in \('pending', 'confirmed'\)/.test(compact),
    "les statuts bloquants ne doivent pas changer");
  assert.ok(/revoke execute on function public\.get_busy_ranges\(timestamptz, timestamptz\) from anon/.test(compact),
    "anon doit perdre execute");
  assert.ok(/grant execute on function public\.get_busy_ranges\(timestamptz, timestamptz\) to authenticated, service_role/.test(compact),
    "authenticated et service_role doivent garder execute");
});

test("P13B/6 4. la clause de portée du collaborateur est gardée par la catégorie", () => {
  const compact = P13B_RESERVATION.replace(/\s+/g, " ");
  // Les policies validées exigent `coach_id = current_staff_id()` : un
  // collaborateur ne possède aucune ligne de disponibilité. Sans cette clause
  // de portée il perdrait les créneaux du coach dont il gère les élèves.
  assert.ok(/create policy coach_availabilities_select_portee/.test(compact),
    "la clause de portée doit exister");
  assert.ok(
    /coach_id in \(select public\.coach_ids_portee\(\)\)/.test(compact),
    "elle doit viser les coachs de la portée, pas tous les coachs",
  );
  assert.ok(
    /create policy coach_availabilities_select_portee[\s\S]{0,300}?categories_lecture/.test(compact),
    "et rester gardée par la catégorie",
  );
  assert.ok(/create policy booking_settings_select_agenda[\s\S]{0,200}?categories_lecture/.test(compact),
    "les réglages suivent la même règle");
});

test("P13B/6 5. les cinq migrations déjà appliquées ne sont pas modifiées", () => {
  // La 6e est ADDITIVE : elle ne doit toucher ni créer aucune des structures
  // des cinq précédentes, seulement les trois objets en cause.
  const compact = P13B_RESERVATION.replace(/\s+/g, " ");
  assert.ok(!/create table|drop table|alter table/i.test(compact),
    "aucune table ne doit être touchée");
  assert.ok(!/drop function/i.test(compact), "aucune fonction ne doit être supprimée");
  for (const garde of ["student_ids_portee", "student_ids_suivi_eleve", "staff_role"]) {
    assert.ok(!new RegExp(`create or replace function public\\.${garde}`).test(compact),
      `${garde} ne doit pas être redéfinie par ce correctif`);
  }
  // Et elle est rejouable : chaque create policy est précédé d'un drop.
  const creations = (compact.match(/create policy (\w+)/g) ?? []).map((m) => m.split(" ")[2]);
  assert.equal(creations.length, 4, "quatre policies sont créées");
  for (const nom of creations) {
    assert.ok(new RegExp(`drop policy if exists ${nom} `).test(compact),
      `${nom} doit être précédée d'un drop if exists — sinon le rejeu échoue`);
  }
});

test("P13B/6 6. la checklist mesure les effets en base, et le parcours élève", () => {
  const checklist = lire("supabase/tests/p13b_roles_collaborateurs_checklist.sql");
  for (const n of ["I1.", "I2.", "I3.", "I4.", "I5.", "I6.", "I7.", "I8.", "I13.", "I14.", "I15."]) {
    assert.ok(checklist.includes(n), `le contrôle ${n} manque à la checklist`);
  }
  // Les trois surfaces sont mesurées par un COMPTAGE RÉEL, pas par le texte
  // d'une condition.
  assert.ok(/select count\(\*\) from public\.coach_availabilities/.test(checklist));
  assert.ok(/select count\(\*\) from public\.booking_settings/.test(checklist));
  assert.ok(/select count\(\*\) from public\.get_busy_ranges\(/.test(checklist));
  // La permission seule et l'affectation seule sont testées séparément.
  assert.ok(/permission sans élève affecté/.test(checklist));
  assert.ok(/affectation sans permission/.test(checklist));
  // Et la lecture se fait dans la session de chaque acteur.
  assert.ok(/lecture_compte_en_tant_que/.test(checklist),
    "chaque mesure doit se faire dans la session effective de l'acteur");
});



/* ══════════════════════════════════════════════════════════════════════════
 * P13B/7 — L'ADMINISTRATEUR RÉEL
 * ══════════════════════════════════════════════════════════════════════════
 * Signalé le 13/10/2026 : plus aucune modification de programme ne
 * s'enregistrait (« Une partie du programme n'a pas pu être enregistrée » =
 * STRUCTURE_INCOMPLETE). `est_staff_global()` ne lisait que `staff_role()`,
 * qui exige une fiche `coaches` ACTIVE : un `profiles.role = 'admin'` sans
 * fiche perdait les programmes modèles, en lecture comme en écriture.
 * ══════════════════════════════════════════════════════════════════════════ */

test("P13B/7 1. est_staff_global() consulte les DEUX signaux d'administrateur", () => {
  const compact = P13B_ADMIN_REEL.replace(/\s+/g, " ");
  assert.ok(/create or replace function public\.est_staff_global\(\)/.test(compact),
    "la fonction doit être redéfinie");
  assert.ok(/coalesce\(public\.is_admin\(\), false\)/.test(compact),
    "l'administrateur RÉEL (profiles.role) doit être reconnu");
  assert.ok(/coalesce\(public\.staff_role\(\) in \('admin', 'assistant'\), false\)/.test(compact),
    "et l'étiquette coaches.role doit rester : sinon le coach autonome perd sa portée");
  // ⚠️ FAIL-CLOSED. `staff_role()` NULL donnait `null in (...)` = NULL, traité
  // comme un refus par chance et non par écrit.
  assert.equal((compact.match(/coalesce\(/g) ?? []).length, 2,
    "les deux branches doivent être enveloppées : aucune ne doit pouvoir rendre NULL");
  assert.ok(/security definer/.test(compact) && /set search_path = public, pg_temp/.test(compact),
    "definer à search_path figé, pg_temp en dernier");
  assert.ok(/revoke execute on function public\.est_staff_global\(\) from anon/.test(compact),
    "anon doit rester exclu");
  assert.ok(/grant execute on function public\.est_staff_global\(\) to authenticated, service_role/.test(compact),
    "authenticated et service_role gardent execute");
});

test("P13B/7 2. le correctif est MINIMAL : une seule fonction change", () => {
  const compact = P13B_ADMIN_REEL.replace(/\s+/g, " ");
  assert.ok(!/create policy|drop policy/i.test(compact), "aucune policy ne doit bouger");
  assert.ok(!/create table|alter table|drop table/i.test(compact), "aucune table ne doit bouger");
  // Une seule fonction redéfinie.
  assert.equal((compact.match(/create or replace function/g) ?? []).length, 1,
    "exactement une fonction redéfinie");
  for (const garde of ["staff_role", "is_admin", "student_ids_portee", "categories_lecture"]) {
    assert.ok(!new RegExp(`create or replace function public\\.${garde}\\(`).test(compact),
      `${garde}() ne doit pas être redéfinie par ce correctif`);
  }
});

test("P13B/7 3. la checklist prouve le déblocage ET la non-régression du collaborateur", () => {
  const checklist = lire("supabase/tests/p13b_roles_collaborateurs_checklist.sql");
  for (const n of ["J1.", "J2.", "J3.", "J3b.", "J4.", "J5.", "J6.", "J7."]) {
    assert.ok(checklist.includes(n), `le contrôle ${n} manque à la checklist`);
  }
  // L'écriture est mesurée EN BASE, pas seulement tentée.
  assert.ok(/J3b\. la semaine est RÉELLEMENT en base/.test(checklist),
    "l'effet de l'écriture doit être relu en base");
  // ⚠️ LE CONTRÔLE DU CONTRÔLE : reconnaître l'admin réel ne doit rien donner
  // à un collaborateur.
  assert.ok(/le collaborateur n''est toujours PAS staff global/.test(checklist));
  assert.ok(/il ne voit toujours aucun programme modèle/.test(checklist));
});



/* ══════════════════════════════════════════════════════════════════════════
 * P13B/8 — UNE POLICY `INSERT` NE TESTE JAMAIS SON PROPRE IDENTIFIANT
 * ══════════════════════════════════════════════════════════════════════════
 * Défaut BLOQUANT du 13/10/2026 : plus aucune création n'était possible,
 * administrateur compris. `with check (id in (select <table>_ids_ecriture()))`
 * compare l'id d'une ligne qu'on crée à un ensemble calculé depuis les lignes
 * DÉJÀ EXISTANTES de la même table — toujours faux.
 *
 * ⚠️ LA LEÇON QUE CES TESTS GARDENT. Une policy INSERT porte sur le PARENT de
 * la ligne (program_id, session_id, block_id, student_id, document_id), jamais
 * sur `id`. C'est ce que font les neuf autres policies INSERT du cœur, et ce
 * que le contrôle 1 ci-dessous impose à toutes les futures.
 * ══════════════════════════════════════════════════════════════════════════ */

test("P13B/8 1. aucune migration ne peut écrire une policy INSERT sur `id`", () => {
  // Balayage de TOUTES les migrations P13-B — y compris la 8e, qui ne doit
  // créer que des règles portant sur un parent.
  const migrations: Array<[string, string]> = [
    [CHEMIN_P13B_MODELE, P13B_MODELE], [CHEMIN_P13B_POLICIES, P13B_POLICIES],
    [CHEMIN_P13B_FONCTIONS, P13B_FONCTIONS], [CHEMIN_P13B_NUTRITION, P13B_NUTRITION],
    [CHEMIN_P13B_PROVISION, P13B_PROVISION], [CHEMIN_P13B_RESERVATION, P13B_RESERVATION],
    [CHEMIN_P13B_ADMIN_REEL, P13B_ADMIN_REEL], [CHEMIN_P13B_INSERT, P13B_INSERT],
    [CHEMIN_P13B_AUTOREF, P13B_AUTOREF],
  ];
  for (const [chemin, sql] of migrations) {
    const compact = sql.replace(/\s+/g, " ");
    // `for insert ... with check (id in (select …))` : le motif fautif.
    assert.ok(
      !/for insert\s+with check\s*\(\s*id in \(select/i.test(compact),
      `${chemin} : une policy INSERT y teste l'id de la ligne créée — aucune création ne serait possible`,
    );
  }
  // La 8e migration retire bien les cinq règles fautives.
  const compact = P13B_INSERT.replace(/\s+/g, " ");
  for (const nom of ["workout_sessions_manage_staff_insert", "workout_exercises_manage_staff_insert",
                     "programs_manage_staff_insert", "students_manage_staff",
                     "documents_manage_staff_insert", "training_prescriptions_manage_staff_insert"]) {
    assert.ok(new RegExp(`drop policy if exists ${nom} `).test(compact),
      `${nom} doit être remplacée — et le drop rend la migration rejouable`);
    assert.ok(new RegExp(`create policy ${nom} `).test(compact), `${nom} doit être recréée`);
  }
});

test("P13B/8 2. chaque nouvelle règle porte sur le PARENT, avec le même ensemble qu'avant", () => {
  const compact = P13B_INSERT.replace(/\s+/g, " ");
  // Les ensembles ne changent pas : seule la colonne testée change.
  assert.ok(/workout_sessions for insert with check \(program_id in \(select public\.program_ids_ecriture\(\)\)\)/.test(compact),
    "une séance tient son droit de son PROGRAMME");
  assert.ok(/session_id in \(select public\.workout_session_ids_ecriture\(\)\)/.test(compact),
    "un exercice tient son droit de sa SÉANCE");
  assert.ok(/block_id in \(select public\.training_block_ids_ecriture\(\)\)/.test(compact),
    "ou de son BLOC");
  // ⚠️ Prescription PAR EXERCICE : block_id est NULL, `null in (…)` vaut NULL.
  assert.ok(/exercise_id is not null and exercise_id in \(select public\.workout_exercise_ids_ecriture\(\)\)/.test(compact),
    "une série rattachée à un exercice doit être possible : block_id y est NULL");
  // Un programme neuf : transposition de program_ids_ecriture() sur les colonnes.
  assert.ok(/owner_student_id in \(select public\.student_ids_entrainement_ecriture\(\)\)/.test(compact));
  assert.ok(/coach_id in \(select public\.coach_ids_portee\(\)\)/.test(compact));
  assert.ok(/'entrainement' in \(select public\.categories_ecriture\(\)\)/.test(compact));
  // Fail-closed sur les NULL, comme partout dans P13-B.
  assert.ok((compact.match(/coalesce\(/g) ?? []).length >= 6,
    "les conditions doivent être enveloppées : un NULL ne doit jamais autoriser");
});

test("P13B/8 3. le correctif ne touche QUE la création", () => {
  const compact = P13B_INSERT.replace(/\s+/g, " ");
  assert.ok(!/for select|for update|for delete/i.test(compact),
    "aucune policy de lecture, de modification ou de suppression ne doit bouger");
  assert.ok(!/create or replace function/i.test(compact), "aucune fonction ne doit être redéfinie");
  assert.ok(!/create table|alter table|drop table/i.test(compact), "aucune table ne doit bouger");
  // Et la migration le VÉRIFIE elle-même avant de committer.
  assert.ok(/les policies SELECT\/UPDATE existantes ont été touchées/.test(P13B_INSERT),
    "la migration doit refuser de committer si elle a emporté une policy de lecture");
});

test("P13B/8 4. la checklist prouve la création ET la non-régression", () => {
  const checklist = lire("supabase/tests/p13b_roles_collaborateurs_checklist.sql");
  for (const n of ["K1.", "K1b.", "K2.", "K3.", "K4.", "K5.", "K6.", "K7.", "K8.", "K9.", "K10.", "K11."]) {
    assert.ok(checklist.includes(n), `le contrôle ${n} manque à la checklist`);
  }
  assert.ok(/la séance est RÉELLEMENT en base/.test(checklist),
    "la création doit être relue en base, pas seulement tentée");
  assert.ok(/collaborateur sans permission : il ne CRÉE aucune séance/.test(checklist));
  assert.ok(/permission SANS élève affecté : toujours aucune création/.test(checklist));
});



/* ══════════════════════════════════════════════════════════════════════════
 * P13B/9 — UNE POLICY NE DÉPEND JAMAIS DE LA LIGNE QU'ELLE AUTORISE
 * ══════════════════════════════════════════════════════════════════════════
 * Suite directe de P13B/8. `INSERT … RETURNING` exige, en plus du
 * `with check`, que la ligne satisfasse la policy **SELECT**. Écrite
 * `id in (select <table>_ids_lecture())` — une fonction STABLE qui lit la même
 * table — elle était fausse par construction : le snapshot du début de la
 * commande ne contient pas la ligne qu'on insère.
 *
 * ⚠️ ET `RETURNING` EST LA FORME EMPLOYÉE PARTOUT : `returning … into` dans
 * les RPC, `.insert().select("id").single()` côté client.
 * ══════════════════════════════════════════════════════════════════════════ */

test("P13B/9 1. aucune policy ne peut tester `id` contre un ensemble de sa propre table", () => {
  // Le motif fautif, sur les deux faces d'une policy.
  const tables: Record<string, string> = {
    programs: "program_ids", workout_sessions: "workout_session_ids",
    workout_exercises: "workout_exercise_ids", nutrition_plans: "nutrition_plan_ids",
    documents: "document_ids",
  };
  const compact = P13B_AUTOREF.replace(/\s+/g, " ");
  for (const [table, prefixe] of Object.entries(tables)) {
    assert.ok(
      !new RegExp(`on public\\.${table} for (select|update|delete)[\\s\\S]{0,120}?id in \\(select public\\.${prefixe}_`).test(compact),
      `${table} : la policy réécrite teste encore son propre id`,
    );
    assert.ok(new RegExp(`drop policy if exists \\w+ on public\\.${table}`).test(compact),
      `${table} : ses policies doivent être remplacées — et le drop rend la migration rejouable`);
  }
});

test("P13B/9 2. chaque policy est transposée sur les COLONNES, à portée égale", () => {
  const compact = P13B_AUTOREF.replace(/\s+/g, " ");
  // La définition de chaque fonction remplacée, retrouvée telle quelle.
  assert.ok(/on public\.workout_sessions for select using \(program_id in \(select public\.program_ids_lecture\(\)\)\)/.test(compact),
    "une séance tient sa portée de son PROGRAMME, comme workout_session_ids_lecture()");
  assert.ok(/session_id in \(select public\.workout_session_ids_lecture\(\)\) or block_id in \(select public\.training_block_ids_lecture\(\)\)/.test(compact),
    "un exercice tient sa portée de sa SÉANCE ou de son BLOC");
  assert.ok(/owner_student_id in \(select public\.student_ids_entrainement_lecture\(\)\)/.test(compact),
    "un programme d'élève suit la portée entrainement/lecture");
  assert.ok(/student_id in \(select public\.student_ids_nutrition_lecture\(\)\)/.test(compact),
    "un plan d'élève suit la portée nutrition/lecture");
  // ⚠️ students : même portée, mais sans relire `students`.
  assert.ok(/create or replace function public\.student_ids_collaborateur\(\)/.test(compact),
    "la branche « élèves affectés » doit sortir dans sa propre fonction : student_ids_portee() lit students");
  assert.ok(/from public\.collaborateur_eleves a/.test(compact),
    "et cette fonction ne doit lire que la table d'affectation");
  // Fail-closed partout.
  assert.ok((compact.match(/coalesce\(/g) ?? []).length >= 15,
    "les conditions doivent être enveloppées : un NULL ne doit jamais autoriser");
});

test("P13B/9 3. les deux élargissements sont bornés, et seulement ceux-là", () => {
  const compact = P13B_AUTOREF.replace(/\s+/g, " ");
  // La propriété ouvre un document NEUF à son auteur — sinon il ne peut pas
  // le relire après création. Mais elle reste bornée par la portée de coachs
  // ET par la catégorie.
  assert.ok(/on public\.documents for select[\s\S]{0,400}?coach_id in \(select public\.coach_ids_portee\(\)\)/.test(compact),
    "la branche propriétaire des documents doit être bornée par coach_ids_portee()");
  assert.ok(/on public\.documents for select[\s\S]{0,600}?categories_lecture/.test(compact),
    "et par la catégorie");
  // L'accès par AFFECTATION n'est pas perdu.
  assert.ok(/from public\.document_assignments da/.test(compact),
    "l'accès par affectation doit rester");
  // Aucune fonction de portée n'est redéfinie au passage.
  for (const f of ["staff_role", "is_admin", "est_staff_global", "student_ids_portee", "categories_lecture"]) {
    assert.ok(!new RegExp(`create or replace function public\\.${f}\\(`).test(compact),
      `${f}() ne doit pas être redéfinie par ce correctif`);
  }
});

test("P13B/9 4. la checklist teste la forme RÉELLEMENT employée par le code", () => {
  const checklist = lire("supabase/tests/p13b_roles_collaborateurs_checklist.sql");
  for (const n of ["L1.", "L2.", "L3.", "L4.", "L5.", "L6.", "L7.", "L7b.", "L8.", "L9.", "L10."]) {
    assert.ok(checklist.includes(n), `le contrôle ${n} manque à la checklist`);
  }
  assert.ok(/returning id into/.test(checklist),
    "les contrôles doivent employer RETURNING : c'est ce que fait le code applicatif");
  assert.ok(/save_training_session_blocks/.test(checklist),
    "la RPC réelle du builder doit être exercée de bout en bout");
  // ⚠️ L'APOSTROPHE EST DOUBLÉE DANS LE SQL (`l''exercice`) : chercher la
  // forme française naïve ne trouverait rien, et le contrôle passerait pour
  // absent alors qu'il est là.
  assert.ok(/exercice écrit par la RPC est RÉELLEMENT en base/.test(checklist),
    "et son effet relu en base");
  // Et le code applicatif emploie bien cette forme — c'est ce qui rend le
  // défaut bloquant.
  const programs = lire("lib/supabase/programs.ts");
  assert.ok(/\.insert\([\s\S]{0,200}?\)\s*\.select\("id"\)\s*\.single\(\)/.test(programs),
    "le builder insère bien avec .select().single() : la policy SELECT est donc exigée");
});


console.log(`\n${passed} réussis, ${failed} échecs`);
if (failed > 0) process.exit(1);
