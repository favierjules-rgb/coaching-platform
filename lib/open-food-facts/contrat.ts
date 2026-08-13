/**
 * OPEN FOOD FACTS — LE CONTRAT, SANS RÉSEAU (ALIMENTS A3, PHASE 3).
 *
 * ────────────────────────────────────────────────────────────────────────────
 * POURQUOI CE FICHIER NE FAIT AUCUN APPEL
 * ────────────────────────────────────────────────────────────────────────────
 * Tout ce qui est DÉCIDABLE sans réseau vit ici : la version d'API épinglée,
 * la forme d'un code-barres, la lecture d'une réponse OFF, la conversion vers
 * le DTO SETH, la fraîcheur d'une ligne de cache. Le module qui parle
 * réellement à l'extérieur (`client.ts`) ne contient plus que le transport.
 *
 * La conséquence pratique : la totalité des règles ci-dessous se teste sur des
 * fixtures, hors ligne, sans mock de `fetch` et sans dépendre de la
 * disponibilité d'un tiers. C'est la condition posée au lot — « les tests
 * officiels du dépôt ne doivent PAS dépendre du réseau OFF ».
 *
 * Ce module est une FEUILLE : ni React, ni Supabase, ni `server-only`. Il est
 * importable de partout, y compris d'un harnais de test ordinaire.
 */

// ────────────────────────────────────────────────────────────────────────────
// 1. LA VERSION D'API — UNE SEULE CONSTANTE, ET ELLE EST ÉPINGLÉE
// ────────────────────────────────────────────────────────────────────────────
/**
 * ⚠️ NE PAS CHANGER SANS AUDIT. Mesuré le 13/08/2026 sur `3017620422003` :
 *
 *   /api/v3   → schéma « courant », donc mouvant : ce qu'il rend aujourd'hui
 *               n'est pas ce qu'il rendra demain ;
 *   /api/v3.4 → `nutriments.proteins_100g` / `carbohydrates_100g` / `fat_100g`
 *               présents et peuplés. C'est ce que nous lisons ;
 *   /api/v3.5 et au-delà → `nutriments` rendu VIDE (`{}`), remplacé par un
 *               bloc `nutrition` de forme différente. Un passage silencieux à
 *               v3.5 ne casserait donc rien de visible : il ferait simplement
 *               échouer TOUS les produits en PRODUCT_NUTRITION_INCOMPLETE.
 *               C'est exactement le genre de panne qu'on ne diagnostique pas.
 *
 * Relevé du 13/08/2026 également : OFF ne renvoie PLUS le champ
 * `schema_version` qu'il renvoyait à l'audit de Phase 1 (valeur 1002). Aucun
 * contrôle ne doit donc en dépendre — la garantie tient à l'URL épinglée
 * ci-dessous, VÉRIFIÉE à chaque réponse par la présence effective des trois
 * teneurs. Une garantie qu'on ne peut pas mesurer n'est pas une garantie.
 */
export const OFF_API_VERSION = "v3.4";

/** L'hôte mondial. Les sous-domaines par pays servent la même base. */
export const OFF_BASE_URL = "https://world.openfoodfacts.org";

/**
 * Les champs demandés — et rien d'autre. Une fiche OFF complète pèse plusieurs
 * centaines de kilo-octets ; restreindre allège le transfert, mais surtout
 * BORNE ce que nous acceptons de connaître : un champ qui n'est pas demandé ne
 * peut pas être utilisé par accident un jour de fatigue.
 *
 * `nutriments` est demandé ; `nutriments_estimated` ne l'est PAS. OFF le
 * renvoie néanmoins (la sélection se fait par préfixe) : c'est un bloc
 * d'ESTIMATIONS calculées, sans rapport avec les teneurs déclarées, et le
 * confondre avec `nutriments` remplirait la base de valeurs inventées.
 * `lireNutriments` ne le regarde jamais.
 */
export const OFF_FIELDS = [
  "code",
  "product_name",
  "brands",
  "quantity",
  "product_quantity",
  "product_quantity_unit",
  "serving_size",
  "nutrition_data_per",
  "no_nutrition_data",
  "nutriments",
  "image_front_url",
  "ingredients_text",
  "allergens_tags",
] as const;

/** L'URL de lookup, construite en UN endroit. */
export function urlLookupProduit(gtin: string): string {
  return `${OFF_BASE_URL}/api/${OFF_API_VERSION}/product/${encodeURIComponent(gtin)}?fields=${OFF_FIELDS.join(",")}`;
}

/**
 * Délai d'attente réseau. Un élève au supermarché, en 4G derrière un rayon
 * réfrigéré, ne doit pas voir un écran figé : au-delà, on rend une erreur
 * franche plutôt qu'une attente indéfinie.
 */
export const OFF_TIMEOUT_MS = 8000;

/**
 * FRAÎCHEUR DU CACHE — 30 jours, définis ICI et nulle part ailleurs.
 *
 * La base stocke la DATE (`food_products.source_fetched_at`) ; c'est ce
 * fichier qui dit ce qu'« ancien » veut dire. Une seconde définition du délai
 * (en SQL, dans la route, dans un composant) serait une seconde vérité, et
 * deux vérités finissent toujours par diverger.
 */
export const OFF_CACHE_TTL_JOURS = 30;
export const OFF_CACHE_TTL_MS = OFF_CACHE_TTL_JOURS * 24 * 60 * 60 * 1000;

/**
 * Le format de User-Agent documenté par Open Food Facts :
 * `AppName/Version (ContactEmail)`. La valeur réelle vit en variable
 * d'environnement SERVEUR — elle contient une adresse de contact, qui n'a
 * rien à faire dans le dépôt.
 */
export const OFF_USER_AGENT_ENV = "OPENFOODFACTS_USER_AGENT";

/** Attribution ODbL exigée par Open Food Facts, en un seul endroit. */
export const OFF_ATTRIBUTION = {
  source: "Open Food Facts",
  lien: "https://openfoodfacts.org",
  licenceBase: "ODbL 1.0",
  licenceImages: "CC BY-SA",
} as const;

// ────────────────────────────────────────────────────────────────────────────
// 2. LES ERREURS MÉTIER — UN VOCABULAIRE STABLE
// ────────────────────────────────────────────────────────────────────────────
/**
 * Ces codes sont un CONTRAT : l'écran s'en sert pour choisir un message, et
 * ils ne doivent donc pas suivre les humeurs d'Open Food Facts. Un HTTP 429
 * devient `OFF_RATE_LIMITED` ici, une fois ; l'interface ne connaît jamais les
 * codes HTTP d'un tiers.
 *
 * La distinction qui compte pour l'élève :
 *   - INVALID_GTIN / PRODUCT_NOT_FOUND / PRODUCT_NUTRITION_INCOMPLETE
 *     parlent du PRODUIT — il n'y a rien à réessayer, l'élève doit saisir à
 *     la main ;
 *   - OFF_RATE_LIMITED / OFF_UNAVAILABLE / OFF_INVALID_RESPONSE parlent du
 *     SERVICE — le produit existe peut-être, réessayer plus tard a du sens.
 */
export const OFF_ERREURS = [
  "INVALID_GTIN",
  "PRODUCT_NOT_FOUND",
  "PRODUCT_NUTRITION_INCOMPLETE",
  "OFF_RATE_LIMITED",
  "OFF_UNAVAILABLE",
  "OFF_INVALID_RESPONSE",
] as const;

export type OffErreurCode = (typeof OFF_ERREURS)[number];

/** Vrai si l'erreur parle du SERVICE et non du produit : réessayer a du sens. */
export function erreurEstTemporaire(code: OffErreurCode): boolean {
  return code === "OFF_RATE_LIMITED" || code === "OFF_UNAVAILABLE" || code === "OFF_INVALID_RESPONSE";
}

export class OffErreur extends Error {
  readonly code: OffErreurCode;
  constructor(code: OffErreurCode, message?: string) {
    super(message ?? code);
    this.name = "OffErreur";
    this.code = code;
  }
}

/**
 * Reconnaît une erreur métier SANS `instanceof`. Ce n'est pas de la
 * coquetterie : MESURÉ en écrivant le harnais A3-OFF, un module chargé une
 * fois par l'alias `@/lib/…` et une fois par un chemin relatif donne DEUX
 * classes distinctes, et `instanceof` rend `false` sur une erreur pourtant
 * parfaitement bien formée. Le repli sur le cache périmé (A3-OFF14) tombait
 * silencieusement à l'eau — la panne était traitée comme une erreur inconnue.
 *
 * Le même risque existe hors des tests : un bundler qui duplique un module
 * (frontière serveur/client, deux graphes de dépendances) produirait
 * exactement le même faux négatif, en Production, et sur le chemin le plus
 * difficile à reproduire. On identifie donc l'erreur par ce qu'elle EST — un
 * nom et un code du vocabulaire fermé — plutôt que par son ascendance.
 */
export function estOffErreur(erreur: unknown): erreur is OffErreur {
  if (typeof erreur !== "object" || erreur === null) return false;
  const candidat = erreur as { name?: unknown; code?: unknown };
  return (
    candidat.name === "OffErreur" &&
    typeof candidat.code === "string" &&
    (OFF_ERREURS as readonly string[]).includes(candidat.code)
  );
}

/**
 * `exigerGtin` DU CÔTÉ A3 — la règle vient de `lib/scan/gtin.ts`, seule la
 * FORME DE L'EXCEPTION change ici.
 *
 * Le module de scan est une feuille absolue : il n'importe rien, donc il ne
 * peut pas lever une `OffErreur` — qui appartient au vocabulaire d'Open Food
 * Facts. Il lève sa propre `GtinInvalide`, et cette frontière la retraduit
 * dans le vocabulaire fermé que la route et l'écran connaissent déjà.
 *
 * ⚠️ Une seule implémentation de la RÈGLE existe toujours. Ce qui est ajouté
 * ici n'est pas une seconde validation, c'est un adaptateur d'erreur — le même
 * office que celui qui transforme un HTTP 429 en `OFF_RATE_LIMITED`.
 *
 * Mesuré en écrivant ce déplacement : sans cette retraduction, `estOffErreur`
 * rendait `false` sur une `GtinInvalide` (le nom ne correspondait plus), et la
 * route de lookup répondait 503 « service indisponible » là où elle devait
 * répondre 400 « code-barres invalide ». Le déplacement d'un module aurait
 * silencieusement changé un code HTTP.
 */
export function exigerGtin(saisie: string): string {
  const gtin = lireGtinPur(saisie);
  if (gtin === null) {
    throw new OffErreur("INVALID_GTIN", `Code-barres invalide : ${JSON.stringify(saisie)}`);
  }
  return gtin;
}

// ────────────────────────────────────────────────────────────────────────────
// 3. LE CODE-BARRES
// ────────────────────────────────────────────────────────────────────────────
/**
 * ────────────────────────────────────────────────────────────────────────────
 * LE CODE-BARRES A DÉMÉNAGÉ — ET IL N'EN EXISTE TOUJOURS QU'UN SEUL
 * ────────────────────────────────────────────────────────────────────────────
 * `normaliserGtin`, `gtinEstValide` et `exigerGtin` vivaient ici. Le scanner
 * (A4) en a besoin DANS LE NAVIGATEUR — et ce fichier exporte aussi
 * `OFF_BASE_URL`, `urlLookupProduit`, `OFF_FIELDS`… : l'importer depuis un
 * composant client ferait entrer les adresses d'API d'Open Food Facts dans le
 * bundle navigateur, ce que trois garde-fous interdisent depuis la phase 3.
 *
 * Ils sont donc partis dans `lib/scan/gtin.ts`, une feuille absolue sans la
 * moindre importation. Et ils sont RÉEXPORTÉS ici : le serveur continue de les
 * appeler par ce chemin, sans une ligne de changement, et il n'existe toujours
 * qu'une seule définition dans le dépôt. Un déplacement, pas une copie.
 */
export { gtinEstValide, lireGtin, normaliserGtin } from "@/lib/scan/gtin";
import { lireGtin as lireGtinPur } from "@/lib/scan/gtin";

// ────────────────────────────────────────────────────────────────────────────
// 4. LE DTO SETH — CE QUE LA ROUTE REND, ET QUI NE RESSEMBLE PAS À OFF
// ────────────────────────────────────────────────────────────────────────────
/**
 * Volontairement DIFFÉRENT du schéma Open Food Facts. Si l'écran lisait
 * `nutriments.proteins_100g`, le schéma d'un tiers deviendrait le nôtre, et le
 * jour où il change c'est l'interface qu'il faudrait rouvrir.
 *
 * `kcalPer100` est CALCULÉ par SETH — 4×P + 4×G + 9×L —, jamais repris de
 * `energy-kcal_100g`. Deux conventions d'énergie dans la même application
 * donneraient deux totaux différents pour le même repas selon l'écran regardé.
 */
export interface ProduitSeth {
  readonly gtin: string;
  readonly productName: string;
  readonly brand: string | null;
  readonly netQuantity: number | null;
  readonly netUnit: "g" | "ml" | null;
  readonly nutritionUnit: "g" | "ml";
  readonly proteinPer100: number;
  readonly carbPer100: number;
  readonly fatPer100: number;
  /** Dérivé 4/4/9, jamais lu chez la source. */
  readonly kcalPer100: number;
  readonly imageUrl: string | null;
  readonly ingredientsText: string | null;
  readonly allergensDeclared: readonly string[];
  readonly source: "open_food_facts";
  readonly sourceVersion: string;
}

/** L'unique convention énergétique de SETH. */
export const KCAL_PER_GRAM = { protein: 4, carb: 4, fat: 9 } as const;

export function kcalPour100(proteine: number, glucide: number, lipide: number): number {
  return (
    proteine * KCAL_PER_GRAM.protein + glucide * KCAL_PER_GRAM.carb + lipide * KCAL_PER_GRAM.fat
  );
}

// ────────────────────────────────────────────────────────────────────────────
// 5. LIRE UNE RÉPONSE OFF
// ────────────────────────────────────────────────────────────────────────────
/**
 * Un nombre, ou rien. Écrit une fois parce qu'OFF mélange les formes : des
 * nombres, des chaînes numériques (`product_quantity`, `serving_quantity`),
 * des chaînes vides (`quantity: ""` — mesuré sur le produit de référence), et
 * des champs simplement absents.
 *
 * ⚠️ La règle du lot, appliquée ici littéralement : ABSENT ≠ ZÉRO. `null`,
 * `undefined`, `""`, `NaN` et l'infini rendent `null` — jamais 0. Un `0`
 * explicite, lui, est une valeur parfaitement valide et il est conservé.
 */
export function lireNombre(valeur: unknown): number | null {
  if (typeof valeur === "number") {
    return Number.isFinite(valeur) ? valeur : null;
  }
  if (typeof valeur === "string") {
    const propre = valeur.trim();
    if (propre === "") return null;
    const nombre = Number(propre);
    return Number.isFinite(nombre) ? nombre : null;
  }
  return null;
}

function lireTexte(valeur: unknown): string | null {
  if (typeof valeur !== "string") return null;
  const propre = valeur.trim();
  return propre === "" ? null : propre;
}

/**
 * Les trois teneurs, pour 100. Rendues ENSEMBLE ou pas du tout : deux macros
 * sur trois ne font pas un produit consommable, et compléter la troisième par
 * zéro serait exactement l'invention qu'on s'interdit.
 */
export function lireNutriments(nutriments: unknown): {
  proteine: number;
  glucide: number;
  lipide: number;
} | null {
  if (nutriments === null || typeof nutriments !== "object") return null;
  const n = nutriments as Record<string, unknown>;
  // `fat_100g`, pas `lipids_100g` : le nom OFF est en anglais culinaire.
  const proteine = lireNombre(n["proteins_100g"]);
  const glucide = lireNombre(n["carbohydrates_100g"]);
  const lipide = lireNombre(n["fat_100g"]);
  if (proteine === null || glucide === null || lipide === null) return null;
  if (proteine < 0 || glucide < 0 || lipide < 0) return null;
  return { proteine, glucide, lipide };
}

/**
 * L'unité nutritionnelle. OFF publie `nutrition_data_per` valant `"100g"`,
 * `"serving"` ou, plus rarement, `"100ml"`.
 *
 * ⚠️ `"serving"` ne veut PAS dire que les `_100g` sont faux : OFF les CALCULE
 * depuis `serving_size`, un champ de texte libre. Quand le calcul est possible
 * les valeurs sont là, et elles sont bien « pour 100 » ; quand il ne l'est
 * pas, elles manquent — et `lireNutriments` rend alors `null`. Le cas se règle
 * donc tout seul, sans traitement particulier.
 *
 * L'unité RÉELLE est celle du conditionnement : un produit vendu en
 * millilitres a des teneurs pour 100 ml. On la déduit de
 * `product_quantity_unit` quand OFF la donne, sinon on reste en grammes —
 * l'immense majorité — sans jamais convertir de l'un vers l'autre.
 */
export function lireUniteNutritionnelle(produit: Record<string, unknown>): "g" | "ml" {
  const parUnite = lireTexte(produit["nutrition_data_per"])?.toLowerCase();
  if (parUnite === "100ml") return "ml";
  const uniteConditionnement = lireTexte(produit["product_quantity_unit"])?.toLowerCase();
  if (uniteConditionnement === "ml" || uniteConditionnement === "l") return "ml";
  return "g";
}

/**
 * La quantité nette du conditionnement, quand elle est exploitable. Absente ou
 * nulle, elle reste `null` : un pot de 0 g n'existe pas, et une quantité
 * inconnue ne s'invente pas.
 *
 * `product_quantity` d'OFF est exprimée dans `product_quantity_unit` ; on
 * n'accepte que les deux unités que SETH sait manipuler, et on ne convertit
 * pas les litres en millilitres ni les kilos en grammes — non par principe,
 * mais parce que cette conversion-là n'a jamais été mesurée sur des données
 * réelles, et qu'une conversion non mesurée est une invention comme une autre.
 */
export function lireQuantiteNette(
  produit: Record<string, unknown>,
): { valeur: number; unite: "g" | "ml" } | null {
  const valeur = lireNombre(produit["product_quantity"]);
  if (valeur === null || valeur <= 0) return null;
  const unite = lireTexte(produit["product_quantity_unit"])?.toLowerCase();
  if (unite === "g") return { valeur, unite: "g" };
  if (unite === "ml") return { valeur, unite: "ml" };
  return null;
}

function lireAllergenes(valeur: unknown): readonly string[] {
  if (!Array.isArray(valeur)) return [];
  return valeur.filter((t): t is string => typeof t === "string" && t.trim() !== "");
}

/**
 * L'enveloppe v3 : `status` est une CHAÎNE (`"success"` / `"failure"`), et
 * `result.id` précise le cas. Une réponse dont on ne reconnaît ni l'un ni
 * l'autre est une réponse qu'on ne comprend pas — et une réponse qu'on ne
 * comprend pas ne devient JAMAIS un produit par défaut.
 */
export interface ReponseOff {
  readonly status?: unknown;
  readonly result?: unknown;
  readonly product?: unknown;
}

/**
 * Réponse OFF (déjà décodée) → produit SETH. Lève une `OffErreur` métier dans
 * tous les cas où il n'y a pas de produit consommable.
 *
 * `gtin` est celui que NOUS avons interrogé, pas le `code` renvoyé : OFF
 * normalise parfois le code (mesuré : `0000000000000` devient `00000000`), et
 * enregistrer sa version rendrait la ligne introuvable au scan suivant, par la
 * clé même qui sert à la chercher.
 */
export function versProduitSeth(gtin: string, corps: ReponseOff): ProduitSeth {
  if (corps === null || typeof corps !== "object") {
    throw new OffErreur("OFF_INVALID_RESPONSE", "Réponse non exploitable.");
  }

  const status = typeof corps.status === "string" ? corps.status : null;
  const resultId =
    corps.result !== null && typeof corps.result === "object"
      ? lireTexte((corps.result as Record<string, unknown>)["id"])
      : null;

  if (status !== "success") {
    if (status === "failure" && resultId === "product_not_found") {
      throw new OffErreur("PRODUCT_NOT_FOUND", `Produit ${gtin} absent d'Open Food Facts.`);
    }
    // `status` inconnu, ou échec pour une raison qu'on ne sait pas nommer : on
    // ne devine pas ce que le service a voulu dire.
    throw new OffErreur("OFF_INVALID_RESPONSE", `Statut inattendu : ${String(corps.status)}`);
  }

  if (corps.product === null || typeof corps.product !== "object") {
    throw new OffErreur("OFF_INVALID_RESPONSE", "Succès annoncé sans fiche produit.");
  }
  const produit = corps.product as Record<string, unknown>;

  // `no_nutrition_data: "on"` — cas fréquent (des milliers de produits). OFF
  // l'annonce explicitement ; on le refuse explicitement.
  const sansNutrition = lireTexte(produit["no_nutrition_data"])?.toLowerCase();
  if (sansNutrition === "on" || sansNutrition === "1" || sansNutrition === "true") {
    throw new OffErreur(
      "PRODUCT_NUTRITION_INCOMPLETE",
      `Produit ${gtin} : Open Food Facts déclare ne pas avoir de données nutritionnelles.`,
    );
  }

  const teneurs = lireNutriments(produit["nutriments"]);
  if (teneurs === null) {
    throw new OffErreur(
      "PRODUCT_NUTRITION_INCOMPLETE",
      `Produit ${gtin} : protéines, glucides ou lipides manquants pour 100.`,
    );
  }

  // Un produit sans nom n'est pas affichable, et lui en inventer un
  // (« Produit 3017620422003 ») ferait passer une fiche vide pour une fiche.
  const nom = lireTexte(produit["product_name"]);
  if (nom === null) {
    throw new OffErreur(
      "PRODUCT_NUTRITION_INCOMPLETE",
      `Produit ${gtin} : aucune dénomination publiée.`,
    );
  }

  const nette = lireQuantiteNette(produit);
  const image = lireTexte(produit["image_front_url"]);

  return {
    gtin,
    productName: nom,
    brand: lireTexte(produit["brands"]),
    netQuantity: nette?.valeur ?? null,
    netUnit: nette?.unite ?? null,
    nutritionUnit: lireUniteNutritionnelle(produit),
    proteinPer100: teneurs.proteine,
    carbPer100: teneurs.glucide,
    fatPer100: teneurs.lipide,
    kcalPer100: kcalPour100(teneurs.proteine, teneurs.glucide, teneurs.lipide),
    // Seul le HTTPS entre : une image en clair serait bloquée par le
    // navigateur sur une page servie en HTTPS, et l'afficher exposerait la
    // navigation de l'élève.
    imageUrl: image !== null && image.startsWith("https://") ? image : null,
    ingredientsText: lireTexte(produit["ingredients_text"]),
    allergensDeclared: lireAllergenes(produit["allergens_tags"]),
    source: "open_food_facts",
    sourceVersion: OFF_API_VERSION,
  };
}

// ────────────────────────────────────────────────────────────────────────────
// 6. LA FRAÎCHEUR DU CACHE
// ────────────────────────────────────────────────────────────────────────────
/**
 * `maintenant` est un PARAMÈTRE, jamais `Date.now()` lu à l'intérieur : une
 * fonction qui lit l'horloge ne se teste qu'en attendant trente jours.
 */
/**
 * LA FRAÎCHEUR QUI DÉCIDE D'UN APPEL RÉSEAU (phase 4.1).
 *
 * `detailFetchedAt` est la date de la dernière HYDRATATION réussie depuis
 * `/api/v3.4/product/{gtin}` — et `null` quand il n'y en a jamais eu, ce qui
 * est le cas de tout produit découvert par la recherche texte.
 *
 * `null` rend donc `false`, toujours : une fiche jamais chargée en détail
 * n'est pas « fraîche », même si on vient de voir son code-barres passer dans
 * une recherche il y a trente secondes. C'est tout le correctif de la phase
 * 4.1 tenu en une ligne — avant elle, ce cas rendait `true` et empêchait le
 * chargement de la vraie fiche pendant trente jours.
 */
export function detailEstFrais(
  detailFetchedAt: string | Date | null | undefined,
  maintenant: Date,
): boolean {
  if (detailFetchedAt === null || detailFetchedAt === undefined) return false;
  return cacheEstFrais(detailFetchedAt, maintenant);
}

export function cacheEstFrais(sourceFetchedAt: string | Date, maintenant: Date): boolean {
  const date = sourceFetchedAt instanceof Date ? sourceFetchedAt : new Date(sourceFetchedAt);
  const age = maintenant.getTime() - date.getTime();
  if (!Number.isFinite(age)) return false;
  // Une date FUTURE (horloge décalée, import fautif) n'est pas « très
  // fraîche » : c'est une anomalie, et on la traite comme une ligne périmée
  // plutôt que comme une ligne éternellement valide.
  if (age < 0) return false;
  return age < OFF_CACHE_TTL_MS;
}
