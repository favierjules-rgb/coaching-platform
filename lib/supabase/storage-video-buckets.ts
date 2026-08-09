import type { SupabaseClient } from "@supabase/supabase-js";

import type { Database } from "@/types/supabase";

/**
 * LA MÉCANIQUE STORAGE COMMUNE AUX DEUX BUCKETS VIDÉO.
 *
 * Deux buckets existent — `feedback-videos` (l'élève filme, F4) et
 * `coach-reply-videos` (le coach répond, F5) — et ils sont séparés à dessein :
 * leurs POLICIES sont inverses, et un bucket ne porte qu'un jeu de policies.
 *
 * Mais l'inverse n'était pas vrai côté application. Trois opérations sont
 * rigoureusement identiques d'un bucket à l'autre — vider le dossier d'un
 * élève, signer une URL, en signer un lot — et chacune porte une subtilité
 * qu'il serait coûteux de réapprendre deux fois (la pagination qui ne
 * s'incrémente pas, la signature groupée dont chaque entrée porte sa propre
 * erreur). Les dupliquer aurait créé exactement le « second système
 * parallèle » qu'on cherche à éviter : deux copies qui divergent au premier
 * correctif appliqué d'un seul côté.
 *
 * Ce module ne connaît donc AUCUNE règle métier — ni durée maximale, ni
 * plafond de taille, ni forme de chemin. Il reçoit un nom de bucket et fait
 * le geste. Ce qui a le droit d'y entrer reste décidé par
 * `storage-feedback-videos.ts` et `storage-coach-reply-videos.ts`, chacun
 * avec ses propres validations, et par la RLS du bucket concerné.
 */

type TypedSupabaseClient = SupabaseClient<Database>;

function devWarn(contexte: string, erreur: { message: string } | null): void {
  if (erreur && process.env.NODE_ENV === "development") {
    console.warn(`[Supabase] ${contexte} :`, erreur.message);
  }
}

export interface BilanVidageDossier {
  supprimes: number;
  /** `false` dès qu'une page n'a pas pu être listée ou retirée. */
  complet: boolean;
}

/**
 * Supprime TOUS les objets du dossier `<studentId>/` d'un bucket vidéo.
 *
 * Réservé à la suppression complète d'un élève (RGPD) : c'est le seul geste
 * du dépôt qui efface un objet vidéo à la demande. Partout ailleurs,
 * remplacer c'est ajouter, et l'ancien fichier devient un orphelin que la
 * purge de rétention ramassera.
 *
 * On liste PAR PAGES : `list()` en rend 100 par défaut, et un élève assidu
 * dépasse ce chiffre. Une purge qui s'arrête à la centième vidéo laisse
 * derrière elle exactement ce qu'elle prétendait effacer.
 *
 * L'échec est journalisé en développement et surtout RENDU : c'est
 * l'appelant qui décide s'il peut vivre avec, et `deleteStudentCompletely`
 * a décidé que non.
 */
export async function viderDossierVideoEleve(
  supabase: TypedSupabaseClient,
  bucket: string,
  studentId: string,
): Promise<BilanVidageDossier> {
  const seau = supabase.storage.from(bucket);
  let supprimes = 0;
  let complet = true;

  // 1000 pages de 100 objets : un garde-fou, pas une limite attendue. Une
  // boucle sans borne sur une API distante est une boucle infinie en
  // puissance.
  for (let page = 0; page < 1000; page += 1) {
    const { data: fichiers, error: listError } = await seau.list(studentId, {
      limit: 100,
      offset: 0,
    });
    if (listError) {
      devWarn(`viderDossierVideoEleve ${bucket} (list)`, listError);
      complet = false;
      break;
    }
    if (!fichiers || fichiers.length === 0) break;

    const chemins = fichiers.map((f) => `${studentId}/${f.name}`);
    const { error: removeError } = await seau.remove(chemins);
    if (removeError) {
      devWarn(`viderDossierVideoEleve ${bucket} (remove)`, removeError);
      complet = false;
      break;
    }
    supprimes += chemins.length;
    // `offset` reste à 0 À DESSEIN : on vient de retirer cette page, la
    // suivante a pris sa place. Avancer l'offset sauterait une page sur deux.
    if (fichiers.length < 100) break;
  }

  return { supprimes, complet };
}

/**
 * URL signée d'UN chemin. `null` quand l'appelant n'a pas le droit de voir
 * ce chemin — la RLS du bucket décide, pas ce module.
 *
 * Une heure, comme les photos de progression et les documents : assez pour
 * regarder une vidéo, trop peu pour qu'un lien recopié serve longtemps.
 */
export async function signerUrlVideo(
  supabase: TypedSupabaseClient,
  bucket: string,
  path: string | null,
  expiresIn = 3600,
): Promise<string | null> {
  if (!path) return null;
  const { data, error } = await supabase.storage.from(bucket).createSignedUrl(path, expiresIn);
  devWarn(`signerUrlVideo ${bucket}`, error);
  return data?.signedUrl ?? null;
}

/**
 * Signe PLUSIEURS chemins en une passe, en gardant la correspondance.
 *
 * UNE requête pour toute la page, pas une par vidéo. `createSignedUrls` rend
 * un résultat PAR CHEMIN : ceux que la RLS refuse à cet appelant portent
 * leur propre erreur et sont simplement absents de la carte. C'est ce qui
 * fait qu'un coach non rattaché n'obtient rien, sans que l'appelant ait à
 * trier quoi que ce soit.
 */
export async function signerUrlsVideo(
  supabase: TypedSupabaseClient,
  bucket: string,
  chemins: readonly (string | null)[],
  expiresIn = 3600,
): Promise<Map<string, string>> {
  const uniques = [...new Set(chemins.filter((c): c is string => Boolean(c)))];
  const resolues = new Map<string, string>();
  if (uniques.length === 0) return resolues;

  const { data, error } = await supabase.storage.from(bucket).createSignedUrls([...uniques], expiresIn);
  devWarn(`signerUrlsVideo ${bucket}`, error);
  if (!data) return resolues;

  for (const entree of data) {
    if (entree.signedUrl && !entree.error && entree.path) {
      resolues.set(entree.path, entree.signedUrl);
    }
  }
  return resolues;
}
