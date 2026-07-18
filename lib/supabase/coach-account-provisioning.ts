import "server-only";

import type { SupabaseClient } from "@supabase/supabase-js";

import { composeCollaboratorInviteEmail } from "@/lib/email/templates";
import { sendTransactionalEmail } from "@/lib/email/send-transactional-email";
import type { Database } from "@/types/supabase";

/**
 * Provisioning réel des comptes collaborateurs (admin/coach) ajoutés depuis
 * /admin/parametres — reprend le même schéma que
 * lib/supabase/coach-student-provisioning.ts (invite + token_hash +
 * verifyOtp, jamais action_link, voir le commentaire détaillé dans
 * ResetPasswordForm.tsx) et lib/supabase/delete-student.ts (suppression
 * réelle via l'Admin API), appliqué ici à la table `coaches` plutôt que
 * `students`.
 *
 * Avant ce chantier, la table `coaches` existait déjà dans le schéma
 * (RLS déjà en place) mais n'était jamais alimentée — /admin/parametres
 * gérait une liste 100% mockée (localStorage) sans aucun compte réel ni
 * email envoyé.
 */

type TypedSupabaseClient = SupabaseClient<Database>;

function devError(context: string, error: { message: string } | null): void {
  if (error) {
    console.error(`[Supabase] ${context} : ${error.message}`);
  }
}

function appUrl(): string {
  return process.env.NEXT_PUBLIC_APP_URL || "";
}

export interface CreateCoachAccountInput {
  firstName: string;
  lastName: string;
  email: string;
  role: "admin" | "assistant";
  speciality: string;
  /** Prénom/nom (ou email) de l'admin connecté à l'origine de l'invitation, pour l'email envoyé. */
  requestingUserName: string;
}

export type CreateCoachAccountResult =
  | { ok: true; coachId: string }
  | { ok: false; error: "email_already_used" | "auth_error" | "insert_error" };

export async function createCoachAccount(
  supabase: TypedSupabaseClient,
  input: CreateCoachAccountInput,
): Promise<CreateCoachAccountResult> {
  const email = input.email.trim().toLowerCase();

  const { data: existingCoach } = await supabase.from("coaches").select("id").ilike("email", email).maybeSingle();
  if (existingCoach) {
    return { ok: false, error: "email_already_used" };
  }
  const { data: existingProfile } = await supabase.from("profiles").select("user_id").ilike("email", email).maybeSingle();
  if (existingProfile) {
    return { ok: false, error: "email_already_used" };
  }

  const { data: linkData, error: linkError } = await supabase.auth.admin.generateLink({
    type: "invite",
    email,
    options: { redirectTo: `${appUrl()}/reinitialiser-mot-de-passe` },
  });
  if (linkError || !linkData?.user) {
    console.error(
      `[coach-account-provisioning] Échec de création du compte pour ${email} : ${linkError?.message ?? "utilisateur introuvable"}. Un compte auth existe peut-être déjà.`,
    );
    return { ok: false, error: "auth_error" };
  }

  const authUserId = linkData.user.id;
  // Construit l'URL nous-mêmes (token_hash) plutôt que d'utiliser
  // linkData.properties.action_link (hébergé par Supabase) — voir le
  // commentaire détaillé dans coach-student-provisioning.ts /
  // ResetPasswordForm.tsx sur la troncature de redirect_to par GoTrue.
  const actionLink = linkData.properties?.hashed_token
    ? `${appUrl()}/reinitialiser-mot-de-passe?token_hash=${encodeURIComponent(linkData.properties.hashed_token)}&type=invite`
    : `${appUrl()}/connexion`;

  const { error: profileError } = await supabase.from("profiles").insert({
    user_id: authUserId,
    // Toujours "coach" ici, jamais "admin" : "admin" reste réservé au
    // compte principal existant. Sans incidence sur les droits réels
    // (is_coach_or_admin() traite coach et admin de façon identique) — le
    // champ `role` choisi dans le formulaire (Admin/Assistant) n'alimente
    // que `coaches.role`, un libellé d'organisation, jamais `profiles.role`.
    role: "coach",
    first_name: input.firstName,
    last_name: input.lastName,
    email,
  });
  devError("createCoachAccount (profiles)", profileError);

  const { data: coachRow, error: coachError } = await supabase
    .from("coaches")
    .insert({
      user_id: authUserId,
      name: `${input.firstName} ${input.lastName}`.trim(),
      email,
      role: input.role,
      status: "actif",
      specialty: input.speciality,
    })
    .select("id")
    .single();
  devError("createCoachAccount (coaches)", coachError);
  if (!coachRow) {
    return { ok: false, error: "insert_error" };
  }

  const inviteEmail = composeCollaboratorInviteEmail({
    firstName: input.firstName,
    ownerName: input.requestingUserName,
    setPasswordUrl: actionLink,
  });
  await sendTransactionalEmail(supabase, {
    emailType: "collaborator_invite",
    recipientEmail: email,
    recipientUserId: authUserId,
    subject: inviteEmail.subject,
    html: inviteEmail.html,
    text: inviteEmail.text,
    relatedEntityType: "coach",
    relatedEntityId: coachRow.id,
    metadata: { source: "admin_create_coach" },
  });

  return { ok: true, coachId: coachRow.id };
}

export type DeleteCoachAccountResult =
  | { ok: true }
  | { ok: false; error: "not_found" | "cannot_delete_self" | "delete_error" };

/**
 * Suppression réelle et définitive d'un compte collaborateur. Bloquée si
 * `requestingUserId` correspond au compte visé (jamais de suicide de
 * session côté admin) — vérifié ici plutôt que côté UI uniquement, pour
 * rester valable même si l'appel API est fait directement.
 */
export async function deleteCoachAccount(
  supabase: TypedSupabaseClient,
  coachId: string,
  requestingUserId: string,
): Promise<DeleteCoachAccountResult> {
  const { data: coach, error: fetchError } = await supabase.from("coaches").select("user_id").eq("id", coachId).maybeSingle();
  devError("deleteCoachAccount (fetch)", fetchError);
  if (!coach) {
    return { ok: false, error: "not_found" };
  }
  if (coach.user_id && coach.user_id === requestingUserId) {
    return { ok: false, error: "cannot_delete_self" };
  }

  const { error: deleteError } = await supabase.from("coaches").delete().eq("id", coachId);
  devError("deleteCoachAccount (delete coaches)", deleteError);
  if (deleteError) {
    return { ok: false, error: "delete_error" };
  }

  if (coach.user_id) {
    // Cascade : profiles.user_id -> auth.users(id) ON DELETE CASCADE
    // (voir migration). Best-effort comme deleteStudentCompletely : la
    // ligne `coaches` est déjà supprimée à ce stade (essentiel de la
    // demande), un échec ici laisse un compte auth orphelin, journalisé
    // pour intervention manuelle.
    const { error: authError } = await supabase.auth.admin.deleteUser(coach.user_id);
    if (authError) {
      console.error(`[coach-account-provisioning] Échec de suppression du compte auth ${coach.user_id} : ${authError.message}. Ligne coach déjà supprimée — intervention manuelle possible.`);
    }
  }

  return { ok: true };
}
