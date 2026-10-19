import type { SupabaseClient } from "@supabase/supabase-js";

import { IMAGE_HEAD_BYTES, looksLikeSvg, sniffImageMime } from "@/lib/images/signature";
import { ficheStaffDeLAppelant, sanitizeFileName } from "@/lib/supabase/storage-documents";
import type { Database } from "@/types/supabase";

/**
 * LA MINIATURE DE COUVERTURE D'UN DOCUMENT — seau dédié, privé, plafonné.
 *
 * ═════════════════════════════════════════════════════════════════════════
 * POURQUOI UN SEAU À PART, ET PAS `documents`
 * ═════════════════════════════════════════════════════════════════════════
 * Le seau `documents` héberge des PDF de 25 Mo et des vidéos de 200 Mo : il
 * n'a donc ni `file_size_limit` ni `allowed_mime_types`. Y poser des plafonds
 * d'image casserait les vidéos ; ne pas en poser laisserait la seule
 * validation du côté du navigateur, c'est-à-dire du côté qu'on ne contrôle
 * pas. `document-covers` peut, lui, refuser côté SERVEUR : 5 Mo, et trois
 * types MIME.
 *
 * ⚠️ `image/svg+xml` EST EXCLU DU SEAU, volontairement : un SVG est du XML
 * exécutable, et une couverture finit dans une balise `<img>`.
 *
 * ⚠️ LE SEAU RESTE PRIVÉ, et `documents` ne devient pas public. Toute vue
 * passe par une URL signée, donc par la policy de lecture, donc par les
 * règles d'affectation et de publication existantes.
 *
 * ══════════════════════════════════════════════════════════════════════
 * ⚠️ LIMITE ASSUMÉE : LE SERVEUR NE VÉRIFIE PAS LA SIGNATURE RÉELLE DU FICHIER
 * ══════════════════════════════════════════════════════════════════════
 * Il faut être précis ici, parce que la confusion serait dangereuse.
 *
 *   · CE QUE FAIT LE NAVIGATEUR — `validateDocumentCoverSource` lit les
 *     premiers octets et les confronte au type déclaré. C'est ce contrôle qui
 *     attrape un SVG renommé `.png`. Il tourne dans le navigateur du coach :
 *     un client forgé peut donc l'ignorer entièrement.
 *
 *   · CE QUE FAIT STORAGE — il applique `file_size_limit` aux octets
 *     réellement reçus (le plafond de 5 Mo est donc une VRAIE garantie
 *     serveur), et il compare `allowed_mime_types` au `content-type` ANNONCÉ
 *     par la requête. Le type, lui, n'est donc PAS une garantie : un appel
 *     qui annonce `image/png` en envoyant n'importe quels octets est accepté.
 *
 *   ⇒ AUCUNE VÉRIFICATION DE LA SIGNATURE RÉELLE N'EXISTE CÔTÉ SERVEUR. Ce
 *     module ne doit pas laisser croire le contraire, et le harnais de tests
 *     vérifie que cette limite reste écrite ici.
 *
 * CE QUI TIENT MALGRÉ TOUT, et pourquoi c'est acceptable en l'état :
 *   · `image/svg+xml` est EXCLU du seau : le vecteur qui compte — du XML
 *     exécutable servi comme une image — ne peut pas y être rangé sous un
 *     type que le navigateur interpréterait comme tel ;
 *   · le seau est PRIVÉ : rien n'est servi sans URL signée, donc sans passer
 *     par la policy de lecture ;
 *   · une couverture n'est JAMAIS rendue autrement que dans une balise `<img>` :
 *     un contenu qui n'est pas une image ne s'affiche pas, la carte retombe
 *     sur son emplacement neutre par `onError` ;
 *   · l'écriture exige une fiche staff et se borne au propre préfixe de
 *     l'appelant : un fichier forgé ne peut atterrir que chez son auteur,
 *     jamais chez un autre coach, et aucun élève ne peut en déposer.
 *
 * CE QUI MANQUE, ET CE QU'IL COÛTERAIT. Vérifier le contenu réel côté serveur
 * demanderait d'intercepter le téléversement — une Edge Function de relais, ou
 * un déclencheur qui relit l'objet après coup. Ce n'est PAS fait, et ce n'est
 * pas un oubli : cela ajoute un service à déployer et à surveiller, double le
 * chemin d'écriture (donc les modes d'échec et les orphelins possibles), et ne
 * protège que contre un membre du staff déjà authentifié et déjà cloisonné.
 * À décider si le besoin apparaît, pas à glisser dans ce lot.
 *
 * ═════════════════════════════════════════════════════════════════════════
 * CE QUI EST STOCKÉ EN BASE, ET CE QUI NE L'EST JAMAIS
 * ═════════════════════════════════════════════════════════════════════════
 * `documents.cover_storage_path` contient un CHEMIN. Jamais une URL signée :
 * une URL signée expire, et la stocker produirait quelques heures plus tard
 * des cartes cassées pour tout le monde — tandis qu'une signature de longue
 * durée équivaudrait à rendre le fichier public sans le dire.
 *
 * ═════════════════════════════════════════════════════════════════════════
 * CONVENTION DE CHEMIN — CELLE DU SEAU `documents`, PAS UNE AUTRE
 * ═════════════════════════════════════════════════════════════════════════
 *
 *     <fiche_coach>/<document_id>/<horodatage>-<nom de fichier>
 *
 * Le premier segment porte le PROPRIÉTAIRE, résolu EN BASE par
 * `current_staff_id()` — le navigateur propose un emplacement, la policy
 * refuse si ce n'est pas le sien. C'est ce préfixe qui autorise le
 * téléversement sans exiger que la ligne existe, et c'est lui qui protège un
 * objet devenu orphelin. `sanitizeFileName` et `ficheStaffDeLAppelant` sont
 * importées de `storage-documents.ts` : une seule convention, un seul endroit.
 */

export const DOCUMENT_COVERS_BUCKET = "document-covers";

/** Miroir exact de `file_size_limit` du seau (migration 20261024090000). */
export const DOCUMENT_COVER_MAX_BYTES = 5 * 1024 * 1024;

/** Miroir exact de `allowed_mime_types` du seau. Le SVG en est absent. */
export const DOCUMENT_COVER_MIME = ["image/jpeg", "image/png", "image/webp"] as const;

/**
 * Rapport d'affichage, FIXE. L'image est recadrée par `object-fit: cover`,
 * jamais déformée, et la place est réservée avant le chargement : la grille
 * ne saute pas selon qu'un document est illustré ou non.
 */
export const DOCUMENT_COVER_ASPECT = { width: 16, height: 9 } as const;

export type DocumentCoverRejection =
  | "empty"
  | "too_large"
  | "mime_not_supported"
  | "svg_refused"
  | "content_mismatch";

/** Message en français, à afficher tel quel près du champ. */
export function describeDocumentCoverRejection(code: DocumentCoverRejection): string {
  switch (code) {
    case "empty":
      return "Ce fichier est vide.";
    case "too_large":
      return `Image trop lourde (maximum ${Math.round(DOCUMENT_COVER_MAX_BYTES / (1024 * 1024))} Mo). Réduis sa résolution, puis réessaie.`;
    case "mime_not_supported":
      return "Format non pris en charge. Utilise une image JPEG, PNG ou WebP.";
    case "svg_refused":
      return "Le format SVG n'est pas accepté pour une miniature : un SVG peut contenir du script.";
    case "content_mismatch":
      return "Ce fichier ne contient pas l'image annoncée par son type : son contenu réel ne correspond pas.";
  }
}

/**
 * LE VERDICT SUR LE FICHIER SOURCE — ET L'EXTENSION N'Y ENTRE POUR RIEN.
 *
 * ⚠️ CÔTÉ NAVIGATEUR, DONC CONTOURNABLE. Voir la limite détaillée en tête de
 * module : le serveur n'inspecte pas les octets, il ne vérifie que la taille
 * et le `content-type` annoncé. Ce verdict sert à refuser tôt et à expliquer
 * clairement, il ne protège pas la base.
 *
 * ⚠️ `declaredType` est `file.type`, c'est-à-dire une DÉCLARATION que le
 * système de fichiers dérive du nom. Elle ne suffit pas : `head` porte les
 * premiers octets, et les deux doivent concorder. Un `.jpg` qui est en
 * réalité un SVG, un PDF ou n'importe quoi d'autre est refusé ici, sans
 * chercher à deviner lequel a raison.
 *
 * Fonction PURE : testable sans navigateur, sans fichier et sans base.
 */
export function validateDocumentCoverSource(
  declaredType: string,
  size: number,
  head: Uint8Array,
): DocumentCoverRejection | null {
  if (size <= 0) return "empty";
  if (size > DOCUMENT_COVER_MAX_BYTES) return "too_large";
  // Le SVG d'abord : son message est spécifique, et il ne doit jamais être
  // confondu avec un simple « format non pris en charge ».
  if (looksLikeSvg(head)) return "svg_refused";
  if (!(DOCUMENT_COVER_MIME as readonly string[]).includes(declaredType)) {
    return "mime_not_supported";
  }
  const réel = sniffImageMime(head);
  if (réel === null) return "content_mismatch";
  if (réel !== declaredType) return "content_mismatch";
  return null;
}

/** Les premiers octets du fichier, seule partie qui touche au navigateur. */
export async function lireEnTete(file: Blob, octets = IMAGE_HEAD_BYTES): Promise<Uint8Array> {
  const tampon = await file.slice(0, octets).arrayBuffer();
  return new Uint8Array(tampon);
}

/**
 * Validation complète d'un fichier choisi dans le sélecteur : rend un message
 * prêt à afficher, ou `null` si le fichier est acceptable.
 */
export async function validateDocumentCoverFile(file: File): Promise<string | null> {
  const code = validateDocumentCoverSource(file.type, file.size, await lireEnTete(file));
  return code === null ? null : describeDocumentCoverRejection(code);
}

type TypedSupabaseClient = SupabaseClient<Database>;

export interface UploadedDocumentCover {
  /** Chemin dans le seau — c'est CE texte qui va en base, pas une URL. */
  coverStoragePath: string;
}

/**
 * Téléverse une couverture dans `<fiche_coach>/<documentId>/<horodatage>-<nom>`.
 *
 * ⚠️ `upsert: false` : chaque couverture est un objet NEUF, horodaté. On
 * n'écrase jamais l'ancienne en place — c'est précisément ce qui permet de
 * n'effacer l'ancienne qu'APRÈS que la nouvelle soit inscrite en base.
 */
export async function uploadDocumentCover(
  supabase: TypedSupabaseClient,
  documentId: string,
  file: File,
): Promise<UploadedDocumentCover | { error: string }> {
  const fiche = await ficheStaffDeLAppelant(supabase);
  if (!fiche) {
    return {
      error:
        "Aucune fiche coach n'est rattachée à ce compte : la miniature n'a pas de propriétaire possible. Contacte l'administrateur.",
    };
  }
  const path = `${fiche}/${documentId}/${Date.now()}-${sanitizeFileName(file.name)}`;
  const { error } = await supabase.storage.from(DOCUMENT_COVERS_BUCKET).upload(path, file, {
    upsert: false,
    contentType: file.type || undefined,
  });
  if (error) {
    return { error: error.message };
  }
  return { coverStoragePath: path };
}

/**
 * Supprime un objet de couverture — silencieux, et JAMAIS bloquant.
 *
 * ⚠️ UN ÉCHEC ICI NE DOIT RIEN INTERROMPRE. Cet appel vient toujours APRÈS
 * que la base porte le nouvel état : à ce stade, un objet qui survit est un
 * orphelin inoffensif (son préfixe est la fiche de son propriétaire, donc
 * personne d'autre n'y accède), alors qu'une erreur remontée ferait croire à
 * l'échec d'une opération déjà réussie.
 */
export async function deleteDocumentCover(
  supabase: TypedSupabaseClient,
  coverStoragePath: string,
): Promise<void> {
  await supabase.storage.from(DOCUMENT_COVERS_BUCKET).remove([coverStoragePath]);
}

/**
 * URL signée temporaire pour AFFICHER une couverture — rend `null` si
 * l'appelant n'a pas le droit de lire l'objet (policy
 * `document_covers_select_accessible`).
 *
 * ⚠️ C'EST LA BASE QUI TRANCHE, PAS CET APPEL. Un brouillon, un archivé, un
 * document non assigné et non global, ou le document d'un autre coach ne
 * donnent aucune signature : la couverture ne peut donc pas servir à
 * contourner les règles de publication ni l'isolation entre coachs.
 *
 * ⚠️ UNE HEURE PAR DÉFAUT, et l'URL n'est jamais persistée — ni en base, ni
 * dans un stockage de navigateur.
 */
export async function getSignedDocumentCoverUrl(
  supabase: TypedSupabaseClient,
  coverStoragePath: string,
  expiresInSeconds = 3600,
): Promise<string | null> {
  const { data, error } = await supabase.storage
    .from(DOCUMENT_COVERS_BUCKET)
    .createSignedUrl(coverStoragePath, expiresInSeconds);
  if (error || !data) {
    return null;
  }
  return data.signedUrl;
}
