/**
 * LA PROGRESSION D'UNE JOURNÉE, EN NOMBRES (ALIMENTS A5.6).
 *
 * ────────────────────────────────────────────────────────────────────────────
 * AUCUNE NOUVELLE SOURCE DE VÉRITÉ
 * ────────────────────────────────────────────────────────────────────────────
 * Ce module ne calcule NI les calories, NI les macros. Il reçoit deux nombres
 * déjà établis — le consommé (`totalsForDay`, qui somme les instantanés) et
 * l'objectif (`dailyTargetsForDay`, qui vient du profil du jour) — et n'en fait
 * qu'une géométrie.
 *
 * Recalculer les kcal ici créerait une TROISIÈME implémentation du 4/4/9, à
 * côté de `kcalFromMacros` et de la fonction SQL `consommation_du_jour`. Deux
 * existent déjà et un test vérifie qu'elles s'accordent ; une de plus finirait
 * par diverger, et l'écran afficherait un cercle qui ne correspondrait pas au
 * total écrit juste en dessous.
 *
 * ────────────────────────────────────────────────────────────────────────────
 * LE PLAFONNEMENT NE CONCERNE QUE LE DESSIN
 * ────────────────────────────────────────────────────────────────────────────
 * ⚠️ C'est la règle la plus facile à casser de tout ce fichier. Un anneau ne
 * peut pas se remplir à 130 % — mais le TEXTE, lui, doit continuer à dire
 * 1 950 / 1 800. Plafonner la donnée plutôt que la géométrie masquerait
 * exactement l'information que l'élève est venu chercher : de combien il a
 * dépassé.
 *
 * `part` est donc TOUJOURS borné à [0, 1] et ne sert qu'au tracé ;
 * `consomme` et `cible` ne sont jamais touchés.
 *
 * Ce module est une FEUILLE : ni React, ni Supabase, ni réseau.
 */

export interface Progression {
  /** Ce qui a été consommé, tel quel — jamais plafonné. */
  readonly consomme: number;
  /** L'objectif du jour. `null` quand le coach n'en a prescrit aucun. */
  readonly cible: number | null;
  /** Pour le TRACÉ seulement : toujours dans [0, 1]. */
  readonly part: number;
  /** Ce qu'il reste. Négatif en cas de dépassement. `null` sans objectif. */
  readonly restant: number | null;
  /** Vrai dès que le consommé dépasse strictement l'objectif. */
  readonly depasse: boolean;
}

/**
 * Calcule une progression, et ne produit JAMAIS `NaN` ni `Infinity`.
 *
 * Les trois cas dangereux, traités explicitement plutôt que par accident :
 *
 *   - **objectif nul ou absent** → `part = 0`, `cible = null`. Diviser par zéro
 *     donnerait `Infinity`, que React afficherait tel quel dans le SVG et qui
 *     produirait un anneau vide sans aucun message d'erreur.
 *   - **valeur non finie en entrée** (un total corrompu, une soustraction sur
 *     `undefined`) → ramenée à 0. Mieux vaut un cercle vide qu'un `NaN` dans un
 *     attribut `stroke-dashoffset`, qui fait disparaître le tracé entier.
 *   - **consommé négatif** → `part = 0`. Aucun instantané ne peut être négatif
 *     (la base l'interdit), mais un anneau qui se dessinerait à l'envers serait
 *     un défaut d'affichage impossible à diagnostiquer.
 */
export function calculerProgression(consommeBrut: number, cibleBrute: number | null): Progression {
  const consomme = Number.isFinite(consommeBrut) ? consommeBrut : 0;
  const cible =
    cibleBrute !== null && Number.isFinite(cibleBrute) && cibleBrute > 0 ? cibleBrute : null;

  if (cible === null) {
    return { consomme, cible: null, part: 0, restant: null, depasse: false };
  }

  const ratio = consomme / cible;
  return {
    consomme,
    cible,
    part: Math.min(Math.max(ratio, 0), 1),
    restant: cible - consomme,
    depasse: consomme > cible,
  };
}

/**
 * La géométrie d'un anneau SVG.
 *
 * `strokeDasharray` vaut la circonférence entière, et `strokeDashoffset` la
 * portion NON remplie : à part = 0 l'anneau est invisible, à part = 1 il est
 * complet. Le calcul est ici et non dans le composant pour la même raison que
 * tout le reste — une formule dans un attribut JSX ne s'éprouve pas.
 */
export interface AnneauSvg {
  readonly circonference: number;
  readonly dashArray: number;
  readonly dashOffset: number;
}

export function anneau(rayon: number, part: number): AnneauSvg {
  const r = Number.isFinite(rayon) && rayon > 0 ? rayon : 0;
  const p = Number.isFinite(part) ? Math.min(Math.max(part, 0), 1) : 0;
  const circonference = 2 * Math.PI * r;
  return {
    circonference,
    dashArray: circonference,
    dashOffset: circonference * (1 - p),
  };
}

/**
 * La largeur d'une barre, en pourcentage prêt à poser dans un style.
 *
 * Toujours entre « 0% » et « 100% » : c'est la MÊME borne que l'anneau, et pour
 * la même raison. Le texte à côté, lui, affiche `72 / 65 g`.
 */
export function largeurBarre(part: number): string {
  const p = Number.isFinite(part) ? Math.min(Math.max(part, 0), 1) : 0;
  return `${p * 100}%`;
}

/* ══════════════════════════════════════════════════════════════════════════
   LES JOURS — QUEL EST « AUJOURD'HUI », ET OÙ SE PLACER
   ══════════════════════════════════════════════════════════════════════════ */

/**
 * L'index du jour courant dans une liste de dates, ou `null` s'il n'y est pas.
 *
 * ⚠️ COMPARAISON DE CHAÎNES, PAS DE `Date`. Les dates de la semaine sont des
 * `YYYY-MM-DD` produits par `getCurrentWeekDates()` ; construire un `Date` pour
 * les comparer ferait entrer le fuseau horaire dans une question qui n'en a
 * pas : « le 13 août est-il le 13 août ? ». À 23 h en heure d'été, un
 * `new Date("2026-08-13")` interprété en UTC répond « non ».
 *
 * `null` est un cas NORMAL, pas une erreur : un élève qui consulte la semaine
 * précédente n'a aucun « aujourd'hui » dans sa liste. L'appelant retombe alors
 * sur le premier jour.
 */
export function indexDuJour(dates: readonly string[], aujourdHui: string): number | null {
  const i = dates.indexOf(aujourdHui);
  return i === -1 ? null : i;
}

/**
 * L'index à afficher à l'ouverture : aujourd'hui s'il est là, sinon le premier.
 *
 * Jamais `-1`, jamais un index hors bornes — c'est cette valeur qui pilote un
 * `scrollIntoView`, et un index invalide y produirait un écran vide.
 */
export function indexParDefaut(dates: readonly string[], aujourdHui: string): number {
  if (dates.length === 0) return 0;
  return indexDuJour(dates, aujourdHui) ?? 0;
}
