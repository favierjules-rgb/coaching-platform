import "server-only";

import type { SupabaseClient } from "@supabase/supabase-js";

import { composeProgramAssignedEmail, composePublicProgramWelcomeEmail } from "@/lib/email/templates";
import { sendTransactionalEmail } from "@/lib/email/send-transactional-email";
import { insertLegalConsent } from "@/lib/legal-consents";
import { setProgramAssignment } from "@/lib/supabase/programs";
import type { Database } from "@/types/supabase";

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
  await insertLegalConsent(supabase, {
    studentId,
    consentType: "cgv_programme",
    consentTextVersion: input.cgvConsentTextVersion,
    metadata: { program_id: input.programId },
  });
}

/** Chemin "email déjà connu" : assigne le programme au compte existant, envoie l'email "programme attribué". */
async function grantExistingStudent(
  supabase: TypedSupabaseClient,
  student: { id: string; firstName: string },
  input: ProvisionPublicProgramAccessInput,
): Promise<ProvisionPublicProgramAccessResult> {
  await setProgramAssignment(supabase, student.id, input.programId, true);
  await insertCgvConsentIfProvided(supabase, student.id, input);

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

  await setProgramAssignment(supabase, studentRow.id, input.programId, true);
  await insertCgvConsentIfProvided(supabase, studentRow.id, input);

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
