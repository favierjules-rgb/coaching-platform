import {
  FORMATS_A4,
  FORMATS_WASM,
  NOM_MOTEUR,
  formatWasmVersA4,
  type MoteurScan,
  type ResultatScan,
} from "@/lib/scan/moteur";

/**
 * LE DÉCODEUR — `zxing-wasm`, ET LUI SEUL (ALIMENTS A4, PHASE 3).
 *
 * ────────────────────────────────────────────────────────────────────────────
 * CE FICHIER EST UNE DÉCISION, PLUS UN BANC D'ESSAI
 * ────────────────────────────────────────────────────────────────────────────
 * Deux bibliothèques ont été comparées en phase 2, sur un iPhone réel et sur de
 * vrais produits. `@zxing/library` a été RETIRÉ du dépôt : sur un paquet de
 * galettes de maïs, il n'obtenait aucun code valide après plus de 200 images là
 * où `zxing-wasm` lisait le code. Les ~270 Ko qu'il économisait ne valent pas un
 * produit qu'on n'arrive pas à scanner.
 *
 * Ce que ce fichier garantit : **le décodeur n'entre pas dans le bundle
 * principal**. La fabrique fait un `import()` DYNAMIQUE, évalué au moment où on
 * l'appelle. Un élève qui n'ouvre jamais le scanner ne télécharge pas un octet
 * de WebAssembly.
 *
 * ⚠️ Ce module est CLIENT. Il ne doit être importé que depuis un composant
 * `"use client"`, et lui-même par `import()`.
 */

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
 *     MESURÉ en phase 2 : surcharges retirées, le navigateur rapporte
 *     « Refused to connect to … because it violates … connect-src 'self' ».
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
 * Vérifié sur un vrai build : `/_next/static/media/zxing_reader.<empreinte>.wasm`,
 * servi en `application/wasm` et `immutable`.
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
    nom: NOM_MOTEUR,
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
