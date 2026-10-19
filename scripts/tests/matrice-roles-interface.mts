/*
 * ════════════════════════════════════════════════════════════════════════════
 * MATRICE DE NON-RÉGRESSION DE L'INTERFACE
 * administrateur · coach autonome · collaborateur
 * ════════════════════════════════════════════════════════════════════════════
 *
 * ⚠️ CE QUE CE FICHIER NE PROUVE PAS, ET IL FAUT LE DIRE D'ABORD. Il mesure
 * la règle d'AFFICHAGE et le texte des gardes. Il ne prouve RIEN sur ce qu'un
 * compte peut réellement lire ou écrire : cette preuve-là est en base, dans
 * supabase/tests/matrice_roles_admin_coach_collaborateur.sql, qui ouvre une
 * session par rôle et compte les lignes. Les deux sont nécessaires, et aucun
 * ne remplace l'autre — c'est précisément d'avoir cru qu'un masquage valait
 * une protection, et qu'un test de règle pure valait une mesure, qui a produit
 * le défaut corrigé ici.
 *
 * ────────────────────────────────────────────────────────────────────────────
 * LE DÉFAUT MESURÉ, ET POURQUOI IL A ÉTÉ SI DIFFICILE À NOMMER
 * ────────────────────────────────────────────────────────────────────────────
 * `sectionAdminVisible` décidait, pour un contexte « pas admin, aucun rôle,
 * aucune catégorie, mécanisme opérationnel », de ne montrer que l'accueil.
 * C'est la bonne décision pour ce contexte. Le défaut est que
 * `useStaffContext` rendait EXACTEMENT ce contexte chaque fois que la lecture
 * des droits n'aboutissait pas : client navigateur absent, session pas encore
 * réhydratée au premier rendu (les RPC partaient alors en `anon`, à qui P13-B
 * a retiré l'EXECUTE — donc 42501, que l'ancien classement ne reconnaissait
 * pas), réseau coupé, 5xx. Et ce résultat était mis en cache au niveau du
 * module, sans invalidation : l'administrateur gardait son menu amputé
 * jusqu'au rechargement complet.
 *
 * Les contrôles ci-dessous verrouillent les deux bouts : « ne pas savoir »
 * n'est plus une réponse, et la règle d'affichage traite l'ignorance comme
 * l'ignorance.
 * ════════════════════════════════════════════════════════════════════════════
 */

import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

import {
  CATEGORIES_PAR_SECTION_ADMIN,
  droitsNavigationDepuisContexte,
  groupeAdminVisible,
  SECTION_ADMIN_ACCUEIL,
  sectionAdminVisible,
  type CategorieNavigation,
  type DroitsNavigationAdmin,
} from "../../lib/admin-shell-nav";
import { droitEcritureProgrammes, type ContexteDroitAffectation } from "../../lib/droit-affectation";

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

const lire = (chemin: string) => readFileSync(new URL(`../../${chemin}`, import.meta.url), "utf8");

/**
 * Les sections de l'espace d'administration, telles que le dépôt les porte.
 *
 * ⚠️ L'ACCUEIL EST AJOUTÉ À LA MAIN. Il n'est pas dans
 * `CATEGORIES_PAR_SECTION_ADMIN` — la règle le traite à part, par
 * `SECTION_ADMIN_ACCUEIL`, parce qu'il est le point d'entrée de l'espace et
 * que ses tuiles sont filtrées par la RLS. L'oublier faisait attendre à ce
 * fichier une liste sans accueil, et les contrôles C2/C3 échouaient sur leur
 * propre arithmétique.
 */
const SECTIONS = [SECTION_ADMIN_ACCUEIL, ...Object.keys(CATEGORIES_PAR_SECTION_ADMIN)];
/** Les six qu'aucune catégorie de collaborateur n'ouvre (liste de catégories vide). */
const SECTIONS_GLOBALES = Object.keys(CATEGORIES_PAR_SECTION_ADMIN).filter(
  (href) => CATEGORIES_PAR_SECTION_ADMIN[href].length === 0,
);
/** Les huit ouvertes par au moins une catégorie. */
const SECTIONS_PAR_CATEGORIE = Object.keys(CATEGORIES_PAR_SECTION_ADMIN).filter(
  (href) => CATEGORIES_PAR_SECTION_ADMIN[href].length > 0,
);
const CATEGORIES: readonly CategorieNavigation[] = [
  "entrainement",
  "suivi_eleve",
  "agenda_communication",
  "nutrition",
];

/** Un contexte staff complet, comme `useStaffContext` le rend. */
function contexte(over: Partial<{
  chargement: boolean;
  estAdmin: boolean;
  role: "admin" | "assistant" | "collaborateur" | null;
  categoriesLecture: readonly string[];
  categoriesEcriture: readonly string[];
  mecanismeIndisponible: boolean;
}> = {}) {
  return {
    chargement: false,
    estAdmin: false,
    role: null,
    categoriesLecture: [] as readonly string[],
    categoriesEcriture: [] as readonly string[],
    mecanismeIndisponible: false,
    ...over,
  };
}

const visibles = (droits: DroitsNavigationAdmin) => SECTIONS.filter((href) => sectionAdminVisible(href, droits));

/* ═══════════════ A — L'ADMINISTRATEUR NE PERD JAMAIS SON ESPACE ═══════════ */

test("A1. l'administrateur voit TOUTES les sections, dans les six états possibles du contexte", () => {
  /*
   * ⚠️ LES SIX ÉTATS, PAS SEULEMENT LE CAS NOMINAL. Le cas nominal n'a jamais
   * été cassé ; ce sont les cinq autres qui ont coûté son espace à
   * l'administrateur. Chacun correspond à une situation réelle :
   *   · lecture en cours                → premier rendu de chaque page ;
   *   · mécanisme indisponible          → migrations pas encore appliquées,
   *                                       ou lecture qui n'a pas abouti ;
   *   · aucune fiche `coaches`          → `profiles.role = 'admin'` suffit à
   *                                       être administrateur dans ce dépôt ;
   *   · aucune catégorie                → `categories_lecture()` rendait zéro
   *                                       pour un admin sans fiche ;
   *   · fiche `collaborateur`           → un administrateur à qui l'on aurait
   *                                       aussi posé une fiche restreinte.
   */
  const etats: Record<string, ReturnType<typeof contexte>> = {
    "nominal (fiche admin, quatre catégories)": contexte({
      estAdmin: true, role: "admin", categoriesLecture: CATEGORIES,
    }),
    "lecture des droits EN COURS": contexte({ chargement: true, estAdmin: true }),
    "mécanisme indisponible": contexte({ estAdmin: true, mecanismeIndisponible: true }),
    "aucune fiche coaches": contexte({ estAdmin: true, role: null, categoriesLecture: CATEGORIES }),
    "aucune catégorie": contexte({ estAdmin: true, role: null, categoriesLecture: [] }),
    "fiche collaborateur": contexte({ estAdmin: true, role: "collaborateur", categoriesLecture: [] }),
  };
  for (const [nom, etat] of Object.entries(etats)) {
    const droits = droitsNavigationDepuisContexte(etat);
    assert.deepEqual(visibles(droits), SECTIONS, `état « ${nom} » : l'administrateur perd des sections`);
  }
});

test("A2. et il les voit même sans être reconnu, tant que la lecture n'a pas abouti", () => {
  /*
   * ⚠️ LE CŒUR DE LA RÉGRESSION. Ici `estAdmin` est FAUX — l'interface ne sait
   * pas encore qui parle. Avant correction, ces deux états rendaient une
   * réponse PROPRE (« personne ») et l'espace était démonté. Ils doivent
   * rendre la navigation d'avant P13-B : afficher une section ne donne accès
   * à rien, la RLS et lib/api/authz.ts refusent de toute façon.
   */
  for (const etat of [contexte({ chargement: true }), contexte({ mecanismeIndisponible: true })]) {
    const droits = droitsNavigationDepuisContexte(etat);
    assert.deepEqual(visibles(droits), SECTIONS,
      "une lecture non aboutie ne doit jamais amputer la navigation");
  }
});

test("A3. le groupe Programmation reste ouvert à l'administrateur", () => {
  const enfants = ["/admin/programmes", "/admin/exercices", "/admin/seances"];
  for (const etat of [
    contexte({ estAdmin: true }),
    contexte({ chargement: true }),
    contexte({ mecanismeIndisponible: true }),
  ]) {
    assert.equal(groupeAdminVisible(enfants, droitsNavigationDepuisContexte(etat)), true);
  }
});

test("A4. l'administrateur n'est JAMAIS mis en lecture seule sur la programmation", () => {
  const base: ContexteDroitAffectation = {
    chargement: false, estAdmin: true, role: null, categoriesEcriture: [], mecanismeIndisponible: false,
  };
  const etats: ReadonlyArray<Partial<ContexteDroitAffectation>> = [
    {},
    { chargement: true },
    { mecanismeIndisponible: true },
    { role: "admin" },
    { role: "assistant" },
    { role: "collaborateur" },
    { categoriesEcriture: ["entrainement"] },
  ];
  for (const over of etats) {
    assert.notEqual(droitEcritureProgrammes({ ...base, ...over }), "lecture_seule",
      `un administrateur ne doit jamais être grisé (${JSON.stringify(over)})`);
  }
});

/* ═══════════════ B — LE COACH AUTONOME GARDE SES DROITS ══════════════════ */

test("B1. le coach autonome voit les quinze sections", () => {
  const droits = droitsNavigationDepuisContexte(
    contexte({ role: "assistant", categoriesLecture: CATEGORIES }),
  );
  assert.deepEqual(visibles(droits), SECTIONS);
});

test("B2. et il n'est pas mis en lecture seule", () => {
  assert.equal(
    droitEcritureProgrammes({
      chargement: false, estAdmin: false, role: "assistant",
      categoriesEcriture: [], mecanismeIndisponible: false,
    }),
    "autorisee",
    "la règle métier des catégories d'un assistant vit en SQL, elle n'est pas redéduite ici",
  );
});

test("B3. il ne reçoit PAS les privilèges globaux de l'administrateur pour autant", () => {
  /*
   * La distinction ne se joue pas dans la navigation — un coach autonome voit
   * déjà tout l'espace, et c'est le comportement d'avant P13-B — mais en base
   * et dans les routes : `/admin/parametres` ne lui rend aucune ligne de
   * `coaches` (is_admin()), et les routes d'administration passent par
   * `requireAdmin()`. Les contrôles D11 à D14 de la matrice SQL le mesurent.
   */
  const matrice = lire("supabase/tests/matrice_roles_admin_coach_collaborateur.sql");
  assert.ok(/D11\. PARAMÈTRES \(coaches\) : AUCUNE ligne/.test(matrice),
    "la matrice SQL doit mesurer que les paramètres restent fermés au coach autonome");
  // ⚠️ APOSTROPHES DOUBLÉES : ces libellés sont des chaînes SQL.
  assert.ok(/D13\. création d''une offre d''abonnement : REFUSÉE/.test(matrice));
  for (const route of [
    "app/api/admin/subscription-templates/route.ts",
    "app/api/admin/newsletter/resync/route.ts",
  ]) {
    assert.ok(/await requireAdmin\(\)/.test(lire(route)), `${route} doit rester réservée à l'administrateur`);
  }
});

/* ═══════════════ C — LE COLLABORATEUR RESTE CLOISONNÉ ════════════════════ */

test("C1. collaborateur : les six rubriques globales restent invisibles, quelles que soient ses catégories", () => {
  // Les seize combinaisons des quatre catégories.
  for (let masque = 0; masque < 16; masque += 1) {
    const categoriesLecture = CATEGORIES.filter((_, i) => (masque & (1 << i)) !== 0);
    const droits = droitsNavigationDepuisContexte(contexte({ role: "collaborateur", categoriesLecture }));
    for (const href of SECTIONS_GLOBALES) {
      assert.equal(sectionAdminVisible(href, droits), false,
        `${href} ne doit jamais s'ouvrir à un collaborateur (catégories : ${categoriesLecture.join(",") || "aucune"})`);
    }
  }
});

test("C2. collaborateur : il voit exactement les sections de ses catégories", () => {
  for (const categorie of CATEGORIES) {
    const droits = droitsNavigationDepuisContexte(
      contexte({ role: "collaborateur", categoriesLecture: [categorie] }),
    );
    const attendues = SECTIONS_PAR_CATEGORIE.filter((href) =>
      CATEGORIES_PAR_SECTION_ADMIN[href].includes(categorie),
    );
    assert.deepEqual(visibles(droits), ["/admin", ...attendues],
      `catégorie ${categorie} : la navigation ne correspond pas à ses droits`);
  }
});

test("C3. collaborateur sans aucune catégorie : l'accueil, et rien d'autre", () => {
  const droits = droitsNavigationDepuisContexte(contexte({ role: "collaborateur", categoriesLecture: [] }));
  assert.deepEqual(visibles(droits), ["/admin"]);
});

test("C4. collaborateur sans `entrainement` en écriture : la programmation est en lecture seule", () => {
  assert.equal(
    droitEcritureProgrammes({
      chargement: false, estAdmin: false, role: "collaborateur",
      categoriesEcriture: ["nutrition", "suivi_eleve"], mecanismeIndisponible: false,
    }),
    "lecture_seule",
  );
  assert.equal(
    droitEcritureProgrammes({
      chargement: false, estAdmin: false, role: "collaborateur",
      categoriesEcriture: ["entrainement"], mecanismeIndisponible: false,
    }),
    "autorisee",
  );
});

test("C5. et le cloisonnement du collaborateur est mesuré EN BASE, pas seulement ici", () => {
  const matrice = lire("supabase/tests/matrice_roles_admin_coach_collaborateur.sql");
  for (const controle of [
    "E8. programme : UPDATE REFUSÉ",
    "E10. fiche de SON élève : UPDATE REFUSÉ",
    "F6. élève hors périmètre : UPDATE REFUSÉ",
    "F7. affectation principale de son élève : la valeur n''a PAS changé",
    "F9. il ne se donne pas une fiche admin",
    "F10. il ne devient pas administrateur dans profiles",
    "G1. dix surfaces globales et administratives : AUCUNE ligne",
  ]) {
    assert.ok(matrice.includes(controle), `le contrôle « ${controle} » manque à la matrice SQL`);
  }
  // ⚠️ ET LA VALEUR, PAS LE row_count : deux déclencheurs recopient
  // l'ancienne valeur au lieu de lever, et un contrôle qui compterait les
  // lignes touchées conclurait à tort.
  assert.ok(/ON MESURE LA VALEUR, PAS LE NOMBRE DE LIGNES TOUCHÉES/.test(matrice));
});

/* ═════════ D — « NE PAS SAVOIR » N'EST PLUS UNE RÉPONSE ══════════════════ */

test("D1. useStaffContext : toute lecture non aboutie rend l'état indéterminé", () => {
  const source = lire("hooks/useStaffContext.ts");
  assert.ok(/const INDETERMINE: StaffContext = \{ \.\.\.ETAT_INCONNU, mecanismeIndisponible: true \}/.test(source),
    "l'état « on ne sait pas » doit être explicite et distinct de « personne »");
  // Client absent, session absente, rejet : les trois rendent INDETERMINE.
  assert.ok(/if \(!supabase\) \{\s*return INDETERMINE;/.test(source), "client navigateur absent");
  assert.ok(/if \(!userId\) \{\s*return INDETERMINE;/.test(source), "session pas encore réhydratée");
  assert.ok(/if \(!annule\) setEtat\(INDETERMINE\)/.test(source), "rejet de la promesse");
  // …et TOUTE erreur de lecture, pas seulement la fonction absente.
  assert.ok(/const lectureIncertaine =[\s\S]{0,400}?profil\.error != null[\s\S]{0,400}?ecritureRpc\.error != null;/.test(source),
    "les cinq lectures doivent compter, pas seulement les RPC de P13-B");
  assert.ok(/if \(lectureIncertaine\) \{[\s\S]{0,600}?return INDETERMINE;/.test(source));
});

test("D2. et une non-réponse n'est pas mise en cache", () => {
  /*
   * ⚠️ C'EST CE QUI RENDAIT LE DÉFAUT PERMANENT. Le cache est au niveau du
   * module et n'a volontairement aucune invalidation ; un état indéterminé qui
   * s'y installait figeait la navigation amputée pour toute la session.
   */
  const source = lire("hooks/useStaffContext.ts");
  assert.ok(/if \(resultat\.mecanismeIndisponible\) \{\s*lectureEnCours = null;/.test(source),
    "un résultat indéterminé doit libérer le cache");
  assert.ok(/\.catch\(\(erreur\) => \{\s*lectureEnCours = null;/.test(source),
    "un rejet aussi");
});

test("D3. la conversion contexte → droits n'existe qu'en UN endroit", () => {
  /*
   * ⚠️ DEUX COPIES, DEUX VÉRITÉS. `AdminSidebar` neutralisait le chargement,
   * `app/admin/page.tsx` l'avait oublié : l'administrateur gardait son menu et
   * perdait la vitrine Paiements de son accueil. La règle est désormais dans
   * `droitsNavigationDepuisContexte`, et les deux appelants l'utilisent.
   */
  for (const fichier of ["components/admin/AdminSidebar.tsx", "app/admin/page.tsx"]) {
    const source = lire(fichier);
    assert.ok(/droitsNavigationDepuisContexte\(staff\)/.test(source),
      `${fichier} doit passer par la conversion partagée`);
    assert.ok(!/roleStaff: staff\.role/.test(source),
      `${fichier} ne doit plus recopier la conversion à la main`);
  }
  const regle = lire("lib/admin-shell-nav.ts");
  assert.ok(/if \(droits\.chargement\) return true;/.test(regle),
    "le chargement doit être traité DANS la règle, où aucun appelant ne peut l'oublier");
});

test("D4. fichesStaff : une lecture en erreur ne vaut pas « aucune fiche »", () => {
  /*
   * Le défaut était symétrique du précédent, et du mauvais côté : l'erreur
   * était ignorée, `lignes` devenait vide, `estCollaborateur` rendait false —
   * une panne de lecture OUVRAIT les rubriques globales à un collaborateur.
   */
  const source = lire("lib/api/authz.ts");
  assert.ok(/const \{ data, error \} = await supabase\s*\.from\("coaches"\)/.test(source),
    "l'erreur de lecture doit être récupérée");
  assert.ok(/if \(error\) \{[\s\S]{0,300}?return "indisponible";/.test(source),
    "et traduite en verdict indéterminable");
  // Tous les appelants traduisent « indisponible » en refus.
  assert.equal((source.match(/if \(fiches === "indisponible"\) return refus\(/g) ?? []).length >= 2, true);
  assert.ok(/verdict === "indisponible"/.test(lire("lib/supabase/guards.ts")),
    "et le layout refuse aussi");
});

/* ═════════ E — LA CHAÎNE COMPLÈTE, RUBRIQUE PAR RUBRIQUE ════════════════ */

test("E1. les six rubriques globales : lien masqué ET garde serveur ET refus en base", () => {
  // 1. le lien : contrôle C1 ci-dessus.
  // 2. la page par URL directe : un layout Server Component.
  const gardees = ["/admin/paiements", "/admin/emails", "/admin/notifications",
                   "/admin/abonnements", "/admin/newsletter"];
  for (const href of gardees) {
    const source = lire(`app${href}/layout.tsx`);
    assert.ok(/await interdireCollaborateur\(\)/.test(source), `app${href}/layout.tsx : garde absente`);
  }
  // `/admin/parametres` est la sixième : elle est fermée en BASE par is_admin()
  // sur `coaches` et `profiles`, ce que la matrice SQL mesure (D11). Lui
  // ajouter `interdireCollaborateur()` ne changerait rien pour un
  // collaborateur et romprait l'accès du coach autonome, qui y gère son
  // propre profil.
  assert.ok(/D11\. PARAMÈTRES/.test(lire("supabase/tests/matrice_roles_admin_coach_collaborateur.sql")));
  // 3. les données : refus en base, mesuré.
  assert.ok(/G1\. dix surfaces globales/.test(lire("supabase/tests/matrice_roles_admin_coach_collaborateur.sql")));
});

test("E2. la matrice SQL couvre les cinq profils et les deux sens de la mesure", () => {
  const matrice = lire("supabase/tests/matrice_roles_admin_coach_collaborateur.sql");
  for (const acteur of [
    "admin + fiche admin", "admin SANS fiche coaches", "coach autonome (assistant)",
    "collaborateur LECTURE", "collaborateur ÉCRITURE",
  ]) {
    assert.ok(matrice.includes(acteur), `l'acteur « ${acteur} » manque`);
  }
  // Ce qu'un rôle PEUT faire est mesuré autant que ce qu'il ne peut pas.
  assert.ok(/B18\. programmation : INSERT … RETURNING accepté/.test(matrice));
  assert.ok(/C11\. fiche élève : UPDATE accepté \(était refusé\)/.test(matrice));
  assert.ok(/C15\. il met un élève en pause \(la valeur CHANGE vraiment\)/.test(matrice));
});

test("E3. la migration corrective nomme sa cause et n'élargit que l'administrateur", () => {
  const migration = lire("supabase/migrations/20261019090000_p13b_admin_reel_categories.sql");
  /*
   * ⚠️ LES COMMENTAIRES SONT RETIRÉS AVANT MESURE. L'en-tête explique
   * qu'aucun GRANT n'est touché : le mot « GRANT » y figure, et le contrôle
   * « aucun grant » échouait sur sa propre explication.
   */
  const compact = migration
    .replace(/^\s*--.*$/gm, "")
    .replace(/\s+/g, " ");
  // Les quatre objets corrigés.
  for (const objet of [
    "public.categories_lecture()", "public.categories_ecriture()",
    "public.protect_students_ownership_columns()", "public.protect_student_profiles_access_columns()",
  ]) {
    assert.ok(compact.includes(`create or replace function ${objet}`), `${objet} n'est pas corrigée`);
  }
  // La branche collaborateur est conservée à l'identique dans les deux fonctions.
  assert.equal((compact.match(/public\.staff_role\(\) = 'collaborateur'/g) ?? []).length, 2,
    "la branche collaborateur doit rester dans les deux fonctions de catégorie");
  assert.ok(/and p\.niveau = 'ecriture'/.test(compact),
    "categories_ecriture() doit continuer de filtrer le niveau");
  // Les sept colonnes d'accès et les quatre colonnes de propriété restent protégées.
  for (const colonne of ["new.coach_id := old.coach_id", "new.status := old.status",
                         "new.user_id := old.user_id", "new.access_type := old.access_type",
                         "new.assigned_subscription_template_id := old.assigned_subscription_template_id"]) {
    assert.ok(compact.includes(colonne), `la protection de ${colonne} a disparu`);
  }
  // Aucune policy, aucune table, aucun GRANT ne bouge.
  assert.ok(!/create policy|drop policy|alter table|create table|grant |revoke /i.test(compact),
    "cette migration ne doit toucher que quatre fonctions");
});

console.log(`\n${passed} test(s) réussi(s), ${failed} échec(s).`);
if (failed > 0) process.exit(1);
