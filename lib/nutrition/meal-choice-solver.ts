import { KCAL_PER_GRAM } from "@/lib/nutrition/macro-targets";
import { determineStatus, type SolverStatus } from "@/lib/nutrition/recipe-solver";

/**
 * N1.5 — LES QUANTITÉS D'UN REPAS COMPOSÉ PAR L'ÉLÈVE, EN UN SEUL CALCUL.
 *
 * ────────────────────────────────────────────────────────────────────────────
 * UN REPAS EST UN PROBLÈME, PAS N PROBLÈMES
 * ────────────────────────────────────────────────────────────────────────────
 * ⚠️ TOUTES LES QUANTITÉS SONT RÉSOLUES ENSEMBLE. Une fois que l'élève a
 * choisi un aliment dans chacune de ses listes, la question n'est pas
 * « combien de poulet ? » puis « combien de riz ? » : c'est « quelles
 * quantités, prises ensemble, approchent au mieux les P/G/L de CE repas ? ».
 * Résoudre liste par liste donnerait N réponses dont la somme ne viserait
 * rien — chaque aliment porte les trois macros, pas une seule.
 *
 * Le système est donc, pour N aliments choisis :
 *
 *     Σ  Pᵢ/100 × qᵢ = P cible
 *     Σ  Gᵢ/100 × qᵢ = G cible          avec qᵢ ≥ 0
 *     Σ  Lᵢ/100 × qᵢ = L cible
 *
 * Trois équations, N inconnues. N n'est PAS trois : le coach pose autant
 * d'occurrences qu'il veut, et un repas à une seule liste comme un repas à
 * dix doivent tous deux rendre une réponse.
 *
 * ────────────────────────────────────────────────────────────────────────────
 * LE CRITÈRE, ÉCRIT NOIR SUR BLANC
 * ────────────────────────────────────────────────────────────────────────────
 * Le système est sur-déterminé quand N < 3 (plus d'équations que d'inconnues)
 * et sous-déterminé quand N > 3 (une infinité de solutions exactes). Il faut
 * donc un critère, et un seul, valable dans les deux cas :
 *
 *   ⚠️ ON RETIENT LA SOLUTION DE NORME MINIMALE PARMI CELLES QUI MINIMISENT
 *   L'ÉCART À LA CIBLE — autrement dit q = A⁺b, la pseudo-inverse de
 *   Moore-Penrose. En français : d'abord approcher la cible du mieux
 *   possible ; à égalité d'approche, prendre les quantités les plus petites
 *   et les mieux réparties.
 *
 * Pourquoi celui-là. Il est UNIQUE (donc déterministe), il ne privilégie
 * aucun aliment (donc il ne réintroduit pas de rôle nutritionnel par la
 * bande), et il traite N = 1 comme N = 10 sans cas particulier. Un critère
 * « le premier aliment absorbe tout » dépendrait de l'ordre du coach ; un
 * critère « parts égales » ignorerait la cible.
 *
 * ⚠️ CONSÉQUENCE ASSUMÉE : deux occurrences portant le MÊME aliment reçoivent
 * la même quantité, moitié-moitié. C'est ce que « norme minimale » veut dire
 * quand deux colonnes sont identiques, et c'est la seule réponse stable — on
 * ne les fusionne pas pour autant (§ « deux occurrences, deux variables »).
 *
 * ────────────────────────────────────────────────────────────────────────────
 * CE QUE CE MODULE NE FAIT PAS
 * ────────────────────────────────────────────────────────────────────────────
 * ⚠️ AUCUN RÔLE, AUCUNE QUANTITÉ DE RÉFÉRENCE. `recipe-solver` groupe ses
 * ingrédients par rôle (`protein`/`carbohydrate`/`fat`) et fait varier UN
 * ratio par groupe autour d'un `referenceGrams` posé par l'auteur de la
 * recette. Ici, personne n'a posé de quantité de référence : le coach a donné
 * une liste d'aliments, pas une recette. Réintroduire un rôle reviendrait à
 * décider à sa place que « poulet » sert les protéines — alors que le poulet
 * porte aussi des lipides, et que c'est précisément ce que le calcul global
 * sait prendre en compte.
 *
 * ⚠️ AUCUN MINIMUM ARTIFICIEL. Une quantité de 0 est un résultat LÉGITIME :
 * un repas saumon + riz + huile n'a pas besoin d'huile, le saumon en apporte
 * déjà. Imposer « au moins 5 g » ferait rater la cible pour préserver une
 * apparence.
 *
 * ⚠️ AUCUN ACCÈS SUPABASE, AUCUN `fetch`, AUCUN OBJET NAVIGATEUR, AUCUN EFFET.
 * Les macros arrivent déjà hydratées ; ce fichier ne sait pas d'où.
 *
 * ⚠️ AUCUNE ÉCRITURE, NULLE PART. N1.5 calcule et affiche ; enregistrer le
 * repas est un autre lot.
 */

/* ─────────────────────────── Constantes ─────────────────────────── */

/**
 * Seuil de détection du rang, RELATIF à la plus grande norme de ligne.
 * En deçà, une direction macro est considérée comme non couverte par les
 * aliments choisis — cas réel : trois aliments purement protéinés ne
 * peuvent pas porter une cible en glucides.
 */
const RANG_EPSILON = 1e-9;

/**
 * Marge sous laquelle une quantité négative est du bruit flottant et non une
 * violation de la contrainte qᵢ ≥ 0.
 */
const NEGATIF_EPSILON = 1e-9;

/** Pas d'affichage des quantités : le gramme (et le millilitre). */
const PAS_D_AFFICHAGE = 1;

/* ─────────────────────── Garde-fous de faisabilité ─────────────────────── */

/**
 * PLAFOND D'UN ALIMENT SOLIDE DANS UN REPAS, EN GRAMMES.
 * PLAFOND D'UN ALIMENT LIQUIDE DANS UN REPAS, EN MILLILITRES.
 *
 * ────────────────────────────────────────────────────────────────────────────
 * CE QUE CES DEUX NOMBRES NE SONT PAS
 * ────────────────────────────────────────────────────────────────────────────
 * ⚠️ CE NE SONT PAS DES PORTIONS RECOMMANDÉES. Rien ici ne dit qu'il FAUT
 * manger 300 g de quoi que ce soit, ni que 300 g soit une quantité normale.
 * ⚠️ CE NE SONT PAS DES MINIMUMS. Aucune quantité n'est jamais poussée vers le
 * haut : 0 reste un résultat légitime, et rien ne l'en empêche.
 * ⚠️ CE NE SONT PAS DES RÔLES. Le plafond ne dépend ni de la macro dominante,
 * ni d'une catégorie « protéine / féculent / légume » — cette distinction
 * n'existe nulle part dans ce module et n'y entrera pas.
 * ⚠️ CE NE SONT PAS DES `referenceGrams`. Aucune quantité n'est calculée COMME
 * une fraction ou un multiple de 300 : le plafond n'entre dans le calcul que
 * le jour où il est franchi, et jamais comme base d'un ratio.
 * ⚠️ CE NE SONT PAS DES PROPRIÉTÉS NUTRITIONNELLES DE L'ALIMENT. Ils ne
 * viennent pas du catalogue, ils ne le décrivent pas, et l'audit du 15/08/2026
 * a établi qu'AUCUNE donnée de portion n'existe dans ce schéma : ni
 * `serving_size` (demandé à OFF, jamais stocké en colonne), ni « portion »
 * (unité de saisie non convertible), ni `piece_weight_g` (nulle sur les 2 734
 * lignes Ciqual), ni `min_grams`/`max_grams` (propres aux ingrédients de
 * RECETTE, sans jointure vers `food_catalog`).
 *
 * ────────────────────────────────────────────────────────────────────────────
 * CE QU'ILS SONT
 * ────────────────────────────────────────────────────────────────────────────
 * Des GARDE-FOUS DE FAISABILITÉ, et rien d'autre. Sans eux, le solveur peut
 * atteindre une cible « exactement » en empilant 1 074 g de brocoli : la
 * combinaison est mauvaise, et le résultat le CACHE derrière un nombre
 * aberrant. Avec eux, la mauvaise combinaison redevient visible — elle sort
 * « approché » ou « impossible », ce qui est la vérité.
 *
 * ⚠️ LE PLAFOND NE RÉPARE PAS UN REPAS : IL REND SON ÉCHEC LISIBLE. Mesuré :
 * les bancs qui tenaient déjà sous les plafonds sortent INCHANGÉS, à l'octet
 * près. Seul celui qui trichait change de verdict.
 */
export const MAX_SOLIDE_G = 300;
export const MAX_LIQUIDE_ML = 500;

/**
 * Le plafond applicable à une unité.
 *
 * ⚠️ L'UNITÉ N'EST PAS DEVINÉE, ELLE EST LUE. `food_catalog` comme
 * `food_products` contraignent `nutrition_unit in ('g','ml')`, et c'est la
 * même sémantique qu'A5 emploie déjà dans `quantite_en_base_nutritionnelle` :
 * l'unité NUTRITIONNELLE de l'aliment, celle dans laquelle ses macros sont
 * données « pour 100 ». Aucune autre notion d'unité n'est introduite ici.
 *
 * ⚠️ UNE UNITÉ HORS VOCABULAIRE NE PRODUIT PAS UNE DEVINETTE. En amont, la
 * couche d'hydratation refuse de rendre des macros pour une telle ligne :
 * l'option devient « non calculable » et aucune quantité n'est affichée —
 * c'est le comportement retenu, et il consiste à ne PAS calculer plutôt qu'à
 * supposer. Ce repli-ci ne peut donc être atteint que par une entrée
 * fabriquée à la main ; il prend alors le plafond le PLUS STRICT, parce qu'un
 * garde-fou qui, dans le doute, choisit la valeur la plus permissive n'est
 * pas un garde-fou.
 */
export function borneMaximale(unit: MealSolverUnit): number {
  return unit === "ml" ? MAX_LIQUIDE_ML : MAX_SOLIDE_G;
}

/* ───────────────────── Portions préférées (N1.5.1) ───────────────────── */

/**
 * ÉCHELLE NEUTRE d'un aliment SANS portion préférée, dans son unité.
 *
 * ────────────────────────────────────────────────────────────────────────────
 * CE QUE CE NOMBRE EST, ET CE QU'IL N'EST SURTOUT PAS
 * ────────────────────────────────────────────────────────────────────────────
 * ⚠️ CE N'EST PAS UNE PORTION. Il n'est jamais affiché, jamais enregistré,
 * jamais snapshoté, et il ne dit pas « mange 100 g ». C'est l'UNITÉ DE MESURE
 * de l'écart pour un aliment dont personne n'a exprimé de préférence : sans
 * elle, on comparerait des grammes absolus à des écarts relatifs, ce qui n'a
 * pas de sens dimensionnel.
 *
 * ⚠️ ET CE N'EST PAS UN DÉTAIL. Mesuré le 15/08/2026 : pénaliser un aliment
 * sans préférence en grammes ABSOLUS (σ = 1) le rend si cher à déplacer que le
 * solveur lui donne **0 g** — l'aliment choisi par l'élève disparaît de son
 * repas. C'est exactement ce que le § « aliment sans préférence » interdit.
 * Avec σ = 100, le même aliment reçoit 34 g.
 *
 * SENSIBILITÉ MESURÉE, sur le petit déjeuner terrain (quantité rendue au
 * sirop d'agave, seul aliment sans préférence) :
 *
 *     σ =   1 →  0 g      σ = 100 → 34 g
 *     σ =  20 →  8 g      σ = 150 → 37 g
 *     σ =  50 → 24 g      σ = 300 → 39 g
 *
 * Le choix n'est donc pas sur un fil : au-delà de 100, le résultat bouge de
 * 5 g. On retient 100, constant, dans l'unité de l'aliment.
 *
 * ⚠️ CONSTANT, ET PAS « MÉDIANE DES PORTIONS DU REPAS ». La médiane donnait
 * un résultat quasi identique (32 g contre 34 g), mais elle couple les
 * aliments entre eux : ajouter une préférence à l'aliment X changerait la
 * quantité de l'aliment Y. Déterministe, mais inexplicable à un coach.
 */
export const ECHELLE_NEUTRE = 100;

/* ─────────────────────────── Types ─────────────────────────── */

/**
 * L'unité NUTRITIONNELLE d'un aliment — celle dans laquelle ses macros sont
 * exprimées « pour 100 ».
 *
 * ⚠️ IL N'Y EN A QUE DEUX, ET ELLES NE SE MÉLANGENT PAS. `food_catalog` comme
 * `food_products` contraignent `nutrition_unit in ('g','ml')`, et aucune
 * densité n'existe dans ce schéma : additionner 100 g et 100 ml n'aurait pas
 * de sens, et personne ici ne le fait — on n'additionne JAMAIS deux
 * quantités, seulement leurs apports en macros, qui sont tous en grammes.
 *
 * ⚠️ « PIÈCE » N'EST PAS UNE SORTIE POSSIBLE, ET C'EST MESURÉ. La seule
 * mécanique de pièce du dépôt est `quantite_en_base_nutritionnelle`
 * (migration 20260901090000) : elle convertit une SAISIE en pièces vers la
 * base nutritionnelle, exige `piece_weight_g` non nul ET une nutrition en
 * grammes, et refuse le reste. Or `piece_weight_g` est nul sur les 2 734
 * lignes du catalogue Ciqual (migration 20260902090100 : la colonne n'est
 * même pas dans la liste d'insertion) et n'est écrite par aucun chemin.
 * Rendre « 1 pièce » supposerait donc d'inventer un poids. On rend l'unité
 * nutritionnelle de l'aliment, un point c'est tout — et une unité inconnue
 * retombe sur le gramme plutôt que de bloquer le calcul.
 */
export type MealSolverUnit = "g" | "ml";

/** Un aliment CHOISI par l'élève, ses macros déjà hydratées. */
export interface SelectedFoodForMealSolver {
  /** `meal_choice_options.id` — la LIGNE snapshotée, pas l'aliment. */
  readonly optionId: string;
  /** `meal_choice_slots.id` — l'occurrence dont vient ce choix. */
  readonly slotId: string;
  readonly name: string;
  readonly unit: MealSolverUnit;
  /** Macros POUR 100 (g ou ml, selon `unit`). */
  readonly proteinPer100: number;
  readonly carbPer100: number;
  readonly fatPer100: number;
  /**
   * N1.5.1 — LA PORTION PRÉFÉRÉE EFFECTIVE, SNAPSHOTÉE, dans `unit`.
   *
   * ⚠️ PRÉFÉRENCE, PAS CONTRAINTE. Le solveur vise ce nombre à macros égales,
   * et s'en écarte sans hésiter dès que la cible l'exige — mesuré : portions
   * divisées par cinq, il s'en éloigne de 635 % et atteint quand même la
   * cible exactement. Rien ne l'oblige à rendre 30 g de whey.
   *
   * ⚠️ NI MINIMUM, NI MAXIMUM, NI RÔLE, NI `referenceGrams`. Les plafonds de
   * faisabilité (300 g / 500 ml) restent des contraintes DURES, indépendantes,
   * et gagnent toujours : une préférence de 400 g ne contourne pas la borne.
   *
   * `null` ou absente = aucun avis. Le solveur retombe alors EXACTEMENT sur le
   * comportement N1.5 historique — ce n'est pas un cas à gérer, c'est le cas
   * dégénéré de la même formule.
   */
  readonly preferredQuantity?: number | null;
}

/**
 * La cible du repas, en GRAMMES de macro.
 *
 * ⚠️ MÊME FORME QUE `RecipeMacroTarget`, ET CE N'EST PAS UN HASARD : la cible
 * vient de `slotMacrosForDay`, donc de `computeMealDistribution` appliqué aux
 * objectifs du jour. Aucune répartition parallèle n'est calculée ici.
 */
export interface MealMacroTarget {
  readonly proteinGrams: number;
  readonly carbGrams: number;
  readonly fatGrams: number;
}

export interface MealMacroTotals {
  readonly proteinGrams: number;
  readonly carbGrams: number;
  readonly fatGrams: number;
  readonly calories: number;
}

export type MealSolverWarningCode =
  | "aucun_aliment"
  | "entree_invalide"
  | "systeme_degenere"
  | "quantite_bornee_a_zero"
  | "quantite_bornee_au_maximum"
  | "cible_non_atteinte";

export interface MealSolverWarning {
  readonly code: MealSolverWarningCode;
  readonly optionId?: string;
  readonly message: string;
}

export interface MealSolvedItem {
  readonly optionId: string;
  readonly slotId: string;
  readonly name: string;
  readonly unit: MealSolverUnit;
  /**
   * Quantité EXACTE, décimales conservées — vérité interne, jamais affichée.
   * L'arrondi ne doit pas entrer dans le calcul, sinon la somme des aliments
   * dérive de la cible du repas.
   */
  readonly quantity: number;
  /**
   * Quantité AFFICHÉE, arrondie au gramme (ou au millilitre).
   * ⚠️ C'est ELLE qui produit les macros ci-dessous, et donc le statut :
   * l'élève ne doit jamais lire « cible atteinte » sous des quantités qui,
   * telles qu'écrites, ne l'atteignent pas.
   */
  readonly displayQuantity: number;
  /** Apports de la quantité AFFICHÉE. */
  readonly proteinGrams: number;
  readonly carbGrams: number;
  readonly fatGrams: number;
  readonly calories: number;
  /** La contrainte qᵢ ≥ 0 a ramené cet aliment à zéro. */
  readonly boundedToZero: boolean;
  /** Le garde-fou de faisabilité a plafonné cet aliment. */
  readonly boundedToMax: boolean;
  /** Le plafond applicable à cet aliment, dans SON unité. */
  readonly maxQuantity: number;
  /**
   * La portion préférée qui a GUIDÉ le calcul, ou `null`.
   *
   * ⚠️ C'EST LA PRÉFÉRENCE MÉTIER, JAMAIS L'ÉCHELLE NEUTRE. Un aliment sans
   * préférence rend `null` ici, et surtout pas 100 : `ECHELLE_NEUTRE` est une
   * unité de mesure interne, et l'exposer la ferait passer pour une portion.
   */
  readonly preferredQuantity: number | null;
}

/** Traces de déterminisme — pour les tests et le diagnostic, pas pour l'écran. */
export interface MealSolverDeterminism {
  /** Nombre de résolutions effectuées (1 + une par aliment figé à une borne). */
  readonly iterations: number;
  /** Ordre exact dans lequel les aliments ont été bornés à zéro. */
  readonly zeroedOrder: readonly string[];
  /** Ordre exact dans lequel les aliments ont été plafonnés. */
  readonly cappedOrder: readonly string[];
  /** Rang du système de la DERNIÈRE résolution (0 à 3). */
  readonly rank: number;
}

export interface MealChoiceSolution {
  readonly status: SolverStatus;
  /** Dans l'ORDRE D'ENTRÉE, donc l'ordre des occurrences du coach. */
  readonly items: readonly MealSolvedItem[];
  readonly target: MealMacroTarget;
  /** Ce que les quantités AFFICHÉES apportent réellement. */
  readonly actual: MealMacroTotals;
  readonly delta: {
    readonly proteinGrams: number;
    readonly carbGrams: number;
    readonly fatGrams: number;
  };
  readonly warnings: readonly MealSolverWarning[];
  readonly determinism: MealSolverDeterminism;
}

/* ─────────────────────────── Algèbre ─────────────────────────── */

function produitScalaire(a: readonly number[], b: readonly number[]): number {
  let total = 0;
  for (let i = 0; i < a.length; i += 1) total += a[i] * b[i];
  return total;
}

function norme(a: readonly number[]): number {
  return Math.sqrt(produitScalaire(a, a));
}

/**
 * Élimination de Gauss avec pivot partiel, sur un système CARRÉ de petite
 * taille (au plus 3×3 ici). Rend `null` si le système est singulier.
 * Le pivot partiel est ce qui rend le résultat indépendant de l'ordre des
 * lignes fourni, donc reproductible.
 */
function resoudreCarre(matrice: readonly (readonly number[])[], second: readonly number[]): number[] | null {
  const n = second.length;
  const M = matrice.map((ligne, i) => [...ligne, second[i]]);

  for (let colonne = 0; colonne < n; colonne += 1) {
    let meilleur = colonne;
    for (let ligne = colonne + 1; ligne < n; ligne += 1) {
      if (Math.abs(M[ligne][colonne]) > Math.abs(M[meilleur][colonne])) meilleur = ligne;
    }
    if (Math.abs(M[meilleur][colonne]) < Number.EPSILON) return null;
    if (meilleur !== colonne) {
      const tampon = M[colonne];
      M[colonne] = M[meilleur];
      M[meilleur] = tampon;
    }
    for (let ligne = colonne + 1; ligne < n; ligne += 1) {
      const facteur = M[ligne][colonne] / M[colonne][colonne];
      if (facteur === 0) continue;
      for (let k = colonne; k <= n; k += 1) M[ligne][k] -= facteur * M[colonne][k];
    }
  }

  const x = new Array<number>(n).fill(0);
  for (let ligne = n - 1; ligne >= 0; ligne -= 1) {
    let somme = M[ligne][n];
    for (let k = ligne + 1; k < n; k += 1) somme -= M[ligne][k] * x[k];
    x[ligne] = somme / M[ligne][ligne];
  }
  return x.every((v) => Number.isFinite(v)) ? x : null;
}

/**
 * LA SOLUTION DE NORME MINIMALE AU SENS DES MOINDRES CARRÉS — q = A⁺b.
 *
 * `lignes` est la matrice 3×N des coefficients (macro pour 100, divisée par
 * 100), `cible` le vecteur des trois macros visées.
 *
 * ⚠️ POURQUOI PAS `det3` / CRAMER, COMME `recipe-solver`. Cramer résout un
 * système CARRÉ ; il convient parfaitement à `recipe-solver`, dont les
 * inconnues sont les trois ratios de groupe — toujours trois, jamais plus.
 * Ici les inconnues sont les ALIMENTS, et il y en a un, cinq ou dix. Une
 * matrice 3×10 n'a pas de déterminant. La méthode ci-dessous coïncide avec
 * Cramer quand N = 3 et que le système est inversible (un test l'épingle),
 * et continue de répondre quand N ne vaut pas 3.
 *
 * COMMENT. Les trois lignes de A vivent dans R^N. On en extrait une base
 * orthonormée u₁…u_r par Gram-Schmidt (r = rang ≤ 3). La solution de norme
 * minimale n'a AUCUNE composante hors de cet espace — toute composante
 * orthogonale augmenterait ‖q‖ sans changer Aq. On cherche donc
 * q = Σ c_j u_j, ce qui ramène le problème à R·c = b avec R[k][j] = ⟨a_k, u_j⟩,
 * système 3×r minuscule :
 *   - r = 3 : résolution directe (Gauss), la cible est atteignable ;
 *   - r < 3 : moindres carrés par équations normales (RᵀR est r×r, r ≤ 2) —
 *     la cible n'est pas atteignable, on s'en approche au mieux.
 */
function solutionNormeMinimale(
  lignes: readonly (readonly number[])[],
  cible: readonly number[],
): { readonly q: number[]; readonly rang: number } {
  const n = lignes[0]?.length ?? 0;
  if (n === 0) return { q: [], rang: 0 };

  const echelle = Math.max(...lignes.map((l) => norme(l)));
  if (!(echelle > 0)) return { q: new Array<number>(n).fill(0), rang: 0 };

  // ── Base orthonormée de l'espace des lignes ──
  const base: number[][] = [];
  for (const ligne of lignes) {
    const v = [...ligne];
    for (const u of base) {
      const c = produitScalaire(ligne, u);
      for (let i = 0; i < n; i += 1) v[i] -= c * u[i];
    }
    const longueur = norme(v);
    if (longueur > RANG_EPSILON * echelle) {
      base.push(v.map((x) => x / longueur));
    }
  }

  const rang = base.length;
  if (rang === 0) return { q: new Array<number>(n).fill(0), rang: 0 };

  // ── R[k][j] = ⟨a_k, u_j⟩ : chaque ligne exprimée dans la base ──
  const R = lignes.map((ligne) => base.map((u) => produitScalaire(ligne, u)));

  let c: number[] | null = null;
  if (rang === 3) {
    c = resoudreCarre(R, cible);
  }
  if (c === null) {
    // Équations normales : (RᵀR) c = Rᵀ b, de taille rang × rang.
    const RtR = Array.from({ length: rang }, (_, i) =>
      Array.from({ length: rang }, (_, j) => R.reduce((s, ligne) => s + ligne[i] * ligne[j], 0)),
    );
    const Rtb = Array.from({ length: rang }, (_, i) =>
      R.reduce((s, ligne, k) => s + ligne[i] * cible[k], 0),
    );
    c = resoudreCarre(RtR, Rtb);
  }
  if (c === null) return { q: new Array<number>(n).fill(0), rang };

  const q = new Array<number>(n).fill(0);
  for (let j = 0; j < rang; j += 1) {
    const u = base[j];
    for (let i = 0; i < n; i += 1) q[i] += c[j] * u[i];
  }
  return { q, rang };
}

/* ─────────────────────────── Point d'entrée ─────────────────────────── */

function estFini(...valeurs: readonly number[]): boolean {
  return valeurs.every((v) => typeof v === "number" && Number.isFinite(v));
}

/**
 * La portion préférée EXPLOITABLE d'un aliment, ou `null`.
 *
 * ⚠️ ON NE FABRIQUE JAMAIS DE PRÉFÉRENCE. Une valeur absente, nulle, négative
 * ou non finie n'en est pas une : on rend `null`, et l'aliment est traité
 * comme un aliment sans avis. Y substituer une valeur de repli reviendrait à
 * inventer une portion que personne n'a écrite.
 */
function portionPreferee(food: SelectedFoodForMealSolver): number | null {
  const p = food.preferredQuantity;
  if (typeof p !== "number" || !Number.isFinite(p) || p <= 0) return null;
  return p;
}

/** Le CENTRE de la préférence : la portion, ou zéro faute de préférence. */
function centreDe(food: SelectedFoodForMealSolver): number {
  return portionPreferee(food) ?? 0;
}

/**
 * L'ÉCHELLE de l'écart : la portion elle-même, ou l'échelle neutre.
 *
 * ⚠️ L'ÉCHELLE NEUTRE N'EST PAS UN CENTRE. Un aliment sans préférence est
 * centré sur 0 — on ne lui souhaite aucune quantité particulière — et
 * seulement MESURÉ à l'échelle de 100. Confondre les deux reviendrait à lui
 * inventer une portion de 100.
 */
function echelleDe(food: SelectedFoodForMealSolver): number {
  return portionPreferee(food) ?? ECHELLE_NEUTRE;
}

/** La macro n° m d'un aliment, pour 100. Ordre : protéines, glucides, lipides. */
function macroDe(food: SelectedFoodForMealSolver, m: number): number {
  if (m === 0) return food.proteinPer100;
  if (m === 1) return food.carbPer100;
  return food.fatPer100;
}

function unitéValide(unit: unknown): MealSolverUnit {
  // Repli sur le gramme plutôt que blocage : `nutrition_unit` est contraint en
  // base, une valeur hors vocabulaire ne peut venir que d'une base non migrée.
  return unit === "ml" ? "ml" : "g";
}

/**
 * Résout les quantités de TOUS les aliments choisis, ensemble.
 *
 * ⚠️ NE JAMAIS APPELER AVEC UNE COMPOSITION INCOMPLÈTE. Deux occurrences sur
 * cinq renseignées, ce n'est pas « un repas avec trois aliments manquants » :
 * c'est un repas dont la cible ne veut encore rien dire. L'appelant (l'écran
 * élève) ne construit l'entrée que lorsque chaque occurrence porte un choix.
 *
 * ⚠️ AUCUNE MUTATION. Ni `foods`, ni `target` ne sont modifiés.
 *
 * ⚠️ DÉTERMINISTE. Aucun `Math.random`, aucun parcours d'objet non ordonné,
 * aucune horloge : même entrée ⇒ même sortie, bit pour bit.
 */
export function solveMealChoices(
  foods: readonly SelectedFoodForMealSolver[],
  target: MealMacroTarget,
): MealChoiceSolution {
  const cibleSaine: MealMacroTarget = {
    proteinGrams: target.proteinGrams,
    carbGrams: target.carbGrams,
    fatGrams: target.fatGrams,
  };
  const warnings: MealSolverWarning[] = [];

  const entréeValide =
    estFini(cibleSaine.proteinGrams, cibleSaine.carbGrams, cibleSaine.fatGrams) &&
    foods.every((f) => estFini(f.proteinPer100, f.carbPer100, f.fatPer100));

  if (foods.length === 0 || !entréeValide) {
    warnings.push(
      foods.length === 0
        ? { code: "aucun_aliment", message: "Aucun aliment choisi : il n'y a rien à calculer." }
        : {
            code: "entree_invalide",
            message: "Des valeurs nutritionnelles sont inexploitables : aucune quantité n'est calculée.",
          },
    );
    return composer(foods, cibleSaine, foods.map(() => 0), new Map(), warnings, {
      iterations: 0,
      zeroedOrder: [],
      cappedOrder: [],
      rank: 0,
    });
  }

  // ── L'ENSEMBLE ACTIF, ET LES DEUX BORNES ─────────────────────────────────
  //
  // ⚠️ UNE QUANTITÉ NÉGATIVE N'EST NI AFFICHÉE, NI PRISE EN VALEUR ABSOLUE, NI
  // MASQUÉE : elle DÉCLENCHE une nouvelle résolution. « −40 g d'huile » veut
  // dire « les autres aliments en apportent déjà trop » ; la bonne réponse est
  // de figer l'huile à 0 puis de recalculer TOUT le reste avec cette
  // contrainte, pas de l'afficher ni de la retourner.
  //
  // ⚠️ UNE QUANTITÉ ABERRANTE NON PLUS. Franchir le garde-fou de faisabilité
  // déclenche exactement la même mécanique : on fige à la borne, et on
  // RE-RÉSOUT tout le reste. Plafonner sans re-résoudre laisserait les autres
  // aliments à des quantités calculées pour un monde où le brocoli pesait
  // 1 074 g — et le total affiché ne correspondrait plus à rien.
  //
  // ⚠️ ET UN ALIMENT FIGÉ CONTINUE D'APPORTER SES MACROS. C'est toute la
  // différence entre « figer » et « retirer » : on lui retire sa LIBERTÉ
  // MATHÉMATIQUE, pas sa nourriture. Le résidu est donc la cible MOINS ce que
  // les aliments figés apportent déjà. (À zéro, cet apport vaut zéro : le cas
  // négatif est un cas particulier de celui-ci, pas une mécanique à part.)
  const actifs = new Set<number>(foods.map((_, i) => i));
  /** index → cause du figement. La valeur figée vit dans `q`. */
  const figés = new Map<number, "zero" | "max">();
  const zeroedOrder: string[] = [];
  const cappedOrder: string[] = [];
  const q = new Array<number>(foods.length).fill(0);
  let iterations = 0;
  let rang = 0;

  /**
   * Le résidu à couvrir par les variables LIBRES : la cible, moins ce que les
   * aliments déjà figés apportent. Recalculé à CHAQUE tour, jamais mémorisé.
   *
   * ⚠️ IL N'EST PAS RABATTU À ZÉRO. Un résidu négatif signifie que les aliments
   * figés dépassent déjà la cible sur cette macro : l'écarter ferait disparaître
   * le dépassement du calcul, alors qu'il doit se retrouver dans le verdict
   * final. Les variables libres ne pouvant pas devenir négatives, la boucle les
   * ramènera simplement à zéro.
   */
  const résidu = (): number[] => {
    const apport = { p: 0, c: 0, l: 0 };
    for (const [i] of figés) {
      const quantité = q[i];
      apport.p += (foods[i].proteinPer100 * quantité) / 100;
      apport.c += (foods[i].carbPer100 * quantité) / 100;
      apport.l += (foods[i].fatPer100 * quantité) / 100;
    }
    return [
      cibleSaine.proteinGrams - apport.p,
      cibleSaine.carbGrams - apport.c,
      cibleSaine.fatGrams - apport.l,
    ];
  };

  for (;;) {
    iterations += 1;
    const indices = [...actifs].sort((a, z) => a - z);
    if (indices.length === 0) {
      rang = 0;
      break;
    }

    // ── N1.5.1 — LE RECENTRAGE, ET C'EST TOUTE LA FORMULATION ────────────
    //
    // On ne cherche plus « les plus petites quantités », mais « les quantités
    // les plus proches des portions préférées ». Substitution :
    //
    //     qᵢ = cᵢ + sᵢ · xᵢ        cᵢ = portion préférée (0 sans préférence)
    //                              sᵢ = portion préférée (ECHELLE_NEUTRE sinon)
    //
    // Minimiser ‖x‖ revient alors à minimiser Σ ((qᵢ − cᵢ) / sᵢ)², c'est-à-dire
    // l'écart RELATIF à la portion — 10 g d'écart sur 30 g de whey pèsent
    // autant que 66 g d'écart sur 200 g de fromage blanc, ce qui est bien la
    // façon dont on juge une portion.
    //
    // ⚠️ C'EST EXACTEMENT LE MÊME SOLVEUR, APPLIQUÉ À UNE MATRICE DONT LES
    // COLONNES SONT MISES À L'ÉCHELLE. Aucune algèbre nouvelle, aucune
    // bibliothèque, aucun λ à régler.
    //
    // ⚠️ ET LES MACROS N'EN PAIENT PAS LE PRIX. Changer de norme change
    // LAQUELLE des solutions optimales on retient, jamais la qualité macro de
    // l'ensemble : mesuré, le résidu avant arrondi est nul dans les deux cas.
    // C'est pourquoi il n'y a pas de compromis à arbitrer ici — et pourquoi
    // une pénalité pondérée (λ) serait un recul : mesurée aussi, elle
    // DÉGRADE les macros dès qu'elle pèse assez pour changer quelque chose.
    //
    // ⚠️ SANS AUCUNE PORTION, cᵢ = 0 et sᵢ = ECHELLE_NEUTRE pour tout le
    // monde : la mise à l'échelle devient un facteur commun, qui ne change
    // pas la direction de la solution de norme minimale. On retrouve donc
    // N1.5 au bit près — vérifié par test.
    const centres = indices.map((i) => centreDe(foods[i]));
    const echelles = indices.map((i) => echelleDe(foods[i]));

    const lignes = [
      indices.map((i, k) => (foods[i].proteinPer100 / 100) * echelles[k]),
      indices.map((i, k) => (foods[i].carbPer100 / 100) * echelles[k]),
      indices.map((i, k) => (foods[i].fatPer100 / 100) * echelles[k]),
    ];

    // Le résidu que les variables libres doivent couvrir, MOINS ce que les
    // centres apportent déjà : c'est le second membre du système recentré.
    const b = résidu();
    const bRecentré = [0, 1, 2].map((m) =>
      b[m] -
      indices.reduce(
        (total, i, k) =>
          total + (macroDe(foods[i], m) / 100) * centres[k],
        0,
      ),
    );

    const { q: partiel, rang: rangCourant } = solutionNormeMinimale(lignes, bRecentré);
    rang = rangCourant;

    indices.forEach((indexAliment, position) => {
      q[indexAliment] = centres[position] + echelles[position] * (partiel[position] ?? 0);
    });

    // ── 1. Le plancher d'abord ────────────────────────────────────────────
    // Le plus négatif ; à égalité stricte, le plus petit index — critère
    // TOTAL, donc reproductible.
    let pire = -1;
    let pireValeur = -NEGATIF_EPSILON;
    for (const i of indices) {
      if (q[i] < pireValeur) {
        pireValeur = q[i];
        pire = i;
      }
    }

    if (pire >= 0) {
      q[pire] = 0;
      actifs.delete(pire);
      figés.set(pire, "zero");
      zeroedOrder.push(foods[pire].optionId);
      warnings.push({
        code: "quantite_bornee_a_zero",
        optionId: foods[pire].optionId,
        message: `« ${foods[pire].name} » est ramené à 0 : les autres aliments de ce repas en apportent déjà assez.`,
      });
      continue;
    }

    // ── 2. Puis le plafond ────────────────────────────────────────────────
    // Le plus grand dépassement ; à égalité stricte, le plus petit index.
    let excédent = -1;
    let excédentValeur = NEGATIF_EPSILON;
    for (const i of indices) {
      const dépassement = q[i] - borneMaximale(unitéValide(foods[i].unit));
      if (dépassement > excédentValeur) {
        excédentValeur = dépassement;
        excédent = i;
      }
    }

    if (excédent >= 0) {
      const borne = borneMaximale(unitéValide(foods[excédent].unit));
      q[excédent] = borne;
      actifs.delete(excédent);
      figés.set(excédent, "max");
      cappedOrder.push(foods[excédent].optionId);
      warnings.push({
        code: "quantite_bornee_au_maximum",
        optionId: foods[excédent].optionId,
        message:
          `« ${foods[excédent].name} » est plafonné à ${borne} ${unitéValide(foods[excédent].unit)} : ` +
          `au-delà, la quantité ne serait plus réaliste et masquerait une mauvaise combinaison.`,
      });
      continue;
    }

    break;
  }

  // Garde-fou de bruit flottant : un résidu à −1e−15 ne doit pas ressortir en
  // négatif. Les valeurs figées, elles, valent déjà exactement 0 ou exactement
  // la borne.
  //
  // ⚠️ CETTE LIGNE EST MESURÉE INATTEIGNABLE, ET ELLE RESTE. Le supprimer
  // entièrement ne fait rougir aucun test (vérifié le 15/08/2026) : la boucle
  // ci-dessus garantit déjà qᵢ ≥ −ε avant d'en sortir. Ce n'est donc PAS un
  // filet qui rattraperait un négatif réel — un négatif réel est traité en
  // haut, par une re-résolution — mais une protection contre l'affichage d'un
  // « −0 » d'arrondi. Elle est gardée pour cela, et pour rien d'autre : la
  // présenter comme la garantie de non-négativité serait faux.
  const quantités = q.map((valeur, i) => (figés.has(i) ? valeur : Math.max(0, valeur)));

  if (rang < 3 && foods.length > 0) {
    warnings.push({
      code: "systeme_degenere",
      message:
        "Les aliments choisis ne couvrent pas les trois macros indépendamment : la cible est approchée au mieux.",
    });
  }

  return composer(foods, cibleSaine, quantités, figés, warnings, {
    iterations,
    zeroedOrder,
    cappedOrder,
    rank: rang,
  });
}

/**
 * ARRONDI PUIS RECALCUL — l'ordre compte.
 *
 * ⚠️ ON N'ARRONDIT QU'UNE FOIS, À LA FIN. Arrondir à chaque passe ferait
 * dériver le système d'itération en itération.
 *
 * ⚠️ ET ON RECALCULE LES MACROS SUR LES QUANTITÉS ARRONDIES. C'est la seule
 * façon que le « RÉSULTAT » affiché corresponde aux grammes affichés : si
 * l'on gardait les macros exactes, l'élève lirait un total que ses propres
 * quantités ne produisent pas. Le STATUT est jugé sur ce même total — un
 * repas peut donc être « exact » avant arrondi et « approché » après, et
 * c'est la vérité qu'il faut dire.
 */
function composer(
  foods: readonly SelectedFoodForMealSolver[],
  target: MealMacroTarget,
  quantités: readonly number[],
  figés: ReadonlyMap<number, "zero" | "max">,
  warnings: MealSolverWarning[],
  determinism: MealSolverDeterminism,
): MealChoiceSolution {
  // ⚠️ UN APPORT N'EST JAMAIS `NaN`, MÊME SUR UNE ENTRÉE ABERRANTE. Une macro
  // non finie multipliée par une quantité nulle donne `NaN` en JavaScript
  // (`Infinity × 0`), et un `NaN` affiché est pire qu'une absence : il se
  // propage dans le total et dans le statut. Une entrée inexploitable a déjà
  // produit une quantité de 0 et l'avertissement `entree_invalide` ; son
  // apport est donc nul, pas indéfini.
  const apport = (par100: number, quantité: number): number =>
    Number.isFinite(par100) ? (par100 * quantité) / 100 : 0;

  const items: MealSolvedItem[] = foods.map((food, i) => {
    const unit = unitéValide(food.unit);
    const maxQuantity = borneMaximale(unit);
    const quantity = quantités[i] ?? 0;
    // ⚠️ L'ARRONDI NE PEUT PAS FAIRE FRANCHIR LE PLAFOND : les bornes sont
    // entières, et arrondir une valeur qui leur est inférieure ou égale rend au
    // plus cette borne. Aucun `min` de rattrapage n'est donc nécessaire — en
    // ajouter un laisserait croire que le cas existe.
    const displayQuantity = Math.round(quantity / PAS_D_AFFICHAGE) * PAS_D_AFFICHAGE;
    const proteinGrams = apport(food.proteinPer100, displayQuantity);
    const carbGrams = apport(food.carbPer100, displayQuantity);
    const fatGrams = apport(food.fatPer100, displayQuantity);
    return {
      optionId: food.optionId,
      slotId: food.slotId,
      name: food.name,
      unit,
      quantity,
      displayQuantity,
      maxQuantity,
      proteinGrams,
      carbGrams,
      fatGrams,
      calories:
        proteinGrams * KCAL_PER_GRAM.protein +
        carbGrams * KCAL_PER_GRAM.carb +
        fatGrams * KCAL_PER_GRAM.fat,
      boundedToZero: figés.get(i) === "zero",
      boundedToMax: figés.get(i) === "max",
      // ⚠️ LA PRÉFÉRENCE MÉTIER, PAS L'ÉCHELLE NEUTRE. `null` quand il n'y en
      // a pas — jamais 100.
      preferredQuantity: portionPreferee(food),
    };
  });

  const actual: MealMacroTotals = items.reduce(
    (total, item) => ({
      proteinGrams: total.proteinGrams + item.proteinGrams,
      carbGrams: total.carbGrams + item.carbGrams,
      fatGrams: total.fatGrams + item.fatGrams,
      calories: total.calories + item.calories,
    }),
    { proteinGrams: 0, carbGrams: 0, fatGrams: 0, calories: 0 },
  );

  const delta = {
    proteinGrams: actual.proteinGrams - target.proteinGrams,
    carbGrams: actual.carbGrams - target.carbGrams,
    fatGrams: actual.fatGrams - target.fatGrams,
  };

  // ⚠️ LES TOLÉRANCES NE SONT PAS RÉINVENTÉES. `determineStatus` est celle de
  // `recipe-solver` : `exact` si CHAQUE macro est à moins de 0,5 g (donc
  // invisible au gramme affiché), `approximate` si chacune reste sous le plus
  // grand de 5 g et 10 % de sa cible, `impossible` sinon. Deux tolérances
  // différentes pour deux écrans du même produit seraient un défaut.
  // Aucune comparaison par `===` n'intervient : on juge des écarts, pas une
  // égalité flottante.
  const status = determineStatus(delta, target);
  if (status !== "exact") {
    warnings.push({
      code: "cible_non_atteinte",
      message:
        status === "approximate"
          ? "Cette combinaison approche au mieux les objectifs de ce repas."
          : "Cette combinaison ne permet pas d'atteindre les objectifs de ce repas.",
    });
  }

  return { status, items, target, actual, delta, warnings, determinism };
}
