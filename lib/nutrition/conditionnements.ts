import type { ObservationPrix } from "@/lib/nutrition/prix-observes";

/**
 * COURSES C4.5 — DU BESOIN AU CADDIE : COMBIEN DE PAQUETS, ET COMBIEN ÇA COÛTE.
 *
 * ────────────────────────────────────────────────────────────────────────────
 * LA QUESTION, ET SEULEMENT ELLE
 * ────────────────────────────────────────────────────────────────────────────
 * « Pour ce besoin nutritionnel, que faut-il réellement acheter AVEC CETTE
 * RÉFÉRENCE COMMERCIALE ? » — un nombre de paquets, une quantité achetée, un
 * surplus, un coût.
 *
 *   besoin 500 g de flocons d'avoine
 *     référence A — paquet de 375 g à 1,690 € → 2 paquets, 750 g, +250 g, 3,380 €
 *     référence B — paquet de 500 g à 2,190 € → 1 paquet,  500 g,    0 g, 2,190 €
 *     référence C — paquet de 1 kg  à 3,590 € → 1 paquet, 1000 g, +500 g, 3,590 €
 *
 * ⚠️ ET C4.5 N'ÉLIT PAS B. Il sait pourtant que B est le moins cher : il ne le
 * dit pas. Choisir entre trois références, c'est arbitrer entre un prix, un
 * surplus, une marque et une habitude — et cet arbitrage appartient au lot
 * suivant, avec ses propres règles et son propre écran. Un module qui rend une
 * liste de trois scénarios peut être audité ; un module qui rend « le bon »
 * doit être cru.
 *
 * ⚠️ CE MODULE NE PARLE À PERSONNE. Ni base, ni réseau, ni React. Il ne
 * déclenche AUCUN appel Open Food Facts : tout ce dont il a besoin est déjà
 * persisté dans `food_products` depuis le lot A3.
 *
 * ⚠️ ET IL NE DIT RIEN DU STOCK. « Deux paquets à 3,380 € » veut dire : SI
 * cette référence est achetée sous ce conditionnement et à ce prix relevé,
 * alors voici le compte. Jamais « disponible », jamais « en rayon aujourd'hui ».
 * La date du relevé traverse intacte, et c'est elle qui dit ce qu'on sait.
 */

// ────────────────────────────────────────────────────────────────────────────
// 1. LES UNITÉS DE LA PLATEFORME, ET LEURS TROIS DIMENSIONS
// ────────────────────────────────────────────────────────────────────────────

/**
 * ⚠️ CE VOCABULAIRE N'EST PAS UN CHOIX DE C4.5 : IL EST INSCRIT EN BASE.
 *
 *   `shopping_list_items_unit_check` → `unit in ('g', 'ml', 'piece')`
 *   `planned_meal_items_unit_check`  → les mêmes trois
 *   `UnitePrix` (C3)                 → `"g" | "ml" | "piece"`
 *
 * Il n'existe NI kilogramme, NI litre, NI centilitre dans le domaine
 * alimentaire de ce dépôt — `kg` n'apparaît que côté entraînement, pour un
 * poids de corps ou une charge. Ajouter ici une conversion kg↔g serait donc
 * outiller un vocabulaire que la plateforme n'a pas : du code non couvert par
 * des données, c'est-à-dire du code faux qu'on n'a pas encore vu échouer.
 * Un paquet d'un kilo est déjà stocké `net_quantity = 1000, net_unit = 'g'`.
 */
export const UNITES_COURSES = ["g", "ml", "piece"] as const;
export type UniteCourses = (typeof UNITES_COURSES)[number];

/**
 * Les unités qu'un CONDITIONNEMENT peut porter — deux, pas trois.
 *
 * ⚠️ `food_products_net_unit_check` → `net_unit in ('g', 'ml')`. Aucun
 * conditionnement n'est exprimé en pièces, et la dimension « compte » n'a donc
 * jamais rien en face d'elle. Ce n'est pas une limite de ce module, c'est un
 * fait du schéma — et le test C4.5-06 le relit dans la migration plutôt que de
 * le recopier ici.
 */
export type UniteConditionnement = "g" | "ml";

/**
 * ════════════════════════════════════════════════════════════════════════════
 * ⚠️ LE TROU DE COUVERTURE : UN BESOIN EN PIÈCES N'EST PAS CALCULABLE
 * ════════════════════════════════════════════════════════════════════════════
 * Le schéma le prouve, et c'est un FAIT, pas une opinion de ce module :
 *
 *     shopping_list_items.unit   →  'g' | 'ml' | 'piece'
 *     food_products.net_unit     →  'g' | 'ml'          ← 'piece' ABSENT
 *
 * Un besoin de « 6 œufs », « 2 bananes » ou « 4 unités de ce produit » n'a donc
 * en face de lui AUCUN conditionnement exprimé en unités commerciales. Il n'est
 * pas calculable aujourd'hui, et il ressort en `conditionnement_unitaire_absent`.
 *
 * ── CE QUE CETTE LIMITE N'EST PAS ───────────────────────────────────────────
 *
 *   CE N'EST PAS une conversion impossible du type masse ↔ volume. Là, deux
 *   grandeurs physiques existent et refusent de se convertir sans densité. Ici,
 *   il n'y a rien à convertir : la donnée MANQUE.
 *
 *   CE N'EST PAS la preuve que le produit est incompatible avec le besoin. Un
 *   paquet de six œufs répond parfaitement à « 6 œufs » ; nous ne savons
 *   simplement pas qu'il en contient six.
 *
 *   C'EST UNE LIMITE DE COUVERTURE RETAIL : aucun nombre d'unités commerciales
 *   n'est persisté à ce jour. `net_quantity` porte un POIDS ou un VOLUME net,
 *   jamais un COMPTE.
 *
 * ── LES QUATRE INVENTIONS QUI COMBLERAIENT CE TROU, ET QUI SONT INTERDITES ──
 *
 *   1. un POIDS MOYEN — « un œuf ≈ 60 g ». Vrai en moyenne, faux pour l'œuf
 *      qu'on achète, et le facteur d'erreur se propagerait au prix ;
 *   2. « 1 PIÈCE = 1 CONDITIONNEMENT » — c'est le raccourci le plus tentant et
 *      le plus faux : « 6 œufs » deviendrait six BOÎTES de six ;
 *   3. le NOMBRE D'UNITÉS D'UN MULTIPACK — il n'existe nulle part en base ;
 *      `net_quantity` d'un lot de 4 × 125 g vaut 500 g, et rien ne dit « 4 » ;
 *   4. l'ANALYSE DU TEXTE `quantity` d'Open Food Facts — « 6x33cl », « lot de
 *      4 », « 12 unités »… Une grammaire d'emballage qui prétendrait couvrir
 *      Open Food Facts serait fausse sur sa queue de distribution, et fausse en
 *      silence.
 *
 * ⚠️ AUCUNE MIGRATION N'EST FAITE ICI POUR COMBLER CE TROU. Ajouter une colonne
 * de comptage demanderait d'abord une SOURCE citable pour la remplir ; sans
 * elle, la colonne existerait vide et inviterait à la remplir à la main.
 */

export type Dimension = "masse" | "volume" | "compte";

/**
 * La dimension d'une unité — ou `null` si ce n'est pas une unité de courses.
 *
 * ⚠️ LA DIMENSION EST LA SEULE FRONTIÈRE DE CONVERSION AUTORISÉE, et il se
 * trouve qu'à l'intérieur de chacune, la plateforme n'a qu'une seule unité.
 * Il n'y a donc STRICTEMENT AUCUNE conversion à faire — ce qui est la manière
 * la plus sûre de n'en inventer aucune.
 *
 * ⚠️ ET SURTOUT : PAS DE PASSERELLE ENTRE DIMENSIONS. Pas de « 1 ml ≈ 1 g »,
 * pas de densité, pas de poids moyen d'une banane, pas de cru↔cuit. Chacune de
 * ces conversions existe dans la vraie vie et dépend de l'aliment ; aucune ne
 * peut être écrite ici sans être fausse pour la moitié du catalogue.
 */
export function dimensionDe(unite: unknown): Dimension | null {
  if (unite === "g") return "masse";
  if (unite === "ml") return "volume";
  if (unite === "piece") return "compte";
  return null;
}

/**
 * La dimension d'une unité de CONDITIONNEMENT — `g` et `ml`, et rien d'autre.
 *
 * ⚠️ POURQUOI UNE SECONDE FONCTION PLUTÔT QUE `dimensionDe`. Parce que
 * `dimensionDe("piece")` rend « compte », et qu'un conditionnement en pièces
 * ferait alors coïncider les dimensions avec un besoin en pièces — ouvrant
 * exactement le raccourci interdit : « 6 pièces ÷ 1 pièce = 6 paquets ».
 *
 * Le typage `UniteConditionnement` l'interdit à la compilation, mais un `as`
 * de trop, une lecture future un peu laxiste ou une colonne élargie
 * suffiraient à le rouvrir à l'exécution. Cette fonction ferme la porte là où
 * elle compte : dans le calcul.
 */
export function dimensionConditionnementDe(unite: unknown): "masse" | "volume" | null {
  if (unite === "g") return "masse";
  if (unite === "ml") return "volume";
  return null;
}

// ────────────────────────────────────────────────────────────────────────────
// 2. L'ARITHMÉTIQUE EXACTE
// ────────────────────────────────────────────────────────────────────────────

/**
 * Une quantité (`numeric` en base, `number` ou `string` par PostgREST) → des
 * MILLIÈMES D'UNITÉ DE BASE, entiers.
 *
 * ⚠️ POURQUOI DES MILLIÈMES, ET POURQUOI LA MÊME ÉCHELLE QUE `montantMilli`.
 * Un besoin et un conditionnement se divisent l'un par l'autre ; le faire en
 * flottants ferait dépendre `ceil()` d'un chiffre binaire — 500/375 est déjà
 * 1,3333… et l'erreur ne se voit qu'à la frontière exacte, c'est-à-dire
 * précisément là où un paquet de plus ou de moins se décide. Une seule échelle
 * entière dans tout le lot C4 (millièmes) évite en plus d'avoir à se rappeler
 * laquelle s'applique où.
 *
 * ⚠️ AU-DELÀ DE TROIS DÉCIMALES, ON REFUSE. Tronquer un microgramme serait
 * sans conséquence ; l'habitude de tronquer en silence, non. Et le refus n'est
 * jamais une perte : il ressort en `conditionnement_invalide`, visible.
 *
 * ⚠️ ZÉRO ET NÉGATIF SONT REFUSÉS. `food_products_net_quantity_positive` et
 * `shopping_list_items_quantity_check` les interdisent déjà en base ; les
 * revérifier ici évite qu'une donnée arrivée par un autre chemin produise une
 * division par zéro ou un surplus négatif.
 */
export function quantiteMilliDepuis(valeur: unknown): number | null {
  let texte: string;
  if (typeof valeur === "string") texte = valeur.trim();
  else if (typeof valeur === "number") {
    if (!Number.isFinite(valeur)) return null;
    texte = String(valeur);
  } else return null;

  const m = /^(\d+)(?:\.(\d{1,3}))?$/.exec(texte);
  if (!m) return null;
  const milli = Number(`${m[1]!}${(m[2] ?? "").padEnd(3, "0")}`);
  if (!Number.isSafeInteger(milli) || milli <= 0) return null;
  return milli;
}

/**
 * ════════════════════════════════════════════════════════════════════════════
 * ⚠️ POURQUOI CHAQUE RÉSULTAT RESTE UN ENTIER SÛR — LA DÉMONSTRATION
 * ════════════════════════════════════════════════════════════════════════════
 * JavaScript n'a pas d'entiers : il a des flottants 64 bits, exacts sur
 * [−(2^53−1), 2^53−1] et approximatifs au-delà. Tout ce lot compte en
 * millièmes, donc tout ce lot vit ou meurt sur cette borne.
 *
 * ── CE QUE LES CONTRAINTES RÉELLES GARANTISSENT ─────────────────────────────
 *
 *   `besoinMilli`          `shopping_list_items_quantity_check` impose > 0, et
 *                          RIEN DE PLUS : aucune borne haute en base. Seul
 *                          `quantiteMilliDepuis` la pose, en refusant tout ce
 *                          qui n'est pas `Number.isSafeInteger`.
 *                          ⇒ 1 ≤ besoinMilli ≤ 2^53−1.
 *
 *   `conditionnementMilli` `food_products_net_quantity_positive` impose > 0, et
 *                          RIEN DE PLUS. Même garde, même borne.
 *                          ⇒ 1 ≤ conditionnementMilli ≤ 2^53−1.
 *
 *   `montantMilli`         Open Prices déclare `Decimal(max_digits=10,
 *                          decimal_places=3)`, donc ≤ 9 999 999,999 €, soit
 *                          9 999 999 999 millièmes ≈ 1×10^10. Et
 *                          `montantMilliDepuis` refuse de toute façon ce qui
 *                          n'est pas un entier sûr.
 *                          ⇒ 0 ≤ montantMilli ≤ 2^53−1.
 *
 * ── CE QUI EST EXACT SANS GARDE ─────────────────────────────────────────────
 *
 *   `nombreConditionnements = ceil(a/b)` — EXACT, et ce n'est pas évident.
 *   `Math.floor(a/b)` passe par une division flottante ; elle pourrait, en
 *   principe, franchir un entier par arrondi. Elle ne le peut pas ici : si
 *   a/b n'est pas entier, il s'écarte de l'entier voisin d'au moins 1/b, tandis
 *   que l'erreur d'arrondi de la division vaut au plus (a/b)·2^−53. Un mauvais
 *   `floor` exigerait (a/b)·2^−53 ≥ 1/b, c'est-à-dire a ≥ 2^53 — exclu par la
 *   borne ci-dessus. `a % b` est exact sur des entiers sûrs. Donc `ceil` l'est.
 *   Et 1 ≤ nombreConditionnements ≤ besoinMilli ≤ 2^53−1.
 *
 *   `surplusMilli = quantiteAchetee − besoin` — différence de deux entiers sûrs
 *   positifs, avec quantiteAchetee ≥ besoin : elle-même sûre, et ≥ 0.
 *
 * ── CE QUI EXIGE UNE GARDE, ET POURQUOI ─────────────────────────────────────
 *
 *   `quantiteAcheteeMilli = n × b`. Comme n = ceil(a/b), on a n×b < a + b, donc
 *   au plus 2·(2^53−1) ≈ 2^54 : LA BORNE PEUT ÊTRE FRANCHIE. Exemple concret :
 *   a = 2^53−1, b = 2^53−2 donnent n = 2 et n×b = 2^54−4.
 *
 *   `coutTotalMilli = n × montantMilli`. n peut valoir 2^53−1 : le produit
 *   part très au-delà, jusqu'à l'infini flottant.
 *
 * ── POURQUOI LA GARDE *APRÈS* LA MULTIPLICATION EST SUFFISANTE ──────────────
 * `Number.isSafeInteger(x)` rend `false` pour TOUT |x| > 2^53−1, y compris les
 * grands pairs pourtant représentables exactement, et pour `Infinity`. Un
 * produit qui déborde est donc toujours détecté. Réciproquement, si le produit
 * VRAI tient dans la borne, IEEE 754 le rend exactement — le contrôle ne peut
 * donc ni rater un débordement, ni en signaler un faux.
 *
 * ⚠️ ET LE DÉBORDEMENT DEVIENT UNE RAISON EXPLICITE, jamais un clamp, jamais
 * une saturation, jamais un BigInt introduit « au cas où ». Aucune donnée
 * réelle n'approche ces bornes ; ce qui les approcherait serait une donnée
 * corrompue, et une donnée corrompue doit se voir.
 */

/**
 * `ceil(a / b)` en arithmétique ENTIÈRE.
 *
 * ⚠️ PAS `Math.ceil(a / b)`. La division flottante est exacte pour des entiers
 * sûrs, mais son résultat ne l'est pas toujours : `Math.ceil` appliqué à un
 * quotient qui vaut 2,0000000000000004 au lieu de 2 rendrait 3, c'est-à-dire un
 * paquet de trop, sur le cas le plus banal qui soit — une division juste.
 * Le quotient et le reste, eux, sont exacts sur des entiers sûrs.
 *
 * ⚠️ ET C'EST `ceil`, PAS `floor`. On n'achète pas 1,33 paquet. Arrondir vers
 * le bas donnerait 375 g pour couvrir un besoin de 500 g — un compte qui ne
 * couvre pas le besoin, affiché comme s'il le couvrait.
 */
function paquetsNecessaires(besoinMilli: number, conditionnementMilli: number): number {
  const entiers = Math.floor(besoinMilli / conditionnementMilli);
  return besoinMilli % conditionnementMilli === 0 ? entiers : entiers + 1;
}

// ────────────────────────────────────────────────────────────────────────────
// 3. LE CONTRAT
// ────────────────────────────────────────────────────────────────────────────

/**
 * Le conditionnement d'une référence, tel que `food_products` le porte DÉJÀ.
 *
 * ⚠️ `net_quantity` EST LE POIDS NET DE CE QUI EST VENDU SOUS CE CODE-BARRES.
 * Un lot de quatre pots de 125 g y vaut 500, et c'est exactement ce qu'il faut :
 * le lot s'achète entier. Il n'existe dans la table NI compteur d'unités, NI
 * quantité unitaire — donc rien à décomposer, et surtout pas un pot de 125 g
 * qui ne se vend pas seul.
 *
 * Ces deux colonnes viennent de `product_quantity` et `product_quantity_unit`,
 * les champs STRUCTURÉS d'Open Food Facts, lus par `lireQuantiteNette` depuis
 * le lot A3. Le champ texte libre `quantity` (« 2 x 125 g ») est bien demandé à
 * OFF mais n'est PAS persisté, et C4.5 ne l'analyse pas : aucune grammaire
 * d'emballage n'est écrite ici.
 */
export interface Conditionnement {
  readonly netQuantity: number | string | null;
  readonly netUnit: UniteConditionnement | null;
}

/**
 * Pourquoi une référence ne donne pas de scénario chiffré.
 *
 * ⚠️ CINQ RAISONS, ET CHACUNE A ÉTÉ GAGNÉE PAR L'AUDIT. Aucune n'est
 * décorative, aucune n'en cache une autre — et surtout, une référence
 * inexploitable n'est JAMAIS silencieusement retirée de la liste : elle sort
 * avec sa raison, pour que l'écran puisse dire « on ne sait pas » plutôt que
 * de faire disparaître un produit que l'élève voyait la veille.
 */
export const RAISONS_NON_CALCULABLE = [
  /** `net_quantity`/`net_unit` nuls — le cas le plus fréquent, OFF ne les publie pas toujours. */
  "conditionnement_absent",
  /** Présents mais inutilisables : zéro, négatif, illisible, plus de trois décimales. */
  "conditionnement_invalide",
  /**
   * Le besoin et le conditionnement n'ont pas la même dimension PHYSIQUE :
   * une masse devant un volume. Irréductible sans densité — et nous n'en
   * inventons pas.
   */
  "unite_incompatible",
  /**
   * Le besoin est exprimé en PIÈCES, et rien ne permet de le convertir en
   * paquets. ⚠️ CE N'EST PAS `unite_incompatible` — voir le grand encadré
   * plus bas : ce n'est pas une impossibilité physique, c'est un TROU DE
   * COUVERTURE RETAIL. Les confondre ferait chercher une densité là où il
   * manque un comptage.
   */
  "conditionnement_unitaire_absent",
  /** `pricePer` non nul : le prix n'est pas celui du conditionnement (voir plus bas). */
  "base_prix_non_supportee",
  /** Quantité de besoin nulle, négative, illisible, ou unité hors vocabulaire. */
  "besoin_invalide",
  /**
   * Le calcul sortirait de l'entier sûr JavaScript. Explicite, jamais un
   * clamp ni une saturation : au-delà de 2^53−1, un résultat n'est plus
   * exact, et un coût faux affiché comme exact est pire qu'un coût absent.
   */
  "depassement_exactitude",
] as const;
export type RaisonNonCalculable = (typeof RAISONS_NON_CALCULABLE)[number];

export interface ScenarioAchat {
  readonly calculable: true;
  readonly gtin: string;
  readonly priceId: number;
  readonly besoinMilli: number;
  readonly uniteBesoin: UniteCourses;
  readonly conditionnementMilli: number;
  readonly uniteConditionnement: UniteConditionnement;
  readonly nombreConditionnements: number;
  readonly quantiteAcheteeMilli: number;
  /** `quantiteAchetee - besoin`. TOUJOURS ≥ 0, par construction de `ceil`. */
  readonly surplusMilli: number;
  /** `nombreConditionnements × montantMilli`. Entier, sans arrondi. */
  readonly coutTotalMilli: number;
  readonly devise: "EUR";
  /** La date d'observation en magasin, telle que C4.4 l'a rendue. */
  readonly observeLe: string;
  readonly createdLe: string;
}

export interface ScenarioImpossible {
  readonly calculable: false;
  readonly gtin: string;
  readonly priceId: number;
  readonly raison: RaisonNonCalculable;
}

export type Scenario = ScenarioAchat | ScenarioImpossible;

export interface BesoinLigne {
  readonly quantite: unknown;
  readonly unite: unknown;
}

/**
 * ⚠️ POURQUOI UN `pricePer` NON NUL REND LE SCÉNARIO INCALCULABLE — VÉRIFIÉ
 * SUR LA SOURCE AMONT, PAS SUPPOSÉ.
 *
 * `open_prices/prices/validators.py`, règle `validate_price_price_rules` :
 *
 *     price_per — "Should not be set if `product_code` is filled"
 *                 "Should be set if `category_tag` is filled"
 *
 * Autrement dit : un prix `type=PRODUCT` — le seul type que C4.4 demande —
 * a TOUJOURS `price_per = null`, et c'est précisément ce qui en fait un prix
 * DE CONDITIONNEMENT : le montant que l'on paie pour l'objet portant ce
 * code-barres. Mesuré le 18/08/2026 sur cinq prix `type=PRODUCT` réels :
 * `price_per` nul cinq fois sur cinq. Sur cinq prix `type=CATEGORY` :
 * `UNIT` ou `KILOGRAM` cinq fois sur cinq, `product_code` nul.
 *
 * Une observation `type=PRODUCT` portant malgré tout `UNIT` ou `KILOGRAM`
 * contredirait donc la validation de la source. Nous ne saurions pas ce
 * qu'elle vaut : « 500 g × 3,50 €/kg = 1,75 € » est un calcul de tête, pas un
 * passage en caisse — le produit peut être vendu par barquettes de 380 g. On
 * refuse, et on le dit.
 */
function basePrixExploitable(observation: ObservationPrix): boolean {
  return observation.pricePer === null;
}

/**
 * Un scénario par OBSERVATION — et l'ordre d'entrée est conservé.
 *
 * ⚠️ UNE OBSERVATION, UN SCÉNARIO. Deux relevés du même GTIN donnent DEUX
 * scénarios : C4.5 ne choisit pas le plus récent, pas plus qu'il ne choisit le
 * moins cher. L'ordre reçu est celui de C4.4 — `observeLe` puis `createdLe`
 * puis `priceId`, tous décroissants — et il n'est pas retouché ici : re-trier
 * par coût total serait une élection déguisée en présentation.
 *
 * ⚠️ ET RIEN N'EST JETÉ. Une référence sans conditionnement, avec une unité
 * incompatible ou une base de prix inexploitable ressort avec sa raison. Une
 * liste qui rétrécit sans le dire est le pire des affichages : l'élève croit
 * que le produit n'existe plus.
 */
export function scenariosAchat(params: {
  readonly besoin: BesoinLigne;
  readonly observations: readonly ObservationPrix[];
  readonly conditionnements: ReadonlyMap<string, Conditionnement | null>;
}): readonly Scenario[] {
  const besoinMilli = quantiteMilliDepuis(params.besoin.quantite);
  const uniteBesoin = params.besoin.unite;
  const dimensionBesoin =
    typeof uniteBesoin === "string" ? dimensionDe(uniteBesoin) : null;

  return params.observations.map((observation): Scenario => {
    const socle = { gtin: observation.gtin, priceId: observation.priceId };

    // ── 1. LE BESOIN, D'ABORD ────────────────────────────────────────────
    // Un besoin illisible n'est pas un problème de référence : inutile de
    // regarder le conditionnement pour le savoir.
    if (besoinMilli === null || dimensionBesoin === null) {
      return { ...socle, calculable: false, raison: "besoin_invalide" };
    }

    // ── 2. LA BASE DE PRIX ───────────────────────────────────────────────
    if (!basePrixExploitable(observation)) {
      return { ...socle, calculable: false, raison: "base_prix_non_supportee" };
    }

    // ── 3. LE BESOIN EN PIÈCES N'A RIEN EN FACE DE LUI ───────────────────
    // ⚠️ HISSÉ AVANT TOUT EXAMEN DU CONDITIONNEMENT, ET C'EST DÉLIBÉRÉ. Aucun
    // conditionnement, existant ou futur, ne peut servir un besoin en pièces
    // tant qu'aucun COMPTE d'unités commerciales n'est persisté. Trancher ici
    // rend le raccourci « 1 pièce = 1 conditionnement » inatteignable, quelle
    // que soit la donnée qui arrive ensuite. Voir l'encadré « LE TROU DE
    // COUVERTURE ».
    if (dimensionBesoin === "compte") {
      return { ...socle, calculable: false, raison: "conditionnement_unitaire_absent" };
    }

    // ── 4. LE CONDITIONNEMENT ────────────────────────────────────────────
    const conditionnement = params.conditionnements.get(observation.gtin) ?? null;
    if (
      conditionnement === null ||
      conditionnement.netQuantity === null ||
      conditionnement.netUnit === null
    ) {
      // ⚠️ ABSENT VEUT DIRE INCONNU, JAMAIS « UN PAQUET ». Poser 1 par défaut
      // ferait afficher un coût d'achat inventé, avec l'aplomb d'un calcul.
      return { ...socle, calculable: false, raison: "conditionnement_absent" };
    }

    // ⚠️ `dimensionConditionnementDe`, PAS `dimensionDe` : une unité `piece`
    // arrivée ici — par un `as`, une lecture laxiste ou une colonne élargie —
    // est REFUSÉE, jamais assimilée à un compte.
    const dimensionConditionnement = dimensionConditionnementDe(conditionnement.netUnit);
    if (dimensionConditionnement === null) {
      return { ...socle, calculable: false, raison: "conditionnement_invalide" };
    }
    if (dimensionConditionnement !== dimensionBesoin) {
      // ⚠️ DEUX REFUS DIFFÉRENTS, ET LES CONFONDRE SERAIT UNE FAUTE DE
      // DIAGNOSTIC. Voir l'encadré « LE TROU DE COUVERTURE » plus haut :
      //
      //   besoin en PIÈCES  → il n'existe AUCUN conditionnement unitaire en
      //                       base. Rien à convertir : il manque une donnée.
      //   masse vs volume   → la donnée existe des deux côtés, c'est la
      //                       CONVERSION qui est impossible sans densité.
      //
      // Le premier se comblera peut-être un jour par une source ; le second,
      // jamais. Les ranger sous la même raison ferait chercher une densité là
      // où il manque un comptage.
      // Le cas « compte » est déjà sorti plus haut : ce qui reste est un
      // conflit PHYSIQUE — une masse devant un volume — irréductible sans
      // densité, et nous n'en inventons pas.
      return { ...socle, calculable: false, raison: "unite_incompatible" };
    }

    const conditionnementMilli = quantiteMilliDepuis(conditionnement.netQuantity);
    if (conditionnementMilli === null) {
      return { ...socle, calculable: false, raison: "conditionnement_invalide" };
    }

    // ── 5. LE CALCUL, EN ENTIERS ─────────────────────────────────────────
    const nombreConditionnements = paquetsNecessaires(besoinMilli, conditionnementMilli);
    const quantiteAcheteeMilli = nombreConditionnements * conditionnementMilli;
    const coutTotalMilli = nombreConditionnements * observation.montantMilli;
    // ⚠️ LA GARDE D'EXACTITUDE. Démonstration complète au-dessus de
    // `paquetsNecessaires` : ces deux produits sont les SEULES opérations du
    // lot dont les bornes d'entrée ne suffisent pas à garantir le résultat.
    // Ni clamp, ni saturation, ni BigInt : on refuse, et on nomme le refus.
    if (!Number.isSafeInteger(quantiteAcheteeMilli) || !Number.isSafeInteger(coutTotalMilli)) {
      return { ...socle, calculable: false, raison: "depassement_exactitude" };
    }

    return {
      ...socle,
      calculable: true,
      besoinMilli,
      uniteBesoin: uniteBesoin as UniteCourses,
      conditionnementMilli,
      uniteConditionnement: conditionnement.netUnit,
      nombreConditionnements,
      quantiteAcheteeMilli,
      surplusMilli: quantiteAcheteeMilli - besoinMilli,
      coutTotalMilli,
      devise: observation.devise,
      observeLe: observation.observeLe,
      createdLe: observation.createdLe,
    };
  });
}
