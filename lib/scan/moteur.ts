import { lireGtin } from "@/lib/scan/gtin";

/**
 * LE MOTEUR DE DÉCODAGE (ALIMENTS A4, PHASE 3).
 *
 * ────────────────────────────────────────────────────────────────────────────
 * LE CHOIX EST FAIT, ET IL A ÉTÉ MESURÉ
 * ────────────────────────────────────────────────────────────────────────────
 * `zxing-wasm`, sur benchmark iPhone physique. Le portage JavaScript pur a été
 * RETIRÉ du dépôt : sur un paquet de galettes de maïs, il n'obtenait aucun code
 * valide après plus de 200 images là où le WebAssembly lisait le code. Un code
 * illisible coûte plus cher qu'un téléchargement de plus.
 *
 * ────────────────────────────────────────────────────────────────────────────
 * CE QUE LE MOTEUR NE DÉCIDE JAMAIS
 * ────────────────────────────────────────────────────────────────────────────
 * Il rend une CHAÎNE lue sur une image. Il ne dit pas si c'est un produit
 * alimentaire, ni si le code est un GTIN, ni s'il faut arrêter de scanner. Une
 * caméra passe devant des codes de rayon, des étiquettes de logistique, des QR
 * de promotion : les lire est normal, les accepter ne l'est pas. La validation
 * métier appartient à `lib/scan/gtin.ts`, en aval.
 */

/**
 * Les formats cherchés — quatre, et pas un de plus.
 *
 * EAN-13 et EAN-8 couvrent l'Europe, UPC-A et UPC-E l'Amérique du Nord. Ni QR,
 * ni Data Matrix, ni Code 128 : chaque symbologie supplémentaire est du travail
 * par image, et surtout une porte ouverte aux faux positifs — un Code 39 sur
 * une étiquette de prix n'est pas un produit, et le décoder ne peut que nous
 * faire perdre du temps ou verrouiller le scan sur un mauvais code.
 *
 * ⚠️ HYPOTHÈSE NON MESURÉE, et signalée comme telle. « Moins de formats = plus
 * rapide » est plausible et documenté par les auteurs de ZXing, mais le
 * benchmark iPhone n'a pas comparé cette liste à une liste élargie : il a
 * comparé deux MOTEURS. La restriction reste justifiée par les faux positifs,
 * pas par une mesure de vitesse.
 *
 * ITF-14 est volontairement absent : c'est un code de CARTON de regroupement,
 * pas d'unité consommateur. Un ITF-14 encapsule le GTIN-13 de l'unité, mais
 * l'article scanné serait alors le carton — un chiffre indicateur différent,
 * donc un autre produit chez Open Food Facts. Le rendre lisible ferait scanner
 * des palettes.
 */
export const FORMATS_A4 = ["ean_13", "ean_8", "upc_a", "upc_e"] as const;
export type FormatA4 = (typeof FORMATS_A4)[number];

export interface ResultatScan {
  /** La chaîne lue, telle quelle. Jamais un nombre. */
  readonly rawValue: string;
  readonly format: string;
}

/* ══════════════════════════════════════════════════════════════════════════
   LE VOCABULAIRE DES FORMATS — TRADUIT ICI, PAS DANS LES ADAPTATEURS
   ══════════════════════════════════════════════════════════════════════════ */

/**
 * ZXing-C++ ne nomme pas les formats comme la spécification BarcodeDetector :
 * `EAN13` là-bas, `ean_13` ici.
 *
 * La table vit dans CE module, et non dans l'adaptateur, pour deux raisons :
 * elle est éprouvable sous Node (l'adaptateur, lui, ne peut être chargé que par
 * un bundler), et elle survivra au retrait du candidat perdant sans qu'on ait à
 * la réécrire.
 */
export const FORMATS_WASM: Readonly<Record<FormatA4, string>> = {
  ean_13: "EAN13",
  ean_8: "EAN8",
  upc_a: "UPCA",
  upc_e: "UPCE",
};

/**
 * ⚠️ DEUX ORTHOGRAPHES, MESURÉES ET NON SUPPOSÉES.
 *
 * `zxing-wasm@3.1.2` ACCEPTE en entrée le libellé lisible (`"EAN-13"`) mais
 * RENVOIE le nom canonique (`"EAN13"`, sans tiret) — constaté en décodant cinq
 * EAN-13 de synthèse hors navigateur. Une table qui ne connaîtrait qu'une seule
 * des deux formes laisserait remonter le nom brut de la bibliothèque, c'est-à-
 * dire une fuite de SON vocabulaire dans le NÔTRE.
 */
const RETOUR_WASM: Readonly<Record<string, FormatA4>> = {
  EAN13: "ean_13",
  "EAN-13": "ean_13",
  EAN8: "ean_8",
  "EAN-8": "ean_8",
  UPCA: "upc_a",
  "UPC-A": "upc_a",
  UPCE: "upc_e",
  "UPC-E": "upc_e",
};

/** Traduit un nom de format de ZXing-C++ vers le vocabulaire A4. */
export function formatWasmVersA4(format: string): string {
  return RETOUR_WASM[format] ?? format;
}

/**
 * Le contrat que le moteur doit tenir.
 *
 * ⚠️ L'INTERFACE SURVIT AU BENCHMARK, ET C'EST DÉLIBÉRÉ. Elle a été écrite en
 * phase 2 pour que le choix reste ouvert ; le choix est fait — `zxing-wasm`,
 * sur mesure physique — mais l'interface reste, parce que ce qu'elle protège
 * n'a pas disparu : la boucle de scan, la caméra et l'écran ne connaissent
 * qu'un `MoteurScan`, et changer de décodeur un jour ne toucherait toujours
 * qu'`adaptateurs.ts`.
 *
 * `initialiser()` est séparé de `decoder()` parce que le coût n'est pas le
 * même : charger et instancier le WebAssembly se fait UNE fois, à l'ouverture
 * du scanner, pendant que la caméra démarre — pas à la première image, où il
 * ferait un à-coup visible.
 *
 * `detruire()` existe pour la même raison que `arreterCamera` : ce qui est
 * alloué doit pouvoir être rendu, y compris quand l'élève ferme la feuille
 * après deux secondes.
 */
export interface MoteurScan {
  readonly nom: typeof NOM_MOTEUR;
  initialiser(): Promise<void>;
  decoder(image: ImageData): Promise<ResultatScan | null>;
  detruire(): void | Promise<void>;
}

/**
 * LE MOTEUR RETENU, ET LE SEUL.
 *
 * Décidé sur un iPhone réel, pas sur un tableau de tailles : sur un paquet de
 * galettes de maïs, `zxing-wasm` lit le code là où le portage JavaScript
 * n'obtenait rien de valide après plus de 200 images. La robustesse sur un vrai
 * capteur l'emporte sur les ~270 Ko économisés — un code qu'on n'arrive pas à
 * scanner coûte infiniment plus cher qu'un téléchargement de plus.
 */
export const NOM_MOTEUR = "zxing-wasm" as const;

/**
 * CHARGEMENT PARESSEUX.
 *
 * `import()` dynamique, et jamais une importation statique en tête de fichier :
 * un élève qui n'ouvre jamais le scanner ne doit pas télécharger un octet de
 * décodeur. Le bundler ne peut le garantir que si le nom du module n'apparaît
 * dans aucune importation statique du graphe principal — c'est pour cela que
 * `adaptateurs.ts` n'est jamais importé statiquement, pas même ici.
 */
export type FabriqueMoteur = () => Promise<MoteurScan>;

/* ══════════════════════════════════════════════════════════════════════════
   LA BOUCLE DE SCAN — CADENCE, NON-CONCURRENCE, VERROU
   ══════════════════════════════════════════════════════════════════════════ */

/**
 * CADENCE. Une caméra produit 30 à 60 images par seconde ; les décoder toutes
 * ferait chauffer le téléphone sans rien apporter — un code-barres ne bouge pas
 * entre deux images distantes de 33 ms, et l'élève met de toute façon une
 * seconde à cadrer.
 *
 * 8 tentatives par seconde : le benchmark iPhone a lu les codes à cette cadence,
 * y compris le paquet de galettes de maïs qui départageait les moteurs. Elle est
 * donc CONSERVÉE — la changer sans mesure ne ferait que remplacer un réglage
 * éprouvé par un réglage supposé.
 */
export const CADENCE_PAR_SECONDE = 8;
export const INTERVALLE_MS = Math.round(1000 / CADENCE_PAR_SECONDE);

export interface EtatBoucle {
  /** Verrouillée : un GTIN valide a été accepté, plus rien ne doit être décodé. */
  verrouillee: boolean;
  /** Un décodage est en cours : on saute l'image plutôt que d'en lancer un second. */
  occupee: boolean;
  /** Diagnostic — jamais affiché à l'élève. */
  tentatives: number;
  lecturesRejetees: number;
}

export function nouvelEtatBoucle(): EtatBoucle {
  return { verrouillee: false, occupee: false, tentatives: 0, lecturesRejetees: 0 };
}

export type IssueTentative =
  | { readonly type: "ignoree"; readonly raison: "verrouillee" | "occupee" }
  | { readonly type: "rien_lu" }
  | { readonly type: "lecture_rejetee"; readonly rawValue: string }
  | { readonly type: "gtin"; readonly gtin: string; readonly format: string };

/**
 * UNE tentative de décodage, avec toutes les règles du §13 et du §14 réunies.
 *
 * ────────────────────────────────────────────────────────────────────────────
 * TROIS RÈGLES, ET AUCUNE N'EST FACULTATIVE
 * ────────────────────────────────────────────────────────────────────────────
 * 1. JAMAIS DEUX DÉCODAGES CONCURRENTS. Si l'image précédente est encore en
 *    cours, celle-ci est SAUTÉE — pas mise en file. Une file d'attente sur un
 *    flux vidéo ne se vide jamais : elle grandit, et le décodage finit par
 *    porter sur des images vieilles de plusieurs secondes.
 *
 * 2. LE VERROU EST POSÉ AVANT TOUT. Dès qu'un GTIN valide sort, plus une seule
 *    image n'est décodée. Un code reste visible une vingtaine d'images ; sans
 *    ce verrou, ce sont vingt appels à `/api/food-products/{gtin}`.
 *
 * 3. UNE LECTURE REJETÉE N'ARRÊTE RIEN. Le décodeur a lu quelque chose que le
 *    normaliseur A3 refuse — un code de rayon, un Code 128 de logistique. Ce
 *    n'est pas une erreur : c'est un objet qui est passé devant l'objectif. Le
 *    scan CONTINUE.
 */
export async function tenterUneImage(
  etat: EtatBoucle,
  moteur: MoteurScan,
  image: ImageData,
): Promise<IssueTentative> {
  if (etat.verrouillee) return { type: "ignoree", raison: "verrouillee" };
  if (etat.occupee) return { type: "ignoree", raison: "occupee" };

  etat.occupee = true;
  etat.tentatives += 1;
  try {
    const résultat = await moteur.decoder(image);
    if (!résultat) return { type: "rien_lu" };

    const gtin = lireGtin(résultat.rawValue);
    if (gtin === null) {
      etat.lecturesRejetees += 1;
      return { type: "lecture_rejetee", rawValue: résultat.rawValue };
    }

    // Le verrou est posé ICI, avant que l'appelant n'ait rien fait : entre le
    // `return` et l'arrêt de la caméra, une autre image peut arriver.
    etat.verrouillee = true;
    return { type: "gtin", gtin, format: résultat.format };
  } finally {
    etat.occupee = false;
  }
}
