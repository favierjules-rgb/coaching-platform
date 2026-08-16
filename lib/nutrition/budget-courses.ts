import { formatIntegerFr, NBSP } from "@/lib/nutrition/basis-points";
import { cleDeLigne, type IdentityType } from "@/lib/nutrition/liste-de-courses";
import type { LigneAffichee } from "@/lib/nutrition/liste-persistante";

/**
 * COURSES C3 — LE BUDGET D'UNE LISTE, ET L'ESTIMATION DE SON COÛT.
 *
 * ────────────────────────────────────────────────────────────────────────────
 * TOUT EN CENTIMES ENTIERS, DU DÉBUT À LA FIN
 * ────────────────────────────────────────────────────────────────────────────
 * Aucun euro flottant ne traverse ce module. La seule division qui existe est
 * celle du rapport `besoin / quantité_de_référence`, et son résultat est
 * immédiatement ramené à un entier de centimes.
 *
 * C'est la doctrine que `basis-points.ts` a écrite pour les pourcentages :
 * « Un pourcentage stocké en flottant rend impossible toute comparaison
 * fiable ». La monnaie ne vaut pas mieux que les pourcentages.
 *
 * ⚠️ AUCUNE CONVERSION D'UNITÉ, ICI NON PLUS. Un besoin en grammes ne peut pas
 * être estimé par un prix au millilitre. Le résultat n'est alors PAS zéro —
 * c'est « non estimable », ce qui est une information différente et qui doit
 * remonter jusqu'à l'écran.
 *
 * ⚠️ ESTIMATION PROPORTIONNELLE, ET L'ÉCRAN LE DIT. 1 274 g de riz à 2,50 € le
 * kilo valent 3,19 € ici, pas « deux paquets à 5 € ». Le conditionnement réel
 * demande `food_products.net_quantity` et appartient à C4.
 *
 * Module FEUILLE : ni React, ni Supabase, ni réseau. Fonctions PURES.
 */

export type UnitePrix = "g" | "ml" | "piece";

/** Un prix estimatif, tel qu'il est en base. */
export interface PrixEstime {
  readonly identityType: IdentityType;
  readonly identityId: string;
  /** Le prix, en centimes entiers, de `quantite` `unite`. */
  readonly priceCents: number;
  readonly quantite: number;
  readonly unite: UnitePrix;
}

/**
 * La clé d'un prix — EXACTEMENT celle de C1 et de C2.
 *
 * ⚠️ IDENTITÉ + UNITÉ, JAMAIS LE NOM. Un prix « au kilo » et un prix « à la
 * pièce » du même aliment sont deux prix, pas deux versions du même ; et deux
 * aliments homonymes ne partagent rien.
 */
export function clePrix(prix: PrixEstime): string {
  return cleDeLigne(prix.identityType, prix.identityId, prix.unite);
}

/** Indexe les prix par leur clé, pour l'appariement avec les lignes. */
export function indexerPrix(prix: readonly PrixEstime[]): ReadonlyMap<string, PrixEstime> {
  const carte = new Map<string, PrixEstime>();
  for (const p of prix) carte.set(clePrix(p), p);
  return carte;
}

/* ══════════════════════════════════════════════════════════════════════════
 * LE COÛT D'UNE LIGNE
 * ════════════════════════════════════════════════════════════════════════ */

export type RaisonNonEstimee =
  /** Aucun prix connu pour cette identité dans cette unité. */
  | "aucun_prix"
  /** Un prix existe, mais dans une AUTRE unité — et rien ne se convertit. */
  | "unite_differente"
  /** La ligne n'a ni quantité ni unité exploitable. */
  | "quantite_absente";

export interface CoutDeLigne {
  /** Le coût en centimes entiers, ou `null` si la ligne n'est pas estimable. */
  readonly cents: number | null;
  /** Renseignée UNIQUEMENT quand `cents` est `null`. */
  readonly raison: RaisonNonEstimee | null;
}

const NON_ESTIMEE = (raison: RaisonNonEstimee): CoutDeLigne => ({ cents: null, raison });

/**
 * Le coût d'un besoin, au prix donné.
 *
 *     besoin 1 274 g · prix 250 centimes / 1 000 g  →  318,5  →  319 centimes
 *
 * ⚠️ ARRONDI AU CENTIME, PAR LIGNE, AU DEMI SUPÉRIEUR (`Math.round`). Le choix
 * est explicite parce qu'il devait l'être : tous les termes sont positifs, donc
 * `Math.round` est déterministe et sans surprise de signe. Le total est ensuite
 * la SOMME DES LIGNES ARRONDIES — et non l'arrondi de la somme exacte. Les deux
 * diffèrent de quelques centimes, et il vaut mieux que le total affiché soit
 * exactement la somme des lignes affichées : un utilisateur qui additionne à la
 * main doit retrouver le nombre qu'on lui montre.
 *
 * ⚠️ AUCUNE CONVERSION. Des grammes ne s'estiment pas avec un prix au
 * millilitre, ni une pièce avec un prix au gramme. Le refus est explicite.
 */
export function calculerCoutLigne(
  besoinQuantite: number | null,
  besoinUnite: string | null,
  prix: PrixEstime | null,
): CoutDeLigne {
  if (besoinQuantite === null || besoinUnite === null) return NON_ESTIMEE("quantite_absente");
  if (!Number.isFinite(besoinQuantite) || besoinQuantite <= 0) return NON_ESTIMEE("quantite_absente");
  if (prix === null) return NON_ESTIMEE("aucun_prix");
  if (prix.unite !== besoinUnite) return NON_ESTIMEE("unite_differente");
  if (!Number.isFinite(prix.quantite) || prix.quantite <= 0) return NON_ESTIMEE("aucun_prix");

  // ⚠️ DÉFAUT D-1, TROUVÉ PAR L'AUDIT ADVERSE. Un `price_cents` négatif
  // produisait un coût NÉGATIF — donc une ligne qui DIMINUAIT l'estimation du
  // panier, en silence. La base refuse déjà les prix négatifs
  // (`food_price_estimates_price_check`), mais ce module doit tenir debout tout
  // seul : il reçoit ses entrées d'un réseau, et une contrainte SQL ne protège
  // pas une fonction pure.
  if (!Number.isFinite(prix.priceCents) || prix.priceCents < 0) return NON_ESTIMEE("aucun_prix");

  const exact = (besoinQuantite / prix.quantite) * prix.priceCents;
  if (!Number.isFinite(exact)) return NON_ESTIMEE("aucun_prix");

  // ⚠️ DÉFAUT D-2, TROUVÉ PAR L'AUDIT ADVERSE. Au-delà de
  // `Number.MAX_SAFE_INTEGER`, deux entiers voisins deviennent le même nombre
  // flottant : le résultat n'est plus FAUX de peu, il est ARBITRAIRE. Rendre
  // « non estimable » est la seule réponse honnête — un montant impossible
  // affiché comme un montant serait pire qu'une absence.
  const arrondi = Math.round(exact);
  if (!Number.isSafeInteger(arrondi)) return NON_ESTIMEE("aucun_prix");
  return { cents: arrondi, raison: null };
}

/* ══════════════════════════════════════════════════════════════════════════
 * LE BUDGET D'UNE LISTE
 * ════════════════════════════════════════════════════════════════════════ */

/** Une ligne, augmentée de son coût. L'écran affiche exactement ceci. */
export interface LigneChiffree {
  readonly ligne: LigneAffichee;
  readonly cout: CoutDeLigne;
}

export interface BudgetDeLaListe {
  /** Le budget saisi, en centimes, ou `null` si aucun. `null` ≠ zéro. */
  readonly budgetCents: number | null;
  /** Somme des lignes estimables, en centimes. */
  readonly estimeCents: number;
  /** Somme des lignes estimables ET cochées — ce qui est déjà dans le panier. */
  readonly achetesCents: number;
  /** Somme des lignes estimables et NON cochées — ce qu'il reste à payer. */
  readonly restantCents: number;
  readonly articlesEstimes: number;
  readonly articlesSansPrix: number;
  readonly articlesTotal: number;
  /**
   * `budget - estimé`. Positif = il reste du budget ; négatif = dépassement.
   * `null` quand aucun budget n'est posé — et ce n'est PAS zéro.
   */
  readonly ecartCents: number | null;
  readonly depassement: boolean;
  /** `true` dès qu'au moins un article n'a pas de prix. */
  readonly partielle: boolean;
  readonly lignes: readonly LigneChiffree[];
}

/**
 * Chiffre une liste entière.
 *
 * ⚠️ `achetes` ET `restant` SORTENT DE `checked`, SANS EN CHANGER LE SENS. C2 a
 * défini `checked` comme « je l'ai mis dans mon panier ». C3 se contente de le
 * LIRE pour répondre à « combien ai-je déjà pris, combien reste-t-il » ; il ne
 * lui donne aucune signification nouvelle et n'écrit jamais dedans.
 *
 * ⚠️ UNE LIGNE SANS PRIX NE VAUT PAS ZÉRO. Elle est comptée dans
 * `articlesSansPrix`, jamais dans un total : présenter une estimation partielle
 * comme complète est la seule vraie faute possible dans cet écran.
 */
export function calculerBudgetListe(
  lignes: readonly LigneAffichee[],
  prixParCle: ReadonlyMap<string, PrixEstime>,
  budgetCents: number | null,
  /** Les besoins bruts, par identifiant de ligne : quantité + unité. */
  besoins: ReadonlyMap<string, { readonly quantite: number | null; readonly unite: string | null }>,
  /** Prix propre à une ligne MANUELLE, par identifiant de ligne. */
  prixManuels: ReadonlyMap<string, number | null>,
): BudgetDeLaListe {
  const chiffrees: LigneChiffree[] = [];
  let estime = 0;
  let achetes = 0;
  let restant = 0;
  let estimes = 0;

  for (const ligne of lignes) {
    const cout = coutDUneLigne(ligne, prixParCle, besoins, prixManuels);
    chiffrees.push({ ligne, cout });
    if (cout.cents === null) continue;
    estimes += 1;
    estime += cout.cents;
    if (ligne.checked) achetes += cout.cents;
    else restant += cout.cents;
  }

  const total = lignes.length;
  const sansPrix = total - estimes;
  // ⚠️ `null` ET NON `0` QUAND IL N'Y A PAS DE BUDGET. « Il te reste 0 € » et
  // « tu n'as pas fixé de budget » sont deux écrans différents.
  const ecart = budgetCents === null ? null : budgetCents - estime;

  return {
    budgetCents,
    estimeCents: estime,
    achetesCents: achetes,
    restantCents: restant,
    articlesEstimes: estimes,
    articlesSansPrix: sansPrix,
    articlesTotal: total,
    ecartCents: ecart,
    depassement: ecart !== null && ecart < 0,
    partielle: sansPrix > 0,
    lignes: chiffrees,
  };
}

/**
 * ⚠️ DEUX ORIGINES DE PRIX, ET ELLES NE SE CROISENT JAMAIS.
 *
 * Une ligne PLAN tire son prix de son IDENTITÉ (`food_price_estimates`). Une
 * ligne MANUELLE n'a pas d'identité : son prix est posé sur elle, et il est
 * FORFAITAIRE — « papier toilette : 4,50 € », pas « 4,50 € les 12 rouleaux ».
 * Il n'est donc jamais mis au prorata d'une quantité.
 */
function coutDUneLigne(
  ligne: LigneAffichee,
  prixParCle: ReadonlyMap<string, PrixEstime>,
  besoins: ReadonlyMap<string, { readonly quantite: number | null; readonly unite: string | null }>,
  prixManuels: ReadonlyMap<string, number | null>,
): CoutDeLigne {
  if (ligne.source === "manual") {
    const forfait = prixManuels.get(ligne.id) ?? null;
    if (forfait === null || !Number.isFinite(forfait) || forfait < 0) return NON_ESTIMEE("aucun_prix");
    const arrondi = Math.round(forfait);
    if (!Number.isSafeInteger(arrondi)) return NON_ESTIMEE("aucun_prix");
    return { cents: arrondi, raison: null };
  }

  const besoin = besoins.get(ligne.id) ?? null;
  if (besoin === null) return NON_ESTIMEE("quantite_absente");

  // ⚠️ ON CHERCHE LE PRIX À LA CLÉ EXACTE — identité ET unité. Un prix au
  // gramme ne se trouve pas pour un besoin à la pièce, et c'est bien le but :
  // `aucun_prix` plutôt qu'une conversion silencieuse.
  const exact = prixParCle.get(ligne.cle) ?? null;
  if (exact !== null) return calculerCoutLigne(besoin.quantite, besoin.unite, exact);

  // Un prix existe-t-il pour cette identité dans une AUTRE unité ? La réponse
  // change le message affiché : « aucun prix connu » ne se corrige pas de la
  // même façon que « prix connu, mais au litre ».
  const identite = ligne.cle.split("|")[0];
  for (const [cle, prix] of prixParCle) {
    if (cle.startsWith(`${identite}|`)) return calculerCoutLigne(besoin.quantite, besoin.unite, prix);
  }
  return NON_ESTIMEE("aucun_prix");
}

/* ══════════════════════════════════════════════════════════════════════════
 * L'AFFICHAGE
 * ════════════════════════════════════════════════════════════════════════ */

/**
 * « 53,40 € ». Centimes entiers en entrée, TOUJOURS.
 *
 * ⚠️ AUCUNE DIVISION, DONC AUCUN FLOTTANT — MÊME PAS POUR AFFICHER. Les euros
 * et les centimes sortent d'un `Math.trunc` et d'un modulo sur l'entier reçu.
 * La tentation était d'écrire `formatDecimalFr(cents / 100, 2)` ; c'était un
 * défaut, et il a été mesuré : `formatDecimalFr` SUPPRIME les zéros de fin, et
 * rendait « 53,4 € » pour 5 340 centimes, « 7 € » pour 700. Un montant affiche
 * toujours ses deux décimales, sinon il ne se lit plus comme un prix.
 *
 * Le séparateur de milliers vient de `formatIntegerFr`, le formateur du projet :
 * une seconde façon d'écrire « 1 000 » finirait par diverger de la première.
 */
export function formaterMontant(cents: number): string {
  if (!Number.isFinite(cents)) return `0,00${NBSP}€`;
  const total = Math.round(cents);
  const signe = total < 0 ? "-" : "";
  const absolu = Math.abs(total);
  const euros = Math.trunc(absolu / 100);
  const centimes = absolu % 100;
  return `${signe}${formatIntegerFr(euros)},${String(centimes).padStart(2, "0")}${NBSP}€`;
}

/** « 18 / 22 articles estimés ». */
export function libelleCouverture(budget: BudgetDeLaListe): string {
  const { articlesEstimes, articlesTotal } = budget;
  return `${articlesEstimes}${NBSP}/${NBSP}${articlesTotal} article${articlesTotal > 1 ? "s" : ""} estimé${articlesEstimes > 1 ? "s" : ""}`;
}

/**
 * Le pourcentage d'articles estimés, arrondi à l'entier. `0` sur liste vide.
 *
 * ⚠️ AUCUNE DIVISION PAR ZÉRO. Une liste vide n'a pas une couverture de 100 % :
 * elle n'en a aucune, et l'écran doit dire « aucune estimation disponible ».
 */
export function pourcentageCouverture(budget: BudgetDeLaListe): number {
  if (budget.articlesTotal === 0) return 0;
  return Math.round((budget.articlesEstimes / budget.articlesTotal) * 100);
}
