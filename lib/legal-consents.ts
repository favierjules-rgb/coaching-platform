import type { SupabaseClient } from "@supabase/supabase-js";

/**
 * Thin data-access layer for `public.legal_consents` (chantier conformité
 * juridique/RGPD, lots D/E — juillet 2026). Preuve horodatée d'un
 * consentement RGPD explicite, jamais mise à jour ni supprimée une fois
 * écrite — voir supabase/schema.sql pour le détail des policies (insert
 * uniquement, aucune update/delete côté élève ou staff).
 *
 * Même raison qu'indiquée dans lib/newsletter/db.ts : le type `Database`
 * partagé de types/supabase.ts est un placeholder pas encore régénéré pour
 * cette table, donc ce module travaille contre un type de ligne déclaré
 * localement plutôt que d'étendre ce générique partagé.
 */

export type LegalConsentType = "sante_onboarding" | "cgv_programme" | "retractation_programme";

export interface LegalConsentRow {
  id: string;
  student_id: string;
  consent_type: LegalConsentType;
  consent_text_version: string;
  consent_at: string;
  metadata: Record<string, unknown>;
  created_at: string;
}

export interface NewLegalConsent {
  studentId: string;
  consentType: LegalConsentType;
  consentTextVersion: string;
  metadata?: Record<string, unknown>;
}

/** Texte exact de la case à cocher, étape 5 du questionnaire /onboarding (OnboardingWizard.tsx). */
export const HEALTH_DATA_CONSENT_TEXT_VERSION = "2026-07-fr-v1";
export const HEALTH_DATA_CONSENT_TEXT =
  "J'accepte que ces informations, y compris celles pouvant relever de données de santé, soient utilisées par mon coach pour adapter mon accompagnement.";

/** Texte exact de la case à cocher CGV, formulaire d'achat d'un programme public (PublicProgramPurchaseForm.tsx). */
export const CGV_PROGRAMME_CONSENT_TEXT_VERSION = "2026-07-fr-v1";
export const CGV_PROGRAMME_CONSENT_TEXT = "J'ai lu et j'accepte les conditions générales de vente.";

/**
 * Textes exacts des deux cases de rétractation, formulaire d'achat payant
 * d'un programme public (PublicProgramPurchaseForm.tsx, réservé au chemin
 * payant — un programme gratuit n'a pas de paiement à rétracter). Texte
 * fourni et validé par Jules (brief initial du chantier conformité
 * juridique/RGPD) — ne pas reformuler sans repasser par lui.
 */
export const RETRACTATION_WAIVER_CONSENT_TEXT_VERSION = "2026-07-fr-v1";
export const IMMEDIATE_ACCESS_CONSENT_TEXT =
  "Je demande expressément à accéder immédiatement au programme numérique avant l'expiration du délai légal de rétractation.";
export const WITHDRAWAL_RIGHT_WAIVER_CONSENT_TEXT =
  "Je reconnais qu'en demandant l'accès immédiat au contenu numérique, je perdrai mon droit de rétractation dans les conditions prévues par le Code de la consommation.";

/**
 * Insère une ligne de preuve de consentement. Utilisable aussi bien avec un
 * client de session (élève authentifié, RLS "insert own health") qu'avec un
 * client service role (provisionnement après achat, RLS contournée) — voir
 * lib/supabase/onboarding.ts et lib/supabase/public-program-provisioning.ts.
 * Ne fait jamais échouer l'appelant : une erreur est journalisée et `false`
 * est renvoyé, à l'appelant de décider si c'est bloquant.
 */
export async function insertLegalConsent(
  supabase: SupabaseClient,
  input: NewLegalConsent,
): Promise<boolean> {
  const { error } = await supabase.from("legal_consents").insert({
    student_id: input.studentId,
    consent_type: input.consentType,
    consent_text_version: input.consentTextVersion,
    metadata: input.metadata ?? {},
  });
  if (error) {
    console.error(`[legal-consents] insertLegalConsent (${input.consentType}) : ${error.message}`);
    return false;
  }
  return true;
}
