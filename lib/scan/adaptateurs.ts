import {
  FORMATS_A4,
  FORMATS_WASM,
  formatWasmVersA4,
  type MoteurScan,
  type NomMoteur,
  type ResultatScan,
} from "@/lib/scan/moteur";

/**
 * LES DEUX CANDIDATS, DERRIÈRE LA MÊME INTERFACE (ALIMENTS A4, PHASE 2).
 *
 * ────────────────────────────────────────────────────────────────────────────
 * CE FICHIER EST UN BANC D'ESSAI, PAS UNE DÉCISION
 * ────────────────────────────────────────────────────────────────────────────
 * Les deux bibliothèques sont installées TEMPORAIREMENT, le temps de les
 * comparer sur un vrai iPhone. Le perdant sortira du `package.json` et du
 * verrou de dépendances avant la fin de la phase 2 — et son adaptateur
 * disparaîtra d'ici avec lui.
 *
 * Ce que ce fichier garantit en attendant : **aucun des deux n'entre dans le
 * bundle principal**. Chaque fabrique fait un `import()` DYNAMIQUE, évalué au
 * moment où on l'appelle. Un élève qui n'ouvre jamais le scanner ne télécharge
 * ni le WebAssembly, ni le portage JavaScript.
 *
 * ⚠️ Ce module est CLIENT. Il ne doit être importé que depuis un composant
 * `"use client"`, et lui-même par `import()`.
 */

/* ══════════════════════════════════════════════════════════════════════════
   CANDIDAT A — zxing-wasm (ZXing-C++ compilé en WebAssembly, MIT)
   ══════════════════════════════════════════════════════════════════════════ */

/**
 * LE FICHIER `.wasm` EST SERVI PAR NOUS, PAS PAR UN CDN TIERS.
 *
 * ────────────────────────────────────────────────────────────────────────────
 * CE QUE FAIT LA BIBLIOTHÈQUE SI ON NE LUI DIT RIEN
 * ────────────────────────────────────────────────────────────────────────────
 * `zxing-wasm@3.1.2` embarque un `locateFile` par défaut qui renvoie
 * `https://fastly.jsdelivr.net/npm/zxing-wasm@<version>/dist/reader/…`. Autrement
 * dit : sans cette ligne, ouvrir le scanner déclencherait un appel réseau vers
 * un tiers, à chaque premier scan, depuis le téléphone de l'élève.
 *
 * Trois raisons de refuser, et aucune n'est théorique :
 *
 *  1. LA CSP. `connect-src` n'autorise que `'self'`, Supabase, Stripe et Vercel.
 *     La politique est encore en Report-Only — le jour où elle passe bloquante
 *     (procédure écrite en fin de `next.config.ts`), le scanner cesserait de
 *     fonctionner, et le seul symptôme serait un écran qui ne décode rien.
 *  2. LA DISPONIBILITÉ. Une panne de CDN deviendrait une panne de scanner, sur
 *     un chemin que nous ne déployons pas et ne surveillons pas.
 *  3. LA VIE PRIVÉE. Chaque ouverture du scanner révélerait l'adresse IP de
 *     l'élève à un tiers qui n'a rien à voir avec le service.
 *
 * ────────────────────────────────────────────────────────────────────────────
 * CE QU'ON FAIT À LA PLACE
 * ────────────────────────────────────────────────────────────────────────────
 * `new URL(<spécificateur>, import.meta.url)` est repris par le bundler : le
 * `.wasm` est COPIÉ dans `/_next/static/media/` avec une empreinte de contenu
 * dans son nom, et l'expression est remplacée à la compilation par ce chemin.
 * Vérifié sur un vrai build : `/_next/static/media/zxing_reader.<empreinte>.wasm`.
 *
 * Trois conséquences gratuites, et c'est pour cela que cette solution a été
 * préférée à une copie dans `public/` :
 *   • même origine — `connect-src 'self'` suffit, la CSP n'a pas à bouger ;
 *   • empreinte de contenu — Next sert `/_next/static/` en `immutable`, le
 *     fichier n'est donc téléchargé qu'UNE fois par version ;
 *   • le service worker le met déjà en cache : sa règle `cacheDAbord` couvre
 *     `/_next/static/`, et RIEN n'a eu à y être modifié.
 *
 * La version suit `package.json` toute seule : aucun numéro n'est recopié ici,
 * donc rien ne peut diverger d'une mise à jour.
 */
const URL_WASM_LECTEUR = new URL("zxing-wasm/reader/zxing_reader.wasm", import.meta.url).href;

/**
 * ⚠️ CET OBJET EST CONSTRUIT UNE SEULE FOIS, ET C'EST NÉCESSAIRE.
 *
 * `prepareZXingModule` compare les surcharges reçues à celles déjà en cache
 * pour décider s'il peut réutiliser le module. La comparaison est une égalité
 * de surface : une fonction `locateFile` recréée à chaque appel serait une
 * valeur différente, le cache serait invalidé, et le WebAssembly réinstancié à
 * chaque ouverture du scanner.
 */
const SURCHARGES_WASM = {
  locateFile: (fichier: string, prefixe: string) =>
    fichier.endsWith(".wasm") ? URL_WASM_LECTEUR : prefixe + fichier,
};

/**
 * La traduction des noms de formats vit dans `moteur.ts` : elle est éprouvable
 * sous Node, alors que ce fichier-ci ne peut être chargé que par un bundler.
 */

export async function fabriquerMoteurWasm(): Promise<MoteurScan> {
  // `import()` : c'est ICI que le décodeur part sur le réseau, et nulle part
  // avant. Le sous-chemin `/reader` est délibéré — il n'embarque ni l'encodeur
  // ni le build « full ».
  const zxing = await import("zxing-wasm/reader");

  let prêt = false;
  return {
    nom: "zxing-wasm",
    async initialiser() {
      if (prêt) return;
      // Le WebAssembly est instancié UNE fois, pendant que la caméra démarre —
      // pas à la première image, où il ferait un à-coup visible à l'écran.
      await zxing.prepareZXingModule({
        overrides: SURCHARGES_WASM,
        fireImmediately: true,
      });
      prêt = true;
    },
    async decoder(image: ImageData): Promise<ResultatScan | null> {
      // `readBarcodes` et non `readBarcodesFromImageData` : cette dernière est
      // marquée dépréciée dans la version installée, et accepte exactement la
      // même entrée.
      const résultats = await zxing.readBarcodes(image, {
        formats: FORMATS_A4.map((f) => FORMATS_WASM[f]) as never,
        // Un seul code suffit : l'élève scanne un produit, pas une étagère.
        maxNumberOfSymbols: 1,
        tryHarder: true,
      });
      const premier = résultats[0];
      if (!premier || typeof premier.text !== "string" || premier.text === "") return null;
      return { rawValue: premier.text, format: formatWasmVersA4(String(premier.format)) };
    },
    detruire() {
      // Le module WebAssembly est rendu : sur un téléphone, garder un mégaoctet
      // de mémoire alloué après la fermeture d'une feuille n'a aucune raison
      // d'être, et la bibliothèque le rechargera si l'élève rescanne.
      zxing.purgeZXingModule();
      prêt = false;
    },
  };
}

/* ══════════════════════════════════════════════════════════════════════════
   CANDIDAT B — @zxing/library (portage TypeScript pur, Apache-2.0)
   ══════════════════════════════════════════════════════════════════════════ */

export async function fabriquerMoteurJs(): Promise<MoteurScan> {
  const importé = await import("@zxing/library");

  /**
   * ⚠️ INTEROPÉRABILITÉ CJS/ESM — ce n'est pas de la superstition défensive.
   *
   * `@zxing/library@0.23.0` n'a pas de champ `exports` : `main` pointe vers le
   * build CommonJS, `module` vers le build ES. Un bundler navigateur prend le
   * second et les exportations nommées existent ; Node prend le premier, et
   * `MultiFormatReader` n'est alors accessible que sous `default` — mesuré, pas
   * supposé. Un harnais de test qui importerait ce module sous Node casserait
   * sans cette ligne, et le message (`is not a constructor`) ne dirait pas
   * pourquoi.
   */
  const zxing = (
    "MultiFormatReader" in importé
      ? importé
      : (importé as unknown as { default: typeof importé }).default
  ) as typeof importé;

  const {
    MultiFormatReader,
    RGBLuminanceSource,
    HybridBinarizer,
    BinaryBitmap,
    DecodeHintType,
    BarcodeFormat,
  } = zxing;

  const formats = [
    BarcodeFormat.EAN_13,
    BarcodeFormat.EAN_8,
    BarcodeFormat.UPC_A,
    BarcodeFormat.UPC_E,
  ];
  const noms: Readonly<Record<number, string>> = {
    [BarcodeFormat.EAN_13]: "ean_13",
    [BarcodeFormat.EAN_8]: "ean_8",
    [BarcodeFormat.UPC_A]: "upc_a",
    [BarcodeFormat.UPC_E]: "upc_e",
  };

  const lecteur = new MultiFormatReader();
  const indices = new Map<number, unknown>();
  indices.set(DecodeHintType.POSSIBLE_FORMATS, formats);
  indices.set(DecodeHintType.TRY_HARDER, true);
  lecteur.setHints(indices as never);

  return {
    nom: "zxing-js",
    async initialiser() {
      // Rien à préparer : le portage est du JavaScript, déjà chargé par
      // l'`import()` ci-dessus. La différence de coût entre les deux candidats
      // se joue donc ici, et le banc d'essai la mesure.
    },
    async decoder(image: ImageData): Promise<ResultatScan | null> {
      // `RGBLuminanceSource` attend un tableau de luminances, pas des pixels
      // RGBA : la conversion est faite ici, une fois par image.
      const luminances = new Uint8ClampedArray(image.width * image.height);
      for (let i = 0, j = 0; i < image.data.length; i += 4, j += 1) {
        // Pondération perceptuelle usuelle — la même que celle utilisée par
        // ZXing lui-même, pour que les deux candidats voient la même image.
        luminances[j] =
          (image.data[i] * 306 + image.data[i + 1] * 601 + image.data[i + 2] * 117) >> 10;
      }
      const source = new RGBLuminanceSource(luminances, image.width, image.height);
      const bitmap = new BinaryBitmap(new HybridBinarizer(source));
      try {
        const résultat = lecteur.decode(bitmap);
        const texte = résultat.getText();
        if (typeof texte !== "string" || texte === "") return null;
        return { rawValue: texte, format: noms[résultat.getBarcodeFormat()] ?? "inconnu" };
      } catch {
        // `NotFoundException` à chaque image sans code : c'est le cas NORMAL,
        // huit fois par seconde. Le remonter comme une erreur noierait le
        // journal et ferait passer l'ordinaire pour un incident.
        return null;
      } finally {
        lecteur.reset();
      }
    },
    detruire() {
      lecteur.reset();
    },
  };
}

/** Les fabriques, indexées — chacune reste un `import()` non évalué tant qu'on ne l'appelle pas. */
export const FABRIQUES: Readonly<Record<NomMoteur, () => Promise<MoteurScan>>> = {
  "zxing-wasm": fabriquerMoteurWasm,
  "zxing-js": fabriquerMoteurJs,
};
