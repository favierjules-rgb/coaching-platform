/**
 * COURSES C4.4 — LES PRIX OBSERVÉS, EN LOGIQUE PURE.
 *
 * ────────────────────────────────────────────────────────────────────────────
 * CE MODULE NE PARLE À PERSONNE
 * ────────────────────────────────────────────────────────────────────────────
 * Ni base, ni réseau, ni React. Il porte les quatre règles de C4.4 :
 *
 *   1. COMMENT UNE LIGNE DE COURSES DEVIENT N CODE-BARRES   (§ 1)
 *   2. CE QU'EST — ET N'EST PAS — UNE OBSERVATION           (§ 2)
 *   3. COMMENT LES OBSERVATIONS S'ORDONNENT                 (§ 3)
 *   4. CE QUE L'ÉCRAN DOIT MONTRER                          (§ 4)
 *
 * ════════════════════════════════════════════════════════════════════════════
 * ⚠️ C4.4 LIT. IL N'ÉCRIT RIEN, ET IL NE CHOISIT RIEN.
 * ════════════════════════════════════════════════════════════════════════════
 * Aucune ligne de ce lot n'entre en base : pas de table de prix locale, pas de
 * `food_price_estimates`, pas de colonne ajoutée. Le budget de C3 n'est pas
 * touché — il continue de fonctionner exactement comme avant.
 *
 * Et surtout : C4.4 n'élit AUCUN produit. Le contrat de cardinalité
 * (`lib/nutrition/pont-retail.ts`) dit qu'un aliment générique porte N
 * références commerciales réelles ; ce module rend les observations de TOUTES,
 * côte à côte. Choisir entre un paquet de 500 g et un paquet de 125 g, c'est
 * choisir un CONDITIONNEMENT — et le conditionnement est C4.5. Trancher ici
 * produirait un prix juste pour un emballage que personne n'a choisi.
 */

// ────────────────────────────────────────────────────────────────────────────
// 1. DE LA LIGNE DE COURSES AUX CODE-BARRES
// ────────────────────────────────────────────────────────────────────────────

/**
 * L'identité d'une ligne de courses, dans le vocabulaire DÉJÀ utilisé par
 * `lib/supabase/prix-courses.ts` (C3). On ne réinvente pas un second
 * vocabulaire d'identité : la base impose déjà « exactement une cible par
 * ligne » — `catalog_food_id` XOR `product_id` — et deux façons de le nommer
 * finiraient par diverger.
 */
export type TypeIdentite = "catalog_food" | "product";

/** `catalog_food:UUID` ou `product:UUID` — la clé de la carte ci-dessous. */
export function cleIdentite(type: TypeIdentite, id: string): string {
  return `${type}:${id}`;
}

export interface ProduitDirect {
  readonly productId: string;
  readonly gtin: string;
}

export interface ProduitRelie {
  readonly foodId: string;
  readonly gtin: string;
}

/**
 * Les code-barres de chaque identité de la liste.
 *
 * ════════════════════════════════════════════════════════════════════════════
 * ⚠️ DEUX CHEMINS, ET ILS NE SE MÉLANGENT PAS
 * ════════════════════════════════════════════════════════════════════════════
 *
 *   A. LIGNE DIRECTE — `shopping_list_items.product_id` pointe une ligne de
 *      `food_products`. Son code-barres est celui de CE produit, et d'aucun
 *      autre. L'élève a désigné un produit précis ; lui servir les prix des
 *      « frères » de son aliment générique serait répondre à une question qu'il
 *      n'a pas posée.
 *
 *   B. LIGNE GÉNÉRIQUE — `shopping_list_items.catalog_food_id` pointe un
 *      aliment du catalogue. Ses code-barres sont ceux de TOUS les
 *      `food_products` dont `food_id` vaut cet aliment. C'est ici que le N vit :
 *      « Flocons d'avoine » rend le paquet Carrefour, le paquet Lidl, le paquet
 *      Auchan — et c'est le comportement ATTENDU, pas une ambiguïté.
 *
 * ⚠️ L'ORDRE D'ARRIVÉE EST CONSERVÉ, et les doublons retirés. Cet ordre n'a
 * aucune autorité : il ne dit pas qu'un produit vaut mieux qu'un autre, il
 * rend seulement le résultat reproductible.
 */
export function gtinsParIdentite(params: {
  readonly produitsDirects: readonly ProduitDirect[];
  readonly produitsRelies: readonly ProduitRelie[];
}): ReadonlyMap<string, readonly string[]> {
  const carte = new Map<string, string[]>();

  const ajouter = (cle: string, gtin: string) => {
    if (gtin === "") return;
    const liste = carte.get(cle) ?? [];
    if (!liste.includes(gtin)) liste.push(gtin);
    carte.set(cle, liste);
  };

  for (const direct of params.produitsDirects) {
    ajouter(cleIdentite("product", direct.productId), direct.gtin);
  }
  for (const relie of params.produitsRelies) {
    ajouter(cleIdentite("catalog_food", relie.foodId), relie.gtin);
  }
  return carte;
}

// ────────────────────────────────────────────────────────────────────────────
// 2. CE QU'EST UNE OBSERVATION
// ────────────────────────────────────────────────────────────────────────────

/**
 * `price_per` d'Open Prices — et ses TROIS cas, jamais deux.
 *
 * ⚠️ `null` N'EST PAS UNE ABSENCE D'INFORMATION. Un prix `type=PRODUCT` sans
 * `price_per` est le prix du CONDITIONNEMENT ENTIER. Un prix `KILOGRAM` est un
 * prix au kilo, un prix `UNIT` un prix à la pièce. Les traiter pareil
 * multiplierait ou diviserait par le poids du paquet — un prix faux d'un
 * facteur 5, affirmé avec aplomb. C4.4 ne tranche pas ces trois cas (c'est
 * C4.5) : il les TRANSMET sans les aplatir.
 */
export type PricePer = "UNIT" | "KILOGRAM" | null;

/**
 * Un relevé de prix, tel que C4.4 le rend.
 *
 * ⚠️ LE MONTANT EST UN ENTIER DE MILLIÈMES, ET C'EST OBLIGATOIRE. `price` est
 * un `Decimal(max_digits=10, decimal_places=3)` chez Open Prices — TROIS
 * décimales. La doctrine du projet est l'entier (`*_cents`), et
 * `round(price × 100)` perdrait la troisième décimale EN SILENCE. On garde donc
 * des millièmes : l'entier reste entier, et rien n'est perdu.
 *
 * ⚠️ ET IL N'Y A NI `product_quantity`, NI POIDS, NI MARQUE. Ce sont les
 * données du CONDITIONNEMENT, donc le périmètre de C4.5. Les rapatrier « au cas
 * où » ferait entrer C4.5 dans C4.4 par la porte des types.
 */
export interface ObservationPrix {
  /** L'identité du relevé chez Open Prices — pour dédupliquer sans deviner. */
  readonly priceId: number;
  readonly gtin: string;
  /** `price × 1000`, entier. Jamais un flottant, jamais des centimes. */
  readonly montantMilli: number;
  readonly devise: "EUR";
  /** La date d'observation EN MAGASIN. JAMAIS nulle : c'est elle qui dit la fraîcheur. */
  readonly observeLe: string;
  /**
   * La date de SAISIE du relevé dans Open Prices — `created`, instant UTC.
   *
   * ⚠️ CE N'EST PAS `observeLe`, ET LES CONFONDRE SERAIT UNE FAUTE. `date` est
   * le jour où le prix a été VU en rayon ; `created` le jour où quelqu'un l'a
   * saisi. Un relevé de janvier peut être saisi en août. La fraîcheur se lit
   * sur `observeLe`, et sur lui seul.
   *
   * Elle n'est là que pour DÉPARTAGER deux relevés du même jour, et pour ne pas
   * perdre l'information avant les lots suivants. C4.4 ne s'en sert pour
   * choisir aucun prix.
   */
  readonly createdLe: string;
  /** Le magasin où le relevé a été fait — `stores.op_location_id`. */
  readonly opLocationId: number;
  readonly pricePer: PricePer;
}

/** Pourquoi une ligne d'Open Prices n'est pas devenue une observation. */
export const REFUS_OBSERVATION = [
  "type_non_produit",
  "devise_non_eur",
  "remise",
  "date_absente",
  "montant_illisible",
  "code_absent",
  "price_per_inconnu",
  "identifiant_absent",
  "created_illisible",
] as const;
export type RefusObservation = (typeof REFUS_OBSERVATION)[number];

export type ResultatNormalisation =
  | { readonly ok: true; readonly observation: ObservationPrix }
  | { readonly ok: false; readonly refus: RefusObservation };

/**
 * `price` → millièmes entiers, SANS passer par un flottant quand c'est une
 * chaîne.
 *
 * ⚠️ POURQUOI PAS `Math.round(Number(price) * 1000)`. Django REST Framework
 * sérialise un `DecimalField` en CHAÎNE par défaut (`COERCE_DECIMAL_TO_STRING`).
 * `Number("2.995") * 1000` vaut 2994.9999999999995 en IEEE 754 ; l'arrondi
 * rattrape ce cas-ci, mais la classe de bug est réelle et elle est silencieuse.
 * On lit donc les chiffres tels qu'ils sont écrits.
 *
 * Un nombre JSON est accepté aussi — l'amont pourrait changer de réglage — mais
 * il repasse par la MÊME grammaire, et tout ce qui n'y entre pas est REFUSÉ
 * plutôt qu'arrondi au jugé. Un montant qu'on ne sait pas lire n'est pas un
 * montant approximatif : c'est une absence.
 */
export function montantMilliDepuis(valeur: unknown): number | null {
  let texte: string;
  if (typeof valeur === "string") texte = valeur.trim();
  else if (typeof valeur === "number") {
    if (!Number.isFinite(valeur)) return null;
    texte = String(valeur);
  } else return null;

  const m = /^(\d+)(?:\.(\d{1,3}))?$/.exec(texte);
  if (!m) return null;
  const entier = m[1]!;
  const fraction = (m[2] ?? "").padEnd(3, "0");
  const milli = Number(`${entier}${fraction}`);
  return Number.isSafeInteger(milli) ? milli : null;
}

/**
 * Un instant ISO 8601 UTC → une clé COMPARABLE PAR ORDRE ALPHABÉTIQUE.
 *
 * ════════════════════════════════════════════════════════════════════════════
 * ⚠️ POURQUOI UNE CANONISATION, ET PAS UN `<` DIRECT SUR LA CHAÎNE
 * ════════════════════════════════════════════════════════════════════════════
 * Comparer deux dates ISO comme des chaînes est sûr — TANT QUE LES DEUX ONT LA
 * MÊME FORME. Ici, elles ne l'ont pas toujours : `datetime.isoformat()` OMET la
 * partie fractionnaire quand les microsecondes valent zéro, et en écrit six
 * chiffres sinon. Deux instants du même seconde peuvent donc arriver ainsi :
 *
 *     "2026-08-01T20:01:52Z"           ← 52,000000 s
 *     "2026-08-01T20:01:52.276771Z"    ← 52,276771 s
 *
 * En comparaison brute, le caractère suivant « 52 » est `Z` (0x5A) d'un côté et
 * `.` (0x2E) de l'autre : la chaîne SANS fraction passe pour la PLUS GRANDE.
 * L'ordre s'inverse, silencieusement, sur deux relevés séparés d'un quart de
 * seconde. On aligne donc la fraction avant de comparer.
 *
 * ⚠️ ET AUCUN `Date`, AUCUN `getTime()`, AUCUN FLOTTANT. Une comparaison ISO
 * canonisée suffit et reste exacte ; passer par un horodatage en millisecondes
 * perdrait les microsecondes que la source nous donne — précisément celles qui
 * départagent deux saisies du même jour.
 *
 * ⚠️ SEUL L'UTC EST ACCEPTÉ (`Z` ou `+00:00`, qui désignent le même instant).
 * Un décalage comme `+02:00` demanderait une arithmétique de fuseau ; plutôt
 * que de la bricoler, on REFUSE — et le refus se compte, il ne se cache pas.
 */
export function cleInstantIso(valeur: unknown): string | null {
  if (typeof valeur !== "string") return null;
  const m = /^(\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2})(?:\.(\d{1,9}))?(?:Z|\+00:00)$/.exec(
    valeur.trim(),
  );
  if (!m) return null;
  return `${m[1]}.${(m[2] ?? "").padEnd(9, "0")}`;
}

const PRICE_PER_CONNUS = new Set(["UNIT", "KILOGRAM"]);

/**
 * Une ligne brute d'Open Prices → une observation, ou un refus MOTIVÉ.
 *
 * ⚠️ CHAQUE CONTRÔLE EST UNE SECONDE SERRURE. La requête demande déjà
 * `type=PRODUCT`, `currency=EUR` et `price_is_discounted=false` — mais un filtre
 * amont est une politesse, pas une garantie. Le jour où Open Prices renomme un
 * paramètre, la requête cesserait silencieusement de filtrer et un prix
 * promotionnel entrerait dans un panier comme prix normal. Le filtre amont fait
 * gagner de la bande passante ; ces refus font la correction.
 */
export function normaliserObservation(
  brut: unknown,
  opLocationIdAttendu: number,
): ResultatNormalisation {
  if (typeof brut !== "object" || brut === null) return { ok: false, refus: "code_absent" };
  const l = brut as Record<string, unknown>;

  if (l["type"] !== "PRODUCT") return { ok: false, refus: "type_non_produit" };
  if (l["currency"] !== "EUR") return { ok: false, refus: "devise_non_eur" };
  // ⚠️ `!== false` et non `=== true` : une valeur absente ou inattendue doit
  // être traitée comme « on ne sait pas si c'est une remise », donc refusée.
  if (l["price_is_discounted"] !== false) return { ok: false, refus: "remise" };

  const gtin = typeof l["product_code"] === "string" ? l["product_code"] : "";
  if (gtin === "") return { ok: false, refus: "code_absent" };

  const date = typeof l["date"] === "string" ? l["date"].trim() : "";
  if (date === "") return { ok: false, refus: "date_absente" };

  const montantMilli = montantMilliDepuis(l["price"]);
  if (montantMilli === null) return { ok: false, refus: "montant_illisible" };

  const pricePerBrut = l["price_per"];
  let pricePer: PricePer;
  if (pricePerBrut === null || pricePerBrut === undefined) pricePer = null;
  else if (typeof pricePerBrut === "string" && PRICE_PER_CONNUS.has(pricePerBrut)) {
    pricePer = pricePerBrut as PricePer;
  } else return { ok: false, refus: "price_per_inconnu" };

  const priceId = typeof l["id"] === "number" && Number.isSafeInteger(l["id"]) ? l["id"] : null;
  if (priceId === null) return { ok: false, refus: "identifiant_absent" };

  // ⚠️ `created` EST GARANTI PAR LE SCHÉMA AMONT — `models.DateTimeField(
  // default=timezone.now)`, sans `null=True` — et exposé par
  // `PriceFullSerializer` (`fields = "__all__"`). Une valeur absente ou d'une
  // forme que nous ne savons pas ordonner signale donc une DÉRIVE de la source,
  // pas un cas normal. On refuse la ligne plutôt que de l'ordonner au hasard :
  // le refus est COMPTÉ, et un comptage non nul rend l'état `indetermine` — la
  // dérive se voit, elle ne se déguise pas en « aucun relevé ».
  const createdLe = typeof l["created"] === "string" ? l["created"].trim() : "";
  if (createdLe === "" || cleInstantIso(createdLe) === null) {
    return { ok: false, refus: "created_illisible" };
  }

  return {
    ok: true,
    observation: {
      priceId,
      gtin,
      montantMilli,
      devise: "EUR",
      observeLe: date,
      createdLe,
      opLocationId: opLocationIdAttendu,
      pricePer,
    },
  };
}

export type IncoherenceObservations = "magasin_hors_lot";

/**
 * Vérifie qu'une page de relevés vient bien DU MAGASIN DEMANDÉ.
 *
 * ⚠️ MÊME DOCTRINE QUE `codes_hors_lot` EN C4.1, ET POUR LA MÊME RAISON. Un
 * seul relevé venu d'un autre magasin prouve que `location_id` n'a pas été pris
 * en compte — et l'API rendrait alors les prix de la France entière. On jette
 * la page ENTIÈRE plutôt que d'en garder la moitié crédible : un résultat à
 * moitié faux est plus dangereux qu'une absence, parce qu'il est croyable.
 */
export function verifierMagasinDesObservations(params: {
  readonly opLocationId: number;
  readonly items: readonly unknown[];
}): IncoherenceObservations | null {
  for (const item of params.items) {
    if (typeof item !== "object" || item === null) continue;
    const brut = (item as Record<string, unknown>)["location_id"];
    if (typeof brut === "number" && brut !== params.opLocationId) return "magasin_hors_lot";
  }
  return null;
}

// ────────────────────────────────────────────────────────────────────────────
// 3. L'ORDRE
// ────────────────────────────────────────────────────────────────────────────

/**
 * Les observations, de la plus récente à la plus ancienne — ORDRE TOTAL.
 *
 * ⚠️ LE TRI EST REFAIT ICI, ET CE N'EST PAS REDONDANT AVEC `order_by=-date`.
 * L'amont trie CHAQUE réponse ; nous en concaténons plusieurs — un lot par
 * paquet de sept code-barres, jusqu'à trois pages chacun. La liste assemblée
 * est donc localement triée et globalement fausse.
 *
 * ════════════════════════════════════════════════════════════════════════════
 * TROIS CRITÈRES, ET LE TROISIÈME REND L'ORDRE TOTAL
 * ════════════════════════════════════════════════════════════════════════════
 *   1. `observeLe` DÉCROISSANT — la fraîcheur d'abord. Comparaison de chaînes
 *      SÛRE ici, et pour une raison précise : `date` est un `YYYY-MM-DD` de
 *      largeur fixe, où l'ordre alphabétique EST l'ordre chronologique ;
 *   2. `createdLe` DÉCROISSANT — à jour d'observation égal, la saisie la plus
 *      récente d'abord. Comparaison sur la clé CANONISÉE, jamais sur la chaîne
 *      brute (voir `cleInstantIso` : une fraction de seconde omise inverserait
 *      l'ordre) ;
 *   3. `priceId` DÉCROISSANT — `id` est unique chez Open Prices, donc ce
 *      dernier critère ne laisse JAMAIS deux éléments à égalité. C'est lui qui
 *      fait de ce tri un ordre TOTAL, et non un ordre « à peu près stable ».
 *
 * ⚠️ SANS LE TROISIÈME, `Array.prototype.sort` retomberait sur l'ordre
 * d'arrivée — c'est-à-dire sur l'ordre des LOTS, donc sur un détail de
 * découpage. Le même écran rendu deux fois pourrait donner deux ordres, et l'on
 * croirait à un changement de prix là où il n'y a qu'un changement de hasard.
 * Même exigence que `meal-distribution.ts` et `plan-v2-conversion.ts`.
 *
 * ⚠️ ET CE TRI N'ÉLIT RIEN. Être en tête de liste ne fait pas d'un relevé « le »
 * prix : C4.4 rend toujours la liste entière, de tous les GTIN reliés. L'ordre
 * sert la lisibilité et le déterminisme, pas une sélection.
 *
 * L'entrée n'est pas mutée : trier sur place surprendrait un appelant qui
 * conserve sa liste.
 */
export function trierObservations(
  observations: readonly ObservationPrix[],
): readonly ObservationPrix[] {
  // La clé canonisée est calculée UNE fois par élément, pas à chaque
  // comparaison : `sort` appelle le comparateur O(n log n) fois.
  const cles = new Map<number, string>();
  for (const o of observations) cles.set(o.priceId, cleInstantIso(o.createdLe) ?? "");

  return [...observations].sort((a, b) => {
    if (a.observeLe !== b.observeLe) return a.observeLe < b.observeLe ? 1 : -1;
    const ca = cles.get(a.priceId) ?? "";
    const cb = cles.get(b.priceId) ?? "";
    if (ca !== cb) return ca < cb ? 1 : -1;
    return b.priceId - a.priceId;
  });
}

// ────────────────────────────────────────────────────────────────────────────
// 4. CE QUE L'ÉCRAN DOIT MONTRER
// ────────────────────────────────────────────────────────────────────────────

/**
 * ⚠️ CINQ ÉTATS, ET LE CINQUIÈME EST INDISPENSABLE.
 *
 * Le cadrage en demandait quatre — `aucun_magasin`, `aucun_produit_relie`,
 * `aucun_releve`, `releves`. Il en faut un cinquième, `indisponible`, et c'est
 * la leçon la plus chère de ce chantier :
 *
 *   - `LecturePrix.ok` en C3 existe parce qu'un réseau coupé affichait sinon
 *     « 0 / 20 articles estimés », comme si le catalogue de prix était vide ;
 *   - `StatutApercu.indetermine` en C4.1 existe parce qu'une réponse tronquée
 *     affichait sinon « aucun prix connu » sur un produit qui en a vingt ;
 *   - `MESSAGE_PANNE_OFF` en C4.1b existe parce qu'un 503 amont ressemblait, à
 *     l'écran, à une absence de candidats — et poussait à écrire en base une
 *     décision de curation fausse.
 *
 * Faire retomber une panne d'Open Prices sur `aucun_releve` rejouerait ce même
 * défaut une quatrième fois. « Il n'y a pas de prix ici » et « nous n'avons pas
 * pu savoir » sont deux phrases différentes.
 *
 * ════════════════════════════════════════════════════════════════════════════
 * ⚠️ ET IL EN FAUT UN SIXIÈME : `indetermine`. IL BOUCHE UN TROU RÉEL.
 * ════════════════════════════════════════════════════════════════════════════
 * Il existe un cas que ni `aucun_releve` ni `indisponible` ne décrivent
 * honnêtement : Open Prices A RÉPONDU, correctement, et nous n'avons pourtant
 * AUCUN relevé valide — parce que la réponse était TRONQUÉE au-delà de nos
 * trois pages, ou parce que toutes les lignes reçues ont été ÉCARTÉES (remise,
 * devise étrangère, date absente).
 *
 *   - Dire `aucun_releve` serait FAUX : le relevé existe peut-être à la page 4,
 *     ou derrière une ligne que nous avons refusée. Nous ne l'avons pas vu ;
 *     nous n'avons pas établi qu'il n'existe pas.
 *   - Dire `indisponible` serait faux AUSSI, et d'une autre manière : le service
 *     a répondu, il n'est pas en panne, et inviter à « réessayer plus tard » ne
 *     changerait rien — la troncature est NOTRE borne, pas son incident.
 *
 * C'est exactement la distinction `aucun` / `indetermine` de `StatutApercu` en
 * C4.1, appliquée ici à l'échelle de la ligne de courses. Trois phrases
 * différentes, trois états.
 */
export type EtatPrixObserves =
  | "aucun_magasin"
  | "aucun_produit_relie"
  | "aucun_releve"
  | "indetermine"
  | "releves"
  | "indisponible";

export type RaisonIndisponible = "rate_limited" | "unavailable";

export interface LectureObservations {
  /** `false` = LA LECTURE A ÉCHOUÉ. Ce n'est PAS « aucun prix ». */
  readonly ok: boolean;
  readonly raison?: RaisonIndisponible;
  readonly observations: readonly ObservationPrix[];
  /** Des pages restaient à lire au-delà de la borne. */
  readonly tronque: boolean;
  /** Lignes reçues mais écartées (remise, devise, date absente…). */
  readonly ignores: number;
}

export interface ResultatPrixObserves {
  readonly etat: EtatPrixObserves;
  readonly observations: readonly ObservationPrix[];
  /**
   * ⚠️ `tronque` ET `ignores` SURVIVENT JUSQU'À `releves`, ET C'EST VOULU.
   *
   * Ils ne servent pas qu'à choisir entre `aucun_releve` et `indetermine` : une
   * liste de trois relevés issue d'une réponse tronquée reste une liste
   * INCOMPLÈTE, et l'écran doit pouvoir le dire. Les jeter une fois l'état
   * calculé transformerait « voici trois prix, il y en a d'autres » en « voici
   * les trois prix » — la même perte d'honnêteté, un cran plus loin.
   */
  readonly tronque: boolean;
  readonly ignores: number;
  readonly raison: RaisonIndisponible | null;
}

/** Combien de pages, au plus, sont lues par lot de code-barres. */
export const MAX_OBSERVATIONS_PAGES = 3;

/**
 * L'état à afficher, dérivé dans un ORDRE QUI EST LA RÈGLE.
 *
 *   1. pas de magasin → on n'a rien demandé à personne, et c'est normal ;
 *   2. aucun code-barres relié → l'aliment n'a pas encore de pont. Ce n'est
 *      PAS une erreur, et surtout pas une invitation à en fabriquer un ;
 *   3. lecture en panne → `indisponible`, et JAMAIS `aucun_releve` ;
 *   4. aucun relevé valide, et une raison de douter (réponse tronquée, ou
 *      lignes écartées) → `indetermine` ;
 *   5. aucun relevé valide, et AUCUNE raison de douter → `aucun_releve`,
 *      qui est alors un FAIT CONSTATÉ ;
 *   6. sinon → `releves`, la LISTE, triée, sans aucun élu.
 *
 * ⚠️ LES ÉTAPES 4 ET 5 NE SE FUSIONNENT PAS. C'est la seule différence entre
 * « ce produit n'a pas de prix dans ce magasin » et « nous n'avons pas pu le
 * savoir » — et un élève qui lit la première alors que la seconde est vraie
 * range l'article dans sa tête comme introuvable.
 */
export function etatPrixObserves(params: {
  readonly opLocationId: number | null;
  readonly gtins: readonly string[];
  readonly lecture: LectureObservations | null;
}): ResultatPrixObserves {
  const vide = {
    observations: [] as readonly ObservationPrix[],
    tronque: false,
    ignores: 0,
    raison: null,
  };

  if (params.opLocationId === null) return { etat: "aucun_magasin", ...vide };
  if (params.gtins.length === 0) return { etat: "aucun_produit_relie", ...vide };

  const lecture = params.lecture;
  if (lecture === null || !lecture.ok) {
    return {
      etat: "indisponible",
      observations: [],
      tronque: false,
      ignores: 0,
      raison: lecture?.raison ?? "unavailable",
    };
  }

  if (lecture.observations.length === 0) {
    // ⚠️ LE DOUTE L'EMPORTE. Une seule ligne écartée, ou une seule page non
    // lue, suffit à retirer à l'absence son caractère de fait.
    const douteux = lecture.tronque || lecture.ignores > 0;
    return {
      etat: douteux ? "indetermine" : "aucun_releve",
      observations: [],
      tronque: lecture.tronque,
      ignores: lecture.ignores,
      raison: null,
    };
  }

  return {
    etat: "releves",
    observations: trierObservations(lecture.observations),
    tronque: lecture.tronque,
    ignores: lecture.ignores,
    raison: null,
  };
}
