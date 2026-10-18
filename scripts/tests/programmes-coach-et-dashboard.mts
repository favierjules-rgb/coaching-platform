/*
 * ════════════════════════════════════════════════════════════════════════════
 * TITRE DU DASHBOARD · PROGRAMMES PRIVÉS PAR COACH · PUBLICATION RÉSERVÉE
 * ════════════════════════════════════════════════════════════════════════════
 *
 * ⚠️ CE FICHIER NE PROUVE PAS LA SÉCURITÉ, ET IL FAUT LE DIRE EN PREMIER. Il
 * mesure des règles pures et le texte des écrans. La preuve qu'un second coach
 * ne lit, ne modifie, ne supprime et ne publie rien qui ne soit à lui est en
 * base : supabase/tests/programmes_cloisonnement_coach.sql ouvre une session
 * par rôle et compte les lignes — 52 contrôles, et 26 d'entre eux rougissent
 * quand on rétablit l'état d'avant ce lot.
 * ════════════════════════════════════════════════════════════════════════════
 */

import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

import { titreDashboard } from "../../lib/admin-shell-nav";
import { MESSAGE_PUBLICATION_RESERVEE, peutPublierProgramme } from "../../lib/droit-publication-programme";

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
const MIGRATION = lire("supabase/migrations/20261020090000_programmes_prives_par_coach_et_publication_admin.sql");
const CHECKLIST = lire("supabase/tests/programmes_cloisonnement_coach.sql");
const MIGRATION_CATALOGUE = lire(
  "supabase/migrations/20261021090000_subscription_templates_policies_authenticated.sql",
);
/**
 * Le code de la migration, commentaires retirés : ils citent ce qu'on interdit.
 *
 * ⚠️ ET LE BLOC DE VÉRIFICATION EST RETIRÉ LUI AUSSI. Il contrôle qu'aucune
 * policy ne cite plus `est_staff_global` — donc il CITE cette chaîne, et un
 * contrôle « le mot n'apparaît plus » échouait sur la vérification qui le
 * cherche. On ne mesure donc que les sections qui DÉFINISSENT les règles.
 */
const MARQUEUR_VERIFICATION = "-- 5. VÉRIFICATION";
const MIGRATION_CODE = MIGRATION.slice(0, MIGRATION.indexOf(MARQUEUR_VERIFICATION))
  .replace(/^\s*--.*$/gm, "")
  .replace(/\s+/g, " ");

/* ═════════════════════ A — LE TITRE DU DASHBOARD ═════════════════════ */

test("A1. l'administrateur lit « Dashboard admin », le coach « Dashboard coach »", () => {
  assert.equal(
    titreDashboard({ chargement: false, estAdmin: true, mecanismeIndisponible: false }),
    "Dashboard admin",
  );
  assert.equal(
    titreDashboard({ chargement: false, estAdmin: false, mecanismeIndisponible: false }),
    "Dashboard coach",
  );
});

test("A2. tant que le rôle n'est pas lu, le titre n'affirme rien", () => {
  /*
   * ⚠️ TROIS VALEURS, PAS DEUX. Afficher « admin » à un coach — ou l'inverse —
   * pendant la lecture des droits serait une affirmation fausse sur son
   * compte, et elle resterait à l'écran si la lecture n'aboutissait pas. Le
   * titre neutre ne dit rien d'inexact.
   */
  assert.equal(titreDashboard({ chargement: true, estAdmin: false, mecanismeIndisponible: false }), "Dashboard");
  assert.equal(titreDashboard({ chargement: true, estAdmin: true, mecanismeIndisponible: false }), "Dashboard");
  assert.equal(titreDashboard({ chargement: false, estAdmin: false, mecanismeIndisponible: true }), "Dashboard");
});

test("A3. le titre vient du rôle authentifié, pas de la route ni d'une chaîne en dur", () => {
  const page = lire("app/admin/page.tsx");
  assert.ok(/\{titreDashboard\(staff\)\}/.test(page), "le titre doit être calculé");
  assert.ok(!/Dashboard admin/.test(page.replace(/\{\/\*[\s\S]*?\*\/\}/g, "")),
    "plus aucune occurrence écrite en dur dans le rendu");
  // `staff` vient de `useStaffContext`, dont `estAdmin` est `profiles.role === "admin"`
  // — la même règle que `public.is_admin()` et `requireAdmin()`.
  assert.ok(/const staff = useStaffContext\(\)/.test(page));
  assert.ok(/estAdmin: profilRole === "admin"/.test(lire("hooks/useStaffContext.ts")),
    "l'administrateur se reconnaît par profiles.role, pas par coaches.role");
  // La route, elle, reste commune au staff : ce n'est pas elle qui décide.
  assert.ok(/requireAdminOrCoach\(\)/.test(lire("app/admin/layout.tsx")));
});

/* ═════════════════════ B — LA MENTION DE VERSION ═════════════════════ */

test("B1. « Version mockée » a disparu des paramètres", () => {
  const page = lire("app/admin/parametres/page.tsx");
  assert.ok(!/Version mockée/.test(page), "le texte visible doit avoir disparu");
  assert.ok(!/mockVersion/.test(page), "…ainsi que sa seule utilisation d'affichage");
});

test("B2. et le RESTE de la page n'a pas bougé", () => {
  /*
   * ⚠️ RETIRER UNE MENTION N'EST PAS REFONDRE LES PARAMÈTRES. Le formulaire
   * repose toujours sur des données de test (`data/admin.ts`, localStorage) :
   * ce lot ne prétend pas le contraire, il enlève seulement une ligne.
   */
  const page = lire("app/admin/parametres/page.tsx");
  for (const attendu of ["Informations coach", "Nom du coach", "Statut du site", "handleReset", "resetAdminData"]) {
    assert.ok(page.includes(attendu), `${attendu} doit rester`);
  }
  assert.ok(/mockVersion: string;/.test(lire("types/index.ts")),
    "le modèle de données n'est pas touché — la page est toujours mockée, et on ne le cache pas");
});

/* ═════════ C — PUBLIER ET VENDRE : LA RÈGLE D'INTERFACE ═════════ */

test("C1. seul l'administrateur se voit proposer la publication", () => {
  assert.equal(peutPublierProgramme({ chargement: false, estAdmin: true, mecanismeIndisponible: false }), true);
  assert.equal(peutPublierProgramme({ chargement: false, estAdmin: false, mecanismeIndisponible: false }), false);
});

test("C2. et le doute laisse passer — la base refuse pendant ce temps", () => {
  /*
   * Même règle que `lib/droit-affectation.ts` : un indice d'interface ne doit
   * pas escamoter une option sur une lecture inachevée. L'administrateur est
   * l'utilisateur normal de cet écran ; lui retirer son pôle pendant le
   * chargement serait le seul effet observable d'un masquage prudent.
   */
  assert.equal(peutPublierProgramme({ chargement: true, estAdmin: false, mecanismeIndisponible: false }), true);
  assert.equal(peutPublierProgramme({ chargement: false, estAdmin: false, mecanismeIndisponible: true }), true);
});

test("C3. le formulaire de création masque le pôle public ET le revérifie à l'envoi", () => {
  const page = lire("app/admin/programmes/nouveau/page.tsx");
  assert.ok(/const publicationAutorisee = peutPublierProgramme\(staff\)/.test(page));
  assert.ok(/polesVisibles = poles\.filter\(\(\{ id \}\) => id !== "public" \|\| publicationAutorisee\)/.test(page),
    "le pôle public ne doit pas être rendu à un coach");
  assert.ok(/\{polesVisibles\.map\(/.test(page), "la grille doit rendre la liste filtrée");
  // ⚠️ ET À L'ENVOI AUSSI : un état React forcé pourrait porter `pole === "public"`.
  assert.ok(/isPublic: pole === "public" && publicationAutorisee/.test(page));
  assert.ok(/accessChoice === "__new__" && publicationAutorisee/.test(page),
    "la création du prix dédié doit être conditionnée de la même façon");
  assert.ok(page.includes("MESSAGE_PUBLICATION_RESERVEE"),
    "l'absence du pôle doit être expliquée, pas subie");
  assert.ok(/réservées à l'administrateur/.test(MESSAGE_PUBLICATION_RESERVEE));
});

test("C4. la création du prix dédié était DÉJÀ réservée à l'administrateur", () => {
  // Le pôle public enchaîne sur cette route : `requireAdmin()` y refusait déjà
  // un coach. Le trou portait sur le cas « Gratuit », qui ne passe pas par là.
  assert.ok(/await requireAdmin\(\)/.test(lire("app/api/admin/subscription-templates/route.ts")));
});

/* ═════════ D — LA MIGRATION : CE QU'ELLE FAIT, ET CE QU'ELLE ÉVITE ═════════ */

test("D1. la propriété est posée EN BASE, pas seulement dans createProgram", () => {
  /*
   * ⚠️ LE DÉFAUT QUI RENDAIT TOUT LE RESTE INOPÉRANT. Relevé en production :
   * 28 programmes, `coach_id` NULL sur les 28, parce que `createProgram` ne
   * l'écrit pas. Cloisonner sur `coach_id` sans le remplir aurait rendu chaque
   * coach aveugle à ses propres programmes.
   */
  assert.ok(/create or replace function public\.programs_poser_proprietaire\(\)/.test(MIGRATION_CODE));
  assert.ok(/before insert on public\.programs/.test(MIGRATION_CODE));
  assert.ok(/new\.coach_id := public\.current_staff_id\(\)/.test(MIGRATION_CODE),
    "la valeur vient d'une fonction SECURITY DEFINER, pas du client");
  // Les copies individuelles ne sont pas concernées : elles se lisent sur l'élève.
  assert.ok(/if new\.owner_student_id is not null then return new; end if;/.test(MIGRATION_CODE));
  // Et `createProgram` n'envoie toujours pas `coach_id` : c'est volontaire,
  // le déclencheur couvre aussi les insertions PostgREST directes.
  assert.ok(!/coach_id:/.test(lire("lib/supabase/programs.ts")),
    "si createProgram se mettait à écrire coach_id, il faudrait revoir ce contrôle");
});

test("D2. la branche des MODÈLES ne dépend plus du staff global", () => {
  /*
   * `est_staff_global()` est vrai pour TOUT coach autonome. Placé en premier
   * terme d'un `or`, il rendait la clause de propriété qui suit purement
   * décorative. Mesuré avant correctif : coach2 voyait, modifiait et
   * supprimait le programme de coach1.
   */
  assert.ok(!/est_staff_global/.test(MIGRATION_CODE),
    "aucune règle de programme ne doit plus s'appuyer sur le staff global");
  // ⚠️ Un marqueur introuvable rend -1, et `slice(0, -1)` garde tout le
  // fichier : le contrôle passerait alors sur le bloc de vérification,
  // qui cite justement ce qu'on interdit. Le marqueur est donc vérifié.
  assert.ok(MIGRATION.indexOf(MARQUEUR_VERIFICATION) > 0, "le découpage par section doit rester valide");
  assert.equal((MIGRATION_CODE.match(/coalesce\(public\.is_admin\(\), false\)/g) ?? []).length >= 6, true,
    "les deux fonctions de portée et les quatre policies portent la même règle");
  assert.ok(/coach_id in \(select public\.coach_ids_portee\(\)\)/.test(MIGRATION_CODE));
  // L'administrateur garde tout : `coach_ids_portee()` lui rend toutes les
  // fiches, et `is_admin()` le couvre même sans fiche `coaches`.
  assert.ok(/une fonction de portée a perdu l''administrateur/.test(MIGRATION),
    "la migration doit refuser de s'appliquer si l'administrateur disparaît de la règle");
});

test("D3. publier et vendre lèvent 42501 ; le travail interne reste au coach", () => {
  assert.ok(/create or replace function public\.programs_publication_reservee_admin\(\)/.test(MIGRATION_CODE));
  assert.ok(/before insert or update on public\.programs/.test(MIGRATION_CODE));
  assert.ok(/using errcode = 'insufficient_privilege'/.test(MIGRATION_CODE),
    "une tentative de publication doit LEVER, pas être annulée en silence");
  // Les deux colonnes qui portent le pouvoir, et elles seules.
  assert.ok(/new\.is_public/.test(MIGRATION_CODE));
  assert.ok(/new\.public_subscription_template_id/.test(MIGRATION_CODE));
  // ⚠️ ET CELLES QUI NE LE PORTENT PAS NE SONT PAS TOUCHÉES : c'est la
  // distinction exigée entre statut de travail et statut de publication.
  for (const colonne of ["new.status", "new.publication_status", "new.published_at"]) {
    assert.ok(!MIGRATION_CODE.includes(colonne),
      `${colonne} doit rester au coach : c'est son travail interne, pas une commercialisation`);
  }
  // Le serveur garde la main (webhook Stripe, régularisation d'achat).
  assert.ok(/coalesce\(auth\.role\(\), ''\) = 'service_role'/.test(MIGRATION_CODE));
  assert.ok(/auth\.uid\(\) is null/.test(MIGRATION_CODE));
});

test("D4. et le sens inverse est conservé, pour ne pas bloquer l'édition d'un coach", () => {
  /*
   * `updateProgram` renvoie TOUJOURS les deux colonnes. Le builder d'un coach
   * ne modélise pas la publication : il enverrait `is_public = false` sur un
   * programme que l'administrateur a publié. Lever dans ce cas interdirait au
   * coach de modifier son propre programme pour une intention qu'il n'a pas
   * eue — on conserve donc la valeur de l'administrateur.
   */
  assert.ok(/new\.is_public := v_ancien_public;/.test(MIGRATION_CODE));
  assert.ok(/new\.public_subscription_template_id := v_ancienne_offre;/.test(MIGRATION_CODE));
  assert.ok(/E13\. éditer un programme publié par l''administrateur ne le dépublie pas/.test(CHECKLIST),
    "et c'est mesuré en base");
});

test("D5. la vitrine garde sa règle, la bibliothèque mutualisée n'est pas cloisonnée", () => {
  /*
   * ⚠️ NUANCE IMPORTANTE DEPUIS LA SECTION 4. `programs_select_public` n'est
   * PAS redéfinie — sa règle est celle qui donne un sens à la publication par
   * l'administrateur. `programs_select_assigned_student`, elle, EST recréée,
   * mais uniquement pour être bornée au rôle `authenticated` : sa clause est
   * reprise à l'identique (un visiteur anonyme n'est jamais un élève
   * assigné, cela ne lui retire rien). La section F mesure cette distinction.
   */
  assert.ok(!/create policy programs_select_public/.test(MIGRATION_CODE),
    "la policy de la vitrine ne doit pas être redéfinie");
  assert.ok(/create policy programs_select_assigned_student[\s\S]{0,200}?to authenticated/.test(MIGRATION_CODE),
    "celle de l'élève assigné n'est recréée que pour être bornée au rôle authentifié");
  assert.ok(/publication_status = 'published'/.test(MIGRATION_CODE)
    && /current_student_id\(\)/.test(MIGRATION_CODE),
    "…et sa règle est reprise à l'identique");
  // …et la migration refuse de s'appliquer si elles ont disparu.
  assert.ok(/la vitrine publique a disparu/.test(MIGRATION));
  assert.ok(/l''accès de l''élève assigné a disparu/.test(MIGRATION));
  // La bibliothèque d'exercices et les modèles de séance restent mutualisés :
  // les cloisonner priverait un coach de ses outils, hors de la demande.
  assert.ok(/la bibliothèque d''exercices ou les modèles de séance ont changé de règle/.test(MIGRATION));
  // Aucune donnée n'est réécrite : pas de backfill de `coach_id`.
  assert.ok(!/update public\.programs set coach_id/i.test(MIGRATION_CODE),
    "aucun backfill : attribuer d'office les programmes existants à un coach serait arbitraire");
  // Stripe, Brevo et Resend ne sont pas touchés.
  assert.ok(!/stripe_price_id|brevo|resend/i.test(MIGRATION_CODE),
    "la configuration des fournisseurs reste partagée, comme demandé");
});

/* ═════════ F — LA VITRINE PUBLIQUE, RÉPARÉE SANS RIEN ROUVRIR ═════════ */

test("F1. les policies internes sont bornées au rôle authentifié, pas rouvertes à anon", () => {
  /*
   * ⚠️ LE DÉFAUT, REPRODUIT EN LOCAL AVANT CORRECTION : la requête exacte de
   * `fetchPublicPrograms`, jouée en `anon`, rendait
   * `42501 permission denied for function student_ids_entrainement_lecture`,
   * puis `… for function is_admin` une fois la première levée corrigée. Les
   * policies internes portaient le rôle `{public}`, donc PostgreSQL les
   * évaluait aussi pour un visiteur, et une policy permissive qui LÈVE fait
   * échouer toute la requête — y compris la branche publique.
   *
   * ⚠️ `to authenticated` RESTREINT une policy permissive : personne n'y gagne
   * un droit. C'est l'inverse de rendre l'EXECUTE à `anon`, que la consigne
   * interdit explicitement.
   */
  for (const policy of ["programs_manage_staff_select", "programs_manage_staff_insert",
                        "programs_manage_staff_update", "programs_manage_staff_delete",
                        "programs_select_assigned_student",
                        "subscription_templates_select_active_or_staff",
                        "subscription_templates_manage_staff_select"]) {
    assert.ok(new RegExp(`create policy ${policy}[\\s\\S]{0,260}?to authenticated`).test(MIGRATION_CODE),
      `${policy} doit être bornée au rôle authentifié`);
  }
  // Et AUCUN EXECUTE rendu à `anon` sur une fonction interne.
  assert.ok(!/grant execute on function public\.(student_ids_|coach_ids_portee|categories_|est_staff_global|is_admin|program_ids_)/.test(MIGRATION_CODE),
    "la vitrine se répare en bornant les policies, jamais en rouvrant le modèle P13-B");
  assert.ok(/anon a récupéré l''EXECUTE d''une fonction interne du staff/.test(MIGRATION),
    "et la migration refuse de s'appliquer si c'était le cas");
});

test("F2. le visiteur garde des policies publiques distinctes, sans appel de fonction interne", () => {
  // Les programmes : la règle publique est faite de colonnes, rien d'autre.
  assert.ok(/programs_select_public/.test(MIGRATION),
    "la policy publique des programmes doit rester nommée dans la vérification");
  // Les offres : une policy publique à part, bornée aux offres des programmes PUBLIÉS.
  assert.ok(/create policy subscription_templates_select_vitrine_publique[\s\S]{0,200}?to anon/.test(MIGRATION_CODE));
  assert.ok(/id in \(select public\.offres_des_programmes_publies\(\)\)/.test(MIGRATION_CODE));
  assert.ok(/is_active = true/.test(MIGRATION_CODE));
  // ⚠️ PLUS ÉTROIT QU'AVANT, PAS PLUS LARGE : `peut_voir_catalogue_offres()`
  // rendait à un visiteur TOUTES les offres actives ; il ne voit désormais que
  // celles qu'un programme publié met en avant.
  assert.ok(/create or replace function public\.offres_des_programmes_publies\(\)/.test(MIGRATION_CODE));
  assert.ok(/p\.is_public = true[\s\S]{0,120}?p\.status = 'actif'/.test(MIGRATION_CODE),
    "la fonction publique ne doit rendre que les offres de programmes réellement publiés");
  assert.ok(/grant execute on function public\.offres_des_programmes_publies\(\) to anon/.test(MIGRATION_CODE));
});

test("F3. la migration EXÉCUTE la requête de la vitrine avant de s'appliquer", () => {
  /*
   * ⚠️ C'EST LE SEUL CONTRÔLE QUI NE PUISSE PAS ÊTRE TROMPÉ PAR LA PROFONDEUR
   * DU CHEMIN. Un contrôle textuel n'aurait pas attrapé le second saut
   * `programs → assignments → student_ids_entrainement_lecture` : la policy
   * fautive ne citait aucune fonction interdite dans sa propre clause, elle
   * lisait une table dont les policies en citaient.
   */
  assert.ok(/perform set_config\('role', 'anon', true\)/.test(MIGRATION));
  assert.ok(/la requête du catalogue public échoue encore pour un visiteur/.test(MIGRATION));
  assert.ok(/left join public\.subscription_templates t on t\.id = p\.public_subscription_template_id/.test(MIGRATION),
    "la requête jouée doit être celle de fetchPublicPrograms, jointure comprise");
  // La requête de référence est bien celle du code.
  const vitrine = lire("lib/supabase/public-programs.ts");
  assert.ok(/\.eq\("is_public", true\)[\s\S]{0,80}?\.eq\("status", "actif"\)/.test(vitrine));
  assert.ok(/subscription_templates\(amount_cents, currency\)/.test(vitrine));
});

test("F4. et les deux pages anonymes sont bien les seules à lire en visiteur", () => {
  /*
   * Les deux routes publiques d'achat passent par le client d'ADMINISTRATION
   * (`service_role`, hors RLS) : elles n'étaient pas concernées par le défaut
   * et ne le sont pas par le correctif. Seules les pages /programmes et
   * /programmes/[id] lisent en anonyme, par `createSupabaseServerClient`.
   */
  for (const route of ["app/api/public/programs/[programId]/checkout/route.ts",
                       "app/api/public/programs/[programId]/claim/route.ts"]) {
    assert.ok(/createSupabaseAdminClient\(\)/.test(lire(route)),
      `${route} passe par le service role, hors RLS`);
  }
  assert.ok(/createSupabaseServerClient\(\)/.test(lire("app/programmes/page.tsx")));
});

test("F5. la checklist SQL mesure le visiteur, et ce qu'il ne doit PAS voir", () => {
  for (const controle of [
    "H1. la requête de la vitrine ne lève plus pour un visiteur",
    "H2. le visiteur voit le programme publié",
    // ⚠️ APOSTROPHE DOUBLÉE : ces libellés sont des chaînes SQL.
    "H4. le programme PRIVÉ d''un coach lui est invisible",
    "H5. un BROUILLON marqué public lui est invisible (status <> actif)",
    "H7. il voit l''offre RATTACHÉE au programme publié",
    "H8. mais PAS une offre active qu''aucun programme publié ne présente",
    "H13. le visiteur ne crée aucun programme",
    "H14. anon n''a l''EXECUTE d''AUCUNE fonction interne du staff",
  ]) {
    assert.ok(CHECKLIST.includes(controle), `le contrôle « ${controle} » manque à la checklist SQL`);
  }
  // Un brouillon public et une offre hors vitrine : les deux pièges du visiteur.
  assert.ok(/brouillon/.test(CHECKLIST) && /PG Offre interne/.test(CHECKLIST));
});

test("F6. les trois policies d'écriture du catalogue sont bornées, sans réécrire leurs conditions", () => {
  /*
   * ⚠️ LA DERNIÈRE AMORCE DU MÊME PIÈGE, dans une migration à part
   * (20261021090000) parce que 20261020090000 est enregistrée comme appliquée.
   *
   * `anon` détient les privilèges de table INSERT/UPDATE/DELETE sur
   * `subscription_templates` : ces trois policies `{public}` étaient donc
   * réellement évaluées pour un visiteur, et chacune appelle `is_admin()`, dont
   * P13-B lui a retiré l'EXECUTE. Mesuré avant : `42501 permission denied for
   * function is_admin` sur les trois commandes. Le visiteur était refusé et il
   * le reste — ce qui change est la NATURE du refus.
   */
  const compact = MIGRATION_CATALOGUE.replace(/^\s*--.*$/gm, "").replace(/\s+/g, " ");
  for (const policy of ["subscription_templates_manage_staff_insert",
                        "subscription_templates_manage_staff_update",
                        "subscription_templates_manage_staff_delete"]) {
    assert.ok(new RegExp(`alter policy ${policy} on public\\.subscription_templates to authenticated`).test(compact),
      `${policy} doit être bornée par ALTER POLICY … TO authenticated`);
  }
  // ⚠️ `alter policy … to` NE RÉÉCRIT PAS `using`/`with check` : les trois
  // conditions `is_admin()` sont conservées sans être recopiées, donc sans
  // risque de les recopier de travers.
  assert.ok(!/create policy|drop policy/.test(compact),
    "aucune policy ne doit être recréée : seul son rôle change");
  assert.ok(!/using \(|with check \(/.test(compact),
    "aucune condition ne doit être réécrite");
  // Rien d'autre ne bouge : ni table, ni privilège, ni fonction.
  assert.ok(!/alter table|create table|grant |revoke |create or replace function/i.test(compact),
    "ce lot ne doit modifier que les rôles de trois policies");
});

test("F7. et la migration refuse de s'appliquer si le résultat n'est pas celui-là", () => {
  // Les six contrôles de catalogue système…
  for (const garde of [
    "les trois policies d''écriture ne sont pas exactement bornées à authenticated",
    "une policy d''écriture a perdu sa condition is_admin()",
    "la policy de vitrine publique a disparu, changé de rôle ou perdu sa borne",
    "les policies de lecture élève/staff ne sont plus bornées à authenticated",
    "le nombre de policies a changé",
    "anon a récupéré l''EXECUTE de is_admin()",
  ]) {
    assert.ok(MIGRATION_CATALOGUE.includes(garde), `la garde « ${garde} » manque`);
  }
  // ⚠️ `= '{authenticated}'` ET NON `~ 'authenticated'` : une policy portant
  // `{anon,authenticated}` satisferait une recherche de sous-chaîne tout en
  // laissant le visiteur dans la règle.
  assert.ok(/roles::text = '\{authenticated\}'/.test(MIGRATION_CATALOGUE));
  // …et le contrôle dynamique, qui tente l'écriture en visiteur et exige que
  // le refus ne vienne PAS d'un privilège de fonction. Les deux refus portent
  // le même SQLSTATE : seul le message les distingue.
  assert.ok(/set_config\('role', 'anon', true\)/.test(MIGRATION_CATALOGUE));
  assert.ok(/v_message ~\* 'function'/.test(MIGRATION_CATALOGUE),
    "le contrôle doit mesurer le MESSAGE, pas seulement le code d'erreur");
  assert.ok(/un visiteur anonyme a pu INSÉRER une offre/.test(MIGRATION_CATALOGUE));
});

test("F8. la checklist SQL mesure les trois policies et les deux sens du refus", () => {
  for (const controle of [
    "H15. les trois policies d''écriture du catalogue sont bornées au rôle authentifié",
    "H16. …et elles ont gardé leur condition is_admin()",
    "H17. le visiteur ne crée aucune offre, et le refus vient de la RÈGLE, pas d''un privilège de fonction",
    "H18. l''administrateur, lui, crée toujours une offre",
  ]) {
    assert.ok(CHECKLIST.includes(controle), `le contrôle « ${controle} » manque à la checklist SQL`);
  }
  assert.ok(/ON MESURE LE MESSAGE, PAS SEULEMENT LE SQLSTATE/.test(CHECKLIST),
    "la checklist doit expliquer pourquoi le SQLSTATE seul ne suffit pas");
});

/* ═════════ E — CE QUE LA CHECKLIST SQL DOIT COUVRIR ═════════ */

test("E1. la checklist mesure les deux sens, pour les cinq acteurs", () => {
  for (const controle of [
    "B2. le modèle PRIVÉ du coach 1 lui est invisible, même par son identifiant",
    "B7. les SEMAINES du programme du coach 1 lui sont invisibles",
    "C3. supprimer le programme du coach 1 : REFUSÉ",
    "C8. assigner le programme du coach 1 à un élève : REFUSÉ",
    "D6. …et `coach_id` est posé sur SA fiche, sans qu''il l''ait envoyé",
    "E1. le coach PUBLIE son programme (is_public) : REFUSÉ",
    "E5. le coach CRÉE directement un programme public : REFUSÉ",
    "E8. l''administrateur, lui, publie",
    "F5. mais il ne PUBLIE pas davantage que le coach",
    "G2. il voit le modèle ORPHELIN que plus aucun coach ne voit",
  ]) {
    assert.ok(CHECKLIST.includes(controle), `le contrôle « ${controle} » manque à la checklist SQL`);
  }
  // Le collaborateur est dans le décor : P13-B ne doit pas bouger.
  assert.ok(/P13-B INTACT/.test(CHECKLIST));
  // Et le travail interne du coach est mesuré comme AUTORISÉ, pas seulement
  // la commercialisation comme refusée.
  assert.ok(/D2\. passer son programme en `actif` \(travail interne\) : accepté/.test(CHECKLIST));
  assert.ok(/D5\. créer un programme : accepté/.test(CHECKLIST));
});

console.log(`\n${passed} test(s) réussi(s), ${failed} échec(s).`);
if (failed > 0) process.exit(1);
