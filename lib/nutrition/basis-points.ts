/**
 * Points de base (« basis points », bp) — représentation ENTIÈRE des
 * pourcentages du modèle nutrition v2.
 *
 *   100 %    = 10 000 bp
 *    50 %    =  5 000 bp
 *    33,33 % =  3 333 bp
 *
 * POURQUOI. Un pourcentage stocké en flottant rend impossible toute
 * comparaison fiable : `0.1 + 0.2 !== 0.3`, et un test `total === 100`
 * échoue sur des répartitions parfaitement valides. Toute la répartition
 * (P/G/L quotidiennes, part de chaque créneau) est donc stockée et comparée
 * en ENTIERS. Aucune comparaison flottante avec `=== 100` n'existe dans ce
 * chantier : la seule égalité testée est `total === BASIS_POINTS_TOTAL`,
 * entre entiers.
 *
 * Les flottants n'apparaissent qu'au moment de DÉRIVER des grammes ou des
 * calories, jamais pour décider si une répartition est complète.
 *
 * Bibliothèque PURE : aucun import applicatif, aucun accès réseau, aucune
 * mutation des entrées.
 */

/** Total exact d'une répartition complète (100 %). */
export const BASIS_POINTS_TOTAL = 10_000;

/** Borne basse admise pour une valeur en points de base. */
export const BASIS_POINTS_MIN = 0;

/** Borne haute admise pour une valeur en points de base. */
export const BASIS_POINTS_MAX = 10_000;

/**
 * Espace insécable — séparateur de milliers ET espace avant « % » en
 * typographie française. Exporté pour que les tests construisent les
 * chaînes attendues avec le même caractère, sans dépendre d'un caractère
 * invisible recopié à la main.
 */
export const NBSP = "\u00A0";

/** Vrai si la valeur est un entier de points de base dans [0, 10 000]. */
export function isBasisPoints(value: unknown): value is number {
  return (
    typeof value === "number" &&
    Number.isInteger(value) &&
    value >= BASIS_POINTS_MIN &&
    value <= BASIS_POINTS_MAX
  );
}

/**
 * Lève une `RangeError` déterministe si la valeur n'est pas un entier de
 * points de base valide. Utilisé par les bibliothèques de calcul, qui
 * refusent de produire un résultat à partir d'une entrée hors domaine
 * plutôt que de propager un NaN.
 */
export function assertBasisPoints(value: number, champ: string): void {
  if (!isBasisPoints(value)) {
    throw new RangeError(
      `${champ} doit être un entier de points de base entre ${BASIS_POINTS_MIN} et ${BASIS_POINTS_MAX} (reçu : ${String(value)}).`,
    );
  }
}

/** Convertit des points de base en ratio décimal (2 800 → 0,28). */
export function basisPointsToRatio(bp: number): number {
  return bp / BASIS_POINTS_TOTAL;
}

/** Applique une part en points de base à une valeur (1 700 kcal à 2 800 bp → 476 kcal). */
export function applyBasisPoints(valeur: number, bp: number): number {
  return (valeur * bp) / BASIS_POINTS_TOTAL;
}

/** État d'une somme de points de base par rapport aux 10 000 attendus. */
export type BasisPointsBalanceStatus = "complete" | "deficit" | "overflow";

export interface BasisPointsBalance {
  readonly status: BasisPointsBalanceStatus;
  /** Somme réelle des valeurs fournies, en points de base. */
  readonly totalBp: number;
  /** Points de base restant à répartir (0 si complet ou en dépassement). */
  readonly remainingBp: number;
  /** Points de base en trop (0 si complet ou en déficit). */
  readonly overflowBp: number;
}

/**
 * Compare une somme de points de base aux 10 000 attendus. Comparaison
 * ENTIÈRE uniquement — jamais de tolérance flottante.
 */
export function describeBasisPointsBalance(valeurs: readonly number[]): BasisPointsBalance {
  let total = 0;
  for (const v of valeurs) {
    total += v;
  }
  if (total === BASIS_POINTS_TOTAL) {
    return { status: "complete", totalBp: total, remainingBp: 0, overflowBp: 0 };
  }
  if (total < BASIS_POINTS_TOTAL) {
    return {
      status: "deficit",
      totalBp: total,
      remainingBp: BASIS_POINTS_TOTAL - total,
      overflowBp: 0,
    };
  }
  return {
    status: "overflow",
    totalBp: total,
    remainingBp: 0,
    overflowBp: total - BASIS_POINTS_TOTAL,
  };
}

/**
 * Formatage français d'un entier avec espace insécable comme séparateur de
 * milliers. Implémentation manuelle et non `Intl` : le résultat doit être
 * strictement identique quelle que soit la version d'ICU embarquée par
 * Node, sinon les tests deviennent dépendants de l'environnement.
 */
export function formatIntegerFr(valeur: number): string {
  const arrondi = Math.round(valeur);
  const signe = arrondi < 0 ? "-" : "";
  const chiffres = Math.abs(arrondi).toString();
  let sortie = "";
  for (let i = 0; i < chiffres.length; i += 1) {
    const restant = chiffres.length - i;
    sortie += chiffres[i];
    if (restant > 1 && restant % 3 === 1) {
      sortie += NBSP;
    }
  }
  return `${signe}${sortie}`;
}

/**
 * Formatage français d'un nombre décimal : virgule décimale, zéros de
 * queue supprimés, séparateur de milliers insécable.
 */
export function formatDecimalFr(valeur: number, decimales: number): string {
  if (!Number.isFinite(valeur)) {
    throw new RangeError(`Valeur non finie impossible à formater : ${String(valeur)}.`);
  }
  const facteur = 10 ** decimales;
  const arrondi = Math.round(valeur * facteur) / facteur;
  const partieEntiere = Math.trunc(Math.abs(arrondi));
  const reste = Math.abs(arrondi) - partieEntiere;
  const signe = arrondi < 0 ? "-" : "";
  const entierFormate = formatIntegerFr(partieEntiere);
  if (decimales === 0) {
    return `${signe}${entierFormate}`;
  }
  const decimalesTexte = Math.round(reste * facteur)
    .toString()
    .padStart(decimales, "0")
    .replace(/0+$/, "");
  if (decimalesTexte === "") {
    return `${signe}${entierFormate}`;
  }
  return `${signe}${entierFormate},${decimalesTexte}`;
}

/**
 * Pourcentage d'affichage à partir de points de base : 2 800 → « 28 % »,
 * 3 333 → « 33,33 % », 800 → « 8 % ». Deux décimales au maximum, zéros de
 * queue supprimés, espace insécable avant le signe.
 */
export function formatBasisPointsPercent(bp: number): string {
  return `${formatDecimalFr(bp / 100, 2)}${NBSP}%`;
}

/** Points de base formatés pour un message : 800 → « 800 », 10 000 → « 10 000 ». */
export function formatBasisPoints(bp: number): string {
  return formatIntegerFr(bp);
}

/**
 * Message français déterministe décrivant un déficit ou un dépassement.
 * `null` quand la répartition est exactement complète — l'appelant
 * n'affiche alors rien.
 *
 *   déficit     : « Il reste 800 points de base, soit 8 %, à répartir. »
 *   dépassement : « La répartition dépasse 100 % de 600 points de base, soit 6 %. »
 */
export function formatBasisPointsBalanceMessage(balance: BasisPointsBalance): string | null {
  if (balance.status === "complete") {
    return null;
  }
  if (balance.status === "deficit") {
    return `Il reste ${formatBasisPoints(balance.remainingBp)} points de base, soit ${formatBasisPointsPercent(balance.remainingBp)}, à répartir.`;
  }
  return `La répartition dépasse 100${NBSP}% de ${formatBasisPoints(balance.overflowBp)} points de base, soit ${formatBasisPointsPercent(balance.overflowBp)}.`;
}
