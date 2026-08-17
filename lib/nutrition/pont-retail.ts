/**
 * COURSES C4.1 — LE PONT ALIMENT GÉNÉRIQUE → PRODUIT RÉEL, EN LOGIQUE PURE.
 *
 * ────────────────────────────────────────────────────────────────────────────
 * CE MODULE NE PARLE À PERSONNE
 * ────────────────────────────────────────────────────────────────────────────
 * Ni base, ni réseau, ni React. Il contient les trois règles que l'on veut
 * pouvoir mesurer sans monter d'infrastructure :
 *
 *   1. QU'EST-CE QU'UN RAPPROCHEMENT RÉEL           (§ 1)
 *   2. QUELS CANDIDATS SONT ACCEPTABLES             (§ 2)
 *   3. COMMENT INTERROGER OPEN PRICES SANS DANGER   (§ 3)
 *
 * Une règle qu'on ne peut pas mesurer se contourne — c'est la raison d'être de
 * `budget-courses.ts` en C3, et c'est la même ici.
 */

// ────────────────────────────────────────────────────────────────────────────
// 1. L'ÉTAT DE RAPPROCHEMENT D'UN ALIMENT
// ────────────────────────────────────────────────────────────────────────────

/**
 * Les trois statuts que la table de curation sait porter.
 *
 * ⚠️ `matched` N'EN FAIT PAS PARTIE, ET N'EN FERA JAMAIS PARTIE. Le
 * rapprochement réel se dérive de `food_products.food_id`, seule source de
 * vérité. Un second `matched` stocké ici serait une seconde vérité — et le jour
 * où les deux divergeraient, on croirait la plus lisible plutôt que la vraie.
 * Le CHECK de la migration 20260917090000 l'interdit en base ; ce type
 * l'interdit à la compilation.
 */
export const STATUTS_REVUE = ["unsupported", "needs_raw_redirect", "needs_review"] as const;
export type StatutRevue = (typeof STATUTS_REVUE)[number];

export function estStatutRevue(valeur: unknown): valeur is StatutRevue {
  return typeof valeur === "string" && (STATUTS_REVUE as readonly string[]).includes(valeur);
}

/**
 * L'état d'un aliment, tel que l'écran de curation doit le montrer.
 *
 * `unreviewed` est l'état des 3 330 aliments du catalogue au premier jour. Il
 * est NOMMÉ plutôt que confondu avec `needs_review` : « personne n'a regardé »
 * et « quelqu'un a regardé, rien n'est décidé » sont deux situations
 * différentes, et les mélanger ferait croire à un catalogue déjà traité.
 */
export type EtatRapprochement =
  | "matched"
  | "needs_raw_redirect"
  | "unsupported"
  | "needs_review"
  | "unreviewed";

/** Le strict nécessaire pour juger d'un rapprochement — pas la fiche entière. */
export interface ProduitRapproche {
  readonly gtin: string;
  readonly foodId: string | null;
  readonly matchStatus: string;
}

export interface LigneRevue {
  readonly catalogFoodId: string;
  readonly status: StatutRevue;
}

/**
 * ⚠️ LA CONDITION CANONIQUE D'UN MATCH : `foodId !== null`. JAMAIS `matchStatus`.
 *
 * `food_products_match_coherent` n'est écrite que dans UN sens —
 * `food_id is null or match_status <> 'unmatched'` — pour que le
 * `on delete set null` de `food_catalog` puisse vider `food_id` sans violer la
 * contrainte. L'état `match_status = 'manual'` AVEC `food_id = null` est donc
 * LÉGAL en base : il veut dire « ce rapprochement a existé, l'aliment générique
 * a disparu ».
 *
 * Lire `matchStatus` comme preuve ferait remonter un produit ORPHELIN dans les
 * courses d'un élève, rattaché à un aliment qui n'existe plus.
 */
export function estRapproche(produit: ProduitRapproche): boolean {
  return produit.foodId !== null && produit.foodId !== "";
}

/**
 * L'état d'un aliment, dérivé de DEUX sources et d'aucune autre.
 *
 * ⚠️ L'ORDRE DES CAS EST LA RÈGLE DE RÉSOLUTION, et il n'est pas cosmétique :
 * `matched` l'emporte sur toute ligne de revue. Un fait constaté prime sur une
 * note d'intention. Sans cette priorité, une vieille ligne `needs_review`
 * laissée en place après validation ferait croire que l'aliment n'est toujours
 * pas rapproché — précisément le défaut qu'il fallait fermer.
 *
 * La route de rapprochement SUPPRIME en plus la ligne de revue devenue caduque
 * (voir `lib/supabase/pont-retail.ts`). Les deux mécanismes coexistent
 * volontairement : la priorité est l'INVARIANT, qui reste vrai même si le
 * nettoyage échoue ; le nettoyage est l'HYGIÈNE, qui évite d'accumuler des
 * notes mortes. On ne dépend jamais du second pour que le premier soit vrai.
 */
export function etatRapprochement(
  catalogFoodId: string,
  produits: readonly ProduitRapproche[],
  revue: LigneRevue | null | undefined,
): EtatRapprochement {
  if (produits.some((p) => estRapproche(p) && p.foodId === catalogFoodId)) {
    return "matched";
  }
  if (revue && revue.catalogFoodId === catalogFoodId) {
    return revue.status;
  }
  return "unreviewed";
}

// ────────────────────────────────────────────────────────────────────────────
// 2. LES FILTRES DURS SUR UN CANDIDAT
// ────────────────────────────────────────────────────────────────────────────

/**
 * Le code Ciqual tel que `food_catalog.source_ref` le porte : numérique, 4 à 6
 * chiffres (mesuré en production : 4 ou 5, borne haute laissée pour la marge).
 *
 * ⚠️ VALIDÉ AVANT DE CONSTRUIRE UNE URL. Un `source_ref` inattendu ne doit pas
 * partir tel quel dans un paramètre de requête : le tag `ciqual-food-code-<N>`
 * est une clé exacte, pas un texte de recherche.
 */
export function codeCiqualEstValide(code: string): boolean {
  return /^[0-9]{4,6}$/.test(code);
}

/**
 * Pourquoi un candidat trouvé chez Open Food Facts n'entre pas dans
 * `food_products`.
 *
 * ⚠️ « TROUVÉ » ET « IMPORTABLE » SONT DEUX CHOSES DIFFÉRENTES, et c'est le
 * point le plus facile à rater de tout ce lot. `food_products` déclare
 * `protein_per_100`, `carb_per_100` et `fat_per_100` en NOT NULL : une ligne de
 * cette table est CONSOMMABLE par construction. Un produit dont Open Food Facts
 * ne publie pas les trois macros ne peut donc pas y entrer.
 *
 * Les trois réponses interdites : fabriquer des zéros, importer quand même en
 * faisant passer l'incomplet pour du complet, ou masquer le candidat. La
 * quatrième — le montrer avec sa raison, et proposer le suivant — est la seule
 * qui ne ment pas.
 */
export const REFUS_CANDIDAT = [
  "gtin_absent",
  "gtin_invalide",
  "nutrition_incomplete",
  "doublon",
] as const;
export type RefusCandidat = (typeof REFUS_CANDIDAT)[number];

export const MESSAGE_REFUS: Record<RefusCandidat, string> = {
  gtin_absent: "Aucun code-barres publié",
  gtin_invalide: "Code-barres de forme invalide",
  nutrition_incomplete: "Nutrition Open Food Facts incomplète — non importable",
  doublon: "Code-barres déjà présent dans les candidats",
};

// ────────────────────────────────────────────────────────────────────────────
// 3. OPEN PRICES — LE GARDE-FOU DES LOTS
// ────────────────────────────────────────────────────────────────────────────

/**
 * ⚠️ MESURÉ LE 17/08/2026 SUR L'API DE PRODUCTION, ET C'EST UN PIÈGE GRAVE.
 *
 * Au-delà d'environ 98 caractères de valeur jointe, `product_code__in` n'est pas
 * REJETÉ : il est SILENCIEUSEMENT IGNORÉ, et l'API rend la table entière.
 *
 *   8 codes,  96 caractères  →  total = 31       ✅
 *   7 codes,  97 caractères  →  total = 102      ✅
 *   8 codes,  98 caractères  →  total = 102      ✅
 *   8 codes, 100 caractères  →  total = 290 792  ❌  (tout Open Prices)
 *   8 codes, 111 caractères  →  total = 292 967  ❌
 *
 * Pas de 400, pas de message. Un client qui prendrait `items[0].price`
 * afficherait le prix d'un déodorant allemand comme prix du riz de l'élève.
 *
 * D'où DEUX bornes plutôt qu'une : 7 codes EAN-13 (97 caractères, marge d'un
 * caractère sous la limite observée) ET la longueur jointe, parce qu'un GTIN-14
 * change le compte. La borne la plus stricte des deux gagne.
 */
export const OPEN_PRICES_LOT_MAX_CODES = 7;
export const OPEN_PRICES_LOT_MAX_CARACTERES = 97;

/**
 * Découpe une liste de codes-barres en lots sûrs.
 *
 * Les doublons sont retirés — demander deux fois le même code gaspille un
 * emplacement du lot — et l'ordre d'origine est conservé : c'est celui du
 * classement de la recherche, et nous ne savons pas mieux.
 */
export function decouperLotsCodesBarres(gtins: readonly string[]): readonly (readonly string[])[] {
  const lots: string[][] = [];
  const vus = new Set<string>();
  let courant: string[] = [];
  let longueur = 0;

  for (const gtin of gtins) {
    if (gtin === "" || vus.has(gtin)) continue;
    vus.add(gtin);

    // Un code si long qu'il ne tiendrait dans aucun lot n'est pas un
    // code-barres. On ne le fait pas déborder sur le lot suivant : on le laisse
    // de côté, et le filtre de forme l'aura de toute façon écarté plus tôt.
    if (gtin.length > OPEN_PRICES_LOT_MAX_CARACTERES) continue;

    const ajout = courant.length === 0 ? gtin.length : gtin.length + 1;
    const tropLong = longueur + ajout > OPEN_PRICES_LOT_MAX_CARACTERES;
    const tropNombreux = courant.length >= OPEN_PRICES_LOT_MAX_CODES;

    if (courant.length > 0 && (tropLong || tropNombreux)) {
      lots.push(courant);
      courant = [];
      longueur = 0;
    }

    longueur += courant.length === 0 ? gtin.length : gtin.length + 1;
    courant.push(gtin);
  }

  if (courant.length > 0) lots.push(courant);
  return lots;
}

/**
 * Plafond de vraisemblance, par code demandé. Le produit le plus relevé
 * d'Open Prices en compte quelques centaines ; 500 laisse une marge large tout
 * en restant à trois ordres de grandeur sous les 290 000 lignes de la table.
 *
 * C'est un test de fumée, pas une borne exacte — la détection SÛRE est
 * `codes_hors_lot` ci-dessous.
 */
export const OPEN_PRICES_MAX_PRIX_PAR_CODE = 500;

export type IncoherenceOpenPrices = "codes_hors_lot" | "total_aberrant";

/**
 * Vérifie qu'une réponse Open Prices correspond bien au lot demandé.
 *
 * ⚠️ DEUX CONTRÔLES, ET LE PREMIER EST LE SEUL EXACT.
 *
 *   1. `codes_hors_lot` — un seul article dont le `product_code` n'était pas
 *      demandé prouve que le filtre a sauté. C'est une CERTITUDE, pas une
 *      heuristique, et elle se déclenche même sur une réponse de dix lignes ;
 *   2. `total_aberrant` — le total dépasse toute vraisemblance. Filet de
 *      sécurité pour le cas où la première page ne contiendrait, par hasard,
 *      que des codes demandés.
 *
 * Rend `null` quand la réponse est cohérente. Une incohérence doit être traitée
 * comme une PANNE — « prix indisponibles » — jamais comme un résultat.
 */
export function verifierReponseOpenPrices(params: {
  readonly total: number;
  readonly codesDemandes: readonly string[];
  readonly codesRendus: readonly string[];
}): IncoherenceOpenPrices | null {
  const demandes = new Set(params.codesDemandes);
  if (params.codesRendus.some((code) => !demandes.has(code))) return "codes_hors_lot";

  const plafond = params.codesDemandes.length * OPEN_PRICES_MAX_PRIX_PAR_CODE;
  if (!Number.isFinite(params.total) || params.total > plafond) return "total_aberrant";

  return null;
}

// ────────────────────────────────────────────────────────────────────────────
// 4. CE QU'ON RETIENT D'OPEN PRICES POUR LA CURATION
// ────────────────────────────────────────────────────────────────────────────

/**
 * ⚠️ C4.1 NE CALCULE AUCUN PRIX. Ces champs INFORMENT la curation — « ce
 * produit est-il relevé quelque part, et récemment ? » — et rien d'autre.
 * Aucun montant n'entre en base, aucun total n'est affiché à un élève.
 *
 * `observeLe` est conservée SANS seuil de fraîcheur. Un seuil couperet
 * masquerait la quasi-totalité des relevés : mesuré sur un magasin réel bien
 * fourni, 64 prix sur 4 052 ont moins de six mois. Cacher un prix de sept mois
 * donnerait « aucun prix » ; l'afficher sans sa date serait un mensonge. La
 * date est la correction honnête.
 *
 * ⚠️ TROIS STATUTS, PAS DEUX, ET C'EST LA MÊME LEÇON QUE `LecturePrix.ok` EN C3.
 *
 *   `connu`        — des relevés existent, `nombre` et `observeLe` sont exacts ;
 *   `aucun`        — la réponse était COMPLÈTE et ce code n'y figure pas :
 *                    aucun prix, et c'est un fait ;
 *   `indetermine`  — la réponse était TRONQUÉE (plus de résultats que la page
 *                    n'en portait) et ce code n'y figurait pas. On ne sait pas.
 *
 * Confondre `indetermine` avec `aucun` afficherait « aucun prix connu » sur un
 * produit qui en a peut-être vingt — et l'administrateur écarterait un bon
 * candidat sur une information fausse.
 */
export type StatutApercu = "connu" | "aucun" | "indetermine";

export interface ApercuPrix {
  readonly gtin: string;
  readonly statut: StatutApercu;
  readonly nombre: number;
  readonly observeLe: string | null;
  /** Relevés de type COMMUNITY — le prix EN RAYON, pas un ticket de caisse. */
  readonly nombreCommunity: number;
}

export function apercuAbsent(gtin: string, reponseComplete: boolean): ApercuPrix {
  return {
    gtin,
    statut: reponseComplete ? "aucun" : "indetermine",
    nombre: 0,
    observeLe: null,
    nombreCommunity: 0,
  };
}
