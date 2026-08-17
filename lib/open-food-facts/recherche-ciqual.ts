import "server-only";

import {
  OFF_BASE_URL,
  OFF_FIELDS,
  OFF_SEARCH_API_VERSION,
  OFF_TIMEOUT_MS,
  OffErreur,
  type ProduitSeth,
  estOffErreur,
  gtinEstValide,
  versProduitSeth,
} from "@/lib/open-food-facts/contrat";
import { type Transport, userAgentOff } from "@/lib/open-food-facts/client";
import {
  type RefusCandidat,
  codeCiqualEstValide,
} from "@/lib/nutrition/pont-retail";

/**
 * COURSES C4.1 — RECHERCHE DE PRODUITS PAR CODE CIQUAL STRUCTURÉ.
 *
 * ════════════════════════════════════════════════════════════════════════════
 * ⚠️ POURQUOI CE MODULE N'EST **PAS** `recherche.ts`, ET NE DOIT JAMAIS Y ÊTRE
 *    FUSIONNÉ
 * ════════════════════════════════════════════════════════════════════════════
 * Le projet possède déjà un adaptateur de recherche Open Food Facts :
 * `lib/open-food-facts/recherche.ts`. Il vise **Search-a-licious**, à l'hôte
 * `search.openfoodfacts.org`, et il fait bien son travail : chercher un produit
 * par un TEXTE que l'élève tape.
 *
 * Il est INUTILISABLE ici, et l'ajout d'un paramètre ne le rendrait pas
 * utilisable — il le rendrait FAUX EN SILENCE. Mesuré le 17/08/2026 sur
 * `search-a-licious/data/config/openfoodfacts.yml`, la configuration d'index du
 * service : les champs indexés sont `code, product_name, categories, labels,
 * brands, …`. Ne sont indexés **ni `categories_properties`, ni
 * `categories_properties_tags`, ni `ciqual_food_code`**.
 *
 * Filtrer sur un champ non indexé ne rend pas d'erreur : ça rend des résultats
 * qui n'ont pas été filtrés. Un développeur pressé qui « ajoute juste un
 * paramètre » à `recherche.ts` obtiendrait donc des produits plausibles et
 * faux, sans aucun signal — le pire des deux mondes.
 *
 * ┌────────────────────────────────────────────────────────────────────────┐
 * │ recherche.ts         search.openfoodfacts.org   texte libre     élève  │
 * │ recherche-ciqual.ts  world.openfoodfacts.org    code Ciqual     admin  │
 * └────────────────────────────────────────────────────────────────────────┘
 *
 * Deux services, deux hôtes, deux besoins. Ils partagent le NORMALISEUR
 * (`versProduitSeth`) et rien d'autre — comme `recherche.ts` le fait déjà,
 * et pour la même raison : deux implémentations d'une même règle
 * nutritionnelle finissent toujours par diverger, et la divergence se voit
 * d'abord dans l'assiette d'un élève.
 *
 * ════════════════════════════════════════════════════════════════════════════
 * LE CONTRAT UTILISÉ, MESURÉ ET NON DEVINÉ
 * ════════════════════════════════════════════════════════════════════════════
 * L'API produit v2 expose, sur chaque fiche, les propriétés héritées de sa
 * catégorie :
 *
 *   categories_properties      { "ciqual_food_code:en": "31032", … }
 *   categories_properties_tags [ …, "ciqual-food-code-31032",
 *                                   "ciqual-food-code-known", … ]
 *
 * et `categories_properties_tags` est FILTRABLE. Vérifié le 17/08/2026 :
 * `?categories_properties_tags=ciqual-food-code-31032` rend 2 348 pâtes à
 * tartiner réelles.
 *
 * ⚠️ LA PROPRIÉTÉ EST PORTÉE PAR LA CATÉGORIE, PAS PAR LE PRODUIT — le produit
 * en hérite. Deux causes de silence, donc, et il ne faut pas les confondre :
 * un produit mal catégorisé, ou une catégorie qui ne porte aucun code Ciqual.
 * Ni l'une ni l'autre ne se répare de notre côté ; toutes deux rendent zéro
 * candidat, et zéro candidat n'est pas une panne.
 */

// ────────────────────────────────────────────────────────────────────────────
// 1. LE SERVICE — MÊME HÔTE QUE LE LOOKUP, AUTRE ROUTE
// ────────────────────────────────────────────────────────────────────────────
/**
 * ⚠️ `world.openfoodfacts.org`, comme le lookup GTIN — et NON
 * `search.openfoodfacts.org`. C'est le point de départ de tout ce fichier.
 */
export const OFF_CIQUAL_SEARCH_URL = `${OFF_BASE_URL}/api/${OFF_SEARCH_API_VERSION}/search`;

/** Le préfixe du tag hérité. `ciqual-food-code-9119`, jamais autre chose. */
export const CIQUAL_TAG_PREFIX = "ciqual-food-code-";

/**
 * ⚠️ FRANCE SEULEMENT, ET CE N'EST PAS UN CONFORT.
 * Un produit vendu ailleurs a un code-barres, une nutrition, parfois un prix —
 * et l'élève ne le trouvera dans aucun magasin. Le proposer à la curation ferait
 * perdre du temps à l'administrateur, et pire : ferait valider un rapprochement
 * dont aucun prix français ne sortira jamais.
 */
export const CIQUAL_PAYS = "France";

/**
 * Assez large pour que la curation ait de quoi choisir, assez étroit pour que
 * l'appel reste court. La recherche par code Ciqual rend parfois des centaines
 * de candidats (896 pour le riz basmati cru) : l'administrateur n'en regardera
 * jamais 896, et les transférer serait du poids pour rien.
 */
export const CIQUAL_TAILLE_PAGE = 25;

/**
 * L'URL, construite en UN endroit. Aucun paramètre ne vient du navigateur : le
 * code Ciqual est validé de forme avant d'entrer, et tout le reste est
 * constant. Un client ne peut donc pas se servir de SETH pour interroger Open
 * Food Facts à sa guise.
 */
export function urlRechercheParCodeCiqual(code: string): string {
  if (!codeCiqualEstValide(code)) {
    throw new OffErreur("OFF_INVALID_RESPONSE", `Code Ciqual de forme invalide : ${code}`);
  }
  const params = new URLSearchParams({
    categories_properties_tags: `${CIQUAL_TAG_PREFIX}${code}`,
    countries_tags_en: CIQUAL_PAYS,
    fields: OFF_FIELDS.join(","),
    // ⚠️ Ce nom de paramètre est celui de l'API v2 d'Open Food Facts. Il se
    // trouve que Search-a-licious en utilise un homonyme — ce n'est pas une
    // parenté, c'est une coïncidence de vocabulaire HTTP. Voir A3-SEARCH-SUP,
    // qui exempte ce fichier de CE jeton précis et continue d'y interdire
    // Search-a-licious lui-même.
    page_size: String(CIQUAL_TAILLE_PAGE),
    page: "1",
  });
  return `${OFF_CIQUAL_SEARCH_URL}?${params.toString()}`;
}

// ────────────────────────────────────────────────────────────────────────────
// 2. TROUVÉ ≠ IMPORTABLE
// ────────────────────────────────────────────────────────────────────────────
/** Un candidat qui peut entrer dans `food_products`. */
export interface CandidatImportable {
  readonly gtin: string;
  readonly produit: ProduitSeth;
}

/**
 * Un candidat RÉEL, trouvé chez Open Food Facts, mais que `food_products` ne
 * peut pas accueillir.
 *
 * ⚠️ IL EST RENDU, PAS JETÉ. Les trois réponses interdites sont : fabriquer des
 * zéros à la place des macros manquantes, importer en faisant passer
 * l'incomplet pour du complet, et masquer le candidat. La quatrième — le
 * montrer avec sa raison, et laisser l'administrateur passer au suivant — est
 * la seule qui ne ment pas.
 */
export interface CandidatNonImportable {
  readonly gtin: string | null;
  readonly nom: string | null;
  readonly refus: RefusCandidat;
}

export interface ResultatRechercheCiqual {
  readonly code: string;
  readonly importables: readonly CandidatImportable[];
  readonly nonImportables: readonly CandidatNonImportable[];
  /** `count` annoncé par Open Food Facts — la population, pas la page. */
  readonly totalOff: number;
}

function texteOuNull(valeur: unknown): string | null {
  if (typeof valeur !== "string") return null;
  const propre = valeur.trim();
  return propre === "" ? null : propre;
}

/**
 * Réponse v2 `/search` → candidats.
 *
 * ⚠️ UNE FICHE INEXPLOITABLE NE FAIT PAS ÉCHOUER LA RECHERCHE. Sur vingt-cinq
 * candidats, plusieurs sans teneurs sont un cas ORDINAIRE : rendre une erreur
 * pour tout le lot priverait la curation de ceux qui marchent. Même doctrine
 * que `produitsDepuisReponse` en Phase 4 — la différence est qu'ici les écartés
 * sont NOMMÉS et rendus, parce que l'administrateur doit voir ce qu'il ne peut
 * pas prendre.
 *
 * L'ORDRE D'OPEN FOOD FACTS EST CONSERVÉ. Aucun score maison : nous ne savons
 * pas mieux que la source quel yaourt vient en premier, et prétendre le
 * contraire demanderait une mesure que personne n'a faite.
 */
export function candidatsDepuisReponse(code: string, corps: unknown): ResultatRechercheCiqual {
  if (corps === null || typeof corps !== "object") {
    throw new OffErreur("OFF_INVALID_RESPONSE", "Réponse de recherche non exploitable.");
  }
  const enveloppe = corps as { products?: unknown; count?: unknown };
  if (!Array.isArray(enveloppe.products)) {
    throw new OffErreur("OFF_INVALID_RESPONSE", "Réponse de recherche sans liste de produits.");
  }

  const importables: CandidatImportable[] = [];
  const nonImportables: CandidatNonImportable[] = [];
  const gtinsVus = new Set<string>();

  for (const brut of enveloppe.products) {
    if (brut === null || typeof brut !== "object") continue;
    const fiche = brut as Record<string, unknown>;
    const nom = texteOuNull(fiche["product_name"]);
    const codeBarres = texteOuNull(fiche["code"]);

    if (codeBarres === null) {
      nonImportables.push({ gtin: null, nom, refus: "gtin_absent" });
      continue;
    }
    // ⚠️ LA FORME DU CODE EST VÉRIFIÉE ICI, comme sur le chemin de la recherche
    // texte (défaut A3-SEARCH7) : `versProduitSeth` reçoit le GTIN déjà validé
    // sur le chemin du lookup, jamais sur celui d'une recherche. Un code hors
    // forme irait jusqu'à l'upsert et ferait échouer le LOT ENTIER contre
    // `food_products_gtin_forme`.
    if (!gtinEstValide(codeBarres)) {
      nonImportables.push({ gtin: codeBarres, nom, refus: "gtin_invalide" });
      continue;
    }
    if (gtinsVus.has(codeBarres)) {
      nonImportables.push({ gtin: codeBarres, nom, refus: "doublon" });
      continue;
    }
    gtinsVus.add(codeBarres);

    try {
      // Le MÊME normaliseur que partout ailleurs, avec l'enveloppe de succès
      // qu'il attend. Il lève `PRODUCT_NUTRITION_INCOMPLETE` quand les trois
      // macros manquent, quand OFF déclare `no_nutrition_data`, ou quand la
      // fiche n'a pas de dénomination — trois cas qui rendent la ligne
      // inacceptable pour `food_products`, dont les macros sont NOT NULL.
      const produit = versProduitSeth(codeBarres, { status: "success", product: fiche });
      importables.push({ gtin: codeBarres, produit });
    } catch (erreur) {
      if (estOffErreur(erreur)) {
        nonImportables.push({ gtin: codeBarres, nom, refus: "nutrition_incomplete" });
        continue;
      }
      throw erreur;
    }
  }

  const total = typeof enveloppe.count === "number" ? enveloppe.count : importables.length;
  return { code, importables, nonImportables, totalOff: total };
}

// ────────────────────────────────────────────────────────────────────────────
// 3. LE TRANSPORT
// ────────────────────────────────────────────────────────────────────────────
export interface OptionsRechercheCiqual {
  readonly transport?: Transport;
  readonly timeoutMs?: number;
}

/**
 * UNE requête sortante, pas deux. Pas de pagination : l'administrateur choisit
 * parmi les vingt-cinq premiers ou change d'aliment. Une seconde page coûterait
 * un appel de plus sur un quota partagé par toute l'application.
 *
 * Les pannes sont traduites dans le vocabulaire fermé de la Phase 3 :
 * l'appelant n'apprend jamais qu'il existe une API v2.
 */
export async function chercherProduitsParCodeCiqual(
  code: string,
  options: OptionsRechercheCiqual = {},
): Promise<ResultatRechercheCiqual> {
  const url = urlRechercheParCodeCiqual(code);
  const entete = userAgentOff();
  const transport = options.transport ?? ((cible, init) => fetch(cible, init));
  const controleur = new AbortController();
  const minuteur = setTimeout(() => controleur.abort(), options.timeoutMs ?? OFF_TIMEOUT_MS);

  let reponse: Response;
  try {
    reponse = await transport(url, {
      method: "GET",
      headers: { "User-Agent": entete, Accept: "application/json" },
      signal: controleur.signal,
      cache: "no-store",
    });
  } catch (erreur) {
    throw new OffErreur(
      "OFF_UNAVAILABLE",
      `Recherche Open Food Facts injoignable : ${erreur instanceof Error ? erreur.message : String(erreur)}`,
    );
  } finally {
    clearTimeout(minuteur);
  }

  if (reponse.status === 429) {
    throw new OffErreur("OFF_RATE_LIMITED", "Limite de recherches Open Food Facts atteinte.");
  }
  if (!reponse.ok) {
    throw new OffErreur(
      "OFF_UNAVAILABLE",
      `La recherche Open Food Facts a répondu ${reponse.status}.`,
    );
  }

  let corps: unknown;
  try {
    corps = await reponse.json();
  } catch {
    throw new OffErreur("OFF_INVALID_RESPONSE", "Réponse de recherche illisible.");
  }

  return candidatsDepuisReponse(code, corps);
}
