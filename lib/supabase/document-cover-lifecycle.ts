import type { SupabaseClient } from "@supabase/supabase-js";

import { setDocumentCoverPath } from "@/lib/supabase/documents";
import {
  deleteDocumentCover,
  uploadDocumentCover,
} from "@/lib/supabase/storage-document-covers";
import type { Database } from "@/types/supabase";

/**
 * LE CYCLE DE VIE D'UNE MINIATURE — L'ORDRE DES OPÉRATIONS, ET RIEN D'AUTRE.
 *
 * ═════════════════════════════════════════════════════════════════════════
 * POURQUOI CE MODULE EXISTE SÉPARÉMENT DU CHAMP DE FORMULAIRE
 * ═════════════════════════════════════════════════════════════════════════
 * Ce qui peut faire PERDRE l'image d'un coach n'est pas un bouton : c'est
 * l'ordre dans lequel trois opérations s'enchaînent. Cet ordre doit donc être
 * mesurable sans navigateur, sans rendu et sans clic — d'où un module de
 * fonctions, et non une poignée de `await` noyés dans un gestionnaire
 * d'évènement.
 *
 * ═════════════════════════════════════════════════════════════════════════
 * LA RÈGLE, EN UNE PHRASE
 * ═════════════════════════════════════════════════════════════════════════
 * L'ANCIENNE IMAGE N'EST SUPPRIMÉE QU'APRÈS QUE LA BASE PORTE LA NOUVELLE.
 *
 * Les trois étapes, toujours dans cet ordre :
 *
 *   1. téléverser le nouvel objet (horodaté, donc jamais à la place de
 *      l'ancien) ;
 *   2. écrire `documents.cover_storage_path` ;
 *   3. seulement ensuite, supprimer l'ancien objet.
 *
 * Et ce que chaque échec laisse derrière lui :
 *
 *   · échec en 1 → rien n'a changé. L'ancienne couverture est toujours en
 *     base et toujours dans le seau.
 *   · échec en 2 → l'ancienne couverture est INTACTE, en base comme dans le
 *     seau. Le nouvel objet, lui, est supprimé : il ne sert à rien et
 *     personne ne le retrouverait.
 *   · échec en 3 → la base est juste, l'écran est juste. Il reste un objet
 *     orphelin, dont le préfixe est la fiche de son propriétaire : personne
 *     d'autre n'y accède. On ne remonte donc PAS d'erreur — faire croire à
 *     l'échec d'une opération réussie serait pire que l'orphelin.
 *
 * ⚠️ JAMAIS « SUPPRIMER PUIS TÉLÉVERSER ». C'est la seule séquence qui peut
 * détruire l'image d'un coach sur un réseau qui coupe au mauvais moment, et
 * elle n'apparaît nulle part dans ce fichier.
 */

type TypedSupabaseClient = SupabaseClient<Database>;

/**
 * Une couverture choisie mais PAS ENCORE TÉLÉVERSÉE — l'état de la création.
 *
 * ⚠️ `previewUrl` est une URL `blob:` locale : elle retient son contenu en
 * mémoire tant qu'elle n'est pas révoquée, et c'est le propriétaire de cet
 * état qui s'en charge.
 */
export interface PendingDocumentCover {
  readonly file: File;
  readonly previewUrl: string;
}

export type CoverLifecycleResult =
  | { readonly ok: true; readonly coverStoragePath: string | null }
  | { readonly ok: false; readonly error: string };

/**
 * REMPLACE (ou pose) la couverture d'un document QUI EXISTE DÉJÀ.
 *
 * `ancien` est le chemin actuellement en base, ou `null` s'il n'y en a pas.
 * Voir l'en-tête du module pour l'ordre et pour ce que chaque échec préserve.
 */
export async function remplacerCouverture(
  supabase: TypedSupabaseClient,
  documentId: string,
  file: File,
  ancien: string | null,
): Promise<CoverLifecycleResult> {
  // ── 1. Téléverser le NOUVEL objet ───────────────────────────────────────
  const televerse = await uploadDocumentCover(supabase, documentId, file);
  if ("error" in televerse) {
    // Rien n'a changé : l'ancienne couverture reste en base et dans le seau.
    return { ok: false, error: `Échec du téléversement de la miniature : ${televerse.error}` };
  }
  const nouveau = televerse.coverStoragePath;

  // ── 2. Écrire la base ───────────────────────────────────────────────────
  const ecrit = await setDocumentCoverPath(supabase, documentId, nouveau);
  if (!ecrit) {
    // ⚠️ ON NETTOIE LE NOUVEAU, PAS L'ANCIEN. La base n'a pas bougé : la
    // couverture précédente est toujours la bonne, et le fichier qu'on vient
    // de déposer n'est référencé par rien.
    await deleteDocumentCover(supabase, nouveau);
    return {
      ok: false,
      error:
        "La miniature a été envoyée mais n'a pas pu être enregistrée. L'image précédente est conservée. Réessaie.",
    };
  }

  // ── 3. Et SEULEMENT MAINTENANT, l'ancien objet ──────────────────────────
  if (ancien && ancien !== nouveau) {
    await deleteDocumentCover(supabase, ancien);
  }

  return { ok: true, coverStoragePath: nouveau };
}

/**
 * SUPPRIME la couverture d'un document : la base d'abord, l'objet ensuite.
 *
 * ⚠️ L'OBJET N'EST DÉTRUIT QU'APRÈS QUE LA BASE L'AIT OUBLIÉ. L'inverse
 * laisserait, en cas d'échec d'écriture, un document pointant vers un fichier
 * détruit — donc une carte dont la miniature ne peut plus jamais s'afficher,
 * sans aucun moyen de le savoir depuis l'écran.
 */
export async function supprimerCouverture(
  supabase: TypedSupabaseClient,
  documentId: string,
  ancien: string | null,
): Promise<CoverLifecycleResult> {
  if (!ancien) {
    return { ok: true, coverStoragePath: null };
  }

  const ecrit = await setDocumentCoverPath(supabase, documentId, null);
  if (!ecrit) {
    // L'objet est intact : la miniature s'affiche encore, ce qui est
    // exactement l'état décrit par la base.
    return { ok: false, error: "La miniature n'a pas pu être retirée. Réessaie." };
  }

  await deleteDocumentCover(supabase, ancien);
  return { ok: true, coverStoragePath: null };
}

/**
 * POSE une couverture retenue en mémoire, juste APRÈS la création du document.
 *
 * ═════════════════════════════════════════════════════════════════════════
 * POURQUOI LA CRÉATION DIFFÈRE LE TÉLÉVERSEMENT
 * ═════════════════════════════════════════════════════════════════════════
 * Le chemin de stockage contient l'identifiant du document, et cet
 * identifiant est tiré côté navigateur AVANT l'insertion : téléverser tout de
 * suite serait techniquement possible. Mais un formulaire abandonné — et il y
 * en aura — laisserait alors un fichier que plus rien ne référence.
 *
 * En différant, un abandon ne laisse RIEN : le problème des orphelins est
 * supprimé plutôt que traité. Le prix est une seconde écriture après
 * l'insertion, et un échec à ce moment-là crée simplement un document sans
 * couverture — jamais un document cassé.
 */
export async function poserCouvertureApresCreation(
  supabase: TypedSupabaseClient,
  documentId: string,
  file: File,
): Promise<CoverLifecycleResult> {
  return remplacerCouverture(supabase, documentId, file, null);
}
