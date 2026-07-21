import "server-only";

import type { SupabaseClient } from "@supabase/supabase-js";

import { composeProgramAssignedEmail, composePublicProgramWelcomeEmail } from "@/lib/email/templates";
import { sendTransactionalEmail } from "@/lib/email/send-transactional-email";
import { hasLegalConsentForCheckoutSession, insertLegalConsent } from "@/lib/legal-consents";
import { setProgramAssignment } from "@/lib/supabase/programs";
import type { Database } from "@/types/supabase";

/**
 * Levée uniquement par le chemin checkout payant (jamais par /claim, voir
 * plus bas) quand une étape correctness-critique échoue réellement —
 * consentement non écrit, email de confirmation non envoyé, ou activation
 * non effectuée (chantier conformité juridique/RGPD, Lot E-bis technique —
 * juillet 2026). Se propage volontairement jusqu'à
 * app/api/stripe/webhook/route.ts, qui répond 500 (Stripe programme
 * automatiquement un nouvel essai) SANS marquer l'évènement "processed" —
 * voir acquirePublicProgramPurchaseEventLock / markPublicProgramPurchaseEventFailed
 * dans lib/supabase/billing.ts.
 */
export class RetryablePublicProgramProvisioningError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "RetryablePublicProgramProvisioningError";
  }
}

/**
 * Provisionnement de compte élève après achat/réclamation d'un programme
 * public (chantier module Programmation, étape 6). Point d'entrée commun
 * pour la route de paiement gratuit (/api/public/programs/[id]/claim) et le
 * webhook Stripe (achat payant, checkout.session.completed) — les deux
 * appelants passent un client Supabase **service role** (créé via
 * lib/supabase/admin.ts), jamais un client de session : cette fonction crée
 * un compte auth.users réel sans qu'aucun utilisateur ne soit connecté, ce
 * qui ne peut être fait qu'avec les droits service role.
 *
 * Deux chemins possibles, résolus par email (jamais de doublon de compte) :
 * - email déjà associé à une fiche `students` existante -> le programme est
 *   simplement assigné en plus (email "programme attribué", lien direct vers
 *   /entrainement, le destinataire a déjà ses identifiants) ;
 * - email inconnu -> nouveau compte auth (access_type "programme_seul",
 *   accès restreint à /entrainement uniquement, voir lib/supabase/guards.ts
 *   et components/student/StudentSidebar.tsx), email de bienvenue avec un
 *   lien Supabase (invite) qui connecte directement et permet de définir un
 *   mot de passe — jamais l'email Supabase par défaut, toujours le template
 *   Resend de la maison (composePublicProgramWelcomeEmail).
 *
 * Idempotent : rejouer cette fonction pour le même email/programme (retry
 * webhook) ne crée jamais de compte ni d'assignation en double
 * (setProgramAssignment vérifie déjà l'existence, l'auth invite échoue
 * proprement si le compte existe déjà — traité comme le chemin "existant" en
 * repli, voir plus bas).
 */

type TypedSupabaseClient = SupabaseClient<Database>;

export interface ProvisionPublicProgramAccessInput {
  programId: string;
  programName: string;
  coachId: string | null;
  firstName: string;
  lastName: string;
  email: string;
  /**
   * Preuve de consentement CGV (chantier conformité juridique/RGPD, lot
   * technique — juillet 2026) : présente pour les deux appelants (checkout
   * payant, via metadata Stripe ; claim gratuit, transmise directement),
   * puisque `publicProgramAccessBodySchema` rend `cgvAccepted` obligatoire
   * dans les deux cas. `undefined` uniquement en théorie (défensif) — voir
   * insertConsentIfProvided ci-dessous, qui n'écrit alors simplement rien.
   */
  cgvConsentTextVersion?: string;
  /**
   * Preuve du consentement "accès immédiat + perte du droit de
   * rétractation" (Lot E-bis, case unique) — présente uniquement pour
   * l'appelant checkout payant (publicProgramCheckoutBodySchema la rend
   * obligatoire) ; toujours `undefined` côté claim gratuit, qui n'a pas de
   * paiement à rétracter et ne concerne jamais un abonnement de coaching
   * (flux entièrement séparé, voir create-checkout-session).
   */
  immediateAccessAndWaiverConsentTextVersion?: string;
  /**
   * Identifiant de la session Stripe Checkout à l'origine de l'achat — sert
   * de référence de commande dans le `metadata` des lignes `legal_consents`
   * (voir insertCgvConsentIfProvided / insertImmediateAccessAndWaiverConsentIfProvided
   * ci-dessous). `undefined` côté claim gratuit, qui n'a pas de session
   * Stripe.
   */
  checkoutSessionId?: string;
  /**
   * Hook optionnel invoqué juste après l'écriture des lignes de
   * consentement, et strictement avant `setProgramAssignment` (activation
   * de l'accès) — utilisé exclusivement par le webhook Stripe pour envoyer
   * l'email de confirmation de commande "sur support durable" à ce point
   * précis de la séquence (consentements enregistrés → confirmation
   * envoyée → accès activé). `undefined` côté claim gratuit.
   *
   * Depuis la correction de la fenêtre d'échec (Lot E-bis, suite audit) :
   * l'implémentation fournie par le webhook (voir webhook-handlers.ts) REJETTE
   * explicitement si `sendTransactionalEmail` renvoie `status: "failed"` — ce
   * rejet n'est volontairement PAS intercepté ici, il se propage jusqu'à
   * `grantExistingStudent`/`createProgramOnlyStudent`, empêchant
   * `setProgramAssignment` de s'exécuter, jusqu'au webhook Stripe qui répond
   * 500 (retry automatique, évènement jamais marqué "processed"). Un
   * `status: "skipped"` (EMAILS_ENABLED=false, ou Resend non configuré —
   * état délibéré, pas une panne) n'est PAS traité comme un échec : bloquer
   * l'accès d'un client qui a payé parce qu'un environnement a
   * volontairement désactivé l'envoi serait pire que l'inverse.
   */
  onConsentsRecorded?: (studentId: string) => Promise<void>;
}

export interface ProvisionPublicProgramAccessResult {
  studentId: string;
  isNewAccount: boolean;
}

function appUrl(): string {
  return process.env.NEXT_PUBLIC_APP_URL || "";
}

function devError(context: string, error: { message: string } | null): void {
  if (error) {
    console.error(`[Supabase] ${context} : ${error.message}`);
  }
}

/** Fiche `students` par email (insensible à la casse) — `null` si aucun compte élève n'existe encore pour cet email. */
async function findStudentByEmail(supabase: TypedSupabaseClient, email: string): Promise<{ id: string; userId: string | null; firstName: string } | null> {
  const { data, error } = await supabase.from("students").select("id, user_id, first_name").ilike("email", email).maybeSingle();
  devError("findStudentByEmail", error);
  if (!data) return null;
  return { id: data.id, userId: data.user_id, firstName: data.first_name };
}

/**
 * Écrit la preuve de consentement CGV si une version a été transmise —
 * n'échoue jamais l'appelant (voir insertLegalConsent), commun aux deux
 * chemins ci-dessous puisqu'un achat reste un achat, que le compte soit
 * neuf ou déjà existant.
 */
async function insertCgvConsentIfProvided(
  supabase: TypedSupabaseClient,
  studentId: string,
  input: ProvisionPublicProgramAccessInput,
): Promise<void> {
  if (!input.cgvConsentTextVersion) return;
  // Dédoublonnage par commande (chantier conformité juridique/RGPD, Lot
  // E-bis technique) : n'a de sens que côté payant (checkoutSessionId
  // présent) — un retry du webhook Stripe rejouant cette fonction ne doit
  // jamais écrire une seconde ligne pour le même achat. Le chemin gratuit
  // (/claim, checkoutSessionId absent) insère toujours directement, comme
  // avant : il n'est jamais rejoué par un webhook.
  if (input.checkoutSessionId) {
    const alreadyRecorded = await hasLegalConsentForCheckoutSession(supabase, input.checkoutSessionId, "cgv_programme");
    if (alreadyRecorded) return;
  }
  const inserted = await insertLegalConsent(supabase, {
    studentId,
    consentType: "cgv_programme",
    consentTextVersion: input.cgvConsentTextVersion,
    metadata: {
      checkout_session_id: input.checkoutSessionId ?? null,
      program_id: input.programId,
      consent_text_version: input.cgvConsentTextVersion,
      consent_type: "cgv_programme",
    },
  });
  if (inserted) return;

  // Échec de l'insert : avant de le traiter comme une vraie panne, on
  // revérifie si une insertion CONCURRENTE vient de gagner la course entre
  // le hasLegalConsentForCheckoutSession ci-dessus et cet insert (fenêtre de
  // course résiduelle du lookup-avant-insert, vérification des garanties DB
  // réelles suite audit). Si la ligne existe maintenant, ce n'est pas un
  // échec : idempotent, ne pas lever d'erreur retryable.
  //
  // IMPORTANT — cette relecture ne ferme la fenêtre que lorsque la table
  // `legal_consents` possède réellement une contrainte d'unicité sur
  // (consent_type, metadata->>'checkout_session_id'), ce qui N'EST PAS
  // encore le cas aujourd'hui (voir supabase/schema.sql : seul un index sur
  // student_id existe). Sans cette contrainte, deux insertions concurrentes
  // peuvent toutes les deux réussir (rien ne les en empêche côté DB), donc
  // toutes les deux passer `inserted === true` plus haut sans jamais
  // atteindre ce code — un doublon resterait possible. La migration
  // minimale nécessaire pour fermer complètement cette fenêtre est présentée
  // (non appliquée) dans le rapport à Jules ; ce code est déjà prêt à la
  // recevoir : dès qu'elle existe, l'insert perdant échouera réellement (23505)
  // et sera correctement absorbé ici.
  if (input.checkoutSessionId) {
    const nowRecorded = await hasLegalConsentForCheckoutSession(supabase, input.checkoutSessionId, "cgv_programme");
    if (nowRecorded) return;
    throw new RetryablePublicProgramProvisioningError(
      `Échec de l'enregistrement du consentement CGV (session ${input.checkoutSessionId}).`,
    );
  }
  // N'échoue le provisionnement QUE côté payant : c'est là que la preuve de
  // consentement doit exister avant d'activer l'accès. Côté gratuit,
  // insertLegalConsent garde son contrat historique ("ne fait jamais
  // échouer l'appelant") — comportement inchangé, hors périmètre de cette
  // correction.
}

/**
 * Même logique que ci-dessus, pour le consentement "accès immédiat + perte
 * du droit de rétractation" (Lot E-bis, case unique — le nom de fonction et
 * le consent_type restent volontairement "retractation" côté base pour ne
 * jamais renommer une valeur déjà écrite dans des lignes historiques ;
 * seuls le texte affiché et le champ applicatif ont changé de nom, voir
 * lib/legal-consents.ts).
 */
async function insertImmediateAccessAndWaiverConsentIfProvided(
  supabase: TypedSupabaseClient,
  studentId: string,
  input: ProvisionPublicProgramAccessInput,
): Promise<void> {
  if (!input.immediateAccessAndWaiverConsentTextVersion) return;
  // Même dédoublonnage par commande que insertCgvConsentIfProvided ci-dessus.
  if (input.checkoutSessionId) {
    const alreadyRecorded = await hasLegalConsentForCheckoutSession(supabase, input.checkoutSessionId, "retractation_programme");
    if (alreadyRecorded) return;
  }
  const inserted = await insertLegalConsent(supabase, {
    studentId,
    consentType: "retractation_programme",
    consentTextVersion: input.immediateAccessAndWaiverConsentTextVersion,
    metadata: {
      checkout_session_id: input.checkoutSessionId ?? null,
      program_id: input.programId,
      consent_text_version: input.immediateAccessAndWaiverConsentTextVersion,
      consent_type: "retractation_programme",
    },
  });
  if (inserted) return;

  // Même relecture après échec que insertCgvConsentIfProvided ci-dessus —
  // voir son commentaire pour le détail (course concurrente possible /
  // migration de contrainte unique présentée mais pas encore appliquée).
  if (input.checkoutSessionId) {
    const nowRecorded = await hasLegalConsentForCheckoutSession(supabase, input.checkoutSessionId, "retractation_programme");
    if (nowRecorded) return;
    throw new RetryablePublicProgramProvisioningError(
      `Échec de l'enregistrement du consentement accès immédiat/rétractation (session ${input.checkoutSessionId}).`,
    );
  }
}

/**
 * Chemin "email déjà connu" : enregistre les consentements, déclenche la
 * confirmation de commande (webhook uniquement, via onConsentsRecorded),
 * PUIS assigne le programme (activation) et envoie l'email "programme
 * attribué" — ordre imposé par Jules (preuve + confirmation avant accès).
 * Chaque étape correctness-critique est vérifiée : côté payant
 * (checkoutSessionId présent), un échec lève RetryablePublicProgramProvisioningError
 * et n'active JAMAIS l'accès — voir le docblock de cette classe plus haut.
 */
async function grantExistingStudent(
  supabase: TypedSupabaseClient,
  student: { id: string; firstName: string },
  input: ProvisionPublicProgramAccessInput,
): Promise<ProvisionPublicProgramAccessResult> {
  await insertCgvConsentIfProvided(supabase, student.id, input);
  await insertImmediateAccessAndWaiverConsentIfProvided(supabase, student.id, input);
  await input.onConsentsRecorded?.(student.id);
  const assigned = await setProgramAssignment(supabase, student.id, input.programId, true);
  if (!assigned && input.checkoutSessionId) {
    throw new RetryablePublicProgramProvisioningError(`Échec de l'activation de l'accès au programme (session ${input.checkoutSessionId}).`);
  }

  const { data: studentRow } = await supabase.from("students").select("email").eq("id", student.id).maybeSingle();
  const recipientEmail = studentRow?.email || input.email;
  if (recipientEmail) {
    const email = composeProgramAssignedEmail({
      firstName: student.firstName || input.firstName,
      programName: input.programName,
      startDate: null,
      trainingUrl: `${appUrl()}/entrainement`,
    });
    await sendTransactionalEmail(supabase, {
      emailType: "program_assigned",
      recipientEmail,
      subject: email.subject,
      html: email.html,
      text: email.text,
      relatedEntityType: "program",
      relatedEntityId: input.programId,
      metadata: { source: "public_program_purchase" },
    });
  }

  return { studentId: student.id, isNewAccount: false };
}

/**
 * Chemin "email inconnu" : crée le compte auth (invite) + profils + fiche
 * élève (access_type "programme_seul") + assignation, envoie l'email de
 * bienvenue avec le lien de définition de mot de passe.
 */
async function createProgramOnlyStudent(
  supabase: TypedSupabaseClient,
  input: ProvisionPublicProgramAccessInput,
): Promise<ProvisionPublicProgramAccessResult | null> {
  const { data: linkData, error: linkError } = await supabase.auth.admin.generateLink({
    type: "invite",
    email: input.email,
    // Passe par /reinitialiser-mot-de-passe (jamais /entrainement
    // directement) pour que ce compte ait un vrai mot de passe utilisable
    // ensuite — un lien d'invite est à usage unique, sans ça l'accès de cet
    // acheteur ne durerait pas dans le temps. La page redirige elle-même
    // vers /dashboard une fois le mot de passe défini, qui renvoie vers
    // /entrainement pour un compte "programme_seul" (voir guards.ts).
    options: { redirectTo: `${appUrl()}/reinitialiser-mot-de-passe` },
  });

  if (linkError || !linkData?.user) {
    // Cas limite : un compte auth existe déjà pour cet email sans fiche
    // `students` correspondante (ex : compte créé manuellement puis jamais
    // relié). On ne peut pas créer de doublon auth.users — on log clairement
    // pour une intervention manuelle plutôt que d'échouer silencieusement.
    console.error(
      `[public-program-provisioning] Échec de création du compte pour ${input.email} : ${linkError?.message ?? "utilisateur introuvable"}. Intervention manuelle probablement nécessaire (compte auth déjà existant sans fiche élève ?).`,
    );
    return null;
  }

  const authUserId = linkData.user.id;
  // token_hash plutôt que action_link (hébergé par Supabase) : ce dernier
  // tronque le chemin de redirectTo dès qu'il ne correspond pas exactement
  // à la liste "Redirect URLs" du dashboard — voir le commentaire détaillé
  // dans ResetPasswordForm.tsx, qui échange ce jeton via verifyOtp().
  const actionLink = linkData.properties?.hashed_token
    ? `${appUrl()}/reinitialiser-mot-de-passe?token_hash=${encodeURIComponent(linkData.properties.hashed_token)}&type=invite`
    : `${appUrl()}/connexion`;

  const { error: profileError } = await supabase.from("profiles").insert({
    user_id: authUserId,
    role: "student",
    first_name: input.firstName,
    last_name: input.lastName,
    email: input.email,
  });
  devError("createProgramOnlyStudent (profiles)", profileError);

  const { data: studentRow, error: studentError } = await supabase
    .from("students")
    .insert({
      user_id: authUserId,
      coach_id: input.coachId,
      first_name: input.firstName,
      last_name: input.lastName,
      email: input.email,
      status: "active",
      start_date: new Date().toISOString().slice(0, 10),
      access_type: "programme_seul",
    })
    .select("id")
    .single();
  devError("createProgramOnlyStudent (students)", studentError);
  if (!studentRow) {
    return null;
  }

  // Ordre imposé par Jules : consentements enregistrés puis confirmation de
  // commande envoyée (onConsentsRecorded, webhook uniquement) avant
  // d'activer l'accès au programme — même séquence, mêmes vérifications
  // explicites, que grantExistingStudent ci-dessus.
  await insertCgvConsentIfProvided(supabase, studentRow.id, input);
  await insertImmediateAccessAndWaiverConsentIfProvided(supabase, studentRow.id, input);
  await input.onConsentsRecorded?.(studentRow.id);
  const assigned = await setProgramAssignment(supabase, studentRow.id, input.programId, true);
  if (!assigned && input.checkoutSessionId) {
    throw new RetryablePublicProgramProvisioningError(`Échec de l'activation de l'accès au programme (session ${input.checkoutSessionId}).`);
  }

  const email = composePublicProgramWelcomeEmail({
    firstName: input.firstName,
    programName: input.programName,
    setPasswordUrl: actionLink,
  });
  await sendTransactionalEmail(supabase, {
    emailType: "welcome",
    recipientEmail: input.email,
    recipientUserId: authUserId,
    subject: email.subject,
    html: email.html,
    text: email.text,
    relatedEntityType: "program",
    relatedEntityId: input.programId,
    metadata: { source: "public_program_purchase" },
  });

  return { studentId: studentRow.id, isNewAccount: true };
}

/** Point d'entrée unique — voir la documentation du fichier. */
export async function provisionPublicProgramAccess(
  supabase: TypedSupabaseClient,
  input: ProvisionPublicProgramAccessInput,
): Promise<ProvisionPublicProgramAccessResult | null> {
  const normalizedEmail = input.email.trim().toLowerCase();
  const existing = await findStudentByEmail(supabase, normalizedEmail);
  if (existing) {
    return grantExistingStudent(supabase, { id: existing.id, firstName: existing.firstName }, { ...input, email: normalizedEmail });
  }
  return createProgramOnlyStudent(supabase, { ...input, email: normalizedEmail });
}
