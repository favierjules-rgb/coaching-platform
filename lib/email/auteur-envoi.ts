/**
 * Fiche staff de l'appelant, lue sur SA SESSION.
 *
 * ⚠️ LE CLIENT PASSÉ ICI DOIT ÊTRE CELUI DE LA SESSION, pas le service role.
 * `public.current_staff_id()` est SECURITY DEFINER et se résout sur
 * `auth.uid()` : appelée avec un client service role elle rendrait NULL
 * (aucun utilisateur), et un `coachId` venu du navigateur ne serait qu'une
 * déclaration. C'est la seule façon fiable de savoir QUI envoie, et c'est ce
 * qui cloisonne `email_logs`.
 *
 * Rend `null` quand l'appelant n'a pas de fiche staff (élève, contexte
 * serveur) : l'envoi est alors journalisé comme SYSTÈME, donc lisible par
 * l'administrateur seul — jamais attribué au hasard.
 *
 * ⚠️ LE PARAMÈTRE EST `unknown`, VOLONTAIREMENT. Les cinq routes appelantes
 * construisent leur client avec des génériques différents, et une signature
 * nominale (`SupabaseClient<Database>`) les rendait incompatibles deux fois
 * sur cinq. On ne consomme ici qu'une seule méthode : on la vérifie à
 * l'exécution plutôt que de mentir sur le type.
 */
export async function resoudreAuteurEnvoi(sessionSupabase: unknown): Promise<string | null> {
  const client = sessionSupabase as { rpc?: (nom: string) => Promise<{ data: unknown }> } | null | undefined;
  if (!client || typeof client.rpc !== "function") return null;
  try {
    const { data } = await client.rpc("current_staff_id");
    const brut: unknown = Array.isArray(data) ? data[0] : data;
    return typeof brut === "string" && brut.length > 0 ? brut : null;
  } catch {
    // Fonction absente (migrations non appliquées) ou session invalide :
    // envoi système, pas une erreur à propager.
    return null;
  }
}
