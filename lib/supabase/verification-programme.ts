/**
 * L'ACCÈS AU PENSE-BÊTE « À JOUR / À VÉRIFIER » — typé ici, et nulle part ailleurs.
 *
 * Même arbitrage que `lib/notifications/depot.ts` et
 * `lib/push/depot-abonnements.ts` : `types/supabase.ts` est maintenu à la main
 * et ne connaît pas encore `program_review_flags`. Y ajouter la table rendrait
 * TypeScript assez précis pour casser d'autres fichiers ; le typage reste donc
 * CONTENU dans ce module, avec une seule conversion explicite.
 *
 * ⚠️ PAS DE `server-only` ICI. La liste des programmes est un composant client :
 * c'est le navigateur du coach qui lit et écrit, sous la RLS
 * `program_review_flags_staff`. Un élève qui tenterait la même requête
 * n'obtiendrait rien — la garde est en base, pas dans ce fichier.
 */

interface Reponse {
  data: unknown;
  error: unknown;
}

/** Le strict minimum de l'API Supabase réellement utilisé ci-dessous. */
interface Chaine {
  select: (colonnes?: string) => Chaine;
  upsert: (valeurs: unknown, options?: unknown) => Chaine;
  delete: () => Chaine;
  eq: (colonne: string, valeur: unknown) => Chaine;
  in: (colonne: string, valeurs: unknown[]) => Chaine;
  then: <R>(suite: (reponse: Reponse) => R) => Promise<R>;
}

interface ClientMinimal {
  from: (table: string) => Chaine;
}

function table(client: unknown): Chaine {
  return (client as ClientMinimal).from("program_review_flags");
}

const texte = (v: unknown): string => (typeof v === "string" ? v : "");

/**
 * Les semaines validées des programmes demandés : `programId` → clé de semaine.
 *
 * Un programme absent de la carte n'a jamais été validé — et c'est la même
 * chose qu'une validation périmée pour l'état affiché (« À vérifier »), donc
 * rien à distinguer ici.
 *
 * ⚠️ UNE ERREUR REND UNE CARTE VIDE, DONC « À VÉRIFIER » PARTOUT. C'est le
 * seul repli acceptable : afficher « À jour » sur une lecture ratée dirait au
 * coach que tout va bien alors qu'on ne sait rien.
 */
export async function lireVerifications(
  client: unknown,
  programIds: readonly string[],
): Promise<Map<string, string>> {
  const parProgramme = new Map<string, string>();
  if (programIds.length === 0) return parProgramme;

  const reponse = await table(client).select("program_id, verified_week").in("program_id", [...programIds]);
  if (reponse.error || !reponse.data) return parProgramme;

  for (const ligne of reponse.data as Record<string, unknown>[]) {
    const id = texte(ligne.program_id);
    const semaine = texte(ligne.verified_week);
    // `verified_week` est une `date` : PostgREST la rend en `YYYY-MM-DD`, le
    // même format que `cleDeSemaine`. Aucune conversion, donc aucune dérive de
    // fuseau possible entre l'écriture et la comparaison.
    if (id && semaine) parProgramme.set(id, semaine.slice(0, 10));
  }
  return parProgramme;
}

/** Marque le programme « à jour » pour la semaine donnée (clé = lundi ISO). */
export async function marquerVerifie(
  client: unknown,
  programId: string,
  semaine: string,
): Promise<boolean> {
  const reponse = await table(client).upsert(
    { program_id: programId, verified_week: semaine, verified_at: new Date().toISOString() },
    { onConflict: "program_id" },
  );
  return !reponse.error;
}

/**
 * Retire la validation — le coach s'est ravisé.
 *
 * On SUPPRIME la ligne au lieu d'écrire une semaine passée : « jamais validé »
 * et « validé il y a longtemps » produisent le même état, et une ligne absente
 * est plus simple à lire qu'une date arbitraire choisie pour être périmée.
 */
export async function retirerVerification(client: unknown, programId: string): Promise<boolean> {
  const reponse = await table(client).delete().eq("program_id", programId);
  return !reponse.error;
}
