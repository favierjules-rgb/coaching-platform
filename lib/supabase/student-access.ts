import type { SupabaseClient } from "@supabase/supabase-js";

import { computeStudentAccess } from "@/lib/stripe/access-status";
import { getSubscriptionForStudent } from "@/lib/supabase/billing";
import type { BillingAccessMode, StudentAccessReason, StudentAccessStatus } from "@/types";
import type { Database } from "@/types/supabase";

/**
 * Accès conditionnel aux pages élève (chantier "supabase-stripe-access-control") :
 * entraînement/nutrition/documents/progression nécessitent un abonnement
 * Stripe actif, sauf dérogation manuelle du coach. Le statut Stripe
 * (`subscriptions.status`) reste l'unique source de vérité — jamais
 * recalculé et stocké comme un simple booléen "actif" qui deviendrait
 * obsolète si Stripe change côté serveur : `getStudentAccessStatus`
 * recalcule à chaque appel à partir de la ligne `subscriptions` la plus
 * récente et du `billing_access_mode` courant. Le calcul pur lui-même
 * (`computeStudentAccess`) vit dans lib/stripe/access-status.ts (aucune
 * dépendance Supabase, réutilisé tel quel par lib/supabase/billing.ts pour
 * /admin/paiements sans import circulaire) et est ré-exporté ici pour les
 * appelants existants.
 *
 * Pas de `server-only` ici (contrairement à lib/supabase/guards.ts) :
 * `getStudentAccessStatus` prend un client déjà résolu en paramètre et est
 * utilisée aussi bien côté navigateur (hook élève, cadenas de menu) que
 * côté serveur (guard) — voir lib/supabase/guards.ts::requireActiveStudentAccess
 * pour la résolution serveur de l'élève connecté.
 */

export { computeStudentAccess };

type TypedSupabaseClient = SupabaseClient<Database>;

export interface ResolutionModeAcces {
  /** `billing_access_mode` de l'élève, `null` si AUCUNE fiche ne lui correspond. */
  mode: BillingAccessMode | null;
  /** `true` si la lecture a ÉCHOUÉ — à ne jamais confondre avec « aucune fiche ». */
  lectureEchouee: boolean;
}

/**
 * LE MODE DE FACTURATION, PAR LA LECTURE LA PLUS ÉTROITE POSSIBLE.
 *
 * ⚠️ DEUX COLONNES, ET PAS UNE DE PLUS — c'est la leçon du blocage du 18/10.
 * Le contrôle d'accès passait par `getStudentProfile`, qui lit la fiche
 * ENTIÈRE (87 colonnes, via `student_profiles_lisible`). Le jour où un
 * privilège de colonne a changé sur `student_profiles`, la requête complète
 * est tombée en `42501 permission denied for table student_profiles` — et
 * comme un profil illisible valait « pas de mode », tous les élèves en
 * `manual_allowed` ont basculé en « abonnement requis », donc bloqués.
 * Relevé dans les journaux Supabase : 277 refus, du 18/10 11:53 au 19/10.
 *
 * `student_id` et `billing_access_mode` sont les seules colonnes dont ce
 * contrôle a besoin, et les seules qu'il nomme. Une fermeture de colonne
 * ailleurs dans la table ne peut plus l'atteindre.
 *
 * ⚠️ ET ON DISTINGUE L'ÉCHEC DE L'ABSENCE. Zéro ligne (aucune fiche, ou RLS
 * qui filtre) rend `mode: null` : l'élève retombe sur la règle normale du
 * produit. Une ERREUR rend `lectureEchouee: true` : on ne sait pas, et on ne
 * le fera pas payer d'une porte fermée.
 */
export async function lireModeAccesFacturation(
  supabase: TypedSupabaseClient,
  studentId: string,
): Promise<ResolutionModeAcces> {
  const { data, error } = await supabase
    .from("student_profiles")
    .select("student_id, billing_access_mode")
    .eq("student_id", studentId)
    .maybeSingle();
  if (error) {
    console.error(`[Accès élève] lecture du mode de facturation impossible : ${error.message}`);
    return { mode: null, lectureEchouee: true };
  }
  const brut = (data as { billing_access_mode?: unknown } | null)?.billing_access_mode;
  return {
    mode: brut === "manual_allowed" || brut === "manual_blocked" || brut === "subscription_required" ? brut : null,
    lectureEchouee: false,
  };
}

/**
 * Statut d'accès de l'élève : mode de facturation + abonnement le plus
 * récent. Utilisable côté navigateur (RLS) ou serveur.
 *
 * ⚠️ UNE LECTURE QUI ÉCHOUE N'EST PAS UNE ABSENCE DE FORMULE, et c'est tout
 * l'objet du correctif. Le contenu protégé reste FERMÉ — on n'accorde rien
 * sur une panne — mais le refus porte sa propre raison, `indetermine`, et
 * conduit à un écran d'INDISPONIBILITÉ TEMPORAIRE avec un bouton Réessayer,
 * jamais à « aucune formule attribuée ». Dire à 34 élèves en accès manuel
 * autorisé qu'ils n'ont pas de formule était faux, et c'est ce mensonge-là
 * qui a fait perdre une journée.
 *
 * Trois verdicts, donc, et jamais deux : autorisé, refusé par la règle,
 * indéterminable. Le même principe gouverne déjà `useStaffContext`
 * (`mecanismeIndisponible`).
 */
export async function getStudentAccessStatus(supabase: TypedSupabaseClient, studentId: string): Promise<StudentAccessStatus> {
  const [resolution, subscription] = await Promise.all([
    lireModeAccesFacturation(supabase, studentId),
    getSubscriptionForStudent(supabase, studentId),
  ]);
  const subscriptionStatus = subscription?.status ?? null;

  if (resolution.lectureEchouee) {
    console.error(
      "[Accès élève] mode de facturation indéterminable : accès NON accordé, " +
        "et l'élève est renvoyé vers un écran d'indisponibilité temporaire, jamais " +
        "vers « aucune formule attribuée ». Ce message signale une panne à corriger.",
    );
    return { allowed: false, reason: "indetermine", accessMode: "subscription_required", subscriptionStatus };
  }

  return computeStudentAccess(resolution.mode ?? "subscription_required", subscriptionStatus);
}

export interface UpdateStudentAccessInput {
  billingAccessMode: BillingAccessMode;
  /** Modèle attribué (chantier "supabase-subscription-templates") — source de vérité pour la formule ; `assigned_stripe_plan`/`assigned_stripe_price_id` sont recopiés depuis ce modèle pour compatibilité descendante (affichage), jamais l'inverse. */
  assignedSubscriptionTemplateId: string | null;
  accessNote: string;
}

/** Écriture admin (bloc "Accès au site" de la fiche élève) — RLS + trigger `protect_access_columns` n'autorisent que coach/admin. */
export async function updateStudentAccess(
  supabase: TypedSupabaseClient,
  studentId: string,
  input: UpdateStudentAccessInput,
): Promise<boolean> {
  let assignedStripePlan: string | null = null;
  let assignedStripePriceId: string | null = null;
  if (input.assignedSubscriptionTemplateId) {
    const { data: template } = await supabase
      .from("subscription_templates")
      .select("name, stripe_price_id")
      .eq("id", input.assignedSubscriptionTemplateId)
      .maybeSingle();
    assignedStripePlan = template?.name ?? null;
    assignedStripePriceId = template?.stripe_price_id ?? null;
  }

  const { error } = await supabase
    .from("student_profiles")
    .update({
      billing_access_mode: input.billingAccessMode,
      assigned_subscription_template_id: input.assignedSubscriptionTemplateId,
      assigned_stripe_plan: assignedStripePlan,
      assigned_stripe_price_id: assignedStripePriceId,
      access_note: input.accessNote,
      access_updated_at: new Date().toISOString(),
    })
    .eq("student_id", studentId);
  if (error) {
    console.error(`[Supabase] updateStudentAccess : ${error.message}`);
  }
  return !error;
}

export const accessModeLabels: Record<BillingAccessMode, string> = {
  subscription_required: "Automatique selon abonnement",
  manual_allowed: "Autoriser sans paiement",
  manual_blocked: "Bloquer manuellement",
};

export const accessReasonLabels: Record<StudentAccessReason, string> = {
  indetermine: "Droits indéterminables (panne de lecture)",
  manual_allowed: "Accès manuel autorisé",
  manual_blocked: "Accès manuel bloqué",
  subscription_active: "Abonnement actif",
  no_subscription: "Aucun abonnement",
  subscription_incomplete: "Abonnement incomplet",
  subscription_incomplete_expired: "Abonnement incomplet expiré",
  subscription_past_due: "Paiement en retard",
  subscription_canceled: "Abonnement annulé",
  subscription_unpaid: "Abonnement impayé",
  subscription_paused: "Abonnement en pause",
};
