/**
 * LA SIGNATURE RÉELLE D'UN FICHIER IMAGE — lue dans ses octets, pas dans son nom.
 *
 * ─────────────────────────────────────────────────────────────────────────
 * POURQUOI CE MODULE EXISTE SÉPARÉMENT
 * ─────────────────────────────────────────────────────────────────────────
 * Ces deux fonctions sont nées dans `lib/nutrition/recipe-image.ts` pour les
 * photos de recettes. Les miniatures de documents ont exactement le même
 * besoin, et il n'y a pas deux manières correctes de reconnaître un PNG.
 * Les laisser dans le module nutrition aurait obligé le module documents à en
 * dépendre — un couplage sans rapport avec le sujet. Elles sont donc ici, et
 * `recipe-image.ts` les ré-exporte pour que rien de ce qui les importait déjà
 * ne change.
 *
 * ─────────────────────────────────────────────────────────────────────────
 * CE MODULE N'EST PAS UNE PROTECTION, ET NE PEUT PAS L'ÊTRE
 * ─────────────────────────────────────────────────────────────────────────
 * Tout ce qui est écrit ici tourne dans le navigateur : un client forgé peut
 * l'ignorer entièrement. La VRAIE limite est posée par Storage, sur le seau
 * (`file_size_limit`, `allowed_mime_types`) et par ses policies. Ce module
 * sert à refuser TÔT et à EXPLIQUER clairement — jamais à remplacer la base.
 *
 * Ce n'est pas non plus une analyse complète des formats : c'est le contrôle
 * qu'on peut faire honnêtement sur les premiers octets, et il attrape le cas
 * qui compte — un SVG (donc du XML exécutable) déposé sous le nom
 * `photo.png`, que `file.type` déclarerait obligeamment comme une image.
 */

/**
 * Le type MIME RÉEL, lu dans les premiers octets — pas dans `file.type`, qui
 * n'est qu'une déclaration du système de fichiers et se renomme en deux
 * secondes.
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
 * Nombre d'octets à lire en tête de fichier pour que les deux fonctions
 * ci-dessus puissent trancher. 256 couvre la plus longue inspection
 * (`looksLikeSvg`), et reste minuscule face à un fichier de plusieurs Mo.
 */
export const IMAGE_HEAD_BYTES = 256;
