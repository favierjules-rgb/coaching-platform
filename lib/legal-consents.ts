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
 * Registre immuable des versions passées du texte de consentement "accès
 * immédiat + perte du droit de rétractation" (consent_type toujours
 * 'retractation_programme' en base — ce nom de colonne n'a pas changé,
 * seul le texte/la version affichés au moment de l'achat évoluent). Ne
 * jamais modifier ni supprimer une entrée existante : chaque ligne déjà
 * écrite dans legal_consents référence sa version par ce texte exact, c'est
 * la seule façon de retrouver a posteriori ce qu'un acheteur a réellement
 * accepté à une date donnée. N'ajouter que de nouvelles entrées.
 */
export const IMMEDIATE_ACCESS_AND_WAIVER_CONSENT_TEXT_HISTORY: Readonly<Record<string, string>> = {
  // v1 (juillet 2026, Lot E) : deux cases distinctes affichées séparément
  // dans le formulaire d'achat, fusionnées ici en une seule entrée
  // d'archive à des fins de traçabilité — le formulaire de l'époque
  // affichait réellement ces deux textes comme deux checkboxes.
  "2026-07-fr-v1":
    "[Case 1/2] Je demande expressément à accéder immédiatement au programme numérique avant l'expiration du délai légal de rétractation. " +
    "[Case 2/2] Je reconnais qu'en demandant l'accès immédiat au contenu numérique, je perdrai mon droit de rétractation dans les conditions prévues par le Code de la consommation.",
};

/**
 * Version et texte actuellement affichés au moment de l'achat (case unique
 * fusionnée, Lot E-bis — juillet 2026). Texte fourni et validé par Jules —
 * ne pas reformuler sans repasser par lui. Toute évolution de ce texte doit
 * s'accompagner d'une nouvelle entrée dans IMMEDIATE_ACCESS_AND_WAIVER_CONSENT_TEXT_HISTORY
 * ci-dessus et d'un incrément de version ici, jamais d'une réécriture sur place.
 */
export const IMMEDIATE_ACCESS_AND_WAIVER_CONSENT_TEXT_VERSION = "2026-07-fr-v2";
export const IMMEDIATE_ACCESS_AND_WAIVER_CONSENT_TEXT =
  "Je demande expressément l'accès immédiat au programme numérique avant l'expiration du délai légal de rétractation et je reconnais qu'à compter du début de la fourniture du contenu, je perdrai mon droit de rétractation conformément à l'article L. 221-28 du Code de la consommation.";

/**
 * `true` si une ligne `legal_consents` existe déjà pour cette session de
 * paiement Stripe et ce type de consentement (chantier conformité
 * juridique/RGPD, Lot E-bis technique — juillet 2026) — dédoublonnage par
 * commande, utilisé avant d'insérer pour qu'un retry du webhook Stripe ne
 * crée jamais deux preuves de consentement pour le même achat (voir
 * lib/supabase/public-program-provisioning.ts). N'a de sens que pour le
 * chemin payant (checkout, qui a un `checkout_session_id`) ; jamais appelée
 * pour le chemin gratuit (claim), qui insère toujours directement.
 */
export async function hasLegalConsentForCheckoutSession(
  supabase: SupabaseClient,
  checkoutSessionId: string,
  consentType: LegalConsentType,
): Promise<boolean> {
  const { data, error } = await supabase
    .from("legal_consents")
    .select("id")
    .eq("consent_type", consentType)
    .eq("metadata->>checkout_session_id", checkoutSessionId)
    .maybeSingle();
  if (error) {
    console.error(`[legal-consents] hasLegalConsentForCheckoutSession (${consentType}) : ${error.message}`);
    return false;
  }
  return Boolean(data);
}

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
