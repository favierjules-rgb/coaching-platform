import "server-only";

import {
  OFF_TIMEOUT_MS,
  OffErreur,
  type ProduitSeth,
  estOffErreur,
  gtinEstValide,
  versProduitSeth,
} from "@/lib/open-food-facts/contrat";
import { type Transport, userAgentOff } from "@/lib/open-food-facts/client";

/**
 * RECHERCHE TEXTE DE PRODUITS — L'ADAPTATEUR, ET RIEN QUE L'ADAPTATEUR.
 * (ALIMENTS A3, PHASE 4)
 *
 * ────────────────────────────────────────────────────────────────────────────
 * TOUT CE QUI EST PROPRE À SEARCH-A-LICIOUS VIT ICI, ET NULLE PART AILLEURS
 * ────────────────────────────────────────────────────────────────────────────
 * Open Food Facts n'a PAS de recherche texte dans son API produit. Mesuré le
 * 13/08/2026, inchangé depuis l'audit de Phase 1 :
 *
 *   GET /api/v3/search  →  HTTP 400, `invalid_api_action`
 *
 * La seule voie qui répond est Search-a-licious, un service séparé, à un autre
 * nom d'hôte, avec un autre format et — c'est le point — un OpenAPI qui
 * s'annonce toujours en `version: 0.1.0`, sans SLA publié. Nous en dépendons
 * parce qu'il n'y a pas d'alternative ; nous nous arrangeons pour que cette
 * dépendance soit RÉVOCABLE.
 *
 * D'où ce module unique. Il contient l'URL, la syntaxe de requête, la forme
 * des résultats, et la traduction des pannes. Le jour où `/api/v3/search`
 * existera, c'est CE fichier qu'on réécrira — la route, le cache et
 * l'interface ne bougeront pas d'une ligne, parce qu'ils ne reçoivent d'ici
 * que des `ProduitSeth`.
 *
 * ────────────────────────────────────────────────────────────────────────────
 * CE MODULE NE NORMALISE RIEN LUI-MÊME
 * ────────────────────────────────────────────────────────────────────────────
 * Il ADAPTE la forme d'un résultat de recherche vers celle d'une fiche produit
 * OFF, puis passe la main à `versProduitSeth` — le normaliseur de la Phase 3,
 * inchangé. Aucune seconde lecture de `proteins_100g`, aucune seconde règle
 * sur les GTIN, les images ou les allergènes n'est écrite ici : deux
 * implémentations d'une même règle finissent toujours par diverger, et la
 * divergence se voit d'abord dans l'assiette d'un élève.
 */

// ────────────────────────────────────────────────────────────────────────────
// 1. LE SERVICE — UNE SEULE CONSTANTE
// ────────────────────────────────────────────────────────────────────────────
/**
 * ⚠️ Hôte DIFFÉRENT de celui de l'API produit (`world.openfoodfacts.org`).
 * Ce n'est pas un détail : c'est un autre service, déployé séparément, qui
 * peut tomber sans que le lookup GTIN tombe — et réciproquement. C'est
 * précisément pourquoi une panne de recherche ne doit jamais faire perdre les
 * résultats locaux.
 */
export const OFF_SEARCH_URL = "https://search.openfoodfacts.org/search";

/**
 * Version d'API annoncée par l'OpenAPI du service, relevée le 13/08/2026.
 * Conservée ici comme REPÈRE, pas comme garantie : `0.1.0` est exactement ce
 * qu'elle dit — un service qui ne promet pas sa stabilité.
 */
export const OFF_SEARCH_CONTRACT_VERSION = "0.1.0";

/**
 * Champs demandés. Mesuré : l'index ne PORTE PAS `nutrition_data_per`,
 * `product_quantity`, `product_quantity_unit`, `ingredients_text` ni
 * `no_nutrition_data` — les demander ne les fait pas apparaître. Un résultat
 * de recherche est donc structurellement plus PAUVRE qu'une fiche obtenue par
 * code-barres, et c'est la raison d'être de la fusion non destructive du
 * cache (voir lib/supabase/food-products.ts).
 */
export const OFF_SEARCH_FIELDS = [
  "code",
  "product_name",
  "brands",
  "nutriments",
  "image_front_url",
  "allergens_tags",
] as const;

/**
 * Bornes de la requête. Elles sont à NOUS, entièrement.
 *
 * Mesuré le 13/08/2026, et c'est ce qui rend ces bornes indispensables :
 *   - `q=` VIDE rend HTTP 200 avec des produits arbitraires. Le service ne
 *     refuse rien ; sans notre garde, une frappe effacée déclencherait une
 *     recherche qui renverrait n'importe quoi ;
 *   - `page_size=9999` rend HTTP 200. Aucun plafond côté service.
 */
export const RECHERCHE_Q_MIN = 3;
export const RECHERCHE_Q_MAX = 80;
export const RECHERCHE_RESULTATS_MAX = 20;

/**
 * Nombre de résultats DEMANDÉS au fournisseur. Plus large que ce que nous
 * rendons, parce que le tri se fait après : les produits sans nom, sans
 * teneurs exploitables et les doublons de GTIN sont retirés, et il faut de la
 * marge pour qu'une page utile subsiste. Pas trop large non plus — chaque
 * résultat est du transfert et du temps.
 */
export const RECHERCHE_TAILLE_PAGE_OFF = 40;

// ────────────────────────────────────────────────────────────────────────────
// 2. LA REQUÊTE — LE TEXTE DE L'ÉLÈVE RESTE DU TEXTE
// ────────────────────────────────────────────────────────────────────────────
/**
 * Métacaractères Lucene. `q` est interprété par un parseur Lucene — mesuré, et
 * documenté par le service lui-même. Sans échappement, une frappe anodine
 * change le SENS de la requête :
 *
 *   « lait 1/2 écrémé »     → `/…/` ouvre une expression régulière
 *   « yaourt: nature »      → `champ:valeur` cible un champ précis
 *   « pizza AND NOT jambon »→ des opérateurs booléens surgissent du texte
 *   « [a TO z] »            → un intervalle
 *
 * Rien de tout cela n'est une injection au sens de la sécurité — le service
 * n'exécute pas de code — mais c'est une requête que l'élève n'a pas voulue,
 * dont les résultats sont incompréhensibles et qu'il ne peut pas corriger.
 * On préfixe donc chaque métacaractère d'une barre oblique inverse : le texte
 * redevient du texte.
 *
 * `&&` et `||` sont traités par leurs caractères individuels ; `<` et `>`
 * n'ont pas d'échappement en Lucene et sont simplement retirés.
 */
export function echapperLucene(texte: string): string {
  return texte
    .replace(/[<>]/g, " ")
    .replace(/([+\-!(){}[\]^"~*?:\\/&|])/g, "\\$1");
}

export type RequeteInvalide = "vide" | "trop_courte" | "trop_longue";

export type LectureRequete =
  | { readonly ok: true; readonly q: string }
  | { readonly ok: false; readonly raison: RequeteInvalide };

/**
 * Valide et normalise la saisie. Les espaces multiples sont réduits — une
 * frappe hésitante ne doit pas produire une requête différente d'une frappe
 * nette — et la longueur est mesurée APRÈS ce nettoyage, pour que « a » suivi
 * de dix espaces soit reconnu comme trop court plutôt que comme long.
 */
export function lireRequete(saisie: unknown): LectureRequete {
  if (typeof saisie !== "string") return { ok: false, raison: "vide" };
  const q = saisie.replace(/\s+/g, " ").trim();
  if (q.length === 0) return { ok: false, raison: "vide" };
  if (q.length < RECHERCHE_Q_MIN) return { ok: false, raison: "trop_courte" };
  if (q.length > RECHERCHE_Q_MAX) return { ok: false, raison: "trop_longue" };
  return { ok: true, q };
}

/**
 * L'URL de recherche, construite en un endroit. Aucun paramètre ne vient du
 * client : `q` est la seule donnée qui traverse, échappée, et tout le reste
 * est constant. Un client ne peut donc ni changer `page_size`, ni demander
 * d'autres `fields`, ni viser un autre `index_id`.
 */
export function urlRechercheProduits(q: string): string {
  const params = new URLSearchParams({
    q: echapperLucene(q),
    page_size: String(RECHERCHE_TAILLE_PAGE_OFF),
    page: "1",
    fields: OFF_SEARCH_FIELDS.join(","),
  });
  return `${OFF_SEARCH_URL}?${params.toString()}`;
}

// ────────────────────────────────────────────────────────────────────────────
// 3. UN RÉSULTAT DE RECHERCHE → UNE FICHE PRODUIT CANONIQUE
// ────────────────────────────────────────────────────────────────────────────
/**
 * La seule différence de forme qu'il faut vraiment traiter : dans l'index de
 * recherche, `brands` est un TABLEAU (`['Danone']`), là où l'API produit rend
 * une chaîne (`'Ferrero'`). Mesuré, non deviné.
 *
 * Tout le reste — `nutriments.*_100g`, `code`, `image_front_url`,
 * `allergens_tags` — porte déjà les mêmes noms. On reconstruit donc la forme
 * que `versProduitSeth` sait lire, et on la lui donne. Aucune règle
 * nutritionnelle n'est réécrite ici.
 */
export function hitVersFicheProduit(hit: unknown): Record<string, unknown> | null {
  if (hit === null || typeof hit !== "object") return null;
  const h = hit as Record<string, unknown>;

  const marques = h["brands"];
  const marque = Array.isArray(marques)
    ? marques.filter((m): m is string => typeof m === "string").join(", ")
    : typeof marques === "string"
      ? marques
      : undefined;

  return {
    code: h["code"],
    product_name: h["product_name"],
    brands: marque,
    nutriments: h["nutriments"],
    image_front_url: h["image_front_url"],
    allergens_tags: h["allergens_tags"],
    // Les champs que l'index ne porte pas restent ABSENTS, et c'est
    // volontaire : les inventer à vide ferait croire à une information.
  };
}

export interface ResultatRecherche {
  readonly produits: readonly ProduitSeth[];
  /** Écartés faute de teneurs exploitables ou de nom. Diagnostic interne. */
  readonly ignoredIncompleteCount: number;
  /** Écartés parce qu'un même GTIN était déjà présent. */
  readonly doublonsRetires: number;
}

/**
 * Réponse Search-a-licious → produits SETH.
 *
 * ⚠️ UNE FICHE INEXPLOITABLE NE FAIT PAS ÉCHOUER LA RECHERCHE. Sur vingt
 * résultats, huit sans teneurs sont un cas ORDINAIRE — l'audit de Phase 1
 * l'avait relevé chez OFF comme « fréquent, des milliers de produits ». Rendre
 * une erreur pour tout le lot priverait l'élève des douze qui marchent.
 *
 * L'ORDRE DU FOURNISSEUR EST CONSERVÉ. Aucun score maison, aucun
 * réordonnancement : nous ne savons pas mieux que l'index ce qui ressemble à
 * « skyr danone », et prétendre le contraire demanderait une mesure que
 * personne n'a faite.
 *
 * La déduplication se fait sur le GTIN, en gardant le PREMIER vu — donc le
 * mieux classé par le fournisseur.
 */
export function produitsDepuisReponse(corps: unknown): ResultatRecherche {
  if (corps === null || typeof corps !== "object") {
    throw new OffErreur("OFF_INVALID_RESPONSE", "Réponse de recherche non exploitable.");
  }
  const hits = (corps as { hits?: unknown }).hits;
  if (!Array.isArray(hits)) {
    throw new OffErreur("OFF_INVALID_RESPONSE", "Réponse de recherche sans liste de résultats.");
  }

  const produits: ProduitSeth[] = [];
  const gtinsVus = new Set<string>();
  let ignores = 0;
  let doublons = 0;

  for (const hit of hits) {
    const fiche = hitVersFicheProduit(hit);
    if (fiche === null) {
      ignores += 1;
      continue;
    }
    const code = typeof fiche["code"] === "string" ? fiche["code"].trim() : "";
    // ⚠️ LE CODE EST VALIDÉ ICI, ET C'EST INDISPENSABLE.
    //
    // `versProduitSeth` reçoit le GTIN déjà vérifié : sur le chemin du lookup,
    // `exigerGtin` s'en est chargé bien avant l'appel réseau. Sur le chemin de
    // la recherche, personne ne l'a fait — le code vient de l'index, tel quel.
    //
    // Découvert par A3-SEARCH7 : un code hors forme traversait la
    // normalisation sans encombre et arrivait jusqu'à l'upsert, où la
    // contrainte `food_products_gtin_forme` l'aurait refusé — en faisant
    // échouer LE LOT ENTIER. Un seul résultat mal formé sur quarante aurait
    // donc effacé les trente-neuf autres, et l'élève aurait vu une recherche
    // vide sans qu'aucune trace n'explique pourquoi.
    if (code === "" || !gtinEstValide(code)) {
      ignores += 1;
      continue;
    }
    if (gtinsVus.has(code)) {
      doublons += 1;
      continue;
    }

    let produit: ProduitSeth;
    try {
      // Le MÊME normaliseur que la Phase 3, avec l'enveloppe de succès qu'il
      // attend. Un produit incomplet lève PRODUCT_NUTRITION_INCOMPLETE ; un
      // GTIN hors forme lève INVALID_GTIN. Les deux se rangent au même
      // endroit : écarté, pas fatal.
      produit = versProduitSeth(code, { status: "success", product: fiche });
    } catch (erreur) {
      if (estOffErreur(erreur)) {
        ignores += 1;
        continue;
      }
      throw erreur;
    }

    gtinsVus.add(code);
    produits.push(produit);
    if (produits.length >= RECHERCHE_RESULTATS_MAX) break;
  }

  return { produits, ignoredIncompleteCount: ignores, doublonsRetires: doublons };
}

// ────────────────────────────────────────────────────────────────────────────
// 4. LE TRANSPORT
// ────────────────────────────────────────────────────────────────────────────
export interface OptionsRecherche {
  readonly transport?: Transport;
  readonly timeoutMs?: number;
}

/**
 * UNE requête externe, pas deux. Pas de pagination, pas de seconde passe pour
 * « compléter » les fiches pauvres par des lookups GTIN : ce serait vingt
 * appels au lieu d'un, et le quota d'Open Food Facts — 10 requêtes/minute sur
 * les recherches, avec bannissement d'IP à la clé — est celui du SERVEUR,
 * partagé par tous les élèves.
 *
 * Les pannes sont traduites dans le vocabulaire fermé de la Phase 3 : l'appelant
 * n'apprend jamais qu'il existe un service nommé Search-a-licious.
 */
export async function chercherProduitsParTexte(
  q: string,
  options: OptionsRecherche = {},
): Promise<ResultatRecherche> {
  const entete = userAgentOff();
  const transport = options.transport ?? ((url, init) => fetch(url, init));
  const controleur = new AbortController();
  const minuteur = setTimeout(() => controleur.abort(), options.timeoutMs ?? OFF_TIMEOUT_MS);

  let reponse: Response;
  try {
    reponse = await transport(urlRechercheProduits(q), {
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
  // 422 = requête refusée par le service. C'est notre faute (une requête mal
  // formée), pas une panne : on ne la déguise pas en indisponibilité.
  if (reponse.status === 422) {
    throw new OffErreur("OFF_INVALID_RESPONSE", "Requête de recherche refusée par le service.");
  }
  if (!reponse.ok) {
    throw new OffErreur("OFF_UNAVAILABLE", `La recherche Open Food Facts a répondu ${reponse.status}.`);
  }

  let corps: unknown;
  try {
    corps = await reponse.json();
  } catch {
    throw new OffErreur("OFF_INVALID_RESPONSE", "Réponse de recherche illisible.");
  }

  return produitsDepuisReponse(corps);
}
