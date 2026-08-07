import {
  RECIPE_IMAGE_MAX_EDGE,
  RECIPE_IMAGE_MAX_STORED_BYTES,
  RECIPE_IMAGE_QUALITY_LADDER,
  computeResizedDimensions,
  validateRecipeImageSource,
  type ImageDimensions,
  type RecipeImageRejection,
} from "@/lib/nutrition/recipe-image";

/**
 * L'OPTIMISATION AVANT ENVOI — redimensionner, réorienter, ré-encoder.
 *
 * ─────────────────────────────────────────────────────────────────────────
 * POURQUOI DANS LE NAVIGATEUR, ET PAS SUR LE SERVEUR
 * ─────────────────────────────────────────────────────────────────────────
 * `sharp` est bien présent dans le projet, mais uniquement parce que Next.js
 * s'en sert pour son optimiseur d'images : aucun code applicatif ne l'importe.
 * L'utiliser côté serveur imposerait une route qui reçoive les 12 Mo bruts,
 * les tienne en mémoire, puis les repousse vers Storage — trois fois le
 * transfert, et une route de plus à protéger.
 *
 * Ré-encoder dans le navigateur envoie 300 Ko au lieu de 12 Mo. Sur une
 * connexion mobile, c'est la différence entre « instantané » et « ça a
 * échoué ».
 *
 * ─────────────────────────────────────────────────────────────────────────
 * ET CE N'EST PAS LA PROTECTION
 * ─────────────────────────────────────────────────────────────────────────
 * Un client forgé n'exécute pas ce fichier. C'est pourquoi le bucket porte
 * `file_size_limit` et `allowed_mime_types` (migration 20260819090000) : la
 * limite qui compte est celle que Storage applique, quelle que soit la
 * provenance de la requête. Ce module rend les fichiers légers ; il ne rend
 * rien sûr.
 *
 * ─────────────────────────────────────────────────────────────────────────
 * L'ORIENTATION EXIF, SANS DÉPENDANCE
 * ─────────────────────────────────────────────────────────────────────────
 * Une photo prise en portrait porte souvent son orientation dans une balise
 * EXIF plutôt que dans ses pixels. Dessinée naïvement sur un canevas, elle
 * ressort couchée. `createImageBitmap(file, { imageOrientation: "from-image" })`
 * applique la rotation au décodage — c'est du navigateur, pas d'une
 * bibliothèque.
 *
 * ─────────────────────────────────────────────────────────────────────────
 * LES PRIMITIVES SONT INJECTABLES
 * ─────────────────────────────────────────────────────────────────────────
 * Trois appels seulement dépendent du navigateur : décoder, dessiner,
 * encoder. Ils vivent derrière `RecipeImageCodec`, ce qui permet de tester
 * l'ENCHAÎNEMENT — l'ordre des essais, le repli JPEG, l'échelle de qualité,
 * chaque cas d'échec — dans Node, sans navigateur. Le codec réel est vérifié
 * séparément dans un vrai Chromium.
 */

export interface DecodedImage {
  readonly bitmap: unknown;
  readonly width: number;
  readonly height: number;
}

export interface EncodedImage {
  readonly blob: Blob;
  readonly type: string;
}

export interface RecipeImageCodec {
  /** Décode le fichier, orientation EXIF appliquée. Lève si le format est illisible. */
  readonly decode: (file: Blob) => Promise<DecodedImage>;
  /**
   * Redessine à `dims` puis encode en `mime`. Rend `null` quand le navigateur
   * ne sait pas produire ce format — c'est le seul signal fiable, `toBlob`
   * retombant silencieusement sur PNG dans ce cas.
   */
  readonly encode: (
    decoded: DecodedImage,
    dims: ImageDimensions,
    mime: string,
    quality: number,
  ) => Promise<EncodedImage | null>;
  /** Libère les ressources du décodage. Facultatif. */
  readonly release?: (decoded: DecodedImage) => void;
}

export interface OptimizedRecipeImage {
  readonly ok: true;
  readonly blob: Blob;
  readonly mime: string;
  readonly width: number;
  readonly height: number;
  readonly bytes: number;
  /** Poids du fichier d'origine — pour dire au coach ce qui a été gagné. */
  readonly sourceBytes: number;
  /** Qualité retenue : la première de l'échelle qui tient sous le plafond. */
  readonly quality: number;
}

export interface RejectedRecipeImage {
  readonly ok: false;
  readonly code: RecipeImageRejection;
}

export type RecipeImageResult = OptimizedRecipeImage | RejectedRecipeImage;

/** Ordre d'essai des formats produits : WebP d'abord, JPEG en repli. */
const FORMATS = ["image/webp", "image/jpeg"] as const;

/**
 * Le pipeline complet : valider, décoder, redimensionner, encoder.
 *
 * L'ORDRE DES ESSAIS. On tente WebP à la qualité la plus haute de l'échelle.
 * Si le navigateur ne sait pas produire de WebP, on bascule sur JPEG et on ne
 * revient plus en arrière — inutile de redemander à chaque palier. Si le
 * fichier dépasse encore le plafond du bucket, on descend d'un cran de
 * qualité, jusqu'à épuisement de l'échelle. Un refus explicite vaut mieux
 * qu'un envoi que Storage rejettera avec un message illisible.
 */
export async function optimizeRecipeImage(
  file: File | Blob,
  codec: RecipeImageCodec,
  maxEdge: number = RECIPE_IMAGE_MAX_EDGE,
): Promise<RecipeImageResult> {
  const déclaré = (file as File).type ?? "";
  const entête = new Uint8Array(await file.slice(0, 256).arrayBuffer());

  const refus = validateRecipeImageSource(déclaré, file.size, entête);
  if (refus !== null) {
    return { ok: false, code: refus };
  }

  let décodée: DecodedImage;
  try {
    décodée = await codec.decode(file);
  } catch {
    return { ok: false, code: "decode_failed" };
  }

  try {
    if (décodée.width <= 0 || décodée.height <= 0) {
      return { ok: false, code: "decode_failed" };
    }
    const dims = computeResizedDimensions(
      { width: décodée.width, height: décodée.height },
      maxEdge,
    );

    let formatRetenu: string | null = null;
    let aucunFormatDisponible = true;

    for (const quality of RECIPE_IMAGE_QUALITY_LADDER) {
      const àTester: readonly string[] = formatRetenu !== null ? [formatRetenu] : FORMATS;

      for (const mime of àTester) {
        const encodée = await codec.encode(décodée, dims, mime, quality);
        // `null`, ou un type différent de celui demandé : le navigateur ne
        // sait pas produire ce format. `canvas.toBlob` retombe sur PNG sans
        // le dire — comparer le type est le seul contrôle honnête.
        if (encodée === null || encodée.type !== mime) continue;

        aucunFormatDisponible = false;
        formatRetenu = mime;

        if (encodée.blob.size <= RECIPE_IMAGE_MAX_STORED_BYTES) {
          return {
            ok: true,
            blob: encodée.blob,
            mime,
            width: dims.width,
            height: dims.height,
            bytes: encodée.blob.size,
            sourceBytes: file.size,
            quality,
          };
        }
        // Le format est DÉCIDÉ dès qu'il produit un fichier : trop lourd ne
        // veut pas dire « essayons l'autre format », mais « descendons d'un
        // cran de qualité ». Sans ce `break`, la suite des essais dépendrait
        // du palier — un comportement qu'aucun test ne pourrait décrire
        // simplement.
        break;
      }
    }

    return { ok: false, code: aucunFormatDisponible ? "encode_failed" : "still_too_large" };
  } finally {
    codec.release?.(décodée);
  }
}

/* ────────────────────── Le codec réel, côté navigateur ────────────────── */

/**
 * Le codec du navigateur. Isolé ici pour que rien d'autre dans le module ne
 * dépende du DOM, et pour qu'un test puisse le remplacer intégralement.
 */
export const browserRecipeImageCodec: RecipeImageCodec = {
  async decode(file) {
    // `imageOrientation: "from-image"` applique la rotation EXIF au
    // décodage : sans elle, les photos prises en portrait ressortent
    // couchées, et il faudrait lire l'EXIF à la main.
    const bitmap = await createImageBitmap(file, { imageOrientation: "from-image" });
    return { bitmap, width: bitmap.width, height: bitmap.height };
  },

  async encode(decoded, dims, mime, quality) {
    const canvas = document.createElement("canvas");
    canvas.width = dims.width;
    canvas.height = dims.height;
    const contexte = canvas.getContext("2d");
    if (!contexte) return null;

    // Un fond blanc AVANT le dessin : le JPEG ne connaît pas la
    // transparence, et un PNG transparent ré-encodé en JPEG sans fond
    // ressort avec des zones noires.
    if (mime === "image/jpeg") {
      contexte.fillStyle = "#ffffff";
      contexte.fillRect(0, 0, dims.width, dims.height);
    }
    contexte.imageSmoothingEnabled = true;
    contexte.imageSmoothingQuality = "high";
    contexte.drawImage(decoded.bitmap as ImageBitmap, 0, 0, dims.width, dims.height);

    const blob = await new Promise<Blob | null>((resolve) => {
      canvas.toBlob((b) => resolve(b), mime, quality);
    });
    // Le canevas garde sa mémoire tant qu'il a une taille : on la libère.
    canvas.width = 0;
    canvas.height = 0;
    return blob === null ? null : { blob, type: blob.type };
  },

  release(decoded) {
    (decoded.bitmap as ImageBitmap | undefined)?.close?.();
  },
};
