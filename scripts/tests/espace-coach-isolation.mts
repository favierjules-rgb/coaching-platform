/*
 * ════════════════════════════════════════════════════════════════════════════
 * ESPACE COACH ISOLÉ — AGENDA, DOCUMENTS, FICHIERS, EMAILS, ZONE DE TEST
 * ════════════════════════════════════════════════════════════════════════════
 *
 * ⚠️ CE FICHIER NE PROUVE PAS L'ISOLATION, ET IL FAUT LE DIRE EN PREMIER. Il
 * mesure du texte : la forme de la migration, le câblage des routes, l'absence
 * du panneau de réinitialisation. La preuve qu'un second coach ne lit, ne
 * modifie, ne supprime et ne télécharge rien qui ne soit à lui est EN BASE :
 * supabase/tests/espace_coach_isolation_checklist.sql ouvre une session par
 * acteur et compte les lignes — 91 contrôles, et six sabotages ciblés les font
 * rougir là où il faut (B1-B16, G1-G5, G18-G23, C4-C5, E2-E5, H1-H6).
 * ════════════════════════════════════════════════════════════════════════════
 */

import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

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
const MIGRATION = lire("supabase/migrations/20261022090000_espace_coach_isole_agenda_documents_emails.sql");
const CHECKLIST = lire("supabase/tests/espace_coach_isolation_checklist.sql");
const PARAMETRES = lire("app/admin/parametres/page.tsx");
const ENVOI = lire("lib/email/send-transactional-email.ts");
const AUTEUR = lire("lib/email/auteur-envoi.ts");
const APPOINTMENTS = lire("lib/supabase/appointments.ts");
const MIGRATION_SEAU = lire("supabase/migrations/20261023090000_storage_documents_proprietaire_dans_le_chemin.sql");
const STORAGE_DOCS = lire("lib/supabase/storage-documents.ts");
const CALENDRIER = lire("app/admin/calendrier/page.tsx");

/**
 * Le SQL d'un fichier, ses DEUX formes de commentaire retirées : les lignes
 * ouvertes par deux tirets, et les blocs encadrés.
 *
 * ⚠️ INDISPENSABLE POUR LES CONTRÔLES D'ABSENCE. Un commentaire explique ce
 * qu'on interdit, donc il NOMME ce qu'on interdit : un contrôle « ce mot
 * n'apparaît plus » appliqué au fichier brut échouerait sur l'explication
 * elle-même.
 */
const sansCommentaires = (sql: string) =>
  sql.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*--.*$/gm, "");

const CODE = sansCommentaires(MIGRATION);

/* ═════════════ A — LA CAUSE EST TRAITÉE, PAS CONTOURNÉE ═════════════ */

test("A1. plus aucune policy de ces tables ne s'appuie sur est_staff_global()", () => {
  /*
   * ⚠️ C'EST LA CAUSE RACINE. `est_staff_global()` rend VRAI pour
   * `is_admin()` OU `staff_role() in ('admin','assistant')` — et un coach
   * autonome porte `assistant`. Toutes les policies `…_manage_staff_*` de
   * l'agenda commençaient par cette branche, qui lui ouvrait l'ensemble des
   * lignes. Mesuré avant : il voyait la disponibilité de l'administrateur et
   * la supprimait pour de bon.
   */
  const policies = CODE.split(/create policy/).slice(1);
  const fautives = policies.filter((p) => /est_staff_global/.test(p.split(";")[0]));
  assert.equal(fautives.length, 0, "une policy créée ici s'appuie encore sur est_staff_global()");
  // Et la condition de remplacement est bien la propriété, pas une autre
  // étiquette de rôle.
  assert.ok(/coach_id = \(select public\.current_staff_id\(\)\)/.test(CODE),
    "les policies doivent se borner au propriétaire, par current_staff_id()");
});

test("A2. la propriété est posée EN BASE, par déclencheur, sur les quatre tables", () => {
  // ⚠️ EN BASE ET PAS DANS L'APPLICATION : un correctif applicatif laisserait
  // coach_id NULL pour toute insertion directe en PostgREST.
  assert.ok(/create or replace function public\.poser_proprietaire_staff\(\)/.test(CODE));
  for (const table of ["coach_availabilities", "coach_unavailabilities", "booking_settings", "documents"]) {
    assert.ok(new RegExp(`create trigger ${table}_poser_proprietaire\\s+before insert on public\\.${table}`).test(CODE),
      `${table} doit recevoir le déclencheur de propriété`);
  }
  // La valeur vient de la fonction SECURITY DEFINER, jamais du client.
  assert.ok(/new\.coach_id := public\.current_staff_id\(\);/.test(CODE));
});

test("A3. les réglages de réservation et le journal d'emails reçoivent un propriétaire", () => {
  assert.ok(/alter table public\.booking_settings\s+add column if not exists coach_id uuid references public\.coaches\(id\)/.test(CODE),
    "booking_settings n'avait aucune colonne de propriétaire : UNE ligne pour tout le cabinet");
  assert.ok(/alter table public\.email_logs\s+add column if not exists sent_by_coach_id uuid references public\.coaches\(id\)/.test(CODE),
    "email_logs n'avait aucune notion d'auteur : rien à filtrer");
  // Nullable, et les lignes existantes restent NULL : aucune réattribution.
  assert.ok(!/update public\.(documents|coach_availabilities|coach_unavailabilities|email_logs) set coach_id/i.test(CODE),
    "aucune donnée historique ne doit être réattribuée");
  assert.ok(!/\bdelete from public\./i.test(CODE), "ce lot ne supprime aucune donnée");
});

test("A4. la policy des documents reçoit enfin une condition sur l'appelant", () => {
  /*
   * ⚠️ LE DÉFAUT « LE COACH VOIT LES 17 DOCUMENTS » ÉTAIT LÀ.
   * `documents_select_global_or_assigned` disait `status = 'publié' and
   * (visibility = 'global' or …)` : la première branche ne contenait aucune
   * condition sur l'appelant, donc tout compte authentifié la satisfaisait.
   */
  const bloc = CODE.slice(CODE.indexOf('create policy "documents_select_global_or_assigned"'));
  const regle = bloc.slice(0, bloc.indexOf(";"));
  assert.ok(/current_student_id\(\)\)? is not null/.test(regle),
    "la branche globale doit exiger un ÉLÈVE, pas n'importe quel compte");
  assert.ok(/coach_id = \(select s\.coach_id from public\.students s/.test(regle),
    "un élève ne doit voir que les documents globaux de SON coach");
  // Et le fonds historique sans propriétaire reste visible : pas de régression
  // pour les élèves, pas de réattribution.
  assert.ok(/coach_id is null/.test(regle));
});

test("A5. le fichier suit la ligne : les policies Storage ne signent plus sur is_coach_or_admin()", () => {
  // ⚠️ MASQUER LA LIGNE NE PROTÉGEAIT PAS LE FICHIER. La policy sortante
  // signait n'importe quel objet du seau dès `profiles.role in ('coach','admin')`.
  const storage = CODE.split("storage.objects");
  assert.ok(storage.length > 1, "la migration doit toucher les policies du seau");
  /*
   * ⚠️ ON MESURE LE CORPS DES POLICIES, PAS LE FICHIER. Le bloc de
   * vérification de la migration cherche lui-même `is_coach_or_admin` dans
   * `pg_policies` : un contrôle « cette chaîne n'apparaît plus » appliqué au
   * fichier entier se déclencherait sur la vérification qui la traque.
   */
  for (const nomPolicy of ["documents_bucket_select_accessible", "documents_bucket_manage_staff",
                           "documents_bucket_update_staff", "documents_bucket_delete_staff"]) {
    const d = CODE.indexOf(`create policy "${nomPolicy}" on storage.objects`);
    assert.ok(d > 0, `${nomPolicy} doit être redéfinie`);
    const corps = CODE.slice(d, CODE.indexOf("\n\n", d));
    assert.ok(!/is_coach_or_admin/.test(corps),
      `${nomPolicy} ne doit plus signer sur le seul is_coach_or_admin()`);
  }
  for (const nom of ["documents_bucket_select_accessible", "documents_bucket_manage_staff",
                     "documents_bucket_update_staff", "documents_bucket_delete_staff"]) {
    assert.ok(new RegExp(`create policy "${nom}" on storage\\.objects`).test(CODE), `${nom} manque`);
  }
  // Le seau est créé s'il manque, sinon l'isolation des fichiers ne serait pas
  // testable en local (le baseline ne le contient pas).
  assert.ok(/insert into storage\.buckets[\s\S]{0,120}'documents'[\s\S]{0,80}on conflict \(id\) do nothing/.test(CODE));
});

/* ═════ B — LE CHEMIN D'ÉCRITURE RÉEL : LES RPC SECURITY DEFINER ═════ */

test("B1. aucune RPC du calendrier n'autorise plus sur l'étiquette « assistant »", () => {
  /*
   * ⚠️ SANS CE CONTRÔLE, TOUT LE RESTE SERAIT DÉCORATIF. Les écritures du
   * calendrier passent par des fonctions `SECURITY DEFINER` : elles ne sont
   * PAS soumises à la RLS. `update_coach_event_atomic` autorisait sur
   * `staff_role() in ('admin','assistant')`, donc tout coach autonome
   * modifiait l'événement de n'importe qui.
   */
  for (const rpc of ["update_coach_event_atomic", "cancel_appointment_atomic",
                     "reschedule_appointment_atomic", "create_appointment_atomic"]) {
    const d = CODE.indexOf(`create or replace function public.${rpc}`);
    assert.ok(d > 0, `${rpc} doit être remplacée par ce lot`);
    const corps = CODE.slice(d, CODE.indexOf("$fn$;", d));
    assert.ok(!/staff_role\(\)[^;]*assistant/.test(corps),
      `${rpc} ne doit plus autoriser sur staff_role() = assistant`);
  }
});

test("B2. le rendez-vous créé par l'application reçoit un propriétaire", () => {
  // ⚠️ `coach_id` N'ÉTAIT PAS ÉCRIT DU TOUT : la colonne existe depuis le
  // baseline et aucun rendez-vous créé par l'app ne la renseignait.
  const d = CODE.indexOf("create or replace function public.create_appointment_atomic");
  const corps = CODE.slice(d, CODE.indexOf("$fn$;", d));
  assert.ok(/v_coach_id := coalesce\(\s*public\.current_staff_id\(\),/.test(corps),
    "le propriétaire doit être DÉDUIT de l'appelant");
  assert.ok(/\(student_id, coach_id,/.test(corps), "l'INSERT doit écrire coach_id");
});

test("B3. les créneaux occupés sont bornés à UN agenda", () => {
  // Les heures prises de l'administrateur apparaissaient occupées chez le
  // coach, et réciproquement : les deux fonctions balayaient le cabinet.
  /*
   * ⚠️ DEUX PÉRIMÈTRES DISTINCTS, ET LES CONFONDRE CASSE P13-B — c'est le
   * contrôle I10 de la checklist P13-B qui l'a rappelé, en rougissant.
   *   · CONFLIT : l'agenda qu'on ÉCRIT, un seul. L'administrateur qui pose
   *     son propre événement ne doit pas être bloqué par celui d'un coach.
   *   · LECTURE des bornes occupées : la PORTÉE P13-B — un collaborateur doit
   *     voir celles des coachs de ses élèves affectés.
   */
  assert.ok(/create or replace function public\.agenda_portee_conflit\(\)/.test(CODE));
  assert.ok(/create or replace function public\.agenda_portee_lecture\(\)/.test(CODE));
  for (const [fn, portee] of [["calendar_has_conflict", "agenda_portee_conflit"],
                              ["get_busy_ranges", "agenda_portee_lecture"]] as const) {
    const d = CODE.indexOf(`create or replace function public.${fn}`);
    assert.ok(d > 0, `${fn} doit être remplacée`);
    const corps = CODE.slice(d, CODE.indexOf("$fn$;", d));
    assert.ok(new RegExp(`${portee}\\(\\)`).test(corps), `${fn} doit être bornée par ${portee}()`);
  }
  // Et la portée de lecture est bien la portée P13-B, pas une liste à part.
  assert.ok(/from public\.coach_ids_portee\(\)/.test(
    CODE.slice(CODE.indexOf("function public.agenda_portee_lecture"))));
  // Les lignes SANS propriétaire ne bloquent que l'administrateur : les rendre
  // bloquantes pour tous recréerait le couplage qu'on corrige.
  assert.ok(/coach_id is null and p\.est_admin/.test(CODE));
});

/* ═════════════ C — CE QUI NE DOIT PAS AVOIR BOUGÉ ═════════════ */

test("C1. la migration ne change À AUCUN MOMENT le rôle actif de sa session", () => {
  /*
   * ⚠️ POURQUOI C'EST UN CONTRÔLE. La CLI Supabase enregistre le passage de
   * la migration sur la même connexion, et une bascule de rôle — même rendue
   * à son état d'origine — peut lui faire perdre les droits nécessaires
   * (« 42501 permission denied for schema supabase_migrations », déjà
   * rencontré ici).
   */
  const formesInterdites = /\bset\s+role\b|\breset\s+role\b|set_config\s*\(\s*'role'/i;
  assert.ok(!formesInterdites.test(CODE), "le code de la migration ne doit contenir aucune bascule de rôle");
  assert.ok(!formesInterdites.test(MIGRATION),
    "aucune de ces formes ne doit apparaître dans le fichier, pas même en commentaire");
});

test("C2. P13-B est intact : les policies de portée du collaborateur ne changent que de rôle", () => {
  for (const policy of ["coach_availabilities_select_portee", "coach_unavailabilities_select_portee"]) {
    assert.ok(new RegExp(`alter policy "${policy}" on public\\.\\w+ to authenticated`).test(CODE),
      `${policy} doit seulement changer de rôle`);
    assert.ok(!new RegExp(`drop policy if exists "${policy}"`).test(CODE),
      `${policy} ne doit pas être redéfinie`);
  }
  // Ni les fonctions de catégories, ni les affectations de documents.
  assert.ok(!/create or replace function public\.categories_(lecture|ecriture)/.test(CODE));
  assert.ok(!/create policy "document_assignments_/.test(CODE));
});

test("C3. les fournisseurs partagés ne sont pas touchés", () => {
  // Stripe, Brevo, Resend : aucune clé, aucun webhook, aucune configuration.
  for (const interdit of [/stripe/i, /brevo/i, /resend/i, /webhook/i]) {
    assert.ok(!interdit.test(CODE), `ce lot ne doit pas toucher à ${interdit}`);
  }
});

test("C4. et anon ne récupère l'EXECUTE d'aucune fonction interne", () => {
  assert.ok(!/grant execute on function[^;]*anon/i.test(CODE),
    "aucun EXECUTE ne doit être rendu à anon");
  assert.ok(/has_function_privilege\('anon'/.test(CODE),
    "la migration doit vérifier elle-même qu'anon n'a rien récupéré");
});

/* ═════════════ D — LE CÂBLAGE APPLICATIF ═════════════ */

test("D1. l'auteur d'un envoi est résolu côté serveur, jamais reçu du navigateur", () => {
  /*
   * ⚠️ LE POINT CLÉ DU CLOISONNEMENT DU JOURNAL. `current_staff_id()` est
   * SECURITY DEFINER et ne rend que la fiche de l'appelant. Un `coachId`
   * transmis dans le corps de la requête serait déclaratif, donc faux par
   * construction.
   */
  assert.ok(/rpc\("current_staff_id"\)/.test(AUTEUR));
  assert.ok(/sent_by_coach_id: input\.sentByCoachId \?\? null,/.test(ENVOI),
    "sendTransactionalEmail doit journaliser l'auteur");
  for (const route of ["app/api/email/content-assigned/route.ts",
                       "app/api/email/welcome/route.ts",
                       "app/api/email/subscription-assigned/route.ts",
                       "app/api/email/appointment-notification/route.ts",
                       "app/api/admin/emails/[id]/resend/route.ts"]) {
    const src = lire(route);
    assert.ok(/resoudreAuteurEnvoi\(sessionSupabase\)/.test(src),
      `${route} doit résoudre l'auteur sur la SESSION, pas sur le client service role`);
    assert.ok(/sentByCoachId: auteurEnvoi,/.test(src), `${route} doit passer l'auteur à l'envoi`);
    // ⚠️ ET SURTOUT PAS depuis le corps de la requête.
    assert.ok(!/sentByCoachId: (body|payload|req)/.test(src));
  }
});

test("D2. les réglages de réservation enregistrés sont ceux de l'appelant", () => {
  // L'ancien code relisait « la » ligne de réglages et la modifiait par son
  // id — or il n'y en avait qu'une pour tout le cabinet.
  assert.ok(/export async function saveMyBookingSettings/.test(APPOINTMENTS));
  assert.ok(!/export async function updateBookingSettings/.test(APPOINTMENTS),
    "l'ancienne fonction par identifiant ne doit plus exister");
  assert.ok(/saveMyBookingSettings\(supabase, partial\)/.test(CALENDRIER));
  // Elle n'envoie pas coach_id : le déclencheur le pose, la policy le vérifie.
  const d = APPOINTMENTS.indexOf("export async function saveMyBookingSettings");
  const corps = APPOINTMENTS.slice(d, APPOINTMENTS.indexOf("\n}", d));
  assert.ok(!/coach_id:/.test(corps), "la création ne doit pas déclarer coach_id");
});

test("D3. la zone de test a disparu de l'interface, et rien ne la remplace", () => {
  /*
   * Ce que le bouton faisait réellement, et il faut le dire : il appelait
   * `resetAdminData()`, qui efface la clé localStorage du jeu de données
   * MOCKÉ. Aucune route API, aucune action serveur, aucune ligne de base.
   * Il disparaît quand même — son libellé laissait croire le contraire.
   */
  const code = PARAMETRES.replace(/\{\/\*[\s\S]*?\*\/\}/g, "").replace(/\/\*[\s\S]*?\*\//g, "");
  assert.ok(!/Zone de test/i.test(code), "la section « Zone de test » doit avoir disparu");
  assert.ok(!/Réinitialiser les données/i.test(code), "le bouton de réinitialisation doit avoir disparu");
  assert.ok(!/resetAdminData/.test(code), "aucun point d'entrée ne doit subsister");
  assert.ok(!/handleReset/.test(code));
  // Et aucune route ni action serveur n'a jamais existé derrière.
  assert.ok(!/fetch\((["'`])\/api\/[^"'`]*reset/i.test(code));
});

/* ═════ F — LE SEAU « documents » : LE CHEMIN PORTE LE PROPRIÉTAIRE ═════ */

const CODE_SEAU = sansCommentaires(MIGRATION_SEAU);

test("F1. le chemin de stockage commence par la fiche du propriétaire, résolue en base", () => {
  /*
   * ⚠️ CE N'EST PAS FAIRE CONFIANCE AU CHEMIN. Le navigateur propose un
   * emplacement ; la policy REFUSE tout préfixe qui n'est pas la fiche de
   * l'appelant, résolue par `current_staff_id()` (SECURITY DEFINER, ne rend
   * que la sienne). Le composant d'upload, lui, ne choisit rien.
   */
  assert.ok(/rpc\("current_staff_id"\)/.test(STORAGE_DOCS),
    "la fiche doit être lue en base, pas déduite côté client");
  assert.ok(/const path = `\$\{fiche\}\/\$\{documentId\}\//.test(STORAGE_DOCS),
    "le chemin doit être <fiche_coach>/<documentId>/…");
  // Sans fiche, on échoue clairement au lieu d'écrire sous un chemin refusé.
  assert.ok(/if \(!fiche\) \{/.test(STORAGE_DOCS));
  // Et le composant ne reçoit aucun identifiant de propriétaire en propriété.
  const champ = lire("components/admin/DocumentFileUploadField.tsx");
  assert.ok(!/coachId|ownerId|proprietaire/i.test(champ),
    "le composant d'upload ne doit pas manipuler d'identifiant de propriétaire");
});

test("F2. la branche « aucune ligne n'existe » a disparu des trois policies d'écriture", () => {
  /*
   * ⚠️ C'EST LA PORTE DÉROBÉE QUE CE LOT FERME. Elle existait pour une raison
   * réelle — le fichier est téléversé AVANT la création de sa ligne — et elle
   * laissait déposer un fichier sous le chemin d'un document mort. Mesuré :
   * accepté avant, refusé après (contrôle K20 de la checklist).
   */
  for (const nom of ["documents_bucket_manage_staff", "documents_bucket_update_staff",
                     "documents_bucket_delete_staff"]) {
    const d = CODE_SEAU.indexOf(`create policy "${nom}" on storage.objects`);
    assert.ok(d > 0, `${nom} doit être redéfinie`);
    const corps = CODE_SEAU.slice(d, CODE_SEAU.indexOf(";\n", d));
    assert.ok(!/not exists/i.test(corps), `${nom} ne doit plus laisser passer « aucune ligne »`);
    assert.ok(/\(storage\.foldername\(name\)\)\[1\] = \(select public\.current_staff_id\(\)\)::text/.test(corps),
      `${nom} doit comparer le préfixe à la fiche de l'appelant`);
  }
  // ⚠️ L'UPDATE doit porter un `with check` : sans lui, un objet autorisé
  // pourrait être DÉPLACÉ sous le préfixe d'un autre coach (contrôle K11).
  const update = CODE_SEAU.slice(CODE_SEAU.indexOf('create policy "documents_bucket_update_staff"'));
  assert.ok(/with check \(/.test(update.slice(0, update.indexOf(";\n"))));
});

test("F3. l'ancienne convention reste lisible, et ses orphelins restent à l'administrateur", () => {
  // L'identifiant du document est cherché dans N'IMPORTE QUEL segment : les
  // 17 documents de production ne sont pas déplacés, et les téléchargements
  // élèves ne bougent pas.
  assert.ok(/d\.id::text = any\(storage\.foldername\(name\)\)/.test(CODE_SEAU),
    "la propriété par la ligne doit couvrir les deux formes de chemin");
  // Aucun fichier déplacé, aucune ligne réattribuée par ce lot.
  assert.ok(!/update storage\.objects/i.test(CODE_SEAU));
  assert.ok(!/delete from storage\.objects/i.test(CODE_SEAU));
  assert.ok(!/update public\.documents/i.test(CODE_SEAU));
  // Le seau reste privé : une URL publique contournerait la policy.
  assert.ok(/'documents', 'documents', false/.test(CODE_SEAU));
  assert.ok(/public = false/.test(CODE_SEAU), "la migration doit vérifier que le seau reste privé");
  // Et pas de bascule de rôle de session, ici non plus.
  assert.ok(!/\bset\s+role\b|\breset\s+role\b|set_config\s*\(\s*'role'/i.test(MIGRATION_SEAU));
});

test("F4. la checklist mesure les orphelins ET le premier téléversement", () => {
  for (const controle of [
    "K1. le coach A ne VOIT pas le fichier orphelin du coach B",
    "K4. …et il n''écrit RIEN sous le préfixe du coach B (chemin forgé)",
    "K6. le coach B VOIT son fichier orphelin",
    "K8. le PREMIER téléversement d''un document neuf fonctionne (aucune ligne en base)",
    "K11. le coach A ne DÉPLACE pas son fichier sous le préfixe du coach B",
    "K14. l''administrateur, lui, le voit — il reste à lui jusqu''à décision métier",
    "K17. l''élève du coach A l''obtient aussi (téléchargement conservé)",
    "K19. et un ÉLÈVE n''écrit rien dans le seau",
    "K20. le coach A ne DÉPOSE rien sous le chemin d''un document qui n''existe pas (ancienne convention)",
  ]) {
    assert.ok(CHECKLIST.includes(controle), `le contrôle « ${controle} » manque à la checklist SQL`);
  }
  // ⚠️ ET LA CHECKLIST DIT CE QU'ELLE A MESURÉ, y compris que K2 et K3
  // tenaient déjà : un rapport qui surévalue la faille n'aide personne.
  assert.ok(/K2 ET K3 TENAIENT DÉJÀ AVANT CE LOT/.test(CHECKLIST));
});

/* ═════════════ E — CE QUE LA CHECKLIST SQL DOIT COUVRIR ═════════════ */

test("E1. la checklist mesure les six acteurs et les deux sens", () => {
  for (const controle of [
    "B2. le coach B n''en voit AUCUNE",
    "B7. …et elle est toujours là — c''est le défaut rapporté",
    "B9. …et le déclencheur a posé SA fiche comme propriétaire",
    "B11. le coach B ne crée RIEN au nom du coach A (requête forgée)",
    "B15. l''administrateur voit les disponibilités de tous, historique compris",
    "C4. le coach B ne MODIFIE pas l''événement de A par la RPC",
    "D1. le coach B ne modifie PAS le réglage par défaut du cabinet",
    "E2. le coach B ne voit PAS la plage occupée de l''administrateur",
    "F2. …et la RPC a posé l''agenda auquel il appartient",
    "G1. le coach B ne voit AUCUN document (il n''en a pas encore)",
    "G13. …et le fonds historique sans propriétaire (aucune régression)",
    "G18. le coach B ne voit pas le FICHIER du document de l''administrateur",
    "H2. le coach B n''en voit aucun",
    "I2. …et pas le journal d''emails",
    "J1. aucune disponibilité, et la requête aboutit",
  ]) {
    assert.ok(CHECKLIST.includes(controle), `le contrôle « ${controle} » manque à la checklist SQL`);
  }
  // Un refus rend -1, jamais 0 : la distinction est le cœur de la mesure.
  assert.ok(/UN REFUS REND -1, JAMAIS 0/.test(CHECKLIST));
  // Et la checklist ne modifie aucune règle : ce n'est pas une migration.
  assert.ok(!/alter policy|create policy|drop policy/i.test(sansCommentaires(CHECKLIST)));
  assert.ok(/\nrollback;/.test(CHECKLIST), "la checklist doit se terminer par un ROLLBACK");
});

console.log(`\n${passed} test(s) réussi(s), ${failed} échec(s).`);
if (failed > 0) process.exit(1);
