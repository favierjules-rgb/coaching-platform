/**
 * LA PHOTO D'UNE RECETTE — décisions PURES, aucune API de navigateur.
 *
 * ─────────────────────────────────────────────────────────────────────────
 * POURQUOI CE MODULE NE TOUCHE NI AU DOM NI À SUPABASE
 * ─────────────────────────────────────────────────────────────────────────
 * Tout ce qui décide — quel format est acceptable, quelle taille viser, à
 * quoi ressemble un chemin légitime — vit ici, en fonctions pures. Le module
 * qui parle au navigateur (`recipe-image-optimizer.ts`) et celui qui parle à
 * Storage (`lib/supabase/storage-recipe-images.ts`) ne font qu'appliquer ces
 * décisions. C'est ce qui rend les règles testables sans navigateur et sans
 * base.
 *
 * ─────────────────────────────────────────────────────────────────────────
 * CE MODULE N'EST PAS UNE PROTECTION
 * ─────────────────────────────────────────────────────────────────────────
 * Tout ce qui est écrit ici tourne dans le navigateur du coach : un client
 * forgé peut l'ignorer entièrement. Les VRAIES limites sont posées ailleurs,
 * par la migration 20260819090000 :
 *
 *   - `storage.buckets.file_size_limit`   = 1 Mo, imposé par Storage ;
 *   - `storage.buckets.allowed_mime_types`= webp et jpeg, imposé par Storage ;
 *   - les policies `recipe_images_*`      = le dossier doit appartenir au
 *                                           coach propriétaire de la recette ;
 *   - `nutrition_recipes_image_path_shape`= la colonne refuse tout chemin qui
 *                                           ne désigne pas CETTE recette.
 *
 * Les constantes de ce fichier sont donc des MIROIRS de ces règles, pour
 * refuser tôt et expliquer clairement — jamais pour les remplacer. Un test
 * verrouille leur cohérence avec la migration.
 */

/** Le bucket, nommé une seule fois dans tout le code applicatif. */
export const RECIPE_IMAGE_BUCKET = "recipe-images";

/**
 * Plafond du fichier SOURCE, avant optimisation.
 *
 * 15 Mo couvre large : une photo de 48 Mpx d'un téléphone récent pèse 8 à
 * 12 Mo. Au-delà, on refuse AVANT de décoder — décoder une image de 200 Mo
 * pour découvrir qu'elle est trop grande ferait tomber l'onglet.
 */
export const RECIPE_IMAGE_MAX_SOURCE_BYTES = 15 * 1024 * 1024;

/**
 * Plafond du fichier STOCKÉ. Miroir exact de `file_size_limit` du bucket : si
 * l'optimisation ne descend pas sous cette valeur, on refuse ici plutôt que
 * de laisser Storage rendre une erreur brute.
 */
export const RECIPE_IMAGE_MAX_STORED_BYTES = 1024 * 1024;

/**
 * Côté long visé, en pixels.
 *
 * 1400 px n'est pas un chiffre rond posé au hasard : c'est la largeur réelle
 * du conteneur d'une photo de recette sur un écran large (une colonne de
 * ~700 px CSS) à densité 2×. Au-delà, on stockerait des pixels que personne
 * ne voit ; en deçà, la photo deviendrait molle sur un écran Retina.
 * `next/image` re-découpe ensuite des variantes plus petites pour le mobile.
 */
export const RECIPE_IMAGE_MAX_EDGE = 1400;

/**
 * L'échelle de qualité, essayée dans l'ordre.
 *
 * 0,82 est le premier essai : au-dessus, le poids grimpe vite sans gain
 * visible sur une photo de plat ; en dessous, les aplats colorés (sauces,
 * dégradés) montrent des blocs. Les deux valeurs suivantes ne servent que si
 * le résultat dépasse encore le plafond du bucket — mieux vaut une photo un
 * peu plus compressée qu'un refus de Storage.
 */
export const RECIPE_IMAGE_QUALITY_LADDER = [0.82, 0.7, 0.6] as const;

/** Formats acceptés EN ENTRÉE. Le SVG en est absent, volontairement. */
export const RECIPE_IMAGE_SOURCE_MIME = ["image/jpeg", "image/png", "image/webp"] as const;

/** Formats produits. Miroir de `allowed_mime_types` du bucket. */
export const RECIPE_IMAGE_STORED_MIME = ["image/webp", "image/jpeg"] as const;

/**
 * Rapport d'affichage, fixé pour que la mise en page ne saute jamais.
 * L'image est recadrée par `object-fit: cover`, jamais déformée.
 */
export const RECIPE_IMAGE_ASPECT = { width: 4, height: 3 } as const;

export type RecipeImageRejection =
  | "empty"
  | "too_large"
  | "mime_not_supported"
  | "svg_refused"
  | "content_mismatch"
  | "decode_failed"
  | "encode_failed"
  | "still_too_large";

/** Message en français, à afficher tel quel près du champ. */
export function describeRecipeImageRejection(code: RecipeImageRejection): string {
  switch (code) {
    case "empty":
      return "Ce fichier est vide.";
    case "too_large":
      return `Fichier trop lourd (maximum ${Math.round(RECIPE_IMAGE_MAX_SOURCE_BYTES / (1024 * 1024))} Mo). Prends une photo de résolution plus modeste.`;
    case "mime_not_supported":
      return "Format non pris en charge. Utilise une image JPEG, PNG ou WebP.";
    case "svg_refused":
      return "Le format SVG n'est pas accepté pour une photo de recette : un SVG peut contenir du script.";
    case "content_mismatch":
      return "Ce fichier ne contient pas l'image annoncée par son extension.";
    case "decode_failed":
      return "Cette image n'a pas pu être lue par le navigateur. Réenregistre-la en JPEG ou PNG, puis réessaie.";
    case "encode_failed":
      return "L'optimisation de l'image a échoué. Réessaie avec une autre photo.";
    case "still_too_large":
      return "Même compressée, cette image reste trop lourde. Recadre-la ou réduis sa résolution avant de la déposer.";
  }
}

/* ────────────────────────── Le contenu réel du fichier ────────────────── */

/**
 * Le type MIME RÉEL, lu dans les premiers octets — pas dans `file.type`, qui
 * n'est qu'une déclaration du système de fichiers et se renomme en deux
 * secondes.
 *
 * Ce n'est pas une analyse complète du format : c'est le contrôle qu'on peut
 * faire honnêtement côté navigateur, et il attrape le cas qui compte — un
 * SVG (donc du XML exécutable) déposé sous le nom `photo.png`.
 *
 * Rend `null` quand la signature n'est reconnue par aucun format admis.
 */
export function sniffImageMime(bytes: Uint8Array): string | null {
  if (bytes.length >= 3 && bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff) {
    return "image/jpeg";
  }
  const PNG = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a];
  if (bytes.length >= 8 && PNG.every((octet, i) => bytes[i] === octet)) {
    return "image/png";
  }
  // WebP : « RIFF » …4 octets de taille… « WEBP »
  if (
    bytes.length >= 12 &&
    bytes[0] === 0x52 && bytes[1] === 0x49 && bytes[2] === 0x46 && bytes[3] === 0x46 &&
    bytes[8] === 0x57 && bytes[9] === 0x45 && bytes[10] === 0x42 && bytes[11] === 0x50
  ) {
    return "image/webp";
  }
  return null;
}

/** Vrai si les premiers octets ressemblent à du XML ou à un SVG. */
export function looksLikeSvg(bytes: Uint8Array): boolean {
  const début = new TextDecoder("utf-8", { fatal: false })
    .decode(bytes.subarray(0, Math.min(bytes.length, 256)))
    .trimStart()
    .toLowerCase();
  return début.startsWith("<?xml") || début.startsWith("<svg");
}

/**
 * Le verdict sur le fichier SOURCE, avant tout décodage.
 *
 * `declaredType` est `file.type` ; `head` sont ses premiers octets. Les deux
 * doivent concorder : un fichier dont l'en-tête dit autre chose que son type
 * déclaré est refusé, sans chercher à deviner lequel a raison.
 */
export function validateRecipeImageSource(
  declaredType: string,
  size: number,
  head: Uint8Array,
): RecipeImageRejection | null {
  if (size <= 0) return "empty";
  if (size > RECIPE_IMAGE_MAX_SOURCE_BYTES) return "too_large";
  if (looksLikeSvg(head)) return "svg_refused";
  if (!(RECIPE_IMAGE_SOURCE_MIME as readonly string[]).includes(declaredType)) {
    return "mime_not_supported";
  }
  const réel = sniffImageMime(head);
  if (réel === null) return "content_mismatch";
  // `image/jpg` n'existe pas comme type MIME : `declaredType` est déjà borné
  // à la liste ci-dessus, la comparaison est donc directe.
  if (réel !== declaredType) return "content_mismatch";
  return null;
}

/* ────────────────────────── Les dimensions ────────────────────────────── */

export interface ImageDimensions {
  readonly width: number;
  readonly height: number;
}

/**
 * Dimensions cibles : le côté long ramené à `maxEdge`, le rapport conservé.
 *
 * UNE IMAGE PLUS PETITE N'EST JAMAIS AGRANDIE — ré-échantillonner vers le
 * haut n'ajoute aucun détail et ne fait que gonfler le fichier.
 */
export function computeResizedDimensions(
  source: ImageDimensions,
  maxEdge: number = RECIPE_IMAGE_MAX_EDGE,
): ImageDimensions {
  const { width, height } = source;
  if (!Number.isFinite(width) || !Number.isFinite(height) || width <= 0 || height <= 0) {
    return { width: 0, height: 0 };
  }
  const côtéLong = Math.max(width, height);
  if (côtéLong <= maxEdge) {
    return { width: Math.round(width), height: Math.round(height) };
  }
  const facteur = maxEdge / côtéLong;
  return {
    width: Math.max(1, Math.round(width * facteur)),
    height: Math.max(1, Math.round(height * facteur)),
  };
}

/* ────────────────────────── Le chemin Storage ─────────────────────────── */

/** Extension du fichier stocké, déduite du type produit. */
export function recipeImageExtension(mime: string): "webp" | "jpg" {
  return mime === "image/jpeg" ? "jpg" : "webp";
}

/**
 * Le chemin d'un objet : `recipes/<coachId>/<recipeId>/<uuid>.<ext>`.
 *
 * TROIS PROPRIÉTÉS VOULUES.
 *   1. le dossier porte le coach ET la recette : la policy Storage peut donc
 *      vérifier l'appartenance par jointure, et non par confiance ;
 *   2. le nom de fichier est un UUID NEUF à chaque dépôt. Écraser
 *      `cover.webp` en place perdrait l'ancienne image avant que la nouvelle
 *      soit confirmée, et laisserait les caches servir la précédente ;
 *   3. aucune donnée d'élève, aucun nom de fichier d'origine, aucun
 *      horodatage : le chemin ne raconte rien.
 *
 * `fileId` est injecté pour que les tests soient déterministes.
 */
export function buildRecipeImagePath(
  coachId: string,
  recipeId: string,
  fileId: string,
  mime: string,
): string {
  return `recipes/${coachId}/${recipeId}/${fileId}.${recipeImageExtension(mime)}`;
}

/** Miroir EXACT de la contrainte SQL `nutrition_recipes_image_path_shape`. */
const CHEMIN_ATTENDU = /^recipes\/([0-9a-f-]{36})\/([0-9a-f-]{36})\/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\.(webp|jpg)$/;

/**
 * Vrai si le chemin désigne bien CETTE recette de CE coach.
 *
 * Utilisé pour refuser tôt, jamais comme autorisation : la contrainte de
 * table et les policies Storage tranchent réellement.
 */
export function isRecipeImagePathFor(path: string, coachId: string, recipeId: string): boolean {
  const m = CHEMIN_ATTENDU.exec(path);
  return m !== null && m[1] === coachId && m[2] === recipeId;
}

/**
 * L'URL publique d'un objet du bucket.
 *
 * Dérivée, jamais stockée : le jour où le projet Supabase change d'hôte,
 * aucune ligne de `nutrition_recipes` n'est à réécrire. Rend `null` si l'URL
 * de base manque — l'appelant affiche alors le repli sans photo.
 */
export function recipeImagePublicUrl(supabaseUrl: string | undefined, path: string | null): string | null {
  if (!supabaseUrl || !path) return null;
  const base = supabaseUrl.replace(/\/+$/, "");
  return `${base}/storage/v1/object/public/${RECIPE_IMAGE_BUCKET}/${path}`;
}

/**
 * Le motif `remotePatterns` attendu par `next.config.ts`, dérivé de la même
 * URL. Exporté pour qu'un test vérifie que la configuration et le code
 * décrivent le MÊME hôte et le MÊME chemin — un `**` trop large passerait
 * inaperçu autrement.
 */
export function recipeImageRemotePattern(supabaseUrl: string | undefined): {
  protocol: "https";
  hostname: string;
  pathname: string;
  search: "";
} | null {
  if (!supabaseUrl) return null;
  let hôte: string;
  try {
    hôte = new URL(supabaseUrl).hostname;
  } catch {
    return null;
  }
  if (hôte === "") return null;
  return {
    protocol: "https",
    hostname: hôte,
    pathname: `/storage/v1/object/public/${RECIPE_IMAGE_BUCKET}/**`,
    search: "",
  };
}
