import "server-only";

import type { AbonnementPush } from "@/lib/push/abonnement";

/**
 * L'ACCÈS AUX TABLES PUSH — TYPÉ ICI, ET NULLE PART AILLEURS.
 *
 * ════════════════════════════════════════════════════════════════════════
 * POURQUOI PAS DANS `types/supabase.ts`
 * ════════════════════════════════════════════════════════════════════════
 * Ce fichier est maintenu À LA MAIN (son propre en-tête le dit), table par
 * table, et il est incomplet : `email_logs`, `subscription_templates` et
 * d'autres n'y figurent pas. Tant que la carte des tables reste partielle,
 * TypeScript reste permissif ; y AJOUTER des tables la rend assez précise
 * pour que les requêtes vers les tables absentes deviennent des erreurs.
 *
 * Vérifié, pas supposé : ajouter les cinq tables push faisait échouer six
 * routes sans rapport (`appointment-reminders`, `content-assigned`,
 * `subscription-templates`…). Compléter tout le schéma à la main pour
 * livrer une notification de test serait un chantier à soi seul, et un
 * chantier risqué.
 *
 * Le typage des tables push est donc CONTENU ici : une seule conversion,
 * explicite et commentée, au lieu d'une modification du fichier partagé qui
 * déstabilise le reste. Le jour où `supabase gen types` sera rebranché, ce
 * module disparaît et les appels redeviennent nativement typés.
 */

/** Ce que le reste du code manipule — jamais la ligne brute. */
export interface AbonnementEnregistre extends AbonnementPush {
  id: string;
  userId: string;
}

interface LigneAbonnement {
  id: string;
  user_id: string;
  endpoint: string;
  p256dh: string;
  auth: string;
}

/** Le strict minimum de l'API Supabase utilisé ici. */
interface ClientMinimal {
  from: (table: string) => {
    select: (colonnes: string) => {
      eq: (colonne: string, valeur: string) => {
        is: (colonne: string, valeur: null) => Promise<{ data: LigneAbonnement[] | null; error: unknown }>;
      };
    };
    upsert: (valeurs: Record<string, unknown>, options: { onConflict: string }) => Promise<{ error: unknown }>;
    update: (valeurs: Record<string, unknown>) => {
      eq: (colonne: string, valeur: string) => Promise<{ error: unknown }>;
    };
    delete: () => {
      eq: (colonne: string, valeur: string) => {
        eq: (colonne: string, valeur: string) => Promise<{ error: unknown }>;
      };
    };
  };
}

function tables(client: unknown): ClientMinimal {
  return client as ClientMinimal;
}

/** Les appareils VIVANTS d'un utilisateur. Un désactivé n'est jamais rendu. */
export async function abonnementsActifs(
  client: unknown,
  userId: string,
): Promise<AbonnementEnregistre[]> {
  const { data, error } = await tables(client)
    .from("push_subscriptions")
    .select("id, user_id, endpoint, p256dh, auth")
    .eq("user_id", userId)
    .is("disabled_at", null);
  if (error || !data) {
    return [];
  }
  return data.map((l) => ({
    id: l.id,
    userId: l.user_id,
    endpoint: l.endpoint,
    p256dh: l.p256dh,
    auth: l.auth,
  }));
}

/**
 * Désactive UN abonnement — celui dont le service push a dit qu'il n'existe
 * plus. Jamais les autres appareils du même élève.
 */
export async function desactiverAbonnement(
  client: unknown,
  endpoint: string,
  raison: string,
): Promise<void> {
  await tables(client)
    .from("push_subscriptions")
    .update({ disabled_at: new Date().toISOString(), disabled_reason: raison.slice(0, 100) })
    .eq("endpoint", endpoint);
}

/** Note le dernier envoi réussi — sert à repérer un appareil silencieux. */
export async function marquerSucces(client: unknown, endpoint: string): Promise<void> {
  await tables(client)
    .from("push_subscriptions")
    .update({ last_success_at: new Date().toISOString() })
    .eq("endpoint", endpoint);
}

/** Enregistre ou réactive l'appareil courant pour CE compte. */
export async function enregistrerAbonnement(
  client: unknown,
  userId: string,
  abonnement: AbonnementPush,
  userAgent: string,
): Promise<boolean> {
  const { error } = await tables(client)
    .from("push_subscriptions")
    .upsert(
      {
        user_id: userId,
        endpoint: abonnement.endpoint,
        p256dh: abonnement.p256dh,
        auth: abonnement.auth,
        user_agent: userAgent.slice(0, 300),
        disabled_at: null,
        disabled_reason: null,
      },
      { onConflict: "endpoint" },
    );
  return !error;
}

/** Retire CET appareil, et uniquement s'il appartient à cet utilisateur. */
export async function retirerAbonnement(
  client: unknown,
  userId: string,
  endpoint: string,
): Promise<boolean> {
  const { error } = await tables(client)
    .from("push_subscriptions")
    .delete()
    .eq("endpoint", endpoint)
    .eq("user_id", userId);
  return !error;
}
