/**
 * P13-B — LES TROIS RUBRIQUES GLOBALES, ET LES DEUX MESSAGES DE REFUS.
 *
 *   npm run test:rubriques-globales
 *
 * ════════════════════════════════════════════════════════════════════════
 * CE QUE CETTE SUITE COUVRE
 * ════════════════════════════════════════════════════════════════════════
 * A. Le message affiché quand un collaborateur sans écriture enregistre un
 *    plan nutritionnel — le code `PLAN_NOT_FOUND_OR_FORBIDDEN` ne doit plus
 *    traverser l'écran, et le texte ne doit pas dire si le plan existe.
 * B. Le même refus côté entraînement, avec la MÊME formulation : l'ancien
 *    message demandait de se reconnecter en administrateur.
 * C. Paiements, Emails et Notifications : navigation, URL directe, routes
 *    d'API. L'interdiction porte sur le RÔLE, jamais sur une catégorie.
 * D. Le tableau de bord garde ses compteurs d'élèves ; seules les vitrines
 *    des rubriques fermées disparaissent.
 *
 * ⚠️ LA PREUVE EN BASE EST AILLEURS. La section M de
 * supabase/tests/p13b_roles_collaborateurs_checklist.sql mesure, dans la
 * session d'un vrai collaborateur, qu'aucune des quatorze tables de ces
 * rubriques ne rend la moindre ligne. Ces tests-ci vérifient le CÂBLAGE —
 * ils ne remplacent pas la mesure.
 */

import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

import {
  estRefusAutorisationTechnique,
  messageRefusAutorisation,
  messageUtilisateurOuBrut,
  MESSAGE_REFUS_PLAN_NUTRITION,
  MESSAGE_REFUS_PROGRAMME,
} from "../../lib/messages-autorisation";
import { builderSaveUserMessage } from "../../lib/admin-builder-save";
import { sectionAdminVisible, CATEGORIES_PAR_SECTION_ADMIN } from "../../lib/admin-shell-nav";

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

/*
 * ⚠️ LES CINQ RUBRIQUES GLOBALES, PAS TROIS. `/admin/abonnements` et
 * `/admin/newsletter` étaient masquées en navigation mais n'avaient aucune
 * garde serveur : taper l'URL affichait la page. Les ajouter ici fait porter
 * les contrôles C1 à C4 sur elles aussi, sans dupliquer la règle.
 */
const RUBRIQUES = [
  "/admin/paiements",
  "/admin/emails",
  "/admin/notifications",
  "/admin/abonnements",
  "/admin/newsletter",
] as const;
const CATEGORIES = ["entrainement", "suivi_eleve", "agenda_communication", "nutrition"] as const;

/* ═════════════════════ A — MESSAGE NUTRITION ═════════════════════ */

test("A1. le code technique ne traverse plus l'écran", () => {
  const traduit = messageRefusAutorisation("PLAN_NOT_FOUND_OR_FORBIDDEN", "plan");
  assert.equal(traduit, MESSAGE_REFUS_PLAN_NUTRITION);
  assert.equal(traduit, "Vous n'avez pas les autorisations nécessaires pour modifier ce plan.");
  for (const interdit of ["PLAN_NOT_FOUND", "FORBIDDEN", "42501", "RLS", "policy", "SQL", "nutrition_plans"]) {
    assert.ok(!traduit!.includes(interdit), `le message ne doit pas contenir « ${interdit} »`);
  }
});

test("A2. le message ne dit NI que le plan existe, NI qu'il n'existe pas", () => {
  /*
   * ⚠️ LA CONFUSION EST VOULUE. `PLAN_NOT_FOUND_OR_FORBIDDEN` couvre les deux
   * cas, ce qui empêche la RPC de servir d'oracle d'existence. Le message
   * affiché doit conserver cette confusion : il parle de DROITS, pas de la
   * cible.
   */
  const m = MESSAGE_REFUS_PLAN_NUTRITION;
  for (const interdit of ["existe", "introuvable", "n'existe pas", "supprimé", "trouvé"]) {
    assert.ok(!m.toLowerCase().includes(interdit.toLowerCase()),
      `le message ne doit pas évoquer l'existence (« ${interdit} »)`);
  }
  assert.ok(/autorisations/i.test(m), "il doit nommer la cause : des droits manquants");
});

test("A3. le code technique RESTE utilisable en interne", () => {
  // La consigne : utilisable en interne, pas affiché. Le reconnaisseur doit
  // donc continuer à le voir passer.
  assert.equal(estRefusAutorisationTechnique("PLAN_NOT_FOUND_OR_FORBIDDEN"), true);
  // Et la RPC continue de le lever : la règle SQL n'est pas touchée.
  const migration = lire("supabase/migrations/20260812090000_save_nutrition_plan_v2_full.sql");
  assert.ok(/raise exception 'PLAN_NOT_FOUND_OR_FORBIDDEN'/.test(migration),
    "la RPC doit toujours lever le code : on traduit l'affichage, on ne desserre pas la garde");
});

test("A4. l'enregistrement nutrition traduit, et ne traduit QUE les refus", () => {
  const source = lire("lib/supabase/nutrition-v2.ts");
  assert.ok(/messageUtilisateurOuBrut\(error\.message, "plan"\)/.test(source),
    "la RPC nutrition doit traduire son message d'erreur");
  assert.ok(/devWarn\("saveNutritionPlanV2 \(RPC\)", error\)/.test(source),
    "et conserver le message d'origine en console");
  // ⚠️ UNE PANNE N'EST PAS UN REFUS. La traduire masquerait le vrai problème.
  assert.equal(messageRefusAutorisation("could not connect to server", "plan"), null);
  assert.equal(messageUtilisateurOuBrut("could not connect to server", "plan"), "could not connect to server");
});

/* ═════════════════════ B — MESSAGE ENTRAÎNEMENT ═════════════════════ */

test("B1. le refus d'entraînement emploie la MÊME formulation que la nutrition", () => {
  const message = builderSaveUserMessage({ kind: "error", error: new Error("NOT_AUTHORIZED") });
  assert.equal(message, MESSAGE_REFUS_PROGRAMME);
  assert.equal(message, "Vous n'avez pas les autorisations nécessaires pour modifier ce programme.");
  // Les deux textes ne diffèrent que par le mot final.
  assert.equal(
    MESSAGE_REFUS_PLAN_NUTRITION.replace("ce plan.", ""),
    MESSAGE_REFUS_PROGRAMME.replace("ce programme.", ""),
  );
});

test("B2. l'ancien message — « reconnecte-toi en admin » — a disparu", () => {
  /*
   * ⚠️ IL POSAIT UN DIAGNOSTIC FAUX. Depuis P13-B, le cas courant n'est pas
   * une session perdue mais un collaborateur sans `entrainement / ecriture` :
   * se reconnecter ne lui donnera jamais ce droit.
   */
  /*
   * ⚠️ LE CONTRÔLE PORTE SUR LE CODE, PAS SUR LES COMMENTAIRES. Le correctif
   * CITE l'ancien message pour expliquer pourquoi il disparaît ; une recherche
   * naïve dans le fichier trouvait ce rappel et déclarait l'échec — un contrôle
   * qui mesure le mauvais texte.
   */
  const source = lire("lib/admin-builder-save.ts");
  const sansCommentaires = source
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .split("\n")
    .map((l) => l.replace(/\/\/.*$/, ""))
    .join("\n");
  assert.ok(/builderSaveUserMessage/.test(sansCommentaires),
    "le découpage doit conserver la fonction elle-même");
  for (const interdit of ["droits coach", "Reconnecte-toi", "compte élève connecté"]) {
    assert.ok(!sansCommentaires.includes(interdit),
      `« ${interdit} » ne doit plus figurer dans un message affiché`);
  }
  // Et le message rendu ne les contient pas davantage.
  const rendu = builderSaveUserMessage({ kind: "error", error: new Error("NOT_AUTHORIZED") }) ?? "";
  for (const interdit of ["droits coach", "Reconnecte", "admin"]) {
    assert.ok(!rendu.includes(interdit), `le message affiché ne doit pas contenir « ${interdit} »`);
  }
  for (const code of ["NOT_AUTHORIZED", "42501", "SAVE_FAILED"]) {
    assert.equal(
      builderSaveUserMessage({ kind: "error", error: new Error(code) }),
      MESSAGE_REFUS_PROGRAMME,
      `${code} doit produire le message de refus`,
    );
  }
});

test("B3. les autres issues du builder gardent leur message", () => {
  // ⚠️ NE PAS TRADUIRE CE QUI N'EST PAS UN REFUS : « structure incomplète » et
  // « séance modifiée » ont leur propre cause et leur propre remède.
  const stale = builderSaveUserMessage({ kind: "stale" } as never);
  assert.ok(stale && /recharge la page/i.test(stale), "le cas STALE garde son message");
  const structure = builderSaveUserMessage({
    kind: "error",
    error: new Error("STRUCTURE_INCOMPLETE : 2 séance(s) non écrite(s)"),
  });
  assert.ok(structure && /n'a pas pu être enregistrée/i.test(structure),
    "une structure incomplète n'est pas un refus de droits");
  assert.notEqual(structure, MESSAGE_REFUS_PROGRAMME);
});

/* ═════════════════════ C — LES TROIS RUBRIQUES ═════════════════════ */

function droits(role: "admin" | "assistant" | "collaborateur" | null, categories: readonly string[] = []) {
  return {
    estAdmin: false,
    roleStaff: role,
    categoriesLecture: categories as never,
    mecanismeIndisponible: false,
  };
}

test("C1. navigation : les cinq rubriques sont masquées au collaborateur, QUELLES QUE SOIENT ses catégories", () => {
  // ⚠️ TOUTES LES COMBINAISONS, PAS SEULEMENT L'ENSEMBLE VIDE. La consigne
  // exige qu'aucun niveau de permission existant ne puisse les rouvrir.
  const combinaisons: string[][] = [[]];
  for (const c of CATEGORIES) {
    for (const base of [...combinaisons]) combinaisons.push([...base, c]);
  }
  assert.equal(combinaisons.length, 16, "les 16 combinaisons des quatre catégories");
  for (const categories of combinaisons) {
    for (const href of RUBRIQUES) {
      assert.equal(
        sectionAdminVisible(href, droits("collaborateur", categories)),
        false,
        `${href} visible avec les catégories [${categories.join(", ")}]`,
      );
    }
  }
});

test("C2. et la table des sections ne leur donne aucune catégorie", () => {
  for (const href of RUBRIQUES) {
    assert.deepEqual(CATEGORIES_PAR_SECTION_ADMIN[href], [],
      `${href} ne doit être ouverte par AUCUNE catégorie`);
  }
});

test("C3. l'administrateur et l'assistant gardent les cinq rubriques", () => {
  for (const href of RUBRIQUES) {
    assert.equal(sectionAdminVisible(href, droits("assistant")), true, `${href} fermée à l'assistant`);
    assert.equal(sectionAdminVisible(href, { ...droits(null), estAdmin: true }), true,
      `${href} fermée à l'administrateur`);
  }
});

test("C4. URL directe : chaque rubrique porte une garde SERVEUR", () => {
  /*
   * ⚠️ UN LIEN MASQUÉ N'EST PAS UNE INTERDICTION. La page est un Client
   * Component : elle ne peut pas refuser avant de s'afficher. Le layout est un
   * Server Component — c'est le seul endroit où « taper l'URL » s'arrête.
   */
  for (const href of RUBRIQUES) {
    const chemin = `app${href}/layout.tsx`;
    const source = lire(chemin);
    assert.ok(/await interdireCollaborateur\(\)/.test(source),
      `${chemin} : la garde serveur manque`);
    assert.ok(!/"use client"/.test(source),
      `${chemin} : un Client Component ne peut pas refuser avant le rendu`);
  }
});

test("C5. la garde serveur refuse sur le RÔLE, et échoue fermée", () => {
  const source = lire("lib/supabase/guards.ts");
  assert.ok(/export async function interdireCollaborateur\(\)/.test(source));
  assert.ok(/estCollaborateurConnecte/.test(source),
    "elle doit réutiliser la lecture de rôle de lib/api/authz.ts, pas en inventer une seconde");
  assert.ok(/verdict === "indisponible"[\s\S]{0,200}?redirect\("\/acces-refuse"\)/.test(source),
    "un verdict indéterminable doit refuser : une panne de configuration n'ouvre pas une porte");
  // ⚠️ AUCUNE CATÉGORIE DANS CETTE GARDE : la rubrique n'est pas rouvrable.
  for (const c of CATEGORIES) {
    assert.ok(!new RegExp(`interdireCollaborateur[\\s\\S]{0,900}?${c}`).test(source),
      `la garde ne doit pas dépendre de la catégorie ${c}`);
  }
});

test("C6. API : aucune route de ces rubriques n'est ouverte à un collaborateur", () => {
  /*
   * `requireStaff()` refuse explicitement un collaborateur
   * (`if (fiches.estCollaborateur) return refus(...)`). `requireAdmin()` est
   * plus étroit encore. Toute route de ces rubriques doit passer par l'un ou
   * l'autre AVANT tout contrôle par élève.
   */
  const authz = lire("lib/api/authz.ts");
  assert.ok(/if \(fiches\.estCollaborateur\) return refus\("Accès refusé\.", 403\)/.test(authz),
    "requireStaff() doit refuser un collaborateur");

  const routes = [
    "app/api/admin/billing/payments/[id]/route.ts",
    "app/api/admin/billing/subscriptions/[id]/route.ts",
    "app/api/admin/emails/[id]/resend/route.ts",
    "app/api/admin/notifications/audience/route.ts",
    "app/api/admin/notifications/campaigns/route.ts",
    "app/api/admin/notifications/campaigns/[id]/route.ts",
    "app/api/admin/notifications/test/route.ts",
  ];
  for (const route of routes) {
    const source = lire(route);
    assert.ok(/await requireStaff\(\)|await requireAdmin\(\)/.test(source),
      `${route} : aucune garde fermée aux collaborateurs`);
  }
});

test("C7. /api/admin/notifications/test était la seule route ouverte — elle ne l'est plus", () => {
  /*
   * ⚠️ ELLE ÉTAIT GARDÉE PAR `agenda_communication`, donc accessible à un
   * collaborateur ayant cette catégorie : il pouvait compter les appareils
   * d'un élève depuis une rubrique qui ne lui est pas ouverte. Le contrôle
   * d'appartenance par élève RESTE derrière.
   */
  const source = lire("app/api/admin/notifications/test/route.ts");
  assert.equal((source.match(/await requireStaff\(\)/g) ?? []).length, 2,
    "le GET et le POST doivent tous deux fermer la rubrique");
  assert.ok(/requireStaff\(\)[\s\S]{0,300}?requireStaffForStudent\(/.test(source),
    "la rubrique se ferme AVANT la vérification de portée");
  assert.ok(/categorie: "agenda_communication"/.test(source),
    "et la vérification de portée par catégorie n'est pas supprimée pour autant");
});

/* ═════════════════════ D — LE TABLEAU DE BORD ═════════════════════ */

test("D1. les compteurs d'élèves sont conservés", () => {
  const source = lire("app/admin/page.tsx");
  for (const label of ["Élèves actifs", "Élèves en pause", "Programmes actifs", "Plans alimentaires actifs"]) {
    assert.ok(source.includes(label), `le compteur « ${label} » doit rester`);
  }
  // ⚠️ AUCUN RECALCUL ARBITRAIRE : les compteurs restent ceux des listes
  // chargées, bornées par la RLS aux élèves autorisés.
  assert.ok(/value=\{activeStudents\.length\}/.test(source));
  assert.ok(/value=\{pausedStudents\.length\}/.test(source));
});

test("D2. la vitrine financière et le composeur disparaissent pour un collaborateur", () => {
  const source = lire("app/admin/page.tsx");
  assert.ok(/const facturationVisible = sectionAdminVisible\("\/admin\/paiements", droitsNavigation\)/.test(source),
    "le bloc financier doit suivre la visibilité de la rubrique Paiements");
  assert.ok(/const notificationsVisibles = sectionAdminVisible\("\/admin\/notifications", droitsNavigation\)/.test(source),
    "le composeur doit suivre la visibilité de la rubrique Notifications");
  assert.ok(/\{facturationVisible && \([\s\S]{0,600}?Revenu mensuel estimé/.test(source),
    "« Revenu mensuel estimé » ne doit s'afficher que si la rubrique est ouverte");
  assert.ok(/\{notificationsVisibles && <NotificationComposer/.test(source),
    "le composeur de campagnes doit être conditionné");
  // ⚠️ LE CENTRE D'ACTIVITÉ RESTE : il lit activity_events (suivi d'élève),
  // pas la rubrique Notifications.
  assert.ok(/<DashboardNotifications/.test(source),
    "le centre d'activité ne doit pas être emporté");
  assert.ok(!/\{notificationsVisibles && <DashboardNotifications/.test(source),
    "et il ne doit pas être conditionné par la rubrique Notifications");
});

test("D3. la règle d'affichage du tableau de bord est celle de la navigation", () => {
  // Une seule source : si le menu masque la section, sa vitrine disparaît, et
  // les deux ne peuvent pas diverger.
  const source = lire("app/admin/page.tsx");
  assert.ok(/from "@\/lib\/admin-shell-nav"/.test(source),
    "le tableau de bord doit réutiliser sectionAdminVisible, pas réécrire la règle");
});

/* ═════════════════════ E — LA CHECKLIST MESURE EN BASE ═════════════════════ */

test("E1. la checklist SQL couvre les quatorze tables et les deux fuites", () => {
  const checklist = lire("supabase/tests/p13b_roles_collaborateurs_checklist.sql");
  for (const n of ["M1.", "M5.", "M7.", "M8.", "M10.", "M11.", "M12.", "M15.", "M16.", "M17.",
                   // La fuite résiduelle de prix : les trois colonnes, une par une,
                   // le filtre, le `select *`, les deux fonctions d'accès, le
                   // balayage de toutes les colonnes de prix du schéma, et la
                   // non-régression de l'élève, de l'assistant et de l'administrateur.
                   "M18.", "M19.", "M20.", "M21.", "M22.", "M23.", "M24.", "M25.",
                   "M26.", "M27.", "M28.", "M29.", "M30.", "M31.", "M32.", "M33."]) {
    assert.ok(checklist.includes(n), `le contrôle ${n} manque`);
  }
  assert.ok(/CIBLES de campagne/.test(checklist), "la fuite des cibles doit être épinglée");
  assert.ok(/le prix par jointure n''est pas vide : il est REFUSÉ/.test(checklist),
    "la fuite du prix par jointure doit être épinglée");
  // ⚠️ ET LE BALAYAGE, qui est le seul contrôle à répondre vraiment à la
  // consigne : AUCUNE colonne de prix du schéma ne rend de valeur au
  // collaborateur le mieux doté.
  assert.ok(/AUCUNE colonne de prix\/offre du schéma ne rend de valeur/.test(checklist),
    "le balayage de toutes les colonnes de prix doit être dans la checklist");
  assert.ok(/UN REFUS REND -1, JAMAIS 0/.test(checklist),
    "un refus et une absence de ligne ne doivent pas être confondus");
  // ⚠️ L'ACTEUR DOIT ÊTRE LE MIEUX DOTÉ POSSIBLE, sinon le test ne prouve rien.
  assert.ok(/LES QUATRE CATÉGORIES, EN ÉCRITURE/.test(checklist));
  // Et le maintien de l'agenda est mesuré dans le même mouvement.
  assert.ok(/indisponibilités du coach de son élève/.test(checklist));
});

/* ════════════════════ F — LA FUITE DE PRIX, FERMÉE EN BASE ════════════════
 *
 * ⚠️ CE QUE CES TESTS NE PROUVENT PAS. Ils lisent du texte : la migration, le
 * code. La preuve qu'un collaborateur ne lit RIEN est en base — section M de
 * supabase/tests/p13b_roles_collaborateurs_checklist.sql, contrôles M18 à
 * M32, dont le balayage M25 qui interroge toutes les colonnes de prix du
 * schéma dans sa session. Ces tests-ci vérifient que le correctif ne peut pas
 * être défait par inadvertance dans le dépôt.
 * ════════════════════════════════════════════════════════════════════════ */

const MIGRATION_PRIX = lire("supabase/migrations/20261018090000_p13b_rubriques_globales_collaborateur.sql");
const COLONNES_ATTRIBUTION = [
  "assigned_subscription_template_id",
  "assigned_stripe_plan",
  "assigned_stripe_price_id",
] as const;

test("F1. les TROIS colonnes d'attribution sont fermées, pas seulement la référence", () => {
  /*
   * ⚠️ FERMER LA SEULE `assigned_subscription_template_id` AURAIT LAISSÉ LA
   * FUITE OUVERTE. `assigned_stripe_plan` est le NOM de l'offre, recopié du
   * catalogue : il suffit à lui seul pour lire le prix sur la vitrine
   * publique, sans aucun identifiant technique.
   */
  const compact = MIGRATION_PRIX.replace(/\s+/g, " ");
  for (const col of COLONNES_ATTRIBUTION) {
    assert.ok(new RegExp(`'${col}'`).test(compact), `${col} n'est pas dans la liste des colonnes fermées`);
  }
  assert.ok(/revoke select on public\.student_profiles from authenticated, anon/.test(compact),
    "le privilège de TABLE doit partir d'abord : un privilège de table implique toutes ses colonnes");
  assert.ok(/grant select \(%s\) on public\.student_profiles to authenticated, anon/.test(compact),
    "…puis tout le reste doit revenir, colonne par colonne");
});

test("F2. la liste des colonnes rendues est CONSTRUITE, jamais recopiée à la main", () => {
  /*
   * Une liste recopiée serait fausse à la première migration qui ajoute une
   * colonne : la nouvelle colonne n'aurait aucun privilège, et la fiche élève
   * entière tomberait en 42501. Elle est donc lue dans le catalogue au moment
   * de l'application, et la vérification finale recompte.
   */
  const compact = MIGRATION_PRIX.replace(/\s+/g, " ");
  assert.ok(/string_agg\(quote_ident\(column_name\), ', ' order by ordinal_position\)/.test(compact),
    "la liste doit venir de information_schema.columns");
  assert.ok(/% colonne\(s\) non sensible\(s\) de student_profiles ont perdu la lecture/.test(compact),
    "et la migration doit refuser de s'appliquer si une colonne légitime a été oubliée");
});

test("F3. la vue de lecture s'évalue avec les droits de l'APPELANT", () => {
  /*
   * ⚠️ SANS `security_invoker`, UNE VUE S'EXÉCUTE AVEC LES DROITS DE SON
   * PROPRIÉTAIRE. Elle contournerait la RLS de `student_profiles` : chaque
   * collaborateur lirait la fiche de TOUS les élèves. Ce serait pire que la
   * fuite qu'on ferme.
   */
  const compact = MIGRATION_PRIX.replace(/\s+/g, " ");
  assert.ok(/create view public\.student_profiles_lisible with \(security_invoker = true\)/.test(compact),
    "la vue doit être en security_invoker");
  assert.ok(/n''est pas en security_invoker/.test(compact),
    "et la migration doit refuser de s'appliquer si l'option disparaît");
});

test("F4. service_role n'est pas touché — webhooks et emails intacts", () => {
  const compact = MIGRATION_PRIX.replace(/\s+/g, " ");
  assert.ok(!/revoke select on public\.student_profiles from [^;]*service_role/.test(compact),
    "retirer la table à service_role casserait les webhooks Stripe et les emails");
  assert.ok(/service_role a perdu une colonne d''attribution/.test(compact),
    "et la vérification finale doit le contrôler");
  // Les deux fonctions d'accès reconnaissent le serveur, sinon l'email
  // d'attribution d'offre et la suppression d'offre tombent en 42501.
  assert.ok(/coalesce\(auth\.role\(\), ''\) = 'service_role'/.test(compact),
    "les fonctions d'accès doivent reconnaître service_role");
});

test("F5. plus aucune lecture applicative ne cite les trois colonnes", () => {
  /*
   * ⚠️ LE PRIVILÈGE DE COLONNE S'APPLIQUE PARTOUT OÙ LA COLONNE EST CITÉE,
   * `where` compris. Une requête oubliée ne « voit » pas moins : elle tombe
   * en 42501, pour l'administrateur comme pour les autres.
   */
  const fichiers = [
    "lib/supabase/students.ts",
    "lib/supabase/billing.ts",
    "lib/supabase/subscription-templates.ts",
    "lib/supabase/physiologie.ts",
    "lib/supabase/onboarding.ts",
    "hooks/useSupabaseMyAccess.ts",
  ];
  for (const fichier of fichiers) {
    const source = lire(fichier)
      // Les commentaires expliquent précisément quelles colonnes sont
      // fermées : ils doivent pouvoir les nommer.
      .replace(/\/\*[\s\S]*?\*\//g, "")
      .replace(/^\s*\/\/.*$/gm, "");
    for (const col of COLONNES_ATTRIBUTION) {
      assert.ok(!source.includes(col), `${fichier} cite encore ${col} — la requête tomberait en 42501`);
    }
  }
  // L'écriture, elle, reste permise au staff : seule la LECTURE était la fuite.
  assert.ok(lire("lib/supabase/student-access.ts").includes("assigned_subscription_template_id"),
    "l'attribution par l'administrateur doit rester possible (privilège d'UPDATE, inchangé)");
});

test("F6. `select *` sur student_profiles passe par la vue", () => {
  for (const fichier of ["lib/supabase/students.ts", "lib/supabase/physiologie.ts"]) {
    const source = lire(fichier);
    assert.ok(!/from\("student_profiles"\)\s*(\/\/[^\n]*\n\s*)*\.select\("\*"\)/.test(source),
      `${fichier} : un \`select *\` sur la table tomberait en 42501`);
    assert.ok(/from\("student_profiles_lisible"\)/.test(source),
      `${fichier} : la lecture doit passer par la vue`);
  }
});

test("F7. l'attribution se lit par une seule porte, et un refus n'y est pas une erreur", () => {
  const source = lire("lib/supabase/attribution-offre.ts");
  assert.ok(/supabase\.rpc\("attribution_offre_eleve", parametres\)/.test(source),
    "une seule fonction appelle la RPC");
  assert.ok(/if \(error\) \{[\s\S]{0,300}?return \[\];/.test(source),
    "un refus doit rendre une attribution absente, pas faire échouer la fiche élève entière");
  // ⚠️ ON MESURE LE CODE, PAS LES COMMENTAIRES. Le fichier EXPLIQUE pourquoi
  // il ne journalise pas : la phrase cite `console.error`, et la chercher
  // telle quelle faisait échouer ce contrôle sur son propre commentaire.
  const codeSeul = source.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "");
  assert.ok(!/console\.(error|warn)/.test(codeSeul),
    "et il ne doit rien journaliser : pour un collaborateur, le refus est le comportement normal");
});

test("F8. les fonctions d'accès échouent FERMÉES", () => {
  const compact = MIGRATION_PRIX.replace(/\s+/g, " ");
  // `current_student_id()` rend NULL pour un non-élève : `= NULL` vaut NULL,
  // donc PAS vrai. `est_staff_global()` est enveloppé par précaution.
  assert.ok(/sp\.student_id = public\.current_student_id\(\)/.test(compact));
  assert.ok(/coalesce\(public\.est_staff_global\(\), false\)/.test(compact));
  /*
   * Aucune catégorie de collaborateur n'apparaît dans la règle d'accès.
   *
   * ⚠️ ON DÉCOUPE LE CORPS DES DEUX FONCTIONS, PAS « JUSQU'À LA FIN ». La
   * vérification finale de la même migration cite `student_ids_agenda_...`
   * pour contrôler les cibles de campagne : une coupe qui allait jusqu'au
   * bout du fichier la ramassait et déclarait l'échec.
   */
  for (const fn of ["attribution_offre_eleve", "compte_attributions_offre"]) {
    const debut = compact.indexOf(`create or replace function public.${fn}`);
    const fin = compact.indexOf(`alter function public.${fn}`);
    assert.ok(debut >= 0 && fin > debut, `le corps de ${fn} est introuvable`);
    const corps = compact.slice(debut, fin);
    for (const c of CATEGORIES) {
      assert.ok(!corps.includes(c),
        `l'accès à l'attribution ne doit dépendre d'aucune catégorie (${fn} / ${c})`);
    }
  }
  // Et le compteur LÈVE au lieu de rendre zéro : un zéro silencieux ferait
  // croire qu'une offre encore attribuée est libre de toute référence.
  assert.ok(/using errcode = 'insufficient_privilege'/.test(compact),
    "le compteur d'attributions doit lever, pas rendre zéro");
});

test("F9. anon n'a l'EXECUTE d'aucune des deux fonctions d'attribution", () => {
  const compact = MIGRATION_PRIX.replace(/\s+/g, " ");
  assert.ok(/revoke all on function public\.attribution_offre_eleve\(uuid\) from public, anon, authenticated, service_role/.test(compact),
    "⚠️ Supabase accorde l'EXECUTE à anon par défaut : un revoke sur `public` seul ne suffit pas");
  assert.ok(/grant execute on function public\.attribution_offre_eleve\(uuid\) to authenticated, service_role/.test(compact));
  assert.ok(/anon peut exécuter une fonction d''attribution d''offre/.test(compact),
    "et la migration doit refuser de s'appliquer si anon la récupère");
});

test("F10. la RPC de suppression d'offre est réalignée, pas contournée", () => {
  /*
   * `delete_unused_subscription_template` est SECURITY INVOKER — c'est ce qui
   * maintient la suppression sous la RLS — et elle interrogeait deux des
   * colonnes fermées. Sans réalignement elle tombait en 42501 pour
   * l'administrateur lui-même.
   */
  const compact = MIGRATION_PRIX.replace(/\s+/g, " ");
  assert.ok(/create or replace function public\.delete_unused_subscription_template\(p_template_id uuid\)/.test(compact));
  assert.ok(!/create or replace function public\.delete_unused_subscription_template[\s\S]{0,2000}?security definer/.test(compact),
    "elle doit rester SECURITY INVOKER : la suppression reste soumise à la RLS");
  assert.ok(/from public\.compte_attributions_offre\(p_template_id, v_price_id\) a/.test(compact),
    "les deux comptes doivent passer par la fonction d'accès");
  // Le reste du garde-fou est conservé : verrou de ligne, et les quatre
  // références recomptées dans la même transaction.
  for (const attendu of ["for update", "studentsByTemplateId", "studentsByPriceId", "subscriptions", "payments"]) {
    assert.ok(compact.includes(attendu), `le garde-fou a perdu ${attendu}`);
  }
});

/* ═══════════ G — /admin/abonnements ET /admin/newsletter ═══════════ */

test("G1. les deux pages restantes portent la même garde serveur", () => {
  /*
   * ⚠️ `app/admin/layout.tsx` NE SUFFIT PAS : il appelle
   * `requireAdminOrCoach()`, et un collaborateur EST un `coach` au sens de
   * `profiles.role`. Sans layout dédié, taper l'URL affichait la page.
   */
  for (const href of ["/admin/abonnements", "/admin/newsletter"]) {
    const source = lire(`app${href}/layout.tsx`);
    assert.ok(/await interdireCollaborateur\(\)/.test(source), `app${href}/layout.tsx : garde absente`);
    assert.ok(!/"use client"/.test(source), `app${href}/layout.tsx : un Client Component ne refuse rien`);
  }
});

test("G2. leurs routes d'API sont fermées aux collaborateurs", () => {
  const routes = [
    "app/api/admin/subscription-templates/route.ts",
    "app/api/admin/subscription-templates/[id]/route.ts",
    "app/api/admin/newsletter/resync/route.ts",
  ];
  for (const route of routes) {
    const source = lire(route);
    assert.ok(/await requireAdmin\(\)|await requireStaff\(\)/.test(source),
      `${route} : aucune garde fermée aux collaborateurs`);
    for (const c of CATEGORIES) {
      assert.ok(!source.includes(`categorie: "${c}"`),
        `${route} : aucune catégorie ne doit pouvoir rouvrir une rubrique globale (${c})`);
    }
  }
});

test("G3. et leurs DONNÉES sont refusées en base, pas seulement leur écran", () => {
  /*
   * ⚠️ C'EST CE CONTRÔLE QUI COMPTE. Une garde d'écran laisse intactes les
   * requêtes PostgREST directes. Le catalogue d'offres est fermé par la
   * policy de la section 2, les abonnés newsletter par `est_staff_global()`,
   * et le prix de l'offre d'un élève par le privilège de colonne.
   */
  const compact = MIGRATION_PRIX.replace(/\s+/g, " ");
  assert.ok(/create policy subscription_templates_select_active_or_staff/.test(compact),
    "le catalogue doit être refermé par une policy, pas par l'interface");
  const checklist = lire("supabase/tests/p13b_roles_collaborateurs_checklist.sql");
  assert.ok(/M11\. catalogue d''offres : aucune ligne/.test(checklist),
    "la fermeture du catalogue doit être mesurée en base");
  // La page newsletter est un Server Component qui lit avec le client de
  // SESSION (RLS respectée), jamais avec le client d'administration.
  const db = lire("lib/newsletter/db.ts");
  assert.ok(/export async function listSubscribersForStaff\([\s\S]{0,400}?await getServerClient\(\)/.test(db),
    "la liste des abonnés doit passer par le client de session : avec le client d'administration, la RLS serait contournée");
});

console.log(`\n${passed} test(s) réussi(s), ${failed} échec(s).`);
if (failed > 0) process.exit(1);
