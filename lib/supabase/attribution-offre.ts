import type { SupabaseClient } from "@supabase/supabase-js";

import type { Database } from "@/types/supabase";

/**
 * P13-B/10 — LECTURE DE L'OFFRE ATTRIBUÉE À UN ÉLÈVE.
 *
 * ⚠️ POURQUOI CE DÉTOUR. Les trois colonnes d'attribution de
 * `student_profiles` (`assigned_subscription_template_id`,
 * `assigned_stripe_plan`, `assigned_stripe_price_id`) ne sont plus lisibles
 * par le rôle `authenticated` : la migration 20261018090000 leur a retiré le
 * privilège de COLONNE. La raison est mesurée en base — un collaborateur, à
 * qui `suivi_eleve` ouvre légitimement la fiche de son élève, y lisait la
 * référence de l'offre, puis en déduisait le prix en lisant le catalogue
 * autrement (vitrine publique, session déconnectée). Une policy RLS ne sait
 * pas fermer une colonne : elle filtre des lignes.
 *
 * ⚠️ CE N'EST PAS UN MASQUAGE D'INTERFACE. Retirer le champ d'une requête
 * React n'aurait rien protégé : la colonne resterait lisible par une requête
 * PostgREST directe. Ici, c'est le serveur de base qui refuse — avec ou sans
 * l'application.
 *
 * La RPC `attribution_offre_eleve` est le seul chemin restant, et elle ne
 * rend des lignes qu'à CEUX QUI Y ONT DROIT : l'élève pour lui-même,
 * l'administrateur et le coach autonome pour la facturation, le serveur
 * (`service_role`) pour les emails et les webhooks. Pour un collaborateur
 * elle rend zéro ligne — quelles que soient ses catégories, même les quatre
 * en écriture.
 *
 * ⚠️ AUCUNE ERREUR N'EST REMONTÉE À L'APPELANT. Zéro ligne et « refusé » se
 * traduisent tous deux par une attribution absente : c'est exactement le
 * comportement attendu côté interface (aucun champ, aucune divulgation de
 * l'existence d'une offre), et cela évite de faire échouer une fiche élève
 * entière pour une information de facturation à laquelle l'appelant n'a
 * simplement pas droit.
 */

type TypedSupabaseClient = SupabaseClient<Database>;

export interface AttributionOffre {
  /** `subscription_templates.id` — source de vérité de la formule. */
  offreId: string | null;
  /** Nom du modèle, recopié pour l'affichage (`assigned_stripe_plan`). */
  offreNom: string | null;
  /** `stripe_price_id` du modèle, recopié (`assigned_stripe_price_id`). */
  offrePrixId: string | null;
}

interface LigneAttribution {
  eleve_id: string;
  offre_id: string | null;
  offre_nom: string | null;
  offre_prix_id: string | null;
}

export const ATTRIBUTION_ABSENTE: AttributionOffre = { offreId: null, offreNom: null, offrePrixId: null };

function versAttribution(ligne: LigneAttribution): AttributionOffre {
  return {
    offreId: ligne.offre_id ?? null,
    offreNom: ligne.offre_nom ?? null,
    offrePrixId: ligne.offre_prix_id ?? null,
  };
}

async function appeler(
  supabase: TypedSupabaseClient,
  parametres: Record<string, unknown>,
): Promise<LigneAttribution[]> {
  // @ts-expect-error — RPC ajoutée par migration, pas encore dans les types générés.
  const { data, error } = await supabase.rpc("attribution_offre_eleve", parametres);
  if (error) {
    // Pas de `console.error` : un refus est un résultat normal pour un
    // appelant sans droit sur la facturation (voir l'en-tête).
    return [];
  }
  return (data as LigneAttribution[] | null) ?? [];
}

/** L'offre attribuée à UN élève, ou une attribution vide si l'appelant n'y a pas droit. */
export async function lireAttributionOffre(
  supabase: TypedSupabaseClient,
  studentId: string,
): Promise<AttributionOffre> {
  const lignes = await appeler(supabase, { p_student_id: studentId });
  const ligne = lignes.find((l) => l.eleve_id === studentId) ?? lignes[0];
  return ligne ? versAttribution(ligne) : ATTRIBUTION_ABSENTE;
}

/**
 * Les offres attribuées, indexées par élève — UNE seule lecture pour une
 * liste entière (`/admin/paiements`, la liste des élèves). Rend une table
 * vide pour un appelant sans droit : les champs d'attribution tombent alors
 * à `null`, et rien d'autre ne change.
 */
export async function lireAttributionsOffre(
  supabase: TypedSupabaseClient,
): Promise<Map<string, AttributionOffre>> {
  const lignes = await appeler(supabase, {});
  return new Map(lignes.map((ligne) => [ligne.eleve_id, versAttribution(ligne)]));
}
