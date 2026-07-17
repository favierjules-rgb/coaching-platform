import "server-only";

import type { SupabaseClient } from "@supabase/supabase-js";

import { composeCoachInviteEmail } from "@/lib/email/templates";
import { sendTransactionalEmail } from "@/lib/email/send-transactional-email";
import { getPrimaryCoachInfo } from "@/lib/supabase/appointments";
import { updateStudentOnboardingDetails } from "@/lib/supabase/onboarding";
import { addCoachNoteSupabase } from "@/lib/supabase/students";
import type { Database } from "@/types/supabase";

/**
 * Création réelle d'un élève "coaching" (classique, par opposition au
 * compte "programme_seul" auto-créé après achat public — voir
 * lib/supabase/public-program-provisioning.ts, dont ce fichier reprend le
 * même schéma général) depuis l'admin (CreateStudentModal, /admin/eleves).
 *
 * Avant ce chantier, CreateStudentModal n'écrivait que dans le store mock
 * (localStorage, useAdminData) — aucun compte Supabase réel n'était créé et
 * aucun email n'était envoyé. Ce module remplace ce flux par une vraie
 * création : auth.users (invite) + profiles + students + student_profiles
 * (pré-remplie avec les champs déjà saisis par le coach dans le formulaire,
 * skipEmptyFields: true pour ne jamais écraser plus tard une réponse déjà
 * donnée par l'élève) + coach_notes optionnelle, puis email d'invitation
 * (composeCoachInviteEmail) avec un lien de définition de mot de passe.
 *
 * Le questionnaire d'onboarding reste obligatoire par construction : le
 * guard requireStudent (lib/supabase/guards.ts) redirige vers /onboarding
 * tant que `student_profiles.onboarding_completed` n'est pas vrai — cette
 * fonction ne le met jamais à `true`, quels que soient les champs
 * pré-remplis par le coach.
 */

type TypedSupabaseClient = SupabaseClient<Database>;

export interface CreateCoachingStudentInput {
  firstName: string;
  lastName: string;
  email: string;
  phone: string;
  age: number;
  heightCm: number;
  currentWeightKg: number;
  goal: string;
  level: string;
  trainingFrequencyPerWeek: number;
  trainingLocation: string;
  foodPreferences: string;
  intolerances: string[];
  injuries: string;
  coachNotes: string;
  /** user_id du coach connecté à l'origine de la création (pour résoudre coach_id). */
  requestingUserId: string | null;
}

export type CreateCoachingStudentResult =
  | { ok: true; studentId: string }
  | { ok: false; error: "email_already_used" | "auth_error" | "insert_error" };

function devError(context: string, error: { message: string } | null): void {
  if (error) {
    console.error(`[Supabase] ${context} : ${error.message}`);
  }
}

function appUrl(): string {
  return process.env.NEXT_PUBLIC_APP_URL || "";
}

/** id `coaches` du compte connecté s'il en a un, sinon le coach principal (le plus ancien) — jamais null si au moins un coach existe. */
async function resolveCoachId(supabase: TypedSupabaseClient, requestingUserId: string | null): Promise<string | null> {
  if (requestingUserId) {
    const { data } = await supabase.from("coaches").select("id").eq("user_id", requestingUserId).maybeSingle();
    if (data) return data.id;
  }
  const { data } = await supabase.from("coaches").select("id").order("created_at", { ascending: true }).limit(1).maybeSingle();
  return data?.id ?? null;
}

export async function createCoachingStudent(
  supabase: TypedSupabaseClient,
  input: CreateCoachingStudentInput,
): Promise<CreateCoachingStudentResult> {
  const email = input.email.trim().toLowerCase();

  const { data: existing } = await supabase.from("students").select("id").ilike("email", email).maybeSingle();
  if (existing) {
    return { ok: false, error: "email_already_used" };
  }

  const { data: linkData, error: linkError } = await supabase.auth.admin.generateLink({
    type: "invite",
    email,
    // Comme public-program-provisioning.ts : passe par
    // /reinitialiser-mot-de-passe (jamais /entrainement ou /dashboard
    // directement) pour que ce compte reparte avec un vrai mot de passe
    // utilisable ensuite, pas seulement un lien d'invite à usage unique.
    options: { redirectTo: `${appUrl()}/reinitialiser-mot-de-passe` },
  });
  if (linkError || !linkData?.user) {
    console.error(
      `[coach-student-provisioning] Échec de création du compte pour ${email} : ${linkError?.message ?? "utilisateur introuvable"}. Un compte auth existe peut-être déjà sans fiche élève correspondante.`,
    );
    return { ok: false, error: "auth_error" };
  }

  const authUserId = linkData.user.id;
  // On construit l'URL nous-mêmes (token_hash) plutôt que d'utiliser
  // linkData.properties.action_link (hébergé par Supabase) : ce dernier
  // tronque le chemin de redirectTo dès qu'il ne correspond pas exactement
  // à la liste "Redirect URLs" du dashboard — voir le commentaire détaillé
  // dans ResetPasswordForm.tsx, qui échange ce jeton via verifyOtp().
  const actionLink = linkData.properties?.hashed_token
    ? `${appUrl()}/reinitialiser-mot-de-passe?token_hash=${encodeURIComponent(linkData.properties.hashed_token)}&type=invite`
    : `${appUrl()}/connexion`;

  const coachId = await resolveCoachId(supabase, input.requestingUserId);

  const { error: profileError } = await supabase.from("profiles").insert({
    user_id: authUserId,
    role: "student",
    first_name: input.firstName,
    last_name: input.lastName,
    email,
  });
  devError("createCoachingStudent (profiles)", profileError);

  const { data: studentRow, error: studentError } = await supabase
    .from("students")
    .insert({
      user_id: authUserId,
      coach_id: coachId,
      first_name: input.firstName,
      last_name: input.lastName,
      email,
      phone: input.phone,
      status: "active",
      start_date: new Date().toISOString().slice(0, 10),
      // access_type omis volontairement : défaut DB "coaching".
    })
    .select("id")
    .single();
  devError("createCoachingStudent (students)", studentError);
  if (!studentRow) {
    return { ok: false, error: "insert_error" };
  }

  const studentId = studentRow.id;

  // Pré-remplissage best-effort des réponses déjà données par le coach dans
  // le formulaire de création — skipEmptyFields: true pour ne jamais écrire
  // de champ vide par-dessus une réponse que l'élève aura déjà donnée d'ici
  // qu'il complète son onboarding.
  await updateStudentOnboardingDetails(
    supabase,
    studentId,
    {
      mainGoal: input.goal,
      level: input.level,
      trainingFrequencyPerWeek: input.trainingFrequencyPerWeek > 0 ? input.trainingFrequencyPerWeek : undefined,
      trainingLocation: input.trainingLocation,
      dietType: input.foodPreferences,
      intolerances: input.intolerances,
      injuries: input.injuries,
      age: input.age > 0 ? input.age : undefined,
      heightCm: input.heightCm > 0 ? input.heightCm : undefined,
      currentWeightKg: input.currentWeightKg > 0 ? input.currentWeightKg : undefined,
      startWeightKg: input.currentWeightKg > 0 ? input.currentWeightKg : undefined,
    },
    { skipEmptyFields: true },
  );

  if (input.coachNotes.trim()) {
    await addCoachNoteSupabase(supabase, studentId, input.coachNotes.trim());
  }

  const coach = await getPrimaryCoachInfo(supabase);
  const inviteEmail = composeCoachInviteEmail({ firstName: input.firstName, coachName: coach.name, setPasswordUrl: actionLink });
  await sendTransactionalEmail(supabase, {
    emailType: "coach_invite",
    recipientEmail: email,
    recipientUserId: authUserId,
    subject: inviteEmail.subject,
    html: inviteEmail.html,
    text: inviteEmail.text,
    relatedEntityType: "student",
    relatedEntityId: studentId,
    metadata: { source: "admin_create_student" },
  });

  return { ok: true, studentId };
}
